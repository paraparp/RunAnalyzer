// Historial del chat (RunQA): conversaciones de los últimos 7 días.
// Se guarda como blob JSON en cloudStorage (clave 'chat_history'), igual que el
// resto de datos de la app, así que se sincroniza con Supabase por usuario.
// Cada conversación: { id, title, updatedAt (ms), messages: [{ role, content, timestamp (ISO) }] }
import cloudStorage from './cloudStorage';

const KEY = 'chat_history';
export const HISTORY_DAYS = 7;
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES = 40;

const cutoff = (now = Date.now()) => now - HISTORY_DAYS * 864e5;

function read() {
    try {
        const list = JSON.parse(cloudStorage.getItem(KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch { return []; }
}

function write(list) {
    try { cloudStorage.setItem(KEY, JSON.stringify(list)); } catch { /* cuota o sin sesión: el chat sigue funcionando */ }
}

/** Conversaciones de los últimos 7 días, la más reciente primero. Purga las viejas. */
export function listConversations(now = Date.now()) {
    const all = read();
    const fresh = all.filter(c => c?.updatedAt >= cutoff(now) && Array.isArray(c.messages) && c.messages.length);
    if (fresh.length !== all.length) write(fresh);
    return fresh.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const newConversationId = () =>
    (globalThis.crypto?.randomUUID?.() || `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

const titleFrom = (messages) => {
    const first = messages.find(m => m.role === 'user')?.content || 'Conversación';
    const t = first.replace(/\s+/g, ' ').trim();
    return t.length > 70 ? `${t.slice(0, 67)}…` : t;
};

/** Guarda (crea o actualiza) una conversación. Ignora las vacías. */
export function saveConversation(id, messages, now = Date.now()) {
    const clean = (messages || [])
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-MAX_MESSAGES)
        .map(m => ({
            role: m.role,
            content: m.content,
            timestamp: (m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp || now)).toISOString(),
            // Las imágenes no se guardan (pesan demasiado para cloudStorage): solo cuántas había.
            ...((m.images?.length || m.imageCount) ? { imageCount: m.images?.length || m.imageCount } : {}),
        }));
    if (!id || !clean.some(m => m.role === 'assistant')) return;
    const others = read().filter(c => c.id !== id && c.updatedAt >= cutoff(now));
    const conv = { id, title: titleFrom(clean), updatedAt: now, messages: clean };
    write([conv, ...others].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS));
}

export function deleteConversation(id) {
    write(read().filter(c => c.id !== id));
}

/** Mensajes listos para el estado del chat (timestamps como Date). */
export const restoreMessages = (conv) =>
    (conv?.messages || []).map(m => ({ ...m, timestamp: new Date(m.timestamp) }));

/** "Hoy", "Ayer" o el día de la semana, para agrupar la lista. */
export function dayLabel(ts, now = Date.now()) {
    const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const diff = Math.round((day(now) - day(ts)) / 864e5);
    if (diff <= 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    return new Date(ts).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
}
