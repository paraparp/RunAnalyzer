// Tests del diario desde el MCP: que anotar por partes fusione sin perder lo que
// ya había (incluido lo que guardó la app), que se rechacen zonas y lados
// ambiguos, y que el estado subjetivo salga con las alertas de la última semana.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  return new Map(); // `${userId}:${key}` -> valor ya parseado
});

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

const { logWellness, getWellnessDiary, getWellnessStatus } = await import('./mcp-wellness.js');
const { dayKey } = await import('../../src/lib/trainingLoad.js');

const U = 'user-1';
const raw = () => store.get(`${U}:wellness_diary`) || [];
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };
beforeEach(() => store.clear());

describe('logWellness', () => {
  it('fusiona con lo anotado ese día sin borrar campos no enviados', async () => {
    // Entrada que guardó la app: rodilla y ánimo.
    store.set(`${U}:wellness_diary`, [{ date: daysAgo(0), pains: [{ zone: 'knee', side: 'R', level: 3 }], rpe: null, mood: 4, stress: null, note: null }]);
    await logWellness(U, { pains: [{ zone: 'achilles', side: 'L', level: 5 }], rpe: 7 });
    const [e] = raw();
    expect(e.pains).toHaveLength(2);
    expect(e.mood).toBe(4);
    expect(e.rpe).toBe(7);
  });

  it('remove borra la anotación y una entrada vacía se borra', async () => {
    await logWellness(U, { pains: [{ zone: 'knee', side: 'R', level: 4 }] });
    const res = await logWellness(U, { pains: [{ zone: 'knee', side: 'R', remove: true }] });
    expect(res.deleted).toBe(true);
    expect(raw()).toHaveLength(0);
  });

  it('level 0 guarda "ya no duele" y actualiza el semáforo', async () => {
    await logWellness(U, { date: daysAgo(3), pains: [{ zone: 'calf', side: 'L', level: 3 }] });
    const res = await logWellness(U, { pains: [{ zone: 'calf', side: 'L', level: 0 }] });
    expect(res.deleted).toBe(false);
    expect(res.saved.pains).toEqual([{ zone: 'calf', side: 'L', level: 0 }]);
    expect(res.status.signals[0]).toMatchObject({ zone: 'calf', last: 0, signal: 'ok' });
  });

  it('rechaza una molestia sin level ni remove', async () => {
    await expect(logWellness(U, { pains: [{ zone: 'calf', side: 'L' }] })).rejects.toThrow(/necesita level/);
  });

  it('replace sustituye la entrada entera', async () => {
    await logWellness(U, { pains: [{ zone: 'knee', side: 'R', level: 4 }], mood: 2 });
    await logWellness(U, { replace: true, rpe: 5 });
    const [e] = raw();
    expect(e.pains).toEqual([]);
    expect(e.mood).toBeNull();
    expect(e.rpe).toBe(5);
  });

  it('rechaza zonas desconocidas y bilaterales sin lado', async () => {
    await expect(logWellness(U, { pains: [{ zone: 'elbow', level: 3 }] })).rejects.toThrow(/Zona desconocida/);
    await expect(logWellness(U, { pains: [{ zone: 'knee', level: 3 }] })).rejects.toThrow(/side L o R/);
    expect(raw()).toHaveLength(0);
  });

  it('lumbar no lleva lado', async () => {
    const res = await logWellness(U, { pains: [{ zone: 'lower_back', level: 3 }] });
    expect(res.saved.pains[0].side).toBe('C');
  });
});

describe('estado subjetivo', () => {
  it('alerta con dolor ≥ 6 reciente y la incluye en get_wellness_diary', async () => {
    await logWellness(U, { date: daysAgo(1), pains: [{ zone: 'achilles', side: 'L', level: 6 }] });
    const res = await getWellnessDiary(U);
    expect(res.entries).toHaveLength(1);
    expect(res.status.signals[0]).toMatchObject({ zone: 'achilles', signal: 'alert' });
    expect(res.status.recommendations.length).toBeGreaterThan(0);
  });

  it('el rango excluye entradas antiguas y el estado es null sin anotaciones recientes', async () => {
    await logWellness(U, { date: daysAgo(40), mood: 3 });
    const res = await getWellnessDiary(U);
    expect(res.total_entries).toBe(1);
    expect(res.entries).toHaveLength(0);
    expect(res.status).toBeNull();
    expect(await getWellnessStatus(U)).toBeNull();
  });
});
