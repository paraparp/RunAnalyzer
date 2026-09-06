// ============================================================================
// plan-to-garmin — traduce una sesion del plan de la IA (`structured_workout`
// del schema `plan` de api/_lib/ai.js) a la spec de alto nivel que consume
// `buildRunningWorkout` de garmin-write.js.
//
// Vive en el servidor porque la escritura en Garmin es server-side (las
// credenciales nunca salen hacia el cliente). El plan llega tal cual lo pinta el
// TrainingPlanner; aqui se normaliza: fases -> tipos de step de Garmin, ritmos y
// FC en texto -> objetivos numericos, y los bloques con `reps` -> grupos de
// repeticion con su step de recuperacion.
// ============================================================================

// Garmin admite UN objetivo por step: si el bloque trae ritmo y FC se usa el
// ritmo (lo mas especifico que prescribe el plan) y la FC queda en la
// descripcion, que si es libre.
const PACE_WINDOW_SEC = 5;   // ventana por defecto alrededor de un ritmo unico
const HR_WINDOW_BPM = 5;     // idem para una FC unica
const MAX_NAME = 60;
const MAX_DESC = 512;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Fase del plan (texto libre en espanol) -> stepType de Garmin.
const KIND_RULES = [
  [/calent|warm/, 'warmup'],
  [/vuelta a la calma|enfria|cool/, 'cooldown'],
  [/recuper|recovery/, 'recovery'],
  [/descanso|reposo|\brest\b/, 'rest'],
];

export function phaseKind(phase) {
  const p = norm(phase);
  for (const [re, kind] of KIND_RULES) if (re.test(p)) return kind;
  return 'interval';
}

/** Dia sin sesion que correr (descanso, o sin estructura que enviar). */
export function isRestDay(day) {
  if (!day) return true;
  if (/descanso|reposo|\brest\b|\boff\b/.test(norm(day.type))) return true;
  return !Array.isArray(day.structured_workout) || day.structured_workout.length === 0;
}

const round = (n, d = 2) => parseFloat(Number(n).toFixed(d));

// ── Parseo de objetivos ─────────────────────────────────────────────────────

/**
 * Ritmo del plan ("4:35/km", "4:30-4:40 min/km") → { low, high } en min/km,
 * donde `low` es el ritmo RÁPIDO (número menor). Un ritmo único se abre a una
 * ventana de ±PACE_WINDOW_SEC: Garmin necesita un rango, no un punto.
 */
export function parsePaceRange(raw, windowSec = PACE_WINDOW_SEC) {
  const found = String(raw ?? '').match(/\d{1,2}:\d{2}/g);
  if (!found?.length) return null;
  const toMin = (t) => {
    const [m, s] = t.split(':').map(Number);
    return m + s / 60;
  };
  const vals = found.slice(0, 2).map(toMin).filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  if (vals.length === 1) {
    const w = windowSec / 60;
    return { low: round(vals[0] - w), high: round(vals[0] + w) };
  }
  const [a, b] = vals;
  return { low: round(Math.min(a, b)), high: round(Math.max(a, b)) };
}

/** Rango de FC del plan ("150-160", "155 ppm") → { low, high } en ppm. */
export function parseHrRange(raw, windowBpm = HR_WINDOW_BPM) {
  const found = String(raw ?? '').match(/\d{2,3}/g);
  if (!found?.length) return null;
  const vals = found.slice(0, 2).map(Number).filter((v) => v >= 60 && v <= 240);
  if (!vals.length) return null;
  if (vals.length === 1) return { low: vals[0] - windowBpm, high: vals[0] + windowBpm };
  return { low: Math.min(...vals), high: Math.max(...vals) };
}

/**
 * Recuperación entre repeticiones en texto libre (90 segundos, 2 minutos,
 * 400 m, 1 km) → duración de un step. Sin nada reconocible devuelve null y el
 * grupo se queda solo con el intervalo de trabajo (mejor eso que inventar).
 */
export function parseRecoveryDuration(raw) {
  const s = norm(raw).replace(',', '.');
  if (!s) return null;
  const km = s.match(/(\d+(?:\.\d+)?)\s*km\b/);
  if (km) return { type: 'distance', value: parseFloat(km[1]), unit: 'km' };
  const m = s.match(/(\d+)\s*m(?!in|\w)/);                 // "400 m", pero no "2 min"
  if (m) return { type: 'distance', value: parseInt(m[1], 10), unit: 'm' };
  const mmss = s.match(/(\d+)\s*[\u0027\u2032]\s*(\d{1,2})?/); // 2' / 1'30
  if (mmss) {
    const mins = parseInt(mmss[1], 10);
    const secs = mmss[2] ? parseInt(mmss[2], 10) : 0;
    return secs ? { type: 'time', value: mins * 60 + secs, unit: 's' } : { type: 'time', value: mins, unit: 'min' };
  }
  const sec = s.match(/(\d+)\s*(?:[\u0022\u2033]|s\b|seg|sec)/); // 90" / 90 s
  if (sec) return { type: 'time', value: parseInt(sec[1], 10), unit: 's' };
  const min = s.match(/(\d+(?:\.\d+)?)\s*min\b/);
  if (min) return { type: 'time', value: parseFloat(min[1]), unit: 'min' };
  const bare = s.match(/^(\d+)$/);                          // "90" a secas = segundos
  if (bare) return { type: 'time', value: parseInt(bare[1], 10), unit: 's' };
  return null;
}

// ── Bloques → steps ─────────────────────────────────────────────────────────

/** Duración del bloque: minutos enteros → 'min'; fracciones → segundos. */
function stepDuration(step) {
  const min = Number(step?.duration_min);
  if (!Number.isFinite(min) || min <= 0) return { type: 'lap.button' };
  return Number.isInteger(min)
    ? { type: 'time', value: min, unit: 'min' }
    : { type: 'time', value: Math.round(min * 60), unit: 's' };
}

function stepTarget(step) {
  const pace = parsePaceRange(step?.pace);
  if (pace) return { type: 'pace', ...pace };
  const hr = parseHrRange(step?.hr);
  if (hr) return { type: 'heart.rate', ...hr };
  return { type: 'no.target' };
}

// La FC solo cabe en la descripción cuando el objetivo ya lo ocupa el ritmo.
function stepDescription(step) {
  const parts = [step?.description];
  if (step?.pace && step?.hr) parts.push(`FC ${String(step.hr).trim()}`);
  const text = parts.filter(Boolean).join(' - ').trim();
  return text ? text.slice(0, MAX_DESC) : null;
}

/**
 * Un bloque del plan → un step (o un grupo de repeticiones si trae `reps`).
 * Ojo: en el schema del plan, `duration_min` con `reps` es la duración de UNA
 * repetición, no la del bloque entero.
 */
export function planStepToSpec(step) {
  const work = {
    kind: phaseKind(step?.phase),
    duration: stepDuration(step),
    target: stepTarget(step),
  };
  const desc = stepDescription(step);
  if (desc) work.description = desc;

  const reps = Math.round(Number(step?.reps));
  if (!Number.isFinite(reps) || reps <= 1) return work;

  const inner = [{ ...work, kind: 'interval' }];
  const recovery = parseRecoveryDuration(step?.recovery);
  if (recovery) {
    inner.push({
      kind: 'recovery',
      duration: recovery,
      target: { type: 'no.target' },
      ...(step.recovery ? { description: String(step.recovery).slice(0, MAX_DESC) } : {}),
    });
  }
  return { kind: 'repeat', repeats: reps, steps: inner };
}

/**
 * Un día del plan → spec de `buildRunningWorkout` (+ `date`, para que
 * `createWorkout` lo agende en el calendario de Garmin en el acto).
 */
export function planDayToWorkoutSpec(day, { name, date } = {}) {
  const blocks = Array.isArray(day?.structured_workout) ? day.structured_workout : [];
  if (!blocks.length) {
    throw new Error(`La sesión de ${day?.day ?? 'ese día'} no tiene estructura: no hay pasos que enviar al reloj.`);
  }
  const title = (name || `${day.type ?? 'Sesión'} - ${day.day ?? ''}`).trim().slice(0, MAX_NAME);
  const description = [day?.type, day?.summary].filter(Boolean).join(' - ').slice(0, MAX_DESC) || null;
  return {
    name: title,
    description,
    ...(date ? { date } : {}),
    steps: blocks.map(planStepToSpec),
  };
}
