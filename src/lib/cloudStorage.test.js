// Tests de cloudStorage: el reemplazo de localStorage respaldado por Supabase por el
// que pasan TODAS las escrituras de datos del usuario (el blob de Strava incluido).
// Lo que se fija aquí es lo que se puso ahí para proteger la base de datos y para
// sobrevivir a una caída, y que no se ve leyendo un componente: el coalescing de
// ráfagas en un único upsert, el dirty-check, el espejo local, el modo degradado y
// la migración inicial.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rows: [], upserts: [], deletes: [],
  failSelect: 0, failUpsert: false, failDelete: false, selects: 0,
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async (_col, userId) => {
          db.selects++;
          if (db.failSelect > 0) { db.failSelect--; return { data: null, error: { message: 'HTTP 522' } }; }
          return {
            data: db.rows.filter((r) => r.user_id === userId).map(({ key, value }) => ({ key, value })),
            error: null,
          };
        },
      }),
      upsert: async (payload) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        db.upserts.push(...rows);
        if (db.failUpsert) return { error: { message: 'upsert 522' } };
        for (const row of rows) {
          const i = db.rows.findIndex((r) => r.user_id === row.user_id && r.key === row.key);
          if (i >= 0) db.rows[i] = row; else db.rows.push(row);
        }
        return { error: null };
      },
      delete: () => {
        const f = {};
        const builder = {
          eq(col, val) { f[col] = val; return builder; },
          then(resolve, reject) {
            db.deletes.push({ ...f });
            if (db.failDelete) return Promise.resolve({ error: { message: 'delete 522' } }).then(resolve, reject);
            db.rows = db.rows.filter((r) => !(r.user_id === f.user_id && r.key === f.key));
            return Promise.resolve({ error: null }).then(resolve, reject);
          },
        };
        return builder;
      },
    }),
  },
}));

// localStorage no existe en el entorno de node de vitest; el módulo lo usa siempre
// dentro de try/catch, así que el doble también sabe fallar (modo privado / cuota).
const ls = vi.hoisted(() => {
  const map = new Map();
  return {
    map, broken: false,
    getItem(k) { if (ls.broken) throw new Error('SecurityError'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (ls.broken) throw new Error('QuotaExceeded'); map.set(k, String(v)); },
    removeItem(k) { if (ls.broken) throw new Error('SecurityError'); map.delete(k); },
  };
});
vi.stubGlobal('localStorage', ls);

const cloudStorage = (await import('./cloudStorage')).default;
const { hydrate, flush, reset, isDegraded, onDegradedChange } = await import('./cloudStorage');

const DEBOUNCE = 2000;
const settle = async (ms = DEBOUNCE) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => {
  vi.useFakeTimers();
  reset();
  db.rows = []; db.upserts = []; db.deletes = [];
  db.failSelect = 0; db.failUpsert = false; db.failDelete = false; db.selects = 0;
  ls.map.clear(); ls.broken = false;
});

afterEach(() => {
  reset();
  vi.useRealTimers();
});

const row = (key, value, user_id = 'u1') => ({ user_id, key, value });

describe('hidratación', () => {
  it('carga las filas del usuario en la caché y refresca el espejo local', async () => {
    db.rows = [row('ai_model', 'opus'), row('stravaData', '{"activities":[]}'), row('otra', 'x', 'u2')];
    await hydrate('u1');

    expect(cloudStorage.getItem('ai_model')).toBe('opus');
    expect(cloudStorage.getItem('otra')).toBeNull();       // es de otro usuario
    expect(cloudStorage.getItem('no-existe')).toBeNull();  // null, nunca undefined
    expect(ls.map.get('stravaData')).toBe('{"activities":[]}');
  });

  it('lo que ya venía de la nube no se reescribe si no cambia', async () => {
    db.rows = [row('ai_model', 'opus')];
    await hydrate('u1');

    cloudStorage.setItem('ai_model', 'opus');
    await settle();
    expect(db.upserts).toHaveLength(0);

    cloudStorage.setItem('ai_model', 'sonnet');
    await settle();
    expect(db.upserts).toHaveLength(1);
  });

  it('sube una sola vez lo que quedaba en localStorage y no está en la nube', async () => {
    ls.map.set('garmin_creds', '{"username":"x"}');
    ls.map.set('app_language', 'es');        // clave de dispositivo
    ls.map.set('basura_no_migrable', '1');
    db.rows = [row('ai_model', 'opus')];

    await hydrate('u1');
    expect(db.upserts.map((u) => u.key)).toEqual(['garmin_creds']);
    expect(cloudStorage.getItem('garmin_creds')).toBe('{"username":"x"}');

    // Y queda marcada como persistida: reescribir el mismo valor no toca el disco.
    db.upserts = [];
    cloudStorage.setItem('garmin_creds', '{"username":"x"}');
    await settle();
    expect(db.upserts).toHaveLength(0);
  });
});

describe('coalescing de escrituras', () => {
  it('una ráfaga sobre la misma clave se resuelve en UN único upsert, con el último valor', async () => {
    await hydrate('u1');
    for (let i = 1; i <= 25; i++) cloudStorage.setItem('stravaData', `blob-${i}`);
    expect(db.upserts).toHaveLength(0);          // nada ha salido todavía

    await settle();
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].value).toBe('blob-25');
    expect(cloudStorage.getItem('stravaData')).toBe('blob-25');
  });

  it('un valor idéntico al de la caché no llega ni a programar escritura', async () => {
    await hydrate('u1');
    cloudStorage.setItem('ai_model', 'opus');
    await settle();
    db.upserts = [];

    cloudStorage.setItem('ai_model', 'opus');
    await settle();
    expect(db.upserts).toHaveLength(0);
  });

  it('flush fuerza lo pendiente sin esperar al debounce', async () => {
    await hydrate('u1');
    cloudStorage.setItem('stravaData', 'blob');
    const done = flush();
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(db.upserts).toHaveLength(1);
    expect(db.rows.find((r) => r.key === 'stravaData').value).toBe('blob');
  });

  it('ida y vuelta a un valor ya persistido no gasta una escritura', async () => {
    db.rows = [row('ai_model', 'opus')];
    await hydrate('u1');
    cloudStorage.setItem('ai_model', 'sonnet');
    cloudStorage.setItem('ai_model', 'opus');     // vuelta atrás dentro de la ventana
    await settle();
    expect(db.upserts).toHaveLength(0);
  });
});

describe('borrado', () => {
  it('cancela la escritura pendiente de esa clave y borra en la nube y en el espejo', async () => {
    db.rows = [row('ai_model', 'opus')];
    await hydrate('u1');

    cloudStorage.setItem('ai_model', 'sonnet');   // queda un upsert programado
    cloudStorage.removeItem('ai_model');
    await settle();

    expect(db.upserts).toHaveLength(0);           // el upsert cancelado no sale
    expect(db.deletes).toEqual([{ user_id: 'u1', key: 'ai_model' }]);
    expect(cloudStorage.getItem('ai_model')).toBeNull();
    expect(ls.map.has('ai_model')).toBe(false);
  });

  it('tras borrar, volver a poner el mismo valor SÍ se escribe', async () => {
    db.rows = [row('ai_model', 'opus')];
    await hydrate('u1');
    cloudStorage.removeItem('ai_model');
    await settle();
    db.upserts = [];

    cloudStorage.setItem('ai_model', 'opus');
    await settle();
    expect(db.upserts).toHaveLength(1);           // el dirty-check se olvidó de la clave
  });
});

describe('claves de dispositivo', () => {
  it('app_language vive en localStorage real y nunca sale hacia la nube', async () => {
    await hydrate('u1');
    cloudStorage.setItem('app_language', 'gl');
    await settle();

    expect(ls.map.get('app_language')).toBe('gl');
    expect(cloudStorage.getItem('app_language')).toBe('gl');
    expect(db.upserts).toHaveLength(0);

    cloudStorage.removeItem('app_language');
    expect(ls.map.has('app_language')).toBe(false);
    expect(db.deletes).toHaveLength(0);
  });
});

describe('resiliencia', () => {
  it('reintenta la lectura inicial y, si Supabase no responde, sigue con el espejo local', async () => {
    db.failSelect = 3;                     // los 3 intentos fallan
    ls.map.set('stravaData', 'blob-local');
    ls.map.set('basura', 'no-migrable');

    const p = hydrate('u1');
    await settle(2000);                    // backoff: 400 ms + 800 ms
    await p;

    expect(db.selects).toBe(3);
    expect(isDegraded()).toBe(true);
    expect(cloudStorage.getItem('stravaData')).toBe('blob-local');
    expect(cloudStorage.getItem('basura')).toBeNull();   // solo las claves migrables
  });

  it('un fallo transitorio en la lectura inicial no degrada nada', async () => {
    db.failSelect = 1;
    db.rows = [row('ai_model', 'opus')];
    const p = hydrate('u1');
    await settle(1000);
    await p;

    expect(db.selects).toBe(2);
    expect(isDegraded()).toBe(false);
    expect(cloudStorage.getItem('ai_model')).toBe('opus');
  });

  it('un upsert fallido marca degradado y avisa a los suscriptores; uno bueno lo levanta', async () => {
    await hydrate('u1');
    const visto = [];
    const off = onDegradedChange((v) => visto.push(v));

    db.failUpsert = true;
    cloudStorage.setItem('ai_model', 'opus');
    await settle();
    await flush();
    expect(isDegraded()).toBe(true);

    db.failUpsert = false;
    cloudStorage.setItem('ai_model', 'sonnet');
    await settle();
    await flush();
    expect(isDegraded()).toBe(false);
    expect(visto).toEqual([true, false]);

    off();
    db.failUpsert = true;
    cloudStorage.setItem('ai_model', 'haiku');
    await settle();
    await flush();
    expect(visto).toEqual([true, false]);      // ya no llegan avisos tras desuscribirse
  });

  it('el dato sigue en memoria aunque la nube rechace la escritura', async () => {
    await hydrate('u1');
    db.failUpsert = true;
    cloudStorage.setItem('stravaData', 'blob');
    await settle();
    await flush();
    expect(cloudStorage.getItem('stravaData')).toBe('blob');
    expect(ls.map.get('stravaData')).toBe('blob');   // y en el espejo, para el próximo arranque
  });

  it('un localStorage que lanza (modo privado) no rompe la lectura ni la escritura', async () => {
    await hydrate('u1');
    ls.broken = true;
    expect(() => cloudStorage.setItem('ai_model', 'opus')).not.toThrow();
    expect(cloudStorage.getItem('ai_model')).toBe('opus');       // la caché no depende del espejo
    expect(cloudStorage.getItem('app_language')).toBeNull();     // la de dispositivo sí, y no lanza
    await settle();
    expect(db.upserts).toHaveLength(1);                          // la nube sigue recibiéndolo
  });
});

describe('sesión', () => {
  it('sin usuario hidratado se guarda en memoria y en el espejo, pero no en la nube', async () => {
    cloudStorage.setItem('ai_model', 'opus');
    await settle();
    await flush();
    expect(cloudStorage.getItem('ai_model')).toBe('opus');
    expect(ls.map.get('ai_model')).toBe('opus');
    expect(db.upserts).toHaveLength(0);
  });

  it('reset vacía la caché y cancela lo pendiente sin borrar nada en la nube', async () => {
    db.rows = [row('ai_model', 'opus')];
    await hydrate('u1');
    cloudStorage.setItem('stravaData', 'blob');   // escritura programada
    reset();
    await settle();
    await flush();

    expect(cloudStorage.getItem('ai_model')).toBeNull();
    expect(db.upserts).toHaveLength(0);
    expect(db.deletes).toHaveLength(0);
    expect(db.rows).toHaveLength(1);              // la nube conserva lo que tenía
  });

  it('cambiar de usuario SIN reset no se traga la primera escritura del nuevo', async () => {
    db.rows = [row('ai_model', 'opus', 'u1')];
    await hydrate('u1');
    await hydrate('u2');                          // login de otra cuenta, sin reset()

    cloudStorage.setItem('ai_model', 'opus');     // mismo valor que tenía el anterior
    await settle();
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0]).toMatchObject({ user_id: 'u2', key: 'ai_model', value: 'opus' });
  });

  it('lo que el usuario anterior dejara pendiente se escribe con SU user_id', async () => {
    await hydrate('u1');
    cloudStorage.setItem('stravaData', 'blob-de-u1');   // escritura programada, sin salir aún
    await hydrate('u2');

    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0]).toMatchObject({ user_id: 'u1', key: 'stravaData', value: 'blob-de-u1' });
  });

  it('una segunda cuenta en el mismo navegador NO hereda el espejo de la primera', async () => {
    db.rows = [row('stravaData', 'blob-de-u1', 'u1'), row('garmin_creds', '{"username":"u1"}', 'u1')];
    await hydrate('u1');
    expect(ls.map.get('garmin_creds')).toBeTruthy();   // el espejo se llenó con lo de u1

    reset();
    db.upserts = [];
    await hydrate('u2');                               // otra cuenta, mismo dispositivo

    // Ni se le sirven los datos del anterior…
    expect(cloudStorage.getItem('stravaData')).toBeNull();
    expect(cloudStorage.getItem('garmin_creds')).toBeNull();
    // …ni se le SUBEN a su cuenta por la vía de la migración inicial.
    expect(db.upserts).toHaveLength(0);
    expect(db.rows.filter((r) => r.user_id === 'u2')).toHaveLength(0);
  });

  it('el mismo usuario sí conserva su espejo entre sesiones (es lo que salva una caída)', async () => {
    db.rows = [row('stravaData', 'blob')];
    await hydrate('u1');
    reset();

    db.failSelect = 3;                                 // Supabase caído al volver
    const p = hydrate('u1');
    await settle(2000);
    await p;
    expect(isDegraded()).toBe(true);
    expect(cloudStorage.getItem('stravaData')).toBe('blob');
  });

  it('tras reset, el dirty-check no arrastra lo del usuario anterior', async () => {
    db.rows = [row('ai_model', 'opus')];
    await hydrate('u1');
    reset();
    await hydrate('u2');

    cloudStorage.setItem('ai_model', 'opus');     // mismo valor, otro usuario
    await settle();
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].user_id).toBe('u2');
  });
});
