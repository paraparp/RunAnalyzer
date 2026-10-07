// ============================================================================
// weightTrend — lectura del peso de la báscula Garmin frente al rendimiento.
//
// El peso de un día suelto es ruido (agua, glucógeno, a qué hora te pesas): ±1 kg
// de un día a otro no significa nada. Por eso todo lo que se pinta o compara sale
// de la MEDIA MÓVIL de 7 días naturales, no de la pesada.
//
// La relación con el rendimiento se mide por MES contra la eficiencia aeróbica
// (m/latido, el mismo `efficiencyFactorRun` que usa el resto de la app): un mes
// junta suficientes rodajes comparables para que el EF sea estable, y el cambio
// de peso que importa es de semanas, no de días.
// ============================================================================
import { efficiencyFactorRun } from './efficiencyFactor';
import { activityDayKey } from './trainingLoad';

const DAY_MS = 86400000;
const toMs = (iso) => Date.parse(iso + 'T00:00:00Z');
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const round = (n, d = 2) => (n == null ? null : Number(n.toFixed(d)));

/**
 * Añade `avg7` a cada pesada: media de las pesadas de los 7 días naturales que
 * acaban en esa fecha (incluida). `rows` ordenadas por fecha ascendente.
 */
export function withRollingAverage(rows, windowDays = 7) {
  const out = [];
  let lo = 0;
  for (let i = 0; i < rows.length; i++) {
    const t = toMs(rows[i].date);
    while (toMs(rows[lo].date) <= t - windowDays * DAY_MS) lo++;
    const slice = rows.slice(lo, i + 1).map((r) => r.weight_kg);
    out.push({ ...rows[i], avg7: round(mean(slice)) });
  }
  return out;
}

/**
 * Cambio de la media móvil en los últimos `days` días: la última media frente a
 * la de la pesada más cercana a hace `days` días (sin pasar de ella). null si no
 * hay histórico tan antiguo.
 */
export function changeOver(smoothed, days) {
  if (!smoothed.length) return null;
  const last = smoothed[smoothed.length - 1];
  const target = toMs(last.date) - days * DAY_MS;
  let ref = null;
  for (const r of smoothed) {
    if (toMs(r.date) <= target) ref = r;
    else break;
  }
  return ref ? round(last.avg7 - ref.avg7) : null;
}

/** Pearson; null con menos de 4 pares o varianza nula. */
export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 4 || ys.length !== n) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (!sxx || !syy) return null;
  return round(sxy / Math.sqrt(sxx * syy), 2);
}

/**
 * Por mes: peso medio y EF medio de los rodajes comparables. Solo meses con las
 * dos cosas (y al menos `minRuns` sesiones con EF) entran en la correlación.
 */
export function monthlyWeightVsEfficiency(weights, activities, { maxObservedHr, minRuns = 3 } = {}) {
  const wByMonth = {};
  for (const w of weights) {
    const k = w.date.slice(0, 7);
    (wByMonth[k] ||= []).push(w.weight_kg);
  }
  const efByMonth = {};
  for (const a of activities || []) {
    const ef = efficiencyFactorRun(a, { maxObservedHr });
    if (ef == null) continue;
    const k = activityDayKey(a)?.slice(0, 7);
    if (!k) continue;
    (efByMonth[k] ||= []).push(ef);
  }
  const months = Object.keys(wByMonth)
    .filter((k) => (efByMonth[k]?.length || 0) >= minRuns)
    .sort()
    .map((k) => ({
      month: k,
      weight_kg: round(mean(wByMonth[k]), 1),
      ef: round(mean(efByMonth[k]), 3),
      runs: efByMonth[k].length,
    }));
  const r = pearson(months.map((m) => m.weight_kg), months.map((m) => m.ef));
  return { months, r };
}

/** Lectura en una frase del coeficiente (negativo = menos peso, más eficiencia). */
export function describeCorrelation(r) {
  if (r == null) return null;
  const a = Math.abs(r);
  const strength = a >= 0.7 ? 'fuerte' : a >= 0.4 ? 'moderada' : a >= 0.2 ? 'débil' : 'nula';
  if (strength === 'nula') return 'Sin relación clara entre tu peso y tu eficiencia aeróbica.';
  return r < 0
    ? `Relación ${strength}: los meses con menos peso fuiste más eficiente (más metros por latido).`
    : `Relación ${strength} e inversa a lo esperado: los meses con más peso fuiste más eficiente — probablemente manda otra variable (volumen, calor, bloque de entrenamiento).`;
}
