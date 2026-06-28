// Cliente de IA: habla con los endpoints /api/ai/* (servidor), que son quienes
// tienen las API keys. Así las claves de Gemini/Groq/Anthropic ya no viajan en
// el bundle del navegador.

/**
 * Llama al modelo en streaming. Va invocando onChunk(chunk, acumulado) según
 * llega el texto. Devuelve el texto completo. Admite AbortSignal.
 */
export async function streamAI({ provider = 'gemini', model, messages, temperature = 0.7, signal }, onChunk) {
  const res = await fetch('/api/ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, messages, temperature }),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Error IA (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* texto plano */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      full += chunk;
      onChunk?.(chunk, full);
    }
  }
  return full;
}

/** Salida estructurada (generateObject) vía servidor. `schema` es el nombre registrado en el servidor. */
export async function generateAIObject({ provider = 'gemini', model, prompt, temperature = 0.5, schema }) {
  const res = await fetch('/api/ai/object', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, prompt, temperature, schema }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Error IA (${res.status})`);
  return data.object;
}

/** Lista de modelos Gemini disponibles (proxy de ListModels). */
export async function fetchGeminiModels(signal) {
  try {
    const res = await fetch('/api/ai/models', { signal });
    if (!res.ok) return [];
    const j = await res.json();
    return j?.models ?? [];
  } catch {
    return [];
  }
}
