// Cliente de IA: habla con los endpoints /api/ai/* (servidor), que son quienes
// tienen las API keys. Así las claves de Gemini/Groq/Anthropic ya no viajan en
// el bundle del navegador. Cada petición lleva el JWT de Supabase para que el
// servidor solo atienda a usuarios autenticados (evita abuso de cuota).
import { supabase } from '../lib/supabase';

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
 * Igual que generateAIObject pero con cadena de proveedores: intenta Gemini y,
 * si falla (p. ej. 429 de cuota), reintenta con Groq. Devuelve el primer objeto
 * válido; si todos fallan, lanza el último error. Respeta AbortSignal.
 */
export async function generateAIObjectWithFallback({ model, prompt, temperature = 0.5, schema, signal }) {
  const chain = [
    { provider: 'gemini', model },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  ];
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

/** Lista de modelos Gemini disponibles (proxy de ListModels). */
export async function fetchGeminiModels(signal) {
  try {
    const res = await fetch('/api/ai/models', { signal, headers: await authHeaders() });
    if (!res.ok) return [];
    const j = await res.json();
    return j?.models ?? [];
  } catch {
    return [];
  }
}
