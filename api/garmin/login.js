import { createClient } from '../_lib/garmin-helpers.js';

/** Ver la nota de inyección de cliente en `health/stream.js`. */
export default async function handler(req, res, { getClient = createClient, onError } = {}) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Credenciales requeridas' });
  }

  try {
    await getClient(username, password);
    res.json({ ok: true });
  } catch (e) {
    onError?.(e);
    res.status(401).json({ error: 'Login fallido: ' + e.message });
  }
}
