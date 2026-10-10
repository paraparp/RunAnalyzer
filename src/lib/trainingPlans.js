import cloudStorage from './cloudStorage';

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
// Cada plan: { id, name, workouts: Workout[] }
// Cada entreno: { id, date: 'YYYY-MM-DD', type, summary, status, structured_workout? }
//   status: 'planned' | 'done' | 'skipped'
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
