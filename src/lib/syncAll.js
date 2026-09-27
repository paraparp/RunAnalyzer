// ============================================================================
// syncAll — el ÚNICO sync de la app. Strava + Garmin (salud, sueño y
// actividades con dinámica), en un solo sitio y con un solo orden.
//
// Antes había tres caminos que hacían casi lo mismo: el efecto de montaje
// ("autosync" al entrar), el botón de la barra y el backfill de GarminCardiac.
// "Casi" es el problema: divergían en cosas que sí se notan.
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
//
// Dos velocidades:
//   - **Rápido** (entrada a la app y botón de la barra): mira el último dato
//     guardado y va solo a por lo NUEVO. Strava pide las actividades posteriores
//     a la última guardada (`after`, una petición) y Garmin la salud desde el
//     último día guardado y las últimas pocas actividades. Sin novedades, no
//     escribe nada.
//   - **Completo** (`full`, panel de usuario): vuelve a bajar el listado entero
//     de Strava —recoge borradas, subidas tardías y ediciones antiguas— y avanza
//     el backfill del detalle de Garmin.
//
// El enriquecido pesado (splits, tramos llanos) NO vive aquí: se dispara con
// `onActivities`, en segundo plano y sin bloquear.
// ============================================================================
import { getActivities, refreshAccessToken } from '../services/strava';
import {
  readStravaData, persistStravaData, clearStravaData,
  mergeEnrichedActivities, upsertActivities, newestStartEpoch, todayStamp,
} from './stravaStore';
import {
  readGarminCreds, garminSyncDays, saveGarminHealth, SYNC_COMPLETE_EVENT,
} from './garminHealthStore';
import { syncGarminActivities } from './garminActivitiesSync';

/** Cuántas actividades de Strava se guardan como mucho. */
const STRAVA_LIMIT = 1000;

// Solape del incremental: `after` va una semana antes de la última guardada, para
// recoger lo subido con retraso y las ediciones recientes (nombre, tipo). Sigue
// cabiendo en una sola página.
const STRAVA_OVERLAP_S = 7 * 86400;

// Actividades de Garmin por sync: [listadas, con detalle]. El rápido solo mira
// las últimas (lo nuevo, con detalle ya); el completo recorre más y rellena el
// histórico pendiente.
const GARMIN_QUICK = { limit: 30, enrichDetail: 10 };
const GARMIN_FULL = { limit: 300, enrichDetail: 40 };

// Días de salud que revisa el completo aunque el incremental diga menos: rehace
// los días que Garmin terminó de escribir después (sueño, HRV de la noche).
const GARMIN_FULL_HEALTH_DAYS = 30;

const isAuthError = (msg = '') => /401|refresh/i.test(String(msg));

/**
 * Carril Strava: refresca el token si toca y trae lo nuevo (o el listado entero
 * con `full`), MEZCLADO con lo guardado para no perder el detalle enriquecido.
 *
 * Devuelve `{ status, data, activities, accessToken, changed }`. `status` es
 * 'disconnected' (sin conexión guardada o token irrecuperable), 'synced' o
 * 'error'. `changed` es cuántas actividades entraron o cambiaron.
 */
async function syncStrava({ full, onData, onDisconnected }) {
  const stored = readStravaData();
  if (!stored?.accessToken) return { status: 'disconnected' };

  let current = { ...stored };
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
      persistStravaData(current);
      onData?.(current);
    }

    const newest = newestStartEpoch(current.activities);
    let activities;
    let changed;
    if (full || newest == null) {
      const fresh = await getActivities(current.accessToken, STRAVA_LIMIT);
      activities = mergeEnrichedActivities(fresh, current.activities);
      changed = fresh.length;
    } else {
      const fresh = await getActivities(current.accessToken, STRAVA_LIMIT, { after: newest - STRAVA_OVERLAP_S });
      ({ activities, changed } = upsertActivities(fresh, current.activities, { limit: STRAVA_LIMIT }));
    }

    const today = todayStamp();
    // Sin novedades y ya marcado hoy: nada que escribir. Reescribir aquí subiría
    // a Supabase el blob entero (MBs) y repintaría toda la app por nada.
    if (!changed && current.lastFetchDate === today) {
      return { status: 'synced', data: current, activities: current.activities, accessToken: current.accessToken, changed: 0 };
    }
    const updated = { ...current, activities, lastFetchDate: today };
    persistStravaData(updated);
    onData?.(updated);
    return { status: 'synced', data: updated, activities, accessToken: updated.accessToken, changed };
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
 *
 * Las dos llamadas van en serie a propósito: cada una hace login en Garmin, y dos
 * logins simultáneos con la misma cuenta son lo que acaba en 403.
 */
async function syncGarmin({ full, onHealth }) {
  const creds = readGarminCreds();
  if (!creds) return { status: 'disconnected' };

  const out = { status: 'synced' };
  try {
    const days = full ? Math.max(garminSyncDays(), GARMIN_FULL_HEALTH_DAYS) : garminSyncDays();
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
    const activities = await syncGarminActivities(creds.username, creds.password, full ? GARMIN_FULL : GARMIN_QUICK);
    out.activities = activities?.length ?? 0;
  } catch (e) {
    console.warn('[sync] actividades de Garmin fallaron', e.message);
    out.activitiesError = e.message;
  }
  return out;
}

/**
 * Sincroniza TODO lo que la app guarda de terceros. Es el único punto de entrada:
 * lo llaman el arranque del Dashboard y el botón de la barra (rápido; el botón
 * con `force`) y el panel de usuario (`full`).
 *
 * Los dos carriles corren EN PARALELO: son proveedores distintos con cuotas
 * distintas, así que esperar a Strava para empezar Garmin solo sumaba tiempos.
 *
 * Nunca lanza: devuelve el estado de cada carril para que la UI pueda contarlo.
 */
export async function syncAll({
  force = false,
  full = false,
  onStravaData,
  onStravaDisconnected,
  onGarminHealth,
  onActivities,
} = {}) {
  const stravaLane = syncStrava({ full, onData: onStravaData, onDisconnected: onStravaDisconnected })
    .then((strava) => {
      // El enriquecido en segundo plano (splits, streams) gasta hasta ~90 de las
      // 100 peticiones que Strava da por cuarto de hora. Al entrar solo se lanza
      // si hay actividades nuevas: recargar la app no debe comerse la cuota. Con
      // los botones (`force`/`full`) sí, para ir completando el histórico.
      // Sin `await` desde quien lo recibe: no debe retrasar el final del sync.
      if (strava.status === 'synced' && strava.accessToken && (force || full || strava.changed > 0)) {
        onActivities?.(strava.activities, strava.accessToken);
      }
      return strava;
    });
  const [strava, garmin] = await Promise.all([
    stravaLane,
    syncGarmin({ full, onHealth: onGarminHealth }),
  ]);

  // Un solo aviso al final, con los dos carriles ya escritos: es el que despierta
  // a las vistas que leen de cloudStorage (GarminCardiac, VO2Max, wearable, AI…).
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SYNC_COMPLETE_EVENT));
  }

  return { strava, garmin };
}

export default syncAll;
