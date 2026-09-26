// ============================================================================
// sessionAnalysis — el modelo de la vista de sesión (/activity/:id).
//
// "¿Qué pasó en este entreno?" era la pregunta más frecuente y no tenía página:
// había que cruzar a mano la bitácora, Zonas, Desacople y Eficiencia. Este módulo
// NO calcula nada nuevo: junta, para UNA actividad, lo que ya calculan los módulos
// dueños de cada número —zonas (`zoneMix`), desacople (`decoupling`), eficiencia
// (`efficiencyFactor`), GAP (`streamGap`) y calor (`weather`)— para que la sesión
// se lea con las mismas cifras que cada pestaña enseña por separado.
//
// Lo único propio es la comparación con sesiones equivalentes, que replica el
// criterio de la tool MCP `compare_similar_sessions` (distancia ±10 %, FC media
// ±5 ppm, sin competiciones, m/latido sobre la sesión entera): el número que da
// el MCP y el que ve el atleta en pantalla tienen que ser el mismo.
// ============================================================================

import { computeSplitDecoupling, decouplingLevel } from './decoupling.js';
import { efficiencyFactorRun, efficiencyMPerBeat } from './efficiencyFactor.js';
import { activityGapSpeed, hasStreamGap } from './streamGap.js';
import { sessionHeat } from './weather.js';
import { zoneMix, hasSegmentHR, polarizedGroups } from './zoneMix.js';

const RUNNING = new Set(['Run', 'TrailRun', 'VirtualRun']);
export const isRunning = (a) => RUNNING.has(a?.sport_type) || RUNNING.has(a?.type);

/** Competición según Strava (`workout_type === 1`). */
export const isRace = (a) => a?.workout_type === 1;

const movingTime = (a) => a?.moving_time || a?.elapsed_time || 0;

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * GAP de la sesión con la fuente declarada: 'streams' (medido muestra a muestra) o
 * 'gain' (hipótesis de perfil ondulado sobre el D+ de la cabecera, cota inferior del
 * ajuste en recorridos rompepiernas). Se dice cuál, igual que hace el MCP.
 */
export function sessionGap(activity) {
  const speed = activityGapSpeed(activity);
  if (!(speed > 0)) return null;
  return { speed_ms: speed, source: hasStreamGap(activity?.stream_gap) ? 'streams' : 'gain' };
}

/**
 * Desacople de la sesión en sus dos ventanas. `durability` solo aplica a tiradas de
 * 10+ km; su `reason` lo dice en vez de devolver un null mudo.
 */
export function sessionDecoupling(activity) {
  const splits = activity?.splits_metric;
  const withLevel = (d) => ({ ...d, level: decouplingLevel(d.pct) });
  return {
    halves: withLevel(computeSplitDecoupling(splits, { window: 'halves' })),
    durability: withLevel(computeSplitDecoupling(splits, { window: 'durability' })),
  };
}

/**
 * Eficiencia de la sesión en m/latido (más = mejor).
 *   whole — la sesión entera (velocidad media / FC media): es la que se compara con
 *           las sesiones equivalentes, con la convención del MCP.
 *   aerobic — el EF "de verdad" de la pestaña Eficiencia: solo los km aeróbicos y
 *           llanos (ajustado por GAP), o null si la sesión no es comparable.
 */
export function sessionEfficiency(activity, { maxObservedHr } = {}) {
  const t = movingTime(activity);
  return {
    whole: t > 0 ? efficiencyMPerBeat(activity.distance / t, activity.average_heartrate) : null,
    aerobic: efficiencyFactorRun(activity, { maxObservedHr, gapAdjust: true }),
  };
}

/**
 * Tiempo en zona de ESTA sesión, parcial a parcial (el mismo `zoneMix` que la
 * pestaña de Zonas). `resolution` dice si sale de parciales o solo de la FC media.
 */
export function sessionZones(activity, bounds) {
  if (!bounds?.length) return null;
  const mix = zoneMix([activity], bounds);
  if (!mix.hasData) return null;
  return {
    ...mix,
    groups: polarizedGroups(mix.pct),
    resolution: hasSegmentHR(activity) ? 'splits' : 'average',
  };
}

/** Calor de la sesión desde su registro de Garmin (null si no hay meteorología). */
export function sessionWeather(garminActivity, activity, { hrMax } = {}) {
  return sessionHeat(garminActivity?.weather, activity?.average_heartrate, hrMax);
}

/**
 * Sesiones equivalentes a `activity` dentro de `all`, con el criterio del MCP.
 *
 * Devuelve `{ sessions, n, median_ef, median_speed_ms, ef_delta_pct, rank, criteria }`:
 *   ef_delta_pct — cuánto más (o menos) eficiente fue esta sesión que la mediana del
 *                  grupo. Es la cifra que dice si fue un buen día.
 *   rank         — puesto por eficiencia de esta sesión dentro del grupo más ella (1 = mejor).
 * null si la referencia no tiene distancia.
 */
export function findSimilarSessions(activity, all, {
  distanceTolPct = 10, hrTolBpm = 5, limit = 10,
} = {}) {
  if (!(activity?.distance > 0) || !Array.isArray(all)) return null;
  const tol = distanceTolPct / 100;
  const lo = activity.distance * (1 - tol);
  const hi = activity.distance * (1 + tol);
  const hr = activity.average_heartrate;

  const effOf = (a) => {
    const t = movingTime(a);
    return t > 0 ? efficiencyMPerBeat(a.distance / t, a.average_heartrate) : null;
  };

  const matched = all
    .filter((a) => a.id !== activity.id && isRunning(a) && !isRace(a))
    .filter((a) => a.distance >= lo && a.distance <= hi)
    // Sin FC en la referencia no hay banda: se compara solo por distancia.
    .filter((a) => !hr || (a.average_heartrate && Math.abs(a.average_heartrate - hr) <= hrTolBpm))
    .map((a) => ({
      id: a.id,
      date: a.start_date,
      name: a.name,
      distance_m: a.distance,
      speed_ms: movingTime(a) > 0 ? a.distance / movingTime(a) : null,
      gap_speed_ms: activityGapSpeed(a) || null,
      avg_hr: a.average_heartrate ?? null,
      elevation_per_km: a.distance > 0 && a.total_elevation_gain != null
        ? a.total_elevation_gain / (a.distance / 1000)
        : null,
      efficiency: effOf(a),
    }))
    .sort((x, y) => new Date(y.date) - new Date(x.date));

  const effs = matched.map((s) => s.efficiency).filter((v) => v != null);
  const speeds = matched.map((s) => s.speed_ms).filter((v) => v != null);
  const medianEf = median(effs);
  const own = effOf(activity);
  const rank = own != null && effs.length ? effs.filter((e) => e > own).length + 1 : null;

  return {
    sessions: matched.slice(0, limit),
    n: matched.length,
    median_ef: medianEf,
    median_speed_ms: median(speeds),
    own_ef: own,
    ef_delta_pct: own != null && medianEf ? (own / medianEf - 1) * 100 : null,
    rank,
    criteria: { distance_tol_pct: distanceTolPct, hr_tol_bpm: hr ? hrTolBpm : null },
  };
}
