// Tests del buzón de incidencias: lo que un LLM no puede verificar al usarlo —
// que reportar dos veces lo mismo no duplique, que el merge parcial no borre
// campos, y que el blob no crezca sin límite tirando primero lo ya cerrado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  return new Map(); // `${userId}:${key}` -> valor ya parseado
});

// Mock mínimo de Supabase con soporte de upsert (el de mcp-store.test solo lee).
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

const { reportIssue, listIssues, deleteIssue } = await import('./mcp-feedback.js');

const U = 'user-1';
const raw = () => store.get(`${U}:agent_feedback`) || [];
beforeEach(() => store.clear());

describe('reportIssue: validacion', () => {
  it('exige title al crear', async () => {
    expect(await reportIssue(U, { detail: 'algo' })).toHaveProperty('error');
  });

  it('rechaza enums fuera de rango', async () => {
    expect(await reportIssue(U, { title: 'x', category: 'bug' }).then((r) => r.error)).toMatch(/category/);
    expect(await reportIssue(U, { title: 'x', severity: 'critical' }).then((r) => r.error)).toMatch(/severity/);
    expect(await reportIssue(U, { title: 'x', status: 'cerrada' }).then((r) => r.error)).toMatch(/status/);
  });

  it('falla si el issue_id no existe', async () => {
    expect(await reportIssue(U, { issue_id: 'nope', title: 'x' })).toHaveProperty('error');
  });

  it('aplica defaults: open / medium / other', async () => {
    const r = await reportIssue(U, { title: 'GAP raro' });
    expect(r.created).toBe(true);
    expect(r.issue).toMatchObject({ status: 'open', severity: 'medium', category: 'other', occurrences: 1 });
  });
});

describe('reportIssue: deduplicado por titulo', () => {
  it('suma ocurrencia en vez de duplicar y acumula el detalle', async () => {
    await reportIssue(U, { title: 'critical_speed da D negativo', detail: 'con 2 puntos' });
    const second = await reportIssue(U, { title: '  CRITICAL_SPEED da D NEGATIVO ', detail: 'tambien con 3' });
    expect(second.deduped).toBe(true);
    expect(second.created).toBe(false);
    expect(second.issue.occurrences).toBe(2);
    expect(second.issue.detail).toContain('con 2 puntos');
    expect(second.issue.detail).toContain('tambien con 3');
    expect(raw()).toHaveLength(1);
  });

  it('no deduplica contra una ya cerrada: vuelve a abrirse como nueva', async () => {
    const first = await reportIssue(U, { title: 'sueno incompleto' });
    await reportIssue(U, { issue_id: first.issue.id, status: 'resolved' });
    const again = await reportIssue(U, { title: 'sueno incompleto' });
    expect(again.created).toBe(true);
    expect(raw()).toHaveLength(2);
  });
});

describe('reportIssue: actualizacion parcial', () => {
  it('cambia el status sin perder titulo, detalle ni categoria', async () => {
    const created = await reportIssue(U, {
      title: 'time_in_zones ignora hr_max',
      detail: 'devuelve Z5 al 100%',
      category: 'tool',
      severity: 'high',
      tool: 'time_in_zones',
    });
    const closed = await reportIssue(U, { issue_id: created.issue.id, status: 'resolved', note: 'arreglado en v1.2' });
    expect(closed.issue).toMatchObject({
      title: 'time_in_zones ignora hr_max',
      detail: 'devuelve Z5 al 100%',
      category: 'tool',
      severity: 'high',
      tool: 'time_in_zones',
      status: 'resolved',
      note: 'arreglado en v1.2',
    });
    // Actualizar no es "verlo otra vez": no infla el contador.
    expect(closed.issue.occurrences).toBe(1);
    expect(closed.total_open).toBe(0);
  });
});

describe('listIssues', () => {
  it('por defecto solo abiertas, sin detalle y ordenadas por severidad', async () => {
    await reportIssue(U, { title: 'baja', severity: 'low', detail: 'texto largo' });
    await reportIssue(U, { title: 'alta', severity: 'high', detail: 'texto largo' });
    const closed = await reportIssue(U, { title: 'ya vista', severity: 'high' });
    await reportIssue(U, { issue_id: closed.issue.id, status: 'wontfix' });

    const res = await listIssues(U);
    expect(res.issues.map((i) => i.title)).toEqual(['alta', 'baja']);
    expect(res.issues[0]).not.toHaveProperty('detail');
    expect(res.total_stored).toBe(3);
    expect(res.open).toBe(2);
  });

  it('include_closed e include_detail abren el resto', async () => {
    const c = await reportIssue(U, { title: 'cerrada', detail: 'por que' });
    await reportIssue(U, { issue_id: c.issue.id, status: 'resolved' });
    const res = await listIssues(U, { include_closed: true, include_detail: true });
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].detail).toBe('por que');
  });

  it('filtra por categoria y respeta el tope de limit', async () => {
    await reportIssue(U, { title: 'a', category: 'data' });
    await reportIssue(U, { title: 'b', category: 'idea' });
    expect((await listIssues(U, { category: 'idea' })).issues.map((i) => i.title)).toEqual(['b']);
    expect((await listIssues(U, { limit: 1 })).issues).toHaveLength(1);
  });

  it('sin nada guardado devuelve una lista vacia, no un error', async () => {
    expect(await listIssues(U)).toMatchObject({ total: 0, open: 0, issues: [] });
  });
});

describe('prune: tope del blob', () => {
  it('tira primero las cerradas mas antiguas', async () => {
    // 300 = MAX_ENTRIES. Se siembra directo para no pagar 301 escrituras.
    const seed = Array.from({ length: 300 }, (_, i) => ({
      id: `id-${i}`,
      title: `t-${i}`,
      status: i < 5 ? 'resolved' : 'open',
      severity: 'medium',
      category: 'other',
      created_at: new Date(2024, 0, 1, 0, i).toISOString(),
    }));
    store.set(`${U}:agent_feedback`, seed);

    await reportIssue(U, { title: 'la nueva' });
    const ids = raw().map((e) => e.id);
    expect(raw()).toHaveLength(300);
    expect(ids).not.toContain('id-0'); // cerrada y la mas antigua
    expect(ids).toContain('id-4');     // cerrada pero mas reciente: sobrevive
    expect(ids).toContain('id-5');     // abierta: no se toca aun
    expect(raw().at(-1).title).toBe('la nueva');
  });
});

describe('deleteIssue', () => {
  it('borra por id y avisa si no existe', async () => {
    const r = await reportIssue(U, { title: 'ruido' });
    expect(await deleteIssue(U, r.issue.id)).toMatchObject({ ok: true, remaining: 0 });
    expect(await deleteIssue(U, r.issue.id)).toHaveProperty('error');
  });
});
