// Tests de list_vitals y list_weight: que salgan las mismas métricas que la pantalla
// y que el peso se lea de lo guardado sin depender de Garmin.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  return new Map();
});
const live = vi.hoisted(() => ({ calls: 0, rows: [], fail: false }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const f = {};
      const builder = {
        select: () => builder,
        eq: (col, val) => { f[col] = val; return builder; },
        maybeSingle: async () => ({
          data: store.has(`${f.user_id}:${f.key}`)
            ? { value: JSON.stringify(store.get(`${f.user_id}:${f.key}`)) }
            : null,
          error: null,
        }),
        upsert: async (row) => {
          store.set(`${row.user_id}:${row.key}`, JSON.parse(row.value));
          return { error: null };
        },
      };
      return builder;
    },
  }),
}));

vi.mock('./garmin-session.js', () => ({
  getGarminClientFor: async () => {
    if (live.fail) throw new Error('sin credenciales');
    return {
      client: {
        get: async () => {
          live.calls++;
          return { dailyWeightSummaries: live.rows };
        },
      },
    };
  },
}));

import { getVitals, getStoredWeights, refreshVitalsDerived, VITAL_KEYS } from './mcp-vitals.js';
import { writeKey } from './mcp-store.js';
import { buildVitalMetrics } from '../../src/lib/vitalSeries.js';

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

let n = 0;
let user;
const put = (key, value) => store.set(`${user}:${key}`, value);

beforeEach(() => {
  user = `vitals-${++n}`;
  live.calls = 0;
  live.rows = [];
  live.fail = false;
  put('stravaData', { activities: [] });
});

describe('getVitals', () => {
  it('cubre exactamente las métricas de la pantalla', () => {
    const { metrics } = buildVitalMetrics({ days: 30, gran: 'day', nowMs: Date.now() });
    expect(VITAL_KEYS).toEqual(metrics.map((m) => m.key));
  });

  it('devuelve estrés, respiración y FC nocturna guardados, sin llamar a Garmin', async () => {
    put('garmin_weight_data', [{ date: iso(1), weight_kg: 70.5 }]);
    put('garmin_cardiac_data', [
      { date: iso(2), hrv: 50, restingHR: 52, avgStress: 28, respiration: 15.5, sleepAvgHR: 54 },
      { date: iso(1), hrv: 54, restingHR: 50, avgStress: 32, respiration: 16.5, sleepAvgHR: 52 },
    ]);

    const out = await getVitals(user);
    const last = out.rows.find((r) => r.date === iso(1));

    expect(live.calls).toBe(0);
    expect(out.granularity).toBe('daily');
    expect(last).toMatchObject({ hrv: 54, rhr: 50, stress: 32, respiration: 16.5, sleepHR: 52, weight: 70.5 });
    expect(last.hrv_avg).toBe(52);
    expect(out.metrics.find((m) => m.key === 'stress').latest).toEqual({ date: iso(1), value: 32 });
  });

  it('calcula carga y eficiencia desde las actividades y da CTL sin valor diario aparte', async () => {
    put('garmin_weight_data', []);
    put('garmin_cardiac_data', [{ date: iso(40), restingHR: 50 }]);
    put('stravaData', {
      activities: [{
        id: 1,
        type: 'Run',
        start_date: `${iso(3)}T08:00:00Z`,
        start_date_local: `${iso(3)}T09:00:00Z`,
        distance: 10000,
        moving_time: 3000,
        average_speed: 3.33,
        average_heartrate: 145,
        max_heartrate: 170,
      }],
    });

    const out = await getVitals(user);
    const summary = (key) => out.metrics.find((m) => m.key === key);

    expect(summary('load').days_with_data).toBeGreaterThan(0);
    expect(summary('ctl').days_with_data).toBeGreaterThan(0);
    expect(summary('vo2').days_with_data).toBe(1);
    expect(out.rows.some((r) => 'ctl_avg' in r)).toBe(false);
    expect(out.model.version).toBeTruthy();
  });

  it('filtra por métricas y avisa de las que no tienen datos', async () => {
    put('garmin_weight_data', []);
    put('garmin_cardiac_data', [{ date: iso(1), hrv: 50 }]);

    const out = await getVitals(user, { metrics: ['hrv', 'stress'] });

    expect(out.metrics.map((m) => m.key)).toEqual(['hrv', 'stress']);
    expect(out.no_data).toEqual(['stress']);
    expect(Object.keys(out.rows[0]).sort()).toEqual(['date', 'hrv', 'hrv_avg']);
  });

  it('respeta `to` y pasa a semanal con rangos largos', async () => {
    put('garmin_weight_data', []);
    put('garmin_cardiac_data', [
      { date: iso(300), hrv: 40 },
      { date: iso(10), hrv: 50 },
      { date: iso(1), hrv: 60 },
    ]);

    const acotado = await getVitals(user, { from: iso(20), to: iso(5), metrics: ['hrv'] });
    expect(acotado.rows.map((r) => r.date)).toContain(iso(10));
    expect(acotado.rows.map((r) => r.date)).not.toContain(iso(1));

    const largo = await getVitals(user, { from: iso(320), metrics: ['hrv'] });
    expect(largo.granularity).toBe('weekly');
    expect(largo.rows.length).toBe(3);
  });
});

describe('métricas derivadas guardadas', () => {
  const run = (id, daysAgo) => ({
    id,
    type: 'Run',
    start_date: `${iso(daysAgo)}T08:00:00Z`,
    start_date_local: `${iso(daysAgo)}T09:00:00Z`,
    distance: 10000,
    moving_time: 3000,
    average_speed: 3.33,
    average_heartrate: 145,
    max_heartrate: 170,
  });
  const ctlOf = (out) => out.metrics.find((m) => m.key === 'ctl').latest.value;

  beforeEach(() => {
    put('garmin_weight_data', []);
    put('garmin_cardiac_data', [{ date: iso(1), restingHR: 50 }]);
    put('stravaData', { activities: [run(1, 3)] });
  });

  it('la primera consulta las guarda y las siguientes leen lo guardado', async () => {
    await getVitals(user);
    const saved = store.get(`${user}:vitals_derived`);
    expect(saved.pmc.length).toBeGreaterThan(0);
    expect(saved.vo2).toHaveLength(1);

    const marked = saved.pmc.map((d) => ({ ...d, ctl: 999 }));
    await writeKey(user, 'vitals_derived', { ...saved, pmc: marked });
    expect(ctlOf(await getVitals(user))).toBe(999);
  });

  it('se recalculan si llega una actividad nueva', async () => {
    await getVitals(user);
    const saved = store.get(`${user}:vitals_derived`);
    await writeKey(user, 'vitals_derived', { ...saved, pmc: saved.pmc.map((d) => ({ ...d, ctl: 999 })) });
    await writeKey(user, 'stravaData', { activities: [run(1, 3), run(2, 2)] });

    const out = await getVitals(user);
    expect(ctlOf(out)).not.toBe(999);
    expect(store.get(`${user}:vitals_derived`).vo2).toHaveLength(2);
  });

  it('se recalculan si cambia un override de FC o llega otro día', async () => {
    await getVitals(user);
    const before = store.get(`${user}:vitals_derived`);
    await writeKey(user, 'hr_zone_overrides', { max: '190' });
    await writeKey(user, 'vitals_derived', { ...before, fingerprint: `${iso(1)}|viejo` });

    await getVitals(user);
    expect(store.get(`${user}:vitals_derived`).fingerprint).not.toBe(`${iso(1)}|viejo`);
  });

  it('refreshVitalsDerived las reescribe aunque la huella coincida', async () => {
    await getVitals(user);
    const saved = store.get(`${user}:vitals_derived`);
    await writeKey(user, 'vitals_derived', { ...saved, pmc: [] });

    const out = await refreshVitalsDerived(user);
    expect(out.pmc_days).toBeGreaterThan(0);
    expect(store.get(`${user}:vitals_derived`).pmc.length).toBe(out.pmc_days);
  });

  it('dan lo mismo que la pantalla al calcular desde las actividades', async () => {
    const out = await getVitals(user, { metrics: ['vo2'] });
    const { metrics } = buildVitalMetrics({
      activities: [run(1, 3)],
      days: 30,
      gran: 'day',
      hrmax: out.model.hrmax,
      hrrest: out.model.hrrest,
      nowMs: Date.now(),
    });
    const vo2 = metrics.find((m) => m.key === 'vo2').data.find((d) => d.raw != null).raw;
    expect(out.metrics[0].latest.value).toBe(vo2);
  });
});

describe('getStoredWeights', () => {
  it('lee cualquier rango de lo guardado, sin tope ni llamadas a Garmin', async () => {
    put('garmin_weight_data', [
      { date: iso(400), weight_kg: 72 },
      { date: iso(5), weight_kg: 70 },
    ]);

    const out = await getStoredWeights(user, { from: iso(500) });

    expect(live.calls).toBe(0);
    expect(out.weights.map((w) => w.weight_kg)).toEqual([70, 72]);
    expect(out.last_weigh_in).toBe(iso(5));
  });

  it('si no hay nada guardado, trae el histórico una vez y lo guarda', async () => {
    live.rows = [{ summaryDate: iso(2), latestWeight: { weight: 70500 } }];

    const first = await getStoredWeights(user);
    const second = await getStoredWeights(user);

    expect(first.weights[0].weight_kg).toBe(70.5);
    expect(second.weights[0].weight_kg).toBe(70.5);
    expect(live.calls).toBe(1);
  });

  it('sin credenciales de Garmin responde vacío en vez de fallar', async () => {
    live.fail = true;
    const out = await getStoredWeights(user);
    expect(out.count).toBe(0);
    expect(out.note).toMatch(/Sin pesadas/);
  });
});
