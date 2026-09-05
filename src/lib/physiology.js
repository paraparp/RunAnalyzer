// ============================================================================
// physiology — ecuaciones de coste de oxígeno y estimación de VO2max.
//
// Fuente ÚNICA de las fórmulas clásicas. Estaban copiadas literalmente entre
// VDOTEstimator, VO2MaxTracker y VitalsOverview (la cuadrática de Daniels-Gilbert
// era byte-idéntica en dos sitios), así que un ajuste en una vista dejaba a las
// otras con otro número para el mismo entrenamiento.
//
// Referencias:
// - Daniels & Gilbert, "Oxygen Power" 1979
// - Léger & Mercier, Sports Medicine 1984 (con resistencia al viento de Pugh)
// - ACSM Guidelines for Exercise Testing
// - Swain & Leutholtz, Med Sci Sports Exerc 1997 (%HRR = %VO2R)
// - Swain 1994 (%VO2max desde %FCmax)
// ============================================================================

/** VO2 en reposo (ml/kg/min): 1 MET. */
export const VO2_REST = 3.5;

// ── Coste de oxígeno ────────────────────────────────────────────────────────

/** Cuadrática de Daniels-Gilbert (1979). v = m/min → ml/kg/min */
export function oxygenCostDaniels(vMperMin) {
  return -4.60 + 0.182258 * vMperMin + 0.000104 * vMperMin * vMperMin;
}

/** Léger-Mercier en exterior, con resistencia al viento de Pugh (1984). v = km/h */
export function oxygenCostLeger(vKmh) {
  return 2.209 + 3.163 * vKmh + 0.000525542 * vKmh * vKmh * vKmh;
}

/** Ecuación metabólica de carrera del ACSM. speed = m/min, grade = fracción */
export function oxygenCostACSM(speedMperMin, grade) {
  return 0.2 * speedMperMin + 0.9 * speedMperMin * grade + 3.5;
}

/**
 * Fracción del VO2max sostenible durante una carrera de `t` minutos.
 * Tiende a ~0.8 en esfuerzos muy largos y supera 1.0 en los muy cortos.
 */
export function sustainableFraction(t) {
  return 0.8
    + 0.1894393 * Math.exp(-0.012778 * t)
    + 0.2989558 * Math.exp(-0.1932605 * t);
}

/**
 * Inversa de `oxygenCostDaniels`: velocidad (m/min) para un VO2 dado.
 * Rama positiva de la cuadrática.
 */
export function velocityFromVO2(vo2) {
  const a = 0.000104, b = 0.182258, c = -4.60 - vo2;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 0;
  return (-b + Math.sqrt(disc)) / (2 * a);
}

// ── VO2max a partir de la frecuencia cardiaca ───────────────────────────────

/**
 * Banda donde la equivalencia %HRR = %VO2R de Swain-Leutholtz aguanta de verdad.
 *
 * La banda antigua (35–95 % HRR) no filtraba nada: con FCmax 190 y FCrep 50 son
 * 99 ppm de ancho, así que entraba cualquier sesión y el VO2max estimado salía
 * ~16 % MÁS ALTO en un rodaje suave que en un tempo del mismo atleta el mismo
 * día. Fuera de 70–88 % HRR la relación se curva y lo que se mide es la
 * intensidad de la sesión, no la forma.
 */
export const HRR_VALID_MIN = 0.70;
export const HRR_VALID_MAX = 0.88;

/**
 * Método HRR (Swain-Leutholtz 1997): %HRR = %VO2R.
 *   VO2_run = VO2rest + %HRR × (VO2max − VO2rest)
 * Se despeja VO2max. Solo válido dentro de `HRR_VALID_MIN`–`HRR_VALID_MAX`;
 * fuera de ella devuelve null en vez de un número que no significa nada.
 *
 * Aun dentro de banda, esto es un PROXY SUBMÁXIMO de eficiencia: la cifra buena
 * de VO2max sale de un rendimiento medido (`lib/vdot.js`), no de la FC.
 */
export function vo2maxFromHRR(vo2Running, hr, hrRest, hrMax) {
  const pctHRR = (hr - hrRest) / (hrMax - hrRest);
  if (pctHRR < HRR_VALID_MIN || pctHRR > HRR_VALID_MAX) return null;
  const vo2max = VO2_REST + (vo2Running - VO2_REST) / pctHRR;
  return vo2max > 15 && vo2max < 90 ? vo2max : null;
}

/**
 * Banda equivalente a `HRR_VALID_MIN`–`HRR_VALID_MAX` expresada en %FCmax. Con
 * FCmax 190 y FCrep 50, 70–88 % HRR son 78–91 % FCmax; se redondea a 78–92 %
 * para no dejar fuera perfiles con FC en reposo más alta. Sin esta banda el
 * fallback reintroducía por la puerta de atrás justo el sesgo que HRR filtra.
 */
export const HRMAX_PCT_VALID_MIN = 0.78;
export const HRMAX_PCT_VALID_MAX = 0.92;

/**
 * Fallback %FCmax (Swain 1994): %VO2max = 1.5286 × %FCmax − 0.5286.
 * Menos preciso que HRR, pero no necesita FC en reposo.
 */
export function vo2maxFromHRmaxPct(vo2Running, hr, hrMax) {
  const pctHRmax = hr / hrMax;
  if (pctHRmax < HRMAX_PCT_VALID_MIN || pctHRmax > HRMAX_PCT_VALID_MAX) return null;
  const pctVO2max = 1.5286 * pctHRmax - 0.5286;
  if (pctVO2max <= 0.20) return null;
  const vo2max = vo2Running / pctVO2max;
  return vo2max > 15 && vo2max < 90 ? vo2max : null;
}

/**
 * Estimación ligera de VO2max para UNA sesión, a partir de su velocidad media y
 * su FC media: HRR cuando se conoce la FC en reposo, %FCmax si no. Es la versión
 * de un solo paso que usa el resumen vital; VO2MaxTracker hace lo mismo pero con
 * corrección de deriva cardiaca, media recortada y ponderación EWMA.
 *
 * @param {number} speedMs velocidad media en m/s
 */
export function vo2FromRun(speedMs, hr, hrRest, hrMax) {
  if (!speedMs || !hr || hr < 90) return null;
  const vo2Running = oxygenCostLeger(speedMs * 3.6); // m/s → km/h
  if (hrRest && hrMax > hrRest) {
    const v = vo2maxFromHRR(vo2Running, hr, hrRest, hrMax);
    if (v != null) return v;
  }
  if (hrMax) return vo2maxFromHRmaxPct(vo2Running, hr, hrMax);
  return null;
}
