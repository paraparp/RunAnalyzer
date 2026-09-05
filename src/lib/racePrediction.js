// ============================================================================
// racePrediction — predicción DETERMINISTA de marcas sobre las cuatro distancias
// de carretera, a partir de los datos del propio atleta.
//
// Por qué existe este módulo: la predicción se le pedía entera a un LLM, al que
// se le dictaba Riegel de palabra ("T2 = T1 × (D2/D1)^1.06") y luego había que
// sanear la respuesta en cliente (tiempos imposibles, ritmos invertidos). Que
// hiciera falta ese saneamiento decía todo sobre el método.
//
// Aquí los tiempos salen de tres modelos ajustados sobre el histórico real:
//
//   1. VDOT (Daniels-Gilbert) — `lib/vdot`, anclado en la curva mean-max.
//      Válido de ~3,5 min a ~230 min: cubre las cuatro distancias.
//   2. Velocidad crítica d = CS·t + D′ — `lib/criticalSpeed`. Es el umbral
//      MEDIDO del atleta, pero solo vale dentro de su ventana (2–30 min): fuera
//      ignora la fatiga y predice tiempos demasiado buenos, así que las
//      predicciones marcadas `optimistic` se descartan en vez de mezclarse.
//   3. Riegel con exponente INDIVIDUALIZADO — el 1,06 clásico infraestima el
//      maratón de forma conocida; la práctica moderna ajusta el exponente sobre
//      las marcas del propio corredor (típicamente 1,06–1,10), y la curva
//      mean-max ya da los puntos para hacerlo.
//
// Al LLM le queda lo que sabe hacer bien: ajustar por contexto (CTL/TSB,
// volumen, especificidad, calor) y redactar el porqué, sobre estos números.
//
// Las extensiones .js son obligatorias: este módulo puede importarse desde
// `api/` (Node ESM), donde la resolución sin extensión no existe.
// ============================================================================

import {
  buildMeanMaxCurve,
  fitCriticalSpeed,
  predictTime,
  monthsAgoISO,
} from './criticalSpeed.js';
import { vdotFromCurve, predictRaceTime, VDOT_MIN_S, VDOT_MAX_S } from './vdot.js';
import { RACE_DISTANCES } from './raceDistances.js';

// Exponente de Riegel: el clásico y la banda dentro de la que se acepta el
// ajuste individual. Fuera de [1.01, 1.15] la regresión no describe la fatiga de
// un corredor, sino un histórico incoherente (dos esfuerzos, uno a tope y otro
// no), así que se cae al clásico.
export const RIEGEL_DEFAULT = 1.06;
export const RIEGEL_MIN = 1.01;
export const RIEGEL_MAX = 1.15;

// Ventana temporal por defecto del histórico que alimenta los modelos (meses).
export const DEFAULT_WINDOW_MONTHS = 12;

// Un ancla deja de describir la forma ACTUAL pasado este plazo (días). No
// invalida la predicción: baja la confianza.
export const ANCHOR_FRESH_DAYS = 120;

// Ritmos fuera de esta banda no son una predicción (los mismos límites que
// aplicaba el saneador de la respuesta del LLM), en s/km.
export const PACE_MIN_S_KM = 150;
export const PACE_MAX_S_KM = 720;

/**
 * Exponente de Riegel del atleta: regresión de log(t) sobre log(d) en la curva
 * mean-max. La pendiente ES el exponente (t ∝ d^b).
 *
 * Se exige un abanico de distancias real (la más larga al menos el doble que la
 * más corta): con puntos apelotonados la pendiente es ruido.
 *
 * @returns {{exponent:number, n:number, r2:number, fitted:boolean}}
 */
export function fitRiegelExponent(points = [], { minTime = VDOT_MIN_S, maxTime = VDOT_MAX_S } = {}) {
  const used = points.filter((p) => p?.time_s >= minTime && p.time_s <= maxTime && p.distance_m > 0);
  const fallback = { exponent: RIEGEL_DEFAULT, n: used.length, r2: 0, fitted: false };
  if (used.length < 3) return fallback;

  const spread = Math.max(...used.map((p) => p.distance_m)) / Math.min(...used.map((p) => p.distance_m));
  if (spread < 2) return fallback;

  const xs = used.map((p) => Math.log(p.distance_m));
  const ys = used.map((p) => Math.log(p.time_s));
  const n = used.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (sxx === 0) return fallback;
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);

  const b = sxy / sxx;
  if (!(b >= RIEGEL_MIN && b <= RIEGEL_MAX)) return fallback;

  const ssTot = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (my + b * (xs[i] - mx))) ** 2, 0);

  return { exponent: b, n, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, fitted: true };
}

/** Riegel puro: T2 = T1 × (D2/D1)^b. */
export function riegelTime(anchor, distanceM, exponent = RIEGEL_DEFAULT) {
  if (!(anchor?.time_s > 0) || !(anchor.distance_m > 0) || !(distanceM > 0)) return null;
  return anchor.time_s * (distanceM / anchor.distance_m) ** exponent;
}

// Confianza a partir de dos cosas medibles: cuánto hay que extrapolar desde el
// ancla y cuánto se contradicen los modelos entre sí. Nada de "confianza" a ojo.
export function confidenceFor({ ratio, spread, anchorAgeDays }) {
  if (ratio <= 1.5 && spread <= 0.04 && anchorAgeDays <= ANCHOR_FRESH_DAYS) return 'Alta';
  if (ratio <= 3 && spread <= 0.08) return 'Media';
  return 'Baja';
}

const daysBetween = (fromMs, isoDate) => {
  const t = Date.parse(`${isoDate}T00:00:00`);
  if (Number.isNaN(t)) return Infinity;
  return Math.max(0, Math.round((fromMs - t) / 86400000));
};

/**
 * Predicción determinista para las cuatro distancias oficiales.
 *
 * @param {Array} activities  histórico (mismo formato que el resto de vistas)
 * @returns {{items:Array, anchor:object|null, vdot:number|null, cs:object|null,
 *            riegel:object|null, curve:Array, reason:string|null}}
 */
export function predictRaces(activities = [], { months = DEFAULT_WINDOW_MONTHS, now = Date.now() } = {}) {
  const curve = buildMeanMaxCurve(activities, { from: monthsAgoISO(months) });

  const vdotFit = vdotFromCurve(curve);
  if (!vdotFit) {
    return {
      items: [], anchor: null, anchorAgeDays: null, vdot: null, cs: null, riegel: null, curve,
      reason: 'no hay ningún esfuerzo máximo de entre 3,5 min y 3,8 h en la ventana analizada',
    };
  }

  const anchor = vdotFit.anchor;
  const anchorAgeDays = daysBetween(now, anchor.date);
  const csFit = fitCriticalSpeed(curve);
  const riegel = fitRiegelExponent(curve);

  const items = [];
  for (const d of RACE_DISTANCES) {
    const models = {};

    const vdotT = predictRaceTime(vdotFit.vdot, d.m);
    if (vdotT > 0) models.vdot = vdotT;

    // CS solo dentro de su ventana de validez: fuera es una cota, no una predicción.
    const csT = predictTime(csFit, d.m);
    if (csT && !csT.optimistic) models.cs = csT.time_s;

    const riegelT = riegelTime(anchor, d.m, riegel.exponent);
    if (riegelT > 0) models.riegel = riegelT;

    const values = Object.values(models);
    if (values.length === 0) continue;

    // Media simple: los tres modelos están ajustados sobre los MISMOS datos del
    // atleta y ninguno es claramente mejor en todo el rango, así que ponderar
    // sería inventar una jerarquía que no está en los datos.
    const timeSeconds = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
    const paceSec = timeSeconds / (d.m / 1000);
    if (paceSec < PACE_MIN_S_KM || paceSec > PACE_MAX_S_KM) continue;

    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Con un solo modelo no hay acuerdo que medir: se asume dispersión media
    // para que la confianza no salga "Alta" por falta de contraste.
    const spread = values.length > 1 ? (sorted[sorted.length - 1] - sorted[0]) / median : 0.05;
    const ratio = Math.max(d.m / anchor.distance_m, anchor.distance_m / d.m);

    items.push({
      key: d.key,
      label: d.label,
      km: d.m / 1000,
      distanceM: d.m,
      timeSeconds,
      paceSec,
      confidence: confidenceFor({ ratio, spread, anchorAgeDays }),
      models,
      spread,
    });
  }

  // La curva de un corredor es monótona: el ritmo NO puede mejorar al alargar la
  // distancia. Si la mezcla lo rompe (pasa cuando CS entra solo en las cortas),
  // se corrige aquí, en vez de limitarse a avisar de la incoherencia como hacía
  // la vía por LLM.
  items.sort((a, b) => a.distanceM - b.distanceM);
  for (let i = 1; i < items.length; i++) {
    if (items[i].paceSec <= items[i - 1].paceSec) {
      items[i].paceSec = items[i - 1].paceSec + 1;
      items[i].timeSeconds = Math.round(items[i].paceSec * items[i].km);
      items[i].adjustedForMonotonicity = true;
    }
  }

  return {
    items,
    anchor,
    anchorAgeDays,
    vdot: vdotFit.vdot,
    cs: csFit,
    riegel,
    curve,
    reason: items.length === 0 ? 'los modelos dieron ritmos fuera de rango' : null,
  };
}

// Cuánto puede mover la IA un tiempo calculado. El ajuste por contexto (bajo
// volumen para el maratón, TSB en negativo, calor) es real y el modelo lo hace
// bien; reescribir la predicción no, así que se acota. Fuera de esta banda la
// respuesta no es un ajuste, es otra predicción.
export const MAX_ADJUST_PCT = 0.08;

// El esquema de salida del servidor es permisivo (label es string libre, no
// enum), así que el modelo puede devolver "media maraton", "HM", "21k"… Se mapea
// a la clave canónica antes de casarlo con la predicción calculada.
export function normalizeRaceKey(raw) {
  const s = String(raw || '').toLowerCase().replace(/[·\-\s]/g, '');
  if (/(^|[^0-9])5k|^5000m?$/.test(s)) return '5k';
  if (/10k|10000m?/.test(s)) return '10k';
  if (/(media|half|21k|21\.1|halfmarathon)/.test(s)) return '21k';
  if (/(marat|42k|42\.2|full)/.test(s)) return '42k';
  return null;
}

/**
 * Aplica el ajuste del entrenador IA sobre las predicciones DETERMINISTAS.
 *
 * Los tiempos ya no los pone el modelo: los pone `predictRaces`. De la IA se
 * toma el porqué (`rationale`) y un ajuste acotado a ±8 %; la confianza sigue
 * siendo la MEDIDA (extrapolación + acuerdo entre modelos), no la que se opine.
 * Después se vuelve a imponer la monotonía por si el ajuste rompe el orden.
 */
export function applyCoachAdjustment(base = [], raw = []) {
  const byKey = new Map();
  for (const p of raw || []) {
    const key = normalizeRaceKey(p?.label);
    if (key && !byKey.has(key)) byKey.set(key, p);
  }

  const items = base.map((pred) => {
    const ai = byKey.get(pred.key);
    const t = Number(ai?.time_seconds);
    if (!Number.isFinite(t) || t <= 0) return { ...pred, rationale: ai?.rationale || '' };

    const lo = pred.timeSeconds * (1 - MAX_ADJUST_PCT);
    const hi = pred.timeSeconds * (1 + MAX_ADJUST_PCT);
    const timeSeconds = Math.round(Math.min(hi, Math.max(lo, t)));
    return {
      ...pred,
      timeSeconds,
      paceSec: timeSeconds / pred.km,
      rationale: ai?.rationale || '',
      clamped: t < lo || t > hi,
      baseTimeSeconds: pred.timeSeconds,
    };
  });

  for (let i = 1; i < items.length; i++) {
    if (items[i].paceSec <= items[i - 1].paceSec) {
      items[i].paceSec = items[i - 1].paceSec + 1;
      items[i].timeSeconds = Math.round(items[i].paceSec * items[i].km);
      items[i].adjustedForMonotonicity = true;
    }
  }
  return items;
}
