import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownText from './MarkdownText';

const html = (md) => renderToStaticMarkup(<MarkdownText content={md} />);

describe('MarkdownText', () => {
  it('encabezados', () => {
    expect(html('# Plan 12 semanas')).toContain('Plan 12 semanas');
    expect(html('### Semana 1')).toContain('<h4');
  });

  it('listas anidadas', () => {
    const out = html('- Lunes\n  - Rodaje 10 km\n  - Series\n- Martes');
    expect(out.match(/<ul/g).length).toBe(2);
  });

  it('lista de tareas', () => {
    const out = html('- [x] Tirada larga\n- [ ] Series');
    expect(out).toContain('line-through');
  });

  it('tabla con alineacion', () => {
    const out = html('| Dia | Km |\n|:---|---:|\n| Lun | 10 |');
    expect(out).toContain('<table');
    expect(out).toContain('text-right');
  });

  it('inline: negrita, codigo, tachado, enlace', () => {
    const out = html('**sub40** y `5:00` ~~viejo~~ [web](https://x.com)');
    expect(out).toContain('<strong');
    expect(out).toContain('<code');
    expect(out).toContain('href="https://x.com"');
  });

  it('enlaces con esquema peligroso no generan href', () => {
    const out = html('[click](javascript:alert(1))');
    expect(out).not.toContain('href');
  });

  it('citas y reglas', () => {
    expect(html('> Cuidado con la fascitis')).toContain('<blockquote');
    expect(html('---')).toContain('<hr');
  });

  it('bloque de codigo', () => {
    expect(html('```\n10x400\n```')).toContain('<pre');
  });

  it('texto plano por lineas', () => {
    const out = html('Lunes: 10 km\nMartes: descanso');
    expect(out.match(/<p /g).length).toBe(2);
  });
});
