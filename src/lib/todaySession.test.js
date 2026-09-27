import { describe, it, expect } from 'vitest';
import { planDayFor, resolveTodaySession, workoutBlocks, coachSessionFrom } from './todaySession';

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

  it('una carrera en Garmin con el estado en rojo también avisa', () => {
    const s = resolveTodaySession({
      garminPlanned: [{ date: '2026-09-23', title: 'Media', is_race: true }], todayISO: '2026-09-23', advisesRest: true,
    });
    expect(s.isRace).toBe(true);
    expect(s.conflict).toBe(true);
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
