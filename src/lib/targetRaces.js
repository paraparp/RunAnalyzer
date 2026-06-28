import cloudStorage from './cloudStorage';

// ============================================================================
// targetRaces — lista de carreras/eventos objetivo del usuario.
//
// Se guarda como un blob JSON en cloudStorage (clave 'target_races'), igual que
// el resto de datos de la app, así que se sincroniza con Supabase por usuario.
// Cada carrera:
//   { id, name, date: 'YYYY-MM-DD', distance: '5k'|'10k'|'21k'|'42k', goalTimeMin }
// Al cambiar la lista se emite un evento 'target_races_changed' para que otras
// vistas (p.ej. el planificador) refresquen su selector.
// ============================================================================

const KEY = 'target_races';
export const TARGET_RACES_EVENT = 'target_races_changed';

// Distancias soportadas (km), alineadas con el selector del planificador.
export const DISTANCES = {
  '5k': 5,
  '10k': 10,
  '21k': 21.0975,
  '42k': 42.195,
};

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

/** Crea (si no trae id) o actualiza una carrera. Devuelve la lista resultante. */
export function saveTargetRace(race) {
  const list = getTargetRaces();
  if (race.id) {
    const idx = list.findIndex(r => r.id === race.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...race };
    else list.push(race);
  } else {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now());
    list.push({ ...race, id });
  }
  // Orden cronológico: las próximas primero.
  list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  persist(list);
  return list;
}

export function deleteTargetRace(id) {
  const list = getTargetRaces().filter(r => r.id !== id);
  persist(list);
  return list;
}

/** "3:30:00" / "45:00" / "22" -> minutos (float). null si no es válido. */
export function parseTimeToMinutes(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':').map(p => Number(p));
    if (parts.some(n => Number.isNaN(n))) return null;
    if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
    if (parts.length === 2) return parts[0] + parts[1] / 60;
    return null;
  }
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** minutos (float) -> "H:MM:SS" o "MM:SS". */
export function formatMinutes(min) {
  if (min == null || Number.isNaN(min)) return '';
  const totalSec = Math.round(min * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** La próxima carrera objetivo (hoy o futura, la más cercana). null si no hay. */
export function getNextTargetRace() {
  return getTargetRaces()
    .filter(r => { const d = daysUntil(r.date); return d != null && d >= 0; })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0] || null;
}

/** Días hasta la fecha (negativo si ya pasó). null si no hay fecha válida. */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}
