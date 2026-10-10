import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
vi.mock('./cloudStorage', () => ({
  default: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
}));

const {
  getTrainingPlans, saveTrainingPlan, deleteTrainingPlan, saveWorkout, deleteWorkout,
  duplicateWeek, syncPlanStatuses,
} = await import('./trainingPlans');

const newPlan = (name = 'San Sebastián') => {
  const list = saveTrainingPlan({ name });
  return list[list.length - 1];
};

describe('trainingPlans', () => {
  beforeEach(() => store.clear());

  it('crea un plan vacío con id', () => {
    const plan = newPlan();
    expect(plan.id).toBeTruthy();
    expect(plan.workouts).toEqual([]);
  });

  it('editar el plan (nombre, carrera) no toca sus entrenos', () => {
    const plan = newPlan();
    saveWorkout(plan.id, { date: '2026-11-01', type: 'Tirada larga' });
    saveTrainingPlan({ id: plan.id, name: 'Otro', raceId: 'r1' });
    const [saved] = getTrainingPlans();
    expect(saved.name).toBe('Otro');
    expect(saved.raceId).toBe('r1');
    expect(saved.workouts).toHaveLength(1);
  });

  it('los entrenos quedan ordenados por fecha y nacen como planned', () => {
    const plan = newPlan();
    saveWorkout(plan.id, { date: '2026-11-08', type: 'Series' });
    saveWorkout(plan.id, { date: '2026-11-01', type: 'Rodaje' });
    const { workouts } = getTrainingPlans()[0];
    expect(workouts.map((w) => w.date)).toEqual(['2026-11-01', '2026-11-08']);
    expect(workouts.every((w) => w.status === 'planned')).toBe(true);
  });

  it('editar un entreno hace merge parcial', () => {
    const plan = newPlan();
    saveWorkout(plan.id, { date: '2026-11-01', type: 'Tirada larga', distance_km: 18 });
    const { id } = getTrainingPlans()[0].workouts[0];
    saveWorkout(plan.id, { id, status: 'done', coach_note: 'Bien' });
    const [w] = getTrainingPlans()[0].workouts;
    expect(w).toMatchObject({ type: 'Tirada larga', distance_km: 18, status: 'done', coach_note: 'Bien' });
  });

  it('un campo opcional a undefined se borra al persistir', () => {
    const plan = newPlan();
    saveWorkout(plan.id, { date: '2026-11-01', type: 'Rodaje', distance_km: 10 });
    const { id } = getTrainingPlans()[0].workouts[0];
    saveWorkout(plan.id, { id, distance_km: undefined });
    expect('distance_km' in getTrainingPlans()[0].workouts[0]).toBe(false);
  });

  it('borra entrenos y planes', () => {
    const plan = newPlan();
    saveWorkout(plan.id, { date: '2026-11-01', type: 'Rodaje' });
    const { id } = getTrainingPlans()[0].workouts[0];
    deleteWorkout(plan.id, id);
    expect(getTrainingPlans()[0].workouts).toEqual([]);
    deleteTrainingPlan(plan.id);
    expect(getTrainingPlans()).toEqual([]);
  });

  it('guardar en un plan inexistente no hace nada', () => {
    saveWorkout('nope', { date: '2026-11-01', type: 'Rodaje' });
    expect(getTrainingPlans()).toEqual([]);
  });

  it('duplicar semana copia a +7 días como pendientes, sin nota ni envío a Garmin', () => {
    const plan = newPlan();
    saveWorkout(plan.id, { date: '2026-09-22', type: 'Series', status: 'done', coach_note: 'ok', garmin_workout_id: 9, status_manual: true });
    saveWorkout(plan.id, { date: '2026-09-27', type: 'Tirada larga', distance_km: 18 });
    saveWorkout(plan.id, { date: '2026-09-29', type: 'Rodaje' }); // fuera de la semana
    expect(duplicateWeek(plan.id, '2026-09-21')).toBe(2);
    const copies = getTrainingPlans()[0].workouts.filter((w) => w.date === '2026-09-29' || w.date === '2026-10-04');
    expect(copies).toHaveLength(3);
    const series = copies.find((w) => w.type === 'Series');
    expect(series).toMatchObject({ date: '2026-09-29', status: 'planned' });
    expect(series.coach_note).toBeUndefined();
    expect(series.garmin_workout_id).toBeUndefined();
    expect(series.status_manual).toBeUndefined();
    expect(copies.find((w) => w.type === 'Tirada larga')).toMatchObject({ date: '2026-10-04', distance_km: 18 });
  });

  it('duplicar una semana vacía no escribe nada', () => {
    const plan = newPlan();
    expect(duplicateWeek(plan.id, '2026-09-21')).toBe(0);
  });

  it('syncPlanStatuses marca hechos los entrenos ya corridos', () => {
    const plan = newPlan();
    saveWorkout(plan.id, { date: '2026-09-22', type: 'Rodaje' });
    saveWorkout(plan.id, { date: '2026-09-23', type: 'Rodaje', status: 'planned', status_manual: true });
    const runs = ['2026-09-22', '2026-09-23'].map((d) => ({
      id: d, type: 'Run', start_date_local: `${d}T08:00:00Z`, distance: 10000, moving_time: 3000,
    }));
    expect(syncPlanStatuses(runs, '2026-09-24')).toBe(1);
    const [a, b] = getTrainingPlans()[0].workouts;
    expect(a.status).toBe('done');
    expect(b.status).toBe('planned');
    // Idempotente: una segunda pasada no reescribe.
    expect(syncPlanStatuses(runs, '2026-09-24')).toBe(0);
  });
});
