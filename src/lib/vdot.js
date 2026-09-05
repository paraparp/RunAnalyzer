// ============================================================================
// vdot — VO2max ANCLADO EN RENDIMIENTO (Daniels-Gilbert, "Oxygen Power" 1979).
//
// Por qué existe este módulo: la estimación de VO2max por frecuencia cardiaca es
// sistemáticamente sensible a la INTENSIDAD de la sesión (un rodaje suave sale
// más alto que un tempo del mismo atleta el mismo día), así que mide el punto de
// trabajo, no la forma. El VDOT no: sale de un tiempo REAL sobre una distancia
// real, que es lo que hacen el sistema Daniels y los modelos de Garmin/Firstbeat.
//
// La cifra de cabecera del VO2max sale de aquí; la vía por FC queda como serie
// secundaria (proxy submáximo de eficiencia).
//
// Las extensiones .js son obligatorias: este módulo se importa también desde
// `api/` (Node ESM), donde la resolución sin extensión no existe.
// ============================================================================

import { oxygenCostDaniels, sustainableFraction } from './physiology.js';

// Ventana de validez de la pareja de ecuaciones de Daniels-Gilbert, en segundos.
// Por debajo de ~3,5 min `sustainableFraction` pasa de 1 y el VDOT se dispara;
// por encima de ~230 min la fracción sostenible ya no describe una carrera.
export const VDOT_MIN_S = 210;
export const VDOT_MAX_S = 13800;

/**
 * VDOT de un rendimiento concreto: coste de oxígeno de la velocidad media
 * dividido por la fracción de VO2max sostenible durante ese tiempo.
 */
export function calculateVDOT(distanceMeters, timeSeconds) {
  if (!(distanceMeters > 0) || !(timeSeconds > 0)) return null;
  const t = timeSeconds / 60;              // min
  const v = distanceMeters / t;            // m/min
  const fraction = sustainableFraction(t);
  if (fraction <= 0) return null;
  const vdot = oxygenCostDaniels(v) / fraction;
  return vdot > 0 ? vdot : null;
}

/**
 * Tiempo previsto para una distancia dado un VDOT. La ecuación es trascendente
 * (el tiempo aparece en los dos lados), así que se invierte por bisección.
 */
export function predictRaceTime(vdot, distanceMeters) {
  if (!(vdot > 0) || !(distanceMeters > 0)) return null;
  let lo = 60;        // 1 min
  let hi = 60 * 600;  // 10 h

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const midVdot = calculateVDOT(distanceMeters, mid);
    // `null` aquí solo puede venir de una velocidad tan baja que el coste de
    // oxígeno de Daniels sale negativo, es decir, de un tiempo DEMASIADO LARGO.
    // Tratarlo como "demasiado rápido" empujaba la búsqueda hacia arriba y
    // devolvía el tope de 10 h: le pasaba a toda distancia por debajo de ~7,5 km
    // (el primer punto medio, 5 h, ya cae en esa zona), o sea a todo 5K.
    if (midVdot === null) hi = mid;
    else if (midVdot > vdot) lo = mid;                 // demasiado rápido → más tiempo
    else hi = mid;                                     // demasiado lento → menos tiempo
  }
  return (lo + hi) / 2;
}

/**
 * VDOT del atleta a partir de la curva de mejores esfuerzos (`buildMeanMaxCurve`).
 *
 * Se evalúa cada punto de la curva dentro de la ventana de validez y se toma el
 * MEJOR: por definición de mean-max cada punto es un "todo lo que puedas" sobre
 * esa duración, y el VDOT es la envolvente de esos rendimientos. Un rodaje suave
 * no puede subir la cifra —solo un esfuerzo mejor que los anteriores lo hace—,
 * que es exactamente lo contrario de lo que pasaba con la vía por FC.
 *
 * @returns {{vdot:number, anchor:object, n:number, candidates:Array}|null}
 */
export function vdotFromCurve(points = [], { minTime = VDOT_MIN_S, maxTime = VDOT_MAX_S } = {}) {
  const candidates = [];

  for (const p of points) {
    if (!(p?.time_s >= minTime) || !(p.time_s <= maxTime)) continue;
    const vdot = calculateVDOT(p.distance_m, p.time_s);
    if (vdot == null || vdot < 20 || vdot > 90) continue;
    candidates.push({ ...p, vdot });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.vdot - a.vdot);
  const anchor = candidates[0];

  return {
    vdot: Math.round(anchor.vdot * 10) / 10,
    anchor,
    n: candidates.length,
    candidates,
  };
}
