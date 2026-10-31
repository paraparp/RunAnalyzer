// Tests del histórico de lesiones desde el MCP: que cerrar una lesión conserve su
// inicio, que editar no pise otros campos y que lo guardado sea lo que lee la app.
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

const { listInjuries, upsertInjury, removeInjury } = await import('./mcp-injuries.js');

// Un usuario por test: las lecturas de mcp-store se cachean por usuario y clave.
let U;
let n = 0;
beforeEach(() => { store.clear(); U = `user-${++n}`; });

describe('upsertInjury', () => {
  it('crea un episodio activo y cerrarlo conserva el resto', async () => {
    const { saved } = await upsertInjury(U, {
      zone: 'knee', side: 'L', title: 'Tendón posterolateral', start_date: '2026-10-18', note: 'Visto por el fisio',
    });
    expect(saved).toMatchObject({ active: true, end_date: null });

    const closed = await upsertInjury(U, { id: saved.id, end_date: '2026-10-25' });
    expect(closed.saved).toMatchObject({
      start_date: '2026-10-18', end_date: '2026-10-25', active: false, days: 8,
      title: 'Tendón posterolateral', note: 'Visto por el fisio',
    });
    expect(store.get(`${U}:injury_log`)).toHaveLength(1);
  });

  it('end_date null reabre una lesión', async () => {
    const { saved } = await upsertInjury(U, { zone: 'calf', side: 'L', start_date: '2026-10-01', end_date: '2026-10-05' });
    const res = await upsertInjury(U, { id: saved.id, end_date: null });
    expect(res.saved.active).toBe(true);
  });

  it('un id desconocido da error y no escribe', async () => {
    expect((await upsertInjury(U, { id: 'nope', end_date: '2026-10-25' })).error).toMatch(/No existe/);
    expect(store.has(`${U}:injury_log`)).toBe(false);
  });

  it('rechaza un fin anterior al inicio', async () => {
    await expect(upsertInjury(U, { zone: 'knee', start_date: '2026-10-18', end_date: '2026-10-01' })).rejects.toThrow(/anterior/);
  });
});

describe('listInjuries', () => {
  it('filtra por estado y cuenta el total', async () => {
    await upsertInjury(U, { zone: 'knee', start_date: '2026-01-01', end_date: '2026-02-01' });
    const { saved } = await upsertInjury(U, { zone: 'calf', start_date: '2026-10-28' });
    const active = await listInjuries(U, { status: 'active' });
    expect(active).toMatchObject({ total: 2, active: 1 });
    expect(active.injuries.map((i) => i.id)).toEqual([saved.id]);
  });
});

describe('removeInjury', () => {
  it('borra el episodio y avisa si no existe', async () => {
    const { saved } = await upsertInjury(U, { zone: 'knee', start_date: '2026-01-01' });
    expect(await removeInjury(U, saved.id)).toEqual({ deleted: saved.id });
    expect((await removeInjury(U, saved.id)).error).toMatch(/No existe/);
  });
});
