// Imágenes adjuntas al chat (capturas de Garmin, Strava, un plan...).
// Se reducen en el navegador antes de enviarlas: el texto de una captura sigue
// legible a 1600 px y cada imagen queda en unos cientos de KB.
export const MAX_CHAT_IMAGES = 4;
const MAX_SIDE = 1600;
const QUALITY = 0.85;
const ACCEPTED = /^image\/(png|jpe?g|webp|gif|heic|heif|bmp)$/i;

export const isImageFile = (f) => !!f && ACCEPTED.test(f.type || '');

const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = src;
});

/** File → { id, name, mediaType, base64, dataUrl } reducida a JPEG. */
export async function fileToChatImage(file) {
    if (!isImageFile(file)) throw new Error('Formato no soportado');
    const url = URL.createObjectURL(file);
    try {
        const img = await loadImage(url);
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // PNG con transparencia → fondo blanco en JPEG
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
        return {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: file.name || 'captura',
            mediaType: 'image/jpeg',
            base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
            dataUrl,
        };
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Historial → mensajes para la API. Solo viajan las imágenes más recientes
 * (MAX_CHAT_IMAGES en total) para no pasarse del límite de la petición; las
 * anteriores se sustituyen por una nota.
 */
export function toApiMessages(history) {
    let budget = MAX_CHAT_IMAGES;
    const out = [];
    for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        const imgs = m.role === 'user' ? (m.images || []) : [];
        if (!imgs.length) { out.unshift({ role: m.role, content: m.content || '' }); continue; }
        const sent = imgs.slice(0, budget);
        budget -= sent.length;
        const note = sent.length < imgs.length ? `\n(${imgs.length - sent.length} imagen(es) anterior(es) ya no se adjuntan)` : '';
        const text = (m.content || 'Analiza esta imagen.') + note;
        out.unshift(sent.length
            ? { role: 'user', content: [{ type: 'text', text }, ...sent.map(im => ({ type: 'image', image: im.base64, mediaType: im.mediaType }))] }
            : { role: 'user', content: text });
    }
    return out;
}
