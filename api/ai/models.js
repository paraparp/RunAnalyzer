import { listGeminiModels } from '../_lib/ai.js';

export default async function handler(_req, res) {
  try {
    const models = await listGeminiModels();
    res.json({ models });
  } catch {
    res.json({ models: [] });
  }
}
