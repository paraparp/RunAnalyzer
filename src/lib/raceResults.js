import { DISTANCES } from './targetRaces';

// ============================================================================
// raceResults — cierra el ciclo de una carrera objetivo: cuando llega el día,
// busca en el histórico la actividad que corresponde y calcula el resultado real
// frente al objetivo que se había marcado.
//
// El emparejamiento es por FECHA, no por nombre: el nombre de la actividad en
// Strava casi nunca coincide con el del evento ("Vigbay 21k" vs "Afternoon Run")
// y en cambio el día es inequívoco. Si ese día hay varias carreras se elige la
// que más se acerca a la distancia de la prueba.
//
// El tiempo usado es `moving_time`, el mismo con el que la app calcula ritmos y
// detecta carreras, para que ningún número se contradiga entre pantallas.
// ============================================================================

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const isRunning = (a) => RUNNING_TYPES.includes(a.type) || RUNNING_TYPES.includes(a.sport_type);

/** Fecha local de la actividad en YYYY-MM-DD. */
function activityDay(a) {
  const raw = a.start_date_local || a.start_date;
  if (!raw) return null;
  return String(raw).slice(0, 10);
}

/**
 * La actividad que corresponde a una carrera objetivo, o null. Solo mira el día
 * de la prueba, y descarta lo que claramente no es la carrera: un rodaje de 6 km
 * el día de una media no cuenta (se exige al menos el 80% de la distancia).
 */
export function findRaceActivity(race, activities = []) {
  if (!race?.date) return null;
  const target = DISTANCES[race.distance] ? DISTANCES[race.distance] * 1000 : null;
  const sameDay = activities.filter((a) => isRunning(a) && activityDay(a) === race.date && a.distance > 0);
  if (!sameDay.length) return null;

  const candidates = target ? sameDay.filter((a) => a.distance >= target * 0.8) : sameDay;
  const pool = candidates.length ? candidates : sameDay;

  if (!target) return pool.reduce((best, a) => (a.distance > best.distance ? a : best), pool[0]);
  return pool.reduce((best, a) => (
    Math.abs(a.distance - target) < Math.abs(best.distance - target) ? a : best
  ), pool[0]);
}

/**
 * Resultado real de una carrera a partir de su actividad. `delta_min` es la
 * diferencia contra el tiempo objetivo: negativo = se cumplió (se llegó antes).
 */
export function buildRaceResult(race, activity) {
  if (!activity) return null;
  const timeMin = (activity.moving_time || 0) / 60;
  if (!timeMin) return null;

  const distanceM = Math.round(activity.distance);
  const officialM = DISTANCES[race.distance] ? Math.round(DISTANCES[race.distance] * 1000) : null;
  const paceMin = distanceM > 0 ? timeMin / (distanceM / 1000) : null;
  const goal = race.goalTimeMin ?? null;

  return {
    activity_id: activity.id,
    activity_name: activity.name || null,
    date: activityDay(activity),
    time_min: timeMin,
    pace_min_km: paceMin,
    distance_m: distanceM,
    // Si lo corrido no coincide con la distancia oficial (GPS, atajos, carrera
    // larga), el tiempo NO es comparable sin más: se avisa en vez de reescalarlo.
    distance_delta_m: officialM != null ? distanceM - officialM : null,
    avg_hr: activity.average_heartrate || null,
    elevation_gain: activity.total_elevation_gain ?? null,
    goal_time_min: goal,
    delta_min: goal != null ? timeMin - goal : null,
    achieved: goal != null ? timeMin <= goal : null,
  };
}

/** Atajo: resultado de una carrera contra una lista de actividades. */
export function raceResult(race, activities) {
  return buildRaceResult(race, findRaceActivity(race, activities));
}
