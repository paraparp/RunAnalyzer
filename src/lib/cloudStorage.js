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
let degraded = false; // true cuando Supabase no responde y trabajamos con el espejo local

/** ¿Está la caché lista para lecturas síncronas? */
export function isHydrated() {
  return hydrated;
}

/**
 * ¿Estamos en modo degradado (Supabase inalcanzable, p.ej. HTTP 522)? La app
 * sigue funcionando con la copia en localStorage, pero las escrituras a la nube
 * no se están persistiendo. El UI puede usar esto para avisar al usuario.
 */
export function isDegraded() {
  return degraded;
}

// Suscripción reactiva para que un banner del UI se actualice al cambiar el estado.
const degradedListeners = new Set();
export function onDegradedChange(cb) {
  degradedListeners.add(cb);
  return () => degradedListeners.delete(cb);
}
function setDegraded(v) {
  if (degraded === v) return;
  degraded = v;
  for (const cb of degradedListeners) { try { cb(v); } catch { /* ignore */ } }
}

// ── Resiliencia ante caídas de Supabase (5xx/522) ────────────────────────────
// 1) Reintento con backoff en la lectura inicial (los 5xx suelen ser transitorios).
// 2) Espejo en localStorage: cada valor de la nube se copia también localmente,
//    para que un fallo de red no deje la app sin datos tras recargar.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, { tries = 3, base = 400 } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await fn();
    if (!error) return { data, error: null };
    lastErr = error;
    if (i < tries - 1) await sleep(base * 2 ** i); // 400 ms, 800 ms
  }
  return { data: null, error: lastErr };
}

function mirrorLocal(key, value) {
  try { localStorage.setItem(key, value); } catch { /* quota / modo privado */ }
}
function mirrorRemoveLocal(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

// Escrituras en vuelo, para poder esperarlas con flush() antes de recargar/navegar.
const pending = new Set();
function track(promise) {
  pending.add(promise);
  promise.finally(() => pending.delete(promise));
  return promise;
}

// ── Coalescing de escrituras (protección de Disk IO) ─────────────────────────
// Blobs grandes como `stravaData` (cientos de actividades, varios MB en UNA fila
// de Postgres) se reescriben en ráfagas: p.ej. el enriquecido de splits hace
// hasta 25 setItem seguidos. Sin coalescing eso son 25 upserts multi-MB → WAL +
// tuplas muertas + autovacuum → agota el Disk IO Budget del compute (→ 522).
// Debounce por clave + dirty-check reducen esa ráfaga a UN único upsert real.
const WRITE_DEBOUNCE_MS = 2000;
const lastPersisted = new Map(); // clave -> último string ya confirmado en la nube
const writeTimers = new Map();   // clave -> id de timeout debounced

function fireUpsert(key) {
  const value = cache.get(key);
  if (value == null) return;
  if (lastPersisted.get(key) === value) return; // sin cambios: no se toca el disco
  lastPersisted.set(key, value);
  track(upsert(key, value));
}

function scheduleUpsert(key) {
  if (writeTimers.has(key)) clearTimeout(writeTimers.get(key));
  const timer = setTimeout(() => { writeTimers.delete(key); fireUpsert(key); }, WRITE_DEBOUNCE_MS);
  writeTimers.set(key, timer);
}

/** Espera a que terminen todas las escrituras pendientes en la nube. */
export async function flush() {
  // Forzar YA las escrituras debounced pendientes antes de esperarlas.
  for (const [key, timer] of writeTimers) { clearTimeout(timer); fireUpsert(key); }
  writeTimers.clear();
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
  if (error) {
    setDegraded(true);
    console.warn(`cloudStorage upsert "${key}" falló (guardado local):`, error.message);
  } else {
    setDegraded(false);
  }
}

async function removeRemote(key) {
  if (!currentUserId) return;
  const { error } = await supabase
    .from('user_storage')
    .delete()
    .eq('user_id', currentUserId)
    .eq('key', key);
  if (error) {
    setDegraded(true);
    console.warn(`cloudStorage delete "${key}" falló:`, error.message);
  }
}

/**
 * Carga todas las filas del usuario en la caché. Si la nube está vacía pero hay
 * datos en localStorage (primer arranque tras la migración), los sube una vez.
 */
export async function hydrate(userId) {
  currentUserId = userId;
  cache.clear();
  hydrated = false;
  setDegraded(false);

  const { data, error } = await withRetry(() =>
    supabase.from('user_storage').select('key, value').eq('user_id', userId)
  );

  if (error) {
    // Supabase inalcanzable tras varios reintentos (p.ej. 522). Degradamos a la
    // copia local para que la app siga usable con los últimos datos conocidos.
    setDegraded(true);
    console.warn('cloudStorage hydrate falló tras reintentos, usando espejo local:', error.message);
    for (const key of MIGRATED_KEYS) {
      const local = readLocal(key);
      if (local != null) cache.set(key, local);
    }
    hydrated = true;
    return;
  }

  for (const row of data ?? []) {
    cache.set(row.key, row.value);
    lastPersisted.set(row.key, row.value); // ya está en la nube: no reescribir si no cambia
    mirrorLocal(row.key, row.value);        // refresca el espejo local para futuras caídas
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
    else {
      for (const row of toMigrate) lastPersisted.set(row.key, row.value);
      console.log(`cloudStorage: migradas ${toMigrate.length} claves desde localStorage`);
    }
  }

  hydrated = true;
}

/** Vacía la caché en memoria (al cerrar sesión). No borra datos en la nube. */
export function reset() {
  for (const timer of writeTimers.values()) clearTimeout(timer);
  writeTimers.clear();
  lastPersisted.clear();
  cache.clear();
  currentUserId = null;
  hydrated = false;
  setDegraded(false);
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
    if (cache.get(key) === str) return; // sin cambios: ni memoria ni disco ni red
    cache.set(key, str);
    mirrorLocal(key, str);   // respaldo local: sobrevive a caídas de Supabase
    scheduleUpsert(key);     // debounced + dirty-check: coalesce ráfagas de blobs grandes
  },
  removeItem(key) {
    if (DEVICE_KEYS.has(key)) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return;
    }
    cache.delete(key);
    mirrorRemoveLocal(key);
    if (writeTimers.has(key)) { clearTimeout(writeTimers.get(key)); writeTimers.delete(key); }
    lastPersisted.delete(key);
    track(removeRemote(key));
  },
};

export default cloudStorage;
