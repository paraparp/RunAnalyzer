// ============================================================================
// Buzón de incidencias/sugerencias del agente.
//
// Cuando un modelo trabaja con estos datos detecta cosas que el usuario no ve:
// una tool que devuelve un número imposible, una descripción ambigua que le hizo
// leer mal, un dato que falta. Antes eso se perdía en el chat. Aquí se guarda en
// Supabase (`user_storage`, clave `agent_feedback`) para poder revisarlo luego.
//
// Es un canal DISCRETO: no se anuncia en las `instructions` del servidor ni se
// mezcla con las tools de análisis, para que el modelo no lo use como cajón de
// sastre ni interrumpa la conversación. Solo escribe cuando encuentra algo real.
// ============================================================================
import { readKeyFresh, writeKey } from './mcp-store.js';

const FEEDBACK_KEY = 'agent_feedback';

// Tope del blob: son notas de texto, pero el almacén es una sola fila JSON y no
// puede crecer sin límite. Al pasarse se tiran las CERRADAS más antiguas primero
// (resolved/wontfix) y solo si aún sobra se tiran las abiertas más viejas.
const MAX_ENTRIES = 300;

export const CATEGORIES = ['data', 'tool', 'docs', 'ui', 'idea', 'other'];
export const SEVERITIES = ['low', 'medium', 'high'];
export const STATUSES = ['open', 'ack', 'resolved', 'wontfix'];

const CLOSED = new Set(['resolved', 'wontfix']);

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

/** Clave de deduplicado: mismo título, ignorando mayúsculas y espacios sobrantes. */
const dedupKey = (title) => String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function readFeedback(userId) {
  const list = await readKeyFresh(userId, FEEDBACK_KEY);
  return Array.isArray(list) ? list : [];
}

/** Recorta la lista al tope, sacrificando primero lo ya cerrado y más antiguo. */
function prune(list) {
  if (list.length <= MAX_ENTRIES) return list;
  const byAge = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const closed = list.filter((e) => CLOSED.has(e.status)).sort(byAge);
  const open = list.filter((e) => !CLOSED.has(e.status)).sort(byAge);
  const drop = new Set();
  let excess = list.length - MAX_ENTRIES;
  for (const e of closed) { if (excess-- <= 0) break; drop.add(e.id); }
  for (const e of open) { if (excess-- <= 0) break; drop.add(e.id); }
  return list.filter((e) => !drop.has(e.id));
}

const shape = (e, { include_detail = true } = {}) => ({
  id: e.id,
  title: e.title,
  category: e.category,
  severity: e.severity,
  status: e.status,
  tool: e.tool ?? null,
  activity_id: e.activity_id ?? null,
  // Cuántas veces se ha reportado lo mismo: una incidencia que reaparece pesa más
  // que una puntual, y el modelo no tiene memoria entre sesiones para saberlo.
  occurrences: e.occurrences || 1,
  created_at: e.created_at,
  updated_at: e.updated_at,
  last_seen_at: e.last_seen_at ?? e.created_at,
  ...(include_detail ? { detail: e.detail ?? null, note: e.note ?? null } : {}),
});

/**
 * Registra una incidencia o sugerencia. Sin `issue_id` crea una nueva; con él
 * hace MERGE parcial (para cambiar el estado o ampliar el detalle sin reenviar
 * todo). Si ya existe una ABIERTA con el mismo título, en vez de duplicarla se
 * le suma una ocurrencia y se refresca `last_seen_at`.
 */
export async function reportIssue(userId, {
  issue_id, title, detail, category, severity, status, tool, activity_id, note,
} = {}) {
  if (category != null && !CATEGORIES.includes(category)) {
    return { error: `category debe ser una de: ${CATEGORIES.join(', ')}` };
  }
  if (severity != null && !SEVERITIES.includes(severity)) {
    return { error: `severity debe ser una de: ${SEVERITIES.join(', ')}` };
  }
  if (status != null && !STATUSES.includes(status)) {
    return { error: `status debe ser uno de: ${STATUSES.join(', ')}` };
  }

  const list = await readFeedback(userId);
  const now = new Date().toISOString();

  let idx = issue_id ? list.findIndex((e) => String(e.id) === String(issue_id)) : -1;
  if (issue_id && idx < 0) return { error: `No existe la incidencia "${issue_id}"` };

  // Sin id explícito: ¿es la misma incidencia abierta que ya reportó otra sesión?
  let deduped = false;
  if (!issue_id && title) {
    const key = dedupKey(title);
    idx = list.findIndex((e) => !CLOSED.has(e.status) && dedupKey(e.title) === key);
    deduped = idx >= 0;
  }

  if (idx < 0 && !title) return { error: 'Falta `title` para crear una incidencia' };

  const prev = idx >= 0 ? list[idx] : {};
  const entry = {
    ...prev,
    id: prev.id || newId(),
    created_at: prev.created_at || now,
    updated_at: now,
    last_seen_at: now,
    title: title !== undefined ? title : prev.title,
    // Reportar lo mismo dos veces no pisa el detalle original: se acumula.
    detail: detail !== undefined && deduped && prev.detail && detail !== prev.detail
      ? `${prev.detail}\n---\n${detail}`
      : (detail !== undefined ? detail : prev.detail ?? null),
    category: category !== undefined ? category : (prev.category || 'other'),
    severity: severity !== undefined ? severity : (prev.severity || 'medium'),
    status: status !== undefined ? status : (prev.status || 'open'),
    tool: tool !== undefined ? tool : (prev.tool ?? null),
    activity_id: activity_id !== undefined ? String(activity_id) : (prev.activity_id ?? null),
    note: note !== undefined ? note : (prev.note ?? null),
    occurrences: (prev.occurrences || (idx >= 0 ? 1 : 0)) + (deduped ? 1 : (idx < 0 ? 1 : 0)),
  };

  if (idx >= 0) list[idx] = entry;
  else list.push(entry);

  const next = prune(list);
  await writeKey(userId, FEEDBACK_KEY, next);
  return {
    ok: true,
    created: idx < 0,
    deduped,
    total_open: next.filter((e) => !CLOSED.has(e.status)).length,
    issue: shape(entry),
  };
}

/**
 * Lee el buzón. Por defecto solo lo ABIERTO y sin el detalle largo, ordenado por
 * severidad y luego por la última vez que se vio.
 */
export async function listIssues(userId, {
  status, category, include_closed = false, include_detail = false, limit = 50,
} = {}) {
  const list = await readFeedback(userId);
  const rank = { high: 0, medium: 1, low: 2 };
  const kept = list
    .filter((e) => (status ? e.status === status : include_closed || !CLOSED.has(e.status)))
    .filter((e) => (category ? e.category === category : true))
    .sort((a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1)
      || String(b.last_seen_at || b.created_at || '').localeCompare(String(a.last_seen_at || a.created_at || '')));
  const capped = kept.slice(0, Math.min(200, Math.max(1, limit)));
  return {
    total: kept.length,
    total_stored: list.length,
    open: list.filter((e) => !CLOSED.has(e.status)).length,
    issues: capped.map((e) => shape(e, { include_detail })),
  };
}

/** Borra una incidencia por id (para limpiar ruido, no para "cerrarla"). */
export async function deleteIssue(userId, issueId) {
  const list = await readFeedback(userId);
  const next = list.filter((e) => String(e.id) !== String(issueId));
  if (next.length === list.length) return { error: `No existe la incidencia "${issueId}"` };
  await writeKey(userId, FEEDBACK_KEY, next);
  return { ok: true, deleted: String(issueId), remaining: next.length };
}
