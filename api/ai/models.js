import { listGeminiModels, listOpenRouterModels } from '../_lib/ai.js';
import { ensureAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (!(await ensureAuth(req, res))) return;
  try {
    const [models, openrouter] = await Promise.all([listGeminiModels(), listOpenRouterModels()]);
    res.json({ models, openrouter });
  } catch {
    res.json({ models: [], openrouter: [] });
  }
}
