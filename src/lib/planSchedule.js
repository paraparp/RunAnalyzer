// ============================================================================
// planSchedule — pone fecha a los días del plan de la IA.
//
// El plan viene con el día en texto ("Miércoles", "Mié", "Wednesday"): para
// agendar la sesión en el calendario de Garmin hace falta un YYYY-MM-DD. Aquí se
// resuelve al PRÓXIMO día de la semana con ese nombre, contando hoy: el plan
// generado es siempre el de la semana en curso.
// ============================================================================

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim().replace(/[.,]/g, '');

// Índices de Date#getDay(): domingo = 0.
const DAYS = [
  ['domingo', 'dom', 'do', 'sunday', 'sun', 'su'],
  ['lunes', 'lun', 'lu', 'monday', 'mon', 'mo'],
  ['martes', 'mar', 'ma', 'tuesday', 'tue', 'tu'],
  ['miercoles', 'mie', 'mi', 'wednesday', 'wed', 'we'],
  ['jueves', 'jue', 'ju', 'thursday', 'thu', 'th'],
  ['viernes', 'vie', 'vi', 'friday', 'fri', 'fr'],
  ['sabado', 'sab', 'sa', 'saturday', 'sat'],
];

/** Nombre de día (es/en, largo o abreviado) → índice 0-6, o null si no se reconoce. */
export function weekdayIndex(name) {
  const n = norm(name);
  if (!n) return null;
  // La primera palabra: el plan a veces trae "Lunes (rodaje)" o "Lunes - Series".
  const word = n.split(/[\s/(:-]+/)[0];
  for (let i = 0; i < DAYS.length; i++) {
    if (DAYS[i].includes(word) || DAYS[i].includes(n)) return i;
  }
  // Último recurso: prefijo suficientemente largo para no confundir mar/mie.
  for (let i = 0; i < DAYS.length; i++) {
    if (word.length >= 3 && DAYS[i][0].startsWith(word)) return i;
  }
  return null;
}

/** Fecha local en YYYY-MM-DD (no vale toISOString: desplaza de zona horaria). */
export function toISODate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/**
 * Próxima fecha con ese nombre de día, hoy incluido. Devuelve null si el nombre
 * no se reconoce: el entreno se creará en Garmin sin agendar, en vez de caer en
 * una fecha inventada.
 */
export function nextDateForDay(name, from = new Date()) {
  const idx = weekdayIndex(name);
  if (idx == null) return null;
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  base.setDate(base.getDate() + ((idx - base.getDay() + 7) % 7));
  return toISODate(base);
}
