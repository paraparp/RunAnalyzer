// Handlers del proxy de IA. Viven en _lib (no cuentan como función serverless):
// el dispatcher api/ai/[action].js los sirve bajo /api/ai/{stream,object,models}
// en una sola función, por el límite de 12 del plan Hobby de Vercel.
// stream y object los da @paraparp/ai-kit; /models conserva el formato de la app.
import { createAIServer } from '@paraparp/ai-kit/server';
import { buildChatTools } from './chat-tools.js';
import { PROVIDERS, SCHEMAS, listGeminiModels, listOpenRouterModels } from './ai.js';
import { ensureAuth, getUserFromReq } from './auth.js';

const ai = createAIServer({
  providers: PROVIDERS,
  schemas: SCHEMAS,
  auth: getUserFromReq,
  // Chat con herramientas: el modelo consulta los datos del usuario (lectura) en varias
  // rondas antes de responder. Máx. 5 pasos (limits.maxSteps) para no agotar los 60 s.
  tools: (user) => buildChatTools(user.id, {
    onCall: (name, args) => console.log(`[ai/stream] tool ${name} ${JSON.stringify(args).slice(0, 160)}`),
  }),
  // Guardarraíles previos de la app (los de ai-kit por defecto coinciden).
  limits: { maxPromptChars: 150_000, maxMessages: 50, maxImages: 4, maxSteps: 5 },
});

export const aiStream = ai.handlers.stream;
export const aiObject = ai.handlers.object;

export async function aiModels(req, res) {
  if (!(await ensureAuth(req, res))) return;
  try {
    const [models, openrouter] = await Promise.all([listGeminiModels(), listOpenRouterModels()]);
    res.json({ models, openrouter });
  } catch {
    res.json({ models: [], openrouter: [] });
  }
}
