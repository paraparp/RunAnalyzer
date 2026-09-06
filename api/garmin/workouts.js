// ============================================================================
// /api/garmin/workouts — programar en el reloj las sesiones del plan de la IA.
//
// Hasta ahora la escritura en Garmin (api/_lib/garmin-write.js) solo la usaba el
// servidor MCP: el plan del TrainingPlanner se pintaba en pantalla y ahí moría.
// Este endpoint expone la misma capa a la propia app, con la sesión de Supabase
// como identidad: las credenciales de Garmin se leen server-side (`garmin_creds`
// en user_storage) y nunca salen hacia el cliente.
//
//   GET    → entrenos ya guardados en Garmin (para comprobar qué hay).
//   POST   → { days: [...] } crea y agenda una o varias sesiones del plan.
//   DELETE → ?workout_id=… borra uno (deshacer un envío).
// ============================================================================
import { ensureAuth } from '../_lib/auth.js';
import { createWorkout, deleteWorkout, listWorkouts } from '../_lib/garmin-write.js';
import { planDayToWorkoutSpec, isRestDay } from '../_lib/plan-to-garmin.js';

export const config = { maxDuration: 60 };

// Una semana de plan. El tope evita que un cliente encadene decenas de escrituras
// contra Garmin en una sola llamada (rate-limit 427 casi seguro).
const MAX_DAYS = 7;

const NO_CREDS = /credenciales de Garmin/i;

export default async function handler(req, res) {
  const user = await ensureAuth(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const limit = Number(req.query?.limit) || 20;
      return res.json(await listWorkouts(user.id, { limit }));
    }

    if (req.method === 'DELETE') {
      const workoutId = req.query?.workout_id ?? req.body?.workout_id;
      if (!workoutId) return res.status(400).json({ error: 'Falta workout_id.' });
      return res.json(await deleteWorkout(user.id, workoutId));
    }

    if (req.method !== 'POST') return res.status(405).end();

    const days = Array.isArray(req.body?.days) ? req.body.days : null;
    if (!days?.length) {
      return res.status(400).json({ error: 'Falta "days": las sesiones del plan que programar.' });
    }
    if (days.length > MAX_DAYS) {
      return res.status(400).json({ error: `Máximo ${MAX_DAYS} sesiones por envío.` });
    }

    // Secuencial a propósito: Garmin limita las peticiones (427) y un fallo en una
    // sesión no debe tumbar las demás — cada día informa de su propio resultado.
    const results = [];
    for (const day of days) {
      const label = day?.day ?? null;
      if (isRestDay(day)) {
        results.push({ day: label, ok: false, skipped: true });
        continue;
      }
      try {
        const spec = planDayToWorkoutSpec(day, { name: day.name, date: day.date });
        const out = await createWorkout(user.id, spec);
        results.push({ day: label, ok: true, ...out });
      } catch (e) {
        // Sin credenciales no falla solo este día: falla todo el envío.
        if (NO_CREDS.test(e.message)) throw e;
        results.push({ day: label, ok: false, error: e.message });
      }
    }

    return res.json({ results, created: results.filter((r) => r.ok).length });
  } catch (e) {
    // Falta de credenciales es culpa del estado de la cuenta (400, accionable);
    // el resto son fallos hablando con Garmin (502).
    return res.status(NO_CREDS.test(e.message) ? 400 : 502).json({ error: e.message });
  }
}
