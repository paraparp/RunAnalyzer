// ============================================================================
// zoneMix — reparto del tiempo por zonas de FC, en un solo sitio.
//
// El cálculo estaba dentro de `TrainingZones.jsx` (hrSegments + el bucle de
// `zoneStats` + los cortes de la polarización). En cuanto una segunda vista
// quiso enseñar el mismo reparto —la portada— había dos formas de contarlo, y
// eso es justo lo que §2.1 de REESTRUCTURACION_SECCIONES viene arreglando: un
// número, un dueño. Aquí vive el cálculo; las vistas lo pintan.
//
// Módulo PURO: sin React y sin i18n. Los estados de polarización se devuelven
// como CLAVE ('ok' | 'gray' | 'low' | 'mod') y cada vista la traduce.
// ============================================================================
import { classifyHR, POLARIZED_TARGETS } from './hrZones.js';

// Muestras de FC por segmento ({ hr, time }) para contar tiempo en zona.
// Clasificar un rodaje entero por su FC media lo colapsa en UNA zona: un mes de
// rodajes suaves saldría como 100 % Z2, algo físicamente imposible (todo rodaje
// tiene calentamiento en Z1 y repechos en Z3+). Los parciales por km (o las
// vueltas) recuperan el reparto real. Solo se cae a la media de la sesión
// cuando no hay FC por segmento — actividades antiguas sin enriquecer.
export function hrSegments(a) {
  const src = (a.splits_metric?.length > 1 && a.splits_metric)
           || (a.laps?.length > 1 && a.laps)
           || null;
  if (src) {
    const segs = src
      .filter((s) => s.average_heartrate && (s.moving_time || s.elapsed_time))
      .map((s) => ({ hr: s.average_heartrate, time: s.moving_time || s.elapsed_time }));
    if (segs.length) return segs;
  }
  return a.average_heartrate && a.moving_time
    ? [{ hr: a.average_heartrate, time: a.moving_time }]
    : [];
}

// ¿La sesión aporta reparto real o solo su media? Lo usa la portada para decir
// sobre qué resolución está hablando en vez de dar el % como si todo viniera de
// parciales.
export const hasSegmentHR = (a) => (
  (a.splits_metric?.length > 1 && a.splits_metric.some((s) => s.average_heartrate))
  || (a.laps?.length > 1 && a.laps.some((s) => s.average_heartrate))
) || false;

/**
 * Reparto del tiempo por zonas.
 *
 * @param {Array}  activities            actividades (cualquier deporte con FC)
 * @param {Array}  bounds                cortes de `karvonenBounds`
 * @param {object} [opts]
 * @param {number} [opts.days]           ventana en días hacia atrás; null = todas
 * @param {number} [opts.now]            "ahora" inyectable (ventana estable en tests)
 * @returns {{ times:number[], pct:number[], totalSec:number, sessions:number,
 *             avgOnlySessions:number, hasData:boolean }}
 */
export function zoneMix(activities, bounds, { days = null, now = Date.now() } = {}) {
  const empty = {
    times: new Array(bounds?.length ?? 0).fill(0),
    pct: new Array(bounds?.length ?? 0).fill(0),
    totalSec: 0, sessions: 0, avgOnlySessions: 0, hasData: false,
  };
  if (!activities?.length || !bounds?.length) return empty;

  const cutoff = days == null ? null : now - days * 86400000;
  const times = new Array(bounds.length).fill(0);
  let total = 0;
  let sessions = 0;
  let avgOnly = 0;

  for (const a of activities) {
    if (cutoff != null) {
      // Ventana cerrada por los dos lados: una actividad con fecha futura (mal
      // sincronizada o planificada) no puede contar como tiempo entrenado.
      const ts = new Date(a.start_date).getTime();
      if (!(ts >= cutoff && ts <= now)) continue;
    }
    const segs = hrSegments(a);
    if (!segs.length) continue;
    let counted = false;
    for (const seg of segs) {
      const z = classifyHR(seg.hr, bounds);
      if (z >= 0) { times[z] += seg.time; total += seg.time; counted = true; }
    }
    if (!counted) continue;
    sessions += 1;
    if (!hasSegmentHR(a)) avgOnly += 1;
  }

  if (!total) return empty;
  return {
    times,
    pct: times.map((s) => +((s / total) * 100).toFixed(1)),
    totalSec: total,
    sessions,
    avgOnlySessions: avgOnly,
    hasData: true,
  };
}

/**
 * Agrupa el reparto de las 5 zonas de Karvonen en los tres bloques con los que
 * se lee la polarización: fácil / gris / duro.
 *
 * El mapeo es el estándar al traducir un modelo de 5 zonas al de 3 (Polar,
 * TrainingPeaks): Z1+Z2 caen por debajo de LT1 (<70 % HRR), Z3 es la franja
 * moderada —la "zona gris"— y Z4+Z5 están en LT2 o por encima. Se agrupa AQUÍ y
 * no en cada vista para que Zonas y la portada no discrepen sobre qué es fácil.
 *
 * @param {number[]} pct  porcentajes por zona, de Z1 a Z5
 * @returns {{ low:number, mod:number, high:number }}
 */
export function polarizedGroups(pct = []) {
  const v = (i) => pct[i] ?? 0;
  return {
    low:  +(v(0) + v(1)).toFixed(1),
    mod:  +v(2).toFixed(1),
    high: +(v(3) + v(4)).toFixed(1),
  };
}

/**
 * Veredicto de polarización sobre los tres bloques de `polarizedGroups`.
 * Devuelve la CLAVE del estado; la etiqueta la pone quien pinta.
 *
 * Tolerancias: ±5 puntos sobre POLARIZED_TARGETS para "cumple"; la zona gris se
 * marca a partir de +10 sobre su objetivo; "falta calidad" cuando el bloque duro
 * no llega ni a la mitad del suyo.
 */
export function polarizationStatus(low = 0, mod = 0, high = 0) {
  if (low >= POLARIZED_TARGETS.low - 5 && mod <= POLARIZED_TARGETS.mod + 5) return 'ok';
  if (mod > POLARIZED_TARGETS.mod + 10) return 'gray';
  if (high < POLARIZED_TARGETS.high / 2) return 'low';
  return 'mod';
}

export default zoneMix;
