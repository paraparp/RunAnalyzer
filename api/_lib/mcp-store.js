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

/**
 * Marca un authorization code (por su `jti`) como consumido. La inserción con PK
 * en `jti` es atómica: si ya existía (violación de unicidad 23505) devolvemos
 * false → el code se está reusando (replay) y debe rechazarse.
 */
export async function consumeAuthCode(jti, expUnix) {
  const { error } = await service()
    .from('oauth_used_codes')
    .insert({ jti, expires_at: new Date(expUnix * 1000).toISOString() });
  if (error) {
    if (error.code === '23505') return false; // ya canjeado
    throw new Error(`oauth_used_codes insert: ${error.message}`);
  }
  return true;
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
    hr_source: a._garmin?.hr_source ?? null, // 'strap' | 'wrist' | 'unknown'
    elevation_gain_m: a.total_elevation_gain ?? null,
    has_laps: !!(a.laps && a.laps.length),
    has_garmin: !!a._garmin, // hay running dynamics de la banda correlacionados
  };
}

/** Lap real del reloj (garmin) con ritmo/GAP formateados. */
const shapeGarminLap = (l) => ({
  lap_index: l.lap_index,
  intensity_type: l.intensity_type,          // INTERVAL / REST / RECOVERY / ACTIVE …
  distance_km: round(l.distance_m / 1000),
  duration_min: round(l.duration_s / 60),
  pace_per_km: calcPace(l.avg_speed_ms),
  gap_pace_per_km: l.gap_speed_ms ? calcPace(l.gap_speed_ms) : null,
  avg_hr: l.avg_hr ?? null,
  max_hr: l.max_hr ?? null,
  cadence_spm: l.cadence_spm ?? null,
  avg_power_w: l.avg_power_w ?? null,
  norm_power_w: l.norm_power_w ?? null,
  gct_balance_pct: l.gct_balance_pct ?? null,
  elevation_gain_m: l.elevation_gain_m ?? null,
});

/** Detalle completo: incluye parciales, splits, best/flat efforts y polyline. */
export function shapeFull(a) {
  const running = isRunning(a);
  return {
    ...shapeSummary(a),
    garmin: a._garmin
      ? {
          garmin_id: a._garmin.garmin_id,
          hr_source: a._garmin.hr_source ?? null,      // banda vs muñeca
          data_quality: a._garmin.data_quality ?? null,
          dynamics: a._garmin.dynamics,      // cadencia, GCT, oscilación vertical, zancada…
          power: a._garmin.power,            // vatios de carrera
          training: a._garmin.training,      // training effect, carga, VO2max
          weather: a._garmin.weather ?? null, // temp, humedad, WBGT y penalización por calor
          laps: (a._garmin.laps || []).map(shapeGarminLap), // laps reales del reloj con tipo
          calories: a._garmin.calories,
          steps: a._garmin.steps,
        }
      : null,
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
    decoupling: computeDecoupling(a),      // deriva cardíaca (durabilidad) si >60 min
    gap: computeGap(a),                    // ritmo ajustado por desnivel agregado
  };
}

// ── Desacoplamiento / durabilidad (mejor predictor de maratón) ───────────────
// Compara el ratio FC/velocidad de la parte inicial (km 5–10) con el del último
// 25%. Solo para sesiones >60 min con FC por split. Cálculo puro sobre splits.
export function computeDecoupling(a) {
  const splits = a.splits_metric;
  const totalTime = a.moving_time || 0;
  if (!Array.isArray(splits) || splits.length < 12 || totalTime < 3600) return null;
  const ratioOf = (arr) => {
    let hrSum = 0, hrTime = 0, dist = 0, time = 0;
    for (const s of arr) {
      const t = s.moving_time || 0;
      if (s.average_heartrate && t) { hrSum += s.average_heartrate * t; hrTime += t; }
      dist += s.distance || 0; time += t;
    }
    if (!hrTime || !time || !dist) return null;
    const hr = hrSum / hrTime;
    const speed = dist / time;                       // m/s
    if (!speed) return null;
    return { hr, speed, ratio: hr / speed };
  };
  const initial = ratioOf(splits.filter((s) => s.split >= 5 && s.split <= 10));
  const n = splits.length;
  const finalCount = Math.max(1, Math.ceil(n * 0.25));
  const final = ratioOf(splits.slice(n - finalCount));
  if (!initial || !final) return null;
  return {
    decoupling_pct: round((final.ratio / initial.ratio - 1) * 100, 1),
    initial: { window: 'km 5–10', avg_hr: round(initial.hr, 0), avg_speed_ms: round(initial.speed, 3) },
    final: { window: `último 25% (${finalCount} km)`, avg_hr: round(final.hr, 0), avg_speed_ms: round(final.speed, 3) },
  };
}

// ── GAP: coste metabólico relativo por pendiente (Minetti) ───────────────────
const minettiCost = (i) => // i = pendiente en fracción (+ subida)
  155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
const gapFactor = (grade) => { const c = minettiCost(grade); return c > 0 ? c / 3.6 : 1; };

/** Ritmo ajustado por desnivel (GAP) agregado y por split, desde splits_metric. */
export function computeGap(a) {
  const splits = a.splits_metric;
  if (!Array.isArray(splits) || !splits.length) return null;
  let dist = 0, gapTime = 0;
  const per_split = [];
  for (const s of splits) {
    const d = s.distance || 0;
    const sp = s.average_speed || 0;
    if (!d || !sp) continue;
    const grade = s.elevation_difference != null ? s.elevation_difference / d : 0;
    const gapSpeed = sp * gapFactor(grade);          // velocidad equivalente en llano
    dist += d; gapTime += d / gapSpeed;
    per_split.push({ split: s.split, grade_pct: round(grade * 100, 1), gap_pace: calcPace(gapSpeed) });
  }
  if (!dist || !gapTime) return null;
  return { gap_pace: calcPace(dist / gapTime), per_split };
}

// ── Consultas de alto nivel ─────────────────────────────────────────────────
function inRange(dateIso, from, to) {
  const d = new Date(dateIso);
  if (from && d < new Date(from + 'T00:00:00')) return false;
  if (to && d > new Date(to + 'T23:59:59.999')) return false;
  return true;
}

// Correlaciona actividades de Garmin con las de Strava por hora de inicio (UTC),
// con tolerancia de ±3 min, y adjunta el registro Garmin como `a._garmin`.
function attachGarmin(stravaList, garminList) {
  const byMinute = new Map();
  for (const g of garminList) {
    const t = Date.parse(g.start_time);
    if (!Number.isNaN(t)) byMinute.set(Math.round(t / 60000), g);
  }
  for (const a of stravaList) {
    const t = Date.parse(a.start_date);
    if (Number.isNaN(t)) continue;
    const base = Math.round(t / 60000);
    for (let d = 0; d <= 3; d++) {
      const g = byMinute.get(base + d) || byMinute.get(base - d);
      if (g) { a._garmin = g; break; }
    }
  }
}

/**
 * Actividades de Strava (reciente primero) con las running dynamics de Garmin
 * ya correlacionadas y adjuntas en `a._garmin` cuando hay coincidencia.
 */
export async function getActivities(userId) {
  const [raw, garminRaw] = await Promise.all([
    readKey(userId, 'stravaData'),
    readKey(userId, 'garmin_activities'),
  ]);
  const list = Array.isArray(raw) ? raw : raw?.activities;
  if (!Array.isArray(list)) return [];
  const sorted = [...list].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
  const garmin = Array.isArray(garminRaw) ? garminRaw : garminRaw?.activities;
  if (Array.isArray(garmin) && garmin.length) attachGarmin(sorted, garmin);
  return sorted;
}

/** Lista cruda de actividades de Garmin (garmin_activities) sin correlacionar. */
export async function getGarminActivitiesRaw(userId) {
  const raw = await readKey(userId, 'garmin_activities');
  const list = Array.isArray(raw) ? raw : raw?.activities;
  return Array.isArray(list) ? list : [];
}

/** Fila de running dynamics tomando Garmin como fuente (Strava opcional). */
export function shapeDynamicsFromGarmin(g, strava = null) {
  const d = g?.dynamics;
  if (!d) return null;
  const speed = g.duration_s && g.distance_m ? g.distance_m / g.duration_s : null;
  return {
    garmin_id: g.garmin_id,
    strava_id: strava?.id ?? null,
    date: strava?.start_date || g.start_time,
    name: strava?.name || g.name,
    distance_km: round((g.distance_m ?? 0) / 1000),
    pace_per_km: speed ? calcPace(speed) : null,
    avg_hr: g.avg_hr ?? strava?.average_heartrate ?? null,
    hr_source: g.hr_source ?? null,
    cadence_spm: d.cadence_spm ?? null,
    ground_contact_ms: d.ground_contact_ms ?? null,
    gct_balance_pct: d.gct_balance_pct ?? null,
    stride_length_cm: d.stride_length_cm ?? null,
    vertical_oscillation_cm: d.vertical_oscillation_cm ?? null,
    vertical_ratio_pct: d.vertical_ratio_pct ?? null,
    avg_power_w: g.power?.avg_w ?? null,
    aerobic_te: g.training?.aerobic_te ?? null,
    anaerobic_te: g.training?.anaerobic_te ?? null,
    training_load: g.training?.training_load ?? null,
    vo2max: g.training?.vo2max ?? null,
  };
}

const DYNAMICS_METRICS = ['cadence_spm', 'ground_contact_ms', 'gct_balance_pct', 'stride_length_cm',
  'vertical_oscillation_cm', 'vertical_ratio_pct', 'avg_power_w', 'aerobic_te', 'anaerobic_te',
  'training_load', 'vo2max'];

/**
 * Running dynamics leyendo de `garmin_activities` directamente (la dinámica vive
 * ahí), con Strava como enriquecimiento opcional por hora de inicio. Incluye un
 * bloque `_diagnostics` que localiza en qué capa se rompe si salen cero filas.
 */
export async function listRunningDynamics(userId, { from, to, limit = 50, offset = 0 } = {}) {
  const garmin = await getGarminActivitiesRaw(userId);
  const stravaRaw = await readKey(userId, 'stravaData');
  const stravaList = Array.isArray(stravaRaw) ? stravaRaw : (stravaRaw?.activities || []);

  const byMin = new Map();
  for (const s of stravaList) {
    const t = Date.parse(s.start_date);
    if (!Number.isNaN(t)) byMin.set(Math.round(t / 60000), s);
  }
  const runs = garmin.filter((g) => (g.type || '').includes('run'));

  let correlated = 0;
  const rows = [];
  for (const g of runs) {
    if (g.start_time && !inRange(g.start_time, from, to)) continue;
    let strava = null;
    const t = Date.parse(g.start_time);
    if (!Number.isNaN(t)) {
      const base = Math.round(t / 60000);
      for (let dd = 0; dd <= 3 && !strava; dd++) strava = byMin.get(base + dd) || byMin.get(base - dd) || null;
    }
    const row = shapeDynamicsFromGarmin(g, strava);
    if (!row) continue;
    if (strava) correlated++;
    rows.push(row);
  }
  rows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const avg = (key) => {
    const vals = rows.map((r) => r[key]).filter((v) => typeof v === 'number');
    return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
  };
  const off = Math.max(0, offset);
  const lim = Math.min(200, Math.max(1, limit));
  return {
    count: rows.length,                                  // total en el rango
    offset: off, limit: lim,
    averages: Object.fromEntries(DYNAMICS_METRICS.map((m) => [m, avg(m)])), // medias sobre TODO el rango
    runs: rows.slice(off, off + lim),                    // página, para no saturar el contexto
    _diagnostics: {
      garmin_activities_loaded: garmin.length,
      garmin_runs: runs.length,
      runs_with_dynamics: rows.length,
      strava_activities_loaded: stravaList.length,
      strava_correlated: correlated,
      hint:
        garmin.length === 0 ? 'garmin_activities VACÍO en user_storage → la app no ha sincronizado esa clave (fallo de ingest/tabla).'
        : runs.length === 0 ? 'Hay actividades Garmin pero ninguna de tipo run → revisa el typeKey en normalizeGarminActivity.'
        : rows.length === 0 ? 'Hay carreras Garmin pero sin bloque dynamics → la banda no lo grabó o normalizeGarminActivity lo pierde.'
        : correlated === 0 ? 'Dynamics OK y ya se muestran; Strava no correlaciona (stravaData desfasado), pero ya no bloquea.'
        : 'ok',
    },
  };
}

/** Fila compacta de running dynamics (Strava + Garmin) para agregar/analizar. */
export function shapeDynamicsRow(a) {
  const g = a._garmin;
  if (!g) return null;
  return {
    id: a.id,
    date: a.start_date,
    name: a.name,
    distance_km: round(a.distance / 1000),
    pace_per_km: isRunning(a) ? calcPace(a.average_speed) : null,
    avg_hr: a.average_heartrate ?? null,
    hr_source: g.hr_source ?? null, // clave para no mezclar FC de muñeca con banda
    cadence_spm: g.dynamics.cadence_spm,
    ground_contact_ms: g.dynamics.ground_contact_ms,
    gct_balance_pct: g.dynamics.gct_balance_pct,
    stride_length_cm: g.dynamics.stride_length_cm,
    vertical_oscillation_cm: g.dynamics.vertical_oscillation_cm,
    vertical_ratio_pct: g.dynamics.vertical_ratio_pct,
    avg_power_w: g.power.avg_w,
    aerobic_te: g.training.aerobic_te,
    anaerobic_te: g.training.anaerobic_te,
    training_load: g.training.training_load,
    vo2max: g.training.vo2max,
  };
}

export function filterActivities(list, {
  from, to, sport, only_running, min_distance_km, max_distance_km, hr_min, hr_max, flat_only, hr_source,
} = {}) {
  return list.filter((a) => {
    if (!inRange(a.start_date, from, to)) return false;
    if (only_running && !isRunning(a)) return false;
    if (sport && a.type !== sport && a.sport_type !== sport) return false;
    if (hr_source && (a._garmin?.hr_source ?? 'unknown') !== hr_source) return false;
    const km = (a.distance || 0) / 1000;
    if (min_distance_km && km < min_distance_km) return false;
    if (max_distance_km && km > max_distance_km) return false;
    if (hr_min && !(a.average_heartrate >= hr_min)) return false;
    if (hr_max && !(a.average_heartrate <= hr_max)) return false;
    if (flat_only) {
      const gainPerKm = km ? (a.total_elevation_gain || 0) / km : Infinity;
      if (gainPerKm > 10) return false;                // <10 m/km = llano
    }
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

// ── Personal Bests (espejo exacto de src/components/PersonalBests.jsx) ────────
const PB_RANGES = [
  { id: '5k', name: '5K', min: 4900, max: 5200, effortNames: ['5k'] },
  { id: '10k', name: '10K', min: 9900, max: 10500, effortNames: ['10k'] },
  { id: 'hm', name: 'Half Marathon', min: 21000, max: 21500, effortNames: ['half-marathon'] },
  { id: 'fm', name: 'Marathon', min: 42000, max: 43000, effortNames: ['marathon'] },
];
const PB_FLAT_RANGES = [
  { id: 'flat1k', name: 'Flat 1K', effortKey: '1k', splits: 1, min: 950, max: 1050, maxElev: 5 },
  { id: 'flat2k', name: 'Flat 2K', effortKey: '2k', splits: 2, min: 1900, max: 2100, maxElev: 10 },
];

const fmtTime = (s) => {
  const t = Math.round(s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
};

// Candidato a PB por distancia: preferimos el best_effort de Strava; si no, la
// distancia total dentro del rango.
function pbCandidate(a, range) {
  const effort = a.best_efforts?.find(
    (e) => range.effortNames.includes(e.name?.toLowerCase()) && (e.elapsed_time || e.moving_time) > 0,
  );
  if (effort) {
    return { id: a.id, name: a.name, start_date: a.start_date, time: effort.elapsed_time || effort.moving_time, distance: effort.distance, isEffort: a.distance > range.max, isFlat: false };
  }
  const time = a.elapsed_time || a.moving_time;
  if (a.distance >= range.min && a.distance <= range.max && time > 0) {
    return { id: a.id, name: a.name, start_date: a.start_date, time, distance: a.distance, isEffort: false, isFlat: false };
  }
  return null;
}

// PB llano por parciales (fallback si no hay flat_efforts): mejor ventana de N
// splits cuya distancia y desnivel neto cumplen el criterio.
function pbFlatFromSplits(a, range) {
  const splits = a.splits_metric;
  if (!Array.isArray(splits) || splits.length < range.splits) return null;
  let best = null;
  for (let i = 0; i + range.splits <= splits.length; i++) {
    const win = splits.slice(i, i + range.splits);
    if (win.some((sp) => typeof sp.elevation_difference !== 'number')) continue;
    const distance = win.reduce((s, sp) => s + sp.distance, 0);
    const elevation = win.reduce((s, sp) => s + sp.elevation_difference, 0);
    const time = win.reduce((s, sp) => s + (sp.moving_time || sp.elapsed_time || 0), 0);
    if (Math.abs(elevation) > range.maxElev || distance < range.min || distance > range.max || time <= 0) continue;
    if (!best || time / distance < best.time / best.distance) best = { time, distance, elevation };
  }
  return best;
}

function pbFlatCandidate(a, range) {
  const eff = a.flat_efforts?.[range.effortKey];
  const best = (eff && eff.time > 0) ? eff : pbFlatFromSplits(a, range);
  if (!best) return null;
  return { id: a.id, name: a.name, start_date: a.start_date, time: best.time, distance: best.distance, isEffort: true, isFlat: true };
}

/** Personal Bests (5K/10K/HM/Maratón + Flat 1K/2K), top-5 por distancia. */
export function computePersonalBests(activities) {
  const build = (ranges, candFn) => ranges.map((range) => {
    const top = activities
      .map((a) => candFn(a, range))
      .filter(Boolean)
      .sort((x, y) => x.time / x.distance - y.time / y.distance)
      .slice(0, 5)
      .map((c) => ({
        id: c.id, name: c.name, date: c.start_date,
        time: fmtTime(c.time), time_s: Math.round(c.time),
        pace_per_km: calcPace(c.distance / c.time),
        distance_m: Math.round(c.distance),
        is_effort: !!c.isEffort, is_flat: !!c.isFlat,
      }));
    return top.length ? { id: range.id, name: range.name, pr: top[0], top } : null;
  }).filter(Boolean);
  return [...build(PB_FLAT_RANGES, pbFlatCandidate), ...build(PB_RANGES, pbCandidate)];
}

export async function getPersonalBests(userId) {
  const all = await getActivities(userId);
  return { records: computePersonalBests(all) };
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

// ── Modelo de Banister: CTL / ATL / TSB desde la carga por sesión ────────────
const toISODate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Serie diaria de carga crónica (CTL, 42 d), aguda (ATL, 7 d) y forma (TSB) por
 * medias móviles exponenciales sobre el training_load de Garmin. Sin ingesta.
 */
export async function getTrainingLoadModel(userId, { from, to } = {}) {
  const acts = await getActivities(userId);
  const byDay = new Map();
  for (const a of acts) {
    const day = (a.start_date || '').slice(0, 10);
    if (!day) continue;
    let load = a._garmin?.training?.training_load;
    if (load == null && a.moving_time) load = a.moving_time / 60; // proxy si no hay load Garmin
    if (load == null) continue;
    byDay.set(day, (byDay.get(day) || 0) + load);
  }
  if (!byDay.size) return { current: null, series: [], note: 'Sin datos de carga' };
  const days = [...byDay.keys()].sort();
  const first = new Date(days[0] + 'T00:00:00');
  const last = new Date(days[days.length - 1] + 'T00:00:00');
  const kCtl = 1 - Math.exp(-1 / 42);
  const kAtl = 1 - Math.exp(-1 / 7);
  let ctl = 0, atl = 0;
  const series = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    const load = byDay.get(iso) || 0;
    const tsb = ctl - atl;                             // forma = CTL previo − ATL previo
    ctl += (load - ctl) * kCtl;
    atl += (load - atl) * kAtl;
    series.push({ date: iso, load: round(load, 0), ctl: round(ctl, 1), atl: round(atl, 1), tsb: round(tsb, 1) });
  }
  const ranged = series.filter((s) => inRange(s.date + 'T12:00:00', from, to));
  const out = ranged.length ? ranged : series;
  const lastRow = out[out.length - 1] || null;
  const weekly_ramp = out.length > 7 ? round(out[out.length - 1].ctl - out[out.length - 8].ctl, 1) : null;
  return { current: lastRow ? { ...lastRow, weekly_ramp } : null, series: out };
}

// ── Alertas de patrón (firma de infección / sobrecarga) ──────────────────────
export async function getHealthAlerts(userId, { from, to } = {}) {
  const rows = ((await readKey(userId, 'garmin_cardiac_data')) || [])
    .filter((r) => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const alerts = [];
  const hrvHist = [], rhrHist = [];
  let prevLowBB = false;
  for (const r of rows) {
    const hrvBase = median(hrvHist.slice(-30));
    const rhrBase = median(rhrHist.slice(-30));
    const lowBB = r.bbHigh != null && r.bbHigh < 55;
    if (lowBB && prevLowBB) {
      alerts.push({ date: r.date, type: 'body_battery_low_streak',
        detail: `Body Battery máx <55 dos noches seguidas (${r.bbHigh})` });
    }
    if (hrvBase && rhrBase && r.hrv != null && r.restingHR != null &&
        r.hrv < hrvBase * 0.9 && r.restingHR > rhrBase + 3) {
      alerts.push({ date: r.date, type: 'hrv_down_rhr_up',
        detail: `VFC ${r.hrv} < baseline ${round(hrvBase, 0)} y FC reposo ${r.restingHR} > normal ${round(rhrBase, 0)}` });
    }
    prevLowBB = lowBB;
    if (r.hrv != null) hrvHist.push(r.hrv);
    if (r.restingHR != null) rhrHist.push(r.restingHR);
  }
  const filtered = alerts.filter((al) => inRange(al.date + 'T12:00:00', from, to)).reverse();
  return { count: filtered.length, alerts: filtered };
}

// ── Detección automática de esfuerzos de test (umbral) ───────────────────────
// Bloque continuo de 20–45 min por encima del 88% de FCmax → estimación de LTHR
// y ritmo umbral, con bandera de si la FC se estabilizó (deriva <3%).
export function detectThresholdEffort(a, hrMax) {
  const splits = a.splits_metric;
  if (!Array.isArray(splits) || !hrMax) return null;
  const thr = hrMax * 0.88;
  let best = null, run = [];
  const flush = () => {
    if (run.length) {
      const time = run.reduce((s, x) => s + (x.moving_time || 0), 0);
      if (time >= 20 * 60 && time <= 45 * 60 && (!best || time > best.time)) best = { splits: [...run], time };
    }
    run = [];
  };
  for (const s of splits) {
    if (s.average_heartrate && s.average_heartrate >= thr) run.push(s);
    else flush();
  }
  flush();
  if (!best) return null;
  const seg = best.splits;
  const dist = seg.reduce((s, x) => s + (x.distance || 0), 0);
  const lthr = round(seg.reduce((s, x) => s + x.average_heartrate * (x.moving_time || 0), 0) / best.time, 0);
  const third = Math.max(1, Math.floor(seg.length / 3));
  const hrAvg = (arr) => arr.reduce((s, x) => s + x.average_heartrate, 0) / arr.length;
  const drift = (hrAvg(seg.slice(-third)) / hrAvg(seg.slice(0, third)) - 1) * 100;
  return {
    duration_min: round(best.time / 60, 1),
    lthr,
    threshold_pace: calcPace(dist / best.time),
    hr_stabilized: Math.abs(drift) < 3,
    hr_drift_pct: round(drift, 1),
  };
}

/** Escanea el historial buscando tests de umbral (FCmax = máx FC observada). */
export async function detectThresholdTests(userId, args = {}) {
  const all = await getActivities(userId);
  const hrMax = all.reduce((m, a) => Math.max(m, a.max_heartrate || 0), 0) || null;
  const tests = filterActivities(all, { ...args, only_running: true })
    .map((a) => {
      const t = detectThresholdEffort(a, hrMax);
      return t ? { id: a.id, date: a.start_date, name: a.name, ...t } : null;
    })
    .filter(Boolean);
  return { hr_max_used: hrMax, count: tests.length, tests };
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
