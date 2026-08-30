import cloudStorage from './cloudStorage';
import { DISTANCE_KM } from './raceDistances';
import { parseTimeToMinutes, formatMinutes, daysUntil } from './timeFormat';

// Se re-exportan para no cambiar el punto de importación de las vistas, que
// piden estos helpers junto con el resto de la API de carreras objetivo.
export { parseTimeToMinutes, formatMinutes, daysUntil };

// ============================================================================
// targetRaces — lista de carreras/eventos objetivo del usuario.
//
// Se guarda como un blob JSON en cloudStorage (clave 'target_races'), igual que
// el resto de datos de la app, así que se sincroniza con Supabase por usuario.
// Cada carrera:
//   { id, name, date: 'YYYY-MM-DD', distance: '5k'|'10k'|'21k'|'42k', goalTimeMin,
//     plan?: string, primary?: true }
//
// Una sola carrera puede ser la PRINCIPAL (`primary: true`): es el objetivo en
// el que se basa todo lo demás (banner, planificador, predictor, insights). Las
// demás quedan como informativas. Si nadie la ha marcado, la principal es por
// defecto la próxima carrera futura, para no romper el comportamiento anterior.
// Al cambiar la lista se emite un evento 'target_races_changed' para que otras
// vistas (p.ej. el planificador) refresquen su selector.
// ============================================================================

const KEY = 'target_races';
export const TARGET_RACES_EVENT = 'target_races_changed';

// Distancias soportadas (km). La tabla oficial vive en lib/raceDistances, que
// es la misma que usan el predictor, el planificador y la curva de esfuerzos.
export const DISTANCES = DISTANCE_KM;

export function getTargetRaces() {
  try {
    const raw = cloudStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list) {
  cloudStorage.setItem(KEY, JSON.stringify(list));
  try { window.dispatchEvent(new Event(TARGET_RACES_EVENT)); } catch { /* ignore */ }
}

/**
 * Fija explícitamente la principal si no había ninguna marcada, para que guardar
 * una carrera no le cambie el puesto a la que YA mandaba: sin marca explícita la
 * principal es la próxima futura, así que añadir una carrera más cercana se la
 * robaría en silencio. Si no había ninguna candidata (lista vacía), la principal
 * pasa a ser la recién creada.
 */
function ensurePrimary(list, prevList, fallbackId) {
  if (list.some(r => r.primary)) return list;   // ya hay una marcada: se respeta
  const keepId = nextUpcomingOf(prevList)?.id ?? fallbackId;
  if (!keepId) return list;
  return list.map(r => (r.id === keepId ? { ...r, primary: true } : r));
}

/**
 * Hora de salida oficial ("07:30"): normaliza a HH:MM 24h, '' si se borra y
 * null si no es una hora válida. El plan cuelga de ella el desayuno, la salida
 * de casa y el calentamiento, así que conviene guardarla junto a la fecha.
 */
export function normalizeStartTime(str) {
  if (str == null) return '';
  const s = String(str).trim();
  if (!s) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Sella `planUpdatedAt` sólo cuando el TEXTO del plan cambia: editar el nombre o
 * el objetivo no debe hacer parecer que el plan es más reciente de lo que es.
 */
export function stampPlan(next, prev) {
  const before = typeof prev?.plan === 'string' ? prev.plan : '';
  const after = typeof next.plan === 'string' ? next.plan : '';
  if (after === before) return next;
  return { ...next, planUpdatedAt: after.trim() ? new Date().toISOString() : undefined };
}

/** Crea (si no trae id) o actualiza una carrera. Devuelve la lista resultante. */
export function saveTargetRace(race) {
  const list = getTargetRaces();
  const prevList = list.map(r => ({ ...r }));
  let newId = null;
  if (race.id) {
    const idx = list.findIndex(r => r.id === race.id);
    if (idx >= 0) list[idx] = stampPlan({ ...list[idx], ...race }, list[idx]);
    else list.push(stampPlan(race, null));
  } else {
    newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now());
    list.push(stampPlan({ ...race, id: newId }, null));
  }
  // Orden cronológico: las próximas primero.
  list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  persist(ensurePrimary(list, prevList, newId));
  return getTargetRaces();
}

/**
 * Marca una carrera como principal (y desmarca el resto). Con `id` null se
 * quita la marca y se vuelve al comportamiento por defecto (la más próxima).
 */
export function setPrimaryTargetRace(id) {
  const list = getTargetRaces().map(r => (
    r.id === id ? { ...r, primary: true } : (r.primary ? { ...r, primary: false } : r)
  ));
  persist(list);
  return list;
}

export function deleteTargetRace(id) {
  const list = getTargetRaces().filter(r => r.id !== id);
  persist(list);
  return list;
}

/** La más próxima (hoy o futura) de una lista dada. null si no hay ninguna. */
function nextUpcomingOf(list) {
  return list
    .filter(r => { const d = daysUntil(r.date); return d != null && d >= 0; })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0] || null;
}

/** La próxima carrera objetivo (hoy o futura, la más cercana). null si no hay. */
export function getNextTargetRace() {
  return nextUpcomingOf(getTargetRaces());
}

/**
 * La carrera OBJETIVO PRINCIPAL: la marcada por el usuario y, si no hay ninguna
 * marcada, la próxima futura. Es la que deben usar el planificador, el predictor
 * y los insights; el resto de carreras son informativas.
 */
export function getPrimaryTargetRace() {
  return getTargetRaces().find(r => r.primary) || getNextTargetRace();
}
