// ============================================================================
// planActuals — lo planificado (lib/trainingPlans) frente a lo corrido de verdad.
//
// Lo comparten la app y el MCP (api/_lib/mcp-store), para que los dos vean el
// mismo "real" de cada entreno y el mismo volumen por semana.
//
// Emparejamiento por FECHA: un entreno se corresponde con las carreras de ese día
// (fecha local de la actividad). Si hay varias (calentamiento suelto + sesión, o
// doble sesión) se SUMAN: el entreno del plan es la sesión del día entera.
// ============================================================================
import { activityDayKey } from './trainingLoad.js';
import { weekStartKey } from './isoWeek.js';
import { workoutCategory } from './workoutProtocol.js';

const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const isRun = (a) => RUN_TYPES.includes(a?.type) || RUN_TYPES.includes(a?.sport_type);

// Una subida del volumen planificado por encima de esto frente a la semana
// anterior se avisa: la regla clásica del 10% semanal.
export const RAMP_WARN_PCT = 10;

const round1 = (x) => Math.round(x * 10) / 10;

/** Entreno de descanso: `category: 'rest'`, o declarado así por su tipo y sin estructura. */
export function isRestWorkout(w) {
  return !w || workoutCategory(w) === 'rest';
}

/** Índice día (YYYY-MM-DD) → carreras de ese día. */
export function runsByDay(activities) {
  const map = new Map();
  for (const a of Array.isArray(activities) ? activities : []) {
    if (!isRun(a)) continue;
    const key = activityDayKey(a);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  }
  return map;
}

/** Suma de un grupo de carreras: distancia, tiempo, ritmo y FC media ponderada por tiempo. */
function summarize(runs) {
  const distM = runs.reduce((s, a) => s + (Number(a.distance) || 0), 0);
  const movS = runs.reduce((s, a) => s + (Number(a.moving_time) || 0), 0);
  const withHr = runs.filter((a) => a.average_heartrate && a.moving_time);
  const hrS = withHr.reduce((s, a) => s + a.moving_time, 0);
  const main = runs.reduce((best, a) => ((Number(a.distance) || 0) > (Number(best?.distance) || 0) ? a : best), null);
  return {
    activity_id: main?.id ?? null,
    activity_ids: runs.map((a) => a.id),
    name: main?.name ?? null,
    distance_km: round1(distM / 1000),
    moving_time_min: Math.round(movS / 60),
    pace_min_km: distM > 0 && movS > 0 ? (movS / 60) / (distM / 1000) : null,
    avg_hr: hrS > 0 ? Math.round(withHr.reduce((s, a) => s + a.average_heartrate * a.moving_time, 0) / hrS) : null,
  };
}

/** Lo corrido el día del entreno, o null si ese día no hay carreras. */
export function workoutActual(workout, byDay) {
  const runs = workout?.date ? byDay.get(workout.date) : null;
  return runs?.length ? summarize(runs) : null;
}

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/**
 * Volumen por semana ISO (lunes) de un plan, de la semana del primer entreno a la
 * del último, sin saltarse las semanas vacías (una semana de descarga sin sesiones
 * también es parte del bloque). El real es TODO lo corrido esa semana, no solo lo
 * emparejado con entrenos: es el volumen que se ha absorbido de verdad. Solo hay
 * real para semanas que ya han empezado.
 */
export function weeklyVolume(plan, byDay, todayISO) {
  const workouts = (plan?.workouts || []).filter((w) => w?.date);
  if (!workouts.length) return [];
  const dates = workouts.map((w) => w.date).sort();
  const first = weekStartKey(dates[0]);
  const last = weekStartKey(dates[dates.length - 1]);
  const weeks = [];
  for (let ws = first; ws <= last; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const inWeek = workouts.filter((w) => w.date >= ws && w.date <= we);
    const sessions = inWeek.filter((w) => !isRestWorkout(w));
    const plannedKm = round1(sessions.reduce((s, w) => s + (Number(w.distance_km) || 0), 0));
    let actualKm = null;
    if (ws <= todayISO) {
      let m = 0;
      for (let i = 0; i < 7; i++) for (const a of byDay.get(addDays(ws, i)) || []) m += Number(a.distance) || 0;
      actualKm = round1(m / 1000);
    }
    const prev = weeks[weeks.length - 1];
    const rampPct = prev && prev.planned_km > 0 && plannedKm > 0
      ? Math.round(((plannedKm - prev.planned_km) / prev.planned_km) * 100)
      : null;
    weeks.push({
      week_start: ws,
      planned_km: plannedKm,
      actual_km: actualKm,
      sessions: sessions.length,
      done: sessions.filter((w) => w.status === 'done').length,
      ramp_pct: rampPct,
      ramp_warning: rampPct != null && rampPct > RAMP_WARN_PCT,
      is_current: ws <= todayISO && todayISO <= we,
    });
  }
  return weeks;
}

/**
 * Entrenos que ya se han corrido y siguen como `planned`: hay carrera ese día y
 * el día ya llegó. No toca los de descanso, los saltados, ni los que el usuario
 * (o el MCP) han fijado a mano (`status_manual`): desmarcar uno no debe volver a
 * marcarse solo en la siguiente sincronización.
 */
export function autoDoneCandidates(plans, byDay, todayISO) {
  const out = [];
  for (const p of Array.isArray(plans) ? plans : []) {
    for (const w of p?.workouts || []) {
      if (w?.status && w.status !== 'planned') continue;
      if (w?.status_manual || !w?.date || w.date > todayISO || isRestWorkout(w)) continue;
      if (byDay.get(w.date)?.length) out.push({ planId: p.id, workoutId: w.id });
    }
  }
  return out;
}
