import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// cloudStorage arrastra a Supabase; aquí solo interesa el contrato getItem/setItem.
const { store } = vi.hoisted(() => ({ store: new Map() }));
vi.mock('./cloudStorage', () => ({
  default: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  },
}));

import {
  readStoredGarminActivities, enrichedGarminIds, syncGarminActivities,
} from './garminActivitiesSync';

const KEY = 'garmin_activities';
const put = (arr) => store.set(KEY, JSON.stringify(arr));
const read = () => JSON.parse(store.get(KEY));

const act = (o) => ({
  garmin_id: 1,
  start_time: '2026-05-10T08:00:00Z',
  distance_m: 10000,
  ...o,
});

/** Respuesta de /api/garmin/activities. */
const ok = (activities) => ({ ok: true, json: async () => ({ activities }) });

beforeEach(() => {
  store.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  globalThis.fetch = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('readStoredGarminActivities', () => {
  it('devuelve [] cuando no hay nada guardado', () => {
    expect(readStoredGarminActivities()).toEqual([]);
  });

  it('devuelve [] si el JSON está corrupto en vez de propagar el error', () => {
    store.set(KEY, '{no es json');
    expect(readStoredGarminActivities()).toEqual([]);
  });

  it('devuelve [] si lo guardado no es un array', () => {
    store.set(KEY, '{"garmin_id":1}');
    expect(readStoredGarminActivities()).toEqual([]);
  });

  it('devuelve el array guardado', () => {
    put([act({ garmin_id: 7 })]);
    expect(readStoredGarminActivities()).toHaveLength(1);
    expect(readStoredGarminActivities()[0].garmin_id).toBe(7);
  });
});

describe('enrichedGarminIds', () => {
  it('solo las que ya tienen hr_source, como strings', () => {
    const ids = enrichedGarminIds([
      act({ garmin_id: 1, hr_source: 'strap' }),
      act({ garmin_id: 2 }),
      act({ garmin_id: 3, hr_source: 'unknown' }),
    ]);
    expect(ids).toEqual(['1', '3']);
  });

  it('hr_source null cuenta como NO enriquecida', () => {
    expect(enrichedGarminIds([act({ garmin_id: 1, hr_source: null })])).toEqual([]);
  });

  it('tolera huecos en el array', () => {
    expect(enrichedGarminIds([null, undefined, act({ garmin_id: 4, hr_source: 'wrist' })])).toEqual(['4']);
  });
});

describe('syncGarminActivities · nunca destruye el histórico', () => {
  it('si la red falla devuelve null y deja lo guardado intacto', async () => {
    put([act({ garmin_id: 1, hr_source: 'strap' })]);
    globalThis.fetch.mockRejectedValue(new Error('ECONNRESET'));

    expect(await syncGarminActivities('u', 'p')).toBeNull();
    expect(read()).toHaveLength(1);
  });

  it('si el servidor responde error devuelve null y no escribe', async () => {
    put([act({ garmin_id: 1 })]);
    globalThis.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'credenciales' }) });

    expect(await syncGarminActivities('u', 'p')).toBeNull();
    expect(read()).toHaveLength(1);
  });

  it('si la respuesta no trae array de actividades devuelve null', async () => {
    put([act({ garmin_id: 1 })]);
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    expect(await syncGarminActivities('u', 'p')).toBeNull();
    expect(read()).toHaveLength(1);
  });

  it('una lista VACÍA con histórico guardado es sospechosa: se conserva todo', async () => {
    put([act({ garmin_id: 1, hr_source: 'strap' })]);
    globalThis.fetch.mockResolvedValue(ok([]));

    const res = await syncGarminActivities('u', 'p');
    expect(res).toHaveLength(1);
    expect(read()).toHaveLength(1);
  });

  it('una lista vacía SIN histórico sí se acepta (primer sync sin actividades)', async () => {
    globalThis.fetch.mockResolvedValue(ok([]));
    expect(await syncGarminActivities('u', 'p')).toEqual([]);
  });
});

describe('syncGarminActivities · mezcla en vez de reemplazar', () => {
  it('conserva el enriquecido previo que esta pasada no trae', async () => {
    put([act({
      garmin_id: 1,
      hr_source: 'strap',
      laps: [{ km: 1 }],
      weather: { temp: 18 },
      data_quality: 'ok',
      gap_speed_ms: 3.1,
      dynamics: { cadence: 180, vertical_oscillation: 8.2 },
    })]);
    // La nueva pasada trae la actividad "pelada", como hace Garmin salvo en las
    // pocas que enriquece por sync.
    globalThis.fetch.mockResolvedValue(ok([act({ garmin_id: 1, distance_m: 10500 })]));

    const [merged] = await syncGarminActivities('u', 'p');
    expect(merged.distance_m).toBe(10500);          // la nueva manda en lo base
    expect(merged.hr_source).toBe('strap');          // el enriquecido sobrevive
    expect(merged.laps).toEqual([{ km: 1 }]);
    expect(merged.weather).toEqual({ temp: 18 });
    expect(merged.data_quality).toBe('ok');
    expect(merged.gap_speed_ms).toBe(3.1);
    expect(merged.dynamics).toEqual({ cadence: 180, vertical_oscillation: 8.2 });
  });

  it('el enriquecido NUEVO sí pisa al viejo', async () => {
    put([act({ garmin_id: 1, hr_source: 'wrist', dynamics: { cadence: 170 } })]);
    globalThis.fetch.mockResolvedValue(ok([
      act({ garmin_id: 1, hr_source: 'strap', dynamics: { cadence: 182 } }),
    ]));

    const [merged] = await syncGarminActivities('u', 'p');
    expect(merged.hr_source).toBe('strap');
    expect(merged.dynamics.cadence).toBe(182);
  });

  it('fusiona dynamics campo a campo, no bloque contra bloque', async () => {
    put([act({ garmin_id: 1, dynamics: { cadence: 180, ground_contact: 240 } })]);
    globalThis.fetch.mockResolvedValue(ok([
      act({ garmin_id: 1, dynamics: { vertical_ratio: 7.1, ground_contact: null } }),
    ]));

    const [merged] = await syncGarminActivities('u', 'p');
    expect(merged.dynamics).toEqual({ cadence: 180, ground_contact: 240, vertical_ratio: 7.1 });
  });

  it('añade las nuevas y mantiene las viejas que no vienen en la respuesta', async () => {
    put([
      act({ garmin_id: 1, start_time: '2026-05-01T08:00:00Z' }),
      act({ garmin_id: 2, start_time: '2026-05-05T08:00:00Z' }),
    ]);
    globalThis.fetch.mockResolvedValue(ok([act({ garmin_id: 3, start_time: '2026-05-09T08:00:00Z' })]));

    const merged = await syncGarminActivities('u', 'p');
    expect(merged.map((a) => a.garmin_id)).toEqual([3, 2, 1]); // más reciente primero
    expect(read()).toHaveLength(3);
  });

  it('empareja por id aunque el tipo difiera (string vs number)', async () => {
    put([act({ garmin_id: '1', hr_source: 'strap' })]);
    globalThis.fetch.mockResolvedValue(ok([act({ garmin_id: 1, distance_m: 12000 })]));

    const merged = await syncGarminActivities('u', 'p');
    expect(merged).toHaveLength(1);
    expect(merged[0].distance_m).toBe(12000);
    expect(merged[0].hr_source).toBe('strap');
  });

  it('persiste el resultado en cloudStorage', async () => {
    globalThis.fetch.mockResolvedValue(ok([act({ garmin_id: 9 })]));
    await syncGarminActivities('u', 'p');
    expect(read()[0].garmin_id).toBe(9);
  });
});

describe('syncGarminActivities · petición', () => {
  it('manda credenciales, límite y los ids ya enriquecidos', async () => {
    put([act({ garmin_id: 1, hr_source: 'strap' }), act({ garmin_id: 2 })]);
    globalThis.fetch.mockResolvedValue(ok([act({ garmin_id: 1 })]));

    await syncGarminActivities('usuario', 'clave', { limit: 50 });

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('/api/garmin/activities');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      username: 'usuario',
      password: 'clave',
      limit: 50,
      enrichedIds: ['1'],
    });
  });

  it('el límite por defecto es 200', async () => {
    globalThis.fetch.mockResolvedValue(ok([]));
    await syncGarminActivities('u', 'p');
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).limit).toBe(200);
  });
});
