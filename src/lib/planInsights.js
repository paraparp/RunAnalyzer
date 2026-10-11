// ============================================================================
// planInsights — lecturas derivadas de un plan (lib/trainingPlans) para la vista
// de planes: carga estimada de cada sesión, avisos de estructura, carreras que no
// estaban en el plan y fases del bloque.
//
// Todo es puro (sin storage ni DOM) para poder probarlo y, si hace falta,
// reutilizarlo desde el MCP.
// ============================================================================
import { workoutCategory, expandSteps, NON_RUNNING_KINDS } from './workoutProtocol.js';
import { workoutActual } from './planActuals.js';

// Fases de un bloque de entrenamiento. Se guardan por semana en el plan:
// `plan.weekPhases = { 'YYYY-MM-DD' (lunes): 'base' | 'build' | ... }`.
export const PLAN_PHASES = ['base', 'build', 'peak', 'taper', 'recovery'];

// Intensidad (IF) típica de cada categoría, para estimar la carga de lo
// planificado en la misma escala TSS que trainingLoad.sessionLoad (100 = 1 h al
// umbral). Es una estimación: la carga real sale de la FC de la actividad.
const CATEGORY_IF = { easy: 0.72, long: 0.76, quality: 0.88, test: 0.95, race: 0.97, rest: 0 };
// Ritmo de respaldo (min/km) cuando solo hay distancia: convierte km en tiempo.
const FALLBACK_PACE = { easy: 5.75, long: 5.6, quality: 5.0, test: 4.6, race: 4.6, rest: 0 };

const HARD = new Set(['quality', 'test', 'race']);

const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dayDiff = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);
const addDays = (iso, n) => {
  const dt = parse(iso);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/**
 * Carga estimada (escala TSS) de un entreno planificado: duración_h · IF² · 100.
 * Usa `duration_min`; si no lo hay, la deriva de `distance_km` con un ritmo
 * típico de la categoría. null si no hay ni duración ni distancia.
 */
export function estimateWorkoutLoad(w) {
  const cat = workoutCategory(w);
  if (cat === 'rest') return 0;
  const dur = Number(w?.duration_min);
  const dist = Number(w?.distance_km);
  const minutes = dur > 0 ? dur : dist > 0 ? dist * (FALLBACK_PACE[cat] ?? FALLBACK_PACE.easy) : null;
  if (minutes == null) return null;
  const intensity = CATEGORY_IF[cat] ?? CATEGORY_IF.easy;
  return Math.round((minutes / 60) * intensity ** 2 * 100);
}

// Bandas de intensidad para el reparto del volumen, de la `intensity` 1-5 de cada
// bloque: 1-2 aeróbico, 3 ritmo maratón, 4 umbral, 5 carrera/VO2.
export const INTENSITY_BANDS = ['aerobic', 'marathon', 'threshold', 'race'];
const bandOf = (intensity) => (intensity >= 5 ? 'race' : intensity >= 4 ? 'threshold' : intensity >= 3 ? 'marathon' : 'aerobic');
// Sin bloques, la sesión entera va a la banda de su categoría.
const CATEGORY_BAND = { easy: 'aerobic', long: 'aerobic', quality: 'threshold', test: 'race', race: 'race' };

const paceOf = (text) => {
  const m = String(text ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
};

/**
 * Reparto de los km de una sesión por banda de intensidad: { aerobic, marathon,
 * threshold, race }. Los bloques se ponderan por TIEMPO (un bloque dado en km se
 * pasa a minutos con su ritmo) y el total se escala a `distance_km` de la sesión,
 * o a lo que sumen los bloques en km si no la trae.
 */
export function intensityMix(w) {
  const mix = { aerobic: 0, marathon: 0, threshold: 0, race: 0 };
  const cat = workoutCategory(w);
  if (cat === 'rest') return mix;
  const steps = Array.isArray(w?.structured_workout) ? w.structured_workout : [];
  const { rows } = expandSteps(steps);
  const timed = rows
    .filter((r) => !NON_RUNNING_KINDS.has(r.kind))
    .map((r) => {
      const pace = paceOf(r.pace) ?? FALLBACK_PACE[cat] ?? FALLBACK_PACE.easy;
      const dist = Number(r.distance_km) || 0;
      const min = r.min || dist * pace;
      const lvl = r.kind === 'recovery' ? 1 : Math.round(Number(r.intensity) || (r.kind === 'work' ? 4 : 2));
      return { band: bandOf(lvl), min, km: dist || min / pace };
    })
    .filter((r) => r.min > 0);

  const total = Number(w?.distance_km) > 0
    ? Number(w.distance_km)
    : timed.reduce((s, r) => s + r.km, 0) || (Number(w?.duration_min) > 0 ? Number(w.duration_min) / (FALLBACK_PACE[cat] ?? FALLBACK_PACE.easy) : 0);
  if (!total) return mix;

  const totalMin = timed.reduce((s, r) => s + r.min, 0);
  if (!totalMin) {
    mix[CATEGORY_BAND[cat] ?? 'aerobic'] = total;
    return mix;
  }
  for (const r of timed) mix[r.band] += (r.min / totalMin) * total;
  return mix;
}

/** Suma de intensityMix sobre una lista de entrenos. */
export function weekIntensityMix(workouts) {
  const out = { aerobic: 0, marathon: 0, threshold: 0, race: 0 };
  for (const w of workouts || []) {
    const m = intensityMix(w);
    for (const b of INTENSITY_BANDS) out[b] += m[b];
  }
  return out;
}

/** Suma de la carga estimada de una lista de entrenos (los que no tienen datos cuentan 0). */
export function plannedLoad(workouts) {
  return (workouts || []).reduce((s, w) => s + (estimateWorkoutLoad(w) || 0), 0);
}

/**
 * Avisos de estructura sobre lo que queda de plan (de la semana actual en
 * adelante: lo pasado ya no se puede arreglar).
 *   hard_back_to_back — dos sesiones duras (calidad/test/carrera) en días seguidos.
 *   no_long           — semana con 3+ sesiones y sin tirada larga ni carrera.
 *   ramp_streak       — dos semanas seguidas subiendo el volumen más del 10%.
 * `weeks` es la salida de planActuals.weeklyVolume.
 */
export function planWarnings(workouts, weeks, todayISO) {
  const out = [];
  const from = weeks.find((w) => w.is_current)?.week_start ?? todayISO;
  const ahead = (workouts || [])
    .filter((w) => w?.date && w.date >= from && w.status !== 'skipped')
    .sort((a, b) => a.date.localeCompare(b.date));

  const hard = ahead.filter((w) => HARD.has(workoutCategory(w)));
  for (let i = 1; i < hard.length; i++) {
    if (dayDiff(hard[i].date, hard[i - 1].date) === 1) {
      out.push({ type: 'hard_back_to_back', dates: [hard[i - 1].date, hard[i].date] });
    }
  }

  for (const wk of weeks) {
    if (wk.week_start < from) continue;
    const end = addDays(wk.week_start, 6);
    const inWeek = ahead.filter((w) => w.date >= wk.week_start && w.date <= end);
    const sessions = inWeek.filter((w) => workoutCategory(w) !== 'rest');
    const hasLong = inWeek.some((w) => ['long', 'race'].includes(workoutCategory(w)));
    if (sessions.length >= 3 && !hasLong) out.push({ type: 'no_long', week_start: wk.week_start });
  }

  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i].week_start < from) continue;
    if (weeks[i].ramp_warning && weeks[i - 1].ramp_warning) {
      out.push({ type: 'ramp_streak', week_start: weeks[i].week_start });
    }
  }
  return out;
}

/**
 * Días con carrera que no tienen entreno en el plan (o solo un descanso), desde
 * el primer día del plan hasta hoy. Devuelve el resumen de lo corrido (mismo
 * formato que planActuals.workoutActual) con su fecha, del más reciente al más antiguo.
 */
export function unplannedRuns(plan, byDay, todayISO) {
  const workouts = (plan?.workouts || []).filter((w) => w?.date);
  if (!workouts.length) return [];
  const first = workouts.reduce((m, w) => (w.date < m ? w.date : m), workouts[0].date);
  const planned = new Set(workouts.filter((w) => workoutCategory(w) !== 'rest').map((w) => w.date));
  const out = [];
  for (const date of byDay.keys()) {
    if (date < first || date > todayISO || planned.has(date)) continue;
    const actual = workoutActual({ date }, byDay);
    if (actual) out.push({ date, ...actual });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Plan frente a real de una sesión: distancia, tiempo y ritmo, con la
 * desviación en % y un semáforo (good ≤10%, caution ≤25%, risk >25%). El ritmo
 * planificado solo existe si el entreno trae distancia y duración.
 */
export function compareToPlan(w, actual) {
  if (!actual) return [];
  const level = (pct) => (pct == null ? null : Math.abs(pct) <= 10 ? 'good' : Math.abs(pct) <= 25 ? 'caution' : 'risk');
  const pct = (real, plan) => (plan > 0 && real != null ? Math.round(((real - plan) / plan) * 100) : null);
  const dist = Number(w?.distance_km) || null;
  const dur = Number(w?.duration_min) || null;
  const planPace = dist && dur ? dur / dist : null;
  const rows = [
    { key: 'distance', plan: dist, real: actual.distance_km, delta: pct(actual.distance_km, dist) },
    { key: 'duration', plan: dur, real: actual.moving_time_min, delta: pct(actual.moving_time_min, dur) },
    // Ritmo: más rápido (menos min/km) es delta negativo.
    { key: 'pace', plan: planPace, real: actual.pace_min_km, delta: pct(actual.pace_min_km, planPace) },
  ];
  return rows.map((r) => ({ ...r, level: level(r.delta) }));
}
