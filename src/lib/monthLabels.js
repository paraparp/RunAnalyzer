// Etiquetas de mes abreviadas, compartidas por las vistas que rotulan ejes temporales.
// Vive aquí y no en cada componente porque `FitnessFatigue`, `VO2MaxTracker` y
// `WeeklyProgression` mantenían tres copias (y la de `FitnessFatigue` sin traducir).
//
// Devuelve SIEMPRE la misma referencia por idioma: eso permite pasarla como dependencia
// de un `useMemo` sin invalidarlo en cada render (era lo que impedía al React Compiler
// preservar la memoización manual de dos de esas vistas).
const MONTH_SHORT_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Abreviaturas de mes (índice 0 = enero) para el idioma dado.
 * Cualquier idioma que no sea español cae en inglés, igual que el resto de la app.
 */
export function monthShort(lang) {
  return String(lang || '').startsWith('es') ? MONTH_SHORT_ES : MONTH_SHORT_EN;
}
