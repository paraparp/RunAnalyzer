// ============================================================================
// planFormat — heurística para adivinar en qué formato está escrito un texto
// libre (los planes de entrenamiento de las carreras objetivo, que el usuario
// pega tal cual o escribe el MCP).
//
// Devuelve 'html' | 'markdown' | 'text' | 'empty'. Es una heurística, no un
// parser: por eso el UI deja siempre conmutar a texto plano.
// ============================================================================

// Etiquetas HTML reales. Se exige un nombre de etiqueta conocido para no
// confundir un "<" suelto ("series de 5<10 min") con HTML.
const HTML_TAG = /<\/?(p|div|table|tbody|thead|tr|td|th|ul|ol|li|h[1-6]|br|hr|span|strong|em|b|i|u|a|code|pre|blockquote|section|article|img|font)\b[^>]*>/i;

// Marcas de markdown, de la más inequívoca a la más común.
const MD_PATTERNS = [
  /^\s{0,3}#{1,6}\s+\S/m,               // # encabezados
  /^\s{0,3}\|.*\|\s*$/m,                // | tablas |
  /```/,                                // bloques de código
  /^\s{0,3}[-*+]\s+\S/m,                // - listas
  /^\s{0,3}\d+\.\s+\S/m,                // 1. listas numeradas
  /^\s{0,3}>\s+\S/m,                    // > citas
  /\*\*[^*\n]+\*\*/,                    // **negrita**
  /\[[^\]\n]+\]\([^)\s]+\)/,            // [enlace](url)
  /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/m,  // --- reglas
];

/** 'html' | 'markdown' | 'text' | 'empty' */
export function detectPlanFormat(text) {
  const s = String(text ?? '');
  if (!s.trim()) return 'empty';
  if (HTML_TAG.test(s)) return 'html';
  return MD_PATTERNS.some((re) => re.test(s)) ? 'markdown' : 'text';
}

/** ¿Tiene sentido ofrecer vista renderizada? (en texto plano no aporta nada) */
export function isRenderable(format) {
  return format === 'markdown' || format === 'html';
}

export default detectPlanFormat;
