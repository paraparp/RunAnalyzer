import { describe, it, expect } from 'vitest';
import { monthShort } from './monthLabels';

describe('monthShort', () => {
  it('devuelve las abreviaturas en español para es y sus variantes', () => {
    expect(monthShort('es')[0]).toBe('Ene');
    expect(monthShort('es-ES')[11]).toBe('Dic');
  });

  it('cae en inglés para cualquier otro idioma', () => {
    expect(monthShort('en')[0]).toBe('Jan');
    expect(monthShort('en-US')[11]).toBe('Dec');
    expect(monthShort('fr')[0]).toBe('Jan');
  });

  it('cae en inglés sin idioma (no revienta con null/undefined)', () => {
    expect(monthShort(undefined)[0]).toBe('Jan');
    expect(monthShort(null)[0]).toBe('Jan');
    expect(monthShort('')[0]).toBe('Jan');
  });

  it('devuelve doce meses', () => {
    expect(monthShort('es')).toHaveLength(12);
    expect(monthShort('en')).toHaveLength(12);
  });

  it('devuelve la misma referencia por idioma (estable como dependencia de useMemo)', () => {
    expect(monthShort('es')).toBe(monthShort('es-ES'));
    expect(monthShort('en')).toBe(monthShort('de'));
    expect(monthShort('es')).not.toBe(monthShort('en'));
  });
});
