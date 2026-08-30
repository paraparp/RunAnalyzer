// ============================================================================
// criticalSpeed — curva de mejores esfuerzos (mean-max) y ajuste del modelo de
// VELOCIDAD CRÍTICA a partir de todo el histórico, no solo de las carreras.
//
// El modelo de dos parámetros dice que, en el rango de esfuerzos "todo lo que
// puedas" de unos 2 a 30 minutos, la distancia recorrida es lineal en el tiempo:
//
//     d = CS · t + D′
//
//   CS  velocidad crítica (m/s): la mayor intensidad sostenible en estado
//       estable. Es tu umbral MEDIDO, no estimado por tablas.
//   D′  reserva anaeróbica (m): los metros extra que puedes poner por encima de
//       CS antes de reventar. Es la "batería" de los cambios de ritmo.
//
// Fuera de esa ventana el modelo miente: por debajo de ~2 min manda la potencia
// anaeróbica y por encima de ~30 min aparece la fatiga que el modelo ignora, así
// que predice tiempos DEMASIADO BUENOS en media y maratón. Por eso el ajuste
// solo usa los puntos de la ventana y las predicciones largas van marcadas como
// optimistas: es una cota, no un pronóstico.
// ============================================================================

// Las extensiones .js son obligatorias: este módulo también se importa desde
// `api/` (Node ESM), donde la resolución sin extensión no existe.
import { DISTANCE_M } from './raceDistances.js';
import { formatDuration, formatPaceFromMinPerKm } from './timeFormat.js';

// Distancias canónicas de los best_efforts de Strava. Se casan por METROS y no
// por nombre: Strava los localiza según el idioma de la cuenta ("10 km",
// "1 milla"), así que comparar textos falla en silencio.
export const CANON_EFFORTS = [
  { id: '400m', m: 400, label: '400 m' },
  { id: '1/2 mile', m: 805, label: '½ milla' },
  { id: '1k', m: 1000, label: '1K' },
  { id: '1 mile', m: 1609, label: '1 milla' },
  { id: '2 mile', m: 3219, label: '2 millas' },
  { id: '5k', m: DISTANCE_M['5k'], label: '5K' },
  { id: '10k', m: DISTANCE_M['10k'], label: '10K' },
  { id: '15k', m: 15000, label: '15K' },
  { id: '10 mile', m: 16093, label: '10 millas' },
  { id: '20k', m: 20000, label: '20K' },
  { id: 'half-marathon', m: DISTANCE_M['21k'], label: 'Media' },
  { id: '30k', m: 30000, label: '30K' },
  { id: 'marathon', m: DISTANCE_M['42k'], label: 'Maratón' },
  { id: '50k', m: 50000, label: '50K' },
];

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const isRunning = (a) => RUNNING_TYPES.includes(a.type) || RUNNING_TYPES.includes(a.sport_type);

/** metros → id canónico (tolerancia 1.5%, de sobra para distancias estándar). */
export function canonByMeters(m) {
  if (!m) return null;
  let best = null;
  for (const e of CANON_EFFORTS) {
    const err = Math.abs(m - e.m) / e.m;
    if (err <= 0.015 && (!best || err < best.err)) best = { id: e.id, err };
  }
  return best?.id || null;
}

/**
 * Distancia TOTAL de una actividad → id canónico si la actividad ES esa
 * distancia. Todo el histórico anterior al ingest de efforts trae `best_efforts`
 * vacío; en una carrera el tiempo de la actividad ES su mejor esfuerzo, así que
 * se sintetiza. Rango asimétrico [−0.2%, +3%]: una carrera mide justo o un poco
 * larga por GPS, nunca corta.
 */
export function raceDistanceId(m) {
  if (!m) return null;
  for (const e of CANON_EFFORTS) {
    if (m >= e.m * 0.998 && m <= e.m * 1.03) return e.id;
  }
  return null;
}

const dayOf = (a) => String(a.start_date_local || a.start_date || '').slice(0, 10);

/**
 * Mejor tiempo conseguido en cada distancia canónica dentro del rango de fechas.
 * Devuelve los puntos ordenados de menor a mayor distancia.
 */
export function buildMeanMaxCurve(activities = [], { from = null, to = null } = {}) {
  const best = new Map();   // id canónico → mejor punto

  const consider = (id, distance, timeS, activity, source) => {
    if (!id || !(timeS > 0) || !(distance > 0)) return;
    const prev = best.get(id);
    if (prev && prev.time_s <= timeS) return;
    best.set(id, {
      id,
      distance_m: Math.round(distance),
      time_s: Math.round(timeS),
      speed_m_s: distance / timeS,
      pace_min_km: (timeS / 60) / (distance / 1000),
      date: dayOf(activity),
      activity_id: activity.id,
      activity_name: activity.name || null,
      source,
    });
  };

  for (const a of activities) {
    if (!isRunning(a)) continue;
    const day = dayOf(a);
    if (from && day < from) continue;
    if (to && day > to) continue;

    for (const e of a.best_efforts || []) {
      const t = e.moving_time || e.elapsed_time;
      consider(canonByMeters(e.distance), e.distance, t, a, 'best_effort');
    }
    // Carreras antiguas sin efforts: el tiempo total hace de mejor esfuerzo.
    consider(raceDistanceId(a.distance), a.distance, a.moving_time || a.elapsed_time, a, 'total_distance');
  }

  return [...best.values()].sort((x, y) => x.distance_m - y.distance_m);
}

// Ventana de validez del modelo de dos parámetros, en segundos.
export const FIT_MIN_S = 120;
export const FIT_MAX_S = 1800;

// Banda de plausibilidad fisiológica de CS en carrera a pie (m/s): 1.4 ≈ 11:54/km
// y 6.5 ≈ 2:34/km. Una pendiente fuera de aquí no describe a un corredor, sino a
// una regresión sobre datos incoherentes.
export const CS_MIN_M_S = 1.4;
export const CS_MAX_M_S = 6.5;

/** Fecha ISO (YYYY-MM-DD) de hace N meses; `null` = sin límite inferior. Única
 *  definición de la ventana temporal, para que todas las vistas ajusten el
 *  modelo sobre exactamente el mismo histórico. */
export function monthsAgoISO(months) {
  if (months == null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * ¿La curva contradice la definición de esfuerzo máximo? En una curva real la
 * velocidad DECRECE con la duración; si un esfuerzo más largo sale más rápido
 * que uno más corto, esos puntos no se corrieron a tope y el ajuste —salga o
 * no— no describe un umbral. Diagnóstico, no filtro: informa, no descarta.
 */
export function hasNonMaximalPoints(points = [], { minTime = FIT_MIN_S, maxTime = FIT_MAX_S } = {}) {
  const used = points
    .filter((p) => p.time_s >= minTime && p.time_s <= maxTime)
    .sort((a, b) => a.time_s - b.time_s);
  for (let i = 1; i < used.length; i++) {
    if (used[i].speed_m_s >= used[i - 1].speed_m_s) return true;
  }
  return false;
}

/**
 * Ajusta d = CS·t + D′ por mínimos cuadrados sobre los puntos de la ventana.
 * Devuelve null si no hay al menos 3 puntos utilizables, si D′ sale negativo o
 * si CS cae fuera de la banda plausible: con datos escasos o incoherentes la
 * regresión da una pendiente cualquiera, y más vale no ajuste que un umbral
 * inventado.
 */
export function fitCriticalSpeed(points = [], { minTime = FIT_MIN_S, maxTime = FIT_MAX_S } = {}) {
  const used = points.filter((p) => p.time_s >= minTime && p.time_s <= maxTime);
  if (used.length < 3) return null;

  const n = used.length;
  const sumT = used.reduce((s, p) => s + p.time_s, 0);
  const sumD = used.reduce((s, p) => s + p.distance_m, 0);
  const sumTT = used.reduce((s, p) => s + p.time_s * p.time_s, 0);
  const sumTD = used.reduce((s, p) => s + p.time_s * p.distance_m, 0);

  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return null;

  const cs = (n * sumTD - sumT * sumD) / denom;          // pendiente = CS (m/s)
  const dPrime = (sumD - cs * sumT) / n;                 // ordenada = D′ (m)
  if (!(dPrime > 0) || !(cs >= CS_MIN_M_S && cs <= CS_MAX_M_S)) return null;

  const meanD = sumD / n;
  const ssTot = used.reduce((s, p) => s + (p.distance_m - meanD) ** 2, 0);
  const ssRes = used.reduce((s, p) => s + (p.distance_m - (cs * p.time_s + dPrime)) ** 2, 0);

  return {
    cs_m_s: cs,
    cs_pace_min_km: (1000 / cs) / 60,
    d_prime_m: dPrime,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 1,
    n,
    used_ids: used.map((p) => p.id),
    window_s: [minTime, maxTime],
  };
}

/**
 * Tiempo previsto para una distancia según el modelo: t = (d − D′) / CS.
 * `optimistic` marca las que caen fuera de la ventana de validez, donde el
 * modelo ignora la fatiga y se queda corto de tiempo.
 */
export function predictTime(fit, distanceM) {
  if (!fit || !(distanceM > 0)) return null;
  const t = (distanceM - fit.d_prime_m) / fit.cs_m_s;
  if (!(t > 0)) return null;
  return {
    distance_m: Math.round(distanceM),
    time_s: t,
    pace_min_km: (t / 60) / (distanceM / 1000),
    optimistic: t > fit.window_s[1],
  };
}

/** Velocidad sostenible prevista para una duración: v = CS + D′/t. */
export function speedForDuration(fit, seconds) {
  if (!fit || !(seconds > 0)) return null;
  return fit.cs_m_s + fit.d_prime_m / seconds;
}

// Se mantienen los nombres cortos por compatibilidad con quien ya los importa,
// pero el formateo vive en timeFormat: aquí solo se fija el marcador '—'.
/** "mm:ss" o "h:mm:ss" a partir de segundos. */
export const fmtTime = (seconds) => formatDuration(seconds, '—');

/** Ritmo en min/km a "m:ss". */
export const fmtPace = (paceMin) => formatPaceFromMinPerKm(paceMin, '—');
