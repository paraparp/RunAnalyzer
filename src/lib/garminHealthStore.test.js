// Tests del almacén de salud de Garmin: la mezcla que antes existía por duplicado
// (sync automático y backfill manual). Lo que se fija es lo que costaba datos: que
// se mezcla campo a campo (cada respuesta de Garmin trae unas métricas u otras) y
// que una respuesta VACÍA no borra el histórico — "no se sabe" no es "no hubo".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map() }));
vi.mock('./cloudStorage', () => ({
  default: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  },
}));

import {
  mergeCardiac, mergeSleep, saveGarminHealth, garminSyncDays,
  readCardiac, readSleep, readGarminCreds,
  CARDIAC_KEY, SLEEP_KEY, LAST_SYNC_KEY, CREDS_KEY,
} from './garminHealthStore';

const put = (key, value) => store.set(key, JSON.stringify(value));
const read = (key) => JSON.parse(store.get(key));

beforeEach(() => { store.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('lecturas', () => {
  it('devuelven [] sin nada guardado y con basura guardada', () => {
    expect(readCardiac()).toEqual([]);
    expect(readSleep()).toEqual([]);
    store.set(CARDIAC_KEY, '{no es json');
    store.set(SLEEP_KEY, '{"no":"un array"}');
    expect(readCardiac()).toEqual([]);
    expect(readSleep()).toEqual([]);
  });

  it('las credenciales a medias no valen', () => {
    expect(readGarminCreds()).toBeNull();
    put(CREDS_KEY, { username: 'u' });
    expect(readGarminCreds()).toBeNull();
    put(CREDS_KEY, { username: 'u', password: 'p' });
    expect(readGarminCreds()).toEqual({ username: 'u', password: 'p' });
  });
});

describe('mergeCardiac', () => {
  it('mezcla campo a campo: el registro nuevo no borra las métricas que no trae', () => {
    const prev = [{ date: '2026-09-10', rhr: 44, vo2max: 54 }];
    const next = [{ date: '2026-09-10', rhr: 43 }];
    expect(mergeCardiac(prev, next)).toEqual([{ date: '2026-09-10', rhr: 43, vo2max: 54 }]);
  });

  it('ordena por fecha y descarta registros sin día', () => {
    const out = mergeCardiac(
      [{ date: '2026-09-11', rhr: 45 }],
      [{ date: '2026-09-09', rhr: 46 }, { rhr: 99 }],
    );
    expect(out.map(r => r.date)).toEqual(['2026-09-09', '2026-09-11']);
  });
});

describe('mergeSleep', () => {
  it('mezcla por semana y ordena', () => {
    const out = mergeSleep(
      [{ weekStart: '2026-09-07', score: 70 }],
      [{ weekStart: '2026-08-31', score: 80 }, { weekStart: '2026-09-07', score: 75 }],
    );
    expect(out).toEqual([
      { weekStart: '2026-08-31', score: 80 },
      { weekStart: '2026-09-07', score: 75 },
    ]);
  });
});

describe('saveGarminHealth', () => {
  it('mezcla con lo guardado y deja marca de sync', () => {
    put(CARDIAC_KEY, [{ date: '2026-09-10', rhr: 44 }]);
    const out = saveGarminHealth({ cardiac: [{ date: '2026-09-11', rhr: 45 }] });
    expect(out.cardiac.map(r => r.date)).toEqual(['2026-09-10', '2026-09-11']);
    expect(read(CARDIAC_KEY)).toEqual(out.cardiac);
    expect(store.get(LAST_SYNC_KEY)).toBe(out.lastSync);
  });

  it('una respuesta vacía NO borra el histórico', () => {
    // Un Garmin caído devuelve []: eso es "no se sabe", no "no hubo datos".
    put(CARDIAC_KEY, [{ date: '2026-09-10', rhr: 44 }]);
    put(SLEEP_KEY, [{ weekStart: '2026-09-07', score: 70 }]);
    const out = saveGarminHealth({ cardiac: [], sleep: [] });
    expect(read(CARDIAC_KEY)).toEqual([{ date: '2026-09-10', rhr: 44 }]);
    expect(read(SLEEP_KEY)).toEqual([{ weekStart: '2026-09-07', score: 70 }]);
    expect(out.cardiac).toHaveLength(1);
  });

  it('`replace` sustituye (es el backfill largo, que ya viene acumulado)', () => {
    put(CARDIAC_KEY, [{ date: '2020-01-01', rhr: 50 }]);
    const out = saveGarminHealth({ cardiac: [{ date: '2026-09-11', rhr: 45 }] }, { replace: true });
    expect(out.cardiac).toEqual([{ date: '2026-09-11', rhr: 45 }]);
    expect(read(CARDIAC_KEY)).toEqual([{ date: '2026-09-11', rhr: 45 }]);
  });
});

describe('garminSyncDays', () => {
  const DAY = 86400000;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);

  it('sin histórico pide el último mes', () => {
    expect(garminSyncDays()).toBe(30);
  });

  it('con histórico pide desde el último registro, con un día de solape', () => {
    const now = Date.parse('2026-09-13T10:00:00Z');
    put(CARDIAC_KEY, [{ date: iso(now - 3 * DAY) }, { date: iso(now - 9 * DAY) }]);
    expect(garminSyncDays({ now })).toBe(5); // 3 días + redondeo + solape
  });

  it('nunca pide más del tope, por mucho que haga que no se sincroniza', () => {
    const now = Date.parse('2026-09-13T10:00:00Z');
    put(CARDIAC_KEY, [{ date: '2019-01-01' }]);
    expect(garminSyncDays({ now })).toBe(90);
  });

  it('una fecha ilegible cae al valor por defecto en vez de pedir NaN días', () => {
    put(CARDIAC_KEY, [{ date: 'ayer por la tarde' }]);
    expect(garminSyncDays()).toBe(30);
  });
});
