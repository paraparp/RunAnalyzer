// ── Heart-rate zone boundary formulas ────────────────────────────────────────
// Single source of truth shared by the TrainingZones UI and the AIInsights coach
// prompt. Pure functions, no UI / no I/O — change a zone formula here and BOTH
// the zones tab and the AI prompt stay in sync (no silent drift).
//
// References:
//   [Seiler]   Seiler & Kjerland (2006) Scand J Med Sci Sports — polarized 3-zone (LTHR)
//   [Karvonen] Karvonen et al. (1957) Ann Med Exp Biol Fenn — Heart Rate Reserve 5-zone
//   [Friel]    Friel (2009) The Triathlete's Training Bible — LTHR 7-zone
//   [ACSM]     ACSM Guidelines for Exercise Testing and Prescription, 10th ed. — %FCmax 5-zone

// LTHR fallback when no field/race threshold is detected (Friel approximation).
export const LTHR_FROM_HRMAX = 0.875;
export const estimateLTHR = (hrmax) => Math.round(hrmax * LTHR_FROM_HRMAX);

// Each function returns an array of { lo, hi } in ascending zone order (ppm).
// Ranges are non-overlapping: zone N's `hi` is one below zone N+1's `lo`.
// The last zone's `hi` is 999 (open-ended).

export const seilerBounds = ({ lthr }) => [
  { lo: 0,                        hi: Math.round(lthr * 0.925) - 1 },
  { lo: Math.round(lthr * 0.925), hi: lthr - 1                     },
  { lo: lthr,                     hi: 999                          },
];

export const karvonenBounds = ({ hrmax, hrrest }) => {
  const hrr = hrmax - hrrest;
  const b = (p) => Math.round(hrrest + p * hrr);
  return [
    { lo: 0,       hi: b(0.50) - 1 },
    { lo: b(0.50), hi: b(0.60) - 1 },
    { lo: b(0.60), hi: b(0.70) - 1 },
    { lo: b(0.70), hi: b(0.85) - 1 },
    { lo: b(0.85), hi: 999          },
  ];
};

export const frielBounds = ({ lthr }) => {
  const z = (p) => Math.round(lthr * p);
  return [
    { lo: 0,       hi: z(0.85) - 1 },
    { lo: z(0.85), hi: z(0.90) - 1 },
    { lo: z(0.90), hi: z(0.95) - 1 },
    { lo: z(0.95), hi: z(1.00) - 1 },
    { lo: z(1.00), hi: z(1.03) - 1 },
    { lo: z(1.03), hi: z(1.06) - 1 },
    { lo: z(1.06), hi: 999          },
  ];
};

export const acsmBounds = ({ hrmax }) => {
  const z = (p) => Math.round(hrmax * p);
  return [
    { lo: 0,       hi: z(0.57) - 1 },
    { lo: z(0.57), hi: z(0.64) - 1 },
    { lo: z(0.64), hi: z(0.77) - 1 },
    { lo: z(0.77), hi: z(0.95) - 1 },
    { lo: z(0.95), hi: 999          },
  ];
};
