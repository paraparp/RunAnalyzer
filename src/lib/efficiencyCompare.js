// ============================================================================
// efficiencyCompare — comparador de eficiencia entre tiradas parecidas.
//
// LA PREGUNTA: "esta tirada de 12 km, ¿fue más eficiente que las otras de 12 km?".
// El cociente m/latido no basta: la relación FC-ritmo es una recta con INTERCEPTO,
// así que el cociente mejora solo con ir más despacio (ver `aerobicForm.js`). Lo que
// se compara aquí es cada sesión LLEVADA A UN PUNTO COMÚN:
//
//   · FC a ritmo de referencia  = FC − b·(GAP − GAP_ref) − c·(WBGT − WBGT_ref)
//   · Ritmo a FC de referencia  = GAP + (FC_ref − FC_calor) / b
//
// donde b (ppm por m/s) sale del propio grupo con una regresión
//
//     FC = b0 + b·(GAP − GAP_ref) + d·(meses) [+ c·(WBGT − WBGT_medio)]
//
// El término de tiempo está para que la pendiente no se coma la mejora de forma:
// si el atleta corre más rápido Y con menos FC con los meses, sin él b saldría
// aplanada. Y como con 6-10 sesiones b se estima mal, se ENCOGE hacia un valor
// fisiológico típico (prior bayesiano normal): con muchos datos manda el grupo,
// con pocos manda el prior, y nunca sale una pendiente negativa absurda.
//
// El par (GAP, FC) de cada sesión sale, por orden de calidad:
//   1. 'window' — la ventana estable de `hr_effort` (15-45 min, sin paradas ni
//      picos), el mismo dato que usa Forma aeróbica.
//   2. 'splits' — los km 2..n dentro de los primeros 75 min, GAP por km.
//   3. 'whole'  — GAP y FC media de la sesión entera (lo más pobre).
// Se publica la fuente de cada punto para que se vea qué es medida buena.
// ============================================================================

import { sessionWindow, fitOls, seOf } from './aerobicForm.js';
import { gapFactor, gapSpeedFromGain } from './gap.js';
import { efficiencyMPerBeat } from './efficiencyFactor.js';

const RUNNING = new Set(['Run', 'TrailRun', 'VirtualRun']);
const isRunning = (a) => RUNNING.has(a?.sport_type) || RUNNING.has(a?.type);

/** Prior de la pendiente FC~GAP: ~35 ppm por m/s (≈ 4 ppm por 10 s/km a 5:00/km). */
export const SLOPE_PRIOR = { mean: 35, sd: 15 };
/** Rango plausible del efecto del calor (ppm por °C de WBGT). */
const HEAT_COEF_RANGE = [0, 1.5];
/** CV de velocidad entre km por encima del cual la sesión es series/fartlek. */
export const MAX_SPLIT_CV = 0.12;
const DAY_MS = 86400000;

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
export const median = (arr) => {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Mismo rango que `sessionHeat` (weather.js): fuera de él la unidad de origen venía
// mal etiquetada (se han visto 58 °C) y meterlo en la regresión movería todo el grupo.
const plausibleWbgt = (w) => (Number.isFinite(w) && w >= -5 && w <= 45 ? w : null);

const movingTime = (a) => a?.moving_time || a?.elapsed_time || 0;

// GAP de sesión entera desde el D+ de la cabecera. NO se usa `activityGapSpeed`
// (stream_gap) a propósito: hoy devuelve GAP ~35 s/km más rápido que el ritmo real
// en rodajes llanos (bug aguas arriba), y aquí movería la pendiente del grupo.
const wholeGap = (a) => {
  const t = movingTime(a);
  if (!(a?.distance > 0) || !(t > 0)) return 0;
  return gapSpeedFromGain(a.distance / t, a.distance, a.total_elevation_gain || 0);
};
const elevPerKm = (a) => (a?.distance > 0 && a.total_elevation_gain != null
  ? a.total_elevation_gain / (a.distance / 1000) : null);

/** Velocidad (m/s) → segundos por km. */
export const secPerKm = (ms) => (ms > 0 ? 1000 / ms : null);

/** Par (GAP, FC) de los km 2..n en los primeros 75 min, ponderado por tiempo. */
function splitsPair(splits) {
  if (!Array.isArray(splits) || splits.length < 4) return null;
  let cum = 0, tSum = 0, hrSum = 0, spSum = 0;
  const speeds = [];
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    const start = cum;
    cum += s.moving_time || 0;
    if (i === 0 || start > 4500) continue;
    if (!(s.average_heartrate > 0) || !(s.average_speed > 1.5) || (s.distance || 0) < 900) continue;
    const grade = (s.elevation_difference || 0) / s.distance;
    const gap = s.average_speed * gapFactor(grade);
    const t = s.moving_time || 1;
    tSum += t; hrSum += s.average_heartrate * t; spSum += gap * t;
    speeds.push(gap);
  }
  if (speeds.length < 3) return null;
  const m = mean(speeds);
  const cv = Math.sqrt(mean(speeds.map((v) => (v - m) ** 2))) / m;
  return { effort: spSum / tSum, hr: hrSum / tSum, cv, seconds: tSum };
}

/** CV de velocidad entre km de la sesión entera (detecta series y fartlek). */
function splitSpeedCv(splits) {
  const v = (splits || []).filter((s) => (s.distance || 0) >= 900 && s.average_speed > 0)
    .map((s) => s.average_speed * gapFactor((s.elevation_difference || 0) / s.distance));
  if (v.length < 3) return null;
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2))) / m;
}

/**
 * Punto de comparación de una sesión: `{ effort (GAP m/s), hr, source, ... }`
 * o `{ ok:false, reason }`.
 */
export function sessionPoint(a, { wbgtOf = (x) => x?._wbgt ?? null, hrSourceOf = (x) => x?._hr?.hr_source ?? 'unknown' } = {}) {
  if (!isRunning(a)) return { ok: false, reason: 'no-carrera' };
  if (!(a.average_heartrate > 0)) return { ok: false, reason: 'sin-fc' };
  const t = movingTime(a);
  if (!(a.distance > 0) || !(t > 0)) return { ok: false, reason: 'sin-datos' };

  let pair = null;
  let source = null;
  const win = a.hr_effort ? sessionWindow(a, { axis: 'gap' }) : null;
  if (win?.ok && (win.effort_cv == null || win.effort_cv <= 0.08)) {
    pair = { effort: win.effort, hr: win.hr, drift: win.drift_bpm };
    source = 'window';
  }
  if (!pair) {
    const sp = splitsPair(a.splits_metric);
    if (sp && sp.cv <= MAX_SPLIT_CV) { pair = { effort: sp.effort, hr: sp.hr }; source = 'splits'; }
  }
  if (!pair) {
    const g = wholeGap(a);
    if (g > 0) { pair = { effort: g, hr: a.average_heartrate }; source = 'whole'; }
  }
  if (!pair) return { ok: false, reason: 'sin-datos' };

  return {
    ok: true,
    id: a.id,
    name: a.name,
    date: a.start_date_local || a.start_date,
    ts: new Date(a.start_date).getTime(),
    distance_m: a.distance,
    moving_s: t,
    speed_ms: a.distance / t,
    gap_ms: wholeGap(a) || null,
    avg_hr: a.average_heartrate,
    elev_per_km: elevPerKm(a),
    effort: pair.effort,
    hr: pair.hr,
    drift_bpm: pair.drift ?? null,
    source,
    split_cv: splitSpeedCv(a.splits_metric),
    wbgt: plausibleWbgt(wbgtOf(a)),
    hr_source: hrSourceOf(a),
    ef: efficiencyMPerBeat(pair.effort, pair.hr),
    race: a.workout_type === 1,
  };
}

// ── Familias de tiradas ──────────────────────────────────────────────────────

export const DISTANCE_FAMILIES = [
  { id: 'short', lo: 4000, hi: 8000 },
  { id: 'medium', lo: 8000, hi: 12500 },
  { id: 'long', lo: 12500, hi: 17500 },
  { id: 'half', lo: 17500, hi: 24000 },
  { id: 'xlong', lo: 24000, hi: 60000 },
];

export const TERRAINS = {
  flat: (e) => e != null && e < 10,
  rolling: (e) => e != null && e >= 10 && e < 25,
  hilly: (e) => e != null && e >= 25,
  any: () => true,
};

/**
 * Filtra el grupo de comparación.
 *   mode 'family'  → `family` (id de DISTANCE_FAMILIES) + `terrain`
 *   mode 'similar' → `refId`: distancia ±`distTolPct` y desnivel/km parecido
 * Siempre: sin competiciones (salvo `includeRaces`), sin series (CV entre km),
 * y por defecto un solo origen de FC (el mayoritario) para no mezclar banda y muñeca.
 */
export function selectGroup(points, {
  mode = 'family', family = 'medium', terrain = 'any', refId = null,
  distTolPct = 12, includeRaces = false, includeVariable = false, from = null,
  hrSource = 'auto',
} = {}) {
  let list = points.filter((p) => p.ok);
  if (from) list = list.filter((p) => String(p.date).slice(0, 10) >= from);
  const ref = mode === 'similar' ? list.find((p) => String(p.id) === String(refId)) : null;
  if (mode === 'similar') {
    if (!ref) return { points: [], ref: null, hr_source: null, dropped: {} };
    const lo = ref.distance_m * (1 - distTolPct / 100);
    const hi = ref.distance_m * (1 + distTolPct / 100);
    const eTol = ref.elev_per_km != null ? Math.max(6, ref.elev_per_km * 0.35) : null;
    list = list.filter((p) => p.distance_m >= lo && p.distance_m <= hi
      && (eTol == null || p.elev_per_km == null || Math.abs(p.elev_per_km - ref.elev_per_km) <= eTol));
  } else {
    const f = DISTANCE_FAMILIES.find((x) => x.id === family) || DISTANCE_FAMILIES[1];
    const tf = TERRAINS[terrain] || TERRAINS.any;
    list = list.filter((p) => p.distance_m >= f.lo && p.distance_m < f.hi && tf(p.elev_per_km));
  }
  const dropped = { races: 0, variable: 0, sensor: 0 };
  const keep = (p) => p.id === ref?.id;
  list = list.filter((p) => {
    if (!includeRaces && p.race && !keep(p)) { dropped.races++; return false; }
    if (!includeVariable && p.split_cv != null && p.split_cv > MAX_SPLIT_CV && !keep(p)) { dropped.variable++; return false; }
    return true;
  });
  // Origen de FC: banda y muñeca no miden igual; un cambio de sensor se leería como
  // un cambio de forma. 'auto' = el de la referencia, o el mayoritario.
  let src = hrSource;
  if (src === 'auto') {
    const counts = {};
    for (const p of list) counts[p.hr_source] = (counts[p.hr_source] || 0) + 1;
    const known = Object.entries(counts).filter(([k]) => k !== 'unknown').sort((a, b) => b[1] - a[1]);
    src = ref && ref.hr_source !== 'unknown' ? ref.hr_source : (known[0]?.[0] ?? null);
    // Si casi todo es "desconocido" no se filtra: no hay con qué.
    if (src && (counts[src] || 0) < list.length * 0.5) src = null;
  }
  if (src && src !== 'any') {
    list = list.filter((p) => {
      if (p.hr_source === src || p.hr_source === 'unknown' || keep(p)) return true;
      dropped.sensor++;
      return false;
    });
  } else src = null;
  return { points: list.sort((a, b) => a.ts - b.ts), ref, hr_source: src, dropped };
}

// ── Modelo ───────────────────────────────────────────────────────────────────

/**
 * Ajusta el modelo del grupo y devuelve cada sesión normalizada.
 *
 * @returns {{
 *   ok, n, ref_effort, ref_hr, slope, slope_fit, slope_se, slope_source,
 *   heat_coef, wbgt_ref, trend, residual_sd, sessions:[...]
 * }}
 * `trend.pace_s_per_month`: s/km por mes a FC fija (negativo = más rápido = mejor),
 * con `ci95` y `significant`.
 */
export function compareEfficiency(points, { refEffort = null, refHr = null } = {}) {
  const n = points.length;
  if (n < 3) return { ok: false, n, error: 'few' };

  const refE = refEffort ?? median(points.map((p) => p.effort));
  const refH = refHr ?? median(points.map((p) => p.hr));
  const t0 = mean(points.map((p) => p.ts));
  const months = (p) => (p.ts - t0) / (30.44 * DAY_MS);
  const spanMonths = (points[n - 1].ts - points[0].ts) / (30.44 * DAY_MS);

  const withW = points.filter((p) => Number.isFinite(p.wbgt));
  const useHeat = n >= 8 && withW.length >= n * 0.8;
  const wbgtRef = useHeat ? mean(withW.map((p) => p.wbgt)) : null;
  const useTime = n >= 6 && spanMonths >= 1;

  const row = (p) => {
    const x = [1, p.effort - refE];
    if (useTime) x.push(months(p));
    if (useHeat) x.push((Number.isFinite(p.wbgt) ? p.wbgt : wbgtRef) - wbgtRef);
    return x;
  };
  const fit = n >= 5 ? fitOls(points.map(row), points.map((p) => p.hr)) : null;

  // Pendiente: posterior normal entre lo ajustado y el prior fisiológico.
  let slope = SLOPE_PRIOR.mean;
  let slopeFit = null, slopeSe = null, slopeSource = 'prior';
  if (fit) {
    slopeFit = fit.beta[1];
    slopeSe = seOf(fit, [0, 1, ...new Array(fit.p - 2).fill(0)]);
    if (slopeSe > 0 && Number.isFinite(slopeFit)) {
      const wF = 1 / slopeSe ** 2;
      const wP = 1 / SLOPE_PRIOR.sd ** 2;
      slope = (slopeFit * wF + SLOPE_PRIOR.mean * wP) / (wF + wP);
      slopeSource = wF > wP ? 'data' : 'blend';
    }
  }
  slope = Math.max(10, slope);

  let heat = 0;
  if (fit && useHeat) {
    const idx = 2 + (useTime ? 1 : 0);
    heat = Math.min(HEAT_COEF_RANGE[1], Math.max(HEAT_COEF_RANGE[0], fit.beta[idx]));
  }

  const heatAdj = (p) => (useHeat && Number.isFinite(p.wbgt) ? heat * (p.wbgt - wbgtRef) : 0);
  const sessions = points.map((p) => {
    const hrH = p.hr - heatAdj(p);
    const hrAtRef = hrH - slope * (p.effort - refE);
    const speedAtRef = p.effort + (refH - hrH) / slope;
    return {
      ...p,
      hr_at_ref: hrAtRef,
      speed_at_ref: speedAtRef,
      pace_at_ref_s: secPerKm(speedAtRef),
      // El cociente clásico, SIN normalizar: latidos por km a ritmo GAP.
      beats_per_km: p.effort > 0 ? (p.hr * 1000) / (p.effort * 60) : null,
    };
  });

  // Residuo con la pendiente final: la dispersión "normal" de un día cualquiera.
  const resid = sessions.map((s) => s.hr_at_ref);
  const mH = mean(resid);
  const residualSd = Math.sqrt(resid.reduce((a, v) => a + (v - mH) ** 2, 0) / Math.max(1, n - 1));

  const medPace = median(sessions.map((s) => s.pace_at_ref_s));
  const sorted = [...sessions].sort((a, b) => a.pace_at_ref_s - b.pace_at_ref_s);
  for (const s of sessions) {
    s.delta_pace_s = s.pace_at_ref_s - medPace;
    s.rank = sorted.indexOf(s) + 1;
    // z en latidos: cuánto se aparta del grupo en unidades de "día normal".
    s.z = residualSd > 0 ? (s.hr_at_ref - mH) / residualSd : 0;
  }

  // Media móvil centrada (mediana de 5) para la línea de evolución.
  const k = 2;
  sessions.forEach((s, i) => {
    const w = sessions.slice(Math.max(0, i - k), i + k + 1).map((x) => x.pace_at_ref_s);
    s.rolling_pace_s = w.length >= 3 ? median(w) : null;
    const h = sessions.slice(Math.max(0, i - k), i + k + 1).map((x) => x.hr_at_ref);
    s.rolling_hr = h.length >= 3 ? median(h) : null;
    const b = sessions.slice(Math.max(0, i - k), i + k + 1).map((x) => x.beats_per_km);
    s.rolling_bpk = b.length >= 3 ? median(b) : null;
  });

  // Tendencia: el coeficiente de tiempo traducido a ritmo a FC fija.
  let trend = null;
  if (fit && useTime) {
    const bT = fit.beta[2];
    const seT = seOf(fit, fit.beta.map((_, i) => (i === 2 ? 1 : 0)));
    const paceShift = (dBpm) => secPerKm(refE - dBpm / slope) - secPerKm(refE);
    trend = {
      bpm_per_month: bT,
      pace_s_per_month: paceShift(bT),
      ci95: [paceShift(bT - 1.96 * seT), paceShift(bT + 1.96 * seT)].sort((a, b) => a - b),
      significant: seT > 0 && Math.abs(bT / seT) >= 2,
      span_months: spanMonths,
    };
  }

  const recent = sessions.slice(-3).map((s) => s.pace_at_ref_s);
  return {
    ok: true,
    n,
    ref_effort: refE,
    ref_pace_s: secPerKm(refE),
    ref_hr: refH,
    slope,
    slope_fit: slopeFit,
    slope_se: slopeSe,
    slope_source: slopeSource,
    slope_s_per_bpm: secPerKm(refE) - secPerKm(refE + 1 / slope),
    heat_coef: useHeat ? heat : null,
    wbgt_ref: wbgtRef,
    residual_sd: residualSd,
    hr_at_ref_mean: mH,
    residual_sd_pace_s: secPerKm(refE) - secPerKm(refE + residualSd / slope),
    median_pace_s: medPace,
    median_bpk: median(sessions.map((x) => x.beats_per_km)),
    recent_vs_median_s: recent.length ? median(recent) - medPace : null,
    trend,
    r2: fit?.r2 ?? null,
    sessions,
  };
}

/** Recta FC = f(GAP) del grupo a la fecha media y calor medio, para pintarla. */
export function modelLine(model, speeds) {
  return speeds.map((v) => ({ effort: v, hr: model.hr_at_ref_mean + model.slope * (v - model.ref_effort) }));
}
