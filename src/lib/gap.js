// ============================================================================
// gap — Grade Adjusted Pace. Fuente única del ajuste por desnivel de la app.
//
// Antes de este módulo convivían DOS modelos y cinco implementaciones:
//   · lineal "8 s por cada 10 m D+/km" — App.jsx (×2), ActivitySplits, HRAnalysis
//   · Minetti — VitalsOverview, trainingLoad, api/_lib/mcp-store
// La misma actividad mostraba un GAP en la tabla del dashboard y otro distinto al
// desplegar sus parciales. Aquí queda un solo modelo, el de Minetti amortiguado,
// que es el que ya usaba el backend (tool MCP `get_activity`).
//
// Sobre el modelo lineal que se retira: sus 8 s/10 m/km reproducen bien a Minetti
// **para pendiente NETA** (a 5:00/km, +1% de pendiente ≈ 8 s/km). El problema es
// que se le pasaba `total_elevation_gain`, que es desnivel POSITIVO ACUMULADO, no
// neto. En un bucle de 10 km con 100 m D+ y 100 m D− el modelo cobraba la subida
// entera y regalaba el descenso: sobreestimaba el GAP unas 3 veces. Para ese caso
// está `gapFactorFromGain`, que asume perfil ondulado (ver más abajo).
// ============================================================================

/**
 * Coste energético de correr en pendiente `i` (J·kg⁻¹·m⁻¹), regresión polinómica
 * de Minetti et al. (2002). `i` = pendiente en fracción con signo (+ subida).
 */
export function minettiCost(i) {
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/** Coste en llano, C(0) = 3.6 J·kg⁻¹·m⁻¹. */
export const FLAT_COST = 3.6;

// Usar el ratio de coste directamente como ratio de velocidad sobre-reacciona: la
// derivada de Minetti en cero es 19,5/3,6 = 5,4% de velocidad por cada 1% de
// pendiente, cuando lo aceptado empíricamente es ~2-3%. Se amortigua la desviación
// relativa con K_* (calibración empírica, NO Minetti puro) y con asimetría: el
// crédito por bajar es menor que la penalización por subir, porque la bajada no se
// convierte entera en velocidad (frenada, coste excéntrico).
const K_UP = 0.5;
const K_DOWN = 0.35;

// Tope inferior = el factor a −10%. El polinomio de Minetti tiene su mínimo de coste
// mucho más abajo (≈ −18% en esta regresión), pero por debajo de −10% el coste real
// deja de bajar: la frenada y el trabajo excéntrico se comen el ahorro.
const GAP_FLOOR = 0.86;
const GAP_CEIL = 1.35;

/**
 * Factor de velocidad equivalente en llano para una pendiente NETA con signo.
 * >1 en subida (habrías ido más rápido en llano), <1 en bajada.
 *
 * Entrada correcta: `elevation_difference / distance` de un parcial. NO le pases
 * `total_elevation_gain`: para eso está `gapFactorFromGain`.
 */
export function gapFactor(grade) {
  if (!Number.isFinite(grade) || grade === 0) return 1;
  const c = minettiCost(grade);
  if (!(c > 0)) return 1;
  const rel = c / FLAT_COST - 1;
  const f = 1 + rel * (grade >= 0 ? K_UP : K_DOWN);
  return Math.min(GAP_CEIL, Math.max(GAP_FLOOR, f));
}

/**
 * Factor de GAP cuando lo único que se conoce es el desnivel positivo acumulado
 * (`total_elevation_gain`), que es el caso de la cabecera de una actividad.
 *
 * Modelo: perfil ondulado que vuelve a su altura de salida — la mitad de la
 * distancia sube acumulando todo el D+ y la otra mitad baja lo mismo, así que la
 * pendiente de cada tramo es `2·D+/distancia`. El tiempo equivalente en llano es
 * la suma de los dos tramos, de donde sale la media armónica de ambos factores.
 * Con D+ = 0 devuelve 1 exacto.
 *
 * Es una hipótesis, no una medida: la mayoría de las carreras son circuitos o
 * ida-y-vuelta, así que aproxima bien; una subida punto a punto queda infravalorada
 * (para ese caso hacen falta los parciales y `gapFactor`).
 */
export function gapFactorFromGain(distanceM, elevGainM) {
  if (!(distanceM > 0) || !(elevGainM > 0)) return 1;
  const g = Math.min((2 * elevGainM) / distanceM, 0.30);
  const up = gapFactor(g);
  const down = gapFactor(-g);
  if (!(up > 0) || !(down > 0)) return 1;
  return 2 / (1 / up + 1 / down);
}

/** Velocidad equivalente en llano (m/s) a partir de una pendiente neta con signo. */
export function gapSpeed(speedMs, grade) {
  if (!(speedMs > 0)) return 0;
  return speedMs * gapFactor(grade);
}

/** Velocidad equivalente en llano (m/s) a partir del D+ acumulado de la actividad. */
export function gapSpeedFromGain(speedMs, distanceM, elevGainM) {
  if (!(speedMs > 0)) return 0;
  return speedMs * gapFactorFromGain(distanceM, elevGainM);
}
