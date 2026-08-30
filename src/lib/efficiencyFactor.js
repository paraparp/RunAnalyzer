// ── Efficiency Factor (EF) — fuente única ───────────────────────────────────
//
// Había SEIS expresiones de "eficiencia" repartidas por la app, con TRES
// convenciones de unidad y una inversión de signo: `avgHr / gapSpeed` en
// bpm/(m/s) (donde menos es mejor), `avgHr × gapMinKm` en latidos/km, dos
// variantes de `speed / hr × 1000`, y la de VitalsOverview en m/latido. Ninguna
// gráfica era comparable con otra, y las que no filtraban por intensidad
// mezclaban series con rodajes, que es justo lo que hace inútil un EF.
//
// La convención de este módulo es la de TrainingPeaks / Jones:
//
//   EF = metros recorridos por latido = velocidad(m/s) × 60 / FC(ppm)
//
// **Más alto es mejor.** `toBeatsPerKm` es exactamente su recíproco (1000 / EF),
// no una segunda medida: se expone porque la vista de FC la presenta así
// (latidos/km, donde menos es mejor) y conviene que salga del mismo número.
//
// El EF solo significa algo en esfuerzo aeróbico sub-umbral: por encima del
// umbral la relación ritmo/FC se rompe. De ahí la banda de FC, el tope de
// desnivel y la ventana de 75 minutos (a partir de ahí la deriva cardiaca
// domina la señal). Un esfuerzo que no cumple devuelve `null` — es preferible
// un hueco en la serie a un punto que no es comparable con los de al lado.
//
// Refs: Allen & Coggan, "Training and Racing with a Power Meter" (EF);
//       Jones et al., el uso clásico de Pa:HR en corredores de fondo.

import { gapFactor, gapFactorFromGain } from './gap.js';

/** Banda de FC aeróbica (fracción de FCmax) en la que el EF es interpretable. */
export const EF_HR_BAND = { lo: 0.70, hi: 0.85 };

/** Suelo de FCmax: la máxima registrada infravalora la real si no hay esfuerzos
 *  máximos, y sin suelo la banda excluiría rodajes normales a 145-155 ppm. */
export const EF_HRMAX_FLOOR = 185;

/** Tope de desnivel medio (%) permitido: 1 % en crudo, 4 % si se ajusta por GAP. */
export const EF_GRADE_CAP = { raw: 1, gap: 4 };

/** Ventana desde el inicio (s) más allá de la cual manda la deriva cardiaca. */
export const EF_DRIFT_WINDOW_S = 4500; // 75 min

/** Mínimo de kilómetros aeróbicos válidos para que la sesión sea representativa. */
export const EF_MIN_SPLITS = 3;

/** Metros por latido a partir de velocidad (m/s) y FC media (ppm). Más = mejor. */
export function efficiencyMPerBeat(speedMs, hr) {
  if (!(speedMs > 0) || !(hr > 0)) return null;
  return (speedMs * 60) / hr;
}

/** Latidos por km desde un EF en m/latido: el MISMO número en la unidad inversa
 *  (menos = mejor). Es su propia inversa: aplicarla dos veces devuelve el EF. */
export function toBeatsPerKm(mPerBeat) {
  return mPerBeat > 0 ? 1000 / mPerBeat : null;
}

/** Banda absoluta de FC aeróbica para una FCmax observada. */
export function efHrBand(maxObservedHr) {
  const hrMaxZone = Math.max(maxObservedHr || 0, EF_HRMAX_FLOOR);
  return { lo: hrMaxZone * EF_HR_BAND.lo, hi: hrMaxZone * EF_HR_BAND.hi };
}

/**
 * EF por parciales: en vez de exigir que TODA la carrera sea aeróbica y llana,
 * extrae los kilómetros que sí lo son. Así las tiradas largas, los rodajes con
 * cuestas y los calentamientos de series también aportan dato y la serie no se
 * queda con huecos de semanas.
 *
 * Reglas por km: FC en banda, llano (según el tope), ≥900 m, dentro de los
 * primeros 75 min. Se descarta el primer km (retardo de la FC al arrancar).
 * Devuelve la media ponderada por tiempo, o null si no hay ≥3 km válidos.
 */
export function efFromSplits(splits, { band, gradeCap, gapAdjust }) {
  if (!Array.isArray(splits)) return null;
  let cum = 0, wSum = 0, tSum = 0, nOk = 0;
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    const start = cum;
    cum += s.moving_time || 0;
    if (i === 0) continue;                    // retardo de FC del arranque
    if (start > EF_DRIFT_WINDOW_S) break;      // solo los primeros 75 min
    if (!s.average_heartrate || s.average_heartrate < band.lo || s.average_heartrate > band.hi) continue;
    if (!s.average_speed || s.average_speed < 1.5 || (s.distance || 0) < 900) continue;
    const grade = (s.elevation_difference || 0) / s.distance;   // con signo
    if (Math.abs(grade) * 100 >= gradeCap) continue;
    const speed = gapAdjust ? s.average_speed * gapFactor(grade) : s.average_speed;
    const t = s.moving_time || 1;
    wSum += efficiencyMPerBeat(speed, s.average_heartrate) * t;
    tSum += t;
    nOk++;
  }
  return nOk >= EF_MIN_SPLITS && tSum > 0 ? wSum / tSum : null;
}

/**
 * Fallback sin parciales: criterio clásico de carrera entera — 20-75 min, toda
 * en banda aeróbica y llana.
 */
export function efFromWholeRun(activity, { band, gradeCap, gapAdjust }) {
  const a = activity;
  if (!a?.average_heartrate || a.average_heartrate < band.lo || a.average_heartrate > band.hi) return null;
  if (!a.average_speed || a.average_speed < 1.5 || !a.distance) return null;
  const dur = a.moving_time || 0;
  if (dur < 1200 || dur > EF_DRIFT_WINDOW_S) return null;
  const gradeFrac = (a.total_elevation_gain || 0) / a.distance;
  if (Math.abs(gradeFrac) * 100 >= gradeCap) return null;
  const speed = gapAdjust
    ? a.average_speed * gapFactorFromGain(a.distance, a.total_elevation_gain || 0)
    : a.average_speed;
  return efficiencyMPerBeat(speed, a.average_heartrate);
}

/**
 * EF de una actividad en m/latido, o null si no es un esfuerzo comparable.
 * Usa los parciales cuando hay al menos cuatro; si no, el criterio de carrera
 * entera. Descarta lo que no sea carrera a pie (fútbol, bici y tenis contaminan
 * el EF) y lo que no llegue a 2 km.
 *
 * @param {object} activity actividad de Strava
 * @param {object} opts
 * @param {number} opts.maxObservedHr FCmax observada en el histórico
 * @param {boolean} opts.gapAdjust ajustar la velocidad por desnivel (permite hasta 4 %)
 */
export function efficiencyFactorRun(activity, { maxObservedHr, gapAdjust = false } = {}) {
  const a = activity;
  if (!a) return null;
  if (!/run/i.test(a.sport_type || a.type || '')) return null;
  if (!a.distance || a.distance < 2000) return null;
  const band = efHrBand(maxObservedHr);
  const gradeCap = gapAdjust ? EF_GRADE_CAP.gap : EF_GRADE_CAP.raw;
  const opts = { band, gradeCap, gapAdjust };
  return a.splits_metric?.length >= 4
    ? efFromSplits(a.splits_metric, opts)
    : efFromWholeRun(a, opts);
}
