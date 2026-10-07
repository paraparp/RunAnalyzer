// ============================================================================
// /api/garmin/metrics — lecturas en vivo de Garmin para la app.
//
// Un solo endpoint con `kind` a propósito: el plan Hobby de Vercel limita a 12
// funciones serverless y cada fichero de /api cuenta como una. Misma identidad
// que /api/garmin/workouts: sesión de Supabase y credenciales leídas server-side.
//
//   GET ?kind=weight&days=365  → { from, to, count, weights: [...] }
//   GET ?kind=lactate&from=…   → { latest: { hr, speed_ms, pace, date }, history? }
// ============================================================================
import { ensureAuth } from '../_lib/auth.js';
import { getWeightHistory, getLactateThreshold } from '../_lib/garmin-live.js';

export const config = { maxDuration: 30 };

const NO_CREDS = /credenciales de Garmin/i;

const KINDS = {
  weight: (userId, q) => getWeightHistory(userId, { days: q.days }),
  lactate: (userId, q) => getLactateThreshold(userId, { from: q.from, to: q.to }),
};

export default async function handler(req, res) {
  const user = await ensureAuth(req, res);
  if (!user) return;
  if (req.method !== 'GET') return res.status(405).end();

  const run = KINDS[req.query?.kind];
  if (!run) return res.status(400).json({ error: `kind debe ser uno de: ${Object.keys(KINDS).join(', ')}` });

  try {
    return res.json(await run(user.id, req.query));
  } catch (e) {
    const status = NO_CREDS.test(e?.message || '') ? 400 : 502;
    return res.status(status).json({ error: e?.message || 'Error leyendo Garmin.' });
  }
}
