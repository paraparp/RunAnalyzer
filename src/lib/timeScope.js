// ============================================================================
// timeScope — UN solo período de análisis para toda la app (fase 6).
//
// Había dieciocho controles de período con seis vocabularios ('6' meses como
// string, '365' días, '3m', 90d/6m/1y, 'all', días numéricos) y defaults que no
// coincidían: el desacople miraba 6 meses, el VO2max 12, la velocidad crítica 365
// días, Zonas 3 meses, Vitales 180 días y el VDOT todo el histórico. El mismo
// atleta recibía veredictos distintos sobre el mismo cuerpo según la pestaña, y
// nada en pantalla lo avisaba.
//
// Ahora el período es UNO, compartido por todas las vistas que acotan el histórico,
// y con un vocabulario: meses de calendario (la frontera la pone `monthsAgoISO`,
// sobre el día local, igual que la curva mean-max).
//
// Por defecto, 12 meses (decisión 4 de docs/REESTRUCTURACION_SECCIONES.md §7):
// coincide con el PMC y el VO2max, cubre una temporada y da muestra suficiente a la
// velocidad crítica y al desacople.
//
// Lo que NO es período y por eso no vive aquí: la granularidad de agregación
// (día/semana/mes) y los selectores de año natural de los calendarios, que
// responden a otra pregunta ("¿cómo fue 2024?", no "¿cómo estoy?").
// ============================================================================

import { monthsAgoISO } from './criticalSpeed.js';

export const TIME_SCOPES = [
  { id: '1m', months: 1 },
  { id: '3m', months: 3 },
  { id: '6m', months: 6 },
  { id: '12m', months: 12 },
  { id: '24m', months: 24 },
  { id: 'all', months: null },
];

export const DEFAULT_TIME_SCOPE = '12m';

/** Clave de cloudStorage donde se recuerda la elección. */
export const TIME_SCOPE_KEY = 'time_scope';

export const isTimeScope = (id) => TIME_SCOPES.some((s) => s.id === id);

/** Meses del período; null = todo el histórico. Un id desconocido cae al default. */
export function scopeMonths(id) {
  const s = TIME_SCOPES.find((x) => x.id === id) ?? TIME_SCOPES.find((x) => x.id === DEFAULT_TIME_SCOPE);
  return s.months;
}

/** Primer día (YYYY-MM-DD local) del período; null = sin límite inferior. */
export const scopeFromISO = (id) => monthsAgoISO(scopeMonths(id));

/**
 * El período en días, para las vistas que trabajan con ventanas de días (Zonas,
 * Vitales). Se deriva de la MISMA frontera de calendario, así que "12 meses" son
 * 365 o 366 días según toque, no 360. null = todo el histórico.
 */
export function scopeDays(id, now = new Date()) {
  const from = scopeFromISO(id);
  if (!from) return null;
  const [y, m, d] = from.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - start) / 86400000);
}
