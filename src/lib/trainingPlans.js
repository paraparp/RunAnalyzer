import cloudStorage from './cloudStorage';
import { runsByDay, autoDoneCandidates } from './planActuals';
import { toISODate } from './planSchedule';

// ============================================================================
// trainingPlans — planes de entrenamiento con entrenos persistidos POR FECHA.
//
// A diferencia de `targetRaces` (cuyo `plan` es texto libre) o del plan del
// Entrenador IA (`ai_training_plan`, una plantilla semanal que caduca a los 7
// días), aquí cada entreno lleva su fecha exacta YYYY-MM-DD y vive mientras no
// se borre. Puede haber varios planes a la vez (p.ej. uno por carrera objetivo).
// Se guarda como un blob JSON en cloudStorage (clave 'training_plans'), igual
// que el resto de datos de la app: se sincroniza con Supabase por usuario y lo
// puede leer y escribir el MCP.
//
// Cada plan: { id, name, raceId?: string|null, workouts: Workout[] }
//   raceId: id de la carrera objetivo (lib/targetRaces) a la que apunta el plan,
//     opcional — un plan puede ir "suelto" sin carrera asociada.
// Cada entreno: {
//   id, date: 'YYYY-MM-DD', type, summary, status,
//   distance_km?, duration_min?, coach_note?, structured_workout?,
// }
//   status: 'planned' | 'done' | 'skipped'
//   distance_km / duration_min: totales de la sesión (número), opcionales, para
//     poder verlos/filtrarlos de un vistazo sin desplegar structured_workout.
//   coach_note: texto libre que el coach (o el MCP, tras comparar lo planificado
//     con la actividad real) deja sobre cómo fue la sesión. Opcional.
//   status_manual: true si el estado lo fijó una persona o el MCP; el marcado
//     automático (syncPlanStatuses) no lo toca.
//   garmin_workout_id: id del entreno creado en Garmin al enviarlo al reloj; al
//     reenviarlo se borra ese y se crea el nuevo, para no duplicarlo.
//   structured_workout: mismo formato que usa el planificador IA (fases con
//     duration_min/pace/hr/reps/recovery/description), opcional.
// ============================================================================

const KEY = 'training_plans';
export const TRAINING_PLANS_EVENT = 'training_plans_changed';
export const WORKOUT_STATUSES = ['planned', 'done', 'skipped'];

function newId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
}

export function getTrainingPlans() {
  try {
    const raw = cloudStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list) {
  cloudStorage.setItem(KEY, JSON.stringify(list));
  try { window.dispatchEvent(new Event(TRAINING_PLANS_EVENT)); } catch { /* ignore */ }
}

/** Crea (sin id) o renombra (con id) un plan. No toca sus entrenos. */
export function saveTrainingPlan(plan) {
  const list = getTrainingPlans();
  if (plan.id) {
    const idx = list.findIndex((p) => p.id === plan.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...plan, workouts: list[idx].workouts || [] };
    else list.push({ ...plan, workouts: plan.workouts || [] });
  } else {
    list.push({ ...plan, id: newId(), workouts: plan.workouts || [] });
  }
  persist(list);
  return getTrainingPlans();
}

export function deleteTrainingPlan(id) {
  const list = getTrainingPlans().filter((p) => p.id !== id);
  persist(list);
  return list;
}

/** Crea (sin workout.id) o edita (con workout.id) un entreno dentro de un plan. */
export function saveWorkout(planId, workout) {
  const list = getTrainingPlans();
  const plan = list.find((p) => p.id === planId);
  if (!plan) return list;
  if (!Array.isArray(plan.workouts)) plan.workouts = [];
  if (workout.id) {
    const idx = plan.workouts.findIndex((w) => w.id === workout.id);
    if (idx >= 0) plan.workouts[idx] = { ...plan.workouts[idx], ...workout };
    else plan.workouts.push({ ...workout, status: workout.status || 'planned' });
  } else {
    plan.workouts.push({ ...workout, id: newId(), status: workout.status || 'planned' });
  }
  plan.workouts.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  persist(list);
  return getTrainingPlans();
}

export function deleteWorkout(planId, workoutId) {
  const list = getTrainingPlans();
  const plan = list.find((p) => p.id === planId);
  if (plan) plan.workouts = (plan.workouts || []).filter((w) => w.id !== workoutId);
  persist(list);
  return list;
}

const shiftISO = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + days));
};

/**
 * Copia los entrenos de la semana que empieza en `weekStart` (lunes) a la
 * siguiente, como pendientes: sin estado, nota del coach ni envío a Garmin.
 * Devuelve cuántos copió.
 */
export function duplicateWeek(planId, weekStart) {
  const list = getTrainingPlans();
  const plan = list.find((p) => p.id === planId);
  if (!plan) return 0;
  const weekEnd = shiftISO(weekStart, 6);
  const copies = (plan.workouts || [])
    .filter((w) => w.date >= weekStart && w.date <= weekEnd)
    .map((w) => {
      const copy = { ...w, id: newId(), date: shiftISO(w.date, 7), status: 'planned' };
      for (const k of ['status_manual', 'coach_note', 'garmin_workout_id', 'garmin_date']) delete copy[k];
      return copy;
    });
  if (!copies.length) return 0;
  plan.workouts = [...plan.workouts, ...copies]
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  persist(list);
  return copies.length;
}

/**
 * Marca como hechos los entrenos que ya tienen carrera ese día (planActuals).
 * Una sola escritura y solo si hay algo que cambiar: se llama en cada cambio de
 * actividades (tras sincronizar).
 */
export function syncPlanStatuses(activities, todayISO = toISODate(new Date())) {
  const list = getTrainingPlans();
  const pending = autoDoneCandidates(list, runsByDay(activities), todayISO);
  if (!pending.length) return 0;
  for (const { planId, workoutId } of pending) {
    const w = list.find((p) => p.id === planId)?.workouts?.find((x) => x.id === workoutId);
    if (w) w.status = 'done';
  }
  persist(list);
  return pending.length;
}
