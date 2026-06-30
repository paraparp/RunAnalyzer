import { listGeminiModels } from '../_lib/ai.js';
import { ensureAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (!(await ensureAuth(req, res))) return;
  try {
    const models = await listGeminiModels();
    res.json({ models });
  } catch {
    res.json({ models: [] });
  }
}
