import { createClient, fetchGarminActivities } from '../_lib/garmin-helpers.js';

export const config = { maxDuration: 60 };

// POST /api/garmin/activities → últimas actividades de Garmin con running dynamics.
// Se guardan luego en user_storage (garmin_activities) y el MCP las correlaciona
// con las carreras de Strava por hora de inicio.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password, limit = 100 } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Credenciales requeridas' });
  }

  try {
    const client = await createClient(username, password);
    const activities = await fetchGarminActivities(client, limit);
    res.json({ activities, total: activities.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
