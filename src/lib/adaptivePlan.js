// ============================================================================
// adaptivePlan — el plan semanal del Entrenador IA deja de ser estático.
//
// Dos lazos de realimentación sobre el plan guardado (`ai_training_plan`):
//
//   1. HOY. Si la sesión del día es dura (o una tirada larga) y el estado pide
//      descargar (readiness < 50 o TSB en sobrecarga, el `recovery` de la
//      portada), se propone la versión regenerativa — no solo un aviso. La
//      elección del atleta (adaptada / original) se guarda por fecha.
//
//   2. LA SEMANA. Se cruza cada día del plan con las carreras reales y se
//      replanifica lo que falta con tres reglas de entrenador:
//        · Lo fácil perdido NO se recupera: meter volumen extra para "cuadrar"
//          la semana es la receta clásica de lesión.
//        · Una sesión CLAVE perdida (calidad o tirada larga) se mueve al primer
//          día suave o de descanso que quede, siempre que no deje dos días
//          clave seguidos. La tirada larga va primero: es la que más pesa.
//        · Si no cabe, se descarta. Nunca se apilan dos sesiones en un día.
//
// Todo es puro: la UI decide cuándo guardar.
// ============================================================================
import { isRestDay, nextDateForDay, toISODate } from './planSchedule.js';
import { workoutBlocks } from './todaySession.js';
import { activityDayKey } from './trainingLoad.js';

/** cloudStorage: elección del atleta para hoy, `{ [YYYY-MM-DD]: 'adapted'|'original' }`. */
export const ADAPT_CHOICE_KEY = 'ai_plan_today_choice';

const HARD_INTENSITY = 4;
const LONG_MIN = 90;
const LONG_TYPE = /larg|long/i;

const DAY_NAMES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const fromISO = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (iso, n) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
};

/** 'long' | 'hard' | 'easy' | 'rest' de un día del plan. */
export function sessionKind(day) {
  if (isRestDay(day)) return 'rest';
  const { totalMin, maxIntensity } = workoutBlocks(day.structured_workout);
  if (LONG_TYPE.test(day.type || '') || totalMin >= LONG_MIN) return 'long';
  if (maxIntensity >= HARD_INTENSITY) return 'hard';
  return 'easy';
}
const isKey = (kind) => kind === 'long' || kind === 'hard';

/**
 * Día del plan → sesión regenerativa equivalente, con el mismo shape que un día
 * del plan (así la pinta la misma tarjeta y la manda al reloj el mismo envío).
 * `proposal` es la propuesta automática de la portada (`todayWorkout`).
 */
export function recoveryVersion(day, proposal) {
  const st = proposal?.structure ?? {};
  const main = st.mainMin ?? 30;
  return {
    day: day?.day ?? null,
    type: 'Trote regenerativo',
    summary: `Versión de descarga de "${day?.type ?? 'la sesión'}": tu estado pide recuperar. La sesión original se reprograma en la semana si cabe.`,
    daily_stats: {
      dist: proposal?.targetDistance ?? null,
      time: st.totalMin != null ? `${st.totalMin} min` : null,
    },
    structured_workout: [
      { phase: 'Calentamiento', duration_min: st.warmMin ?? 5, intensity: 1, pace: null, hr: proposal?.targetHr ?? null },
      { phase: 'Trote regenerativo', duration_min: main, intensity: 1, pace: proposal?.targetPace ?? null, hr: proposal?.targetHr ?? null },
      { phase: 'Vuelta a la calma', duration_min: st.coolMin ?? 5, intensity: 1, pace: null, hr: null },
    ],
    adapted_from: day?.type ?? null,
  };
}

/**
 * Estado de cada día del plan: `{ date, day, kind, status }` con status
 * 'done' | 'missed' | 'rest' | 'today' | 'upcoming' | 'postponed', ordenados por
 * fecha. Un día cuenta como hecho si hay alguna carrera a pie esa fecha.
 * `postponedToday`: hoy se cambió la sesión por la adaptada.
 */
export function weekReview(saved, activities, todayISO, { postponedToday = false } = {}) {
  const schedule = saved?.plan?.schedule;
  if (!Array.isArray(schedule) || !saved.generated_at) return [];
  const start = fromISO(saved.generated_at);
  const ranOn = new Set(
    (activities || [])
      .filter((a) => /run/i.test(a.sport_type || a.type || ''))
      .map(activityDayKey)
      .filter(Boolean),
  );
  return schedule
    .map((day, index) => {
      const date = nextDateForDay(day.day, start);
      if (!date) return null;
      const kind = sessionKind(day);
      let status;
      if (kind === 'rest') status = 'rest';
      else if (ranOn.has(date) && date <= todayISO) status = 'done';
      else if (date < todayISO) status = 'missed';
      else if (date === todayISO) status = postponedToday && isKey(kind) ? 'postponed' : 'today';
      else status = 'upcoming';
      return { index, date, day, kind, status };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Propuesta de replanificación de lo que queda de semana. Devuelve
 * `{ review, moves, dropped, schedule }`:
 *   - moves: `[{ from: entry, to: entry }]` sesión clave → día que sustituye.
 *   - dropped: `[{ entry, reason }]` lo que no se recupera.
 *   - schedule: el plan nuevo (null si no hay nada que cambiar), listo para guardar.
 * `opts.postponedToday` + `opts.todayReplacement` (día del plan): la sesión clave
 * de hoy se aplaza y en su lugar queda la regenerativa.
 */
export function replanWeek(saved, activities, todayISO, opts = {}) {
  const review = weekReview(saved, activities, todayISO, opts);
  const lost = review.filter((e) => e.status === 'missed' || e.status === 'postponed');
  if (!lost.length) return { review, moves: [], dropped: [], schedule: null };

  // Días que aún pueden recibir una sesión: desde mañana si hoy se aplazó o ya
  // se corrió, desde hoy si no.
  const firstFree = review.some((e) => e.date === todayISO && (e.status === 'postponed' || e.status === 'done'))
    ? addDays(todayISO, 1)
    : todayISO;
  const end = addDays(saved.generated_at, 6);

  // Mapa fecha → tipo efectivo (lo que ya se hizo, lo pendiente y lo movido).
  const kindOn = new Map();
  for (const e of review) {
    if (e.status === 'missed' || e.status === 'postponed') continue;
    kindOn.set(e.date, e.kind);
  }

  const moves = [];
  const dropped = [];
  const order = [...lost].sort((a, b) => {
    const rank = (k) => (k === 'long' ? 0 : k === 'hard' ? 1 : 2);
    return rank(a.kind) - rank(b.kind) || a.date.localeCompare(b.date);
  });

  for (const entry of order) {
    if (!isKey(entry.kind)) {
      dropped.push({ entry, reason: 'easy' });
      continue;
    }
    let target = null;
    for (let d = firstFree; d <= end; d = addDays(d, 1)) {
      const k = kindOn.get(d) ?? 'rest';
      if (isKey(k)) continue;
      if (isKey(kindOn.get(addDays(d, -1))) || isKey(kindOn.get(addDays(d, 1)))) continue;
      target = d;
      break;
    }
    if (!target) {
      dropped.push({ entry, reason: 'no_room' });
      continue;
    }
    kindOn.set(target, entry.kind);
    moves.push({ from: entry, to: review.find((e) => e.date === target) ?? { date: target, day: null, kind: 'rest' } });
  }

  if (!moves.length) return { review, moves, dropped, schedule: null };

  // Plan nuevo: la sesión movida pasa a llamarse con el día de destino y el día
  // de destino original desaparece. Las fechas se resuelven igual que antes
  // (`nextDateForDay` desde generated_at), así que portada y Garmin lo entienden.
  const schedule = saved.plan.schedule.map((d) => ({ ...d }));
  const removed = new Set();
  const extra = [];
  for (const { from, to } of moves) {
    // Lo aplazado hoy deja en su sitio la versión regenerativa (si no, hoy
    // saldría como descanso).
    if (from.status === 'postponed' && opts.todayReplacement) {
      extra.push({ ...opts.todayReplacement, day: from.day.day });
    }
    const targetName = DAY_NAMES_ES[fromISO(to.date).getDay()];
    schedule[from.index] = {
      ...schedule[from.index],
      day: targetName,
      moved_from: from.day.day,
    };
    if (to.index != null) removed.add(to.index);
  }
  return {
    review,
    moves,
    dropped,
    schedule: [...schedule.filter((_, i) => !removed.has(i)), ...extra],
  };
}

/** Plan guardado con la semana replanificada aplicada. */
export function applyReplan(saved, schedule, todayISO) {
  return {
    ...saved,
    plan: { ...saved.plan, schedule },
    replanned_at: todayISO,
  };
}

const readStore = (storage) => {
  try { return JSON.parse(storage.getItem(ADAPT_CHOICE_KEY) || '{}') || {}; } catch { return {}; }
};

/** Elección guardada para hoy ('adapted' | 'original' | null). */
export function readChoice(storage, todayISO) {
  return readStore(storage)[todayISO] ?? null;
}

/** Sesión regenerativa que se ofreció hoy (para que el Planificador la deje en su sitio). */
export function readAdaptedSession(storage, todayISO) {
  const st = readStore(storage);
  return st.date === todayISO ? st.session ?? null : null;
}

/** Guarda la elección de hoy (solo se conserva la del día) y la sesión adaptada. */
export function writeChoice(storage, todayISO, choice, session = null) {
  const prev = readStore(storage);
  const keep = prev.date === todayISO ? prev.session : null;
  storage.setItem(ADAPT_CHOICE_KEY, JSON.stringify({
    [todayISO]: choice, date: todayISO, session: session ?? keep,
  }));
}
