import { describe, it, expect } from 'vitest';
import { detectPlanFormat, isRenderable } from './planFormat';

describe('vacío', () => {
  it.each([
    ['cadena vacía', ''],
    ['solo espacios', '   '],
    ['solo saltos de línea', '\n\n\t '],
    ['null', null],
    ['undefined', undefined],
  ])('%s → empty', (_, input) => {
    expect(detectPlanFormat(input)).toBe('empty');
  });

  it('no revienta con un número', () => {
    expect(detectPlanFormat(42)).toBe('text');
  });
});

describe('html', () => {
  it.each([
    '<p>Semana 1: 40 km</p>',
    '<div class="plan">rodaje</div>',
    '<table><tr><td>Lunes</td></tr></table>',
    'Semana 1<br>Semana 2',
    '<UL><LI>series</LI></UL>',
    '<h2 id="s1">Bloque base</h2>',
  ])('detecta %s como html', (input) => {
    expect(detectPlanFormat(input)).toBe('html');
  });

  it('el html manda sobre las marcas de markdown', () => {
    expect(detectPlanFormat('# Plan\n\n<p>Semana 1</p>')).toBe('html');
  });
});

describe('un "<" suelto no es html', () => {
  // La razón de exigir un nombre de etiqueta conocido: los planes están llenos
  // de comparaciones ("series de 5<10 min", "FC <150 ppm").
  it.each([
    'Series de 5<10 min a ritmo umbral',
    'Mantén la FC <150 ppm en el rodaje',
    '5 x 1000 m <> recuperación 90"',
    'Progresión: 3<4<5 km',
  ])('%s → text', (input) => {
    expect(detectPlanFormat(input)).toBe('text');
  });

  it('una etiqueta inventada tampoco cuenta como html', () => {
    expect(detectPlanFormat('<semana1>rodaje suave</semana1>')).toBe('text');
  });
});

describe('markdown', () => {
  it.each([
    ['encabezado', '# Plan de 12 semanas'],
    ['encabezado h6', '###### Notas'],
    ['tabla', '| Día | Sesión |\n| --- | --- |'],
    ['bloque de código', '```\n5x1000\n```'],
    ['lista con guion', '- Lunes: rodaje 10 km'],
    ['lista con asterisco', '* Martes: series'],
    ['lista con más', '+ Miércoles: descanso'],
    ['lista numerada', '1. Calentamiento 15 min'],
    ['cita', '> Prioriza el descanso'],
    ['negrita', 'Semana clave: **tirada larga de 25 km**'],
    ['enlace', 'Ver [el plan](https://ejemplo.com/plan)'],
    ['regla horizontal', 'Bloque 1\n\n---\n\nBloque 2'],
  ])('detecta %s como markdown', (_, input) => {
    expect(detectPlanFormat(input)).toBe('markdown');
  });

  it('admite hasta 3 espacios de sangría, no 4', () => {
    expect(detectPlanFormat('   - rodaje')).toBe('markdown');
    expect(detectPlanFormat('    - rodaje')).toBe('text');
  });

  it('un guion sin espacio detrás no es una lista', () => {
    expect(detectPlanFormat('-rodaje suave')).toBe('text');
  });

  it('un asterisco de multiplicación no es negrita ni lista', () => {
    expect(detectPlanFormat('Haz 5*1000 m al 90%')).toBe('text');
  });
});

describe('texto plano', () => {
  it.each([
    'Lunes rodaje suave 10 km. Martes series. Miércoles descanso.',
    'Semana 1: 40 km\nSemana 2: 45 km\nSemana 3: 50 km',
    'FC objetivo 150-160 ppm (85% del umbral)',
  ])('%s → text', (input) => {
    expect(detectPlanFormat(input)).toBe('text');
  });
});

describe('isRenderable', () => {
  it('solo markdown y html tienen vista renderizada', () => {
    expect(isRenderable('markdown')).toBe(true);
    expect(isRenderable('html')).toBe(true);
    expect(isRenderable('text')).toBe(false);
    expect(isRenderable('empty')).toBe(false);
    expect(isRenderable(undefined)).toBe(false);
  });

  it('encaja con la salida de detectPlanFormat', () => {
    expect(isRenderable(detectPlanFormat('# Plan'))).toBe(true);
    expect(isRenderable(detectPlanFormat('rodaje suave'))).toBe(false);
  });
});
