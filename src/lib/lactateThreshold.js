// ── Lactate-threshold model (LT1 / LT2) ─────────────────────────────────────
// Single source of truth for the threshold estimate, shared by the
// LactateThreshold tab (UI) and the AIInsights coach prompt (athleteContext).
// Pure functions, no UI / no I/O.
//
// PRIMARY — Critical Speed (CS): fit distance = CS·t + D' over best efforts
//   (~2–30 min). CS (slope) ≈ MLSS / LT2, validated against MLSS; performance-
//   anchored so it does NOT assume a fixed %HRmax.
//   Refs: Monod & Scherrer (1965); Jones et al. (2010) MSSE 42(10);
//         Galán-Rioja et al. (2020) Sports Med.
// SECONDARY (cross-check) — HR-anchored LT1/LT2. PRIMARY anchor is Heart-Rate
//   Reserve (Karvonen, %HRR): it tracks %VO2R and the lactate thresholds far
//   better than bare %HRmax and individualizes by resting HR. Bare %HRmax is
//   only a fallback when resting HR is unknown. Either way this is a cross-check
//   / trend tracker (it ASSUMES the threshold sits at that anchor), never the
//   source of truth. %HRmax at LT2 varies ~80–92% between individuals
//   (Faude et al. 2009), which is exactly why %HRR is preferred.
// FCmax — delegated to hrZones.detectMaxHR (median of the top 5% of observed
//   max HRs), so this model shares ONE HRmax with the zones UI and the AI prompt.

import { LTHR_FROM_HRMAX, detectMaxHR, HRMAX_FILTER, DEFAULT_REST_HR } from './hrZones';
import { formatPaceFromMinPerKm, paceMinPerKm } from './timeFormat';
import {
  buildMeanMaxCurve, fitCriticalSpeed, hasNonMaximalPoints, monthsAgoISO,
  activityWithinMonths, FIT_MIN_S, FIT_MAX_S,
} from './criticalSpeed';
import { segmentRatio } from './decoupling';

// ── Threshold HR anchors ─────────────────────────────────────────────────────
// PRIMARY: %HRR (Karvonen). LT2/anaerobic ≈ 85% HRR, LT1/aerobic ≈ 65% HRR.
//   Refs: Karvonen et al. (1957); Lounana et al. (2007) MSSE (%HRR↔%VO2R).
export const LT2_HRR_PCT = 0.85;
export const LT1_HRR_PCT = 0.65;
// %HRmax fallback (only when resting HR is unavailable). LT2 shares the single
// project-wide LTHR anchor (0.875·HRmax, see hrZones); LT1 recalibrated down to
// 0.75·HRmax (the old 0.77 sat too high for an aerobic threshold).
export const LT2_TARGET_PCT = LTHR_FROM_HRMAX; // 0.875
export const LT1_TARGET_PCT = 0.75;
export const LT2_SIGMA_PCT  = 0.025;
export const LT1_SIGMA_PCT  = 0.025;
export const EWMA_LAMBDA    = 0.3;
// Ventana de histórico del modelo (meses). Única para CS, cross-check por FC y
// para el LTHR anclado a CS que consume useHrParams: si se cambia, cambia en todo.
export const LT_MONTHS = 12;
export const MIN_DURATION_S = 20 * 60;
export const MIN_LAP_TIME_S = 4 * 60;
export const MIN_LAP_DIST_M = 400;

export const paceFromSpeed = paceMinPerKm; // m/s → min/km (definición única en timeFormat)

/**
 * Resolve absolute LT1/LT2 target heart rates. Prefers Karvonen %HRR when a
 * plausible resting HR is supplied (modern standard, individualized); otherwise
 * falls back to bare %HRmax.
 */
export function thresholdHRs(hrmax, hrrest) {
  const validRest = hrrest && hrrest > 30 && hrrest < hrmax - 40;
  if (validRest) {
    const hrr = hrmax - hrrest;
    return {
      lt1: hrrest + LT1_HRR_PCT * hrr,
      lt2: hrrest + LT2_HRR_PCT * hrr,
      basis: 'hrr',
    };
  }
  return { lt1: hrmax * LT1_TARGET_PCT, lt2: hrmax * LT2_TARGET_PCT, basis: 'hrmax' };
}

function gaussianWeight(hr, target, sigma) {
  const diff = hr - target;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

function weightedMedian(pairs) {
  if (!pairs || pairs.length === 0) return null;
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const totalW = sorted.reduce((s, p) => s + p.weight, 0);
  let cumW = 0;
  for (const p of sorted) {
    cumW += p.weight;
    if (cumW >= totalW / 2) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

/**
 * Robust HRmax, delegated to `detectMaxHR` (hrZones) so the lactate model, the
 * training zones and the AI prompt all anchor on ONE number. This used to run
 * its own upper-tail average over a wider 120–230 filter, which produced a
 * second, slightly different HRmax and therefore a second set of zones.
 *
 * Wraps the shared detector with the presentation metadata the UI needs:
 *   hrmax   — the shared estimate
 *   raw     — highest single reading accepted by the detector's filter
 *   trimmed — whether the estimate discarded a materially higher spike (≥3 bpm)
 *   nAvg    — how many peaks the detector sampled
 * Returns null when there is no usable HR history (never the 185 default), so
 * callers can tell "unknown" from "measured".
 */
export function robustHRmax(activities) {
  const { value, n } = detectMaxHR(activities ?? []);
  if (!n) return null;
  const raw = (activities ?? [])
    .filter(a => a.max_heartrate > HRMAX_FILTER.lo && a.max_heartrate < HRMAX_FILTER.hi)
    .reduce((m, a) => Math.max(m, a.max_heartrate), 0);
  return { hrmax: value, raw, trimmed: raw - value >= 3, nAvg: n };
}

/**
 * Critical Speed via the 2-parameter linear model d = CS·t + D'.
 *
 * DELEGATED WHOLESALE to `criticalSpeed.js` — same mean-max curve, same fit
 * window, same plausibility band — so the Critical Speed tab and the threshold
 * model report ONE number. This used to run its own fit: fastest whole run per
 * duration band over 3–40 min, which answered a different question (the best
 * *average* of a complete run, easy runs included) and therefore produced a
 * second, always-slower CS in a second tab.
 *
 * All this wrapper does now is translate the shared fit into the shape the
 * threshold model and its UI consume.
 */
export function computeCriticalSpeed(activities, months) {
  const curve = buildMeanMaxCurve(activities ?? [], { from: monthsAgoISO(months) });
  const fit = fitCriticalSpeed(curve);
  const nonMaximal = hasNonMaximalPoints(curve);

  // Solo los puntos que entran en el ajuste: son los que pinta la gráfica CS.
  const efforts = curve
    .filter(p => p.time_s >= FIT_MIN_S && p.time_s <= FIT_MAX_S)
    .map(p => ({
      id: p.id, t: p.time_s, d: p.distance_m, speed: p.speed_m_s, date: p.date,
      durMin: p.time_s / 60, pace: p.pace_min_km,
    }));

  if (!fit) {
    return { valid: false, nEfforts: efforts.length, totalEfforts: curve.length, nonMaximal, efforts };
  }
  return {
    valid: true,
    cs: fit.cs_m_s,
    dPrime: fit.d_prime_m,
    r2: fit.r2,
    csPace: fit.cs_pace_min_km,
    nEfforts: fit.n,
    totalEfforts: curve.length,
    nonMaximal,
    efforts,
  };
}

/**
 * Training paces derived from Critical Speed. Each zone is a fraction of CS
 * velocity; this is the actionable output for prescribing sessions.
 */
export function trainingPaces(cs) {
  const p = frac => paceFromSpeed(cs * frac);
  return [
    { key: 'recovery',  lo: 0.70, hi: 0.78, hr: '<70%' },
    { key: 'easy',      lo: 0.78, hi: 0.85, hr: '70–80%' },
    { key: 'marathon',  lo: 0.85, hi: 0.92, hr: '80–87%' },
    { key: 'threshold', lo: 0.94, hi: 1.00, hr: '87–92%' },
    { key: 'interval',  lo: 1.00, hi: 1.06, hr: '92–97%' },
    { key: 'reps',      lo: 1.06, hi: 1.15, hr: '>97%' },
  ].map(z => ({ ...z, slow: p(z.lo), fast: p(z.hi) }));
}

function extractSamples(a) {
  const samples = [];
  const validLap = l =>
    l.average_heartrate > 80 &&
    l.average_speed > 0 &&
    (l.moving_time || l.elapsed_time || 0) >= MIN_LAP_TIME_S &&
    (l.distance || 0) >= MIN_LAP_DIST_M;

  if (a.laps && a.laps.length >= 2 && a.laps.some(validLap)) {
    for (const l of a.laps) {
      if (!validLap(l)) continue;
      const pace = 1000 / (l.average_speed * 60);
      const elevPerKm = l.distance > 0 ? ((l.total_elevation_gain || 0) / l.distance) * 1000 : 0;
      samples.push({ hr: l.average_heartrate, pace, isHilly: elevPerKm > 10, isLap: true });
    }
  } else if (a.average_heartrate > 0 && a.average_speed > 0) {
    const pace = 1000 / (a.average_speed * 60);
    const elevPerKm = a.distance > 0 ? ((a.total_elevation_gain || 0) / a.distance) * 1000 : 0;
    samples.push({ hr: a.average_heartrate, pace, isHilly: elevPerKm > 10, isLap: false });
  }
  return samples;
}

/**
 * HR cross-check: monthly LT1/LT2 pace estimate by gaussian-weighting samples
 * around the LT1/LT2 target %HRmax bands, plus an EWMA-smoothed LT2 trend.
 */
export function computeLTMonthly(activities, months, hrmax, hrrest) {
  const inWindow = activityWithinMonths(months);
  const { lt1: lt1Target, lt2: lt2Target } = thresholdHRs(hrmax, hrrest);
  const lt2Sigma  = hrmax * LT2_SIGMA_PCT;
  const lt1Sigma  = hrmax * LT1_SIGMA_PCT;

  const runs = activities.filter(a =>
    (a.type === 'Run' || a.sport_type === 'Run') &&
    a.moving_time >= MIN_DURATION_S &&
    inWindow(a)
  );

  const byMonth = {};
  for (const a of runs) {
    const month = a.start_date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { lt2pairs: [], lt1pairs: [], hrs: [], count: 0, lapCount: 0 };
    const samples = extractSamples(a);
    if (samples.length === 0) continue;
    byMonth[month].count++;
    let usedLaps = false;
    for (const s of samples) {
      if (s.isHilly) continue;
      const w2 = gaussianWeight(s.hr, lt2Target, lt2Sigma);
      const w1 = gaussianWeight(s.hr, lt1Target, lt1Sigma);
      if (w2 > 0.01) byMonth[month].lt2pairs.push({ value: s.pace, weight: w2 });
      if (w1 > 0.01) byMonth[month].lt1pairs.push({ value: s.pace, weight: w1 });
      byMonth[month].hrs.push(s.hr);
      if (s.isLap) usedLaps = true;
    }
    if (usedLaps) byMonth[month].lapCount++;
  }

  const monthly = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => {
      const [y, m] = month.split('-');
      const label = `${m}/${y.slice(2)}`;
      const lt2pace = weightedMedian(d.lt2pairs);
      const lt1pace = weightedMedian(d.lt1pairs);
      const avgHR   = d.hrs.length ? d.hrs.reduce((s, h) => s + h, 0) / d.hrs.length : 0;
      const rawConf = d.lt2pairs.length;
      const confidence = d.lapCount > 0 ? Math.min(3, rawConf) : Math.min(2, rawConf);
      return { month, label, lt2pace, lt1pace, hr: Math.round(avgHR), count: d.count, lapCount: d.lapCount, confidence };
    })
    .filter(d => d.lt2pace !== null);

  let ewma = null;
  return monthly.map(d => {
    ewma = ewma === null ? d.lt2pace : EWMA_LAMBDA * d.lt2pace + (1 - EWMA_LAMBDA) * ewma;
    return { ...d, lt2smooth: Math.round(ewma * 1000) / 1000 };
  });
}

// ── DATA-DRIVEN LT1 via aerobic decoupling ───────────────────────────────────
// Within a steady run, if the FC:velocidad ratio drifts UP between the first and
// second half, the effort ran ABOVE the aerobic threshold. The ratio and its sign
// are the ones of `decoupling.js` (positivo = pierdes acoplamiento). Regress decoupling %
// on avg HR across many steady runs; the HR where it crosses ~DECOUPLE_PCT is a
// MEASURED LT1 — not an assumed %HRmax/%HRR. This is the field method Strava data
// actually supports (DFA-α1, the HRV gold standard, needs beat-to-beat R-R).
//   Refs: Coggan (Pw:HR / aerobic decoupling); Friel, The Triathlete's Bible.
export const DECOUPLE_PCT = 5;                 // % drift marking loss of aerobic coupling
export const MIN_DECOUPLE_TIME_S = 35 * 60;    // drift needs time to develop

// The ratio itself (FC/velocidad, ponderado por tiempo) comes from `decoupling.js`:
// one definition and one sign for the whole repo. What differs here is only the
// WINDOW, and deliberately:
//   · decoupling.js `halves` parte por NÚMERO de parciales sobre `splits_metric`,
//     que son kilómetros y por tanto reparten el tiempo de forma desigual;
//   · aquí la entrada son `laps` de duración arbitraria (un lap puede ser 20 min
//     y el siguiente 2), así que partir por índice dejaría mitades de duración
//     muy distinta. Se parte por el PUNTO MEDIO TEMPORAL de cada lap.
// The gates are also stricter than the UI's because this feeds a regression, not a
// display: ≥35 min for the drift to develop, flat course, and <8% pace change so a
// progression run does not enter as if it were steady state.
export function runDecoupling(a) {
  const laps = (a.laps || []).filter(l =>
    l.average_heartrate > 80 && l.average_speed > 0 &&
    (l.moving_time || l.elapsed_time || 0) > 0);
  if (laps.length < 4) return null;
  const total = laps.reduce((s, l) => s + (l.moving_time || l.elapsed_time), 0);
  if (total < MIN_DECOUPLE_TIME_S) return null;
  const elevPerKm = a.distance > 0 ? ((a.total_elevation_gain || 0) / a.distance) * 1000 : 0;
  if (elevPerKm > 10) return null; // hills corrupt the speed:HR relationship

  const half = total / 2;
  let cum = 0;
  const seg = { 1: [], 2: [] };
  for (const l of laps) {
    const t = l.moving_time || l.elapsed_time;
    const which = (cum + t / 2) < half ? 1 : 2; // assign each lap by its midpoint
    // `distance` se deriva de velocidad·tiempo, no del campo `distance` del lap:
    // es la magnitud sobre la que ya se filtró (`average_speed > 0`) y evita que
    // un lap con distancia ausente o incoherente descuadre la media.
    seg[which].push({
      average_heartrate: l.average_heartrate,
      moving_time: t,
      distance: l.average_speed * t,
    });
    cum += t;
  }
  const first = segmentRatio(seg[1]);
  const second = segmentRatio(seg[2]);
  if (!first || !second) return null;
  if (Math.abs(first.speed - second.speed) / first.speed > 0.08) return null; // progression, not steady

  const t1 = seg[1].reduce((s, l) => s + l.moving_time, 0);
  const t2 = total - t1;
  return {
    avgHR: (first.hr * t1 + second.hr * t2) / total,
    decouple: (second.ratio / first.ratio - 1) * 100,
    pace: paceFromSpeed((first.speed * t1 + second.speed * t2) / total),
  };
}

export function computeDecouplingLT1(activities, months, hrmax) {
  const inWindow = activityWithinMonths(months);
  const pts = [];
  for (const a of activities) {
    if (!(a.type === 'Run' || a.sport_type === 'Run')) continue;
    if (!inWindow(a)) continue;
    const d = runDecoupling(a);
    if (d && d.avgHR > 90 && d.avgHR < hrmax) pts.push(d);
  }
  if (pts.length < 6) return { valid: false, n: pts.length };

  // Linear regression decouple(%) = slope·HR + intercept; LT1 = HR at DECOUPLE_PCT.
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.avgHR, 0);
  const sy = pts.reduce((s, p) => s + p.decouple, 0);
  const sxx = pts.reduce((s, p) => s + p.avgHR * p.avgHR, 0);
  const sxy = pts.reduce((s, p) => s + p.avgHR * p.decouple, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { valid: false, n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const p of pts) {
    const pred = slope * p.avgHR + intercept;
    ssRes += (p.decouple - pred) ** 2;
    ssTot += (p.decouple - meanY) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const minHR = Math.min(...pts.map(p => p.avgHR));
  const maxHR = Math.max(...pts.map(p => p.avgHR));
  // Need a genuine positive HR→drift trend; a flat/noisy cloud is not informative.
  if (slope <= 0 || r2 < 0.2) return { valid: false, n, r2, slope };
  const lt1Hr = (DECOUPLE_PCT - intercept) / slope;
  // The crossing must sit within (or right at the edge of) the observed HR span.
  if (lt1Hr < minHR - 8 || lt1Hr > maxHR + 8) return { valid: false, n, r2, lt1Hr: Math.round(lt1Hr) };
  return {
    valid: true, n, r2,
    lt1Hr: Math.round(Math.max(minHR, Math.min(maxHR, lt1Hr))),
    spanHR: [Math.round(minHR), Math.round(maxHR)],
  };
}

// ── DATA-DRIVEN LT2 heart rate: HR actually observed AT threshold pace ────────
// Anchors LT2 HR to MEASURED threshold performance (Critical Speed) rather than a
// fixed %HRmax/%HRR: take the median HR of laps/runs whose pace sits in a tight
// band around CS speed (≈ MLSS intensity).
export function computeFieldLT2Hr(activities, months, csPace, hrmax) {
  if (!csPace) return { valid: false, n: 0 };
  const inWindow = activityWithinMonths(months);
  const csSpeed = 1000 / (csPace * 60);
  const band = 0.06; // ±6% of CS speed ≈ threshold intensity
  const hrs = [];
  for (const a of activities) {
    if (!(a.type === 'Run' || a.sport_type === 'Run')) continue;
    if (!inWindow(a)) continue;
    for (const s of extractSamples(a)) {
      if (s.isHilly) continue;
      const spd = 1000 / (s.pace * 60);
      if (Math.abs(spd - csSpeed) / csSpeed <= band && s.hr > 90 && s.hr < hrmax) hrs.push(s.hr);
    }
  }
  if (hrs.length < 3) return { valid: false, n: hrs.length };
  hrs.sort((a, b) => a - b);
  return { valid: true, n: hrs.length, lt2Hr: Math.round(hrs[Math.floor(hrs.length / 2)]) };
}

/**
 * High-level consolidator: runs the whole pipeline and returns the model the
 * UI and the AI prompt both consume. `lt2Pace` is the headline threshold
 * (Critical Speed if valid, else HR cross-check).
 *
 * HR anchors (lt1Hr/lt2Hr) prefer a MEASURED value and only fall back to an
 * assumed anchor, tracked by lt1HrMethod/lt2HrMethod:
 *   lt2Hr — 'field' (HR at CS pace) → 'hrr' (Karvonen) → 'hrmax'
 *   lt1Hr — 'decoupling' (speed:HR drift) → 'ratio' (from measured LT2, %HRR) →
 *           'hrr'/'hrmax'
 */
export function computeLactateModel(activities, months = LT_MONTHS, opts = {}) {
  if (!activities || activities.length === 0) return { hasData: false, hrmax: null };
  const hrInfo = robustHRmax(activities);
  const hrmax = hrInfo?.hrmax ?? null;
  if (!hrmax) return { hasData: false, hrmax: null, hrInfo: null };

  // FCreposo: la que pase el llamador (Garmin / calibración manual vía useHrParams)
  // o el valor por defecto del proyecto. NO se estima desde la FC de actividad: aquí
  // había un `percentil15 × 0.56` sin referencia que entraba directo en Karvonen y
  // por tanto fijaba LT1/LT2, las zonas y el TRIMP. Ver hrZones.DEFAULT_REST_HR.
  const hrrest = (opts.hrrest && opts.hrrest > 30) ? opts.hrrest : DEFAULT_REST_HR;
  const targets = thresholdHRs(hrmax, hrrest);

  const monthly = computeLTMonthly(activities, months, hrmax, hrrest);
  const cs = computeCriticalSpeed(activities, months);
  const csValid = !!(cs && cs.valid);

  let hr = null;
  if (monthly.length > 0) {
    const latest = monthly[monthly.length - 1];
    let trendDelta = null;
    if (monthly.length >= 3) trendDelta = Math.round((monthly[0].lt2smooth - latest.lt2smooth) * 60);
    hr = { lt2: latest.lt2pace, lt1: latest.lt1pace, trendDelta };
  }

  const lt2Pace = csValid ? cs.csPace : hr?.lt2 ?? null;
  const lt1Pace = hr?.lt1 ?? null;
  const paces = csValid ? trainingPaces(cs.cs) : null;

  // ── Resolve LT2 HR: measured (HR at threshold pace) → %HRR → %HRmax anchor ──
  const fieldLt2 = csValid ? computeFieldLT2Hr(activities, months, cs.csPace, hrmax)
                           : { valid: false, n: 0 };
  let lt2Hr, lt2HrMethod;
  if (fieldLt2.valid) { lt2Hr = fieldLt2.lt2Hr; lt2HrMethod = 'field'; }
  else                { lt2Hr = Math.round(targets.lt2); lt2HrMethod = targets.basis; }

  // ── Resolve LT1 HR: measured (decoupling) → proportional to LT2 (%HRR) → anchor ──
  const dec = computeDecouplingLT1(activities, months, hrmax);
  let lt1Hr, lt1HrMethod;
  if (dec.valid) {
    lt1Hr = dec.lt1Hr; lt1HrMethod = 'decoupling';
  } else if (targets.basis === 'hrr') {
    lt1Hr = Math.round(hrrest + (LT1_HRR_PCT / LT2_HRR_PCT) * (lt2Hr - hrrest));
    lt1HrMethod = 'ratio';
  } else {
    lt1Hr = Math.round(targets.lt1); lt1HrMethod = targets.basis;
  }
  // Guard the monotonic ordering LT1 < LT2 after mixing measured/assumed sources.
  if (lt1Hr >= lt2Hr) lt1Hr = Math.round(lt2Hr - 0.12 * (hrmax - hrrest));

  return {
    hasData: monthly.length > 0 || csValid,
    hrInfo, hrmax, hrrest,
    lt1Hr, lt2Hr, lt1HrMethod, lt2HrMethod,
    hrBasis: targets.basis, // 'hrr' (Karvonen) or 'hrmax' — anchor used for fallback
    decoupling: dec, fieldLt2,
    lt1Pace, lt2Pace,
    csValid, cs, hr, paces, monthly,
    trendDelta: hr?.trendDelta ?? null,
  };
}

export const formatPace = formatPaceFromMinPerKm;
