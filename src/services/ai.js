// Cliente de IA: habla con los endpoints /api/ai/* (servidor), que son quienes
// tienen las API keys. Así las claves de Gemini/Groq/Anthropic ya no viajan en
// el bundle del navegador. Cada petición lleva el JWT de Supabase para que el
// servidor solo atienda a usuarios autenticados (evita abuso de cuota).
import { supabase } from '../lib/supabase';

// ── Registro de proveedores/modelos ─────────────────────────────────────────
// Un único sitio del que tiran el selector (empresa → modelos), las cadenas de
// fallback y los valores por defecto. Añadir un proveedor aquí lo propaga a todo.

export const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Modelo gratis de Z.ai (GLM). El servidor solo acepta "glm-*-flash" (nivel
// gratuito), así que si cambia el id basta con tocar esta línea.
export const ZAI_MODEL = 'glm-4.5-flash';

// Modelos gratis de OpenRouter usados como fallback. El servidor solo acepta ids
// que terminan en ":free" (coste $0), así que ampliar esta lista nunca puede
// facturar. El catálogo gratis ROTA a menudo: para el selector manda
// listOpenRouterModels() (lista viva); estos son solo el fallback. gpt-oss-20b es
// el más fiable (sirve para texto Y salida estructurada); nemotron es el backup
// estructurado (correcto pero lento).
export const OPENROUTER_FALLBACK_MODELS = [
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

// Lista Gemini de reserva cuando el endpoint ListModels no responde.
export const FALLBACK_GEMINI = [
  { id: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite · menos tokens' },
  { id: 'gemini-3.5-flash', label: '3.5 Flash · mejor calidad' },
  { id: 'gemini-2.5-flash', label: '2.5 Flash · equilibrado' },
];

// Modelos fijos por proveedor (los "libres" que el guardarraíl del servidor
// permite). Gemini y OpenRouter llegan por API viva; estos son estáticos.
const STATIC_PROVIDER_MODELS = {
  zai: [{ id: ZAI_MODEL, label: 'GLM-4.5-Flash · gratis' }],
  groq: [{ id: GROQ_MODEL, label: 'Llama 3.3 70B · gratis' }],
};

export const PROVIDER_LABELS = {
  gemini: 'Google Gemini',
  zai: 'Z.ai (GLM)',
  groq: 'Groq',
  openrouter: 'OpenRouter (gratis)',
};

// El valor del <select> codifica proveedor + modelo como "provider|model" (los
// ids de modelo no contienen "|"). Un valor "pelado" (sin "|") se asume Gemini,
// para no romper los ids ya guardados en cloudStorage.
export function toModelValue(provider, model) {
  return `${provider}|${model}`;
}
export function parseModelValue(value) {
  if (typeof value !== 'string' || !value.includes('|')) {
    return { provider: 'gemini', model: value || DEFAULT_GEMINI_MODEL };
  }
  const i = value.indexOf('|');
  return { provider: value.slice(0, i), model: value.slice(i + 1) };
}
export function normalizeModelValue(value) {
  const { provider, model } = parseModelValue(value);
  return toModelValue(provider, model);
}

// Grupos para el selector "empresa → modelos". `lists` trae las listas vivas de
// Gemini y OpenRouter; el resto son estáticas. Se omiten los grupos vacíos.
export function buildModelGroups({ gemini, openrouter } = {}) {
  const geminiModels = gemini?.length ? gemini : FALLBACK_GEMINI;
  const raw = [
    { provider: 'gemini', models: geminiModels },
    { provider: 'zai', models: STATIC_PROVIDER_MODELS.zai },
    { provider: 'groq', models: STATIC_PROVIDER_MODELS.groq },
    { provider: 'openrouter', models: openrouter ?? [] },
  ];
  return raw
    .filter(g => g.models.length)
    .map(g => ({
      provider: g.provider,
      label: PROVIDER_LABELS[g.provider] ?? g.provider,
      options: g.models.map(m => ({ value: toModelValue(g.provider, m.id), label: m.label })),
    }));
}

// Cadena de proveedores para un primario dado: el elegido primero, seguido del
// resto de proveedores gratuitos como fallback (sin duplicar exactamente el par
// elegido). Orden pensado por FIABILIDAD, no velocidad, porque el fallback solo
// entra cuando el primario falla: primero gpt-oss-20b (único gratis que hace
// texto Y estructurado), luego Z.ai/Groq (solo chat, pero rápidos) y por último
// el backup estructurado de OpenRouter.
export function buildProviderChain({ provider = 'gemini', model } = {}) {
  const orName = (m) => `OpenRouter ${m.split('/').pop().replace(':free', '')}`;
  const [orUniversal, ...orRest] = OPENROUTER_FALLBACK_MODELS;
  const fallback = [
    { provider: 'openrouter', model: orUniversal, name: orName(orUniversal) },
    { provider: 'zai', model: ZAI_MODEL, name: 'Z.ai GLM Flash' },
    { provider: 'groq', model: GROQ_MODEL, name: 'Groq Llama' },
    ...orRest.map(m => ({ provider: 'openrouter', model: m, name: orName(m) })),
  ];
  const primary = { provider, model, name: PROVIDER_LABELS[provider] ?? provider };
  return [primary, ...fallback.filter(s => !(s.provider === provider && s.model === model))];
}

async function authHeaders(extra = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/**
 * Llama al modelo en streaming. Va invocando onChunk(chunk, acumulado) según
 * llega el texto. Devuelve el texto completo. Admite AbortSignal.
 *
 * Watchdog: si el servidor no responde en `connectTimeoutMs` o el stream se
 * queda mudo más de `idleTimeoutMs` entre chunks, se aborta y se lanza un
 * Error normal (no AbortError) para que las cadenas de fallback pasen al
 * siguiente proveedor en vez de quedarse colgadas indefinidamente.
 */
export async function streamAI(
  { provider = 'gemini', model, messages, temperature = 0.7, signal, connectTimeoutMs = 30000, idleTimeoutMs = 25000 },
  onChunk
) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const ctrl = new AbortController();
  const onCallerAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  let timedOut = false;
  let timer;
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  };
  arm(connectTimeoutMs);

  try {
    const res = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ provider, model, messages, temperature }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      let msg = `Error IA (${res.status})`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* texto plano */ }
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    arm(idleTimeoutMs);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      arm(idleTimeoutMs);
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        full += chunk;
        onChunk?.(chunk, full);
      }
    }
    return full;
  } catch (e) {
    // Distingue el abort del caller (se propaga tal cual) del watchdog (falla
    // "normal" que las cadenas de proveedores pueden capturar y saltar).
    if (timedOut && !signal?.aborted) {
      throw new Error(`Timeout: ${provider} dejó de responder`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** Salida estructurada (generateObject) vía servidor. `schema` es el nombre registrado en el servidor. */
export async function generateAIObject({ provider = 'gemini', model, prompt, temperature = 0.5, schema, signal }) {
  const res = await fetch('/api/ai/object', {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ provider, model, prompt, temperature, schema }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Error IA (${res.status})`);
  return data.object;
}

/**
 * Igual que generateAIObject pero con cadena de proveedores: intenta el primario
 * elegido y, si falla (p. ej. 429 de cuota), recorre el resto de proveedores
 * gratuitos. Devuelve el primer objeto válido; si todos fallan, lanza el último
 * error del primario. Respeta AbortSignal.
 */
export async function generateAIObjectWithFallback({ provider = 'gemini', model, prompt, temperature = 0.5, schema, signal }) {
  const chain = buildProviderChain({ provider, model });
  let primaryErr;
  for (const step of chain) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await generateAIObject({ ...step, prompt, temperature, schema, signal });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      // Conserva el error del proveedor principal para mensajes coherentes
      // (429/401 de Gemini) aunque el fallback también falle.
      if (!primaryErr) primaryErr = e;
    }
  }
  throw primaryErr ?? new Error('No se pudo generar la respuesta.');
}

/** Listas de modelos disponibles (proxy de /api/ai/models): { gemini, openrouter }. */
export async function fetchModelLists(signal) {
  try {
    const res = await fetch('/api/ai/models', { signal, headers: await authHeaders() });
    if (!res.ok) return { gemini: [], openrouter: [] };
    const j = await res.json();
    return { gemini: j?.models ?? [], openrouter: j?.openrouter ?? [] };
  } catch {
    return { gemini: [], openrouter: [] };
  }
}

/** Grupos "empresa → modelos" listos para el selector (incluye reserva Gemini). */
export async function fetchModelGroups(signal) {
  return buildModelGroups(await fetchModelLists(signal));
}
