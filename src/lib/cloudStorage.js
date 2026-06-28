import { supabase } from './supabase';

// ============================================================================
// cloudStorage — reemplazo de localStorage respaldado por Supabase.
//
// localStorage es SÍNCRONO y se usa en inicializadores de useState y durante el
// render en muchos componentes. Supabase es asíncrono. Para no reescribir esa
// lógica, mantenemos una CACHÉ EN MEMORIA que se hidrata una sola vez tras el
// login (await hydrate()) y exponemos la misma API que localStorage:
//   getItem(key) -> string | null   (lee de la caché, síncrono)
//   setItem(key, value)             (actualiza caché + upsert async write-through)
//   removeItem(key)                 (actualiza caché + delete async)
//
// Los valores son strings, exactamente como en localStorage, así que el código
// que hacía JSON.parse(localStorage.getItem(...)) sigue funcionando igual.
// ============================================================================

// Claves que se migran desde localStorage a la nube la primera vez.
// `app_language` se queda en localStorage (es preferencia de dispositivo y se
// necesita antes del login, en la landing).
const MIGRATED_KEYS = [
  'stravaData',
  'garmin_cardiac_data',
  'garmin_sleep_data',
  'garmin_last_sync',
  'garmin_creds',
  'garminRestHR',
  'ai_insights_model',
  'ai_weekly_target',
  'ai_goal_distance',
  'ai_goal_pace',
  'ai_goal_date',
  'ai_insights_cache',
  'ai_insights_backup',
  'runqa_seed',
  'runqa_model',
  'racepredictor_model',
  'planner_model',
];

// Claves de dispositivo: se mantienen en localStorage real (síncrono y disponible
// antes del login, p.ej. el idioma en la landing). No se suben a la nube.
const DEVICE_KEYS = new Set(['app_language']);

const cache = new Map();
let currentUserId = null;
let hydrated = false;

/** ¿Está la caché lista para lecturas síncronas? */
export function isHydrated() {
  return hydrated;
}

// Escrituras en vuelo, para poder esperarlas con flush() antes de recargar/navegar.
const pending = new Set();
function track(promise) {
  pending.add(promise);
  promise.finally(() => pending.delete(promise));
  return promise;
}

/** Espera a que terminen todas las escrituras pendientes en la nube. */
export async function flush() {
  await Promise.allSettled([...pending]);
}

async function upsert(key, value) {
  if (!currentUserId) return;
  const { error } = await supabase
    .from('user_storage')
    .upsert(
      { user_id: currentUserId, key, value },
      { onConflict: 'user_id,key' }
    );
  if (error) console.warn(`cloudStorage upsert "${key}" falló:`, error.message);
}

async function removeRemote(key) {
  if (!currentUserId) return;
  const { error } = await supabase
    .from('user_storage')
    .delete()
    .eq('user_id', currentUserId)
    .eq('key', key);
  if (error) console.warn(`cloudStorage delete "${key}" falló:`, error.message);
}

/**
 * Carga todas las filas del usuario en la caché. Si la nube está vacía pero hay
 * datos en localStorage (primer arranque tras la migración), los sube una vez.
 */
export async function hydrate(userId) {
  currentUserId = userId;
  cache.clear();
  hydrated = false;

  const { data, error } = await supabase
    .from('user_storage')
    .select('key, value')
    .eq('user_id', userId);

  if (error) {
    console.warn('cloudStorage hydrate falló:', error.message);
  } else {
    for (const row of data ?? []) cache.set(row.key, row.value);
  }

  // Migración inicial: subir lo que quede en localStorage y aún no esté en la nube.
  const toMigrate = [];
  for (const key of MIGRATED_KEYS) {
    if (cache.has(key)) continue;
    let local = null;
    try { local = localStorage.getItem(key); } catch { /* ignore */ }
    if (local != null) {
      cache.set(key, local);
      toMigrate.push({ user_id: userId, key, value: local });
    }
  }
  if (toMigrate.length) {
    const { error: migErr } = await supabase
      .from('user_storage')
      .upsert(toMigrate, { onConflict: 'user_id,key' });
    if (migErr) console.warn('cloudStorage migración inicial falló:', migErr.message);
    else console.log(`cloudStorage: migradas ${toMigrate.length} claves desde localStorage`);
  }

  hydrated = true;
}

/** Vacía la caché en memoria (al cerrar sesión). No borra datos en la nube. */
export function reset() {
  cache.clear();
  currentUserId = null;
  hydrated = false;
}

export const cloudStorage = {
  getItem(key) {
    if (DEVICE_KEYS.has(key)) {
      try { return localStorage.getItem(key); } catch { return null; }
    }
    return cache.has(key) ? cache.get(key) : null;
  },
  setItem(key, value) {
    const str = String(value);
    if (DEVICE_KEYS.has(key)) {
      try { localStorage.setItem(key, str); } catch { /* ignore */ }
      return;
    }
    cache.set(key, str);
    // write-through en segundo plano; el valor ya está en memoria.
    track(upsert(key, str));
  },
  removeItem(key) {
    if (DEVICE_KEYS.has(key)) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return;
    }
    cache.delete(key);
    track(removeRemote(key));
  },
};

export default cloudStorage;
