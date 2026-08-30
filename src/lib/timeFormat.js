// ============================================================================
// timeFormat — parseo y formateo de tiempos/fechas de carrera.
//
// Fuente ÚNICA para front y back: `api/_lib/mcp-store.js` importa de aquí igual
// que hace `mcp-sync.js` con `flatEfforts`. Antes había dos copias y ya habían
// divergido (`formatMinutes` devolvía '' en el front y null en el back), así que
// el mismo objetivo se serializaba distinto según quién lo pintara.
//
// Funciones puras, sin DOM ni I/O: se pueden importar desde una serverless.
// ============================================================================

/** "3:30:00" / "45:00" / "22" -> minutos (float). null si no es válido. */
export function parseTimeToMinutes(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p));
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
    if (parts.length === 2) return parts[0] + parts[1] / 60;
    return null;
  }
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * minutos (float) -> "H:MM:SS" o "MM:SS".
 *
 * Devuelve '' (no null) cuando no hay valor: es el contrato del front, donde el
 * resultado va directo a JSX y a la interpolación de i18next. Quien necesite
 * null en un JSON (la API MCP) usa `formatMinutes(x) || null`.
 */
export function formatMinutes(min) {
  if (min == null || Number.isNaN(min)) return '';
  const totalSec = Math.round(min * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Días desde hoy hasta 'YYYY-MM-DD' (negativo si ya pasó). null si no parsea.
 *
 * Se compara de medianoche LOCAL a medianoche local, que es la cuenta que espera
 * ver el atleta ("faltan 12 días" según SU calendario). En el servidor, que corre
 * en UTC, sale lo mismo que la versión UTC que había en el back.
 */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// ── Ritmo y duración ────────────────────────────────────────────────────────
// Había 17 copias locales de estos formateadores repartidas por los componentes,
// con CUATRO semánticas de entrada distintas (m/s, min/km, s/km, segundos) y el
// mismo nombre —`formatPace`— para tres de ellas. Un `formatPace(speed)` copiado
// a un fichero donde `formatPace` esperaba min/km daba un número plausible pero
// equivocado, sin fallo visible. Por eso aquí el nombre lleva SIEMPRE la unidad
// de entrada; no existe un `formatPace` a secas.

/** Marcador para ritmo sin dato. Antes convivían '0:00', '--:--', '—', '-'. */
export const PACE_PLACEHOLDER = '--:--';
/** Marcador para duración sin dato. */
export const TIME_PLACEHOLDER = '—';

// Ventana de ritmo fisiológicamente plausible (min/km). Fuera de ella el dato es
// ruido (velocidad GPS disparada, actividad mal tipada) y se pinta el marcador.
// Unifica los tres límites que había sueltos (>15, >20, <2): 30 min/km deja pasar
// caminatas reales en vez de esconderlas, y 2 min/km sigue descartando glitches.
export const PACE_LIMITS = { lo: 2, hi: 30 };

const mmss = (totalSec) => {
  let m = Math.floor(totalSec / 60);
  let s = Math.round(totalSec % 60);
  if (s === 60) { m += 1; s = 0; }   // el redondeo puede desbordar a 60
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Ritmo en min/km a "m:ss". */
export function formatPaceFromMinPerKm(minPerKm, fallback = PACE_PLACEHOLDER) {
  if (minPerKm == null || !Number.isFinite(minPerKm)) return fallback;
  if (minPerKm < PACE_LIMITS.lo || minPerKm > PACE_LIMITS.hi) return fallback;
  return mmss(minPerKm * 60);
}

/** Ritmo en segundos/km a "m:ss". */
export function formatPaceFromSecPerKm(secPerKm, fallback = PACE_PLACEHOLDER) {
  if (secPerKm == null || !Number.isFinite(secPerKm)) return fallback;
  return formatPaceFromMinPerKm(secPerKm / 60, fallback);
}

/**
 * Velocidad en m/s a ritmo min/km, como NÚMERO en crudo (sin marcador ni null):
 * el resultado alimenta gráficas y más aritmética, así que una velocidad 0 da
 * Infinity y se descarta luego al formatear, no aquí.
 *
 * Es la única definición de esta conversión: antes convivían `16.6667 / v` y
 * `1000 / (v * 60)`, que además no dan exactamente el mismo número.
 */
export const paceMinPerKm = (speedMs) => 1000 / 60 / speedMs;

/** Velocidad en m/s a "m:ss" por km. */
export function formatPaceFromSpeed(speedMs, fallback = PACE_PLACEHOLDER) {
  if (speedMs == null) return fallback;
  return formatPaceFromMinPerKm(paceMinPerKm(speedMs), fallback);
}

/** Segundos a "h:mm:ss" (o "m:ss" si no llega a la hora). */
export function formatDuration(seconds, fallback = TIME_PLACEHOLDER) {
  if (seconds == null || !Number.isFinite(seconds)) return fallback;
  const t = Math.round(seconds);
  const h = Math.floor(t / 3600);
  if (h === 0) return mmss(t);
  const m = Math.floor((t % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Segundos a "1h 20m" / "20m" (duración aproximada, para tarjetas de resumen). */
export function formatDurationHm(seconds, fallback = TIME_PLACEHOLDER) {
  if (seconds == null || !Number.isFinite(seconds)) return fallback;
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Minutos a "1h 20m" / "20m". */
export function formatMinutesHm(min, fallback = TIME_PLACEHOLDER) {
  if (min == null || !Number.isFinite(min)) return fallback;
  return formatDurationHm(min * 60, fallback);
}
