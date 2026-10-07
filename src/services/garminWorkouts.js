// ============================================================================
// garminWorkouts — cliente de /api/garmin/workouts.
//
// Manda al reloj las sesiones que el Entrenador AI ya tiene en pantalla. El
// servidor es quien habla con Garmin (las credenciales no salen del backend);
// aquí solo se empaqueta el día del plan y se le pone fecha.
// ============================================================================
import { authHeaders } from './ai';
import { nextDateForDay } from '../lib/planSchedule';

/** Un día del plan → payload del endpoint (con la fecha en la que agendarlo). */
function toPayloadDay(day) {
  return {
    day: day?.day ?? null,
    type: day?.type ?? null,
    summary: day?.summary ?? null,
    structured_workout: day?.structured_workout ?? null,
    date: nextDateForDay(day?.day),
    name: [day?.type, day?.day].filter(Boolean).join(' - ') || 'Sesión RunAnalyzer',
  };
}

/**
 * Crea (y agenda) en Garmin las sesiones indicadas. Devuelve `results` en el
 * MISMO orden que `days`: cada una con `ok`, `workout_id`, `scheduled`/`date`,
 * `skipped` (día de descanso) o `error`.
 */
export async function pushPlanDays(days, { signal } = {}) {
  const payload = days.map(toPayloadDay);
  const res = await fetch('/api/garmin/workouts', {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ days: payload }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status} al hablar con Garmin.`);
  return data;
}

/**
 * Calendario de Garmin del mes en curso: entrenos y carreras agendados
 * (`{ count, planned: [{ date, title, is_race, ... }] }`). Lo usa la portada para
 * saber qué toca hoy.
 */
export async function fetchPlannedWorkouts({ signal } = {}) {
  const res = await fetch('/api/garmin/workouts?planned=1', {
    headers: await authHeaders(),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status} al leer el calendario de Garmin.`);
  return data;
}

/**
 * Peso y composición corporal de la báscula Garmin
 * (`{ count, weights: [{ date, weight_kg, body_fat_pct, ... }] }`, ascendente).
 */
export async function fetchWeightHistory({ days = 365, signal } = {}) {
  const res = await fetch(`/api/garmin/metrics?kind=weight&days=${days}`, {
    headers: await authHeaders(),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status} al leer el peso de Garmin.`);
  return data;
}

/**
 * Umbral de lactato que calcula el reloj (`{ latest: { hr, speed_ms, pace, date } }`),
 * o `latest: null` si Garmin no tiene. Con `from` trae también `history`.
 */
export async function fetchGarminLactateThreshold({ from, signal } = {}) {
  const qs = new URLSearchParams({ kind: 'lactate', ...(from ? { from } : {}) });
  const res = await fetch(`/api/garmin/metrics?${qs}`, { headers: await authHeaders(), signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status} al leer el umbral de Garmin.`);
  return data;
}
