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

// Cache de lecturas por (userId, key). `stravaData` pesa varios MB y varias tools lo
// releen (incluso dos veces dentro de la misma request). TTL corto: dedup dentro de
// una request y entre requests rápidas seguidas, sin arrastrar datos rancios.
const _cache = new Map(); // `${userId}:${key}` -> { value, ts }
const CACHE_TTL_MS = 15000;

/** Lee una clave del almacén del usuario y la parsea como JSON (o null). */
export async function readKey(userId, key) {
  const ck = `${userId}:${key}`;
  const hit = _cache.get(ck);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;
  const { data, error } = await service()
    .from('user_storage')
    .select('value')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`user_storage read "${key}": ${error.message}`);
  let value = null;
  if (data?.value) { try { value = JSON.parse(data.value); } catch { value = null; } }
  _cache.set(ck, { value, ts: Date.now() });
  return value;
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

// Los autolaps por km/milla llegan de Garmin con intensity_type "INTERVAL" aunque
// sean un rodaje continuo, lo que hace ese campo inservible para clasificar sesiones.
// Si los laps son de distancia casi uniforme (~1 km o ~1 milla) los marcamos como
// autolaps para que un agente sepa que intensity_type no refleja estructura real.
function shapeGarminLaps(laps) {
  const ds = laps.map((l) => l.distance_m).filter((v) => typeof v === 'number' && v > 0);
  let autolap = false;
  if (ds.length >= 3) {
    const sorted = [...ds].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const near = (t) => median > 0 && Math.abs(median - t) / t <= 0.03;
    const uniform = ds.filter((v) => Math.abs(v - median) / median <= 0.05).length / ds.length;
    if (uniform >= 0.7 && (near(1000) || near(1609))) autolap = true;
  }
  return laps.map((l) => ({ ...shapeGarminLap(l), is_autolap: autolap }));
}

// Secciones opcionales de get_activity. Por defecto van todas; con `include` el
// cliente pide solo las que necesita (una actividad completa ~10-12k tokens: la
// polyline y los laps triplicados —garmin.laps/laps/splits_metric— son el grueso).
const FULL_SECTIONS = ['garmin', 'laps', 'splits', 'best_efforts', 'flat_efforts', 'decoupling', 'gap', 'map'];

/**
 * Detalle completo. `include` (array) limita las secciones devueltas; el resumen base
 * (id, nombre, distancia, ritmo, FC…) va siempre. Sin `include` se devuelve todo.
 */
export function shapeFull(a, include = null) {
  const running = isRunning(a);
  const want = Array.isArray(include) && include.length
    ? new Set(include.map((s) => (s === 'splits_metric' ? 'splits' : s === 'polyline' ? 'map' : s)))
    : new Set(FULL_SECTIONS);
  const out = { ...shapeSummary(a) };

  if (want.has('garmin')) {
    out.garmin = a._garmin ? {
      garmin_id: a._garmin.garmin_id,
      hr_source: a._garmin.hr_source ?? null,      // banda vs muñeca
      data_quality: a._garmin.data_quality ?? null,
      dynamics: a._garmin.dynamics,      // cadencia, GCT, oscilación vertical, zancada…
      power: a._garmin.power,            // vatios de carrera
      training: a._garmin.training,      // training effect, carga, VO2max
      weather: a._garmin.weather ?? null, // temp, humedad, WBGT y penalización por calor
      laps: shapeGarminLaps(a._garmin.laps || []), // laps reales del reloj (con is_autolap)
      calories: a._garmin.calories,
      steps: a._garmin.steps,
    } : null;
  }
  out.kudos = a.kudos_count ?? null;
  out.avg_speed_ms = a.average_speed ?? null;
  if (want.has('map')) out.map_polyline = a.map?.summary_polyline ?? null;
  if (want.has('laps')) {
    out.laps = (a.laps || []).map((l) => ({
      lap_index: l.lap_index,
      distance_km: round(l.distance / 1000),
      moving_time_min: round(l.moving_time / 60),
      ...(running ? { pace_per_km: calcPace(l.average_speed) } : { speed_kmh: round((l.average_speed || 0) * 3.6, 1) }),
      avg_hr: l.average_heartrate ?? null,
      max_hr: l.max_heartrate ?? null,
      cadence: l.average_cadence ?? null,
      elevation_gain_m: l.total_elevation_gain ?? null, // desnivel POSITIVO del lap
    }));
  }
  if (want.has('splits')) {
    out.splits_metric = (a.splits_metric || []).map((s) => ({
      split: s.split,
      distance_km: round(s.distance / 1000),
      moving_time_min: round(s.moving_time / 60),
      pace_per_km: running ? calcPace(s.average_speed) : undefined,
      elevation_difference_m: s.elevation_difference ?? null, // desnivel NETO del split (puede ser −)
      avg_hr: s.average_heartrate ?? null,
    }));
  }
  if (want.has('best_efforts')) {
    out.best_efforts = (a.best_efforts || []).map((b) => ({
      name: b.name,
      distance_m: b.distance,
      elapsed_time_s: b.elapsed_time,
      moving_time_s: b.moving_time,
    }));
  }
  if (want.has('flat_efforts')) out.flat_efforts = a.flat_efforts ?? null; // { '1k': {time,distance,elevation}, '2k': {...} }
  if (want.has('decoupling')) out.decoupling = computeDecoupling(a); // deriva cardíaca (durabilidad)
  if (want.has('gap')) out.gap = computeGap(a);                      // ritmo ajustado por desnivel
  return out;
}

// ── Desacoplamiento / durabilidad (mejor predictor de maratón) ───────────────
// Compara el ratio FC/velocidad de la parte inicial (km 5–10) con el del último
// 25%. Para sesiones ≥45 min con FC por split. Devuelve un motivo cuando no calcula
// (en vez de un null mudo, que no distingue "roto" de "no aplica").
const decoupNull = (reason) => ({ decoupling_pct: null, reason });
export function computeDecoupling(a) {
  const splits = a.splits_metric;
  const totalTime = a.moving_time || 0;
  if (!Array.isArray(splits) || !splits.length) return decoupNull('Sin splits por km');
  if (totalTime < 2700) return decoupNull('Sesión < 45 min (deriva poco informativa)');
  if (splits.length < 10) return decoupNull('Menos de 10 km/splits');
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
  if (!initial || !final) return decoupNull('Sin FC por split en las ventanas comparadas');
  return {
    decoupling_pct: round((final.ratio / initial.ratio - 1) * 100, 1),
    initial: { window: 'km 5–10', avg_hr: round(initial.hr, 0), avg_speed_ms: round(initial.speed, 3) },
    final: { window: `último 25% (${finalCount} km)`, avg_hr: round(final.hr, 0), avg_speed_ms: round(final.speed, 3) },
  };
}

// ── GAP: coste metabólico relativo por pendiente (Minetti) ───────────────────
const minettiCost = (i) => // i = pendiente en fracción (+ subida)
  155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
// Minetti sobre-estima el beneficio de la bajada moderada (un −7,5% daría ~2:19/km
// de crédito, poco creíble). Acotamos el factor a [0.83, 1.55]: como mucho ~20% de
// crédito por bajada y ~55% de penalización por subida, en línea con GAP de Strava.
const gapFactor = (grade) => {
  const c = minettiCost(grade);
  const f = c > 0 ? c / 3.6 : 1;
  return Math.min(1.55, Math.max(0.83, f));
};

/** Ritmo ajustado por desnivel (GAP) agregado y por split, desde splits_metric. */
export function computeGap(a) {
  const splits = a.splits_metric;
  if (!Array.isArray(splits) || !splits.length) return null;
  let dist = 0, gapTime = 0;
  const per_split = [];
  for (const s of splits) {
    const d = s.distance || 0;
    const sp = s.average_speed || 0;
    if (!d || !sp || d < 500) continue;              // ignora parciales cortos (ruido de pendiente)
    const grade = s.elevation_difference != null ? s.elevation_difference / d : 0;
    const gapSpeed = sp * gapFactor(grade);          // velocidad equivalente en llano
    dist += d; gapTime += d / gapSpeed;
    per_split.push({ split: s.split, grade_pct: round(grade * 100, 1), gap_pace: calcPace(gapSpeed) });
  }
  if (!dist || !gapTime) return null;
  return { gap_pace: calcPace(dist / gapTime), per_split };
}

// ── Consultas de alto nivel ─────────────────────────────────────────────────
// Compara por fecha de calendario (YYYY-MM-DD) en vez de por Date: `from`/`to` son
// fechas puras y antes se parseaban en hora local mientras que las fechas de
// actividad vienen en UTC, lo que descolocaba los límites según el TZ del server.
function inRange(dateIso, from, to) {
  if (!from && !to) return true;
  const day = String(dateIso).slice(0, 10); // YYYY-MM-DD
  if (from && day < from) return false;
  if (to && day > to) return false;
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

export function filterActivities(list, {
  from, to, sport, only_running, min_distance_km, max_distance_km,
  avg_hr_min, avg_hr_max, hr_min, hr_max, flat_only, hr_source,
} = {}) {
  // `avg_hr_min/avg_hr_max` filtran por FC MEDIA. Nombres nuevos para evitar la
  // colisión con el `hr_max` (FCmax del atleta) de detect_threshold_efforts; se
  // aceptan los antiguos hr_min/hr_max por retrocompatibilidad.
  const loHr = avg_hr_min ?? hr_min;
  const hiHr = avg_hr_max ?? hr_max;
  return list.filter((a) => {
    if (!inRange(a.start_date, from, to)) return false;
    if (only_running && !isRunning(a)) return false;
    if (sport && a.type !== sport && a.sport_type !== sport) return false;
    if (hr_source && (a._garmin?.hr_source ?? 'unknown') !== hr_source) return false;
    const km = (a.distance || 0) / 1000;
    if (min_distance_km && km < min_distance_km) return false;
    if (max_distance_km && km > max_distance_km) return false;
    if (loHr && !(a.average_heartrate >= loHr)) return false;
    if (hiHr && !(a.average_heartrate <= hiHr)) return false;
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

/**
 * Agregados combinando Strava y Garmin. Strava es la fuente base; añadimos las
 * actividades de Garmin NO correlacionadas (p.ej. calentamiento/vuelta a la calma
 * registrados sueltos en el reloj) para no infravalorar el volumen semanal. Devuelve
 * el resumen Strava + `garmin_only` (lo que aporta Garmin) + `combined` (total real).
 */
export async function activityStats(userId, args = {}) {
  const all = await getActivities(userId);
  const stravaList = filterActivities(all, args);
  const base = summarizeActivities(stravaList);

  const garmin = await getGarminActivitiesRaw(userId);
  const correlated = new Set(all.filter((a) => a._garmin).map((a) => a._garmin.garmin_id));
  const onlyRun = args.only_running;
  const gOnly = garmin.filter((g) => {
    if (correlated.has(g.garmin_id)) return false;                 // ya cuenta vía Strava
    if (onlyRun && !(g.type || '').includes('run')) return false;
    if (g.start_time && !inRange(g.start_time, args.from, args.to)) return false;
    return true;
  });
  let gDist = 0, gTime = 0;
  for (const g of gOnly) { gDist += g.distance_m || 0; gTime += g.duration_s || 0; }

  const garmin_only = {
    count: gOnly.length,
    distance_km: round(gDist / 1000, 1),
    moving_time_h: round(gTime / 3600, 1),
    note: gOnly.length ? 'Actividades presentes en Garmin pero no en Strava (no correlacionadas).' : undefined,
  };
  const combined = {
    count: base.count + gOnly.length,
    total_distance_km: round((base.total_distance_km || 0) + gDist / 1000, 1),
    total_moving_time_h: round((base.total_moving_time_h || 0) + gTime / 3600, 1),
  };

  // Desglose semanal (km, tiempo y rampa % vs semana previa): para seguir la subida
  // de volumen sin tener que llamar una vez por semana.
  if (args.granularity === 'weekly') {
    const byWeek = new Map();
    for (const a of stravaList) {
      const day = (a.start_date || '').slice(0, 10);
      if (!day) continue;
      const wk = mondayOf(day);
      const acc = byWeek.get(wk) || { week_start: wk, count: 0, dist: 0, time: 0 };
      acc.count++; acc.dist += a.distance || 0; acc.time += a.moving_time || 0;
      byWeek.set(wk, acc);
    }
    const weeks = [...byWeek.values()].sort((x, y) => x.week_start.localeCompare(y.week_start));
    const weekly = weeks.map((w, i) => {
      const km = round(w.dist / 1000, 1);
      const prevKm = i > 0 ? weeks[i - 1].dist / 1000 : null;
      return {
        week_start: w.week_start, count: w.count,
        distance_km: km, moving_time_h: round(w.time / 3600, 1),
        ramp_pct: prevKm ? round((km / prevKm - 1) * 100, 1) : null,
      };
    });
    return { source: 'strava', granularity: 'weekly', weeks: weekly, garmin_only, combined };
  }
  return { source: 'strava', ...base, garmin_only, combined };
}

// ── Personal Bests (espejo exacto de src/components/PersonalBests.jsx) ────────
// `std` = distancia estándar de referencia (m) para normalizar tiempos: un candidato
// puede venir de un best_effort exacto (5000 m) o de la distancia total (5097 m), y
// compararlos por tiempo bruto mezcla peras y manzanas. Ordenamos por ritmo.
const PB_RANGES = [
  { id: '5k', name: '5K', std: 5000, min: 4900, max: 5200, effortNames: ['5k'] },
  { id: '10k', name: '10K', std: 10000, min: 9900, max: 10500, effortNames: ['10k'] },
  { id: 'hm', name: 'Half Marathon', std: 21097, min: 21000, max: 21500, effortNames: ['half-marathon'] },
  { id: 'fm', name: 'Marathon', std: 42195, min: 42000, max: 43000, effortNames: ['marathon'] },
];
const PB_FLAT_RANGES = [
  { id: 'flat1k', name: 'Flat 1K', effortKey: '1k', std: 1000, splits: 1, min: 950, max: 1050, maxElev: 5 },
  { id: 'flat2k', name: 'Flat 2K', effortKey: '2k', std: 2000, splits: 2, min: 1900, max: 2100, maxElev: 10 },
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
    (e) => range.effortNames.includes(canonEffortByMeters(e.distance) || e.name?.toLowerCase()) && (e.moving_time || e.elapsed_time) > 0,
  );
  if (effort) {
    return { id: a.id, name: a.name, start_date: a.start_date, time: effort.moving_time || effort.elapsed_time, distance: effort.distance, isEffort: a.distance > range.max, isFlat: false };
  }
  const time = a.moving_time || a.elapsed_time;
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
      // Ordena por RITMO (tiempo/distancia): así no gana un tramo más largo por tener
      // menos tiempo bruto, ni un 5097 m se compara injustamente con un 5000 m.
      .sort((x, y) => x.time / x.distance - y.time / y.distance)
      .slice(0, 5)
      .map((c) => ({
        id: c.id, name: c.name, date: c.start_date,
        time: fmtTime(c.time), time_s: Math.round(c.time),
        pace_per_km: calcPace(c.distance / c.time),
        distance_m: Math.round(c.distance),
        distance_delta_m: Math.round(c.distance - range.std),   // desvío vs distancia estándar
        equiv_time: fmtTime((c.time / c.distance) * range.std),  // tiempo equivalente a la distancia estándar
        is_effort: !!c.isEffort, is_flat: !!c.isFlat,
      }));
    return top.length ? { id: range.id, name: range.name, distance_m: range.std, pr: top[0], top } : null;
  }).filter(Boolean);
  return [...build(PB_FLAT_RANGES, pbFlatCandidate), ...build(PB_RANGES, pbCandidate)];
}

export async function getPersonalBests(userId, { sport, from, to } = {}) {
  const all = await getActivities(userId);
  // Por defecto solo carreras: si no, el fallback por distancia total mete bicis
  // (una salida de 42 km saldría como "maratón").
  const list = filterActivities(all, { sport, from, to, only_running: !sport });
  return { records: computePersonalBests(list) };
}

// ── Récords personales analíticos (best_efforts, moving_time, top-N, HR) ──────
// Distancias canónicas de best_effort, identificadas por sus METROS (no por el
// nombre): Strava localiza los nombres según el idioma de la cuenta ("10 km",
// "1 milla", "media maratón"), así que casar por texto fallaba en silencio.
const CANON_EFFORTS = [
  { id: '400m', m: 400 }, { id: '1/2 mile', m: 805 }, { id: '1k', m: 1000 },
  { id: '1 mile', m: 1609 }, { id: '2 mile', m: 3219 }, { id: '5k', m: 5000 },
  { id: '10k', m: 10000 }, { id: '15k', m: 15000 }, { id: '10 mile', m: 16093 },
  { id: '20k', m: 20000 }, { id: 'half-marathon', m: 21097 }, { id: '30k', m: 30000 },
  { id: 'marathon', m: 42195 }, { id: '50k', m: 50000 },
];
const BEST_EFFORT_ORDER = CANON_EFFORTS.map((e) => e.id);
const effortOrder = (k) => { const i = BEST_EFFORT_ORDER.indexOf(k); return i < 0 ? 999 : i; };

// metros → id canónico (tolerancia 1.5%, sobrada para las distancias estándar).
function canonEffortByMeters(m) {
  if (!m) return null;
  let best = null;
  for (const e of CANON_EFFORTS) {
    const rel = Math.abs(m - e.m) / e.m;
    if (rel <= 0.015 && (!best || rel < best.rel)) best = { id: e.id, rel };
  }
  return best?.id ?? null;
}
// id canónico de un best_effort de Strava: por metros primero, nombre como fallback.
const effortId = (e) => canonEffortByMeters(e?.distance) || (e?.name ? e.name.toLowerCase() : null);

// Interpreta la distancia que pide el usuario en cualquier formato/idioma
// ("10k", "10 km", "10000m", "1 milla", "media maratón") → id canónico.
function parseDistanceInput(input) {
  const s = String(input || '').toLowerCase().trim();
  if (!s) return null;
  if (BEST_EFFORT_ORDER.includes(s)) return s;
  if (/^(media|half)$/.test(s) || /(media|half)[\s-]*marat/.test(s) || s === 'hm') return 'half-marathon';
  if (/marat(h?[oó]n)?$/.test(s)) return 'marathon';
  const mile = s.match(/([\d.]+)\s*(mile|milla|millas)/);
  if (mile) return canonEffortByMeters(parseFloat(mile[1]) * 1609.344);
  if (/^(mile|milla)$/.test(s)) return '1 mile';
  const km = s.match(/([\d.]+)\s*k(m)?\b/);
  if (km) return canonEffortByMeters(parseFloat(km[1]) * 1000);
  const m = s.match(/([\d.]+)\s*m\b/);
  if (m) return canonEffortByMeters(parseFloat(m[1]));
  const num = s.match(/^([\d.]+)$/);
  if (num) { const v = parseFloat(num[1]); return canonEffortByMeters(v < 100 ? v * 1000 : v); }
  return null;
}

// Distancias realmente presentes en los datos (con su recuento), para orientar al
// usuario cuando pide una que no existe o escribe mal el nombre.
function availableEfforts(list) {
  const counts = new Map();
  for (const a of list) {
    for (const e of a.best_efforts || []) {
      const id = effortId(e);
      if (id && effortTime(e)) counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((x, y) => effortOrder(x[0]) - effortOrder(y[0]))
    .map(([distance, count]) => ({ distance, count }));
}

// Tiempo del esfuerzo: moving_time (no el de pared), como pidió el atleta.
const effortTime = (e) => e.moving_time || e.elapsed_time || 0;

/**
 * Récords por distancia desde best_efforts: top-N (5 por defecto, tope 10) por
 * moving_time, con actividad, fecha, FC media y origen de FC. `from/to` acota a
 * "récord de temporada".
 */
export async function getPersonalRecords(userId, { sport, from, to, top = 5 } = {}) {
  const all = await getActivities(userId);
  const list = filterActivities(all, { from, to, sport, only_running: !sport });
  const n = Math.min(Math.max(top, 1), 10);
  const byDist = new Map();
  for (const a of list) {
    for (const e of a.best_efforts || []) {
      const t = effortTime(e);
      const key = effortId(e);
      if (!t || !key) continue;
      if (!byDist.has(key)) byDist.set(key, []);
      byDist.get(key).push({
        distance_m: e.distance, time: t,
        activity_id: a.id, activity_name: a.name, date: a.start_date,
        avg_hr: a.average_heartrate ?? null, hr_source: a._garmin?.hr_source ?? null,
      });
    }
  }
  const records = [...byDist.entries()]
    .sort((x, y) => effortOrder(x[0]) - effortOrder(y[0]))
    .map(([key, cands]) => {
      const topN = cands.sort((p, q) => p.time - q.time).slice(0, n).map((c, i) => ({
        rank: i + 1,
        time: fmtTime(c.time), time_s: c.time,
        pace_per_km: calcPace(c.distance_m / c.time),
        activity_id: c.activity_id, activity_name: c.activity_name, date: c.date,
        avg_hr: c.avg_hr, hr_source: c.hr_source,
      }));
      return { distance: key, distance_m: Math.round(cands[0].distance_m), top: topN };
    });
  return { count: records.length, records };
}

/**
 * Progresión temporal de una distancia: el best_effort de cada actividad en orden
 * cronológico, marcando el récord acumulado. Para una gráfica de progreso real.
 */
export async function getBestEffortsProgression(userId, { distance, sport, from, to } = {}) {
  if (!distance) return { error: 'Falta "distance" (p.ej. "5k", "10k", "half-marathon", "marathon").' };
  const all = await getActivities(userId);
  const list = filterActivities(all, { from, to, sport, only_running: !sport });
  const key = parseDistanceInput(distance);
  if (!key) {
    return { error: `No reconozco la distancia "${distance}".`, available: availableEfforts(list) };
  }
  // Contexto ALL-TIME (sin from/to): el récord real de la distancia. Sin esto, un
  // 10k lento marcado como "PR" dentro de una ventana engaña al agente ("récord de
  // forma") aunque tu marca real sea mucho mejor.
  const allTimeList = filterActivities(all, { sport, only_running: !sport });
  const allEfforts = [];
  for (const a of allTimeList) {
    const e = (a.best_efforts || []).find((x) => effortId(x) === key);
    const t = e ? effortTime(e) : 0;
    if (t) allEfforts.push({ activity_id: a.id, date: a.start_date, time_s: t });
  }
  allEfforts.sort((x, y) => new Date(x.date) - new Date(y.date));
  let atBest = Infinity;
  const alltimePrIds = new Set();     // actividades que fijaron un récord all-time
  let alltimeBest = null;
  for (const p of allEfforts) {
    if (p.time_s < atBest) { atBest = p.time_s; alltimePrIds.add(p.activity_id); }
    if (!alltimeBest || p.time_s < alltimeBest.time_s) alltimeBest = p;
  }

  const series = [];
  for (const a of list) {
    const e = (a.best_efforts || []).find((x) => effortId(x) === key);
    const t = e ? effortTime(e) : 0;
    if (!t) continue;
    series.push({
      date: a.start_date,
      time: fmtTime(t), time_s: t,
      pace_per_km: calcPace(e.distance / t),
      activity_id: a.id, activity_name: a.name,
      avg_hr: a.average_heartrate ?? null, hr_source: a._garmin?.hr_source ?? null,
    });
  }
  series.sort((x, y) => new Date(x.date) - new Date(y.date));
  let winBest = Infinity;
  for (const p of series) {
    p.is_window_pr = p.time_s < winBest;               // mejor dentro del rango pedido
    if (p.is_window_pr) winBest = p.time_s;
    p.is_alltime_pr = alltimePrIds.has(p.activity_id); // récord real de la distancia
  }
  const alltime_best = alltimeBest
    ? { time: fmtTime(alltimeBest.time_s), time_s: alltimeBest.time_s, date: alltimeBest.date, activity_id: alltimeBest.activity_id }
    : null;
  // Distancia válida pero sin registros: guía al usuario con lo que sí hay.
  if (!series.length) return { distance: key, count: 0, series, alltime_best, available: availableEfforts(list) };
  return { distance: key, count: series.length, alltime_best, series };
}

// El baseline de Garmin puede venir como número o como objeto con el rango
// balanceado ({ balancedLow, balancedUpper, ... }). Lo normalizamos a {low, high}.
function normalizeBaseline(b) {
  if (!b || typeof b !== 'object') return null; // Garmin lo manda como objeto de rango
  return { low: b.balancedLow ?? b.lowUpper ?? null, high: b.balancedUpper ?? null }; // rango balanceado en ms
}
// Dirección de la desviación respecto al rango balanceado. Clave: `hrv_status`
// "UNBALANCED" no dice el sentido, y una VFC ALTA (buena) sale igual que una baja;
// automatizar el semáforo con ese campo da la señal invertida.
function hrvDeviation(hrv, base) {
  if (hrv == null || !base) return null;
  if (base.high != null && hrv > base.high) return 'above';
  if (base.low != null && hrv < base.low) return 'below';
  if (base.low != null || base.high != null) return 'within';
  return null;
}

/**
 * VFC nocturna + FC reposo por día (garmin_cardiac_data). Cada fila lleva
 * `hrv_deviation` (above/below/within respecto al rango balanceado de Garmin). El
 * baseline (rango) y la media móvil de 7 días van en `current`, no repetidos por fila.
 */
export async function getHrvResting(userId, { from, to } = {}) {
  const rows = ((await readKey(userId, 'garmin_cardiac_data')) || [])
    .filter((r) => (r.hrv != null || r.restingHR != null) && inRange(r.date + 'T12:00:00', from, to))
    .sort((a, b) => b.date.localeCompare(a.date)) // reciente primero
    .map((r) => ({
      date: r.date,
      hrv_ms: r.hrv ?? null,
      resting_hr: r.restingHR ?? null,
      hrv_status: r.hrvStatus ?? null,
      hrv_deviation: hrvDeviation(r.hrv, normalizeBaseline(r.baseline)),
      body_battery_low: r.bbLow ?? null,
      body_battery_high: r.bbHigh ?? null,
    }));
  const avg = (vals) => (vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null);
  const hrv7 = avg(rows.map((r) => r.hrv_ms).filter((v) => typeof v === 'number').slice(0, 7));
  // La noche de HRV más reciente (rows[0] podría ser un día solo con FC reposo): el
  // baseline y la desviación deben salir de la misma noche para no mezclar fechas.
  const curRaw = ((await readKey(userId, 'garmin_cardiac_data')) || [])
    .filter((r) => r.hrv != null && inRange(r.date + 'T12:00:00', from, to))
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  const base = curRaw ? normalizeBaseline(curRaw.baseline) : null;
  const current = curRaw ? {
    date: curRaw.date,
    hrv_ms: curRaw.hrv,
    hrv_7d_avg: hrv7,
    hrv_baseline: base,                                 // { low, high, marker }
    hrv_deviation: hrvDeviation(curRaw.hrv, base),      // above | below | within
    hrv_status: curRaw.hrvStatus ?? null,
    resting_hr: curRaw.restingHR ?? null,
  } : null;
  return { count: rows.length, current, rows };
}

// ── Modelo de Banister: CTL / ATL / TSB desde la carga por sesión ────────────
const toISODate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Lunes (ISO) de la semana de una fecha YYYY-MM-DD.
function mondayOf(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // Lun=0
  d.setDate(d.getDate() - day);
  return toISODate(d);
}

// Colapsa la serie diaria a semanal: CTL/ATL y forma al CIERRE de la semana (último
// día) + carga total. En una fila semanal `tsb_today` no significa nada, así que la
// forma se expone como `tsb_week_end`. Reduce ~7× el payload para un LLM.
function toWeekly(series) {
  const byWeek = new Map();
  for (const s of series) {
    const wk = mondayOf(s.date);
    const acc = byWeek.get(wk) || { week_start: wk, week_end: s.date, load_week: 0, last: null };
    acc.load_week += s.load || 0;
    acc.week_end = s.date;
    acc.last = s; // series va cronológica → el último visto es el más reciente
    byWeek.set(wk, acc);
  }
  return [...byWeek.values()].map(({ week_start, week_end, load_week, last }) => ({
    week_start, week_end, load_week: Math.round(load_week),
    ctl: last.ctl, atl: last.atl, tsb_week_end: last.tsb_today,
  }));
}

/**
 * Serie de carga crónica (CTL, 42 d), aguda (ATL, 7 d) y forma (TSB) por medias
 * móviles exponenciales sobre el training_load de Garmin. Sin ingesta.
 * - `tsb`: forma con la convención TrainingPeaks (CTL−ATL del día ANTERIOR).
 * - `tsb_today`: CTL−ATL del propio día (evita el desfase al leerlo junto a CTL/ATL).
 * - `granularity: 'weekly'` colapsa a semana; `summary_only` devuelve solo `current`.
 */
export async function getTrainingLoadModel(userId, { from, to, granularity = 'daily', summary_only = false } = {}) {
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
    series.push({
      date: iso, load: round(load, 0),
      ctl: round(ctl, 1), atl: round(atl, 1),
      tsb: round(tsb, 1), tsb_today: round(ctl - atl, 1),
    });
  }
  const ranged = series.filter((s) => inRange(s.date, from, to));
  const daily = ranged.length ? ranged : series;
  const lastRow = daily[daily.length - 1] || null;
  const weekly_ramp = daily.length > 7 ? round(daily[daily.length - 1].ctl - daily[daily.length - 8].ctl, 1) : null;
  const current = lastRow ? { ...lastRow, weekly_ramp } : null;
  if (summary_only) return { current, granularity: 'summary' };
  const out = granularity === 'weekly' ? toWeekly(daily) : daily;
  return { current, granularity, count: out.length, series: out };
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
  const withHrv = rows.filter((r) => r.hrv != null).length;
  const withBB = rows.filter((r) => r.bbHigh != null).length;
  // `evaluated` distingue "todo bien" (reglas corridas sobre datos) de "no evalúa"
  // (sin datos): un count 0 a secas no lo dejaba claro.
  return {
    count: filtered.length,
    alerts: filtered,
    evaluated: {
      days: rows.length,
      days_with_hrv: withHrv,
      days_with_body_battery: withBB,
      rules: ['body_battery_low_streak (BB máx <55 dos noches)', 'hrv_down_rhr_up (VFC <90% baseline y FC reposo >+3)'],
      status: rows.length ? (filtered.length ? 'alertas' : 'sin alertas') : 'sin datos',
    },
  };
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
  const pace = calcPace(dist / best.time);
  const third = Math.max(1, Math.floor(seg.length / 3));
  const hrAvg = (arr) => arr.reduce((s, x) => s + x.average_heartrate, 0) / arr.length;
  const drift = (hrAvg(seg.slice(-third)) / hrAvg(seg.slice(0, third)) - 1) * 100;
  // Ventana detectada, para poder auditar el recorte (desde qué minuto/km).
  const startIdx = splits.indexOf(seg[0]);
  const beforeTime = splits.slice(0, Math.max(0, startIdx)).reduce((s, x) => s + (x.moving_time || 0), 0);
  // Con deriva alta fue un esfuerzo progresivo, no un TT constante: el LTHR/ritmo
  // estimados son poco fiables → los devolvemos en null (con el estimado aparte para
  // auditar) para que nadie los copie como referencia.
  const absDrift = Math.abs(drift);
  const confidence = absDrift < 3 ? 'high' : absDrift <= 5 ? 'medium' : 'low';
  const reliable = confidence !== 'low';
  return {
    duration_min: round(best.time / 60, 1),
    from_km: seg[0].split ?? null,
    to_km: seg[seg.length - 1].split ?? null,
    window_start_min: round(beforeTime / 60, 1),
    window_end_min: round((beforeTime + best.time) / 60, 1),
    lthr: reliable ? lthr : null,
    threshold_pace: reliable ? pace : null,
    hr_stabilized: absDrift < 3,
    hr_drift_pct: round(drift, 1),
    confidence,
    lthr_reliable: reliable,
    ...(reliable ? {} : {
      estimated_lthr: lthr,
      estimated_threshold_pace: pace,
      warning: 'FC derivó >5% (esfuerzo progresivo): LTHR/ritmo poco fiables, en null a propósito',
    }),
  };
}

// FCmax robusta: el máximo absoluto lo dispara cualquier spike de la banda/muñeca
// (p.ej. 214 con una máxima real de 194), y eso sube el umbral del 88% hasta hacer
// que no se detecte ningún test. Tomamos el percentil 98 de las FCmax por carrera de
// los últimos 12 meses (descarta spikes aislados) en un rango fisiológico plausible.
function estimateHrMax(activities) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  const pick = (arr) => arr
    .map((a) => a.max_heartrate)
    .filter((v) => typeof v === 'number' && v > 120 && v < 225)
    .sort((x, y) => x - y);
  let vals = pick(activities.filter((a) => new Date(a.start_date) >= cutoff));
  if (vals.length < 8) vals = pick(activities);   // histórico si el último año es escaso
  if (!vals.length) return null;
  const idx = Math.min(vals.length - 1, Math.floor(vals.length * 0.98));
  return vals[idx];
}

/**
 * Escanea el historial buscando tests de umbral. FCmax: `hr_max` si se pasa; si no,
 * estimación robusta (percentil 98 del último año) en vez del máximo absoluto.
 */
export async function detectThresholdTests(userId, { hr_max, from, to } = {}) {
  const all = await getActivities(userId);
  const hrMax = hr_max || estimateHrMax(all);
  const tests = filterActivities(all, { from, to, only_running: true })
    .map((a) => {
      const t = detectThresholdEffort(a, hrMax);
      return t ? { id: a.id, date: a.start_date, name: a.name, ...t } : null;
    })
    .filter(Boolean);
  return {
    hr_max_used: hrMax,
    hr_max_source: hr_max ? 'parámetro' : 'estimado (p98 últimos 12 meses)',
    count: tests.length,
    tests,
  };
}

/**
 * Sueño semanal (garmin_sleep_data). El ingest guardó ventanas rodantes solapadas
 * (p.ej. 28/7–3/8 y 27/7–2/8), así que deduplicamos por semana ISO (lunes): una fila
 * por semana, prefiriendo la que ya empieza en lunes.
 */
export async function getSleep(userId, { from, to } = {}) {
  const rows = (await readKey(userId, 'garmin_sleep_data')) || [];
  const byWeek = new Map(); // lunes ISO -> fila elegida
  for (const r of rows) {
    if (!r.weekStart || !inRange(r.weekStart + 'T12:00:00', from, to)) continue;
    const wk = mondayOf(r.weekStart);
    const prev = byWeek.get(wk);
    // Prefiere la ventana que ya arranca en lunes (weekStart === lunes ISO).
    if (!prev || (r.weekStart === wk && prev.weekStart !== wk)) byWeek.set(wk, r);
  }
  const today = toISODate(new Date());
  const thisMonday = mondayOf(today);
  const weeks = [...byWeek.values()]
    .sort((a, b) => (b.weekStart || '').localeCompare(a.weekStart || ''))
    .map((r) => ({
      week_start: r.weekStart,
      week_end: r.weekEnd,
      partial: (r.weekEnd || '') >= today, // semana aún en curso
      score: r.score ?? null,
      quality: r.quality ?? null,
      avg_duration_min: r.durationMin ?? null,
      rem_min: r.remMin ?? null,
      deep_min: r.deepMin ?? null,
      light_min: r.lightMin ?? null,
      awake_min: r.awakeMin ?? null,
    }));
  // La agregación semanal es un cache; la semana en curso puede no estar todavía.
  const out = { count: weeks.length, weeks };
  if (!weeks.some((w) => w.week_start >= thisMonday)) {
    out.note = 'La semana en curso puede no estar en el cache semanal; usa list_sleep_daily para las noches recientes.';
  }
  return out;
}
