import { streamText } from 'ai';
import { resolveModel, pipeStream } from '../_lib/ai.js';
import { ensureAuth } from '../_lib/auth.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!(await ensureAuth(req, res))) return;

  const { provider = 'gemini', model, messages, temperature = 0.7 } = req.body ?? {};
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'model y messages son requeridos' });
  }

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
