// Tests de mcp-sync: el módulo que mantiene fresco el cache que leen las tools. Se
// ejercita por la puerta pública (`ensureFresh`, `runFullSync`, `listSyncableUsers`)
// sin ampliar la superficie de export (ver `G8` de la auditoría): `user_storage` es
// un Map en memoria, Garmin un doble, y Strava un router de `fetch`.
//
// Lo que se fija aquí es lo que no se puede comprobar mirando: que el carril de
// request cuesta 0 I/O cuando no toca, que un proveedor caído nunca sobrescribe un
// histórico bueno, y que las mezclas por id no pierden el enriquecido.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = vi.hoisted(() => new Map());   // `${userId}:${key}` -> valor
const io = vi.hoisted(() => ({ reads: [], writes: [] }));

vi.mock('./mcp-store.js', () => ({
  readKey: async (u, k) => { io.reads.push(k); return store.get(`${u}:${k}`) ?? null; },
  readKeyFresh: async (u, k) => { io.reads.push(k); return store.get(`${u}:${k}`) ?? null; },
  writeKey: async (u, k, v) => { io.writes.push([k, v]); store.set(`${u}:${k}`, v); },
  listUsersWithKey: async (k) => [...store.keys()].filter((x) => x.endsWith(`:${k}`)).map((x) => x.split(':')[0]),
}));

const garmin = vi.hoisted(() => ({ login: null, activities: [], sleep: [], day: null, seen: {} }));

vi.mock('./garmin-session.js', () => ({
  getGarminClientFor: async () => {
    if (garmin.login) throw new Error(garmin.login);
    return { fake: true };
  },
}));

vi.mock('./garmin-helpers.js', () => ({
  fetchGarminActivities: async (_c, limit, opts) => { garmin.seen.activities = { limit, ...opts }; return garmin.activities; },
  fetchHrvBulk: async () => ({}),
  fetchBodyBatteryBulk: async () => ({}),
  fetchSleepBulk: async (_c, weeks) => { garmin.seen.weeks = weeks; return garmin.sleep; },
  fetchDayData: async (_c, dateStr) => { (garmin.seen.days ||= []).push(dateStr); return garmin.day ? { date: dateStr, ...garmin.day } : null; },
  toDateStr: (d) => d.toISOString().split('T')[0],
}));

// ── Router de Strava ────────────────────────────────────────────────────────
const http = vi.hoisted(() => ({ pages: {}, probe: [], detail: {}, streams: {}, refresh: null, status: {}, log: [] }));

const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

vi.stubGlobal('fetch', async (url, opts) => {
  http.log.push(String(url));
  const u = new URL(String(url));
  if (u.pathname === '/oauth/token') return reply(http.refresh ?? {}, http.status.refresh ?? 200);
  if (u.pathname === '/api/v3/athlete/activities') {
    if (http.status.list) return reply({}, http.status.list);
    if (u.searchParams.get('after')) return reply(http.probe);
    return reply(http.pages[u.searchParams.get('page') || '1'] ?? []);
  }
  const streams = u.pathname.match(/^\/api\/v3\/activities\/(\d+)\/streams$/);
  if (streams) return reply(http.streams[streams[1]] ?? {});
  const detail = u.pathname.match(/^\/api\/v3\/activities\/(\d+)$/);
  if (detail) return reply(http.detail[detail[1]] ?? {}, http.status.detail ?? 200);
  void opts;
  return reply({}, 404);
});

const { ensureFresh, runFullSync, listSyncableUsers } = await import('./mcp-sync.js');

// ── Utilidades de fixture ───────────────────────────────────────────────────
let uid = 0;
const nextUser = () => `u${++uid}`;
const put = (u, k, v) => store.set(`${u}:${k}`, v);
const get = (u, k) => store.get(`${u}:${k}`);
const wrote = (k) => io.writes.filter((w) => w[0] === k);
const iso = (d) => new Date(d).toISOString();

// Fecha FIJA por id: `start_date` es uno de los campos de resumen que disparan la
// reescritura del blob, así que derivarla de `Date.now()` haría que la misma
// actividad "cambiara" entre dos llamadas y el test fuera intermitente.
const BASE = Date.parse('2026-06-01T06:00:00.000Z');
const act = (id, o = {}) => ({
  id,
  name: `Act ${id}`,
  type: 'Run',
  sport_type: 'Run',
  distance: 10000,
  moving_time: 3000,
  elapsed_time: 3100,
  start_date: iso(BASE - id * 86400000),
  ...o,
});

const token = { access: 'acc', refresh: 'ref', expires: Math.floor(Date.now() / 1000) + 3600 };
const blobWith = (activities) => ({
  activities, accessToken: token.access, refreshToken: token.refresh, expiresAt: token.expires,
});
// Carril de Garmin recién sellado: los tests de Strava no deben arrastrar el login.
const garminFresh = { garmin: { at: Date.now(), ok: true, error: null } };

beforeEach(() => {
  store.clear();
  io.reads.length = 0; io.writes.length = 0; http.log.length = 0;
  http.pages = {}; http.probe = []; http.detail = {}; http.streams = {};
  http.refresh = null; http.status = {};
  garmin.login = null; garmin.activities = []; garmin.sleep = []; garmin.day = null; garmin.seen = {};
  process.env.STRAVA_CLIENT_ID = 'cid';
  process.env.STRAVA_CLIENT_SECRET = 'csecret';
});

describe('runFullSync — delta de Strava', () => {
  it('mezcla lo nuevo por id, adelgaza el detalle y deja el histórico ordenado', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(3)]));
    put(u, 'mcp_sync_state', garminFresh);
    http.pages['1'] = [
      act(1, { segment_efforts: [1, 2], photos: { x: 1 }, description: 'larga', map: { id: 'm1', summary_polyline: 'abc', extra: 1 } }),
      act(3),
    ];

    const out = await runFullSync(u, { backfill: false });
    expect(out.strava).toMatchObject({ added: 1, changed: 0, wrote: true });

    const saved = get(u, 'stravaData');
    expect(saved.activities.map((a) => a.id)).toEqual([1, 3]); // recientes primero
    const nueva = saved.activities[0];
    for (const k of ['segment_efforts', 'photos', 'description']) expect(nueva[k]).toBeUndefined();
    expect(nueva.map).toEqual({ id: 'm1', summary_polyline: 'abc' }); // solo id + polilínea
    expect(saved.lastFetchDate).toBeTruthy();
  });

  it('corta la paginación en cuanto aparece una conocida (no repagina el histórico)', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(2)]));
    put(u, 'mcp_sync_state', garminFresh);
    http.pages['1'] = [act(1), act(2)];
    http.pages['2'] = [act(9)];

    await runFullSync(u, { backfill: false });
    expect(http.log.filter((l) => l.includes('page=2'))).toHaveLength(0);
    expect(get(u, 'stravaData').activities.map((a) => a.id)).toEqual([1, 2]);
  });

  it('no reescribe el blob si el resumen no cambió, y sí si la renombran en Strava', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(1)]));
    put(u, 'mcp_sync_state', garminFresh);
    http.pages['1'] = [act(1)];

    const quieto = await runFullSync(u, { backfill: false });
    expect(quieto.strava).toMatchObject({ added: 0, changed: 0, wrote: false });
    expect(wrote('stravaData')).toHaveLength(0);

    http.pages['1'] = [act(1, { name: 'Renombrada' })];
    const cambio = await runFullSync(u, { force: true, backfill: false });
    expect(cambio.strava).toMatchObject({ added: 0, changed: 1, wrote: true });
    expect(get(u, 'stravaData').activities[0].name).toBe('Renombrada');
  });

  it('pide el detalle solo a las carreras nuevas con distancia', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(9)]));
    put(u, 'mcp_sync_state', garminFresh);
    http.pages['1'] = [act(1), act(2, { type: 'Ride', sport_type: 'Ride' }), act(3, { distance: 0 }), act(9)];
    http.detail['1'] = act(1, { splits_metric: [{ distance: 1000 }], laps: [{ id: 1 }] });

    const out = await runFullSync(u, { backfill: false });
    expect(out.strava.enriched).toBe(1);
    const pedidos = http.log.filter((l) => /\/activities\/\d+$/.test(l));
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatch(/\/activities\/1$/);
    expect(get(u, 'stravaData').activities.find((a) => a.id === 1).splits_metric).toHaveLength(1);
  });

  it('un blob legacy en forma de array se reescribe como objeto, no como {"0":…}', async () => {
    const u = nextUser();
    put(u, 'stravaData', [act(2)]);                       // formato viejo, sin tokens
    put(u, 'mcp_sync_state', { ...garminFresh, strava: { token } }); // token en el estado
    http.pages['1'] = [act(1), act(2)];

    await runFullSync(u, { backfill: false });
    const saved = get(u, 'stravaData');
    expect(Array.isArray(saved.activities)).toBe(true);
    expect(saved.activities.map((a) => a.id)).toEqual([1, 2]);
    expect(Object.keys(saved)).not.toContain('0');        // el array no se esparce
  });

  it('persiste en el blob el token que Strava rota', async () => {
    const u = nextUser();
    const caducado = { ...token, expires: Math.floor(Date.now() / 1000) - 10 };
    put(u, 'stravaData', { ...blobWith([act(1)]), expiresAt: caducado.expires });
    put(u, 'mcp_sync_state', garminFresh);
    http.refresh = { access_token: 'acc2', refresh_token: 'ref2', expires_at: Math.floor(Date.now() / 1000) + 7200 };
    http.pages['1'] = [act(1)];

    await runFullSync(u, { backfill: false });
    const saved = get(u, 'stravaData');
    expect(saved.accessToken).toBe('acc2');
    expect(saved.refreshToken).toBe('ref2');
    expect(get(u, 'mcp_sync_state').strava.token.access).toBe('acc2');
  });

  it('un error de Strava queda anotado en el estado sin tumbar el sync', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(1)]));
    put(u, 'mcp_sync_state', garminFresh);
    http.status.list = 429;

    const out = await runFullSync(u, { backfill: false });
    expect(out.strava.error).toMatch(/429/);
    expect(get(u, 'mcp_sync_state').strava).toMatchObject({ ok: false });
    expect(wrote('stravaData')).toHaveLength(0);  // el histórico no se toca
  });
});

describe('ensureFresh — carril de request', () => {
  it('sin novedades no abre el blob: sondea y solo sella el estado', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(1)]));
    put(u, 'mcp_sync_state', {
      ...garminFresh,
      strava: { at: 0, after: 1750000000, full_at: Date.now(), token },
    });

    await ensureFresh(u);
    expect(http.log.filter((l) => l.includes('after='))).toHaveLength(1);
    expect(io.reads).not.toContain('stravaData');   // el blob multi-MB no se abre
    expect(wrote('stravaData')).toHaveLength(0);
    expect(get(u, 'mcp_sync_state').strava.at).toBeGreaterThan(0);
  });

  it('la segunda llamada dentro del TTL no hace NI UNA lectura', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(1)]));
    put(u, 'mcp_sync_state', { ...garminFresh, strava: { at: 0, after: 1750000000, full_at: Date.now(), token } });

    await ensureFresh(u);
    io.reads.length = 0; io.writes.length = 0; http.log.length = 0;
    expect(await ensureFresh(u)).toBeNull();
    expect(io.reads).toHaveLength(0);
    expect(io.writes).toHaveLength(0);
    expect(http.log).toHaveLength(0);
  });

  it('respeta el lock de otra instancia y no toca Strava', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(1)]));
    put(u, 'mcp_sync_state', { ...garminFresh, lock_until: Date.now() + 60000 });

    expect(await ensureFresh(u)).toEqual({ skipped: 'lock' });
    expect(http.log).toHaveLength(0);
  });

  it('no propaga el fallo de un proveedor: la tool sigue pudiendo responder del cache', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(1)]));
    put(u, 'mcp_sync_state', { strava: { at: 0, after: 1750000000, full_at: Date.now(), token } });
    http.status.list = 500;
    garmin.login = 'No hay credenciales de Garmin guardadas.';

    const out = await ensureFresh(u);
    expect(out.strava.error).toMatch(/500/);
    expect(out.garmin.error).toMatch(/credenciales/);
    const state = get(u, 'mcp_sync_state');
    expect(state.strava.ok).toBe(false);
    expect(state.garmin.ok).toBe(false);
    expect(state.lock_until).toBe(0);   // el lock se libera aunque falle todo
  });
});

describe('Garmin', () => {
  const gact = (id, o = {}) => ({ garmin_id: id, start_time: iso(Date.now() - id * 86400000), ...o });
  // Salud ya sellada hoy: `daysMissing` pide 1-2 días en vez de los 30 del arranque.
  const hoy = new Date().toISOString().split('T')[0];

  it('una respuesta vacía no borra el histórico guardado', async () => {
    const u = nextUser();
    put(u, 'garmin_activities', [gact(1, { hr_source: 'sensors' })]);
    put(u, 'garmin_cardiac_data', [{ date: hoy }]);
    garmin.activities = [];

    const out = await runFullSync(u, { backfill: false });
    expect(out.garmin_activities).toMatchObject({ added: 0, wrote: false, note: 'respuesta vacía' });
    expect(get(u, 'garmin_activities')).toHaveLength(1);
  });

  it('mezcla por id sin perder el enriquecido que la nueva respuesta no trae', async () => {
    const u = nextUser();
    put(u, 'garmin_cardiac_data', [{ date: hoy }]);
    put(u, 'garmin_activities', [gact(1, {
      hr_source: 'sensors',
      laps: [{ n: 1 }],
      weather: { temp: 20 },
      dynamics: { cadence: 180, vertical_ratio: 7.5 },
    })]);
    garmin.activities = [gact(1, {
      hr_source: null, laps: null, weather: null,
      dynamics: { cadence: 182, ground_contact: 240 },
    })];

    await runFullSync(u, { backfill: false });
    const [a] = get(u, 'garmin_activities');
    expect(a.hr_source).toBe('sensors');           // null no pisa lo que había
    expect(a.laps).toEqual([{ n: 1 }]);
    expect(a.weather).toEqual({ temp: 20 });
    expect(a.dynamics).toEqual({ cadence: 182, vertical_ratio: 7.5, ground_contact: 240 });
    // No re-enriquece lo que ya tiene hr_source.
    expect(garmin.seen.activities.alreadyEnriched).toEqual(['1']);
  });

  it('pide solo los días que faltan desde el último registro, no 30 fijos', async () => {
    const u = nextUser();
    const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    put(u, 'garmin_cardiac_data', [{ date: ayer, resting_hr: 45 }]);
    garmin.activities = [gact(1)];
    garmin.day = { resting_hr: 46 };

    const out = await runFullSync(u, { backfill: false });
    expect(out.garmin_health.days).toBeLessThanOrEqual(3);
    expect(garmin.seen.days.length).toBe(out.garmin_health.days);
    // El histórico previo sigue ahí, mezclado por fecha.
    const cardiac = get(u, 'garmin_cardiac_data');
    expect(cardiac.find((r) => r.date === ayer)).toBeTruthy();
    expect(cardiac.map((r) => r.date)).toEqual([...cardiac.map((r) => r.date)].sort());
    expect(get(u, 'garmin_last_sync')).toBeTruthy();
  });

  it('sin filas de sueño no se toca el sueño guardado', async () => {
    const u = nextUser();
    put(u, 'garmin_cardiac_data', [{ date: hoy }]);
    put(u, 'garmin_sleep_data', [{ weekStart: '2026-08-31', avg: 7 }]);
    garmin.activities = [gact(1)];
    garmin.sleep = [];

    const out = await runFullSync(u, { backfill: false });
    expect(out.garmin_health.wroteSleep).toBe(false);
    expect(get(u, 'garmin_sleep_data')).toEqual([{ weekStart: '2026-08-31', avg: 7 }]);
  });

  it('un Garmin caído no impide que el pase de Strava haya guardado lo suyo', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(2)]));
    garmin.login = 'Garmin caído';
    http.pages['1'] = [act(1), act(2)];

    const out = await runFullSync(u, { backfill: false });
    expect(out.garmin.error).toMatch(/caído/);
    expect(get(u, 'stravaData').activities.map((a) => a.id)).toEqual([1, 2]);
  });
});

describe('backlog de enriquecido', () => {
  it('rellena splits y streams y mezcla sobre lo último publicado', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(1), act(2, { splits_metric: [{ distance: 1000 }] })]));
    put(u, 'mcp_sync_state', { ...garminFresh, strava: { at: Date.now(), ok: true, token } });
    http.detail['1'] = act(1, { splits_metric: [{ distance: 1000 }, { distance: 1000 }] });
    http.streams['2'] = {
      time: { data: [0, 1, 2] }, distance: { data: [0, 3, 6] }, altitude: { data: [10, 10, 10] },
    };

    const out = await runFullSync(u, { backfill: true });
    expect(out.backfill).toMatchObject({ wrote: true });
    expect(out.backfill.splits + out.backfill.flat).toBeGreaterThan(0);
    const saved = get(u, 'stravaData');
    expect(saved.activities.find((a) => a.id === 1).splits_metric).toHaveLength(2);
    // `flat_efforts` se guarda versionado aunque no haya tramos llanos: así esa
    // actividad no vuelve a pedir streams nunca más.
    const dos = saved.activities.find((a) => a.id === 2);
    expect(dos.flat_efforts._v).toBeGreaterThan(0);
    expect(dos.stream_gap).toBeTruthy();
  }, 20000);

  it('sin token no intenta el backlog', async () => {
    const u = nextUser();
    put(u, 'stravaData', { activities: [act(1)] });   // sin accessToken
    put(u, 'mcp_sync_state', garminFresh);

    const out = await runFullSync(u, { backfill: true });
    expect(out.backfill).toEqual({ skipped: 'sin-token' });
    expect(http.log.filter((l) => l.includes('/streams'))).toHaveLength(0);
  });
});

describe('listSyncableUsers', () => {
  it('devuelve los usuarios con datos de Strava guardados', async () => {
    const u = nextUser();
    put(u, 'stravaData', blobWith([act(1)]));
    put('sin-strava', 'garmin_activities', []);
    const users = await listSyncableUsers();
    expect(users).toContain(u);
    expect(users).not.toContain('sin-strava');
  });
});
