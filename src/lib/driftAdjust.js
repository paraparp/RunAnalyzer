// ============================================================================
// driftAdjust — ajustadores de eficiencia (m/latido) con base "10k llano".
//
// LA PREGUNTA: "¿cuántos metros por latido habría sacado en esta tirada si hubiera
// sido un 10k llano a mi ritmo de referencia?". Así se comparan tiradas de 6 y de
// 18 km, rápidas y suaves, en m/latido (la convención de efficiencyFactor.js).
//
// EL MODELO, km a km sobre los parciales de TODAS las tiradas de la misma época
// (ventana de ±6 semanas alrededor de cada tirada):
//
//   FC(tirada r, km k) = α_r + β·(GAP_k − GAP_ref) + γ1·(k − 1) + γ2·max(0, k − 10)
//
//   α_r — un intercepto POR TIRADA (efecto fijo): se come lo que es de ese día
//         (forma, calor, sueño, sensor). Por eso β y γ salen solo de la variación
//         DENTRO de cada tirada y no los contamina que unos días se esté mejor.
//   β   — coste del ritmo: ppm por m/s de GAP (se publica como ppm por 10 s/km).
//   γ1  — deriva cardiaca por km en los primeros 10 km.
//   γ2  — deriva EXTRA por km a partir del 10 (en tiradas largas se acelera).
//
// Se descarta el km 1 (la FC aún está subiendo) y las tiradas de series (CV del
// ritmo entre km > 12 %), donde el retraso de la FC rompe la lectura por km.
// Con pocos datos cada coeficiente se ENCOGE hacia un valor fisiológico típico
// (prior normal), igual que en efficiencyCompare.
//
// LOS AJUSTADORES de una tirada, en m/latido y en este orden:
//   desnivel  — de ritmo real a GAP (lo que el terreno costó o regaló)
//   distancia — de su perfil de deriva al de un 10k (k = 2..10)
//   ritmo     — de su GAP medio al ritmo de referencia
// y su suma lleva de los m/latido medidos a los "m/latido eq. 10k llano".
// ============================================================================

import { gapFactor } from './gap.js';
import { fitOls } from './aerobicForm.js';

export const BASE_KM = 10;
export const WINDOW_DAYS = 42;
export const PRIORS = {
  pace: { mean: 35, sd: 15 },       // ppm por m/s
  drift: { mean: 0.8, sd: 0.8 },    // ppm por km (km 2-10)
  driftLong: { mean: 0.4, sd: 1 },  // ppm por km extra (km > 10)
};
const MAX_SPLIT_CV = 0.12;
const MIN_RUNS = 6;
const MIN_ROWS = 30;
const DAY = 86400000;
const RUNNING = new Set(['Run', 'TrailRun', 'VirtualRun']);

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Metros por latido (la convención de efficiencyFactor.js): más = mejor. */
const mpb = (hr, v) => (hr > 0 && v > 0 ? (v * 60) / hr : null);

/** Parciales utilizables de una tirada (km 2+), o null. */
export function runSplits(a) {
  if (!(RUNNING.has(a?.sport_type) || RUNNING.has(a?.type))) return null;
  if (a.workout_type === 1) return null;
  const splits = a.splits_metric;
  if (!Array.isArray(splits) || splits.length < 4) return null;
  const rows = [];
  splits.forEach((s, i) => {
    if (i === 0) return;
    if ((s.distance || 0) < 900 || !(s.average_heartrate > 0) || !(s.average_speed > 1.5)) return;
    const grade = (s.elevation_difference || 0) / s.distance;
    rows.push({ k: i + 1, v: s.average_speed * gapFactor(grade), vRaw: s.average_speed, hr: s.average_heartrate });
  });
  if (rows.length < 3) return null;
  const mv = mean(rows.map((r) => r.v));
  const cv = Math.sqrt(mean(rows.map((r) => (r.v - mv) ** 2))) / mv;
  if (cv > MAX_SPLIT_CV) return null;
  return { id: a.id, ts: new Date(a.start_date).getTime(), rows };
}

const shrink = (b, se, prior) => {
  if (!Number.isFinite(b) || !(se > 0)) return { value: prior.mean, source: 'prior' };
  const wF = 1 / se ** 2;
  const wP = 1 / prior.sd ** 2;
  return { value: (b * wF + prior.mean * wP) / (wF + wP), source: wF > wP ? 'data' : 'blend', fit: b, se };
};

/**
 * Ajusta β, γ1, γ2 con efectos fijos por tirada (transformación within).
 * null si no hay datos suficientes.
 */
export function fitAdjusters(runs, refSpeed) {
  if (runs.length < MIN_RUNS) return null;
  const nRows = runs.reduce((s, r) => s + r.rows.length, 0);
  if (nRows < MIN_ROWS) return null;
  const longRows = runs.flatMap((r) => r.rows.filter((x) => x.k > BASE_KM));
  const longRuns = runs.filter((r) => r.rows.some((x) => x.k > BASE_KM)).length;
  const withLong = longRows.length >= 8 && longRuns >= 2;

  const X = [];
  const y = [];
  for (const r of runs) {
    const cols = r.rows.map((x) => {
      const c = [x.v - refSpeed, x.k - 1];
      if (withLong) c.push(Math.max(0, x.k - BASE_KM));
      return c;
    });
    const mc = cols[0].map((_, j) => mean(cols.map((c) => c[j])));
    const my = mean(r.rows.map((x) => x.hr));
    cols.forEach((c, i) => {
      X.push(c.map((v, j) => v - mc[j]));
      y.push(r.rows[i].hr - my);
    });
  }
  const fit = fitOls(X, y);
  if (!fit) return null;
  // fitOls no sabe que se gastaron R grados de libertad en las medias por tirada.
  const dfAdj = fit.n - fit.p - runs.length;
  if (dfAdj <= 0) return null;
  const sigma2 = (fit.sigma2 * fit.df) / dfAdj;
  const se = (j) => Math.sqrt(sigma2 * fit.inv[j][j]);

  const pace = shrink(fit.beta[0], se(0), PRIORS.pace);
  pace.value = Math.max(10, pace.value);
  const drift = shrink(fit.beta[1], se(1), PRIORS.drift);
  const driftLong = withLong ? shrink(fit.beta[2], se(2), PRIORS.driftLong) : { value: PRIORS.driftLong.mean, source: 'prior' };
  return {
    pace, drift, driftLong,
    n_runs: runs.length,
    n_splits: nRows,
    residual_sd: Math.sqrt(sigma2),
  };
}

/** Descompone una tirada en sus ajustadores con unos coeficientes dados. */
export function adjustRun(run, coef, refSpeed) {
  const hr = mean(run.rows.map((r) => r.hr));
  const v = mean(run.rows.map((r) => r.v));
  const vRaw = mean(run.rows.map((r) => r.vRaw));
  const g1 = coef.drift.value;
  const g2 = coef.driftLong.value;
  const driftRun = g1 * mean(run.rows.map((r) => r.k - 1)) + g2 * mean(run.rows.map((r) => Math.max(0, r.k - BASE_KM)));
  const drift10 = g1 * 5; // km 2..10 → (k − 1) medio = 5
  const hrDist = hr - (driftRun - drift10);
  const hrBase = hrDist - coef.pace.value * (v - refSpeed);

  const raw = mpb(hr, vRaw);
  const gap = mpb(hr, v);
  const dist = mpb(hrDist, v);
  const base = mpb(hrBase, refSpeed);
  return {
    km: run.rows[run.rows.length - 1].k,
    hr_mean: hr,
    gap_speed: v,
    mpb_raw: raw,
    mpb_10k: base,
    hr_10k: hrBase,
    // En m/latido y telescópicos: mpb_raw + grade + distance + pace = mpb_10k.
    adj: { grade: gap - raw, distance: dist - gap, pace: base - dist },
  };
}

const windowAround = (runs, ts, days) => runs.filter((r) => Math.abs(r.ts - ts) <= days * DAY);

/**
 * Ajustadores por época para todas las tiradas.
 *
 * @returns {{ ref_speed, ref_pace_s, byId: Map<id, {...adjustRun, coef}>, epochs: [...] }}
 *   epochs — un ajuste por mes (ventana centrada en el día 15) para ver cómo
 *   cambian la deriva y el coste del ritmo con la forma.
 */
export function epochAdjusters(activities, { windowDays = WINDOW_DAYS, refPaceS = null } = {}) {
  const runs = (activities || []).map(runSplits).filter(Boolean).sort((a, b) => a.ts - b.ts);
  const empty = { ref_speed: null, ref_pace_s: null, byId: new Map(), epochs: [] };
  if (runs.length < MIN_RUNS) return empty;

  // Ritmo de referencia: la mediana de todos los km, redondeada a 5 s/km para que
  // sea un número legible y estable (no se mueve al cambiar de período).
  const medV = median(runs.flatMap((r) => r.rows.map((x) => x.v)));
  const refPace = refPaceS ?? Math.round(1000 / medV / 5) * 5;
  const ref = 1000 / refPace;

  const fitAt = (ts) => fitAdjusters(windowAround(runs, ts, windowDays), ref)
    || fitAdjusters(windowAround(runs, ts, windowDays * 2), ref);

  const byId = new Map();
  for (const r of runs) {
    const coef = fitAt(r.ts);
    if (!coef) continue;
    byId.set(String(r.id), { ...adjustRun(r, coef, ref), coef });
  }

  const epochs = [];
  const first = new Date(runs[0].ts);
  const last = new Date(runs[runs.length - 1].ts);
  for (let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 15)); d <= last; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const coef = fitAdjusters(windowAround(runs, d.getTime(), windowDays), ref);
    if (!coef) continue;
    epochs.push({
      ts: d.getTime(),
      drift: coef.drift.value,
      drift_long: coef.driftLong.value,
      drift_long_source: coef.driftLong.source,
      pace_per_10s: coef.pace.value * (ref - 1000 / (refPace + 10)),
      n_runs: coef.n_runs,
    });
  }
  return { ref_speed: ref, ref_pace_s: refPace, byId, epochs };
}
