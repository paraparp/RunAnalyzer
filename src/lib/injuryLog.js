// ============================================================================
// injuryLog — histórico de lesiones: una fila por episodio, con inicio y fin.
//
// El diario (wellnessDiary) responde a "qué me duele hoy" y solo mira la última
// semana; aquí queda lo que dura: cuándo empezó cada lesión, cuándo acabó y qué
// fue. Nada caduca, y una recaída es un episodio nuevo para no perder las fechas
// del anterior.
//
// Un episodio:
//   { id, zone | null, side: 'L'|'R'|'C' | null, title | null,
//     start_date, end_date | null (sigue activa), note | null }
//
// Lo comparten la app y el MCP, cada uno con su almacén (misma clave).
// ============================================================================
import { BODY_ZONES, painLabel } from './wellnessDiary.js';

export const INJURY_KEY = 'injury_log';
export const INJURY_EVENT = 'injury-log-updated';

const ZONE_BY_ID = Object.fromEntries(BODY_ZONES.map((z) => [z.id, z]));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (v, max) => String(v ?? '').trim().slice(0, max) || null;

/** Activas primero; dentro de cada grupo, la que empezó más tarde primero. */
const byRecency = (a, b) => (
  Number(!!a.end_date) - Number(!!b.end_date) || b.start_date.localeCompare(a.start_date)
);

/** Episodios guardados, ordenados para mostrar. */
export function readInjuries(storage) {
  try {
    const arr = JSON.parse(storage.getItem(INJURY_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((i) => i?.id && i?.start_date).sort(byRecency) : [];
  } catch {
    return [];
  }
}

/** Limpia un episodio; lanza un Error con el motivo si no se puede guardar. */
export function normalizeInjury(input) {
  const zone = input.zone || null;
  if (zone && !ZONE_BY_ID[zone]) throw new Error(`Zona desconocida "${zone}".`);
  const title = text(input.title, 120);
  if (!zone && !title) throw new Error('Indica la zona o el nombre de la lesión.');
  if (!ISO_DAY.test(input.start_date || '')) throw new Error('La fecha de inicio es obligatoria (YYYY-MM-DD).');
  const end_date = input.end_date || null;
  if (end_date && !ISO_DAY.test(end_date)) throw new Error('La fecha de fin debe ser YYYY-MM-DD.');
  if (end_date && end_date < input.start_date) throw new Error('La fecha de fin no puede ser anterior a la de inicio.');

  let side = null;
  if (zone) {
    if (!ZONE_BY_ID[zone].bilateral) side = 'C';
    else if (input.side === 'L' || input.side === 'R') side = input.side;
  }
  return { id: input.id, zone, side, title, start_date: input.start_date, end_date, note: text(input.note, 1000) };
}

/** Crea o actualiza un episodio por id. Devuelve `{ injury, list }`. */
export function saveInjury(storage, input) {
  const injury = normalizeInjury({ ...input, id: input.id || crypto.randomUUID() });
  const list = [...readInjuries(storage).filter((i) => i.id !== injury.id), injury].sort(byRecency);
  storage.setItem(INJURY_KEY, JSON.stringify(list));
  return { injury, list };
}

/** Borra un episodio (para errores: terminar una lesión es ponerle fecha de fin). */
export function deleteInjury(storage, id) {
  const list = readInjuries(storage).filter((i) => i.id !== id);
  storage.setItem(INJURY_KEY, JSON.stringify(list));
  return list;
}

/** Nombre legible: el diagnóstico si lo hay, si no la zona. */
export function injuryLabel(i) {
  const where = i.zone ? painLabel({ zone: i.zone, side: i.side }) : null;
  return [i.title, where].filter(Boolean).join(' · ');
}

/** Días de duración, contando inicio y fin; una activa cuenta hasta hoy. */
export function injuryDays(i, todayISO) {
  const end = i.end_date || todayISO;
  const dayNumber = (iso) => Date.UTC(...iso.split('-').map((n, k) => (k === 1 ? Number(n) - 1 : Number(n)))) / 86400000;
  return Math.max(1, dayNumber(end) - dayNumber(i.start_date) + 1);
}
