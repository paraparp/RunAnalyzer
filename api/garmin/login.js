import { createClient } from '../_lib/garmin-helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Credenciales requeridas' });
  }

  try {
    await createClient(username, password);
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ error: 'Login fallido: ' + e.message });
  }
}
