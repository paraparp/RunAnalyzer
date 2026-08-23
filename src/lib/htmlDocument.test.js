import { describe, it, expect } from 'vitest';
import { buildHtmlDocument, isFullDocument } from './htmlDocument';

describe('isFullDocument', () => {
  it('distingue documento completo de fragmento', () => {
    expect(isFullDocument('<html><body>x</body></html>')).toBe(true);
    expect(isFullDocument('<p>Rodaje 10 km</p>')).toBe(false);
    expect(isFullDocument('')).toBe(false);
  });
});

describe('buildHtmlDocument', () => {
  it('envuelve un fragmento con la hoja base y el contenido intacto', () => {
    const out = buildHtmlDocument('<p>Rodaje 10 km</p>');
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<p>Rodaje 10 km</p>');
    expect(out).toContain('font: 14px/1.6'); // hoja base aplicada
  });

  it('respeta un documento completo y solo le inyecta el <base>', () => {
    const doc = '<html><head><style>b{color:red}</style></head><body>hola</body></html>';
    const out = buildHtmlDocument(doc, { fullDocument: true });
    expect(out).toContain('<style>b{color:red}</style>'); // no se pisan sus estilos
    expect(out).not.toContain('font: 14px/1.6');          // ni se le añade la nuestra
    expect(out.indexOf('<base')).toBeGreaterThan(out.indexOf('<head>'));
  });

  it('los enlaces salen del marco (base target=_blank)', () => {
    expect(buildHtmlDocument('<a href="https://x.com">x</a>')).toContain('target="_blank"');
  });

  it('un documento sin <head> recibe uno con el base', () => {
    const out = buildHtmlDocument('<html><body>hola</body></html>', { fullDocument: true });
    expect(out).toContain('<base');
    expect(out).toContain('hola');
  });
});
