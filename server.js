import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { stravaToken } from './api/_lib/strava-oauth.js';
import { toDateStr } from './api/_lib/garmin-helpers.js';
import aiStream from './api/ai/stream.js';
import aiObject from './api/ai/object.js';
import aiModels from './api/ai/models.js';
import garminLogin from './api/garmin/login.js';
import garminHealthStream from './api/garmin/health/stream.js';
import garminHealthRecent from './api/garmin/health/recent.js';
import pkg from 'garmin-connect';
const { GarminConnect } = pkg;

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// La persistencia de datos vive ahora en Supabase (por usuario, con RLS), del
// lado del cliente. Este servidor es solo un proxy de Garmin/Strava, sin estado.
//
// Los endpoints son los MISMOS handlers que despliega Vercel bajo `api/`: aquí
// solo se montan en Express, que extiende la API req/res de Node que esperan.
// Lo único propio del entorno de desarrollo es la sesión de Garmin cacheada de
// abajo, que se inyecta en los handlers de Garmin.

// ---------------------------------------------------------------------------
// Garmin session — única parte dev-only: cachea el login 55 min en vez de
// autenticar en cada request (los handlers de `api/` usan `createClient`, que
// hace login siempre porque cada invocación serverless arranca en frío).
// ---------------------------------------------------------------------------
let gc = null;
let lastLogin = null;
const SESSION_TTL_MS = 55 * 60 * 1000;

async function getClient(username, password) {
  const now = Date.now();
  if (gc && lastLogin && (now - lastLogin) < SESSION_TTL_MS) return gc;
  gc = new GarminConnect({ username, password });
  await gc.login(username, password);
  lastLogin = Date.now();
  return gc;
}

/** Invalida la sesión cacheada: el siguiente request vuelve a hacer login. */
const dropSession = () => { gc = null; };

/** Monta un handler de `api/` inyectándole la sesión cacheada de desarrollo. */
const withCachedSession = (handler) =>
  (req, res) => handler(req, res, { getClient, onError: dropSession });

// ---------------------------------------------------------------------------
// Strava token proxy — el client_secret vive solo en el servidor.
// ---------------------------------------------------------------------------
app.post('/api/strava/token', (req, res) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'code requerido' });
  stravaToken({ code, grant_type: 'authorization_code' }, res);
});

app.post('/api/strava/refresh', (req, res) => {
  const { refresh_token: refreshToken } = req.body ?? {};
  if (!refreshToken) return res.status(400).json({ error: 'refresh_token requerido' });
  stravaToken({ refresh_token: refreshToken, grant_type: 'refresh_token' }, res);
});

// ---------------------------------------------------------------------------
// IA — proxy con las API keys del lado servidor (no en el bundle).
// ---------------------------------------------------------------------------
app.post('/api/ai/stream', aiStream);
app.post('/api/ai/object', aiObject);
app.get('/api/ai/models', aiModels);

// ---------------------------------------------------------------------------
// Garmin
// ---------------------------------------------------------------------------
app.post('/api/garmin/login', withCachedSession(garminLogin));
app.post('/api/garmin/health/stream', withCachedSession(garminHealthStream));
app.post('/api/garmin/health/recent', withCachedSession(garminHealthRecent));

// POST /api/garmin/debug — inspecciona la respuesta cruda de Garmin para una
// fecha. Solo desarrollo: no existe como función serverless.
app.post('/api/garmin/debug', async (req, res) => {
  const { username, password, date } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credenciales requeridas' });
  const dateStr = date ?? toDateStr(new Date());
  try {
    const client = await getClient(username, password);
    const out = { dateStr, hr: null, hrv_service: null, sleep: null };

    try { out.hr = await client.getHeartRate(new Date(dateStr)); } catch (e) { out.hr = { error: e.message }; }
    try {
      const r = await client.client.get(`https://connectapi.garmin.com/hrv-service/hrv/${dateStr}`);
      out.hrv_service = r?.data ?? r;
    } catch (e) { out.hrv_service = { error: e.message }; }
    try { out.sleep = await client.getSleepData(new Date(dateStr)); } catch (e) { out.sleep = { error: e.message }; }

    res.json(out);
  } catch (e) {
    dropSession();
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Garmin/Strava proxy running on http://localhost:${PORT}`);
});
