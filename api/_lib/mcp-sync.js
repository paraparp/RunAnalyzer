// ============================================================================
// mcp-sync — mantiene fresco el cache de Supabase (`user_storage`) que leen las
// tools del MCP.
//
// El problema: ese cache lo llenaba SOLO el front (App.jsx → cloudStorage). Si el
// usuario no abría la web, el MCP servía datos rancios: el entreno de esta mañana
// no existía para Claude.
//
// La solución tiene DOS CARRILES, para que refrescar no se pague en cada request:
//
//   A) Carril barato, dentro de la request (`ensureFresh`). Antes de ejecutar una
//      tool que lee cache, mira si toca comprobar Strava. Casi siempre NO toca y
//      cuesta 0 (ni una I/O: el vencimiento se memoiza en el proceso). Cuando toca,
//      es un DELTA: se pide la página 1 del listado de Strava y se para en cuanto
//      aparece una actividad ya conocida. Sin novedades no se reescribe el blob
//      multi-MB, solo se sella la marca de tiempo. Coste típico: ~300 ms una vez
//      cada TTL, no una vez por tool.
//
//   B) Carril caro, fuera de la request (`runFullSync`, lo llama /api/sync por cron).
//      Login en Garmin, actividades con running dynamics, salud/sueño y el backlog
//      de enriquecido de Strava (splits, laps, best_efforts, flat_efforts). Son
//      decenas de requests: no pueden colgar de una tool. Con el cron corriendo, el
//      carril A encuentra todo fresco y no hace nada.
//
// Garantías: todas las mezclas son por id (idempotentes), así que un sync duplicado
// o cortado a medias no corrompe nada; y NUNCA se sobrescribe un histórico bueno con
// una respuesta vacía de un proveedor caído.
// ============================================================================
import {
  readKey, readKeyFresh, writeKey, invalidateKey, listUsersWithKey,
} from './mcp-store.js';
import { getGarminClientFor } from './garmin-session.js';
import {
  fetchGarminActivities, fetchHrvBulk, fetchBodyBatteryBulk, fetchSleepBulk,
  fetchDayData, toDateStr,
} from './garmin-helpers.js';
import { computeFlatEfforts } from '../../src/lib/flatEfforts.js';

// ── Política de frescura ────────────────────────────────────────────────────
const STATE_KEY = 'mcp_sync_state';

const STRAVA_TTL_MS = 3 * 60 * 1000;         // cada cuánto se sondea Strava en la request
// Cada cuánto el sondeo se sustituye por un delta completo (página 1 del listado).
// El sondeo `after=` solo ve lo que EMPIEZA después de la última guardada, así que se
// le escapa una subida con fecha retrasada (subes hoy la carrera de ayer). Este pase
// periódico las recoge.
const FULL_DELTA_MS = 60 * 60 * 1000;
const PROBE_PER_PAGE = 5;                    // el sondeo solo necesita saber si hay algo
const GARMIN_TTL_MS = 6 * 60 * 60 * 1000;    // Garmin en el cron
// Garmin en el carril de request. Es el respaldo para cuando NO hay cron: cada 4 h,
// la primera tool que llegue dispara un sync ligero de Garmin. Login + enriquecido
// tardan más que el techo de espera, así que esa consulta responde con el cache y el
// sync termina por detrás: el dato entra para la siguiente.
const GARMIN_HARD_TTL_MS = 4 * 60 * 60 * 1000;
const ERROR_BACKOFF_MS = 15 * 60 * 1000;     // tras un fallo, no reintentar en cada tool
const LOCK_MS = 3 * 60 * 1000;               // vida del lock entre instancias
const REQUEST_BUDGET_MS = 8000;              // lo máximo que una tool espera al sync

// Vencimiento memoizado por usuario: mientras no llegue, `ensureFresh` no hace NI
// UNA lectura a Supabase. Es lo que hace que el coste por tool sea realmente cero.
const _nextCheck = new Map();  // userId -> epoch ms
// Single-flight dentro del mismo lambda: el modelo dispara varias tools en paralelo
// y todas entrarían a sincronizar a la vez.
const _inflight = new Map();   // userId -> Promise

const now = () => Date.now();

// ── Estado del sync ─────────────────────────────────────────────────────────
async function readState(userId) {
  const s = await readKeyFresh(userId, STATE_KEY);
  return s && typeof s === 'object' ? s : {};
}

async function writeState(userId, patch) {
  const prev = await readKey(userId, STATE_KEY) || {};
  const next = { ...prev, ...patch, updated_at: new Date().toISOString() };
  await writeKey(userId, STATE_KEY, next);
  return next;
}

/** Marca de un carril: `{ at, ok, error, added }`. `at` = último intento. */
const mark = (ok, extra = {}) => ({ at: now(), ok, error: null, ...extra });

/**
 * Estado del carril de Strava tras un pase. Conserva lo que hace barato el sondeo
 * (`after`, `token`) en vez de reemplazar el carril entero: perderlos obligaría a
 * volver a abrir el blob multi-MB en la siguiente comprobación.
 */
function laneState(prev, res = {}) {
  return {
    ...prev,
    ...mark(true, { added: res.added ?? 0 }),
    ...(res.after ? { after: res.after } : {}),
    ...(res.token ? { token: res.token } : {}),
    ...(res.full ? { full_at: now() } : {}),
  };
}

// ── Strava ──────────────────────────────────────────────────────────────────
const STRAVA_API = 'https://www.strava.com/api/v3';
const RUNNING_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

// Mismos campos que descarta el front (slimActivity en App.jsx): el detalle completo
// de Strava infla el blob con datos que ninguna tool lee.
const HEAVY_DETAIL_FIELDS = [
  'segment_efforts', 'splits_standard', 'similar_activities',
  'description', 'photos', 'stats_visibility', 'available_zones', 'laps_raw',
];

function slimActivity(act, fallback = {}) {
  const slim = { ...act };
  for (const k of HEAVY_DETAIL_FIELDS) delete slim[k];
  const summaryPolyline = act.map?.summary_polyline || fallback.map?.summary_polyline;
  if (act.map || summaryPolyline) {
    slim.map = { id: act.map?.id ?? fallback.map?.id, summary_polyline: summaryPolyline };
  }
  return slim;
}

async function stravaGet(path, accessToken) {
  const r = await fetch(`${STRAVA_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (r.status === 429) throw new Error('Strava rate limit (429): reintentar más tarde');
  if (r.status === 401) throw new Error('Strava 401: token inválido');
  if (!r.ok) throw new Error(`Strava ${path}: HTTP ${r.status}`);
  return r.json();
}

/** Renueva el access token contra Strava (el secret solo existe en el servidor). */
async function refreshStravaToken(refreshToken) {
  const clientId = process.env.STRAVA_CLIENT_ID || process.env.VITE_STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET en el servidor');
  }
  const r = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Strava refresh: ${data?.message || r.status}`);
  return data;
}

/**
 * Tokens de Strava para sondear, SIN abrir `stravaData`. El blob pesa varios MB y
 * leerlo en cada comprobación costaba más que la propia llamada a Strava; aquí se
 * cachean en la fila pequeña del estado y solo se cae al blob la primera vez.
 * Devuelve `{ access, refresh, expires, rotated }` o null si no hay con qué hablar.
 */
async function stravaTokens(userId, lane = {}) {
  let t = lane.token;
  if (!t?.access) {
    const blob = await readKeyFresh(userId, 'stravaData');
    if (!blob?.accessToken) return null;
    t = { access: blob.accessToken, refresh: blob.refreshToken, expires: blob.expiresAt };
  }
  // 60 s de margen: un token que caduca a mitad del sync provoca un 401 evitable.
  if (!t.expires || now() / 1000 < t.expires - 60) return { ...t, rotated: false };
  if (!t.refresh) return null;
  const r = await refreshStravaToken(t.refresh);
  return {
    access: r.access_token,
    refresh: r.refresh_token || t.refresh,
    expires: r.expires_at,
    rotated: true,
  };
}

/**
 * Devuelve los tokens rotados al blob: el front los lee de ahí. Es una escritura
 * multi-MB, pero solo ocurre cuando Strava rota el token (unas 4 veces al día).
 */
async function persistTokens(userId, tok) {
  const blob = await readKeyFresh(userId, 'stravaData');
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return;
  await writeKey(userId, 'stravaData', {
    ...blob, accessToken: tok.access, refreshToken: tok.refresh, expiresAt: tok.expires,
  });
}

/** Epoch (s) de la actividad más reciente de una lista: es el `after` del sondeo. */
function newestEpoch(activities) {
  let max = 0;
  for (const a of activities) {
    const t = Date.parse(a?.start_date);
    if (!Number.isNaN(t) && t > max) max = t;
  }
  return max ? Math.floor(max / 1000) : null;
}

/** Campos del RESUMEN que, si cambian, justifican reescribir el blob (edición en Strava). */
const SUMMARY_FIELDS = ['name', 'type', 'sport_type', 'distance', 'moving_time', 'elapsed_time', 'start_date'];

/**
 * Delta de Strava: baja páginas del listado hasta encontrar solape con lo guardado
 * y mezcla. Solo escribe si hay algo nuevo/cambiado o si rotaron los tokens.
 *
 * @param {object} opts.detailBudget  actividades nuevas a las que pedir el detalle
 *                                    (splits_metric/laps/best_efforts) en esta pasada.
 */
async function syncStrava(userId, { token, detailBudget = 3, perPage = 30, maxPages = 4 } = {}) {
  const blob = await readKeyFresh(userId, 'stravaData');
  if (!blob || typeof blob !== 'object') return { skipped: 'sin-stravaData' };
  const stored = Array.isArray(blob.activities) ? blob.activities
    : (Array.isArray(blob) ? blob : null);
  if (!stored) return { skipped: 'sin-actividades' };

  const tok = token || await stravaTokens(userId, {});
  if (!tok) return { skipped: 'sin-token' };
  const accessToken = tok.access;

  const byId = new Map(stored.map((a) => [a.id, a]));
  const fetched = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await stravaGet(`/athlete/activities?per_page=${perPage}&page=${page}`, accessToken);
    if (!Array.isArray(batch) || !batch.length) break;
    fetched.push(...batch);
    // Solape: a partir de aquí ya lo tenemos todo. Sin este corte cada sync
    // repaginaría el histórico entero.
    if (batch.some((a) => byId.has(a.id))) break;
  }

  const added = [];
  let changed = 0;
  for (const a of fetched) {
    const prev = byId.get(a.id);
    if (!prev) { byId.set(a.id, slimActivity(a)); added.push(a.id); continue; }
    // Actividad ya conocida: solo se toca si el resumen cambió de verdad (renombrada,
    // recortada, cambiada de tipo). Si no, no ensuciamos el blob.
    if (SUMMARY_FIELDS.some((k) => a[k] !== undefined && a[k] !== prev[k])) {
      byId.set(a.id, { ...prev, ...slimActivity(a, prev) });
      changed++;
    }
  }

  // Detalle de las nuevas (splits_metric/laps/best_efforts): sin esto `get_activity`
  // devolvería el entreno de hoy sin parciales hasta que el usuario abriera la web.
  let enriched = 0;
  for (const id of added.slice(0, detailBudget)) {
    const act = byId.get(id);
    if (!act || !RUNNING_TYPES.has(act.type) || !(act.distance > 0)) continue;
    try {
      const detail = await stravaGet(`/activities/${id}`, accessToken);
      if (detail?.splits_metric) { byId.set(id, slimActivity(detail, act)); enriched++; }
    } catch (e) {
      console.warn(`[mcp-sync] detalle ${id} falló:`, e.message);
    }
  }

  // `after` se recalcula siempre, incluso sin novedades: es la semilla del sondeo y
  // en el arranque (estado vacío) es justo lo que hay que sembrar.
  const activities = [...byId.values()]
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
  const after = newestEpoch(activities);

  if (!added.length && !changed) {
    return { added: 0, changed: 0, enriched: 0, wrote: false, after, full: true };
  }
  await writeKey(userId, 'stravaData', {
    ...blob,
    accessToken: tok.access, refreshToken: tok.refresh, expiresAt: tok.expires,
    activities, lastFetchDate: new Date().toDateString(),
  });
  return { added: added.length, changed, enriched, wrote: true, after, full: true };
}

/**
 * Comprobación de frescura de Strava. Es el camino que se recorre en la request, así
 * que está optimizado para el caso abrumadoramente más común: NO hay nada nuevo.
 *
 *   sondeo  → `after=<última guardada>&per_page=5`. Sin novedades, Strava devuelve
 *             `[]` y aquí se acaba todo: ni se abre el blob multi-MB ni se escribe
 *             nada más que la marca de tiempo. ~200 ms.
 *   delta   → solo si el sondeo encuentra algo, o cada FULL_DELTA_MS para recoger
 *             las subidas con fecha retrasada que el `after` no ve.
 */
async function refreshStrava(userId, lane = {}, { detailBudget = 3 } = {}) {
  const tok = await stravaTokens(userId, lane);
  if (!tok) return { skipped: 'sin-token' };
  if (tok.rotated) await persistTokens(userId, tok);
  const token = { access: tok.access, refresh: tok.refresh, expires: tok.expires };

  const needFull = !lane.after || !lane.full_at || now() - lane.full_at > FULL_DELTA_MS;
  if (!needFull) {
    const batch = await stravaGet(
      `/athlete/activities?after=${lane.after}&per_page=${PROBE_PER_PAGE}`, tok.access,
    );
    if (!Array.isArray(batch) || !batch.length) {
      return { probe: true, added: 0, wrote: false, after: lane.after, full: false, token };
    }
  }
  return { ...await syncStrava(userId, { token: tok, detailBudget }), token };
}

/**
 * Backlog de enriquecido (carril caro): rellena `flat_efforts` y los parciales que
 * falten en el histórico. Cada actividad son 1-2 requests a Strava, así que va con
 * presupuesto y throttle. Guarda `{}` cuando no hay tramos llanos para no volver a
 * pedir esa actividad nunca más.
 */
async function backfillStrava(userId, { token, splitsBudget = 15, flatBudget = 15 } = {}) {
  const blob = await readKeyFresh(userId, 'stravaData');
  const stored = Array.isArray(blob?.activities) ? blob.activities : null;
  if (!stored) return { skipped: 'sin-stravaData' };
  // El backlog dura minutos: el token tiene que venir ya renovado del pase anterior,
  // no leído del blob (donde puede estar caducado y tumbar todas las peticiones).
  const accessToken = token?.access || blob.accessToken;
  if (!accessToken) return { skipped: 'sin-token' };
  const isRun = (a) => RUNNING_TYPES.has(a.type);

  const byId = new Map(stored.map((a) => [a.id, a]));
  const recentFirst = (a, b) => String(b.start_date).localeCompare(String(a.start_date));
  const needSplits = stored.filter((a) => isRun(a) && a.distance > 0 && !a.splits_metric)
    .sort(recentFirst).slice(0, splitsBudget);
  const needFlat = stored.filter((a) => isRun(a) && a.distance >= 1000 && !a.flat_efforts)
    .sort(recentFirst).slice(0, flatBudget);

  let splits = 0, flat = 0;
  for (const act of needSplits) {
    try {
      const detail = await stravaGet(`/activities/${act.id}`, accessToken);
      if (detail?.splits_metric) { byId.set(act.id, slimActivity(detail, byId.get(act.id))); splits++; }
    } catch (e) { console.warn(`[mcp-sync] splits ${act.id}:`, e.message); }
    await new Promise((r) => setTimeout(r, 400)); // anti rate-limit
  }
  for (const act of needFlat) {
    try {
      const streams = await stravaGet(
        `/activities/${act.id}/streams?keys=time,distance,altitude,heartrate,velocity_smooth&key_by_type=true`,
        accessToken,
      );
      const prev = byId.get(act.id);
      byId.set(act.id, { ...prev, flat_efforts: computeFlatEfforts(streams) || {} });
      flat++;
    } catch (e) { console.warn(`[mcp-sync] flat_efforts ${act.id}:`, e.message); }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!splits && !flat) return { splits: 0, flat: 0, wrote: false };
  // Re-lectura: el backfill dura minutos y el carril A o el front pueden haber
  // añadido actividades entre medias. Se mezcla sobre lo último publicado.
  const latest = await readKeyFresh(userId, 'stravaData');
  const latestList = Array.isArray(latest?.activities) ? latest.activities : stored;
  const merged = latestList.map((a) => {
    const patched = byId.get(a.id);
    return patched ? { ...a, ...patched } : a;
  });
  await writeKey(userId, 'stravaData', { ...(latest || blob), activities: merged });
  return { splits, flat, wrote: true };
}

// ── Garmin: actividades con running dynamics ────────────────────────────────
// Espejo server-side de src/lib/garminActivitiesSync.js (aquel importa cloudStorage,
// que es de navegador). Las dos reglas que se incumplían allí valen igual aquí:
// no sobrescribir con menos de lo que había, y MEZCLAR para no perder el enriquecido.
function mergeGarminActivity(prev, next) {
  if (!prev) return next;
  const merged = { ...prev, ...next };
  for (const k of ['hr_source', 'data_quality', 'laps', 'weather', 'gap_speed_ms']) {
    if (next[k] == null && prev[k] != null) merged[k] = prev[k];
  }
  merged.dynamics = { ...(prev.dynamics || {}), ...(next.dynamics || {}) };
  for (const [k, v] of Object.entries(prev.dynamics || {})) {
    if (merged.dynamics[k] == null && v != null) merged.dynamics[k] = v;
  }
  return merged;
}

async function syncGarminActivities(userId, { limit = 100, enrichRuns = 20 } = {}) {
  const client = await getGarminClientFor(userId);
  const raw = await readKeyFresh(userId, 'garmin_activities');
  const stored = Array.isArray(raw) ? raw : [];
  const incoming = await fetchGarminActivities(client, limit, {
    enrichRuns,
    alreadyEnriched: stored.filter((a) => a?.hr_source != null).map((a) => String(a.garmin_id)),
  });
  // Lista vacía con histórico guardado = respuesta sospechosa: no se toca nada.
  if (!incoming.length && stored.length) return { added: 0, wrote: false, note: 'respuesta vacía' };

  const byId = new Map(stored.map((a) => [String(a.garmin_id), a]));
  let added = 0;
  for (const a of incoming) {
    const id = String(a.garmin_id);
    if (!byId.has(id)) added++;
    byId.set(id, mergeGarminActivity(byId.get(id), a));
  }
  const merged = [...byId.values()]
    .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
  await writeKey(userId, 'garmin_activities', merged);
  return { added, total: merged.length, wrote: true };
}

// ── Garmin: salud (cardíaco diario + sueño semanal) ─────────────────────────
// Mismo pipeline que /api/garmin/health/recent, pero calculando los días que
// FALTAN desde el último registro guardado en vez de rebajar 30 fijos.
function daysMissing(rows, fallback = 30, cap = 90) {
  if (!Array.isArray(rows) || !rows.length) return fallback;
  const last = rows.reduce((max, r) => (r?.date > max ? r.date : max), rows[0]?.date || '');
  const t = new Date(last).getTime();
  if (Number.isNaN(t)) return fallback;
  return Math.max(1, Math.min(Math.ceil((now() - t) / 86400000) + 1, cap));
}

async function syncGarminHealth(userId) {
  const client = await getGarminClientFor(userId);
  const existing = (await readKeyFresh(userId, 'garmin_cardiac_data')) || [];
  const days = daysMissing(Array.isArray(existing) ? existing : []);
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - days + 1);

  const [hrvMap, bbMap, sleepRows] = await Promise.all([
    fetchHrvBulk(client, toDateStr(start), toDateStr(today)),
    fetchBodyBatteryBulk(client, toDateStr(start), toDateStr(today)),
    fetchSleepBulk(client, Math.ceil(days / 7)),
  ]);

  const fresh = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const row = await fetchDayData(client, toDateStr(d), hrvMap, bbMap);
    if (row) fresh.push(row);
    await new Promise((r) => setTimeout(r, 120));
  }

  let wroteCardiac = false;
  if (fresh.length) {
    const byDate = {};
    for (const r of [...(Array.isArray(existing) ? existing : []), ...fresh]) {
      byDate[r.date] = { ...byDate[r.date], ...r };
    }
    const merged = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    await writeKey(userId, 'garmin_cardiac_data', merged);
    wroteCardiac = true;
  }

  let wroteSleep = false;
  if (Array.isArray(sleepRows) && sleepRows.length) {
    const prevSleep = (await readKeyFresh(userId, 'garmin_sleep_data')) || [];
    const byWeek = {};
    for (const r of [...(Array.isArray(prevSleep) ? prevSleep : []), ...sleepRows]) {
      byWeek[r.weekStart] = r;
    }
    const merged = Object.values(byWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    await writeKey(userId, 'garmin_sleep_data', merged);
    wroteSleep = true;
  }
  await writeKey(userId, 'garmin_last_sync', new Date().toLocaleString('es-ES'));
  return { days, cardiac: fresh.length, wroteCardiac, wroteSleep };
}

// ── Orquestación ────────────────────────────────────────────────────────────
const stale = (lane, ttl) => !lane?.at || now() - lane.at > ttl;

/**
 * Lock cooperativo entre instancias (Vercel escala a varios lambdas). No es un
 * mutex fuerte —`user_storage` no da CAS—, pero la ventana de carrera es de
 * milisegundos y todas las mezclas son por id: el peor caso es trabajo duplicado,
 * nunca datos corruptos.
 */
async function withLock(userId, fn) {
  const state = await readState(userId);
  if (state.lock_until && state.lock_until > now()) {
    _nextCheck.set(userId, state.lock_until);
    return { skipped: 'lock' };
  }
  await writeState(userId, { lock_until: now() + LOCK_MS });
  try {
    return await fn(state);
  } finally {
    await writeState(userId, { lock_until: 0 }).catch(() => {});
  }
}

/**
 * Carril A. Se llama antes de cada tool que lee cache. Devuelve rápido o no hace
 * nada; nunca propaga errores (un Garmin caído no puede tumbar una consulta que
 * se puede responder con el cache).
 */
export async function ensureFresh(userId) {
  const due = _nextCheck.get(userId);
  if (due && now() < due) return null;            // camino normal: 0 I/O, 0 latencia
  if (_inflight.has(userId)) return _inflight.get(userId);

  const task = (async () => {
    try {
      return await withLock(userId, async (state) => {
        const out = {};
        const lane = state.strava || {};
        if (stale(lane, STRAVA_TTL_MS)) {
          try {
            out.strava = await refreshStrava(userId, lane, { detailBudget: 3 });
            await writeState(userId, { strava: laneState(lane, out.strava) });
          } catch (e) {
            out.strava = { error: e.message };
            await writeState(userId, { strava: { ...lane, at: now(), ok: false, error: e.message } });
          }
        }
        // Garmin en el carril de request: el respaldo para cuando no hay cron. Con
        // presupuesto MÍNIMO (login + 30 actividades + 5 enriquecidas) porque cuelga
        // de una tool. La salud va detrás y reaprovecha la sesión ya logueada: sin
        // ella, HRV y sueño no se refrescarían nunca por esta vía.
        if (stale(state.garmin, GARMIN_HARD_TTL_MS)) {
          try {
            out.garmin = await syncGarminActivities(userId, { limit: 30, enrichRuns: 5 });
            // Best-effort e independiente: si la salud falla, las actividades que ya
            // se guardaron arriba no se pierden.
            try { out.garmin_health = await syncGarminHealth(userId); }
            catch (e) { out.garmin_health = { error: e.message }; }
            await writeState(userId, { garmin: mark(true, { added: out.garmin.added ?? 0 }) });
          } catch (e) {
            out.garmin = { error: e.message };
            await writeState(userId, { garmin: { at: now(), ok: false, error: e.message } });
          }
        }
        const failed = out.strava?.error || out.garmin?.error;
        _nextCheck.set(userId, now() + (failed ? ERROR_BACKOFF_MS : STRAVA_TTL_MS));
        return out;
      });
    } catch (e) {
      console.warn('[mcp-sync] ensureFresh falló:', e.message);
      _nextCheck.set(userId, now() + ERROR_BACKOFF_MS);
      return { error: e.message };
    } finally {
      _inflight.delete(userId);
    }
  })();

  _inflight.set(userId, task);
  // Techo de espera: si el sync se alarga, la tool responde con lo que hay. La
  // promesa sigue viva y termina de escribir (el lambda sobrevive a la respuesta);
  // si no llegara a terminar, la próxima llamada reintenta y la mezcla por id lo
  // deja igual. Preferimos un dato de hace 10 min a una tool que tarda 30 s.
  return withDeadline(task, REQUEST_BUDGET_MS);
}

function withDeadline(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ pending: true }), ms);
    const done = (v) => { clearTimeout(t); resolve(v); };
    promise.then(done, (e) => done({ error: e?.message }));
  });
}

/** Invalida el cache de vencimiento (tests / forzar un sync inmediato). */
export function resetFreshness(userId) {
  _nextCheck.delete(userId);
  invalidateKey(userId, STATE_KEY);
}

/**
 * Carril B. Sync completo: lo llama /api/sync desde el cron. `force` ignora los TTL.
 */
export async function runFullSync(userId, { force = false, backfill = true } = {}) {
  return withLock(userId, async (state) => {
    const out = { userId };

    const lane = state.strava || {};
    if (force || stale(lane, STRAVA_TTL_MS)) {
      try {
        // El cron siempre hace delta completo (no sondeo): es el pase que recoge las
        // subidas con fecha retrasada y las actividades editadas en Strava.
        const tok = await stravaTokens(userId, lane);
        if (!tok) { out.strava = { skipped: 'sin-token' }; }
        else {
          if (tok.rotated) await persistTokens(userId, tok);
          out.strava = await syncStrava(userId, { token: tok, detailBudget: 10 });
          out.strava.token = { access: tok.access, refresh: tok.refresh, expires: tok.expires };
          await writeState(userId, { strava: laneState(lane, out.strava) });
        }
      } catch (e) {
        out.strava = { error: e.message };
        await writeState(userId, { strava: { ...lane, at: now(), ok: false, error: e.message } });
      }
    }

    if (force || stale(state.garmin, GARMIN_TTL_MS)) {
      try {
        out.garmin_activities = await syncGarminActivities(userId, { limit: 100, enrichRuns: 20 });
        out.garmin_health = await syncGarminHealth(userId);
        await writeState(userId, { garmin: mark(true) });
      } catch (e) {
        out.garmin = { error: e.message };  // sin credenciales o Garmin caído
        await writeState(userId, { garmin: { at: now(), ok: false, error: e.message } });
      }
    }

    // El backlog va al final y es best-effort: si el cron se queda sin tiempo, lo
    // importante (lo nuevo) ya está guardado y el siguiente pase sigue por donde iba.
    if (backfill) {
      try { out.backfill = await backfillStrava(userId, { token: out.strava?.token }); }
      catch (e) { out.backfill = { error: e.message }; }
    }

    _nextCheck.set(userId, now() + STRAVA_TTL_MS);
    return out;
  });
}

/** Usuarios candidatos a sincronizar (los que tienen datos de Strava guardados). */
export function listSyncableUsers() {
  return listUsersWithKey('stravaData');
}
