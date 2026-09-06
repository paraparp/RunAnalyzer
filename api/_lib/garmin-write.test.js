// Tests de garmin-write: el único módulo de `api/_lib` que ESCRIBE en la cuenta del
// atleta. Lo que se fija aquí es el contrato que nadie más puede verificar: la
// traducción de la spec de alto nivel al JSON del workout-service (enums, unidades y
// el ida y vuelta ritmo↔velocidad), y qué se le manda a Garmin en cada operación.
// El cliente de Garmin se sustituye por un doble que registra las llamadas.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls = vi.hoisted(() => []);
const fake = vi.hoisted(() => ({
  addWorkout: null, getWorkoutDetail: null, getWorkouts: null, deleteWorkout: null,
  post: null, put: null,
}));

vi.mock('./garmin-session.js', () => ({
  getGarminClientFor: async (userId) => {
    calls.push(['session', userId]);
    return {
      addWorkout: async (json) => { calls.push(['addWorkout', json]); return fake.addWorkout?.(json); },
      getWorkoutDetail: async (a) => { calls.push(['getWorkoutDetail', a]); return fake.getWorkoutDetail?.(a); },
      getWorkouts: async (start, limit) => { calls.push(['getWorkouts', start, limit]); return fake.getWorkouts?.(start, limit); },
      deleteWorkout: async (a) => { calls.push(['deleteWorkout', a]); return fake.deleteWorkout?.(a); },
      client: {
        post: async (url, body) => { calls.push(['post', url, body]); return fake.post?.(url, body); },
        put: async (url, body) => { calls.push(['put', url, body]); return fake.put?.(url, body); },
      },
    };
  },
}));

const {
  buildRunningWorkout, createWorkout, scheduleWorkout, updateWorkout,
  getWorkout, deleteWorkout, listWorkouts,
} = await import('./garmin-write.js');

const last = (name) => [...calls].reverse().find((c) => c[0] === name);
const steps = (json) => json.workoutSegments[0].workoutSteps;

beforeEach(() => {
  calls.length = 0;
  fake.addWorkout = () => ({ workoutId: 777 });
  fake.getWorkoutDetail = null; fake.getWorkouts = null;
  fake.deleteWorkout = null; fake.post = null; fake.put = null;
});

describe('buildRunningWorkout', () => {
  it('exige name y al menos un step', () => {
    expect(() => buildRunningWorkout({ steps: [{ kind: 'interval' }] })).toThrow(/name/);
    expect(() => buildRunningWorkout({ name: 'X' })).toThrow(/steps/);
    expect(() => buildRunningWorkout({ name: 'X', steps: [] })).toThrow(/steps/);
  });

  it('numera los stepId desde 1 en CADA build (no hay contador global compartido)', () => {
    const spec = { name: 'A', steps: [{ kind: 'warmup' }, { kind: 'interval' }] };
    const a = steps(buildRunningWorkout(spec)).map((s) => s.stepId);
    const b = steps(buildRunningWorkout(spec)).map((s) => s.stepId);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([1, 2]); // dos builds concurrentes no se pisan los ids
  });

  it('guarda la distancia en metros pero la muestra en km', () => {
    const [km, m] = steps(buildRunningWorkout({
      name: 'A',
      steps: [
        { kind: 'interval', duration: { type: 'distance', value: 5, unit: 'km' } },
        { kind: 'interval', duration: { type: 'distance', value: 400, unit: 'm' } },
      ],
    }));
    expect(km.endConditionValue).toBe(5000);
    expect(km.preferredEndConditionUnit).toEqual({ unitKey: 'kilometer' });
    expect(m.endConditionValue).toBe(400);
    expect(km.endCondition).toEqual({ conditionTypeId: 3, conditionTypeKey: 'distance' });
  });

  it('convierte los minutos a segundos y deja lap.button sin valor', () => {
    const [min, seg, lap] = steps(buildRunningWorkout({
      name: 'A',
      steps: [
        { kind: 'interval', duration: { type: 'time', value: 3, unit: 'min' } },
        { kind: 'recovery', duration: { type: 'time', value: 90, unit: 's' } },
        { kind: 'cooldown' },
      ],
    }));
    expect(min.endConditionValue).toBe(180);
    expect(seg.endConditionValue).toBe(90);
    expect(lap.endCondition).toEqual({ conditionTypeId: 1, conditionTypeKey: 'lap.button' });
    expect(lap.endConditionValue).toBeNull();
  });

  it('traduce el ritmo min/km a velocidad m/s y ordena one <= two', () => {
    const [s] = steps(buildRunningWorkout({
      name: 'A',
      steps: [{ kind: 'interval', duration: { type: 'distance', value: 1, unit: 'km' }, target: { type: 'pace', low: 4, high: 4.5 } }],
    }));
    expect(s.targetType).toEqual({ workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' });
    // 4:00/km = 4.1667 m/s (rápido) y 4:30/km = 3.7037 m/s (lento): Garmin quiere el menor primero.
    expect(s.targetValueOne).toBeCloseTo(3.7037, 4);
    expect(s.targetValueTwo).toBeCloseTo(4.1667, 4);
  });

  it('mapea heart.rate a heart.rate.zone (sufijar ".zone" daría un tipo inexistente)', () => {
    const [hr, alias, pw] = steps(buildRunningWorkout({
      name: 'A',
      steps: [
        { kind: 'interval', target: { type: 'heart.rate', low: 150, high: 165 } },
        { kind: 'interval', target: { type: 'hr', low: 150, high: 165 } },
        { kind: 'interval', target: { type: 'power', low: 250, high: 300 } },
      ],
    }));
    expect(hr.targetType).toEqual({ workoutTargetTypeId: 4, workoutTargetTypeKey: 'heart.rate.zone' });
    expect(hr.targetValueOne).toBe(150);
    expect(hr.targetValueTwo).toBe(165);
    expect(alias.targetType.workoutTargetTypeKey).toBe('heart.rate.zone');
    expect(pw.targetType).toEqual({ workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone' });
  });

  it('sin target declarado deja no.target y los valores a null', () => {
    const [s] = steps(buildRunningWorkout({ name: 'A', steps: [{ kind: 'warmup' }] }));
    expect(s.targetType).toEqual({ workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' });
    expect(s.targetValueOne).toBeNull();
    expect(s.targetValueTwo).toBeNull();
    expect(s.zoneNumber).toBeNull();
  });

  it('anida los hijos de un repeat y les da su propio stepOrder', () => {
    const [wu, rep] = steps(buildRunningWorkout({
      name: 'Series',
      steps: [
        { kind: 'warmup', duration: { type: 'time', value: 10, unit: 'min' } },
        {
          kind: 'repeat',
          repeats: 4,
          steps: [
            { kind: 'interval', duration: { type: 'distance', value: 400, unit: 'm' } },
            { kind: 'recovery', duration: { type: 'time', value: 90, unit: 's' } },
          ],
        },
      ],
    }));
    expect(wu.stepOrder).toBe(1);
    expect(rep.type).toBe('RepeatGroupDTO');
    expect(rep.stepOrder).toBe(2);
    expect(rep.numberOfIterations).toBe(4);
    expect(rep.endConditionValue).toBe(4);
    expect(rep.workoutSteps.map((s) => s.stepOrder)).toEqual([1, 2]);
    // Los hijos se numeran antes que el grupo: ids únicos dentro del build.
    expect(new Set([rep.stepId, ...rep.workoutSteps.map((s) => s.stepId)]).size).toBe(3);
  });
});

describe('createWorkout', () => {
  const spec = { name: 'Series', steps: [{ kind: 'interval', duration: { type: 'distance', value: 1, unit: 'km' } }] };

  it('crea y devuelve el id sin agendar cuando no hay date', async () => {
    const out = await createWorkout('u1', spec);
    expect(out).toEqual({ created: true, workout_id: 777, name: 'Series' });
    expect(last('post')).toBeUndefined();
  });

  it('agenda en el acto cuando la spec trae date', async () => {
    const out = await createWorkout('u1', { ...spec, date: '2026-09-10' });
    expect(out.scheduled).toBe(true);
    expect(out.date).toBe('2026-09-10');
    expect(last('post')).toEqual(['post', 'https://connectapi.garmin.com/workout-service/schedule/777', { date: '2026-09-10' }]);
  });

  it('rechaza una date mal formada sin llegar a llamar a Garmin', async () => {
    const out = await createWorkout('u1', { ...spec, date: '10/09/2026' });
    expect(out.created).toBe(true);
    expect(out.scheduled).toBe(false);
    expect(out.schedule_error).toMatch(/YYYY-MM-DD/);
    expect(last('post')).toBeUndefined();
  });

  it('un fallo al agendar no invalida la creación', async () => {
    fake.post = () => { throw new Error('boom'); };
    const out = await createWorkout('u1', { ...spec, date: '2026-09-10' });
    expect(out.created).toBe(true);
    expect(out.workout_id).toBe(777);
    expect(out).toMatchObject({ scheduled: false, schedule_error: 'boom' });
  });

  it('no intenta agendar si Garmin no devolvió workoutId', async () => {
    fake.addWorkout = () => ({});
    const out = await createWorkout('u1', { ...spec, date: '2026-09-10' });
    expect(out.workout_id).toBeNull();
    expect(last('post')).toBeUndefined();
  });
});

describe('scheduleWorkout', () => {
  it('exige workout_id y fecha ISO antes de tocar la cuenta', async () => {
    await expect(scheduleWorkout('u1', null, '2026-09-10')).rejects.toThrow(/workout_id/);
    await expect(scheduleWorkout('u1', 5, '10-09-2026')).rejects.toThrow(/YYYY-MM-DD/);
    expect(last('session')).toBeUndefined();
  });

  it('agenda y devuelve el schedule_id', async () => {
    fake.post = () => ({ workoutScheduleId: 42 });
    expect(await scheduleWorkout('u1', 5, '2026-09-10')).toEqual({
      scheduled: true, workout_id: 5, date: '2026-09-10', schedule_id: 42,
    });
  });
});

describe('updateWorkout / deleteWorkout', () => {
  it('el update manda el id DENTRO del cuerpo además de en la URL', async () => {
    const out = await updateWorkout('u1', 9, { name: 'Nuevo', steps: [{ kind: 'warmup' }] });
    const [, url, body] = last('put');
    expect(url).toBe('https://connectapi.garmin.com/workout-service/workout/9');
    expect(body.workoutId).toBe(9);
    expect(body.workoutName).toBe('Nuevo');
    expect(out).toEqual({ updated: true, workout_id: 9, name: 'Nuevo' });
  });

  it('no borra ni actualiza sin workout_id', async () => {
    await expect(updateWorkout('u1', null, { name: 'X', steps: [{ kind: 'warmup' }] })).rejects.toThrow(/workout_id/);
    await expect(deleteWorkout('u1', null)).rejects.toThrow(/workout_id/);
    expect(last('session')).toBeUndefined();
  });

  it('borra por id', async () => {
    expect(await deleteWorkout('u1', 9)).toEqual({ deleted: true, workout_id: 9 });
    expect(last('deleteWorkout')).toEqual(['deleteWorkout', { workoutId: 9 }]);
  });
});

describe('getWorkout', () => {
  it('falla si Garmin no devuelve el entreno', async () => {
    fake.getWorkoutDetail = () => null;
    await expect(getWorkout('u1', 9)).rejects.toThrow(/no encontrado/);
  });

  it('decodifica un entreno de vuelta a la spec de alto nivel (ida y vuelta)', async () => {
    const spec = {
      name: 'Series',
      description: 'test',
      steps: [
        { kind: 'warmup', duration: { type: 'time', value: 10, unit: 'min' } },
        {
          kind: 'repeat',
          repeats: 4,
          steps: [
            { kind: 'interval', duration: { type: 'distance', value: 400, unit: 'm' }, target: { type: 'pace', low: 4, high: 4.5 } },
            { kind: 'recovery', duration: { type: 'time', value: 90, unit: 's' }, target: { type: 'heart.rate', low: 120, high: 140 } },
          ],
        },
        { kind: 'cooldown' },
      ],
    };
    fake.getWorkoutDetail = () => ({ ...buildRunningWorkout(spec), workoutId: 9 });
    const out = await getWorkout('u1', 9);
    expect(out.workout_id).toBe(9);
    expect(out.name).toBe('Series');
    expect(out.sport).toBe('running');
    expect(out.steps[0]).toEqual({ kind: 'warmup', duration: { type: 'time', value: 10, unit: 'min' }, target: { type: 'no.target' } });
    expect(out.steps[1].kind).toBe('repeat');
    expect(out.steps[1].repeats).toBe(4);
    const [serie, trote] = out.steps[1].steps;
    expect(serie.duration).toEqual({ type: 'distance', value: 400, unit: 'm' });
    // El ritmo vuelve en min/km y en el mismo orden que se pidió (lento = número mayor).
    expect(serie.target).toEqual({ type: 'pace', low: 4, high: 4.5, zone: null });
    expect(trote.target).toEqual({ type: 'heart.rate', low: 120, high: 140, zone: null });
    expect(out.steps[2].duration).toEqual({ type: 'lap.button' });
  });

  it('devuelve la distancia en km cuando es múltiplo de 1000', async () => {
    fake.getWorkoutDetail = () => ({
      ...buildRunningWorkout({ name: 'A', steps: [{ kind: 'interval', duration: { type: 'distance', value: 5, unit: 'km' } }] }),
      workoutId: 9,
    });
    const out = await getWorkout('u1', 9);
    expect(out.steps[0].duration).toEqual({ type: 'distance', value: 5, unit: 'km' });
  });
});

describe('listWorkouts', () => {
  const row = (id) => ({ workoutId: id, workoutName: `W${id}`, sportType: { sportTypeKey: 'running' }, updateDate: '2026-09-01' });

  it('acota el limit al rango [1, 100] que acepta Garmin', async () => {
    fake.getWorkouts = () => [];
    await listWorkouts('u1', { limit: 500 });
    expect(last('getWorkouts')).toEqual(['getWorkouts', 0, 100]);
    await listWorkouts('u1', { limit: 0 });
    expect(last('getWorkouts')).toEqual(['getWorkouts', 0, 1]);
    await listWorkouts('u1');
    expect(last('getWorkouts')).toEqual(['getWorkouts', 0, 20]);
  });

  it('proyecta las filas al shape del MCP', async () => {
    fake.getWorkouts = () => [row(1), row(2)];
    expect(await listWorkouts('u1')).toEqual({
      count: 2,
      workouts: [
        { workout_id: 1, name: 'W1', sport: 'running', updated: '2026-09-01' },
        { workout_id: 2, name: 'W2', sport: 'running', updated: '2026-09-01' },
      ],
    });
  });

  it('traduce el 427 a un mensaje accionable, se lance o venga en el cuerpo', async () => {
    fake.getWorkouts = () => { throw new Error('Request failed with status code 427'); };
    await expect(listWorkouts('u1')).rejects.toThrow(/rate-limit 427/);

    fake.getWorkouts = () => ({ error: { 'status-code': '427' } });
    await expect(listWorkouts('u1')).rejects.toThrow(/rate-limit 427/);
  });

  it('no confunde otro error del cuerpo con una lista vacía', async () => {
    fake.getWorkouts = () => ({ error: { 'status-code': '500' } });
    await expect(listWorkouts('u1')).rejects.toThrow(/error al listar entrenos \(500\)/);
  });

  it('propaga cualquier otro fallo con contexto', async () => {
    fake.getWorkouts = () => { throw new Error('ECONNRESET'); };
    await expect(listWorkouts('u1')).rejects.toThrow(/No se pudieron listar los entrenos de Garmin: ECONNRESET/);
  });
});
