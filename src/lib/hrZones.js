// ── Heart-rate zone boundary formulas ────────────────────────────────────────
// Single source of truth shared by the TrainingZones UI and the AIInsights coach
// prompt. Pure functions, no UI / no I/O — change a zone formula here and BOTH
// the zones tab and the AI prompt stay in sync (no silent drift).
//
// References:
//   [Seiler]   Seiler & Kjerland (2006) Scand J Med Sci Sports — polarized 3-zone (LTHR)
//   [Karvonen] Karvonen et al. (1957) Ann Med Exp Biol Fenn — Heart Rate Reserve
//   [Friel]    Friel (2009) The Triathlete's Training Bible — LTHR ≈ 87.5% HRmax fallback

// LTHR fallback when no field/race threshold is detected (Friel approximation).
export const LTHR_FROM_HRMAX = 0.875;
export const estimateLTHR = (hrmax) => Math.round(hrmax * LTHR_FROM_HRMAX);

// Seiler 80/20 distribution targets (% of training time per zone). Single source
// for the zone table markers, the polarization cards AND the status thresholds,
// so the three never disagree on what "polarized" means.
export const SEILER_TARGETS = { z1: 75, z2: 10, z3: 20 };

// Physiological sanity limits for user-entered calibration values.
export const HR_LIMITS = { maxLo: 120, maxHi: 230, restLo: 30, restHi: 100 };

// Default resting HR when there is no Garmin measurement and no manual value.
// We deliberately do NOT estimate it from activity HR (no reliable mapping from
// in-exercise HR to true resting HR) — better an honest default than fake precision.
export const DEFAULT_REST_HR = 60;

// ── Auto-detection heuristics (shared by TrainingZones UI + AI coach prompt) ──

// Robust HRmax: median of the top 5% recorded max HRs (all-time — HRmax is a
// stable trait). Filters <140 / >215 sensor glitches; the median resists optical
// "cadence-lock" false spikes. Returns { value, n } where n = peaks sampled (0 → default).
export function detectMaxHR(activities) {
  const topHRs = (activities ?? [])
    .filter(a => a.max_heartrate > 140 && a.max_heartrate < 215)
    .map(a => a.max_heartrate)
    .sort((a, b) => b - a);
  if (!topHRs.length) return { value: 185, n: 0 };
  const sampleSize = Math.min(topHRs.length, Math.max(5, Math.floor(topHRs.length * 0.05)));
  const peaks = topHRs.slice(0, sampleSize);
  return { value: Math.round(peaks[Math.floor(peaks.length / 2)]), n: sampleSize };
}

// Resting HR: latest Garmin measurement if available, else the default.
// Returns { value, source: 'garmin' | 'default' }.
export function detectRestHR(garminData) {
  if (garminData?.length) {
    const sorted = [...garminData].sort((a, b) => b.date.localeCompare(a.date));
    const recent = sorted.find(d => d.restingHR);
    if (recent) return { value: recent.restingHR, source: 'garmin' };
  }
  return { value: DEFAULT_REST_HR, source: 'default' };
}

// LTHR detection from training data.
// Strategy 1 (field, highest confidence): sustained hard efforts 18–70 min
//   • avg HR 82–97% HRmax (genuinely hard)  • avg/max ≥ 0.92 (sustained, not spiked)
//   → median avg HR of qualifying runs.
// Strategy 2 (race): workout_type===1 or suffer_score>150 → p75 avg HR × 0.97
//   (races run ~3% above LTHR, Friel).
// Strategy 3 (formula): Friel LTHR ≈ 87.5% HRmax.
// Returns { lthr, confidence 0-100, method: 'field'|'race'|'formula'|'none', n }.
export function detectLTHR(activities, maxHR, { minFieldRuns = 3 } = {}) {
  if (!activities?.length || !maxHR) return { lthr: null, confidence: 0, method: 'none', n: 0 };

  const thresholdRuns = activities.filter(a => {
    if (!a.average_heartrate || !a.max_heartrate || !a.moving_time) return false;
    const mins    = a.moving_time / 60;
    const avgPct  = a.average_heartrate / maxHR;
    const sustain = a.average_heartrate / a.max_heartrate;
    return mins >= 18 && mins <= 70 && avgPct >= 0.82 && avgPct < 0.97 && sustain >= 0.92;
  });

  if (thresholdRuns.length >= minFieldRuns) {
    const hrs = thresholdRuns.map(a => a.average_heartrate).sort((a, b) => a - b);
    const median = hrs[Math.floor(hrs.length / 2)];
    const conf   = Math.min(92, 40 + thresholdRuns.length * 7);
    return { lthr: Math.round(median), confidence: conf, method: 'field', n: thresholdRuns.length };
  }

  const raceRuns = activities.filter(a =>
    a.average_heartrate && (a.workout_type === 1 || (a.suffer_score && a.suffer_score > 150))
  );
  if (raceRuns.length >= 1) {
    const hrs = raceRuns.map(a => a.average_heartrate).sort((a, b) => a - b);
    const p75 = hrs[Math.floor(hrs.length * 0.75)] ?? hrs[hrs.length - 1];
    return { lthr: Math.round(p75 * 0.97), confidence: 45, method: 'race', n: raceRuns.length };
  }

  return { lthr: estimateLTHR(maxHR), confidence: 25, method: 'formula', n: 0 };
}

// Each function returns an array of { lo, hi } in ascending zone order (ppm).
// Ranges are non-overlapping: zone N's `hi` is one below zone N+1's `lo`.
// The last zone's `hi` is 999 (open-ended).

export const seilerBounds = ({ lthr }) => [
  { lo: 0,                        hi: Math.round(lthr * 0.925) - 1 },
  { lo: Math.round(lthr * 0.925), hi: lthr - 1                     },
  { lo: lthr,                     hi: 999                          },
];

// Standard 10%-step HRR zones (de facto standard: Garmin, Polar, USA Triathlon):
// 60/70/80/90% HRR boundaries. Z1 is open-ended below 60% so recovery work
// (<50% HRR, "below zones" in watch UIs) still classifies somewhere.
export const karvonenBounds = ({ hrmax, hrrest }) => {
  const hrr = hrmax - hrrest;
  const b = (p) => Math.round(hrrest + p * hrr);
  return [
    { lo: 0,       hi: b(0.60) - 1 },
    { lo: b(0.60), hi: b(0.70) - 1 },
    { lo: b(0.70), hi: b(0.80) - 1 },
    { lo: b(0.80), hi: b(0.90) - 1 },
    { lo: b(0.90), hi: 999          },
  ];
};
