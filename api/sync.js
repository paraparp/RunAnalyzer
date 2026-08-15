// ============================================================================
// /api/sync — sincronización programada del cache que leen las tools del MCP.
//
// Es el CARRIL CARO de mcp-sync: login en Garmin, actividades con running
// dynamics, salud/sueño y el backlog de enriquecido de Strava. Son decenas de
// peticiones a terceros: no pueden colgar de una tool del MCP, así que viven aquí
// y las dispara el cron (ver `crons` en vercel.json). Con esto corriendo, el
// carril barato del MCP encuentra el cache ya fresco y no hace trabajo extra.
//
// Auth: cabecera `Authorization: Bearer $CRON_SECRET` (Vercel Cron la manda sola
// si la variable existe). Sin CRON_SECRET configurado se rechaza todo: este
// endpoint mueve credenciales de terceros y no puede quedar abierto.
// ============================================================================
import { runFullSync, listSyncableUsers } from './_lib/mcp-sync.js';

// El sync completo de un usuario (Garmin + backlog) puede irse a minutos.
export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'Falta CRON_SECRET en el servidor' });
  const header = req.headers.authorization || '';
  if (header !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  // `?user=<uuid>` sincroniza uno solo; `?force=1` ignora los TTL.
  const user = req.query?.user || null;
  const force = req.query?.force === '1' || req.query?.force === 'true';
  const backfill = req.query?.backfill !== '0';

  try {
    const users = user ? [user] : await listSyncableUsers();
    const results = [];
    // En serie: cada usuario hace login en Garmin y varias decenas de requests.
    // En paralelo se dispararían los rate limits de Strava y Garmin a la vez.
    for (const id of users) {
      try {
        results.push(await runFullSync(id, { force, backfill }));
      } catch (e) {
        results.push({ userId: id, error: e.message });
      }
    }
    res.json({ users: users.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
