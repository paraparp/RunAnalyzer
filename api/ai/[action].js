// Dispatcher de IA: /api/ai/stream, /api/ai/object y /api/ai/models en una sola
// función serverless (ahorra funciones frente al límite del plan Hobby).
import { aiStream, aiObject, aiModels } from '../_lib/ai-handlers.js';

export const config = { maxDuration: 60 };

const HANDLERS = { stream: aiStream, object: aiObject, models: aiModels };

export default function handler(req, res) {
  const fn = HANDLERS[req.query?.action];
  if (!fn) return res.status(404).json({ error: 'Acción no soportada' });
  return fn(req, res);
}
