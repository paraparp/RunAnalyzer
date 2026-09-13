// ============================================================================
// garminHealthStore — cómo se guarda y se mezcla la salud de Garmin.
//
// Había DOS copias de esta mezcla: la del sync automático (App.jsx) y la del
// backfill manual de GarminCardiac, cada una con su propio `byDate`/`byWeek`,
// su propia marca de `garmin_last_sync` y su propio criterio sobre qué hacer
// cuando Garmin no devuelve nada. Son el mismo dato y la misma clave, así que
// cualquier divergencia la paga el histórico.
//
// Las dos reglas no obvias:
//   1) Se mezcla POR DÍA (salud) y POR SEMANA (sueño), y el registro nuevo gana
//      campo a campo: cada respuesta de Garmin trae unas métricas u otras según
//      lo que el reloj subiera ese día, así que reemplazar el registro entero
//      borra las que hoy no vinieron.
//   2) Una respuesta VACÍA no borra nada. Un Garmin caído devuelve [] y eso no
//      es "no hubo datos", es "no se sabe" — el mismo criterio que ya aplica
//      `garminActivitiesSync`.
// ============================================================================
import cloudStorage from './cloudStorage';

export const CARDIAC_KEY = 'garmin_cardiac_data';
export const SLEEP_KEY = 'garmin_sleep_data';
export const LAST_SYNC_KEY = 'garmin_last_sync';
export const CREDS_KEY = 'garmin_creds';

/** Evento con el que el resto de la app se entera de que hay dato nuevo. */
export const SYNC_COMPLETE_EVENT = 'garmin_sync_complete';

const readArray = (key) => {
  try {
    const parsed = JSON.parse(cloudStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Registros diarios de salud guardados (array; [] si no hay o está corrupto). */
export const readCardiac = () => readArray(CARDIAC_KEY);

/** Registros semanales de sueño guardados. */
export const readSleep = () => readArray(SLEEP_KEY);

/** Credenciales de Garmin, o null si no hay una pareja usable. */
export function readGarminCreds() {
  try {
    const creds = JSON.parse(cloudStorage.getItem(CREDS_KEY) || 'null');
    return creds?.username && creds?.password ? creds : null;
  } catch {
    return null;
  }
}

/** Mezcla por día (`date`), campo a campo y ordenada: el registro nuevo manda. */
export function mergeCardiac(prev, next) {
  const byDate = {};
  for (const r of [...(prev || []), ...(next || [])]) {
    if (!r?.date) continue;
    byDate[r.date] = { ...byDate[r.date], ...r };
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

/** Mezcla por semana (`weekStart`). El agregado semanal se sustituye entero. */
export function mergeSleep(prev, next) {
  const byWeek = {};
  for (const r of [...(prev || []), ...(next || [])]) {
    if (!r?.weekStart) continue;
    byWeek[r.weekStart] = { ...byWeek[r.weekStart], ...r };
  }
  return Object.values(byWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** Marca de tiempo legible del último sync (la que pinta GarminCardiac). */
export function stampLastSync(date = new Date()) {
  const stamp = date.toLocaleString('es-ES');
  cloudStorage.setItem(LAST_SYNC_KEY, stamp);
  return stamp;
}

/**
 * Persiste una respuesta de `/api/garmin/health/*` mezclada con lo guardado y
 * devuelve `{ cardiac, sleep, lastSync }` ya mezclados, para que quien llame
 * actualice su estado con el MISMO array que quedó almacenado.
 *
 * `replace: true` es el backfill largo, que ya trae el histórico acumulado y
 * sustituye en vez de mezclar. Una respuesta vacía nunca pisa lo que había.
 */
export function saveGarminHealth({ cardiac, sleep } = {}, { replace = false } = {}) {
  const prevCardiac = readCardiac();
  const prevSleep = readSleep();

  const incoming = Array.isArray(cardiac) ? cardiac : [];
  let finalCardiac = prevCardiac;
  if (incoming.length) {
    finalCardiac = replace ? mergeCardiac([], incoming) : mergeCardiac(prevCardiac, incoming);
    cloudStorage.setItem(CARDIAC_KEY, JSON.stringify(finalCardiac));
  } else if (!prevCardiac.length) {
    finalCardiac = [];
  }

  const incomingSleep = Array.isArray(sleep) ? sleep : [];
  let finalSleep = prevSleep;
  if (incomingSleep.length) {
    finalSleep = mergeSleep(replace ? [] : prevSleep, incomingSleep);
    cloudStorage.setItem(SLEEP_KEY, JSON.stringify(finalSleep));
  }

  return { cardiac: finalCardiac, sleep: finalSleep, lastSync: stampLastSync() };
}

/**
 * Cuántos días de salud pedir: desde el último registro guardado (con un día de
 * solape, porque el del propio día aún se está escribiendo en Garmin) y hasta 90;
 * sin histórico, el último mes. Incremental a propósito: pedir el año entero en
 * cada arranque es lo que dispara el rate-limit de Garmin.
 */
export function garminSyncDays({ fallback = 30, max = 90, now = Date.now() } = {}) {
  const stored = readCardiac();
  if (!stored.length) return fallback;
  const lastDate = stored.reduce((acc, r) => (r?.date > acc ? r.date : acc), stored[0].date);
  const last = new Date(lastDate);
  if (Number.isNaN(last.getTime())) return fallback;
  const diffDays = Math.ceil((now - last.getTime()) / 86400000) + 1;
  return Math.max(1, Math.min(diffDays, max));
}
