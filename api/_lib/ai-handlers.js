// Handlers del proxy de IA. Viven en _lib (no cuentan como función serverless):
// el dispatcher api/ai/[action].js los sirve bajo /api/ai/{stream,object,models}
// en una sola función, por el límite de 12 del plan Hobby de Vercel.
import { generateObject, streamText } from 'ai';
import {
  resolveModel, pipeStream, SCHEMAS, validateAIRequest,
  listGeminiModels, listOpenRouterModels,
} from './ai.js';
import { ensureAuth } from './auth.js';

export async function aiModels(req, res) {
  if (!(await ensureAuth(req, res))) return;
  try {
    const [models, openrouter] = await Promise.all([listGeminiModels(), listOpenRouterModels()]);
    res.json({ models, openrouter });
  } catch {
    res.json({ models: [], openrouter: [] });
  }
}

export async function aiObject(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!(await ensureAuth(req, res))) return;

  const { provider = 'gemini', model, prompt, temperature = 0.5, schema } = req.body ?? {};
  const zodSchema = SCHEMAS[schema];
  if (!zodSchema) return res.status(400).json({ error: `schema desconocido: ${schema}` });
  if (!model || !prompt) return res.status(400).json({ error: 'model y prompt son requeridos' });
  const invalid = validateAIRequest({ provider, model, prompt });
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const { object } = await generateObject({
      model: resolveModel(provider, model),
      schema: zodSchema,
      prompt,
      temperature,
    });
    res.json({ object });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function aiStream(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!(await ensureAuth(req, res))) return;

  const { provider = 'gemini', model, messages, temperature = 0.7 } = req.body ?? {};
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'model y messages son requeridos' });
  }
  const invalid = validateAIRequest({ provider, model, messages });
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const result = streamText({
      model: resolveModel(provider, model),
      messages,
      temperature,
      maxRetries: 0,
    });
    await pipeStream(result, res);
  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    res.status(500).json({ error: e.message });
  }
}
