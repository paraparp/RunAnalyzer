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
};

export function geminiKey() {
  return KEYS.gemini();
}

/** Crea el modelo del SDK para el proveedor pedido, con la key del servidor. */
export function resolveModel(provider = 'gemini', model) {
  const key = KEYS[provider]?.();
  if (!key) throw new Error(`Sin API key configurada en el servidor para "${provider}"`);

  switch (provider) {
    case 'groq': {
      const groq = createOpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: key });
      return groq(model);
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

// Esquemas de salida estructurada (antes vivían en los componentes). El cliente
// solo manda el nombre del esquema; aquí se reconstruye con Zod.
export const SCHEMAS = {
  racePrediction: z.object({
    analysis: z.string().describe('Breve párrafo (max 30 palabras) sobre el estado de forma actual del corredor.'),
    predictions: z.array(z.object({
      label: z.string().describe('Distancia de la carrera (ej: 5K, 10K).'),
      time: z.string().describe('Tiempo estimado en formato MM:SS o H:MM:SS.'),
      pace: z.string().describe('Ritmo estimado en formato M:SS /km.'),
      confidence: z.enum(['Alta', 'Media', 'Baja']).describe('Nivel de confianza en la predicción.'),
    })).describe('Lista de predicciones para distancias estándar.'),
  }),
  plan: z.object({
    analysis: z.string().describe('Análisis breve (max 60 palabras) del estado del corredor.'),
    weekly_summary: z.string().describe('Enfoque de esta semana según periodización.'),
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
        phase: z.string().describe('Fase del entrenamiento (Calentamiento, Bloque Principal, etc).'),
        duration_min: z.number().describe('Duración en minutos.'),
        intensity: z.number().min(1).max(5).describe('Intensidad (1-5).'),
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

/** Pipe del textStream a una respuesta Node (Express o serverless). */
export async function pipeStream(result, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  for await (const chunk of result.textStream) res.write(chunk);
  res.end();
}
