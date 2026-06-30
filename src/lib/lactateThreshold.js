// ── Lactate-threshold model (LT1 / LT2) ─────────────────────────────────────
// Single source of truth for the threshold estimate, shared by the
// LactateThreshold tab (UI) and the AIInsights coach prompt (athleteContext).
// Pure functions, no UI / no I/O.
//
// PRIMARY — Critical Speed (CS): fit distance = CS·t + D' over best efforts
//   (~3–40 min). CS (slope) ≈ MLSS / LT2, validated against MLSS; performance-
//   anchored so it does NOT assume a fixed %HRmax.
//   Refs: Monod & Scherrer (1965); Jones et al. (2010) MSSE 42(10);
//         Galán-Rioja et al. (2020) Sports Med.
// SECONDARY (cross-check) — HR-anchored LT1/LT2 at a target %HRmax band.
//   %HRmax at LT2 varies ~80–92% between individuals (Faude et al. 2009), so
//   this is only a cross-check / trend tracker, never the source of truth.
// FCmax — robust high percentile of observed max HR (drops sensor spikes).

export const LT2_TARGET_PCT = 0.87;
export const LT2_SIGMA_PCT  = 0.025;
export const LT1_TARGET_PCT = 0.77;
export const LT1_SIGMA_PCT  = 0.025;
export const EWMA_LAMBDA    = 0.3;
export const MIN_DURATION_S = 20 * 60;
export const MIN_LAP_TIME_S = 4 * 60;
export const MIN_LAP_DIST_M = 400;

// Critical Speed fit window: maximal efforts roughly 3–40 min (valid CS domain).
export const CS_BANDS = [
  [180, 360],   // 3–6 min
  [360, 600],   // 6–10 min
  [600, 900],   // 10–15 min
  [900, 1500],  // 15–25 min
  [1500, 2400], // 25–40 min
];

export const paceFromSpeed = (mps) => 1000 / (mps * 60); // m/s → min/km

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
 * Robust HRmax. HRmax is a ceiling, not a central tendency, so we work only
 * with the upper tail: drop the top ~1% of readings (sensor spikes / cadence-
 * lock artifacts), then AVERAGE the next few highest genuine readings.
 */
export function robustHRmax(activities) {
  const maxes = activities
    .filter(a => a.max_heartrate > 120 && a.max_heartrate < 230)
    .map(a => a.max_heartrate)
    .sort((a, b) => b - a);
  if (maxes.length === 0) return null;
  const raw = maxes[0];
  if (maxes.length < 8) return { hrmax: raw, raw, trimmed: false, nAvg: 1 };
  const drop = Math.min(3, Math.max(1, Math.round(maxes.length * 0.01)));
  const cluster = maxes.slice(drop, drop + 3); // average the next 3 highest
  const hrmax = Math.round(cluster.reduce((s, v) => s + v, 0) / cluster.length);
  return { hrmax, raw, trimmed: raw - hrmax >= 3, nAvg: cluster.length };
}

/**
 * Critical Speed via the 2-parameter linear model d = CS·t + D'.
 * Builds the performance envelope: the single fastest (flat) run in each
 * duration band, then linear-regresses distance on time.
 */
export function computeCriticalSpeed(activities, months) {
  const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  const runs = activities.filter(a =>
    (a.type === 'Run' || a.sport_type === 'Run') &&
    a.moving_time > 0 && a.distance > 0 &&
    new Date(a.start_date).getTime() >= cutoff
  );

  const best = CS_BANDS.map(([lo, hi]) => {
    let pick = null;
    for (const a of runs) {
      const t = a.moving_time, d = a.distance;
      if (t < lo || t >= hi) continue;
      const elevPerKm = d > 0 ? ((a.total_elevation_gain || 0) / d) * 1000 : 0;
      if (elevPerKm > 15) continue; // gradient makes pace non-comparable
      const speed = d / t;
      if (!pick || speed > pick.speed) pick = { t, d, speed, band: [lo, hi], date: a.start_date };
    }
    return pick;
  }).filter(Boolean);

  // Monotonic envelope: a maximal power-duration curve must have speed strictly
  // DECREASING with duration. Drop any shorter effort a longer one beats.
  const ordered = [...best].sort((a, b) => a.t - b.t);
  const envelope = [];
  for (const e of ordered) {
    while (envelope.length && e.speed >= envelope[envelope.length - 1].speed) envelope.pop();
    envelope.push(e);
  }

  const totalEfforts = best.length;
  if (envelope.length < 3) {
    return { valid: false, nEfforts: envelope.length, totalEfforts, nonMaximal: totalEfforts >= 3, efforts: envelope.map(e => ({ ...e, durMin: e.t / 60, pace: paceFromSpeed(e.speed) })) };
  }

  const n = envelope.length;
  const sx = envelope.reduce((s, e) => s + e.t, 0);
  const sy = envelope.reduce((s, e) => s + e.d, 0);
  const sxx = envelope.reduce((s, e) => s + e.t * e.t, 0);
  const sxy = envelope.reduce((s, e) => s + e.t * e.d, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { valid: false, nEfforts: n, totalEfforts, efforts: envelope };

  const cs = (n * sxy - sx * sy) / denom;       // m/s
  const dPrime = (sy - cs * sx) / n;             // m
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const e of envelope) {
    const pred = cs * e.t + dPrime;
    ssRes += (e.d - pred) ** 2;
    ssTot += (e.d - meanY) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const valid = cs > 1.4 && cs < 6.5 && dPrime > 0;

  const efforts = envelope.map(e => ({ ...e, durMin: e.t / 60, pace: paceFromSpeed(e.speed) }));
  return { valid, cs, dPrime: Math.max(0, dPrime), r2, csPace: paceFromSpeed(cs), nEfforts: n, totalEfforts, efforts };
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
export function computeLTMonthly(activities, months, hrmax) {
  const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  const lt2Target = hrmax * LT2_TARGET_PCT;
  const lt2Sigma  = hrmax * LT2_SIGMA_PCT;
  const lt1Target = hrmax * LT1_TARGET_PCT;
  const lt1Sigma  = hrmax * LT1_SIGMA_PCT;

  const runs = activities.filter(a =>
    (a.type === 'Run' || a.sport_type === 'Run') &&
    a.moving_time >= MIN_DURATION_S &&
    new Date(a.start_date).getTime() >= cutoff
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

/**
 * High-level consolidator: runs the whole pipeline and returns the model the
 * UI and the AI prompt both consume. `lt2Pace` is the headline threshold
 * (Critical Speed if valid, else HR cross-check). HR anchors (lt1Hr/lt2Hr) are
 * %HRmax-based estimates — labeled as such by the consumers.
 */
export function computeLactateModel(activities, months = 12) {
  if (!activities || activities.length === 0) return { hasData: false, hrmax: null };
  const hrInfo = robustHRmax(activities);
  const hrmax = hrInfo?.hrmax ?? null;
  if (!hrmax) return { hasData: false, hrmax: null, hrInfo: null };

  const monthly = computeLTMonthly(activities, months, hrmax);
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

  return {
    hasData: monthly.length > 0 || csValid,
    hrInfo, hrmax,
    lt1Hr: Math.round(hrmax * LT1_TARGET_PCT),
    lt2Hr: Math.round(hrmax * LT2_TARGET_PCT),
    lt1Pace, lt2Pace,
    csValid, cs, hr, paces, monthly,
    trendDelta: hr?.trendDelta ?? null,
  };
}

export function formatPace(minPerKm) {
  if (!minPerKm || minPerKm <= 0 || minPerKm > 20) return '--:--';
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
