// ============================================================================
// mcp-store — capa de acceso a datos para el servidor MCP.
//
// Lee las filas del usuario en `user_storage` (Supabase) con la SERVICE ROLE key
// (salta RLS; el usuario ya viene resuelto y verificado desde el token OAuth) y
// reproduce el mismo reshape que hace el DataExporter del front, para que Claude
// y ChatGPT reciban exactamente los datos que la app ya expone.
// ============================================================================
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client = null;
function service() {
  if (_client) return _client;
  if (!url || !serviceKey) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el servidor');
  }
  _client = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _client;
}

/** Lee una clave del almacén del usuario y la parsea como JSON (o null). */
export async function readKey(userId, key) {
  const { data, error } = await service()
    .from('user_storage')
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`user_storage read "${key}": ${error.message}`);
  if (!data?.value) return null;
  try { return JSON.parse(data.value); } catch { return null; }
}

// ── Reshape (espejo de DataExporter / flatEfforts) ──────────────────────────
const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
export const isRunning = (a) => RUNNING_TYPES.includes(a.type) || RUNNING_TYPES.includes(a.sport_type);

const round = (n, d = 2) => (n == null ? null : parseFloat(Number(n).toFixed(d)));

export const calcPace = (speed) => {
  if (!speed || speed === 0) return null;
  const pace = 16.6667 / speed;                    // min/km
  const min = Math.floor(pace);
  const sec = Math.floor((pace - min) * 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

/** Resumen ligero de una actividad (para listados). */
export function shapeSummary(a) {
  const running = isRunning(a);
  return {
    id: a.id,
    name: a.name,
    date: a.start_date,
    type: a.type,
    distance_km: round(a.distance / 1000),
    moving_time_min: round(a.moving_time / 60),
    ...(running
      ? { pace_per_km: calcPace(a.average_speed) }
      : { speed_kmh: round((a.average_speed || 0) * 3.6, 1) }),
    avg_hr: a.average_heartrate ?? null,
    max_hr: a.max_heartrate ?? null,
    elevation_gain_m: a.total_elevation_gain ?? null,
    has_laps: !!(a.laps && a.laps.length),
  };
}

/** Detalle completo: incluye parciales, splits, best/flat efforts y polyline. */
export function shapeFull(a) {
  const running = isRunning(a);
  return {
    ...shapeSummary(a),
    kudos: a.kudos_count ?? null,
    avg_speed_ms: a.average_speed ?? null,
    map_polyline: a.map?.summary_polyline ?? null,
    laps: (a.laps || []).map((l) => ({
      lap_index: l.lap_index,
      distance_km: round(l.distance / 1000),
      moving_time_min: round(l.moving_time / 60),
      ...(running ? { pace_per_km: calcPace(l.average_speed) } : { speed_kmh: round((l.average_speed || 0) * 3.6, 1) }),
      avg_hr: l.average_heartrate ?? null,
      max_hr: l.max_heartrate ?? null,
      cadence: l.average_cadence ?? null,
      elevation_gain_m: l.total_elevation_gain ?? null,
    })),
    splits_metric: (a.splits_metric || []).map((s) => ({
      split: s.split,
      distance_km: round(s.distance / 1000),
      moving_time_min: round(s.moving_time / 60),
      pace_per_km: running ? calcPace(s.average_speed) : undefined,
      elevation_difference_m: s.elevation_difference ?? null,
      avg_hr: s.average_heartrate ?? null,
    })),
    best_efforts: (a.best_efforts || []).map((b) => ({
      name: b.name,
      distance_m: b.distance,
      elapsed_time_s: b.elapsed_time,
      moving_time_s: b.moving_time,
    })),
    flat_efforts: a.flat_efforts ?? null, // { '1k': {time,distance,elevation}, '2k': {...} }
  };
}

// ── Consultas de alto nivel ─────────────────────────────────────────────────
function inRange(dateIso, from, to) {
  const d = new Date(dateIso);
  if (from && d < new Date(from + 'T00:00:00')) return false;
  if (to && d > new Date(to + 'T23:59:59.999')) return false;
  return true;
}

/** Devuelve el array de actividades Strava ya ordenado (reciente primero). */
export async function getActivities(userId) {
  const raw = await readKey(userId, 'stravaData');
  const list = Array.isArray(raw) ? raw : raw?.activities;
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
}

export function filterActivities(list, { from, to, sport, only_running, min_distance_km } = {}) {
  return list.filter((a) => {
    if (!inRange(a.start_date, from, to)) return false;
    if (only_running && !isRunning(a)) return false;
    if (sport && a.type !== sport && a.sport_type !== sport) return false;
    if (min_distance_km && (a.distance / 1000) < min_distance_km) return false;
    return true;
  });
}

export function summarizeActivities(list) {
  const by_type = {};
  let dist = 0, time = 0, elev = 0;
  for (const a of list) {
    by_type[a.type] = (by_type[a.type] || 0) + 1;
    dist += a.distance || 0;
    time += a.moving_time || 0;
    elev += a.total_elevation_gain || 0;
  }
  const dates = list.map((a) => a.start_date).sort();
  return {
    count: list.length,
    total_distance_km: round(dist / 1000, 1),
    total_moving_time_h: round(time / 3600, 1),
    total_elevation_gain_m: Math.round(elev),
    by_type,
    date_range: dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null,
  };
}

/** VFC nocturna + FC reposo por día (garmin_cardiac_data). */
export async function getHrvResting(userId, { from, to } = {}) {
  const rows = (await readKey(userId, 'garmin_cardiac_data')) || [];
  return rows
    .filter((r) => (r.hrv != null || r.restingHR != null) && inRange(r.date + 'T12:00:00', from, to))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((r) => ({
      date: r.date,
      hrv_ms: r.hrv ?? null,
      resting_hr: r.restingHR ?? null,
      hrv_status: r.hrvStatus ?? null,
      body_battery_low: r.bbLow ?? null,
      body_battery_high: r.bbHigh ?? null,
    }));
}

/** Sueño semanal (garmin_sleep_data). */
export async function getSleep(userId, { from, to } = {}) {
  const rows = (await readKey(userId, 'garmin_sleep_data')) || [];
  return rows
    .filter((r) => inRange((r.weekStart || '') + 'T12:00:00', from, to))
    .sort((a, b) => (b.weekStart || '').localeCompare(a.weekStart || ''))
    .map((r) => ({
      week_start: r.weekStart,
      week_end: r.weekEnd,
      score: r.score ?? null,
      quality: r.quality ?? null,
      avg_duration_min: r.durationMin ?? null,
      rem_min: r.remMin ?? null,
      deep_min: r.deepMin ?? null,
      light_min: r.lightMin ?? null,
      awake_min: r.awakeMin ?? null,
    }));
}
