// Contrato de las tools de planes de entrenamiento: lo que el MCP escribe es lo
// que la app lee (src/lib/trainingPlans), así que se comprueba el blob guardado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  return new Map(); // `${userId}:${key}` -> string JSON, como en user_storage
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const f = {};
      const builder = {
        select: () => builder,
        eq: (col, val) => { f[col] = val; return builder; },
        maybeSingle: async () => ({
          data: store.has(`${f.user_id}:${f.key}`) ? { value: store.get(`${f.user_id}:${f.key}`) } : null,
          error: null,
        }),
        upsert: async (row) => { store.set(`${row.user_id}:${row.key}`, row.value); return { error: null }; },
      };
      return builder;
    },
  }),
}));

const {
  listTrainingPlans, getTrainingPlan, upsertTrainingPlan, deleteTrainingPlan,
  upsertPlannedWorkout, deletePlannedWorkout,
} = await import('./mcp-store.js');

const U = 'user-1';
const saved = () => JSON.parse(store.get(`${U}:training_plans`));

describe('planes de entrenamiento (MCP)', () => {
  beforeEach(() => {
    store.clear();
    store.set(`${U}:target_races`, JSON.stringify([{ id: 'r1', name: 'Behobia', date: '2026-11-08', distance: '21k' }]));
  });

  it('crea un plan vinculado a una carrera y resuelve su nombre', async () => {
    const res = await upsertTrainingPlan(U, { name: 'San Sebastián', race_id: 'r1' });
    expect(res.ok).toBe(true);
    expect(res.plan.race).toMatchObject({ name: 'Behobia', date: '2026-11-08' });
    // Formato que lee la app: camelCase `raceId`.
    expect(saved()[0].raceId).toBe('r1');
  });

  it('rechaza un race_id que no existe y desvincula con null', async () => {
    expect((await upsertTrainingPlan(U, { name: 'X', race_id: 'nope' })).error).toBeTruthy();
    const { plan } = await upsertTrainingPlan(U, { name: 'X', race_id: 'r1' });
    const res = await upsertTrainingPlan(U, { plan_id: plan.id, race_id: null });
    expect(res.plan.race_id).toBeNull();
  });

  it('un race_id huérfano (carrera borrada) sale como race: null', async () => {
    const { plan } = await upsertTrainingPlan(U, { name: 'X', race_id: 'r1' });
    store.set(`${U}:target_races`, '[]');
    const got = await getTrainingPlan(U, plan.id);
    expect(got.race).toBeNull();
  });

  it('crea entrenos ordenados por fecha con campos opcionales', async () => {
    const { plan } = await upsertTrainingPlan(U, { name: 'P' });
    await upsertPlannedWorkout(U, { plan_id: plan.id, date: '2026-10-20', type: 'Tirada larga', distance_km: 18, duration_min: 100 });
    await upsertPlannedWorkout(U, { plan_id: plan.id, date: '2026-10-15', type: 'Series' });
    const got = await getTrainingPlan(U, plan.id);
    expect(got.workouts.map((w) => w.date)).toEqual(['2026-10-15', '2026-10-20']);
    expect(got.workouts[1]).toMatchObject({ distance_km: 18, duration_min: 100, status: 'planned', coach_note: null });
    expect(got).toMatchObject({ workout_count: 2, first_date: '2026-10-15', last_date: '2026-10-20' });
  });

  it('edición parcial: status + coach_note sin tocar el resto; null borra', async () => {
    const { plan } = await upsertTrainingPlan(U, { name: 'P' });
    const { workout } = await upsertPlannedWorkout(U, { plan_id: plan.id, date: '2026-10-20', type: 'Tirada larga', distance_km: 18 });
    const res = await upsertPlannedWorkout(U, { plan_id: plan.id, workout_id: workout.id, status: 'done', coach_note: 'Ritmo controlado' });
    expect(res.workout).toMatchObject({ type: 'Tirada larga', distance_km: 18, status: 'done', coach_note: 'Ritmo controlado' });
    await upsertPlannedWorkout(U, { plan_id: plan.id, workout_id: workout.id, distance_km: null });
    expect('distance_km' in saved()[0].workouts[0]).toBe(false);
    const list = await listTrainingPlans(U);
    expect(list.plans[0].done_count).toBe(1);
  });

  it('valida fecha, tipo, status y números', async () => {
    const { plan } = await upsertTrainingPlan(U, { name: 'P' });
    expect((await upsertPlannedWorkout(U, { plan_id: plan.id, type: 'X' })).error).toBeTruthy();
    expect((await upsertPlannedWorkout(U, { plan_id: plan.id, date: '20/10/2026', type: 'X' })).error).toBeTruthy();
    expect((await upsertPlannedWorkout(U, { plan_id: plan.id, date: '2026-10-20', type: 'X', status: 'meh' })).error).toBeTruthy();
    expect((await upsertPlannedWorkout(U, { plan_id: plan.id, date: '2026-10-20', type: 'X', distance_km: -3 })).error).toBeTruthy();
    expect((await upsertPlannedWorkout(U, { plan_id: 'nope', date: '2026-10-20', type: 'X' })).error).toBeTruthy();
  });

  it('borra entrenos y planes', async () => {
    const { plan } = await upsertTrainingPlan(U, { name: 'P' });
    const { workout } = await upsertPlannedWorkout(U, { plan_id: plan.id, date: '2026-10-20', type: 'Rodaje' });
    expect((await deletePlannedWorkout(U, plan.id, workout.id)).remaining).toBe(0);
    expect((await deletePlannedWorkout(U, plan.id, workout.id)).error).toBeTruthy();
    expect((await deleteTrainingPlan(U, plan.id)).ok).toBe(true);
    expect((await listTrainingPlans(U)).count).toBe(0);
  });
});
