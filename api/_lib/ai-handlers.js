// Handlers del proxy de IA. Viven en _lib (no cuentan como función serverless):
// el dispatcher api/ai/[action].js los sirve bajo /api/ai/{stream,object,models}
// en una sola función, por el límite de 12 del plan Hobby de Vercel.
import { generateObject, streamText, stepCountIs } from 'ai';
import { buildChatTools } from './chat-tools.js';
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
      // Sin reintentos: un 429/503 del pool gratis no se arregla en 2 s, y el
      // cliente ya salta al siguiente proveedor de buildProviderChain.
      maxRetries: 0,
      // Groq aplica el modo estricto de JSON Schema y rechaza los campos
      // .optional() de los esquemas; sin strict los acepta (Zod valida igual).
      providerOptions: { openai: { strictJsonSchema: false } },
    });
    res.json({ object });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function aiStream(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = await ensureAuth(req, res);
  if (!user) return;

  const { provider = 'gemini', model, messages, temperature = 0.7, tools: wantTools = false } = req.body ?? {};
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'model y messages son requeridos' });
  }
  const invalid = validateAIRequest({ provider, model, messages });
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    // Chat con herramientas: el modelo consulta los datos del usuario (lectura)
    // en varias rondas antes de responder. Máx. 5 pasos para no agotar los 60 s.
    const toolOpts = wantTools === true
      ? {
          tools: buildChatTools(user.id, {
            onCall: (name, args) => console.log(`[ai/stream] tool ${name} ${JSON.stringify(args).slice(0, 160)}`),
          }),
          stopWhen: stepCountIs(5),
        }
      : {};
    const result = streamText({
      model: resolveModel(provider, model),
      messages,
      temperature,
      maxRetries: 0,
      ...toolOpts,
    });
    await pipeStream(result, res);
  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    res.status(500).json({ error: e.message });
  }
}
