// ============================================================================
// garmin-write — escritura en Garmin Connect para el MCP (Fase 4 del roadmap).
//
// El MCP es server-side: puede leer `garmin_creds` de user_storage (nunca sale
// hacia el cliente/LLM, igual que hoy) y usarlo para crear/editar/borrar entrenos
// estructurados en el calendario de Garmin. Construye el JSON del workout-service
// a partir de una spec de alto nivel, para no obligar al modelo a conocer el
// esquema interno de Garmin.
// ============================================================================
import { getGarminClientFor } from './garmin-session.js';

// IDs de enum de Garmin (workout-service). Los confirmados por el template de la
// librería: sportType running=1, stepType interval=3, endCondition distance=3,
// targetType no.target=1. El resto son los identificadores estándar y estables.
const STEP_TYPE = { warmup: 1, cooldown: 2, interval: 3, recovery: 4, rest: 5, repeat: 6, other: 7 };
const END_COND = { 'lap.button': 1, time: 2, distance: 3, iterations: 7 };
const TARGET = {
  'no.target': 1, 'power.zone': 2, 'cadence.zone': 3,
  'heart.rate.zone': 4, 'speed.zone': 5, 'pace.zone': 6,
};
// Tipos de alto nivel del schema → clave real de Garmin. `heart.rate` ya lleva un
// punto, así que no vale con sufijar ".zone" (daría "heart.rate", que no existe en
// TARGET y caía a no.target, dejando los objetivos de FC sin efecto).
const TARGET_KEY = {
  pace: 'pace.zone', power: 'power.zone', cadence: 'cadence.zone',
  'heart.rate': 'heart.rate.zone', hr: 'heart.rate.zone',
};

// Objetivo de un step (ritmo, FC, potencia, cadencia o ninguno).
function buildTarget(target) {
  if (!target || !target.type || target.type === 'no.target') {
    return {
      targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
      targetValueOne: null, targetValueTwo: null, zoneNumber: null,
    };
  }
  const key = target.type.endsWith('.zone')
    ? target.type
    : (TARGET_KEY[target.type] || `${target.type}.zone`);
  const id = TARGET[key] || 1;
  let one = target.low ?? null;
  let two = target.high ?? null;
  if (key === 'pace.zone') {                 // min/km → m/s (Garmin usa velocidad)
    one = target.low ? 1000 / (target.low * 60) : null;
    two = target.high ? 1000 / (target.high * 60) : null;
  }
  if (one != null && two != null && one > two) [one, two] = [two, one]; // Garmin: one ≤ two
  return {
    targetType: { workoutTargetTypeId: id, workoutTargetTypeKey: key },
    targetValueOne: one, targetValueTwo: two, zoneNumber: target.zone ?? null,
  };
}

// Step ejecutable (warmup / interval / recovery / rest / cooldown). `ctx.next` es un
// contador de stepId local a cada build (antes era un global de módulo: dos builds
// concurrentes en el mismo proceso caliente se pisaban los ids).
function execStep(ctx, order, step) {
  const durType = step.duration?.type || 'lap.button';
  let endValue = null;
  let unit = null;
  if (durType === 'distance') {
    const u = step.duration.unit || 'm';
    endValue = u === 'km' ? step.duration.value * 1000 : step.duration.value;
    // Garmin guarda el valor en metros pero muestra en km (como la plantilla de la
    // librería): así un paso de 5000 m se ve "5.00 km" en el reloj, no "5000 m".
    unit = { unitKey: 'kilometer' };
  } else if (durType === 'time') {
    const u = step.duration.unit || 's';
    endValue = u === 'min' ? step.duration.value * 60 : step.duration.value;
  }
  return {
    type: 'ExecutableStepDTO',
    stepId: ctx.next++,
    stepOrder: order,
    childStepId: null,
    description: step.description ?? null,
    stepType: { stepTypeId: STEP_TYPE[step.kind] || STEP_TYPE.interval, stepTypeKey: step.kind || 'interval' },
    endCondition: { conditionTypeId: END_COND[durType] || 1, conditionTypeKey: durType },
    endConditionValue: endValue,
    preferredEndConditionUnit: unit,
    endConditionCompare: null,
    ...buildTarget(step.target),
  };
}

// Grupo de repeticiones (p.ej. 4× (interval + recovery)).
function repeatStep(ctx, order, step) {
  let childOrder = 1;
  const children = (step.steps || []).map((s) => execStep(ctx, childOrder++, s));
  return {
    type: 'RepeatGroupDTO',
    stepId: ctx.next++,
    stepOrder: order,
    childStepId: 1,
    stepType: { stepTypeId: STEP_TYPE.repeat, stepTypeKey: 'repeat' },
    numberOfIterations: step.repeats || 1,
    smartRepeat: false,
    endCondition: { conditionTypeId: END_COND.iterations, conditionTypeKey: 'iterations' },
    endConditionValue: step.repeats || 1,
    workoutSteps: children,
  };
}

/**
 * Construye el JSON del workout-service de Garmin desde una spec de alto nivel:
 *   { name, description?, steps: [ {kind, duration:{type,value,unit}, target?}
 *                                | {kind:'repeat', repeats, steps:[...]} ] }
 * duration.type: 'distance'|'time'|'lap.button'; target.type: 'pace'|'heart.rate'|'power'|'cadence'.
 */
export function buildRunningWorkout(spec) {
  if (!spec?.name || !Array.isArray(spec.steps) || !spec.steps.length) {
    throw new Error('El workout necesita "name" y al menos un step en "steps".');
  }
  const ctx = { next: 1 };
  let order = 1;
  const steps = spec.steps.map((s) => (s.kind === 'repeat' ? repeatStep(ctx, order++, s) : execStep(ctx, order++, s)));
  const sport = { sportTypeId: 1, sportTypeKey: 'running' };
  return {
    sportType: sport,
    workoutName: spec.name,
    description: spec.description ?? null,
    workoutSegments: [{ segmentOrder: 1, sportType: sport, workoutSteps: steps }],
  };
}

// ── Operaciones ──────────────────────────────────────────────────────────────
const SCHEDULE_URL = (id) => `https://connectapi.garmin.com/workout-service/schedule/${id}`;
const isISODate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

export async function createWorkout(userId, spec) {
  const json = buildRunningWorkout(spec);
  const client = await getGarminClientFor(userId);
  const res = await client.addWorkout(json);
  const workout_id = res?.workoutId ?? null;
  const out = { created: true, workout_id, name: json.workoutName };
  // Si la spec trae `date`, lo agendamos en el calendario en el acto (antes solo se
  // creaba, sin programar). Un fallo al agendar no invalida la creación.
  if (spec.date && workout_id) {
    if (!isISODate(spec.date)) { out.scheduled = false; out.schedule_error = 'date debe ser YYYY-MM-DD'; return out; }
    try {
      await client.client.post(SCHEDULE_URL(workout_id), { date: spec.date });
      out.scheduled = true; out.date = spec.date;
    } catch (e) { out.scheduled = false; out.schedule_error = e.message; }
  }
  return out;
}

/** Agenda un entreno ya existente en una fecha del calendario de Garmin. */
export async function scheduleWorkout(userId, workoutId, date) {
  if (!workoutId) throw new Error('Falta workout_id.');
  if (!isISODate(date)) throw new Error('Falta date en formato YYYY-MM-DD.');
  const client = await getGarminClientFor(userId);
  const res = await client.client.post(SCHEDULE_URL(workoutId), { date });
  return { scheduled: true, workout_id: workoutId, date, schedule_id: res?.workoutScheduleId ?? null };
}

export async function updateWorkout(userId, workoutId, spec) {
  if (!workoutId) throw new Error('Falta workout_id.');
  const json = buildRunningWorkout(spec);
  json.workoutId = workoutId;
  const client = await getGarminClientFor(userId);
  await client.client.put(`https://connectapi.garmin.com/workout-service/workout/${workoutId}`, json);
  return { updated: true, workout_id: workoutId, name: json.workoutName };
}

// ── Lectura: decodifica un workout de Garmin a la spec de alto nivel ─────────
// Inverso de buildRunningWorkout: para poder LEER los pasos de un entreno (antes solo
// se veía nombre/fecha) y editarlo sin re-mandar `steps` a ciegas.
const paceMinKmFromMs = (v) => (v ? round(16.6667 / v, 2) : null);
const round = (n, d = 2) => (n == null ? null : parseFloat(Number(n).toFixed(d)));

function decodeDuration(step) {
  const key = step.endCondition?.conditionTypeKey;
  const v = step.endConditionValue;
  if (key === 'distance') {
    return v != null && v % 1000 === 0
      ? { type: 'distance', value: v / 1000, unit: 'km' }
      : { type: 'distance', value: v ?? null, unit: 'm' };
  }
  if (key === 'time') {
    return v != null && v % 60 === 0
      ? { type: 'time', value: v / 60, unit: 'min' }
      : { type: 'time', value: v ?? null, unit: 's' };
  }
  return { type: 'lap.button' };
}

function decodeTarget(step) {
  const key = step.targetType?.workoutTargetTypeKey;
  if (!key || key === 'no.target') return { type: 'no.target' };
  let one = step.targetValueOne ?? null;
  let two = step.targetValueTwo ?? null;
  if (key === 'pace.zone') {                 // m/s → min/km (más lento = número mayor)
    const lo = paceMinKmFromMs(two);         // two = m/s alto = ritmo rápido → min/km bajo
    const hi = paceMinKmFromMs(one);
    return { type: 'pace', low: lo, high: hi, zone: step.zoneNumber ?? null };
  }
  const type = { 'heart.rate.zone': 'heart.rate', 'power.zone': 'power', 'cadence.zone': 'cadence' }[key] || key;
  return { type, low: one, high: two, zone: step.zoneNumber ?? null };
}

function decodeStep(step) {
  if (step.type === 'RepeatGroupDTO') {
    return {
      kind: 'repeat',
      repeats: step.numberOfIterations ?? null,
      steps: (step.workoutSteps || []).map(decodeStep),
    };
  }
  return {
    kind: step.stepType?.stepTypeKey ?? 'interval',
    duration: decodeDuration(step),
    target: decodeTarget(step),
    ...(step.description ? { description: step.description } : {}),
  };
}

/** Lee un entreno de Garmin y devuelve su spec de alto nivel (name, description, steps). */
export async function getWorkout(userId, workoutId) {
  if (!workoutId) throw new Error('Falta workout_id.');
  const client = await getGarminClientFor(userId);
  const w = await client.getWorkoutDetail({ workoutId });
  if (!w || !w.workoutId) throw new Error(`Entreno ${workoutId} no encontrado en Garmin.`);
  const steps = (w.workoutSegments || []).flatMap((seg) => (seg.workoutSteps || []).map(decodeStep));
  return {
    workout_id: w.workoutId,
    name: w.workoutName ?? null,
    description: w.description ?? null,
    sport: w.sportType?.sportTypeKey ?? null,
    steps,
  };
}

export async function deleteWorkout(userId, workoutId) {
  if (!workoutId) throw new Error('Falta workout_id.');
  const client = await getGarminClientFor(userId);
  await client.deleteWorkout({ workoutId });
  return { deleted: true, workout_id: workoutId };
}

// Garmin devuelve 427 (o lo empaqueta como { error: { 'status-code': '427' } })
// cuando limita las peticiones. Lo traducimos a un mensaje accionable.
function asRateLimit(codeOrErr) {
  const s = String(codeOrErr ?? '');
  if (s.includes('427') || /rate.?limit|too many/i.test(s)) {
    return new Error('Garmin está limitando las peticiones (rate-limit 427). Espera ~1 min y reintenta.');
  }
  return null;
}

export async function listWorkouts(userId, { limit = 20 } = {}) {
  const client = await getGarminClientFor(userId);
  let rows;
  try {
    rows = await client.getWorkouts(0, Math.min(Math.max(limit, 1), 100));
  } catch (e) {
    throw asRateLimit(e?.message) || new Error(`No se pudieron listar los entrenos de Garmin: ${e.message}`);
  }
  // Algunos errores no se lanzan: llegan como cuerpo { error: { 'status-code': ... } }.
  if (rows && !Array.isArray(rows)) {
    const code = rows.error?.['status-code'] ?? rows['status-code'] ?? rows.error ?? 'desconocido';
    throw asRateLimit(code) || new Error(`Garmin devolvió un error al listar entrenos (${code}).`);
  }
  return {
    count: Array.isArray(rows) ? rows.length : 0,
    workouts: (Array.isArray(rows) ? rows : []).map((w) => ({
      workout_id: w.workoutId,
      name: w.workoutName,
      sport: w.sportType?.sportTypeKey ?? null,
      updated: w.updateDate ?? null,
    })),
  };
}
