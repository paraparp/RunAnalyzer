import { describe, it, expect } from 'vitest';
import { runsByDay, workoutActual, weeklyVolume, autoDoneCandidates, isRestWorkout } from './planActuals';

const run = (date, km, min, hr = null, extra = {}) => ({
  id: `${date}-${km}`, type: 'Run', name: `Run ${km}`,
  start_date_local: `${date}T08:00:00Z`, distance: km * 1000, moving_time: min * 60,
  average_heartrate: hr, ...extra,
});

describe('runsByDay / workoutActual', () => {
  it('agrupa solo carreras por día local', () => {
    const byDay = runsByDay([run('2026-09-22', 10, 50), { ...run('2026-09-22', 30, 60), type: 'Ride' }]);
    expect(byDay.get('2026-09-22')).toHaveLength(1);
  });

  it('suma las carreras del día y pondera la FC por tiempo', () => {
    const byDay = runsByDay([run('2026-09-22', 2, 10, 130), run('2026-09-22', 10, 40, 160)]);
    const a = workoutActual({ date: '2026-09-22' }, byDay);
    expect(a).toMatchObject({ distance_km: 12, moving_time_min: 50, avg_hr: 154, activity_id: '2026-09-22-10' });
    expect(a.pace_min_km).toBeCloseTo(50 / 12);
    expect(a.activity_ids).toHaveLength(2);
  });

  it('sin carreras ese día no hay real', () => {
    expect(workoutActual({ date: '2026-09-23' }, runsByDay([run('2026-09-22', 10, 50)]))).toBeNull();
  });
});

describe('weeklyVolume', () => {
  const plan = {
    workouts: [
      { date: '2026-09-22', type: 'Rodaje', distance_km: 10, status: 'done' },
      { date: '2026-09-26', type: 'Tirada larga', distance_km: 20 },
      { date: '2026-09-27', type: 'Descanso', distance_km: 5 },
      // Semana del 28-sep vacía (descarga); 5-oct sube mucho.
      { date: '2026-10-06', type: 'Rodaje', distance_km: 40 },
    ],
  };
  const byDay = runsByDay([run('2026-09-22', 11, 55), run('2026-09-24', 6, 30)]);

  it('incluye las semanas vacías, no cuenta el descanso y el real es todo lo corrido', () => {
    const weeks = weeklyVolume(plan, byDay, '2026-09-24');
    expect(weeks.map((w) => w.week_start)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(weeks[0]).toMatchObject({ planned_km: 30, actual_km: 17, sessions: 2, done: 1, is_current: true });
    // Semanas que no han empezado: sin real.
    expect(weeks[1].actual_km).toBeNull();
  });

  it('avisa de una subida de más del 10% sobre la semana anterior', () => {
    const weeks = weeklyVolume(plan, byDay, '2026-09-24');
    // Tras una semana a 0 no hay base con la que comparar.
    expect(weeks[2].ramp_pct).toBeNull();
    const two = weeklyVolume({ workouts: [
      { date: '2026-09-22', type: 'Rodaje', distance_km: 30 },
      { date: '2026-09-29', type: 'Rodaje', distance_km: 36 },
    ] }, byDay, '2026-09-24');
    expect(two[1]).toMatchObject({ ramp_pct: 20, ramp_warning: true });
  });

  it('plan vacío no da semanas', () => {
    expect(weeklyVolume({ workouts: [] }, byDay, '2026-09-24')).toEqual([]);
  });
});

describe('autoDoneCandidates', () => {
  const byDay = runsByDay([run('2026-09-22', 10, 50), run('2026-09-23', 5, 25), run('2026-09-25', 8, 40)]);
  const plans = [{
    id: 'p',
    workouts: [
      { id: 'a', date: '2026-09-22', type: 'Rodaje', status: 'planned' },
      { id: 'b', date: '2026-09-23', type: 'Descanso' },
      { id: 'c', date: '2026-09-24', type: 'Series' },
      { id: 'd', date: '2026-09-25', type: 'Rodaje', status: 'planned', status_manual: true },
      { id: 'e', date: '2026-09-22', type: 'Rodaje', status: 'skipped' },
      { id: 'f', date: '2026-09-30', type: 'Rodaje' },
    ],
  }];

  it('solo los pendientes con carrera, no descansos, manuales, saltados ni futuros', () => {
    expect(autoDoneCandidates(plans, byDay, '2026-09-26')).toEqual([{ planId: 'p', workoutId: 'a' }]);
  });

  it('isRestWorkout: descanso sin estructura', () => {
    expect(isRestWorkout({ type: 'Descanso' })).toBe(true);
    expect(isRestWorkout({ type: 'Descanso activo', structured_workout: [{ phase: 'x' }] })).toBe(false);
    expect(isRestWorkout({ type: 'Rodaje' })).toBe(false);
  });
});
