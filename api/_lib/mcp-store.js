// ============================================================================
// mcp-store — capa de acceso a datos para el servidor MCP.
//
// Lee las filas del usuario en `user_storage` (Supabase) con la SERVICE ROLE key
// (salta RLS; el usuario ya viene resuelto y verificado desde el token OAuth) y
// reproduce el mismo reshape que hace el DataExporter del front, para que Claude
// y ChatGPT reciban exactamente los datos que la app ya expone.
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import { heatPenaltyPct, heatIntensityFactor } from './garmin-helpers.js';

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
  if (hit) _cache.delete(ck); // caducado: no dejar crecer el Map sin límite en lambdas calientes
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

/** Invalida la entrada cacheada de una clave (tras escribirla desde otro sitio). */
export function invalidateKey(userId, key) {
  _cache.delete(`${userId}:${key}`);
}

/**
 * Lectura saltándose el cache. La usa el sync antes de MEZCLAR y reescribir un
 * blob: partir de una copia de hasta 15 s de antigüedad puede pisar una escritura
 * reciente del front.
 */
export async function readKeyFresh(userId, key) {
  invalidateKey(userId, key);
  return readKey(userId, key);
}

/** Escribe (upsert) una clave del almacén del usuario y refresca el cache local. */
export async function writeKey(userId, key, value) {
  const str = JSON.stringify(value);
  const { error } = await service()
    .from('user_storage')
    .upsert({ user_id: userId, key, value: str, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' });
  if (error) throw new Error(`user_storage write "${key}": ${error.message}`);
  _cache.set(`${userId}:${key}`, { value, ts: Date.now() });
}

/** user_id de todos los usuarios que tienen guardada una clave dada (para el cron). */
export async function listUsersWithKey(key) {
  const { data, error } = await service()
    .from('user_storage')
    .select('user_id')
    .eq('key', key);
  if (error) throw new Error(`user_storage list "${key}": ${error.message}`);
  return [...new Set((data || []).map((r) => r.user_id))];
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
    distance_m: a.distance != null ? Math.round(a.distance) : null,
    moving_time_min: round(a.moving_time / 60),
    // Tiempo total de la sesión (puerta a puerta), no solo el que el reloj cuenta como
    // movimiento: en tiradas largas la diferencia llega a 5 min y es una métrica de
    // entrenamiento real (paradas en semáforos, avituallamiento) para maratón.
    elapsed_time_min: round(a.elapsed_time / 60),
    stopped_time_s: a.elapsed_time && a.moving_time
      ? Math.round(a.elapsed_time - a.moving_time) : null,
    ...(running
      ? { pace_per_km: calcPace(a.average_speed) }
      : { speed_kmh: round((a.average_speed || 0) * 3.6, 1) }),
    avg_hr: a.average_heartrate ?? null,
    max_hr: a.max_heartrate ?? null,
    // Nunca null: sin Garmin correlacionado el origen es desconocido, no "sin banda".
    hr_source: a._garmin?.hr_source ?? 'unknown',      // 'strap' | 'wrist' | 'unknown'
    hr_source_origin: a._garmin?.hr_source_origin ?? 'missing', // sensors | cutoff | missing
    elevation_gain_m: a.total_elevation_gain ?? null,
    has_laps: !!(a.laps && a.laps.length),
    has_garmin: !!a._garmin, // hay running dynamics de la banda correlacionados
  };
}

/** Lap real del reloj (garmin) con ritmo/GAP formateados. */
const shapeGarminLap = (l) => ({
  lap_index: l.lap_index,
  intensity_type: l.intensity_type,          // INTERVAL / REST / RECOVERY / ACTIVE …
  // distance_km redondeado a 2 decimales implica ±5 m, o sea ±1,7 s/km al derivar el
  // ritmo de un lap corto. El metro entero es el dato bueno para recalcular.
  distance_m: l.distance_m != null ? Math.round(l.distance_m) : null,
  distance_km: round(l.distance_m / 1000, 3),
  duration_s: l.duration_s != null ? round(l.duration_s, 1) : null,
  duration_min: round(l.duration_s / 60),
  pace_per_km: calcPace(l.avg_speed_ms),
  gap_pace_per_km: l.gap_speed_ms ? calcPace(l.gap_speed_ms) : null,
  avg_hr: l.avg_hr ?? null,
  max_hr: l.max_hr ?? null,
  cadence_spm: l.cadence_spm ?? null,  // Garmin: steps/min (ambas piernas)
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

// ── Calor: penalización recalculada en lectura ──────────────────────────────
// La penalización por WBGT se recalcula aquí en vez de servir la del cache por dos
// razones: (1) el cache guarda valores del modelo lineal viejo, que sobreestimaba el
// doble, y rehacer el sync de todo el histórico para corregirlo no compensa; (2) el
// ajuste por intensidad depende de la FC media de la sesión y de la FCmax del atleta,
// que no están disponibles en el momento del sync de Garmin.
//
// Se devuelven las DOS cifras: la de tabla (referencia a intensidad de competición) y
// la de esta sesión. Mezclarlas es justo el error que hacía inservible el número.
function shapeWeather(w, avgHr, hrMax) {
  if (!w) return null;
  const wbgt = w.wbgt_c;
  const race = heatPenaltyPct(wbgt);
  const pctHrMax = avgHr && hrMax ? (avgHr / hrMax) * 100 : null;
  const factor = heatIntensityFactor(pctHrMax);
  return {
    ...w,
    heat_penalty_pct: race == null ? null : round(race, 1),
    heat_penalty_basis: 'intensidad de competición (~90 % FCmax)',
    heat_penalty_session_pct: race != null && factor != null ? round(race * factor, 1) : null,
    intensity_factor: factor != null ? round(factor, 2) : null,
    pct_hr_max: pctHrMax != null ? round(pctHrMax, 1) : null,
    heat_note: factor == null
      ? 'Sin FC media o sin FCmax: solo se puede dar la penalización de tabla, que asume ritmo de competición y sobreestima un rodaje suave.'
      : 'heat_penalty_session_pct es la cifra aplicable a ESTA sesión; heat_penalty_pct es la referencia de tabla a ritmo de competición.',
  };
}

// ── Coherencia cabecera vs laps ─────────────────────────────────────────────
// La cabecera de Strava y la suma de los laps no siempre cuadran (pausas contadas de
// forma distinta, laps recortados): 11,31 km / 59,70 min de cabecera frente a 11,28 km
// / 60,46 min sumando laps son 5 s/km de diferencia, suficiente para invalidar una
// comparación de ritmos. Se avisa cuando la desviación pasa del 1 %.
const CONSISTENCY_TOL_PCT = 1;
function lapConsistency(a) {
  const laps = Array.isArray(a.laps) ? a.laps : [];
  if (!laps.length || !a.distance || !a.moving_time) return null;
  let dist = 0, time = 0;
  for (const l of laps) { dist += l.distance || 0; time += l.moving_time || 0; }
  if (!dist || !time) return null;
  const dPct = ((dist - a.distance) / a.distance) * 100;
  const tPct = ((time - a.moving_time) / a.moving_time) * 100;
  const off = Math.abs(dPct) > CONSISTENCY_TOL_PCT || Math.abs(tPct) > CONSISTENCY_TOL_PCT;
  const paceOf = (d, t) => (d && t ? calcPace(d / t) : null);
  return {
    consistent: !off,
    header: { distance_m: Math.round(a.distance), moving_time_s: a.moving_time, pace_per_km: paceOf(a.distance, a.moving_time) },
    laps_sum: { distance_m: Math.round(dist), moving_time_s: Math.round(time), pace_per_km: paceOf(dist, time), lap_count: laps.length },
    delta: {
      distance_m: Math.round(dist - a.distance),
      moving_time_s: Math.round(time - a.moving_time),
      distance_pct: round(dPct, 2),
      moving_time_pct: round(tPct, 2),
    },
    warning: off
      ? `La suma de los ${laps.length} laps no cuadra con la cabecera (>${CONSISTENCY_TOL_PCT} % de desviación). `
        + 'Los ritmos derivados de una y otra fuente NO son comparables entre sí; elige una y mantenla.'
      : null,
  };
}

// Secciones opcionales de get_activity. Por defecto van todas; con `include` el
// cliente pide solo las que necesita (una actividad completa ~10-12k tokens: la
// polyline y los laps triplicados —garmin.laps/laps/splits_metric— son el grueso).
const FULL_SECTIONS = ['garmin', 'laps', 'splits', 'best_efforts', 'flat_efforts', 'decoupling', 'gap', 'map'];

/**
 * Detalle completo. `include` (array) limita las secciones devueltas; el resumen base
 * (id, nombre, distancia, ritmo, FC…) va siempre. Sin `include` se devuelve todo.
 */
export function shapeFull(a, include = null, { hrMax = null } = {}) {
  const running = isRunning(a);
  const want = Array.isArray(include) && include.length
    ? new Set(include.map((s) => (s === 'splits_metric' ? 'splits' : s === 'polyline' ? 'map' : s)))
    : new Set(FULL_SECTIONS);
  const out = { ...shapeSummary(a) };

  if (want.has('garmin')) {
    out.garmin = a._garmin ? {
      garmin_id: a._garmin.garmin_id,
      hr_source: a._garmin.hr_source ?? 'unknown',                  // banda vs muñeca
      hr_source_origin: a._garmin.hr_source_origin ?? 'missing',    // cómo se supo
      data_quality: a._garmin.data_quality ?? null,
      dynamics: a._garmin.dynamics,      // cadencia, GCT, oscilación vertical, zancada…
      power: a._garmin.power,            // vatios de carrera
      training: a._garmin.training,      // training effect, carga, VO2max
      // temp, humedad, WBGT y penalización por calor, recalculada al vuelo: el valor
      // cacheado se generó con el modelo lineal antiguo (sobreestimaba ~×2) y el ajuste
      // por intensidad necesita la FC de la sesión, que aquí sí tenemos.
      weather: shapeWeather(a._garmin.weather, a.average_heartrate, hrMax),
      // Los laps reales del reloj pesan mucho (~3k tokens): solo si se piden con
      // include:["laps"]; así "garmin" trae dynamics/power/weather sin arrastrarlos.
      ...(want.has('laps') ? { laps: shapeGarminLaps(a._garmin.laps || []) } : {}),
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
      distance_m: l.distance != null ? Math.round(l.distance) : null,
      distance_km: round(l.distance / 1000, 3),
      moving_time_s: l.moving_time ?? null,
      elapsed_time_s: l.elapsed_time ?? null,
      moving_time_min: round(l.moving_time / 60),
      ...(running ? { pace_per_km: calcPace(l.average_speed) } : { speed_kmh: round((l.average_speed || 0) * 3.6, 1) }),
      avg_hr: l.average_heartrate ?? null,
      max_hr: l.max_heartrate ?? null,
      // Strava da la cadencia de CARRERA por pierna (~90) → x2 para spm de ambas, y así
      // coincide con la de Garmin (~180) en la misma respuesta. En bici NO se dobla:
      // ahí `average_cadence` ya son rpm de biela (doblarlo daba 170 rpm en un lap de 85).
      ...(running
        ? { cadence_spm: l.average_cadence ? round(l.average_cadence * 2, 1) : null }
        : { cadence_rpm: l.average_cadence ?? null }),
      elevation_gain_m: l.total_elevation_gain ?? null, // desnivel POSITIVO del lap
    }));
  }
  if (want.has('splits')) {
    out.splits_metric = (a.splits_metric || []).map((s) => ({
      split: s.split,
      distance_m: s.distance != null ? Math.round(s.distance) : null,
      distance_km: round(s.distance / 1000, 3),
      moving_time_s: s.moving_time ?? null,
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
  // Va siempre (es diminuto y su ausencia se leería como "todo cuadra"), aunque no se
  // hayan pedido los laps: precisamente ahí es donde más falta hace el aviso.
  const consistency = lapConsistency(a);
  if (consistency) out.data_consistency = consistency;
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
// Usar el ratio de coste como ratio de velocidad sobre-reacciona: la derivada de
// Minetti en cero es 19,5/3,6 = 5,4% de velocidad por cada 1% de pendiente, cuando
// lo aceptado empíricamente es ~2-3%. Amortiguamos la desviación relativa con K_*
// (calibración empírica, NO Minetti puro) y con asimetría: el crédito por bajar es
// menor que la penalización por subir, porque la bajada no se convierte entera en
// velocidad (frenada, coste excéntrico).
const K_UP = 0.5, K_DOWN = 0.35;
// Tope inferior = el factor a −10%. El polinomio de Minetti tiene su mínimo de coste
// mucho más abajo (≈ −18% en esta regresión), pero por debajo de −10% el coste real
// deja de bajar: la frenada y el trabajo excéntrico se comen el ahorro. Cortar ahí es
// el comportamiento correcto; el 0.88 anterior recortaba ya en −8% y aplanaba de más.
const GAP_FLOOR = 0.86, GAP_CEIL = 1.35;
const gapFactor = (grade) => {
  const c = minettiCost(grade);
  if (!(c > 0)) return 1;
  const rel = c / 3.6 - 1;
  const f = 1 + rel * (grade >= 0 ? K_UP : K_DOWN);
  return Math.min(GAP_CEIL, Math.max(GAP_FLOOR, f));
};

/** Ritmo ajustado por desnivel (GAP) agregado y por split, desde splits_metric. */
export function computeGap(a) {
  const splits = a.splits_metric;
  if (!Array.isArray(splits) || !splits.length) return null;
  let dist = 0, gapTime = 0, netElev = 0;
  const per_split = [];
  for (const s of splits) {
    const d = s.distance || 0;
    const sp = s.average_speed || 0;
    if (!d || !sp || d < 500) continue;              // ignora parciales cortos (ruido de pendiente)
    const grade = s.elevation_difference != null ? s.elevation_difference / d : 0;
    const gapSpeed = sp * gapFactor(grade);          // velocidad equivalente en llano
    dist += d; gapTime += d / gapSpeed; netElev += s.elevation_difference || 0;
    per_split.push({ split: s.split, grade_pct: round(grade * 100, 1), gap_pace: calcPace(gapSpeed) });
  }
  if (!dist || !gapTime) return null;
  // Etiquetado explícito: este GAP es cálculo propio (Minetti amortiguado sobre splits
  // por km) y NO coincide con `garmin.laps[].gap_pace` (avgGradeAdjustedSpeed del reloj,
  // modelo distinto y por lap). No mezclar: pueden diferir ~30 s/km en el mismo km.
  // El desnivel por split es NETO, así que las subidas y bajadas dentro de un mismo km
  // se cancelan antes de entrar al modelo: un km rompepiernas se procesa como llano.
  //
  // Ese sesgo es sistemático y hacia el lado equivocado: en un circuito ondulado el GAP
  // sale casi igual al ritmo real cuando debería salir algo más rápido (subir cuesta más
  // de lo que baja compensa). Publicamos el desnivel bruto de la actividad frente al neto
  // agregado para que se vea cuánta oscilación se ha perdido, en vez de fingir precisión.
  const gross = a.total_elevation_gain ?? null;
  const rolling = gross != null && Math.abs(netElev) < gross * 0.5;
  return {
    source: 'computed (Minetti amortiguado K_up=0.5/K_down=0.35, por split de 1 km, desnivel neto)',
    gap_pace: calcPace(dist / gapTime),
    elevation: {
      net_m: round(netElev, 0),                 // suma de los desniveles NETOS por split
      activity_gain_m: gross,                   // desnivel POSITIVO acumulado (Strava)
      splits_used: per_split.length,
    },
    // Aviso, no error: con estas dos cifras un agente sabe si puede fiarse del número.
    caveat: rolling
      ? 'Recorrido ondulado (desnivel bruto >> neto): el modelo trabaja sobre el desnivel neto por km, '
        + 'así que subidas y bajadas dentro del mismo km se cancelan y este GAP INFRAESTIMA el ajuste. '
        + 'Trátalo como cota inferior; para tramos concretos usa garmin.laps[].gap_pace.'
      : null,
    per_split,
  };
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

// ── Origen de la FC (banda vs muñeca) ───────────────────────────────────────
// `hr_source` solo existe en las actividades enriquecidas con el detalle de Garmin,
// así que el histórico venía `null` y era imposible distinguir "sin banda" de "no
// lo sé" — justo la diferencia que hace útil el filtro. Ahora:
//   · nunca se devuelve null: si no hay dato, es 'unknown';
//   · el usuario puede declarar desde cuándo lleva banda con la clave de
//     user_storage `hr_strap_since` ("YYYY-MM-DD", o { since, before }), y las
//     actividades sin dato a partir de esa fecha se resuelven como 'strap'.
// `hr_source_origin` dice siempre de dónde sale el valor: 'sensors' (leído de los
// sensores de Garmin), 'cutoff' (inferido de la fecha declarada) o 'missing'.
const HR_SOURCES = new Set(['strap', 'wrist', 'unknown']);

async function getHrSourcePolicy(userId) {
  const raw = await readKey(userId, 'hr_strap_since');
  const cfg = typeof raw === 'string' ? { since: raw } : (raw && typeof raw === 'object' ? raw : {});
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(cfg.since || '')) ? String(cfg.since) : null;
  const before = HR_SOURCES.has(cfg.before) ? cfg.before : 'unknown'; // qué asumir antes del corte
  return { since, before };
}

/** Resuelve hr_source/hr_source_origin de una actividad Garmin según la política. */
function resolveHrSource(g, policy) {
  if (HR_SOURCES.has(g?.hr_source)) return { hr_source: g.hr_source, hr_source_origin: 'sensors' };
  const day = String(g?.start_time || '').slice(0, 10);
  if (policy.since && day) {
    return { hr_source: day >= policy.since ? 'strap' : policy.before, hr_source_origin: 'cutoff' };
  }
  return { hr_source: 'unknown', hr_source_origin: 'missing' };
}

/** Aplica la política a la lista cruda de Garmin (no muta lo almacenado). */
function withHrSource(garmin, policy) {
  return garmin.map((g) => ({ ...g, ...resolveHrSource(g, policy) }));
}

/**
 * Actividades de Strava (reciente primero) con las running dynamics de Garmin
 * ya correlacionadas y adjuntas en `a._garmin` cuando hay coincidencia.
 */
export async function getActivities(userId) {
  const [raw, garminRaw, policy] = await Promise.all([
    readKey(userId, 'stravaData'),
    readKey(userId, 'garmin_activities'),
    getHrSourcePolicy(userId),
  ]);
  const list = Array.isArray(raw) ? raw : raw?.activities;
  if (!Array.isArray(list)) return [];
  const sorted = [...list].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
  const garmin = Array.isArray(garminRaw) ? garminRaw : garminRaw?.activities;
  if (Array.isArray(garmin) && garmin.length) attachGarmin(sorted, withHrSource(garmin, policy));
  return sorted;
}

/** Lista cruda de actividades de Garmin (garmin_activities) sin correlacionar. */
export async function getGarminActivitiesRaw(userId) {
  const [raw, policy] = await Promise.all([
    readKey(userId, 'garmin_activities'),
    getHrSourcePolicy(userId),
  ]);
  const list = Array.isArray(raw) ? raw : raw?.activities;
  return Array.isArray(list) ? withHrSource(list, policy) : [];
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
    hr_source: g.hr_source ?? 'unknown',
    hr_source_origin: g.hr_source_origin ?? 'missing',
    cadence_spm: d.cadence_spm ?? null,
    ground_contact_ms: d.ground_contact_ms ?? null,
    gct_balance_pct: d.gct_balance_pct ?? null,
    gct_balance_source: d.gct_balance_source ?? null, // 'laps' si se reconstruyó
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

// Los calentamientos y vueltas a la calma que el reloj graba sueltos (1-2 km trotando)
// entran en la media con el mismo peso que una tirada de 20 km y la ensucian: cadencia
// baja, GCT alto, zancada corta. Se excluyen por defecto; `min_distance_km: 0` los
// recupera. Los runs excluidos siguen contándose en `_diagnostics`.
const DYNAMICS_MIN_KM = 3;

/**
 * Running dynamics leyendo de `garmin_activities` directamente (la dinámica vive
 * ahí), con Strava como enriquecimiento opcional por hora de inicio. Incluye un
 * bloque `_diagnostics` que localiza en qué capa se rompe si salen cero filas.
 */
export async function listRunningDynamics(userId,
  { from, to, limit = 50, offset = 0, min_distance_km = DYNAMICS_MIN_KM } = {}) {
  const garmin = await getGarminActivitiesRaw(userId);
  const stravaRaw = await readKey(userId, 'stravaData');
  const stravaList = Array.isArray(stravaRaw) ? stravaRaw : (stravaRaw?.activities || []);

  const byMin = new Map();
  for (const s of stravaList) {
    const t = Date.parse(s.start_date);
    if (!Number.isNaN(t)) byMin.set(Math.round(t / 60000), s);
  }
  const runs = garmin.filter((g) => (g.type || '').includes('run'));

  const minKm = Math.max(0, min_distance_km ?? 0);
  let correlated = 0, tooShort = 0;
  const rows = [];
  for (const g of runs) {
    if (g.start_time && !inRange(g.start_time, from, to)) continue;
    if (minKm && (g.distance_m ?? 0) / 1000 < minKm) { tooShort++; continue; }
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
    count: rows.length,                                  // total en el rango (ya filtrado)
    offset: off, limit: lim,
    // Las medias se calculan SOLO sobre los runs que pasan min_distance_km, para que un
    // calentamiento suelto de 1,6 km a 7:06 no arrastre la cadencia media hacia abajo.
    min_distance_km: minKm,
    excluded_short_runs: tooShort,
    averages: Object.fromEntries(DYNAMICS_METRICS.map((m) => [m, avg(m)])), // medias sobre el rango filtrado
    runs: rows.slice(off, off + lim),                    // página, para no saturar el contexto
    _diagnostics: {
      garmin_activities_loaded: garmin.length,
      garmin_runs: runs.length,
      runs_excluded_by_min_distance: tooShort,
      runs_with_dynamics: rows.length,
      strava_activities_loaded: stravaList.length,
      strava_correlated: correlated,
      // `garmin_activities` es la MISMA clave que alimenta el bloque `garmin` de
      // get_activity: no hay dos rutas de datos. Si aquí sale 0, get_activity también
      // devuelve garmin:null; si allí ves dinámica, es que la clave se vació después.
      hint:
        garmin.length === 0 ? 'garmin_activities VACÍO en user_storage → vuelve a sincronizar Garmin desde la app. Es la misma clave que usa get_activity, así que ahí también saldrá garmin:null.'
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

// ── Comparador de sesiones equivalentes ──────────────────────────────────────
// "Todas mis salidas llanas de 10 km con FC entre 142 y 152". La gracia no es filtrar
// (eso ya lo hace list_activities) sino poner las sesiones comparables una al lado de
// otra con la métrica que decide si hay progreso: el índice de eficiencia (metros
// recorridos por latido). El ritmo solo no vale, porque un día vas a 150 ppm y otro a
// 145; m/latido normaliza el coste cardíaco y hace la serie comparable.
const efficiencyIndex = (distanceM, timeS, avgHr) =>
  distanceM && timeS && avgHr ? (distanceM / timeS) / (avgHr / 60) : null;

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Sesiones equivalentes a una referencia (o a unos criterios sueltos), con eficiencia
 * y tendencia. `reference_id` toma distancia y FC de esa actividad y busca sus pares.
 */
export async function compareSimilarSessions(userId, {
  reference_id, distance_km, distance_tolerance_pct = 10,
  avg_hr_min, avg_hr_max, hr_tolerance_bpm = 5,
  flat_only, from, to, sport, limit = 25,
} = {}) {
  const all = await getActivities(userId);
  const hrMax = estimateHrMax(all);

  let reference = null;
  if (reference_id != null) {
    reference = all.find((x) => String(x.id) === String(reference_id));
    if (!reference) return { error: `Actividad de referencia ${reference_id} no encontrada.` };
    // De la referencia salen la distancia y la banda de FC; lo que venga explícito manda.
    distance_km = distance_km ?? (reference.distance || 0) / 1000;
    if (reference.average_heartrate) {
      avg_hr_min = avg_hr_min ?? reference.average_heartrate - hr_tolerance_bpm;
      avg_hr_max = avg_hr_max ?? reference.average_heartrate + hr_tolerance_bpm;
    }
  }
  if (!distance_km) {
    return { error: 'Hace falta distance_km o reference_id para definir qué sesiones son equivalentes.' };
  }

  const tol = Math.max(0, distance_tolerance_pct) / 100;
  const matched = filterActivities(all, {
    from, to, sport, only_running: !sport, flat_only,
    min_distance_km: distance_km * (1 - tol),
    max_distance_km: distance_km * (1 + tol),
    avg_hr_min, avg_hr_max,
  });

  const sessions = matched
    .map((a) => {
      const eff = efficiencyIndex(a.distance, a.moving_time, a.average_heartrate);
      const gap = computeGap(a);
      const weather = shapeWeather(a._garmin?.weather, a.average_heartrate, hrMax);
      return {
        id: a.id,
        date: a.start_date,
        name: a.name,
        distance_m: Math.round(a.distance || 0),
        moving_time_s: a.moving_time ?? null,
        elapsed_time_s: a.elapsed_time ?? null,
        pace_per_km: calcPace(a.average_speed),
        gap_pace_per_km: gap?.gap_pace ?? null,
        avg_hr: a.average_heartrate ?? null,
        hr_source: a._garmin?.hr_source ?? 'unknown',
        elevation_gain_m: a.total_elevation_gain ?? null,
        // m/latido: sube cuando corres más rápido al mismo pulso, o igual de rápido con
        // menos pulso. Es la cifra que hay que mirar para juzgar la serie.
        efficiency_m_per_beat: eff != null ? round(eff, 3) : null,
        wbgt_c: weather?.wbgt_c ?? null,
        heat_penalty_session_pct: weather?.heat_penalty_session_pct ?? null,
      };
    })
    .sort((x, y) => new Date(y.date) - new Date(x.date));

  const effs = sessions.map((s) => s.efficiency_m_per_beat).filter((v) => typeof v === 'number');
  const speeds = sessions
    .filter((s) => s.distance_m && s.moving_time_s)
    .map((s) => s.distance_m / s.moving_time_s);

  // Tendencia: mitad reciente vs mitad antigua. Con menos de 4 sesiones no se informa;
  // dos puntos no son una tendencia y darla invitaría a leer ruido como progreso.
  let trend = null;
  if (effs.length >= 4) {
    const chrono = [...sessions].reverse().filter((s) => s.efficiency_m_per_beat != null);
    const half = Math.floor(chrono.length / 2);
    const older = median(chrono.slice(0, half).map((s) => s.efficiency_m_per_beat));
    const recent = median(chrono.slice(chrono.length - half).map((s) => s.efficiency_m_per_beat));
    if (older && recent) {
      trend = {
        older_median_m_per_beat: round(older, 3),
        recent_median_m_per_beat: round(recent, 3),
        change_pct: round((recent / older - 1) * 100, 1),
        window: `${half} sesiones más antiguas vs ${half} más recientes`,
      };
    }
  }

  return {
    criteria: {
      distance_km: round(distance_km, 2),
      distance_range_km: [round(distance_km * (1 - tol), 2), round(distance_km * (1 + tol), 2)],
      avg_hr_min: avg_hr_min ?? null, avg_hr_max: avg_hr_max ?? null,
      flat_only: !!flat_only, from: from ?? null, to: to ?? null,
      reference_id: reference ? reference.id : null,
    },
    count: sessions.length,
    aggregates: {
      median_pace_per_km: speeds.length ? calcPace(median(speeds)) : null,
      fastest_pace_per_km: speeds.length ? calcPace(Math.max(...speeds)) : null,
      slowest_pace_per_km: speeds.length ? calcPace(Math.min(...speeds)) : null,
      median_efficiency_m_per_beat: effs.length ? round(median(effs), 3) : null,
      best_efficiency_m_per_beat: effs.length ? round(Math.max(...effs), 3) : null,
    },
    trend,
    sessions: sessions.slice(0, Math.min(100, Math.max(1, limit))),
    note: sessions.length < 3
      ? 'Muy pocas sesiones equivalentes: sube distance_tolerance_pct o amplía la banda de FC.'
      : null,
  };
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
    return { id: a.id, name: a.name, start_date: a.start_date, time: effort.moving_time || effort.elapsed_time, distance: effort.distance, isEffort: a.distance > range.max, isFlat: false, source: 'best_effort' };
  }
  const time = a.moving_time || a.elapsed_time;
  if (a.distance >= range.min && a.distance <= range.max && time > 0) {
    return { id: a.id, name: a.name, start_date: a.start_date, time, distance: a.distance, isEffort: false, isFlat: false, source: 'total_distance' };
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
  const usedEff = !!(eff && eff.time > 0);
  const best = usedEff ? eff : pbFlatFromSplits(a, range);
  if (!best) return null;
  return { id: a.id, name: a.name, start_date: a.start_date, time: best.time, distance: best.distance, isEffort: true, isFlat: true, source: usedEff ? 'flat_effort' : 'splits_window' };
}

/**
 * Personal Bests (5K/10K/HM/Maratón + Flat 1K/2K), top-5 por distancia.
 * NUNCA se reescala el tiempo: se usa el best_effort exacto de Strava cuando existe
 * (distance_delta_m = 0) y, si no, el tiempo REAL sobre la distancia total, marcando
 * `distance_delta_m` como aviso. Reescalar a la distancia estándar fabricaría marcas
 * que no se han corrido (un 5097 m no es un 5000 m más rápido, son 97 m de GPS).
 * Orden por tiempo real: para esfuerzos sobre-distancia, ese tiempo es una cota
 * superior honesta del tiempo a la distancia estándar (nunca inventa uno más rápido).
 */
export function computePersonalBests(activities) {
  const build = (ranges, candFn) => ranges.map((range) => {
    const top = activities
      .map((a) => candFn(a, range))
      .filter(Boolean)
      .sort((x, y) => x.time - y.time)   // tiempo REAL, sin reescalar
      .slice(0, 5)
      .map((c) => ({
        id: c.id, name: c.name, date: c.start_date,
        time: fmtTime(c.time), time_s: Math.round(c.time),
        pace_per_km: calcPace(c.distance / c.time),
        distance_m: Math.round(c.distance),
        distance_delta_m: Math.round(c.distance - range.std), // 0 = distancia exacta; >0 = sobre-distancia (tiempo es cota superior)
        exact: Math.abs(c.distance - range.std) <= 15,         // best_effort/parcial a la distancia justa
        source: c.source,                                      // best_effort | total_distance | flat_effort | splits_window
        is_effort: !!c.isEffort, is_flat: !!c.isFlat,
      }));
    // PR = el tiempo real más rápido (top[0]). Un tiempo sobre-distancia es una COTA
    // SUPERIOR del tiempo a la distancia estándar (correr 21.47 km en 1:36:32 implica
    // ≤1:36:32 en los 21.097 km): si ya bate a una marca `exact` más lenta, el PR real
    // es aún mejor. La versión anterior degradaba el sobre-distancia a la `exact` cuando
    // el margen pasaba del 1%, y así ocultaba carreras reales medidas un poco largas
    // (una C21 de 21.47 km quedaba tapada por una media más lenta a distancia justa).
    const pr = top[0];
    return top.length ? { id: range.id, name: range.name, distance_m: range.std, pr, top } : null;
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
const CANON_M = Object.fromEntries(CANON_EFFORTS.map((e) => [e.id, e.m])); // id → metros de referencia
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

// Distancia TOTAL de una actividad → id canónico si la actividad ES esa distancia (una
// carrera clavada). Todo el histórico previo al ingest de efforts trae `best_efforts: []`;
// para una carrera, el tiempo de actividad es prácticamente su best_effort, así que lo
// sintetizamos. Rango asimétrico [−0.2%, +3%]: las carreras miden justo o un poco largas
// por GPS/vueltas, nunca cortas. Las tolerancias no solapan entre distancias canónicas.
function raceDistanceId(m) {
  if (!m) return null;
  for (const e of CANON_EFFORTS) {
    if (m >= e.m * 0.998 && m <= e.m * 1.03) return e.id;
  }
  return null;
}

// Esfuerzo de una actividad para una distancia canónica: best_effort real de Strava si
// existe; si no, sintetizado desde la distancia total cuando la actividad ES esa carrera
// (histórico sin efforts poblados). `source`: 'best_effort' | 'total_distance'. El tiempo
// sobre-distancia es una cota superior honesta del tiempo a la distancia estándar.
function effortForKey(a, key) {
  const e = (a.best_efforts || []).find((x) => effortId(x) === key);
  const t = e ? effortTime(e) : 0;
  if (t) return { distance_m: e.distance, time: t, source: 'best_effort' };
  if (raceDistanceId(a.distance) === key) {
    const tt = a.moving_time || a.elapsed_time || 0;
    if (tt) return { distance_m: a.distance, time: tt, source: 'total_distance' };
  }
  return null;
}

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
  const push = (key, cand) => {
    if (!byDist.has(key)) byDist.set(key, []);
    byDist.get(key).push(cand);
  };
  for (const a of list) {
    const base = { activity_id: a.id, activity_name: a.name, date: a.start_date,
      avg_hr: a.average_heartrate ?? null, hr_source: a._garmin?.hr_source ?? 'unknown' };
    const seen = new Set();
    for (const e of a.best_efforts || []) {
      const t = effortTime(e);
      const key = effortId(e);
      if (!t || !key) continue;
      seen.add(key);
      push(key, { distance_m: e.distance, time: t, source: 'best_effort', ...base });
    }
    // Fallback histórico: carrera clavada cuyo best_efforts está vacío (todo lo previo
    // al ingest de efforts). Sin esto, `personal_records` arrancaba en otoño 2025 e
    // ignoraba años de carreras reales (medias, 10K…).
    const rk = raceDistanceId(a.distance);
    if (rk && !seen.has(rk)) {
      const t = a.moving_time || a.elapsed_time || 0;
      if (t) push(rk, { distance_m: a.distance, time: t, source: 'total_distance', ...base });
    }
  }
  const records = [...byDist.entries()]
    .sort((x, y) => effortOrder(x[0]) - effortOrder(y[0]))
    .map(([key, cands]) => {
      const std = CANON_M[key] ?? null;
      const topN = cands.sort((p, q) => p.time - q.time).slice(0, n).map((c, i) => ({
        rank: i + 1,
        time: fmtTime(c.time), time_s: c.time,
        pace_per_km: calcPace(c.distance_m / c.time),
        distance_m: Math.round(c.distance_m),
        distance_delta_m: std != null ? Math.round(c.distance_m - std) : null, // >0 = sobre-distancia (tiempo es cota superior)
        source: c.source,                                                      // best_effort | total_distance
        activity_id: c.activity_id, activity_name: c.activity_name, date: c.date,
        avg_hr: c.avg_hr, hr_source: c.hr_source,
      }));
      return { distance: key, distance_m: std ?? Math.round(cands[0].distance_m), top: topN };
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
    const ef = effortForKey(a, key); // best_effort real o sintetizado desde distancia total
    if (ef) allEfforts.push({ activity_id: a.id, date: a.start_date, time_s: ef.time });
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
    const ef = effortForKey(a, key); // best_effort real o sintetizado desde distancia total
    if (!ef) continue;
    series.push({
      date: a.start_date,
      time: fmtTime(ef.time), time_s: ef.time,
      pace_per_km: calcPace(ef.distance_m / ef.time),
      source: ef.source,                                 // best_effort | total_distance
      activity_id: a.id, activity_name: a.name,
      avg_hr: a.average_heartrate ?? null, hr_source: a._garmin?.hr_source ?? 'unknown',
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
  return {
    low: b.balancedLow ?? b.lowUpper ?? null,   // límite bajo del rango balanceado (ms)
    high: b.balancedUpper ?? null,              // límite alto del rango balanceado (ms)
    marker: b.markerValue ?? null,              // posición del marcador de Garmin dentro del rango (ms)
  };
}
// Dirección de la desviación respecto al rango balanceado. Clave: `hrv_status`
// "UNBALANCED" no dice el sentido, y una VFC ALTA (buena) sale igual que una baja;
// automatizar el semáforo con ese campo da la señal invertida.
//
// SOLO se compara contra el rango balanceado [low, high]. NO usar `base.marker`:
// `markerValue` de Garmin no viene en ms comparables con la VFC (es una posición en
// otra escala), así que `hrv > marker` daba 'above' en casi todas las noches —incluso
// por debajo del rango— rompiendo el semáforo. `marker` se conserva solo informativo.
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
  // hrv_7d_avg: media móvil de 7 días sobre el HISTÓRICO COMPLETO, NO sobre el rango filtrado.
  // Así el semáforo HRV siempre lee el mismo valor independiente de from/to.
  const allHrvData = ((await readKey(userId, 'garmin_cardiac_data')) || [])
    .filter((r) => r.hrv != null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((r) => r.hrv);
  const hrv7 = avg(allHrvData.slice(0, 7));
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
  // Los baselines rodantes se calculan sobre TODO el histórico (necesitan las 30 noches
  // previas a cada día), pero los contadores de `evaluated` deben reflejar SOLO la
  // ventana pedida: si no, `days` sale igual (histórico completo) llames como llames y
  // parece que from/to se ignora.
  const windowRows = (from || to) ? rows.filter((r) => inRange(r.date + 'T12:00:00', from, to)) : rows;
  const withHrv = windowRows.filter((r) => r.hrv != null).length;
  const withBB = windowRows.filter((r) => r.bbHigh != null).length;
  // `evaluated` distingue "todo bien" (reglas corridas sobre datos) de "no evalúa"
  // (sin datos): un count 0 a secas no lo dejaba claro.
  return {
    count: filtered.length,
    alerts: filtered,
    evaluated: {
      days: windowRows.length,
      days_with_hrv: withHrv,
      days_with_body_battery: withBB,
      baseline_history_days: rows.length, // ventana usada para los baselines (histórico completo)
      rules: ['body_battery_low_streak (BB máx <55 dos noches)', 'hrv_down_rhr_up (VFC <90% baseline y FC reposo >+3)'],
      status: windowRows.length ? (filtered.length ? 'alertas' : 'sin alertas') : 'sin datos',
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
export function estimateHrMax(activities) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  const pick = (arr) => arr
    .map((a) => a.max_heartrate)
    .filter((v) => typeof v === 'number' && v > 120 && v < 225)
    .sort((x, y) => x - y);
  let vals = pick(activities.filter((a) => new Date(a.start_date) >= cutoff));
  if (vals.length < 8) vals = pick(activities);   // histórico si el último año es escaso
  if (!vals.length) return null;
  // Percentil 98 por rango-más-cercano: el índice se escala sobre (n−1), no sobre n.
  // Con n≤50, Math.floor(n*0.98) === n−1 y devolvía SIEMPRE el máximo (el spike que
  // esto debía descartar); escalar sobre (n−1) sí recorta la cola alta.
  const idx = Math.floor((vals.length - 1) * 0.98);
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

// ── Tiempo en zonas de FC (distribución polarizada) ──────────────────────────
// Zonas como % de FCmax (modelo de 5 zonas). Clasifica cada split por su FC MEDIA
// desde los datos cacheados (sin stream punto a punto): aproximado pero suficiente
// para ver el reparto easy/moderado/hard y verificar la polarización.
const HR_ZONES = [
  { zone: 1, name: 'Z1 recuperación', lo: 0.50, hi: 0.60 },
  { zone: 2, name: 'Z2 aeróbico', lo: 0.60, hi: 0.70 },
  { zone: 3, name: 'Z3 tempo', lo: 0.70, hi: 0.80 },
  { zone: 4, name: 'Z4 umbral', lo: 0.80, hi: 0.90 },
  { zone: 5, name: 'Z5 VO2max', lo: 0.90, hi: 2 },
];
function zoneOf(hr, hrMax) {
  if (!hr || !hrMax) return null;
  const pct = hr / hrMax;
  if (pct < 0.50) return 1;                          // por debajo de Z1 → recuperación
  return (HR_ZONES.find((z) => pct >= z.lo && pct < z.hi) || HR_ZONES[4]).zone;
}
// Reparte el tiempo de una actividad en zonas: por split si hay FC por split; si no,
// toda la sesión a la zona de su FC media. Devuelve segundos por zona + no clasificado.
function activityZoneSeconds(a, hrMax) {
  const secs = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let unclassified = 0;
  const splits = Array.isArray(a.splits_metric) ? a.splits_metric : [];
  if (splits.some((s) => s.average_heartrate)) {
    for (const s of splits) {
      const t = s.moving_time || 0;
      const z = zoneOf(s.average_heartrate, hrMax);
      if (z && t) secs[z] += t; else unclassified += t;
    }
  } else if (a.average_heartrate && a.moving_time) {
    const z = zoneOf(a.average_heartrate, hrMax);
    if (z) secs[z] += a.moving_time; else unclassified += a.moving_time;
  } else {
    unclassified += a.moving_time || 0;
  }
  return { secs, unclassified };
}
const zonesReport = (secs) => {
  const total = Object.values(secs).reduce((s, v) => s + v, 0);
  const pct = (v) => (total ? round((v / total) * 100, 1) : 0);
  return {
    total_min: Math.round(total / 60),
    zones: HR_ZONES.map((z) => ({ zone: z.zone, name: z.name, minutes: Math.round(secs[z.zone] / 60), pct: pct(secs[z.zone]) })),
    // 3 zonas para polarización: fácil (Z1-2) / moderado (Z3) / duro (Z4-5).
    polarized: { easy_pct: pct(secs[1] + secs[2]), moderate_pct: pct(secs[3]), hard_pct: pct(secs[4] + secs[5]) },
  };
};

/**
 * Tiempo en zonas de FC en un rango. `granularity=weekly` da el reparto por semana
 * (para seguir la polarización). FCmax: `hr_max` o estimación robusta.
 */
export async function getTimeInZones(userId, { from, to, sport, hr_max, granularity = 'total' } = {}) {
  const all = await getActivities(userId);
  const hrMax = hr_max || estimateHrMax(all);
  const list = filterActivities(all, { from, to, sport, only_running: !sport });
  const totals = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byWeek = new Map();
  const per_activity = [];
  let unclassifiedSec = 0;
  for (const a of list) {
    const { secs, unclassified } = activityZoneSeconds(a, hrMax);
    unclassifiedSec += unclassified;
    const actTotal = Object.values(secs).reduce((s, v) => s + v, 0);
    if (!actTotal) continue;
    for (const z of [1, 2, 3, 4, 5]) totals[z] += secs[z];
    per_activity.push({ id: a.id, date: a.start_date, name: a.name, ...zonesReport(secs) });
    if (granularity === 'weekly') {
      const wk = mondayOf((a.start_date || '').slice(0, 10));
      const acc = byWeek.get(wk) || { week_start: wk, secs: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
      for (const z of [1, 2, 3, 4, 5]) acc.secs[z] += secs[z];
      byWeek.set(wk, acc);
    }
  }
  const out = {
    hr_max_used: hrMax,
    hr_max_source: hr_max ? 'parámetro' : 'estimado (p98 últimos 12 meses)',
    model: '5 zonas por % de FCmax (aprox. desde FC media por split)',
    activities: per_activity.length,
    unclassified_min: Math.round(unclassifiedSec / 60),
    ...zonesReport(totals),
  };
  if (granularity === 'weekly') {
    out.weeks = [...byWeek.values()]
      .sort((x, y) => x.week_start.localeCompare(y.week_start))
      .map((w) => ({ week_start: w.week_start, ...zonesReport(w.secs) }));
  } else {
    out.per_activity = per_activity;
  }
  return out;
}

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
};

// Etiqueta de calidad de Garmin derivada del score (sleepScoreQuality): la semana en
// vivo no la trae, así que la reproducimos con el mismo mapeo que las cerradas
// (EXCELLENT ≥90, GOOD ≥80, FAIR ≥60, POOR <60) para no devolver null donde el resto
// da string.
const sleepQualityFromScore = (s) =>
  (s == null ? null : s >= 90 ? 'EXCELLENT' : s >= 80 ? 'GOOD' : s >= 60 ? 'FAIR' : 'POOR');

// Reconstruye una fila semanal desde noches sueltas (list_sleep_daily). Los campos
// semanales de Garmin son MEDIAS por noche, no sumas: verificado contra el cache
// (semana 27/7 → media de duration_min de sus 7 noches = 435 = avg_duration_min).
function weekFromNights(weekStart, nights) {
  const avg = (k) => {
    const vals = nights.map((n) => n[k]).filter((v) => v != null);
    return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 0) : null;
  };
  const score = avg('score');
  return {
    weekStart,
    weekEnd: nights.map((n) => n.date).sort().pop(),
    score,
    quality: sleepQualityFromScore(score),
    durationMin: avg('duration_min'),
    remMin: avg('rem_min'),
    deepMin: avg('deep_min'),
    lightMin: avg('light_min'),
    awakeMin: avg('awake_min'),
    daysCount: nights.length,
    fromDaily: true,
  };
}

/**
 * Sueño semanal. El cache (`garmin_sleep_data`) guarda ventanas RODANTES: cada ingest
 * ancló en el día en que se ejecutó, así que conviven 21/7–27/7 (mar–lun) y 27/7–2/8
 * (lun–dom) y el 27/7 salía en dos filas. Clavamos cada ventana a la semana ISO que
 * realmente cubre (el lunes de su punto medio) y devolvemos lunes–domingo canónico,
 * exponiendo `source_window` cuando la ventana de origen no coincide.
 *
 * La semana en curso nunca está en el cache (el ingest solo cierra semanas completas),
 * así que se reconstruye desde el sueño diario EN VIVO. La versión anterior leía una
 * clave `garmin_sleep_daily` que ningún ingest escribe: era código muerto.
 */
export async function getSleep(userId, { from, to } = {}) {
  const weeklyRows = (await readKey(userId, 'garmin_sleep_data')) || [];
  const today = toISODate(new Date());
  const thisMonday = mondayOf(today);
  // Una semana entra si SOLAPA el rango pedido, no solo si empieza dentro: pedir
  // desde el 1/8 debe devolver la semana que contiene el 1/8.
  const overlaps = (wk) => (!from || addDays(wk, 6) >= from) && (!to || wk <= to);

  const byWeek = new Map(); // lunes ISO -> fila elegida
  for (const r of weeklyRows) {
    if (!r.weekStart || !r.weekEnd) continue;
    const span = Math.round((Date.parse(r.weekEnd) - Date.parse(r.weekStart)) / 86400000);
    if (span < 5 || span > 8) continue; // descarta ventanas que no son semanales
    const wk = mondayOf(addDays(r.weekStart, Math.round(span / 2))); // semana ISO dominante
    if (!overlaps(wk)) continue;
    // Ante ventanas rivales gana la que ya arranca en lunes; a igualdad, la que
    // tiene más noches con datos.
    const rank = (x) => (x.weekStart === wk ? 100 : 0) + (x.daysCount ?? 0);
    const prev = byWeek.get(wk);
    if (!prev || rank(r) > rank(prev)) byWeek.set(wk, r);
  }

  // Semana en curso (y la anterior, si tampoco está) desde Garmin en vivo. Solo si el
  // rango pedido llega hasta hoy, para no pagar 14 requests en consultas históricas.
  if (overlaps(thisMonday) && !byWeek.has(thisMonday)) {
    try {
      const { getSleepDaily } = await import('./garmin-live.js');
      const { nights = [] } = await getSleepDaily(userId, {}); // por defecto, 14 días
      const groups = new Map();
      for (const n of nights) {
        const wk = mondayOf(n.date);
        if (byWeek.has(wk) || !overlaps(wk)) continue;
        if (!groups.has(wk)) groups.set(wk, []);
        groups.get(wk).push(n);
      }
      for (const [wk, ns] of groups) byWeek.set(wk, weekFromNights(wk, ns));
    } catch { /* sin credenciales o Garmin caído: seguimos solo con el cache */ }
  }

  let shiftedAny = false;
  const weeks = [...byWeek.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([wk, r]) => {
      const weekEnd = addDays(wk, 6);
      const shifted = !r.fromDaily && (r.weekStart !== wk || r.weekEnd !== weekEnd);
      if (shifted) shiftedAny = true;
      return {
        week_start: wk,
        week_end: weekEnd,
        partial: wk === thisMonday,
        source: r.fromDaily ? 'daily_live' : 'weekly_cache',
        days_with_data: r.daysCount ?? null,
        score: r.score ?? null,
        quality: r.quality ?? null,
        // Todos los campos de fases son MEDIA POR NOCHE, no total semanal.
        avg_duration_min: r.durationMin ?? null,
        avg_rem_min: r.remMin ?? null,
        avg_deep_min: r.deepMin ?? null,
        avg_light_min: r.lightMin ?? null,
        avg_awake_min: r.awakeMin ?? null,
        ...(shifted ? { source_window: { start: r.weekStart, end: r.weekEnd } } : {}),
      };
    });

  const note = shiftedAny
    ? 'Algunas semanas vienen de ventanas rodantes del ingest (ver source_window): ' +
      'la media corresponde a esos 7 días, desplazados respecto al lunes–domingo mostrado.'
    : null;
  return { count: weeks.length, weeks, ...(note ? { note } : {}) };
}

// ── Carreras objetivo + plan de entrenamiento ───────────────────────────────
// Misma clave que usa el front (`target_races` en cloudStorage): una lista JSON
// de { id, name, date, distance, goalTimeMin, plan }. `plan` es texto libre en
// CUALQUIER formato (tabla semanal, markdown, notas sueltas): no se parsea, se
// guarda tal cual para que el modelo lo lea y lo reescriba.
const TARGET_RACES_KEY = 'target_races';
const RACE_DISTANCES = ['5k', '10k', '21k', '42k'];

/** "3:30:00" / "45:00" / "22" -> minutos (float). null si no es válido. */
export function parseTimeToMinutes(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.some(Number.isNaN)) return null;
    if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
    if (parts.length === 2) return parts[0] + parts[1] / 60;
    return null;
  }
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** minutos (float) -> "H:MM:SS" o "MM:SS". */
function formatMinutes(min) {
  if (min == null || Number.isNaN(min)) return null;
  const totalSec = Math.round(min * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((d.getTime() - utcToday) / 86400000);
}

async function readTargetRaces(userId) {
  const list = await readKeyFresh(userId, TARGET_RACES_KEY);
  return Array.isArray(list) ? list : [];
}

/**
 * Id de la carrera OBJETIVO PRINCIPAL (espejo de getPrimaryTargetRace del front):
 * la marcada con `primary` y, si no hay ninguna, la próxima futura. Es la carrera
 * sobre la que se basan planes, predicciones y análisis; las demás son informativas.
 */
// ── Resultado real de una carrera objetivo ──────────────────────────────────
// Espejo de src/lib/raceResults.js: se empareja por FECHA (el nombre de la
// actividad casi nunca coincide con el del evento) y, si ese día hay varias, se
// elige la más cercana a la distancia oficial. Cierra el ciclo: el modelo puede
// contrastar lo que se planeó con lo que de verdad pasó.
const RACE_DISTANCE_M = { '5k': 5000, '10k': 10000, '21k': 21098, '42k': 42195 };

function findRaceActivity(race, activities) {
  if (!race?.date) return null;
  const target = RACE_DISTANCE_M[race.distance] || null;
  const sameDay = activities.filter((a) => isRunning(a)
    && String(a.start_date_local || a.start_date || '').slice(0, 10) === race.date
    && a.distance > 0);
  if (!sameDay.length) return null;
  const candidates = target ? sameDay.filter((a) => a.distance >= target * 0.8) : sameDay;
  const pool = candidates.length ? candidates : sameDay;
  if (!target) return pool.reduce((best, a) => (a.distance > best.distance ? a : best), pool[0]);
  return pool.reduce((best, a) => (
    Math.abs(a.distance - target) < Math.abs(best.distance - target) ? a : best
  ), pool[0]);
}

function shapeRaceResult(race, activity) {
  if (!activity) return null;
  const timeMin = (activity.moving_time || 0) / 60;
  if (!timeMin) return null;
  const distanceM = Math.round(activity.distance);
  const officialM = RACE_DISTANCE_M[race.distance] || null;
  const goal = race.goalTimeMin ?? null;
  return {
    activity_id: activity.id,
    activity_name: activity.name || null,
    time_min: round(timeMin),
    pace_min_km: distanceM > 0 ? round(timeMin / (distanceM / 1000)) : null,
    distance_m: distanceM,
    // > 0 significa que se corrió MÁS que la distancia oficial: el tiempo es una
    // cota superior del tiempo a esa distancia. Nunca se reescala.
    distance_delta_m: officialM != null ? distanceM - officialM : null,
    avg_hr: activity.average_heartrate || null,
    elevation_gain: activity.total_elevation_gain ?? null,
    goal_time_min: goal,
    delta_min: goal != null ? round(timeMin - goal) : null,   // negativo = cumplido
    achieved: goal != null ? timeMin <= goal : null,
  };
}

function primaryRaceId(list) {
  const marked = list.find((r) => r.primary);
  if (marked) return marked.id;
  const next = list
    .filter((r) => (daysUntil(r.date) ?? -1) >= 0)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))[0];
  return next ? next.id : null;
}

/**
 * Espejo de ensurePrimary del front: crear una carrera NO le quita el puesto a la
 * que ya mandaba. Sin marca explícita la principal es la próxima futura, así que
 * se fija esa antes de que una carrera más cercana se la robe en silencio; si no
 * había ninguna candidata, la principal pasa a ser la recién creada.
 */
function ensurePrimary(list, prevList, fallbackId) {
  if (list.some((r) => r.primary)) return;
  const keepId = primaryRaceId(prevList) ?? fallbackId;
  if (!keepId) return;
  for (const r of list) if (r.id === keepId) r.primary = true;
}

// Heurística de formato del plan (espejo de src/lib/planFormat.js): el modelo
// necesita saber en qué está escrito para editarlo sin cambiarle el formato.
const HTML_TAG = /<\/?(p|div|table|tbody|thead|tr|td|th|ul|ol|li|h[1-6]|br|hr|span|strong|em|b|i|u|a|code|pre|blockquote|section|article|img|font)\b[^>]*>/i;
const MD_PATTERNS = [
  /^\s{0,3}#{1,6}\s+\S/m, /^\s{0,3}\|.*\|\s*$/m, /```/,
  /^\s{0,3}[-*+]\s+\S/m, /^\s{0,3}\d+\.\s+\S/m, /^\s{0,3}>\s+\S/m,
  /\*\*[^*\n]+\*\*/, /\[[^\]\n]+\]\([^)\s]+\)/, /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/m,
];
export function detectPlanFormat(text) {
  const str = String(text ?? '');
  if (!str.trim()) return 'empty';
  if (HTML_TAG.test(str)) return 'html';
  return MD_PATTERNS.some((re) => re.test(str)) ? 'markdown' : 'text';
}

function shapeRace(r, { include_plan = true, primary_id = undefined, activities = null } = {}) {
  const days = daysUntil(r.date);
  const plan = typeof r.plan === 'string' ? r.plan : null;
  return {
    id: r.id,
    name: r.name ?? null,
    date: r.date || null,
    // Hora del disparo (HH:MM local del evento): el plan cuelga de ella el
    // desayuno, la salida de casa y el calentamiento.
    start_time: r.startTime || null,
    distance: r.distance ?? null,
    goal_time: formatMinutes(r.goalTimeMin),
    goal_time_min: r.goalTimeMin ?? null,
    days_until: days,
    is_past: days == null ? null : days < 0,
    // Principal EFECTIVA: la marcada o, en su defecto, la próxima futura.
    is_primary: primary_id === undefined ? !!r.primary : r.id === primary_id,
    // Resultado real, solo si la carrera ya se corrió y se encuentra la actividad.
    ...(activities && (days ?? 0) < 0
      ? { result: shapeRaceResult(r, findRaceActivity(r, activities)) }
      : {}),
    has_plan: !!(plan && plan.trim()),
    plan_format: detectPlanFormat(plan),
    plan_updated_at: r.planUpdatedAt ?? null,
    ...(include_plan ? { plan } : { plan_chars: plan ? plan.length : 0 }),
  };
}

/**
 * Lista las carreras objetivo del usuario. `include_plan: false` devuelve solo
 * los metadatos (los planes pueden ser largos y saturar el contexto).
 */
export async function listTargetRaces(userId, { include_past = false, include_plan = true } = {}) {
  const list = await readTargetRaces(userId);
  const primary_id = primaryRaceId(list);
  const kept = list
    .filter((r) => include_past || (daysUntil(r.date) ?? 0) >= 0)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  // El histórico solo se carga si hay alguna carrera ya corrida que emparejar.
  const activities = kept.some((r) => (daysUntil(r.date) ?? 0) < 0)
    ? await getActivities(userId)
    : null;
  const races = kept.map((r) => shapeRace(r, { include_plan, primary_id, activities }));
  return {
    count: races.length,
    primary_race_id: primary_id,
    note: 'La carrera con is_primary=true es el OBJETIVO PRINCIPAL: úsala como referencia '
      + 'para planes, predicciones y análisis. Las demás son informativas.',
    races,
  };
}

/** Una carrera concreta por id (con su plan completo). */
export async function getTargetRace(userId, raceId) {
  const list = await readTargetRaces(userId);
  const race = list.find((r) => String(r.id) === String(raceId));
  if (!race) return { error: `No existe la carrera objetivo "${raceId}"` };
  const activities = (daysUntil(race.date) ?? 0) < 0 ? await getActivities(userId) : null;
  return shapeRace(race, { primary_id: primaryRaceId(list), activities });
}

/**
 * Marca una carrera como objetivo principal y desmarca el resto. Con `raceId`
 * null se quita la marca (vuelve a mandar la próxima futura por defecto).
 */
export async function setPrimaryTargetRace(userId, raceId) {
  const list = await readTargetRaces(userId);
  if (raceId != null && !list.some((r) => String(r.id) === String(raceId))) {
    return { error: `No existe la carrera objetivo "${raceId}"` };
  }
  const next = list.map((r) => (
    String(r.id) === String(raceId) ? { ...r, primary: true } : { ...r, primary: false }
  ));
  await writeKey(userId, TARGET_RACES_KEY, next);
  const primary_id = primaryRaceId(next);
  const race = next.find((r) => r.id === primary_id);
  return { ok: true, primary_race_id: primary_id, race: race ? shapeRace(race, { primary_id }) : null };
}

/**
 * Crea o actualiza una carrera objetivo. Sin `race_id` crea una nueva; con él
 * hace MERGE parcial (solo se tocan los campos enviados), de modo que se puede
 * escribir el plan sin reenviar nombre/fecha/objetivo.
 */
export async function upsertTargetRace(userId, {
  race_id, name, date, start_time, distance, goal_time, plan, append_plan, set_primary,
} = {}) {
  const list = await readTargetRaces(userId);
  const prevList = list.map((r) => ({ ...r }));
  const idx = race_id ? list.findIndex((r) => String(r.id) === String(race_id)) : -1;
  if (race_id && idx < 0) return { error: `No existe la carrera objetivo "${race_id}"` };
  if (!race_id && !name) return { error: 'Falta `name` para crear una carrera objetivo' };
  if (distance && !RACE_DISTANCES.includes(distance)) {
    return { error: `distance debe ser una de: ${RACE_DISTANCES.join(', ')}` };
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'date debe tener formato YYYY-MM-DD' };
  }
  let startTime;
  if (start_time !== undefined) {
    startTime = String(start_time ?? '').trim();
    if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
      return { error: 'start_time debe tener formato HH:MM (24h)' };
    }
  }
  let goalTimeMin;
  if (goal_time != null) {
    goalTimeMin = parseTimeToMinutes(goal_time);
    if (goal_time !== '' && goalTimeMin == null) {
      return { error: 'goal_time no válido. Usa h:mm:ss, mm:ss o minutos' };
    }
  }

  const prev = idx >= 0 ? list[idx] : {};
  const prevPlan = typeof prev.plan === 'string' ? prev.plan : '';
  const nextPlan = append_plan
    ? (prevPlan ? `${prevPlan}\n${append_plan}` : append_plan)
    : (plan !== undefined ? plan : prev.plan);

  const race = {
    ...prev,
    id: prev.id || (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
    ...(name !== undefined ? { name } : {}),
    ...(date !== undefined ? { date } : {}),
    ...(startTime !== undefined ? { startTime } : {}),
    ...(distance !== undefined ? { distance } : {}),
    ...(goalTimeMin !== undefined ? { goalTimeMin } : {}),
    ...(nextPlan !== undefined ? { plan: nextPlan } : {}),
    // Sello sólo si cambia el texto del plan: tocar nombre o fecha no lo "actualiza".
    ...(nextPlan !== undefined && nextPlan !== prevPlan
      ? { planUpdatedAt: String(nextPlan || '').trim() ? new Date().toISOString() : undefined }
      : {}),
  };
  if (!race.distance) race.distance = '21k';

  if (idx >= 0) list[idx] = race;
  else list.push(race);
  list.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  // Objetivo principal: excluyente, así que marcar una desmarca las demás.
  if (set_primary != null) {
    for (const r of list) r.primary = set_primary ? r.id === race.id : false;
  } else {
    ensurePrimary(list, prevList, race.id);
  }

  await writeKey(userId, TARGET_RACES_KEY, list);
  const primary_id = primaryRaceId(list);
  return { ok: true, created: idx < 0, primary_race_id: primary_id, race: shapeRace(race, { primary_id }) };
}

/** Borra una carrera objetivo (y su plan) por id. */
export async function deleteTargetRace(userId, raceId) {
  const list = await readTargetRaces(userId);
  const next = list.filter((r) => String(r.id) !== String(raceId));
  if (next.length === list.length) return { error: `No existe la carrera objetivo "${raceId}"` };
  await writeKey(userId, TARGET_RACES_KEY, next);
  return { ok: true, deleted: String(raceId), remaining: next.length };
}

// ── Velocidad crítica ───────────────────────────────────────────────────────
// Espejo de src/lib/criticalSpeed.js. Modelo de dos parámetros: d = CS·t + D′.
//   CS  velocidad crítica (m/s): mayor intensidad sostenible en estado estable;
//       es el umbral MEDIDO del atleta, no una estimación de tablas.
//   D′  reserva anaeróbica (m): metros disponibles por encima de CS.
// Solo es válido de ~2 a ~30 min: por debajo manda la potencia anaeróbica y por
// encima aparece una fatiga que el modelo ignora, así que en media y maratón
// predice tiempos DEMASIADO BUENOS. Las predicciones fuera de rango se marcan.
const CS_FIT_MIN_S = 120;
const CS_FIT_MAX_S = 1800;

function csCurve(activities, { from = null, to = null } = {}) {
  const best = new Map();
  const consider = (id, distance, timeS, a, source) => {
    if (!id || !(timeS > 0) || !(distance > 0)) return;
    const prev = best.get(id);
    if (prev && prev.time_s <= timeS) return;
    best.set(id, {
      id,
      distance_m: Math.round(distance),
      time_s: Math.round(timeS),
      time: fmtTime(timeS),
      pace_min_km: round((timeS / 60) / (distance / 1000)),
      date: String(a.start_date_local || a.start_date || '').slice(0, 10),
      activity_id: a.id,
      activity_name: a.name || null,
      source,
    });
  };
  for (const a of activities) {
    if (!isRunning(a)) continue;
    const day = String(a.start_date_local || a.start_date || '').slice(0, 10);
    if (from && day < from) continue;
    if (to && day > to) continue;
    for (const e of a.best_efforts || []) {
      consider(canonEffortByMeters(e.distance), e.distance, e.moving_time || e.elapsed_time, a, 'best_effort');
    }
    // Carreras previas al ingest de efforts: su tiempo total ES el mejor esfuerzo.
    consider(raceDistanceId(a.distance), a.distance, a.moving_time || a.elapsed_time, a, 'total_distance');
  }
  return [...best.values()].sort((x, y) => x.distance_m - y.distance_m);
}

function csFit(points) {
  const used = points.filter((p) => p.time_s >= CS_FIT_MIN_S && p.time_s <= CS_FIT_MAX_S);
  if (used.length < 3) return null;
  const n = used.length;
  const sumT = used.reduce((s, p) => s + p.time_s, 0);
  const sumD = used.reduce((s, p) => s + p.distance_m, 0);
  const sumTT = used.reduce((s, p) => s + p.time_s ** 2, 0);
  const sumTD = used.reduce((s, p) => s + p.time_s * p.distance_m, 0);
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return null;
  const cs = (n * sumTD - sumT * sumD) / denom;
  const dPrime = (sumD - cs * sumT) / n;
  if (!(cs > 0) || !(dPrime > 0)) return null;
  const meanD = sumD / n;
  const ssTot = used.reduce((s, p) => s + (p.distance_m - meanD) ** 2, 0);
  const ssRes = used.reduce((s, p) => s + (p.distance_m - (cs * p.time_s + dPrime)) ** 2, 0);
  return {
    cs_m_s: round(cs, 3),
    cs_pace_min_km: round((1000 / cs) / 60),
    cs_pace: fmtTime((1000 / cs)),
    d_prime_m: Math.round(dPrime),
    r2: round(ssTot > 0 ? 1 - ssRes / ssTot : 1, 4),
    n,
    used_efforts: used.map((p) => p.id),
    valid_window: '2-30 min',
    _cs: cs,
    _d: dPrime,
  };
}

/**
 * Curva de mejores esfuerzos + ajuste de velocidad crítica + predicciones.
 * `compare_previous` añade la curva del periodo anterior de igual duración para
 * ver hacia dónde se ha movido (si mejoran los cortos o la resistencia).
 */
export async function getCriticalSpeed(userId, { from = null, to = null, compare_previous = false } = {}) {
  const activities = await getActivities(userId);
  const curve = csCurve(activities, { from, to });
  const fit = csFit(curve);

  if (!fit) {
    return {
      error: 'No hay suficientes esfuerzos a tope de entre 2 y 30 min para ajustar el modelo (hacen falta 3).',
      efforts_found: curve.length,
      curve,
    };
  }

  const predictions = [
    { id: '5k', m: 5000 }, { id: '10k', m: 10000 },
    { id: 'half-marathon', m: 21097 }, { id: 'marathon', m: 42195 },
  ].map(({ id, m }) => {
    const t = (m - fit._d) / fit._cs;
    const real = curve.find((p) => p.id === id);
    return {
      distance: id,
      distance_m: m,
      model_time: fmtTime(t),
      model_time_s: Math.round(t),
      model_pace_min_km: round((t / 60) / (m / 1000)),
      // Fuera de la ventana el modelo ignora la fatiga: es COTA INFERIOR de tiempo.
      optimistic: t > CS_FIT_MAX_S,
      best_time: real ? real.time : null,
      best_time_s: real ? real.time_s : null,
      delta_s: real ? Math.round(real.time_s - t) : null,
    };
  });

  let previous = null;
  if (compare_previous && from) {
    const span = Date.parse(to || new Date().toISOString().slice(0, 10)) - Date.parse(from);
    if (span > 0) {
      const prevFrom = new Date(Date.parse(from) - span).toISOString().slice(0, 10);
      const prevCurve = csCurve(activities, { from: prevFrom, to: from });
      const prevFit = csFit(prevCurve);
      previous = prevFit
        ? {
          from: prevFrom, to: from,
          cs_pace: prevFit.cs_pace, cs_m_s: prevFit.cs_m_s, d_prime_m: prevFit.d_prime_m, r2: prevFit.r2, n: prevFit.n,
          cs_change_m_s: round(fit.cs_m_s - prevFit.cs_m_s, 3),
          d_prime_change_m: Math.round(fit.d_prime_m - prevFit.d_prime_m),
        }
        : { from: prevFrom, to: from, error: 'Sin ajuste en el periodo anterior' };
    }
  }

  delete fit._cs; delete fit._d;
  return {
    range: { from, to },
    fit,
    predictions,
    curve,
    previous,
    note: 'CS es el umbral medido del atleta y D′ su reserva anaeróbica. El ajuste solo usa '
      + 'esfuerzos de 2-30 min; las predicciones con optimistic=true ignoran la fatiga de las '
      + 'pruebas largas y son una cota inferior del tiempo, no un pronóstico.',
  };
}
