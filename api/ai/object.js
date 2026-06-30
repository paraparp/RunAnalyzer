import { generateObject } from 'ai';
import { resolveModel, SCHEMAS } from '../_lib/ai.js';
import { ensureAuth } from '../_lib/auth.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!(await ensureAuth(req, res))) return;

  const { provider = 'gemini', model, prompt, temperature = 0.5, schema } = req.body ?? {};
  const zodSchema = SCHEMAS[schema];
  if (!zodSchema) return res.status(400).json({ error: `schema desconocido: ${schema}` });
  if (!model || !prompt) return res.status(400).json({ error: 'model y prompt son requeridos' });

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
