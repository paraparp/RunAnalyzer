// ============================================================================
// syncAll — el ÚNICO sync de la app. Strava + Garmin (salud, sueño y
// actividades con dinámica), en un solo sitio y con un solo orden.
//
// Antes había tres caminos que hacían casi lo mismo: el efecto de montaje
// ("autosync" al entrar), el botón de la barra y el backfill de GarminCardiac.
// "Casi" es el problema: divergían en tres cosas que sí se notan.
//
//   1) **Garmin colgaba de Strava.** Todo el sync de entrada vivía dentro de un
//      `if (savedStrava)`, y el del botón arrancaba con `if (!stravaData) return`.
//      Sin Strava conectado, la salud y las actividades de Garmin NO se
//      sincronizaban nunca, aunque las credenciales de Garmin estuvieran puestas.
//      Aquí los dos carriles son INDEPENDIENTES: cada uno se salta solo si le
//      faltan SUS credenciales, y el fallo de uno no cancela el otro.
//   2) **Un token sin refresh se tragaba el resto.** Al caducar sin
//      `refreshToken`, el camino de entrada hacía `return` antes de tocar Garmin.
//      Ahora desconectar Strava es el resultado de SU carril, no el final del sync.
//   3) **La frescura se decidía distinto.** El botón bajaba Strava siempre; la
//      entrada, solo si `lastFetchDate` no era de hoy. Esa diferencia es
//      deliberada (el rate-limit de Strava no perdona un refresco por navegación)
//      y ahora es un parámetro, `force`, en vez de dos cuerpos de función.
//
// El enriquecido pesado (splits, tramos llanos) NO vive aquí: se dispara con
// `onActivities`, en segundo plano y sin bloquear. Lo que sí vive aquí es que se
// dispare IGUAL viniendo de la entrada o del botón.
// ============================================================================
import { getActivities, refreshAccessToken } from '../services/strava';
import {
  readStravaData, persistStravaData, clearStravaData,
  mergeEnrichedActivities, todayStamp,
} from './stravaStore';
import {
  readGarminCreds, garminSyncDays, saveGarminHealth, SYNC_COMPLETE_EVENT,
} from './garminHealthStore';
import { syncGarminActivities } from './garminActivitiesSync';

/** Cuántas actividades de Strava se piden en cada refresco. */
const STRAVA_LIMIT = 1000;

const isAuthError = (msg = '') => /401|refresh/i.test(String(msg));

/**
 * Carril Strava: refresca el token si toca, baja el listado y lo MEZCLA con lo
 * guardado (el listado viene sin detalle: ver `mergeEnrichedActivities`).
 *
 * Devuelve `{ status, data, activities, accessToken }`. `status` es
 * 'disconnected' (sin conexión guardada o token irrecuperable), 'fresh' (ya se
 * bajó hoy y no se fuerza), 'synced' o 'error'.
 */
async function syncStrava({ force, onData, onDisconnected }) {
  const stored = readStravaData();
  if (!stored?.accessToken) return { status: 'disconnected' };

  let current = { ...stored };
  let refreshed = false;
  try {
    if (current.expiresAt && Date.now() / 1000 >= current.expiresAt) {
      if (!current.refreshToken) {
        clearStravaData();
        onDisconnected?.();
        return { status: 'disconnected', reason: 'token caducado sin refresh' };
      }
      const tokens = await refreshAccessToken(current.refreshToken);
      current = {
        ...current,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_at,
      };
      refreshed = true;
      persistStravaData(current);
      onData?.(current);
    }

    // La entrada a la app no vuelve a bajar el listado si ya se bajó hoy; el
    // botón sí (es lo que el usuario está pidiendo explícitamente).
    const today = todayStamp();
    if (!force && !refreshed && current.lastFetchDate === today) {
      return { status: 'fresh', data: current, activities: current.activities, accessToken: current.accessToken };
    }

    const fresh = await getActivities(current.accessToken, STRAVA_LIMIT);
    const activities = mergeEnrichedActivities(fresh, current.activities);
    const updated = { ...current, activities, lastFetchDate: today };
    persistStravaData(updated);
    onData?.(updated);
    return { status: 'synced', data: updated, activities, accessToken: updated.accessToken };
  } catch (e) {
    // Un 401 o un refresh rechazado significa que la conexión ya no vale: se
    // olvida para que la UI ofrezca reconectar. Cualquier otro fallo (red,
    // rate-limit) deja los datos como estaban y se reintenta en el próximo sync.
    if (isAuthError(e.message)) {
      clearStravaData();
      onDisconnected?.();
      return { status: 'disconnected', error: e.message };
    }
    console.error('[sync] Strava falló', e);
    return { status: 'error', error: e.message, data: current, accessToken: current.accessToken };
  }
}

/**
 * Carril Garmin: salud y sueño (incremental desde el último registro guardado) y
 * después las actividades con running dynamics, que reaprovechan las mismas
 * credenciales. Las actividades son best-effort: un fallo ahí no invalida la
 * salud que ya se guardó.
 */
async function syncGarmin({ onHealth }) {
  const creds = readGarminCreds();
  if (!creds) return { status: 'disconnected' };

  const out = { status: 'synced' };
  try {
    const days = garminSyncDays();
    const res = await fetch('/api/garmin/health/recent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: creds.username, password: creds.password, days }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Error ${res.status} de Garmin`);
    out.health = saveGarminHealth({ cardiac: json.data, sleep: json.sleepData });
    out.days = days;
    onHealth?.(out.health);
  } catch (e) {
    console.error('[sync] salud de Garmin falló', e);
    out.status = 'error';
    out.error = e.message;
  }

  try {
    const activities = await syncGarminActivities(creds.username, creds.password);
    out.activities = activities?.length ?? 0;
  } catch (e) {
    console.warn('[sync] actividades de Garmin fallaron', e.message);
    out.activitiesError = e.message;
  }
  return out;
}

/**
 * Sincroniza TODO lo que la app guarda de terceros. Es el único punto de entrada:
 * lo llaman el arranque del Dashboard (`force: false`) y el botón de la barra
 * (`force: true`).
 *
 * Los dos carriles corren en SERIE y a propósito: Strava primero, Garmin después.
 * En paralelo se solapan dos tandas de peticiones a terceros (el carril de Garmin
 * hace login + salud + actividades) y es la forma más rápida de comerse un
 * rate-limit de los dos a la vez.
 *
 * Nunca lanza: devuelve el estado de cada carril para que la UI pueda contarlo.
 */
export async function syncAll({
  force = false,
  onStravaData,
  onStravaDisconnected,
  onGarminHealth,
  onActivities,
} = {}) {
  const strava = await syncStrava({ force, onData: onStravaData, onDisconnected: onStravaDisconnected });

  // El enriquecido en segundo plano solo tiene sentido con listado nuevo y token
  // vivo. Deliberadamente sin `await`: no debe retrasar el carril de Garmin.
  if (strava.status === 'synced' && strava.accessToken) {
    onActivities?.(strava.activities, strava.accessToken);
  }

  const garmin = await syncGarmin({ onHealth: onGarminHealth });

  // Un solo aviso al final, con los dos carriles ya escritos: es el que despierta
  // a las vistas que leen de cloudStorage (GarminCardiac, VO2Max, wearable, AI…).
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SYNC_COMPLETE_EVENT));
  }

  return { strava, garmin };
}

export default syncAll;
