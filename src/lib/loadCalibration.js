// ============================================================================
// loadCalibration — UN solo criterio de calibración de FC para toda la app.
//
// El problema que resuelve: el CTL salía distinto según quién lo pidiera.
//   · Las cuatro vistas de la app (Estado, PMC, Lesión, Vitales) llamaban a
//     `computePMC(activities)` a secas, y sin `opts` la calibración cae a los
//     defaults de buildLoadParams: FC de reposo = 60 (nunca se llegaba a
//     `detectRestHR`) y LTHR = 87,5 % de FCmax (aproximación de Friel, ignorando
//     `detectLTHR`). Los dos entran en el TRIMP por reserva de FC, así que
//     sesgaban CTL, ATL y TSB enteros.
//   · La pestaña de Zonas SÍ resolvía bien esos tres parámetros (useHrParams),
//     overrides manuales incluidos, pero el PMC no los miraba: el atleta podía
//     fijar su LTHR a mano y la carga seguía usando la fórmula.
//   · El coach IA (athleteContext) tenía una tercera variante propia.
//
// Aquí vive la resolución, y NADIE más la implementa. `useHrParams` la envuelve
// para la UI (estado de los overrides), las vistas consumen el PMC ya calibrado
// y el MCP la reproduce en el servidor leyendo las mismas claves de user_storage.
//
// Es un módulo PURO a propósito: nada de React ni de cloudStorage. El servidor
// del MCP lo importa tal cual, y esa es la única forma de garantizar que la app
// y el agente den el mismo número.
// ============================================================================
import {
  detectMaxHR, detectRestHR, detectLTHR, estimateLTHR, HR_LIMITS,
} from './hrZones.js';
import { computeCriticalSpeed, computeFieldLT2Hr, LT_MONTHS } from './lactateThreshold.js';
import { buildLoadParams, computePMC } from './trainingLoad.js';

// La FCmax es un rasgo estable → se detecta sobre TODO el historial. El LTHR se
// mueve con la forma → se lee de los dos últimos meses. Misma ventana que la
// pestaña de Zonas; separarlas fue una decisión deliberada, no un descuido.
export const LTHR_WINDOW_MONTHS = 2;

/**
 * Lee un override manual. Devuelve el entero si cae dentro de [lo, hi], null si
 * está vacío y NaN si viene informado pero fuera de rango (→ se ignora y la UI lo
 * marca en rojo, en vez de aceptar en silencio una FCmax de 400).
 */
export const parseOverride = (raw, lo, hi) => {
  if (raw === '' || raw == null) return null;
  const v = Math.round(+raw);
  return Number.isFinite(v) && v >= lo && v <= hi ? v : NaN;
};

const monthsAgo = (n) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - n, now.getDate());
};

/**
 * Resuelve FCmax / FC de reposo / LTHR con el orden de siempre:
 * override manual válido → detección sobre los datos → fórmula de respaldo.
 *
 * @param {Array}  activities            historial completo de Strava
 * @param {object} [opts]
 * @param {Array}  [opts.garminData]     filas de garmin_cardiac_data (FC de reposo)
 * @param {object} [opts.overrides]      { max, rest, lthr } de hr_zone_overrides
 * @returns calibración + `params` listo para computePMC + `version` comparable.
 */
export function resolveHrCalibration(activities = [], { garminData = null, overrides = {} } = {}) {
  const list = Array.isArray(activities) ? activities : [];

  const autoMax = detectMaxHR(list);
  const maxOv = parseOverride(overrides.max, HR_LIMITS.maxLo, HR_LIMITS.maxHi);
  const hrmax = maxOv || autoMax.value;

  const autoRest = detectRestHR(garminData);
  const restOv = parseOverride(overrides.rest, HR_LIMITS.restLo, Math.min(HR_LIMITS.restHi, hrmax - 20));
  // El tope hrmax-20 evita una reserva de FC absurdamente estrecha, que dispararía
  // el TRIMP de cualquier rodaje suave.
  const hrrest = restOv || Math.min(autoRest.value, hrmax - 20);

  // LTHR anclado a RENDIMIENTO cuando se puede: la FC medida al ritmo de la
  // velocidad crítica es el mismo umbral que usa el modelo de lactato, así que
  // Zonas, Umbrales y la carga dejan de dar tres números distintos.
  const cutoff = monthsAgo(LTHR_WINDOW_MONTHS);
  const recent = list.filter((a) => new Date(a.start_date) >= cutoff);
  let csLt2 = null;
  if (list.length) {
    const cs = computeCriticalSpeed(list, LT_MONTHS);
    if (cs?.valid) csLt2 = computeFieldLT2Hr(list, LT_MONTHS, cs.csPace, hrmax);
  }
  const lthrResult = detectLTHR(recent, hrmax, { csLt2 });
  const lthrOv = parseOverride(overrides.lthr, hrrest + 10, hrmax);
  const lthr = lthrOv || Math.min(lthrResult.lthr ?? estimateLTHR(hrmax), hrmax);

  // De dónde sale cada número: la diferencia entre un parámetro MEDIDO y uno
  // supuesto es justo lo que no se veía cuando el CTL salía sesgado.
  const sources = {
    hrmax: maxOv ? 'manual' : 'detected',
    hrrest: restOv ? 'manual' : autoRest.source,       // 'garmin' | 'default'
    lthr: lthrOv ? 'manual' : lthrResult.method,       // cs | segment | field | race | formula | none
  };

  return {
    hrmax,
    hrrest,
    lthr,
    hrr: hrmax - hrrest,
    sources,
    autoMax,
    autoRest,
    lthrResult,
    recentActivities: recent,
    maxOv,
    restOv,
    lthrOv,
    // Firma de la calibración. Dos series de CTL solo son comparables si esto
    // coincide: la calibración se re-detecta con el historial vivo, así que una
    // FCmax nueva o un LTHR recién medido mueven la serie entera sin que cambie
    // nada en la petición.
    version: `tss-banister/hrmax=${hrmax}/hrrest=${hrrest}/lthr=${lthr}`,
  };
}

// Memo por identidad del array de actividades: las cuatro vistas piden el mismo
// PMC sobre el mismo historial, y detectar + ajustar el modelo sobre miles de
// actividades cuatro veces por render es puro desperdicio.
const _pmcCache = new WeakMap(); // activities -> Map<version, { pmc, calibration }>

/**
 * PMC (CTL/ATL/TSB) con la calibración compartida. Es LA función que deben usar
 * todos los consumidores: llamar a `computePMC(activities)` a secas devuelve la
 * serie con los defaults y vuelve a abrir la brecha.
 *
 * @returns {{ pmc: object|null, calibration: object }}
 */
export function computeCalibratedPMC(activities = [], opts = {}) {
  const list = Array.isArray(activities) ? activities : [];
  const calibration = resolveHrCalibration(list, opts);

  let byVersion = _pmcCache.get(list);
  if (!byVersion) { byVersion = new Map(); _pmcCache.set(list, byVersion); }
  const hit = byVersion.get(calibration.version);
  if (hit) return hit;

  const params = buildLoadParams(list, {
    hrmax: calibration.hrmax,
    hrrest: calibration.hrrest,
    lthr: calibration.lthr,
  });
  const out = { pmc: computePMC(list, { params }), calibration };
  byVersion.set(calibration.version, out);
  return out;
}
