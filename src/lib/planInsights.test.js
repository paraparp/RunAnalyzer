import { describe, it, expect } from 'vitest';
import {
  estimateWorkoutLoad, plannedLoad, planWarnings, unplannedRuns, compareToPlan, intensityMix, weekIntensityMix,
} from './planInsights';
import { runsByDay, weeklyVolume } from './planActuals';

const run = (date, km, min = km * 5) => ({
  id: `${date}-${km}`, type: 'Run', start_date_local: `${date}T08:00:00Z`,
  distance: km * 1000, moving_time: min * 60,
});

describe('estimateWorkoutLoad', () => {
  it('usa la duración y la intensidad de la categoría', () => {
    expect(estimateWorkoutLoad({ type: 'Rodaje', category: 'easy', duration_min: 60 })).toBe(52);
    expect(estimateWorkoutLoad({ type: 'Series', category: 'quality', duration_min: 60 })).toBe(77);
  });

  it('deriva la duración de la distancia si no la hay', () => {
    expect(estimateWorkoutLoad({ type: 'Rodaje', category: 'easy', distance_km: 10 })).toBeGreaterThan(0);
  });

  it('descanso = 0 y sin datos = null', () => {
    expect(estimateWorkoutLoad({ type: 'Descanso', category: 'rest' })).toBe(0);
    expect(estimateWorkoutLoad({ type: 'Rodaje', category: 'easy' })).toBeNull();
    expect(plannedLoad([{ type: 'Rodaje', category: 'easy' }, { category: 'easy', duration_min: 60 }])).toBe(52);
  });
});

describe('planWarnings', () => {
  const today = '2026-10-05'; // lunes
  const plan = (workouts) => ({ workouts });

  it('avisa de dos sesiones duras en días seguidos', () => {
    const ws = [
      { date: '2026-10-06', type: 'Series', category: 'quality', distance_km: 10 },
      { date: '2026-10-07', type: 'Tempo', category: 'quality', distance_km: 10 },
    ];
    const weeks = weeklyVolume(plan(ws), new Map(), today);
    expect(planWarnings(ws, weeks, today)).toContainEqual({ type: 'hard_back_to_back', dates: ['2026-10-06', '2026-10-07'] });
  });

  it('avisa de una semana sin tirada larga', () => {
    const ws = ['2026-10-06', '2026-10-08', '2026-10-10'].map((date) => ({ date, type: 'Rodaje', category: 'easy', distance_km: 8 }));
    const weeks = weeklyVolume(plan(ws), new Map(), today);
    expect(planWarnings(ws, weeks, today)).toContainEqual({ type: 'no_long', week_start: '2026-10-05' });
  });

  it('ignora lo que ya pasó', () => {
    const ws = [
      { date: '2026-09-22', type: 'Series', category: 'quality', distance_km: 10 },
      { date: '2026-09-23', type: 'Tempo', category: 'quality', distance_km: 10 },
      { date: '2026-10-06', type: 'Rodaje', category: 'easy', distance_km: 8 },
    ];
    const weeks = weeklyVolume(plan(ws), new Map(), today);
    expect(planWarnings(ws, weeks, today)).toEqual([]);
  });
});

describe('unplannedRuns', () => {
  it('devuelve los días con carrera sin entreno planificado', () => {
    const p = { workouts: [
      { date: '2026-10-01', type: 'Rodaje', category: 'easy' },
      { date: '2026-10-02', type: 'Descanso', category: 'rest' },
    ] };
    const byDay = runsByDay([run('2026-10-01', 8), run('2026-10-02', 5), run('2026-10-03', 6), run('2026-09-20', 10)]);
    const out = unplannedRuns(p, byDay, '2026-10-05');
    expect(out.map((r) => r.date)).toEqual(['2026-10-03', '2026-10-02']);
    expect(out[0].distance_km).toBe(6);
  });
});

describe('intensityMix', () => {
  it('reparte los km de la sesión por el tiempo de cada bloque', () => {
    const m = intensityMix({
      category: 'quality', distance_km: 12,
      structured_workout: [
        { phase: 'Calentamiento', kind: 'warmup', duration_min: 20, intensity: 2 },
        { phase: 'Serie', kind: 'work', duration_min: 10, reps: 2, recovery: "2'", intensity: 4 },
        { phase: 'Calma', kind: 'cooldown', duration_min: 18, intensity: 1 },
      ],
    });
    // 20 + 10 + 2 + 10 + 18 = 60 min; 20 de umbral → 4 km de 12.
    expect(m.threshold).toBeCloseTo(4);
    expect(m.aerobic).toBeCloseTo(8);
    expect(m.marathon + m.race).toBe(0);
  });

  it('sin bloques usa la categoría', () => {
    expect(intensityMix({ category: 'easy', distance_km: 10 }).aerobic).toBe(10);
    expect(intensityMix({ category: 'race', distance_km: 21.1 }).race).toBe(21.1);
    expect(intensityMix({ category: 'rest' })).toEqual({ aerobic: 0, marathon: 0, threshold: 0, race: 0 });
  });

  it('suma la semana', () => {
    const m = weekIntensityMix([{ category: 'easy', distance_km: 10 }, { category: 'long', distance_km: 20 }]);
    expect(m.aerobic).toBe(30);
  });
});

describe('compareToPlan', () => {
  it('calcula la desviación y el semáforo', () => {
    const rows = compareToPlan(
      { distance_km: 10, duration_min: 50 },
      { distance_km: 13, moving_time_min: 52, pace_min_km: 4 },
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.distance).toMatchObject({ delta: 30, level: 'risk' });
    expect(by.duration).toMatchObject({ delta: 4, level: 'good' });
    expect(by.pace).toMatchObject({ plan: 5, delta: -20, level: 'caution' });
  });
});
