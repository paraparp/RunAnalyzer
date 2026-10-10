import { describe, it, expect } from 'vitest';
import { planDayFor, resolveTodaySession, workoutBlocks, coachSessionFrom, trainingPlanDayFor } from './todaySession';

// Plan generado el lunes 21-sep-2026: cubre del 21 al 27.
const plan = {
  hrv_guidance: 'Si amaneces en rojo, cambia las series por rodaje.',
  schedule: [
    { day: 'Lunes', type: 'Rodaje', daily_stats: { dist: '10 km', time: '55 min' }, summary: 'Z2',
      structured_workout: [{ phase: 'Rodaje', duration_min: 55, intensity: 2 }] },
    { day: 'Miércoles', type: 'Series', summary: 'VO2',
      structured_workout: [
        { phase: 'Calentamiento', duration_min: 15, intensity: 1 },
        { phase: 'Series', duration_min: 4, reps: 5, intensity: 5, pace: '3:50/km' },
        { phase: 'Vuelta a la calma', duration_min: 10, intensity: 1 },
      ] },
    { day: 'Viernes', type: 'Descanso', summary: '', structured_workout: [] },
  ],
};
const saved = { plan, generated_at: '2026-09-21' };

describe('planDayFor', () => {
  it('resuelve cada día a su fecha dentro de la semana del plan', () => {
    expect(planDayFor(saved, '2026-09-21').day.type).toBe('Rodaje');
    expect(planDayFor(saved, '2026-09-23').day.type).toBe('Series');
  });

  it('un día que el plan no trae está cubierto pero sin sesión', () => {
    expect(planDayFor(saved, '2026-09-22')).toEqual({ day: null, covered: true, expired: false });
  });

  it('caduca a la semana', () => {
    expect(planDayFor(saved, '2026-09-28')).toEqual({ day: null, covered: false, expired: true });
  });
});

describe('workoutBlocks', () => {
  it('multiplica las repeticiones y da la intensidad máxima', () => {
    const w = workoutBlocks(plan.schedule[1].structured_workout);
    expect(w.totalMin).toBe(15 + 20 + 10);
    expect(w.maxIntensity).toBe(5);
  });
});

describe('resolveTodaySession', () => {
  it('Garmin manda sobre el plan', () => {
    const s = resolveTodaySession({
      garminPlanned: [{ date: '2026-09-23', title: 'Tempo 3×10' }], savedPlan: saved, todayISO: '2026-09-23',
    });
    expect(s.source).toBe('garmin');
    expect(s.title).toBe('Tempo 3×10');
  });

  it('el plan del día, con aviso si es duro y el estado pide descargar', () => {
    const s = resolveTodaySession({ savedPlan: saved, todayISO: '2026-09-23', advisesRest: true });
    expect(s.source).toBe('ai_plan');
    expect(s.hard).toBe(true);
    expect(s.conflict).toBe(true);
    expect(s.hrvGuidance).toMatch(/rojo/);
  });

  it('descanso del plan: declarado o día sin sesión', () => {
    expect(resolveTodaySession({ savedPlan: saved, todayISO: '2026-09-25' }).rest).toBe(true);
    expect(resolveTodaySession({ savedPlan: saved, todayISO: '2026-09-22' }).rest).toBe(true);
  });

  it('sin plan vigente cae a la propuesta automática y dice si caducó', () => {
    expect(resolveTodaySession({ todayISO: '2026-09-23' })).toEqual({ source: 'auto', planExpired: false });
    expect(resolveTodaySession({ savedPlan: saved, todayISO: '2026-10-01' }).planExpired).toBe(true);
  });

  it('una sesión de calidad en Garmin con el estado en rojo avisa por su título', () => {
    const hard = resolveTodaySession({
      garminPlanned: [{ date: '2026-09-23', title: 'Series 6×1000' }], todayISO: '2026-09-23', advisesRest: true,
    });
    expect(hard.conflict).toBe(true);
    const easy = resolveTodaySession({
      garminPlanned: [{ date: '2026-09-23', title: 'Rodaje suave' }], todayISO: '2026-09-23', advisesRest: true,
    });
    expect(easy.conflict).toBe(false);
  });

  it('una carrera en Garmin con el estado en rojo también avisa', () => {
    const s = resolveTodaySession({
      garminPlanned: [{ date: '2026-09-23', title: 'Media', is_race: true }], todayISO: '2026-09-23', advisesRest: true,
    });
    expect(s.isRace).toBe(true);
    expect(s.conflict).toBe(true);
  });
});

// Plan de entrenamiento con fechas: semana del lunes 21-sep con tres sesiones, la
// siguiente semana (28-sep a 4-oct) entera de descarga sin sesiones, y una más el 6-oct.
const trainingPlans = [{
  id: 'p1',
  name: 'San Sebastián',
  workouts: [
    { id: 'w1', date: '2026-09-22', type: 'Series', status: 'planned', summary: '5×1000',
      structured_workout: [
        { phase: 'Calentamiento', duration_min: 15, intensity: 1 },
        { phase: 'Series', duration_min: 4, reps: 5, intensity: 5 },
      ] },
    { id: 'w2', date: '2026-09-24', type: 'Rodaje', status: 'done', distance_km: 10, coach_note: 'Bien' },
    { id: 'w3', date: '2026-09-26', type: 'Tirada larga', status: 'planned', distance_km: 18, duration_min: 100 },
    { id: 'w4', date: '2026-10-06', type: 'Rodaje', status: 'planned' },
  ],
}];

describe('trainingPlanDayFor', () => {
  it('da el entreno de hoy y la semana lunes-domingo', () => {
    const r = trainingPlanDayFor(trainingPlans, '2026-09-22');
    expect(r.workout.id).toBe('w1');
    expect(r.covered).toBe(true);
    expect(r.week.map((d) => d.date)).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
    ]);
  });

  it('un hueco de la semana está cubierto, sin entreno', () => {
    const r = trainingPlanDayFor(trainingPlans, '2026-09-23');
    expect(r.workout).toBeNull();
    expect(r.covered).toBe(true);
  });

  it('una semana sin sesiones dentro del rango del plan también está cubierta', () => {
    expect(trainingPlanDayFor(trainingPlans, '2026-09-30').covered).toBe(true);
  });

  it('fuera del plan no cubre', () => {
    expect(trainingPlanDayFor(trainingPlans, '2026-10-20').covered).toBe(false);
    expect(trainingPlanDayFor([], '2026-09-22').covered).toBe(false);
  });
});

describe('resolveTodaySession con planes de entrenamiento', () => {
  it('el entreno del plan manda sobre Garmin y sobre el plan IA', () => {
    const s = resolveTodaySession({
      trainingPlans, savedPlan: saved, todayISO: '2026-09-22',
      garminPlanned: [{ date: '2026-09-22', title: 'Series' }],
    });
    expect(s.source).toBe('training_plan');
    expect(s.type).toBe('Series');
    expect(s.planName).toBe('San Sebastián');
    expect(s.totalMin).toBe(35);
    expect(s.hard).toBe(true);
  });

  it('un hueco del plan es descanso, no cae al plan IA', () => {
    // El plan IA tiene Series el miércoles 23; el plan de entrenamiento no tiene nada ese día.
    const s = resolveTodaySession({ trainingPlans, savedPlan: saved, todayISO: '2026-09-23' });
    expect(s.source).toBe('training_plan');
    expect(s.rest).toBe(true);
    expect(s.week).toHaveLength(7);
  });

  it('en un hueco del plan, lo agendado en Garmin sí manda', () => {
    const s = resolveTodaySession({
      trainingPlans, todayISO: '2026-09-23', garminPlanned: [{ date: '2026-09-23', title: 'Rodaje' }],
    });
    expect(s.source).toBe('garmin');
  });

  it('fuera del plan de entrenamiento se usa el plan IA', () => {
    const plansLater = [{ id: 'p2', name: 'X', workouts: [{ id: 'a', date: '2026-11-10', type: 'Rodaje' }] }];
    expect(resolveTodaySession({ trainingPlans: plansLater, savedPlan: saved, todayISO: '2026-09-23' }).source).toBe('ai_plan');
  });

  it('sin estructura usa distancia y duración del entreno', () => {
    const s = resolveTodaySession({ trainingPlans, todayISO: '2026-09-26', advisesRest: true });
    expect(s).toMatchObject({ dist: '18 km', time: '100 min', totalMin: 100, hard: false });
    // Una tirada larga en día de descarga también avisa.
    expect(s.conflict).toBe(true);
    expect(s.planDay.type).toBe('Tirada larga');
  });

  it('hecho: trae la nota del coach y no avisa de conflicto', () => {
    const s = resolveTodaySession({ trainingPlans, todayISO: '2026-09-24', advisesRest: true });
    expect(s).toMatchObject({ done: true, coachNote: 'Bien', conflict: false });
  });

  it('un entreno saltado o de descanso cuenta como descanso', () => {
    const plans = [{ id: 'p', name: 'P', workouts: [
      { id: 'a', date: '2026-09-22', type: 'Series', status: 'skipped', summary: 'x' },
      { id: 'b', date: '2026-09-23', type: 'Descanso' },
    ] }];
    const skipped = resolveTodaySession({ trainingPlans: plans, todayISO: '2026-09-22' });
    expect(skipped).toMatchObject({ source: 'training_plan', rest: true, skipped: true, summary: null });
    expect(resolveTodaySession({ trainingPlans: plans, todayISO: '2026-09-23' }).rest).toBe(true);
  });
});

describe('coachSessionFrom', () => {
  const now = Date.UTC(2026, 8, 27, 8);
  const cache = {
    timestamp: now - 3 * 3600 * 1000,
    nextWork: '',
    meta: {
      sesion: {
        tipo: 'Intervalos', distancia: '8-10 km', ritmo: '3:37-3:53 min/km', zona: 'Zona 4 · 169-183 ppm',
        structured_workout: [
          { phase: 'Calentamiento', duration_min: 15, intensity: 2, pace: '5:26/km' },
          { phase: 'Series', duration_min: 4, reps: 4, intensity: 4, pace: '3:37/km', hr: '169-183', recovery: '90" trote' },
          { phase: 'Vuelta a la calma', duration_min: 10, intensity: 1 },
        ],
      },
    },
  };

  it('saca la prescripción del coach con sus bloques', () => {
    const c = coachSessionFrom(cache, now);
    expect(c).toMatchObject({ type: 'Intervalos', distance: '8-10 km', pace: '3:37-3:53', hr: '169-183', zone: 4, totalMin: 41, hard: true });
    expect(c.blocks).toHaveLength(3);
  });

  it('caduca a las 48 h y sin caché no hay sesión', () => {
    expect(coachSessionFrom({ ...cache, timestamp: now - 49 * 3600 * 1000 }, now)).toBeNull();
    expect(coachSessionFrom(null, now)).toBeNull();
  });
});
