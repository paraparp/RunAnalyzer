// ============================================================================
// todaySession — qué toca HOY, por orden de autoridad.
//
// La portada proponía siempre un rodaje suave (o regenerativo), con independencia
// de que el atleta tuviera un plan: los números salían de sus datos, pero el TIPO
// de sesión estaba fijo en el código. Aquí se decide con las fuentes reales:
//
//   1. Garmin — un entreno (o una carrera) agendado para hoy en su calendario. Es
//      lo que le va a enseñar el reloj, así que manda.
//   2. Plan del Entrenador IA — el día de hoy del último plan generado. El plan es
//      una plantilla semanal: cada día se resuelve a su PRÓXIMA fecha contando
//      desde el día en que se generó (`nextDateForDay`, la misma regla con la que
//      se agenda en Garmin), así que cubre los 7 días siguientes y luego caduca.
//   3. Automática — sin plan para hoy, la propuesta derivada del estado (la que
//      ya existía), dicha como tal.
//
// Si la sesión planificada es dura y el estado pide descargar, no se cambia el
// plan en silencio: se marca `conflict` y la UI lo avisa.
// ============================================================================

import { isRestDay, nextDateForDay, toISODate } from './planSchedule.js';
import { parseWorkout } from './aiInsights.js';

/** Clave de cloudStorage del último plan del Entrenador IA. */
export const AI_PLAN_KEY = 'ai_training_plan';
/** Clave de cloudStorage del calendario de Garmin (se refresca una vez al día). */
export const GARMIN_PLANNED_KEY = 'garmin_planned_cache';

/** La sesión del coach vale para las próximas 48 h desde que se generó. */
const COACH_TTL_MS = 48 * 3600 * 1000;

/** Intensidad (1-5) a partir de la cual un bloque es "duro" (umbral o más). */
const HARD_INTENSITY = 4;

const fromISO = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * Día del plan que cae en `todayISO`, o null. `saved` es lo que guarda el
 * Entrenador IA: `{ plan, generated_at: 'YYYY-MM-DD', race_id }`.
 * Devuelve `{ day, covered, expired }`: `covered` = hoy cae dentro de la semana del
 * plan (si no trae sesión para hoy, es que hoy no se entrena); `expired` = el plan
 * ya no cubre hoy (tiene más de una semana), para poder decirlo en vez de callar.
 */
export function planDayFor(saved, todayISO) {
  const schedule = saved?.plan?.schedule;
  if (!Array.isArray(schedule) || !saved.generated_at) return { day: null, covered: false, expired: false };
  const start = fromISO(saved.generated_at);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  if (todayISO < toISODate(start)) return { day: null, covered: false, expired: false };
  if (todayISO > toISODate(end)) return { day: null, covered: false, expired: true };
  const day = schedule.find((d) => nextDateForDay(d.day, start) === todayISO) ?? null;
  return { day, covered: true, expired: false };
}

/**
 * Bloques de una sesión estructurada con su duración TOTAL (reps × duración) y
 * el total de la sesión. Las recuperaciones entre series no traen duración en el
 * schema, así que no se inventan: el total es el del trabajo declarado.
 */
export function workoutBlocks(structured) {
  if (!Array.isArray(structured)) return { blocks: [], totalMin: 0, maxIntensity: 0 };
  const blocks = structured.map((b) => ({
    ...b,
    totalMin: (Number(b.duration_min) || 0) * (Number(b.reps) || 1),
  }));
  return {
    blocks,
    totalMin: blocks.reduce((s, b) => s + b.totalMin, 0),
    maxIntensity: blocks.reduce((m, b) => Math.max(m, Number(b.intensity) || 0), 0),
  };
}

/**
 * La sesión de hoy.
 *
 * @param {object} p
 * @param {Array}  p.garminPlanned   `planned` de Garmin (`{ date, title, is_race, sport }`)
 * @param {object} p.savedPlan       plan guardado del Entrenador IA
 * @param {string} p.todayISO        YYYY-MM-DD local
 * @param {boolean} p.advisesRest    la readiness o la forma piden descargar
 * @returns {{ source: 'garmin'|'ai_plan'|'auto', ... }}
 */
export function resolveTodaySession({ garminPlanned = [], savedPlan = null, todayISO, advisesRest = false }) {
  const garminToday = (garminPlanned || []).filter((x) => x?.date === todayISO);
  if (garminToday.length) {
    const race = garminToday.find((x) => x.is_race);
    const item = race ?? garminToday[0];
    return {
      source: 'garmin',
      title: item.title || (item.is_race ? 'Carrera' : 'Entreno'),
      isRace: !!item.is_race,
      extra: garminToday.length - 1,
      // Sin estructura (el calendario solo trae el título): no se puede saber si es
      // dura, pero una carrera lo es por definición.
      conflict: advisesRest && !!item.is_race,
    };
  }

  const { day, covered, expired } = planDayFor(savedPlan, todayISO);
  if (covered) {
    // Un día que el plan no incluye es un día sin sesión: descanso según el plan.
    const rest = !day || isRestDay(day);
    const { blocks, totalMin, maxIntensity } = workoutBlocks(day?.structured_workout);
    return {
      source: 'ai_plan',
      rest,
      type: day?.type ?? null,
      summary: day?.summary ?? null,
      dist: day?.daily_stats?.dist ?? null,
      time: day?.daily_stats?.time ?? null,
      blocks,
      totalMin,
      hard: maxIntensity >= HARD_INTENSITY,
      conflict: advisesRest && !rest && maxIntensity >= HARD_INTENSITY,
      hrvGuidance: savedPlan?.plan?.hrv_guidance ?? null,
    };
  }

  return { source: 'auto', planExpired: expired };
}

/**
 * La sesión recomendada por el Coach IA (su bloque "Plan · próximas 48 h"),
 * o null si no hay análisis o tiene más de 48 h. `cache` es el estado de
 * useAIInsights: `{ nextWork, meta, timestamp }`.
 */
export function coachSessionFrom(cache, nowMs) {
  const ts = Number(cache?.timestamp);
  if (!ts || nowMs - ts > COACH_TTL_MS || nowMs < ts) return null;
  const w = parseWorkout(cache.nextWork, cache.meta);
  if (!w) return null;
  const zone = Number(w.hrZone?.match(/Zona\s*(\d)/i)?.[1]) || null;
  const hr = w.hrZone?.match(/(\d+\s*-\s*\d+)\s*ppm/i)?.[1]?.replace(/\s+/g, '') ?? null;
  const { blocks, totalMin, maxIntensity } = workoutBlocks(cache.meta?.sesion?.structured_workout);
  return {
    type: w.type,
    distance: w.distance,
    pace: w.pace?.replace(/\s*min\/km/i, '') ?? null,
    hr,
    zone,
    blocks,
    totalMin,
    hard: maxIntensity >= HARD_INTENSITY || (zone ?? 0) >= HARD_INTENSITY,
    generatedAt: ts,
  };
}
