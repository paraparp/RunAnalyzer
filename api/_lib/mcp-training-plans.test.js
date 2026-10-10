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
  upsertPlannedWorkout, upsertPlannedWorkouts, deletePlannedWorkout, upsertTargetRace,
} = await import('./mcp-store.js');

describe('upsert_target_race: plan cortado', () => {
  it('avisa si el HTML guardado no tiene </html> y devuelve lo guardado', async () => {
    const W = 'user-race';
    const cut = '<!DOCTYPE html>\n<html><head><style>.vol .hd{display:flex}\n';
    const res = await upsertTargetRace(W, { name: 'Donostia', date: '2026-11-22', distance: '42k', plan: cut });
    expect(res.plan_chars).toBe(cut.length);
    expect(res.warnings[0]).toMatch(/CORTADO/);
    // La respuesta ya no repite el plan entero.
    expect(res.race.plan).toBeUndefined();

    const full = `${cut}</style></head><body>Semana 1</body></html>\n`;
    const ok = await upsertTargetRace(W, { race_id: res.race.id, plan: full });
    expect(ok.warnings).toBeUndefined();
    expect(ok.plan_chars).toBe(full.length);
  });

  it('un plan en markdown o texto no avisa', async () => {
    const res = await upsertTargetRace('user-race-2', { name: 'X', plan: '# Semana 1\n- Rodaje' });
    expect(res.warnings).toBeUndefined();
  });
});

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

  it('lote: crea y edita en una sola escritura', async () => {
    const { plan } = await upsertTrainingPlan(U, { name: 'P' });
    const { workout } = await upsertPlannedWorkout(U, { plan_id: plan.id, date: '2026-10-20', type: 'Rodaje' });
    const res = await upsertPlannedWorkouts(U, {
      plan_id: plan.id,
      workouts: [
        { date: '2026-10-22', type: 'Series' },
        { date: '2026-10-25', type: 'Tirada larga', distance_km: 20 },
        { workout_id: workout.id, distance_km: 8 },
      ],
    });
    expect(res).toMatchObject({ ok: true, created: 2, updated: 1 });
    expect(saved()[0].workouts.map((w) => w.date)).toEqual(['2026-10-20', '2026-10-22', '2026-10-25']);
    expect(saved()[0].workouts[0].distance_km).toBe(8);
  });

  it('lote: todo o nada, con el índice de cada fallo', async () => {
    const { plan } = await upsertTrainingPlan(U, { name: 'P' });
    const res = await upsertPlannedWorkouts(U, {
      plan_id: plan.id,
      workouts: [{ date: '2026-10-22', type: 'Series' }, { type: 'Sin fecha' }, { date: 'mal', type: 'X' }],
    });
    expect(res.errors.map((e) => e.index)).toEqual([1, 2]);
    expect(saved()[0].workouts).toEqual([]);
    expect((await upsertPlannedWorkouts(U, { plan_id: plan.id, workouts: [] })).error).toBeTruthy();
  });

  it('un status enviado por el MCP queda fijado a mano', async () => {
    const { plan } = await upsertTrainingPlan(U, { name: 'P' });
    const { workout } = await upsertPlannedWorkout(U, { plan_id: plan.id, date: '2026-10-20', type: 'Rodaje' });
    expect(saved()[0].workouts[0].status_manual).toBeUndefined();
    await upsertPlannedWorkout(U, { plan_id: plan.id, workout_id: workout.id, status: 'skipped' });
    expect(saved()[0].workouts[0]).toMatchObject({ status: 'skipped', status_manual: true });
  });

  it('get_training_plan trae lo corrido, el estado automático y las semanas', async () => {
    const V = 'user-actuals';
    store.set(`${V}:stravaData`, JSON.stringify({ activities: [
      { id: 1, type: 'Run', name: 'Rodaje', start_date: '2026-09-22T06:00:00Z', start_date_local: '2026-09-22T08:00:00Z', distance: 10500, moving_time: 3150, average_heartrate: 145 },
    ] }));
    const { plan } = await upsertTrainingPlan(V, { name: 'P' });
    await upsertPlannedWorkouts(V, { plan_id: plan.id, workouts: [
      { date: '2026-09-22', type: 'Rodaje', distance_km: 10 },
      { date: '2026-09-23', type: 'Descanso' },
      { date: '2026-09-24', type: 'Series', distance_km: 8 },
    ] });
    const got = await getTrainingPlan(V, plan.id);
    const [rodaje, descanso, series] = got.workouts;
    expect(rodaje).toMatchObject({ status: 'done', status_auto: true });
    expect(rodaje.actual).toMatchObject({ distance_km: 10.5, moving_time_min: 53, avg_hr: 145, pace: '5:00', activity_id: 1 });
    expect(descanso.actual).toBeNull();
    expect(series).toMatchObject({ status: 'planned', actual: null });
    expect(got.done_count).toBe(1);
    expect(got.weeks[0]).toMatchObject({ week_start: '2026-09-21', planned_km: 18, actual_km: 10.5 });
    // Sin include_workouts el listado no carga actividades ni semanas.
    expect((await listTrainingPlans(V)).plans[0].weeks).toBeUndefined();
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
