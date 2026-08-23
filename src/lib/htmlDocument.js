// ============================================================================
// htmlDocument — montaje del documento que se pinta dentro del iframe aislado
// (ver components/HtmlDocument.jsx). Vive aparte del componente para poder
// probarlo sin DOM y para no romper el fast refresh.
// ============================================================================

// Hoja de estilo base para los FRAGMENTOS (un documento completo trae la suya).
// Legible y neutra: ni marca de la app ni Tailwind, que aquí no existe.
const BASE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 4px 2px 24px;
    font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #334155; background: transparent; overflow-wrap: break-word;
  }
  h1, h2, h3, h4, h5, h6 { color: #0f172a; line-height: 1.25; margin: 1.4em 0 .5em; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.2rem; } h3 { font-size: 1.05rem; }
  h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
  p { margin: .6em 0; }
  ul, ol { margin: .6em 0; padding-left: 1.4em; }
  li { margin: .25em 0; }
  a { color: #2563eb; }
  hr { border: 0; border-top: 1px solid #e2e8f0; margin: 1.5em 0; }
  blockquote {
    margin: 1em 0; padding: .5em .9em; border-left: 3px solid #bfdbfe;
    background: #eff6ff66; color: #475569; font-style: italic;
  }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .85em; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; color: #475569; font-weight: 700; }
  tr:nth-child(even) td { background: #f8fafc80; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
  code { background: #f1f5f9; padding: .1em .35em; border-radius: 4px; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; height: auto; border-radius: 8px; }
  table, pre { max-width: 100%; }
`;

/** ¿El texto es un documento completo (trae <html>) o un fragmento suelto? */
export const isFullDocument = (html) => /<html[\s>]/i.test(html || '');

/**
 * Monta el documento que se pasará a `srcdoc`. Con un fragmento se envuelve en un
 * documento mínimo con la hoja base; con un documento completo se respeta el suyo
 * y solo se le inyecta `<base target="_blank">` para que sus enlaces abran fuera
 * del marco (dentro del sandbox no pueden navegar).
 */
export function buildHtmlDocument(cleanHtml, { fullDocument = false } = {}) {
  const base = '<base target="_blank" rel="noopener noreferrer">';
  if (fullDocument) {
    if (/<head[^>]*>/i.test(cleanHtml)) return cleanHtml.replace(/<head[^>]*>/i, (m) => m + base);
    if (/<html[^>]*>/i.test(cleanHtml)) return cleanHtml.replace(/<html[^>]*>/i, (m) => `${m}<head>${base}</head>`);
    return base + cleanHtml;
  }
  return `<!doctype html><html><head><meta charset="utf-8">${base}<style>${BASE_CSS}</style></head><body>${cleanHtml}</body></html>`;
}
