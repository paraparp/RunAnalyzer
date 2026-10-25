// ============================================================================
// Diario de molestias y bienestar desde el MCP.
//
// Es el MISMO dato que edita la pantalla Diario de la app (`user_storage`, clave
// `wellness_diary`) y con la misma lógica (src/lib/wellnessDiary): lo que anote
// el agente aparece en la app y entra en el índice de lesión, y al revés.
//
// La lectura parte siempre de una copia fresca (readKeyFresh): reescribir el
// blob desde una copia cacheada podría pisar lo que acaba de guardar la app.
// ============================================================================
import { readKey, readKeyFresh, writeKey } from './mcp-store.js';
import {
  DIARY_KEY, BODY_ZONES, readDiary, saveEntry, subjectiveRisk, diaryRecommendations,
} from '../../src/lib/wellnessDiary.js';
import { dayKey } from '../../src/lib/trainingLoad.js';

const ZONES = new Map(BODY_ZONES.map((z) => [z.id, z]));
export const ZONE_IDS = BODY_ZONES.map((z) => z.id);

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
};

// Adaptador síncrono tipo localStorage sobre el valor ya leído: así se reutilizan
// readDiary/saveEntry tal cual, sin duplicar normalización ni orden.
function memStorage(entries) {
  let raw = JSON.stringify(entries || []);
  return { getItem: () => raw, setItem: (_k, v) => { raw = v; } };
}

/** Rechaza zonas desconocidas y molestias bilaterales sin lado (antes se asumía la derecha). */
function validatePains(pains) {
  for (const p of pains || []) {
    const z = ZONES.get(p?.zone);
    if (!z) throw new Error(`Zona desconocida "${p?.zone}". Válidas: ${ZONE_IDS.join(', ')}`);
    if (z.bilateral && p.side !== 'L' && p.side !== 'R') {
      throw new Error(`"${p.zone}" tiene lado: indica side L o R.`);
    }
  }
}

/** Estado subjetivo de la última semana (o null si no hay nada anotado). */
export function wellnessSnapshot(entries, todayISO) {
  const risk = subjectiveRisk(entries, todayISO);
  if (!risk) return null;
  return { ...risk, recommendations: diaryRecommendations(risk) };
}

/**
 * Guarda la entrada de un día. Por defecto FUSIONA con lo ya anotado ese día:
 * las molestias se suman por zona+lado (level 0 la quita) y los campos no
 * enviados se conservan. `replace: true` sustituye la entrada entera.
 */
export async function logWellness(userId, args = {}) {
  const todayISO = dayKey(new Date());
  const date = args.date || todayISO;
  validatePains(args.pains);

  const storage = memStorage(await readKeyFresh(userId, DIARY_KEY));
  const prev = readDiary(storage).find((e) => e.date === date);
  const base = args.replace || !prev ? { pains: [] } : prev;

  const pains = new Map(base.pains.map((p) => [`${p.zone}:${p.side}`, p]));
  for (const p of args.pains || []) {
    const side = ZONES.get(p.zone).bilateral ? p.side : 'C';
    pains.set(`${p.zone}:${side}`, { zone: p.zone, side, level: p.level });
  }
  const pick = (k) => (args[k] !== undefined ? args[k] : base[k]);
  const next = saveEntry(storage, {
    date,
    pains: [...pains.values()],
    rpe: pick('rpe'), mood: pick('mood'), stress: pick('stress'), note: pick('note'),
  });
  await writeKey(userId, DIARY_KEY, next);

  const saved = next.find((e) => e.date === date) || null;
  return {
    saved,
    deleted: !saved, // la entrada quedó vacía y se borró
    status: wellnessSnapshot(next, todayISO),
  };
}

/** Entradas en un rango (por defecto los últimos 28 días) y el estado de la última semana. */
export async function getWellnessDiary(userId, { from, to } = {}) {
  const todayISO = dayKey(new Date());
  const entries = readDiary(memStorage(await readKey(userId, DIARY_KEY)));
  const lo = from || addDays(to || todayISO, -27);
  const hi = to || todayISO;
  return {
    range: { from: lo, to: hi },
    total_entries: entries.length,
    entries: entries.filter((e) => e.date >= lo && e.date <= hi),
    status: wellnessSnapshot(entries, todayISO),
  };
}

/** Solo el estado de hoy, para adjuntarlo a readiness y alertas. Nunca rompe la tool que lo usa. */
export async function getWellnessStatus(userId) {
  try {
    return wellnessSnapshot(readDiary(memStorage(await readKey(userId, DIARY_KEY))), dayKey(new Date()));
  } catch {
    return null;
  }
}
