import { createClient, fetchGarminActivities } from '../_lib/garmin-helpers.js';

export const config = { maxDuration: 60 };

// POST /api/garmin/activities → últimas actividades de Garmin con running dynamics.
// Se guardan luego en user_storage (garmin_activities) y el MCP las correlaciona
// con las carreras de Strava por hora de inicio.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password, limit = 100, enrichedIds, enrichDetail, enrichRuns } = req.body ?? {};
  const budget = [enrichDetail, enrichRuns].find(Number.isFinite); // enrichRuns: nombre antiguo
  if (!username || !password) {
    return res.status(400).json({ error: 'Credenciales requeridas' });
  }

  try {
    const client = await createClient(username, password);
    // `enrichedIds`: garmin_id que el cliente ya tiene enriquecidos (hr_source, laps…).
    // Cubre carreras y bicis: el detalle es lo único que trae el origen de la FC.
    // Se saltan para que cada sync avance sobre el histórico pendiente.
    const activities = await fetchGarminActivities(client, limit, {
      alreadyEnriched: Array.isArray(enrichedIds) ? enrichedIds : null,
      ...(budget != null ? { enrichDetail: budget } : {}),
    });
    const enriched = activities.filter((a) => a.hr_source != null).length;
    res.json({ activities, total: activities.length, enriched_now: enriched });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
