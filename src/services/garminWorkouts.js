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
