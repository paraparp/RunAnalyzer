// @vitest-environment jsdom
// (jsdom solo por el `window.dispatchEvent` del aviso final; el resto es puro.)
// Tests del sync centralizado. Lo que se fija aquí son las tres divergencias que
// tenían los tres caminos anteriores (entrada, botón y backfill), porque son las
// que costaban datos: que los carriles de Strava y Garmin son INDEPENDIENTES, que
// `force` es la única diferencia entre entrar y pulsar el botón, y que un token
// muerto desconecta Strava sin cancelar el resto del sync.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map() }));
vi.mock('./cloudStorage', () => ({
  default: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  },
}));

const { strava } = vi.hoisted(() => ({
  strava: { getActivities: vi.fn(), refreshAccessToken: vi.fn() },
}));
vi.mock('../services/strava', () => strava);

const { garmin } = vi.hoisted(() => ({ garmin: { syncGarminActivities: vi.fn() } }));
vi.mock('./garminActivitiesSync', () => garmin);

import { syncAll } from './syncAll';

const TODAY = new Date().toDateString();
const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 3600;

const putStrava = (o) => store.set('stravaData', JSON.stringify({
  accessToken: 'tok', refreshToken: 'ref', expiresAt: FUTURE, activities: [], ...o,
}));
const readStrava = () => JSON.parse(store.get('stravaData'));
const putCreds = () => store.set('garmin_creds', JSON.stringify({ username: 'u', password: 'p' }));

/** Respuesta de /api/garmin/health/recent. */
const health = (data, sleepData = []) => ({ ok: true, json: async () => ({ data, sleepData }) });

beforeEach(() => {
  store.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  strava.getActivities.mockReset().mockResolvedValue([{ id: 1, name: 'rodaje' }]);
  strava.refreshAccessToken.mockReset();
  garmin.syncGarminActivities.mockReset().mockResolvedValue([{ garmin_id: 9 }]);
  globalThis.fetch = vi.fn().mockResolvedValue(health([{ date: '2026-09-12', rhr: 44 }]));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('carriles independientes', () => {
  it('sincroniza Garmin aunque Strava no esté conectado', async () => {
    // El bug que cerró esto: todo el sync vivía dentro de un `if (savedStrava)`.
    putCreds();
    const out = await syncAll();
    expect(out.strava.status).toBe('disconnected');
    expect(out.garmin.status).toBe('synced');
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(garmin.syncGarminActivities).toHaveBeenCalledWith('u', 'p');
    expect(JSON.parse(store.get('garmin_cardiac_data'))).toEqual([{ date: '2026-09-12', rhr: 44 }]);
  });

  it('sincroniza Strava aunque no haya credenciales de Garmin', async () => {
    putStrava({ lastFetchDate: 'hace tiempo' });
    const out = await syncAll();
    expect(out.strava.status).toBe('synced');
    expect(out.garmin.status).toBe('disconnected');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('un fallo de Strava no cancela el carril de Garmin', async () => {
    putStrava({ lastFetchDate: 'hace tiempo' });
    putCreds();
    strava.getActivities.mockRejectedValue(new Error('rate limit'));
    const out = await syncAll();
    expect(out.strava.status).toBe('error');
    expect(out.garmin.status).toBe('synced');
    // Y lo guardado de Strava sigue intacto: un fallo de red no borra nada.
    expect(readStrava().accessToken).toBe('tok');
  });

  it('un fallo de la salud de Garmin no impide bajar sus actividades', async () => {
    putCreds();
    globalThis.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Garmin caído' }) });
    const out = await syncAll();
    expect(out.garmin.status).toBe('error');
    expect(garmin.syncGarminActivities).toHaveBeenCalled();
  });
});

describe('frescura de Strava', () => {
  it('al entrar no vuelve a bajar el listado si ya se bajó hoy', async () => {
    putStrava({ lastFetchDate: TODAY });
    const out = await syncAll();
    expect(out.strava.status).toBe('fresh');
    expect(strava.getActivities).not.toHaveBeenCalled();
  });

  it('el botón (force) lo baja igual', async () => {
    putStrava({ lastFetchDate: TODAY });
    const out = await syncAll({ force: true });
    expect(out.strava.status).toBe('synced');
    expect(strava.getActivities).toHaveBeenCalledOnce();
  });

  it('conserva el detalle ya enriquecido al mezclar el listado nuevo', async () => {
    // El listado de Strava viene sin splits: mezclar es lo que evita borrarlos.
    putStrava({ lastFetchDate: 'hace tiempo', activities: [{ id: 1, splits_metric: [{ km: 1 }] }] });
    await syncAll();
    expect(readStrava().activities[0].splits_metric).toEqual([{ km: 1 }]);
    expect(readStrava().lastFetchDate).toBe(TODAY);
  });
});

describe('token caducado', () => {
  it('lo refresca y sigue: el refresco obliga a bajar listado aunque sea de hoy', async () => {
    putStrava({ expiresAt: PAST, lastFetchDate: TODAY });
    strava.refreshAccessToken.mockResolvedValue({
      access_token: 'nuevo', refresh_token: 'ref2', expires_at: FUTURE,
    });
    const out = await syncAll();
    expect(out.strava.status).toBe('synced');
    expect(strava.getActivities).toHaveBeenCalledWith('nuevo', 1000);
    expect(readStrava().accessToken).toBe('nuevo');
  });

  it('sin refreshToken desconecta Strava pero NO se salta Garmin', async () => {
    // Antes esto hacía `return` antes de tocar Garmin.
    putStrava({ expiresAt: PAST, refreshToken: null });
    putCreds();
    const onStravaDisconnected = vi.fn();
    const out = await syncAll({ onStravaDisconnected });
    expect(out.strava.status).toBe('disconnected');
    expect(onStravaDisconnected).toHaveBeenCalled();
    expect(store.has('stravaData')).toBe(false);
    expect(out.garmin.status).toBe('synced');
  });

  it('un 401 al bajar el listado olvida la conexión', async () => {
    putStrava({ lastFetchDate: 'hace tiempo' });
    strava.getActivities.mockRejectedValue(new Error('HTTP 401'));
    const out = await syncAll();
    expect(out.strava.status).toBe('disconnected');
    expect(store.has('stravaData')).toBe(false);
  });
});

describe('avisos a la UI', () => {
  it('engancha el enriquecido solo cuando hay listado nuevo', async () => {
    putStrava({ lastFetchDate: TODAY });
    const onActivities = vi.fn();
    await syncAll({ onActivities });
    expect(onActivities).not.toHaveBeenCalled();
    await syncAll({ force: true, onActivities });
    expect(onActivities).toHaveBeenCalledWith([{ id: 1, name: 'rodaje' }], 'tok');
  });

  it('avisa UNA vez al final, con los dos carriles ya escritos', async () => {
    putStrava({ lastFetchDate: 'hace tiempo' });
    putCreds();
    const seen = [];
    const onDone = () => seen.push({
      strava: JSON.parse(store.get('stravaData')).lastFetchDate,
      cardiac: store.has('garmin_cardiac_data'),
    });
    window.addEventListener('garmin_sync_complete', onDone);
    try {
      await syncAll();
    } finally {
      window.removeEventListener('garmin_sync_complete', onDone);
    }
    expect(seen).toEqual([{ strava: TODAY, cardiac: true }]);
  });

  it('refleja en el estado de la UI el MISMO objeto que quedó guardado', async () => {
    putStrava({ lastFetchDate: 'hace tiempo' });
    const onStravaData = vi.fn();
    await syncAll({ onStravaData });
    expect(onStravaData).toHaveBeenCalledTimes(1);
    expect(onStravaData.mock.calls[0][0]).toEqual(readStrava());
  });
});

describe('sin nada conectado', () => {
  it('no lanza y lo dice en los dos carriles', async () => {
    const out = await syncAll();
    expect(out).toEqual({ strava: { status: 'disconnected' }, garmin: { status: 'disconnected' } });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
