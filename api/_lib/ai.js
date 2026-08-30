// Lógica de IA compartida por las funciones serverless (api/ai/*) y por server.js.
// Las API keys viven SOLO aquí (servidor); nunca se exponen en el bundle.
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const KEYS = {
  gemini: () => process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY,
  groq: () => process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY,
  anthropic: () => process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY,
  openrouter: () => process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY,
  zai: () => process.env.ZAI_API_KEY || process.env.VITE_ZAI_API_KEY,
};

/** Crea el modelo del SDK para el proveedor pedido, con la key del servidor. */
export function resolveModel(provider = 'gemini', model) {
  const key = KEYS[provider]?.();
  if (!key) throw new Error(`Sin API key configurada en el servidor para "${provider}"`);

  switch (provider) {
    case 'groq': {
      const groq = createOpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: key });
      return groq(model);
    }
    case 'openrouter': {
      // OpenRouter es compatible con el protocolo OpenAI: mismo patrón que Groq.
      // Los headers de ranking son opcionales pero recomendados por OpenRouter.
      const openrouter = createOpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: key,
        headers: {
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://runanalyzer.app',
          'X-Title': 'RunAnalyzer',
        },
      });
      return openrouter(model);
    }
    case 'zai': {
      // Z.ai (GLM) habla el protocolo OpenAI PERO solo expone /chat/completions,
      // no la Responses API. Por eso usamos .chat(model) explícito: con el modo
      // por defecto el SDK pega a /responses y Z.ai devuelve 404.
      const zai = createOpenAI({
        baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
        apiKey: key,
      });
      return zai.chat(model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: key });
      return anthropic(model);
    }
    case 'gemini':
    default: {
      const google = createGoogleGenerativeAI({ apiKey: key });
      return google(model);
    }
  }
}

// ── Guardarraíles de la API ──────────────────────────────────────────────────
// El endpoint gasta la cuota/factura del servidor: aunque el usuario esté
// autenticado, solo se aceptan los proveedores/modelos que la app usa y se
// acota el tamaño del prompt (un cliente manipulado no puede colar prompts
// gigantes ni modelos caros con nuestras keys).
const ALLOWED_MODELS = {
  gemini: (m) => /^gemini-[\w.-]{1,60}$/.test(m),
  groq: (m) => m === 'llama-3.3-70b-versatile',
  // Solo modelos gratuitos de OpenRouter (id que termina en ":free"). Esto
  // garantiza coste $0 con nuestra key aunque un cliente manipulado pida otro,
  // y hace que cualquier modelo gratis NUEVO funcione sin tocar código.
  openrouter: (m) => typeof m === 'string' && m.length <= 80 && /^[\w./-]+:free$/.test(m),
  // Z.ai: solo modelos GLM "*-flash" (el nivel gratuito). Restringir al sufijo
  // -flash evita que con nuestra key se pidan los GLM de pago (air, 4.6, etc).
  zai: (m) => typeof m === 'string' && /^glm-[\w.-]*flash$/i.test(m),
};
const MAX_PROMPT_CHARS = 150_000;
const MAX_MESSAGES = 50;

/** Valida provider/model/tamaño. Devuelve un mensaje de error o null si es válido. */
export function validateAIRequest({ provider = 'gemini', model, prompt, messages }) {
  const check = ALLOWED_MODELS[provider];
  if (!check) return `proveedor no permitido: ${provider}`;
  if (typeof model !== 'string' || !check(model)) return `modelo no permitido para ${provider}: ${model}`;
  if (prompt != null && (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_CHARS)) {
    return `prompt inválido o demasiado largo (máx ${MAX_PROMPT_CHARS} caracteres)`;
  }
  if (messages != null) {
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      return `messages inválido (1-${MAX_MESSAGES} mensajes)`;
    }
    let total = 0;
    for (const m of messages) {
      if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
        return 'messages inválido (role/content malformados)';
      }
      total += m.content.length;
    }
    if (total > MAX_PROMPT_CHARS) return `conversación demasiado larga (máx ${MAX_PROMPT_CHARS} caracteres)`;
  }
  return null;
}

// Esquemas de salida estructurada (antes vivían en los componentes). El cliente
// solo manda el nombre del esquema; aquí se reconstruye con Zod.
export const SCHEMAS = {
  // El tiempo se pide en SEGUNDOS numéricos y el ritmo se calcula en cliente
  // (tiempo/distancia): así tiempo y ritmo no pueden ser incoherentes entre sí.
  // El tiempo se pide en SEGUNDOS numéricos y el ritmo se calcula en cliente
  // (tiempo/distancia): así tiempo y ritmo no pueden ser incoherentes entre sí.
  // Tipos deliberadamente PERMISIVOS (string, sin min/max ni enum): un modelo
  // "lite" que devuelve una etiqueta con acento o un bullet de más haría que Zod
  // rechazara TODA la respuesta ("did not match schema"). El cliente normaliza.
  racePrediction: z.object({
    analysis: z.string().describe('Análisis (máx 60 palabras) del estado de forma: anclajes usados (marcas, umbral, volumen) y, si hay objetivo de carrera, si va en camino de lograrlo.'),
    predictions: z.array(z.object({
      label: z.string().describe('Distancia: exactamente "5K", "10K", "Media Maratón" o "Maratón".'),
      time_seconds: z.coerce.number().describe('Tiempo total estimado en SEGUNDOS (ej: 25:30 → 1530). No incluyas el ritmo: se deriva de este valor.'),
      confidence: z.string().describe('Confianza: "Alta", "Media" o "Baja". "Alta" solo con esfuerzos o marcas recientes cerca de esa distancia.'),
      rationale: z.string().describe('Justificación breve (máx 15 palabras): anclaje usado y ajuste aplicado (ej: "PB 10K 42:30 + Riegel, penalizado por bajo volumen").'),
    })).describe('4 predicciones, una por distancia: 5K, 10K, Media Maratón, Maratón.'),
  }),
  // Coach IA del dashboard: sustituye al antiguo protocolo de texto "|||" —
  // la estructura la impone Zod en servidor y el cliente ya no parsea con regex.
  // Igual que arriba: tipos permisivos para no romper con modelos "lite". Los
  // enums lógicos (estado/tendencia/tipo) se validan luego en el cliente
  // (deriveStatusKey/deriveTrendKey/parseWorkout), que ya toleran variantes.
  coachInsights: z.object({
    diagnostico: z.array(z.string()).describe('2-3 bullets del diagnóstico de ESTA SEMANA (máx 22 palabras cada uno). Empieza cada bullet con el concepto clave en **negrita**.'),
    tendencia: z.array(z.string()).describe('3-4 bullets de la tendencia de los últimos 2 meses (máx 22 palabras cada uno), con el patrón detectado en **negrita**: patrón, mejor/peor período, seguridad de la rampa y veredicto del objetivo.'),
    sesion: z.object({
      tipo: z.string().describe('Tipo de la próxima sesión de carrera: Regenerativo, Aeróbico base, Tempo, Intervalos, Series o Rodaje largo.'),
      distancia: z.string().describe("Rango de distancia, formato 'X-Y km' (ej: '8-10 km')."),
      ritmo: z.string().describe("Rango de ritmo, formato 'M:SS-M:SS min/km', coherente con RITMOS DE REFERENCIA."),
      zona: z.coerce.number().optional().describe('Zona de FC de la sesión (1-5) según ZONAS DE FC CALCULADAS.'),
      fcMin: z.coerce.number().optional().describe('Pulsaciones mínimas del rango objetivo (ppm), EXACTAS de ZONAS DE FC CALCULADAS.'),
      fcMax: z.coerce.number().optional().describe('Pulsaciones máximas del rango objetivo (ppm), EXACTAS de ZONAS DE FC CALCULADAS.'),
      instrucciones: z.array(z.string()).describe('2-3 bullets (máx 30 palabras cada uno): estructura de la sesión, una condición fisiológica de seguridad concreta, y distribución de intensidad 80/20.'),
      structured_workout: z.array(z.object({
        phase: z.string().describe('Fase (Calentamiento, Series, Tempo, Bloque Principal, Recuperación, Vuelta a la calma, etc).'),
        duration_min: z.coerce.number().describe('Duración en minutos. Si "reps" está presente, es la duración de UNA repetición (el intervalo de trabajo), no del bloque entero.'),
        intensity: z.coerce.number().describe('Intensidad/zona 1-5.'),
        reps: z.coerce.number().optional().describe('Nº de repeticiones si es bloque de series/intervalos (ej: 4 para "4 × 5′"). Omitir en bloques continuos.'),
        pace: z.string().optional().describe("Ritmo objetivo, formato 'M:SS/km', EXACTO de RITMOS DE REFERENCIA (series→'Intervalos/series'; tempo→'Tempo/umbral'; fácil→rodaje fácil). No inventar."),
        hr: z.string().optional().describe("Rango de FC objetivo 'min-max' en ppm, EXACTO de ZONAS DE FC CALCULADAS."),
        recovery: z.string().optional().describe("Recuperación entre reps si hay 'reps' (ej: '90\" trote'). Omitir si no es bloque de series."),
        description: z.string().optional().describe('Descripción breve del bloque.'),
      })).optional().describe('Desglose de la sesión en bloques. Inclúyelo SIEMPRE que la sesión tenga estructura (calentamiento/bloque/vuelta a la calma) y, si el readiness permite calidad, con SERIES reales usando "reps". Omítelo solo en un rodaje regenerativo trivial.'),
    }),
    ultimoEntreno: z.array(z.string()).describe('2-3 bullets del análisis de la última sesión (máx 22 palabras cada uno): estímulo real según %LTHR, exactamente 1 acierto y 1 ajuste accionable, veredicto en **negrita**.'),
    estado: z.string().describe('Estado fisiológico global: recuperado, fatigado, sobreentrenado, en_forma o adaptativo. Coherente con el diagnóstico.'),
    tendenciaClave: z.string().describe('Patrón de tendencia global: progresion, estable, riesgo o estacional. Coherente con los bullets de tendencia.'),
  }),
  plan: z.object({
    analysis: z.string().describe('Análisis breve (max 60 palabras) del estado del corredor.'),
    weekly_summary: z.string().describe('Enfoque de esta semana según periodización.'),
    hrv_guidance: z.string().optional().describe('Regla corta de auto-regulación por VFC/readiness al despertar el día de calidad (verde/ámbar/rojo): qué hacer con la sesión dura según cómo amanezcas. Máx 30 palabras. Usa los anclajes de readiness del contexto.'),
    stats: z.object({
      total_dist_km: z.number().describe('Distancia total estimada en km.'),
      total_time_min: z.number().describe('Tiempo total estimado en minutos.'),
      distribution: z.object({
        easy: z.number().describe('Porcentaje Zona 1-2 aeróbico (>75).'),
        moderate: z.number().describe('Porcentaje Zona 3 umbral/tempo (~10-15).'),
        hard: z.number().describe('Porcentaje Zona 4-5 VO2max/velocidad (~5-10).'),
      }),
    }),
    schedule: z.array(z.object({
      day: z.string().describe("Nombre del día (ej: 'Lunes')."),
      type: z.string().describe('Categoría de la sesión.'),
      daily_stats: z.object({
        dist: z.string().describe("Distancia (ej: '12 km')."),
        time: z.string().describe("Tiempo estimado (ej: '65 min')."),
      }).optional(),
      summary: z.string().describe('Objetivo de la sesión y zonas de trabajo.'),
      structured_workout: z.array(z.object({
        phase: z.string().describe('Fase del entrenamiento (Calentamiento, Series, Tempo, Bloque Principal, Recuperación, Vuelta a la calma, etc).'),
        duration_min: z.number().describe('Duración en minutos. Si "reps" está presente, es la duración de UNA repetición (el intervalo de trabajo), no del bloque entero.'),
        intensity: z.number().min(1).max(5).describe('Intensidad (1-5).'),
        reps: z.number().optional().describe('Nº de repeticiones si es un bloque de series/intervalos (ej: 3 para "3 × 6′"). Omitir en bloques continuos (calentamiento, rodaje, tempo continuo).'),
        pace: z.string().optional().describe("Ritmo objetivo del bloque, formato 'M:SS/km', TOMADO EXACTAMENTE de RITMOS DE REFERENCIA (series→ancla 'Intervalos/series'; tempo→ancla 'Tempo/umbral'; fácil→ancla rodaje fácil). Prohibido inventar."),
        hr: z.string().optional().describe("Rango de FC objetivo en ppm, formato 'min-max', EXACTO de ZONAS DE FC CALCULADAS."),
        recovery: z.string().optional().describe("Recuperación entre repeticiones si hay 'reps' (ej: '90\" trote suave'). Omitir si no es un bloque de series."),
        description: z.string().describe('Descripción detallada del ejercicio.'),
      })).optional().describe('Detalle de la estructura del entrenamiento.'),
    })),
  }),
};

/** Lista de modelos Gemini de chat disponibles para la key del servidor. */
export async function listGeminiModels() {
  const key = KEYS.gemini();
  if (!key) return [];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  if (!r.ok) return [];
  const j = await r.json();
  const EXCLUDE = /robotics|tts|image|audio|embedding|aqa|vision|nano|gemma|learnlm/i;
  return (j?.models ?? [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .filter(m => m.name?.includes('gemini'))
    .filter(m => !EXCLUDE.test(m.name) && !EXCLUDE.test(m.displayName || ''))
    .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name.replace('models/', '') }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Lista de modelos GRATIS de OpenRouter, leída del catálogo vivo. Filtra por
 * precio 0 (prompt y completion) para no depender de mantener una lista a mano:
 * cuando OpenRouter añade o retira modelos gratis, esto se actualiza solo.
 * Devuelve [] si no hay key configurada (aunque el catálogo es público, sin key
 * el modelo no se podría usar, así que no lo ofrecemos).
 */
export async function listOpenRouterModels() {
  if (!KEYS.openrouter()) return [];
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    if (!r.ok) return [];
    const j = await r.json();
    return (j?.data ?? [])
      .filter(m => typeof m.id === 'string' && /:free$/.test(m.id))
      .filter(m => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
      .map(m => ({
        id: m.id,
        // "qwen/qwen-2.5-72b-instruct:free" → "Qwen: Qwen 2.5 72B · gratis"
        label: `${(m.name || m.id).replace(/\s*\(free\)\s*$/i, '')} · gratis`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

/** Pipe del textStream a una respuesta Node (Express o serverless). */
export async function pipeStream(result, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  for await (const chunk of result.textStream) res.write(chunk);
  res.end();
}
