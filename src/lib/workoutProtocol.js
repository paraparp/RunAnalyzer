// ============================================================================
// workoutProtocol — cómo se registra un entreno "técnico" en un plan.
//
// Lo comparten la app (que lo pinta como ficha: categoría, título, perfil por
// bloques, línea de tiempo con ritmo y FC, regla clave) y el MCP (que revisa con
// `lintWorkout` lo que escribe un modelo y le devuelve avisos concretos). El
// formato sale de los planes que mejor se han leído: cada sesión dice QUÉ se
// corre, A QUÉ ritmo, CON QUÉ pulso y QUÉ regla decide si se corrige.
//
// Sesión: { category, type (título técnico), summary (subtítulo), key_rule,
//           distance_km, duration_min, structured_workout: Step[] }
// Step:   { phase, kind, duration_min | distance_km, reps?, recovery?, pace?,
//           hr?, intensity (1-5), description?, note? }
// ============================================================================

export const WORKOUT_CATEGORIES = ['easy', 'quality', 'long', 'test', 'race', 'rest'];
export const STEP_KINDS = ['warmup', 'work', 'recovery', 'cooldown', 'steady', 'drills', 'fuel', 'note'];

// Bloques que no son tiempo de carrera (geles, "después: hidratos"): no cuentan en
// la duración ni en el perfil, y no se mandan al reloj.
export const NON_RUNNING_KINDS = new Set(['fuel', 'note']);

const REST_TYPE = /descanso|reposo|\brest\b|\boff\b/i;
const HR_RANGE = /^\s*(<|≤|>|≥|↑|↓|~)?\s*\d{2,3}(\s*[-–]\s*\d{2,3})?\s*$/;
const PACE = /\d{1,2}:\d{2}/;

/**
 * Categoría de una sesión. Si no la trae (datos anteriores al protocolo) se
 * deduce del tipo, para que los planes viejos se pinten igual de bien.
 */
export function workoutCategory(w) {
  if (WORKOUT_CATEGORIES.includes(w?.category)) return w.category;
  const t = String(w?.type || '');
  if (REST_TYPE.test(t) && !w?.structured_workout?.length) return 'rest';
  // Solo si el título lo dice de forma explícita: "ritmo maratón" es calidad, no carrera.
  if (/^\s*(carrera|race)\b|competici[oó]n/i.test(t)) return 'race';
  if (/test|prueba|reentrada/i.test(t)) return 'test';
  if (/tirada|larg|fondo|long/i.test(t)) return 'long';
  if (/series|interval|tempo|umbral|threshold|fartlek|cuestas|ritmo|bloque|×|x\s*\d/i.test(t)) return 'quality';
  return 'easy';
}

/** Tipo de un bloque; sin `kind`, se deduce del nombre de la fase. */
export function stepKind(step) {
  if (STEP_KINDS.includes(step?.kind)) return step.kind;
  const p = String(step?.phase || '').toLowerCase();
  if (/calent|warm|salida/.test(p)) return 'warmup';
  if (/calma|frenada|enfri|cool/.test(p)) return 'cooldown';
  if (/recuper|pausa|recovery/.test(p)) return 'recovery';
  if (/gel|avituall|fuel|hidrat/.test(p)) return 'fuel';
  if (/movilidad|progresi|t[eé]cnica|drill|stride/.test(p)) return 'drills';
  if ((Number(step?.intensity) || 0) >= 3 || Number(step?.reps) > 1) return 'work';
  return 'steady';
}

/** "75″ de trote", "1,5′", "2 min", "90s" → minutos, o null. */
export function parseRecoveryMin(text) {
  const m = String(text ?? '').match(/(\d+(?:[.,]\d+)?)\s*(″|"|s\b|seg|′|'|min)/i);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return /″|"|s|seg/i.test(m[2]) ? n / 60 : n;
}

/**
 * Bloques listos para pintar: las repeticiones se despliegan (Serie 1, pausa,
 * Serie 2…) y cada fila lleva sus minutos. Devuelve { rows, totalMin, workMin }.
 */
export function expandSteps(steps) {
  const rows = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    const kind = stepKind(step);
    const reps = Math.max(1, Math.round(Number(step?.reps) || 1));
    const min = Number(step?.duration_min) || 0;
    const recMin = reps > 1 ? parseRecoveryMin(step?.recovery) : null;
    if (reps === 1) {
      rows.push({ ...step, kind, min: NON_RUNNING_KINDS.has(kind) ? 0 : min });
      continue;
    }
    for (let i = 0; i < reps; i++) {
      rows.push({ ...step, kind: 'work', label: `${step.phase || 'Serie'} ${i + 1}`, min, rep: i + 1 });
      if (i < reps - 1 && step.recovery) {
        rows.push({ phase: '', kind: 'recovery', description: step.recovery, min: recMin ?? 0, intensity: 1 });
      }
    }
  }
  const totalMin = rows.reduce((s, r) => s + (r.min || 0), 0);
  const workMin = rows.filter((r) => r.kind === 'work').reduce((s, r) => s + (r.min || 0), 0);
  return { rows, totalMin, workMin };
}

/**
 * Revisión del protocolo: avisos (no errores) de lo que le falta a una sesión
 * para leerse como ficha técnica. El MCP los devuelve al escribir, para que el
 * modelo corrija en la siguiente llamada.
 */
export function lintWorkout(w) {
  const out = [];
  const category = w?.category;
  if (!category) out.push('Falta `category` (easy | quality | long | test | race | rest).');
  if (category === 'rest') return out;
  const steps = Array.isArray(w?.structured_workout) ? w.structured_workout : [];
  const needsSteps = ['quality', 'long', 'race', 'test'].includes(category);
  if (needsSteps && !steps.length) {
    out.push(`Una sesión ${category} necesita \`structured_workout\` con sus bloques (sin ellos no se puede pintar ni mandar al reloj).`);
  }
  if (!Number.isFinite(w?.distance_km) && !Number.isFinite(w?.duration_min)) {
    out.push('Indica `distance_km` o `duration_min` totales de la sesión.');
  }
  if (category === 'quality' && !/\d/.test(String(w?.type || ''))) {
    out.push('En una sesión de calidad, `type` debe ser el título técnico con la dosis: p.ej. "4 × 6′ a 4:24".');
  }
  // La regla decide ANTES de la sesión: a una ya hecha o saltada no se le exige.
  const settled = w?.status === 'done' || w?.status === 'skipped';
  if (['quality', 'race'].includes(category) && !w?.key_rule && !settled) {
    out.push('Añade `key_rule`: la regla que decide si se corrige (p.ej. "Techo 177: si acabas una serie por encima, +4 s/km la próxima").');
  }
  steps.forEach((s, i) => {
    const kind = stepKind(s);
    const where = `Bloque ${i + 1}${s?.phase ? ` (${s.phase})` : ''}`;
    if (!s?.phase) out.push(`${where}: falta \`phase\` (nombre del bloque).`);
    if (s?.kind && !STEP_KINDS.includes(s.kind)) out.push(`${where}: \`kind\` debe ser uno de ${STEP_KINDS.join(', ')}.`);
    if (NON_RUNNING_KINDS.has(kind)) return;
    if (!(Number(s?.duration_min) > 0) && !(Number(s?.distance_km) > 0)) out.push(`${where}: falta \`duration_min\` o \`distance_km\`.`);
    if (kind === 'work' && !s?.pace && !s?.hr) out.push(`${where}: un bloque de trabajo necesita \`pace\` y/o \`hr\`.`);
    if (s?.hr && !HR_RANGE.test(String(s.hr))) out.push(`${where}: \`hr\` debe ser un rango "170–177" o un límite "<152" (sin "ppm").`);
    if (s?.pace && !PACE.test(String(s.pace))) out.push(`${where}: \`pace\` debe ir en min/km, p.ej. "4:24" o "5:40–5:55".`);
    if (Number(s?.reps) > 1 && !s?.recovery) out.push(`${where}: con \`reps\` indica la pausa en \`recovery\` (p.ej. "75″ de trote").`);
  });
  if (category === 'quality' && steps.length) {
    const kinds = steps.map(stepKind);
    if (!kinds.includes('warmup')) out.push('La sesión de calidad no tiene calentamiento (`kind: "warmup"`).');
    if (!kinds.includes('cooldown')) out.push('La sesión de calidad no tiene vuelta a la calma (`kind: "cooldown"`).');
  }
  return out;
}
