// ── Regla del 10 % — fuente única ───────────────────────────────────────────
//
// `InjuryRisk` y `WeeklyProgression` responden a la MISMA pregunta ("¿he subido
// el volumen más de la cuenta?") y lo hacían con criterios distintos: la vista
// de progresión miraba solo el porcentaje y `InjuryRisk` ya cruzaba porcentaje
// con salto absoluto en km. Dos respuestas a la misma pregunta. Aquí vive el
// criterio y las dos vistas lo consumen.
//
// El porcentaje solo miente en los dos extremos:
//   · +40 % sobre 10 km/sem son 4 km más → no es nada, y salía en rojo.
//   · +15 % sobre 90 km/sem son 13 km más → es mucho, y no llegaba a la alerta.
// Por eso se leen las dos escalas y manda la peor.
//
// Refs: la "regla del 10 %" clásica (Johnston et al.), acotada con el salto
// absoluto porque es el que se corresponde con la carga mecánica real.

/** Umbrales de la rampa semanal. `minAbsKm` es el suelo por debajo del cual el
 *  porcentaje no significa nada, por grande que sea. */
export const WEEKLY_RAMP = {
  pct: { high: 30, mid: 20, low: 10 },
  abs: { high: 20, mid: 12, low: 6 },   // km de salto respecto a la semana previa
  minAbsKm: 3,
  dropPct: -30,                          // una caída brusca también es un aviso
  alertRisk: 25,                         // riesgo a partir del cual se marca
};

/**
 * Compara dos semanas CERRADAS de volumen (km) y devuelve el cambio en las dos
 * escalas más el riesgo asociado.
 *
 * - `pctRisk` / `absRisk`: 0-80 en la escala de riesgo de `InjuryRisk`.
 * - `risk`: el peor de los dos, que es el que se pondera.
 * - `exceeds`: bandera binaria para las vistas que solo pintan "excede / no
 *   excede". Exige que el salto absoluto llegue a `minAbsKm`, así que un +40 %
 *   sobre una semana de 5 km ya no se pinta en rojo.
 */
export function weeklyVolumeRamp(lastWeekKm, prevWeekKm) {
  const last = lastWeekKm > 0 ? lastWeekKm : 0;
  const prev = prevWeekKm > 0 ? prevWeekKm : 0;
  const changePct = prev > 0 ? ((last - prev) / prev) * 100 : 0;
  const absDeltaKm = last - prev;
  const { pct, abs, minAbsKm, dropPct, alertRisk } = WEEKLY_RAMP;

  let pctRisk = 0;
  if (changePct > pct.high) pctRisk = 80;
  else if (changePct > pct.mid) pctRisk = 50;
  else if (changePct > pct.low) pctRisk = 25;
  else if (changePct < dropPct) pctRisk = 15; // volver de parón también expone
  // Un porcentaje grande sobre una base pequeña no es una subida grande.
  if (changePct > 0 && absDeltaKm < 5) pctRisk = Math.min(pctRisk, 25);

  let absRisk = 0;
  if (absDeltaKm > abs.high) absRisk = 80;
  else if (absDeltaKm > abs.mid) absRisk = 50;
  else if (absDeltaKm > abs.low) absRisk = 25;

  const risk = Math.max(pctRisk, absRisk);
  return {
    changePct,
    absDeltaKm,
    pctRisk,
    absRisk,
    risk,
    exceeds: risk >= alertRisk && absDeltaKm >= minAbsKm,
  };
}
