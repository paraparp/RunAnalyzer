import cloudStorage from './cloudStorage';

// Clave bajo la que se persiste el diccionario { [gear_id]: urlOrDataUrl }
export const SHOE_PHOTOS_KEY = 'shoe_photos';

/**
 * Valida si una cadena es una URL HTTP(S) válida o una DataURL de imagen.
 */
export function isValidImageUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  
  if (trimmed.startsWith('data:image/')) {
    return /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml|avif);base64,[A-Za-z0-9+/=]+$/.test(trimmed);
  }
  
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normaliza una entrada de foto (string o { url, zoom, x, y }) a objeto estándar
 * para renderizar con zoom y encuadre CSS.
 */
export function normalizeShoePhoto(photo) {
  if (!photo) return null;
  if (typeof photo === 'string') {
    if (!isValidImageUrl(photo)) return null;
    return { url: photo.trim(), zoom: 1, x: 0, y: 0, flipH: false };
  }
  if (typeof photo === 'object' && isValidImageUrl(photo.url)) {
    const zoom = Number(photo.zoom);
    const x = Number(photo.x);
    const y = Number(photo.y);
    const flipH = Boolean(photo.flipH);
    return {
      url: photo.url.trim(),
      zoom: Number.isFinite(zoom) && zoom >= 1 && zoom <= 3 ? Math.round(zoom * 100) / 100 : 1,
      x: Number.isFinite(x) && Math.abs(x) <= 60 ? Math.round(x * 10) / 10 : 0,
      y: Number.isFinite(y) && Math.abs(y) <= 60 ? Math.round(y * 10) / 10 : 0,
      flipH
    };
  }
  return null;
}

/**
 * Limpia y filtra el diccionario de fotos para que solo queden entradas válidas.
 * Si no tiene zoom, pan ni flip personalizados, almacena la URL como string directo (más compacto).
 */
export function sanitizeShoePhotos(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cleaned = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!id || typeof id !== 'string' || !id.trim()) continue;
    const normalized = normalizeShoePhoto(entry);
    if (!normalized) continue;

    if (normalized.zoom === 1 && normalized.x === 0 && normalized.y === 0 && !normalized.flipH) {
      cleaned[id.trim()] = normalized.url;
    } else {
      cleaned[id.trim()] = normalized;
    }
  }
  return cleaned;
}

/**
 * Lee las fotos guardadas en el almacenamiento compartido.
 */
export function readShoePhotos(storage = cloudStorage) {
  try {
    const item = storage.getItem(SHOE_PHOTOS_KEY);
    if (!item) return {};
    return sanitizeShoePhotos(JSON.parse(item));
  } catch {
    return {};
  }
}

/**
 * Comprime un archivo de imagen en el navegador usando un elemento Canvas.
 * Genera un DataURL WebP (o JPEG si no hay soporte) acotado a maxWidth x maxHeight.
 * 
 * @param {File|Blob} file 
 * @param {object} options
 * @returns {Promise<{ dataUrl: string, sizeBytes: number, width: number, height: number }>}
 */
export async function compressImageFile(file, { maxWidth = 400, maxHeight = 400, quality = 0.82 } = {}) {
  if (!file || !(file instanceof Blob)) {
    throw new Error('El archivo proporcionado no es una imagen válida.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Error al leer el archivo de imagen.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen.'));
      img.onload = () => {
        let { width, height } = img;
        
        // Calcular dimensiones manteniendo el aspect ratio
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('No se pudo inicializar el contexto de renderizado.'));
        }

        // Renderizado limpio
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Intentar WebP primero por su compresión superior; fallback a JPEG
        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        // Estimar bytes del base64
        const base64Len = dataUrl.split(',')[1]?.length || 0;
        const sizeBytes = Math.round((base64Len * 3) / 4);

        resolve({ dataUrl, sizeBytes, width, height });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Marcas deportivas comunes con sus siglas, nombre normalizado y esquema cromático
 * para placeholders atractivos cuando el usuario aún no ha puesto foto.
 */
const BRAND_RULES = [
  { match: /\bnike\b/i, name: 'Nike', short: 'NK', bg: 'bg-orange-500/10', text: 'text-orange-600', border: 'border-orange-200' },
  { match: /\badidas\b|\badizero\b/i, name: 'Adidas', short: 'ADI', bg: 'bg-slate-900/10', text: 'text-slate-800', border: 'border-slate-300' },
  { match: /\basics\b/i, name: 'Asics', short: 'ASC', bg: 'bg-blue-600/10', text: 'text-blue-600', border: 'border-blue-200' },
  { match: /\bhoka\b/i, name: 'Hoka', short: 'HOK', bg: 'bg-cyan-600/10', text: 'text-cyan-600', border: 'border-cyan-200' },
  { match: /\bsaucony\b/i, name: 'Saucony', short: 'SCY', bg: 'bg-rose-600/10', text: 'text-rose-600', border: 'border-rose-200' },
  { match: /\bbrooks\b/i, name: 'Brooks', short: 'BRK', bg: 'bg-indigo-600/10', text: 'text-indigo-600', border: 'border-indigo-200' },
  { match: /\bnew\s*balance\b|\b\s*nb\s*\b/i, name: 'New Balance', short: 'NB', bg: 'bg-red-600/10', text: 'text-red-600', border: 'border-red-200' },
  { match: /\bpuma\b/i, name: 'Puma', short: 'PUM', bg: 'bg-emerald-600/10', text: 'text-emerald-600', border: 'border-emerald-200' },
  { match: /\bon\b|\bcloud\b/i, name: 'On Running', short: 'ON', bg: 'bg-zinc-800/10', text: 'text-zinc-800', border: 'border-zinc-300' },
  { match: /\baltra\b/i, name: 'Altra', short: 'ALT', bg: 'bg-amber-600/10', text: 'text-amber-600', border: 'border-amber-200' },
  { match: /\bsalomon\b/i, name: 'Salomon', short: 'SAL', bg: 'bg-stone-800/10', text: 'text-stone-800', border: 'border-stone-300' },
  { match: /\bmizuno\b/i, name: 'Mizuno', short: 'MIZ', bg: 'bg-sky-700/10', text: 'text-sky-700', border: 'border-sky-200' },
];

/**
 * Deduce la información de marca de un nombre para mostrar un placeholder elegante.
 */
export function getBrandInfo(shoeName = '') {
  const str = String(shoeName).trim();
  for (const rule of BRAND_RULES) {
    if (rule.match.test(str)) {
      return {
        brand: rule.name,
        short: rule.short,
        bg: rule.bg,
        text: rule.text,
        border: rule.border
      };
    }
  }

  // Fallback genérico tomando las dos primeras iniciales
  const words = str.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  const initials = words.length >= 2 
    ? (words[0][0] + words[1][0]).toUpperCase() 
    : (words[0] ? words[0].slice(0, 2).toUpperCase() : '👟');

  return {
    brand: words[0] || 'Zapatilla',
    short: initials,
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200'
  };
}
