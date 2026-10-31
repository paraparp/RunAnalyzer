// ============================================================================
// Histórico de lesiones desde el MCP.
//
// Es el MISMO dato que edita la app (`user_storage`, clave `injury_log`) y con la
// misma lógica (src/lib/injuryLog). Como en el diario, se escribe siempre sobre
// una copia fresca para no pisar lo que acabe de guardar la app.
// ============================================================================
import { readKey, readKeyFresh, writeKey } from './mcp-store.js';
import {
  INJURY_KEY, readInjuries, saveInjury, deleteInjury, injuryLabel, injuryDays,
} from '../../src/lib/injuryLog.js';
import { dayKey } from '../../src/lib/trainingLoad.js';

function memStorage(list) {
  let raw = JSON.stringify(list || []);
  return { getItem: () => raw, setItem: (_k, v) => { raw = v; } };
}

const shape = (i, todayISO) => ({
  ...i,
  label: injuryLabel(i),
  active: !i.end_date,
  days: injuryDays(i, todayISO),
});

/** Histórico completo, o solo las activas/terminadas con `status`. */
export async function listInjuries(userId, { status } = {}) {
  const todayISO = dayKey(new Date());
  const all = readInjuries(memStorage(await readKey(userId, INJURY_KEY)));
  const injuries = all
    .filter((i) => (status === 'active' ? !i.end_date : status === 'ended' ? !!i.end_date : true))
    .map((i) => shape(i, todayISO));
  return { total: all.length, active: all.filter((i) => !i.end_date).length, injuries };
}

/**
 * Crea un episodio o, con `id`, cambia solo los campos enviados. Terminar una
 * lesión es `{ id, end_date }`; `end_date: null` la reabre.
 */
export async function upsertInjury(userId, args = {}) {
  const todayISO = dayKey(new Date());
  const storage = memStorage(await readKeyFresh(userId, INJURY_KEY));
  let base = { start_date: todayISO };
  if (args.id) {
    base = readInjuries(storage).find((i) => i.id === args.id);
    if (!base) return { error: `No existe la lesión "${args.id}"` };
  }
  const { injury, list } = saveInjury(storage, { ...base, ...args });
  await writeKey(userId, INJURY_KEY, list);
  return { saved: shape(injury, todayISO) };
}

/** Borra un episodio. Es para errores: lo normal es ponerle fecha de fin. */
export async function removeInjury(userId, id) {
  const storage = memStorage(await readKeyFresh(userId, INJURY_KEY));
  if (!readInjuries(storage).some((i) => i.id === id)) return { error: `No existe la lesión "${id}"` };
  await writeKey(userId, INJURY_KEY, deleteInjury(storage, id));
  return { deleted: id };
}
