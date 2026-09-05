// ── Semana ISO-8601 ─────────────────────────────────────────────────────────
// Cinco componentes agrupaban por semana con su propia copia del cálculo. Todas
// arrancaban la semana en lunes —el `(day + 6) % 7` se repetía literal en las
// cinco—, así que lo que divergía no era la convención sino la FORMA del
// resultado: unas devolvían la clave "2026-W12", otra el Date del lunes, otra el
// string "YYYY-MM-DD" y otra el par {year, week}. Aquí el cálculo se hace una
// vez y se expone en las cuatro formas.
//
// ISO-8601: la semana empieza en lunes y la semana 1 es la que contiene el 4 de
// enero. Todo se calcula en hora LOCAL, que es el calendario que ve el atleta.

/**
 * Parseo LOCAL de la entrada. Un string "YYYY-MM-DD" —la forma que devuelven
 * `dayKey` y `activityDayKey`, que es como llegan aquí las claves de día— lo
 * interpreta `new Date()` como medianoche UTC, así que al oeste de Greenwich la
 * semana se calculaba sobre el día ANTERIOR. Se construye a mano en local.
 */
function toLocalDate(value) {
  if (value instanceof Date) return new Date(value);
  const m = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

/** Lunes 00:00 (hora local) de la semana que contiene `date`. */
export function weekStartDate(date) {
  const d = toLocalDate(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** { year, week } ISO de una fecha. */
export function isoWeek(date) {
  // Al jueves de esa semana: es el día que decide a qué año ISO pertenece.
  const d = toLocalDate(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return {
    year: d.getFullYear(),
    week: 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7),
  };
}

/** Clave ordenable "YYYY-Www" (p. ej. "2026-W12"). */
export function isoWeekKey(date) {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Lunes de una semana ISO dada, a partir de { year, week }. */
export function weekStartFromIso(year, week) {
  const jan4 = new Date(year, 0, 4);
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const start = new Date(firstMonday);
  start.setDate(firstMonday.getDate() + (week - 1) * 7);
  return start;
}

/**
 * Lunes de la semana como "YYYY-MM-DD" en hora LOCAL.
 *
 * Deliberadamente NO usa toISOString(): esa convierte a UTC, y para husos al este
 * de Greenwich (España incluida) la medianoche local del lunes cae el domingo en
 * UTC, así que la clave salía fechada un día antes.
 */
export function weekStartKey(date) {
  const d = weekStartDate(date);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
