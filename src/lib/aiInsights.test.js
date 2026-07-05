import { describe, it, expect } from 'vitest';
import {
  paceStr, formatDataDate,
  stripPartialDelimiter, splitBlocks, validateBlocks, parseMeta,
  parseWorkout, deriveStatusKey, deriveTrendKey,
} from './aiInsights';

describe('paceStr', () => {
  it('formatea min/km como M:SS', () => {
    expect(paceStr(5.5)).toBe('5:30');
    expect(paceStr(4)).toBe('4:00');
  });
  it('redondea por segundos totales (nunca "5:60")', () => {
    expect(paceStr(5.9999)).toBe('6:00');
    expect(paceStr(4.999)).toBe('5:00');
  });
});

describe('formatDataDate', () => {
  it('devuelve "hoy" y "ayer" con granularidad de día', () => {
    expect(formatDataDate(new Date())).toBe('hoy');
    const y = new Date(); y.setDate(y.getDate() - 1);
    expect(formatDataDate(y)).toBe('ayer');
  });
  it('devuelve null para entradas inválidas', () => {
    expect(formatDataDate(null)).toBeNull();
    expect(formatDataDate('no-es-fecha')).toBeNull();
  });
});

describe('stripPartialDelimiter', () => {
  it('recorta pipes parciales del final (chunk corta "|||")', () => {
    expect(stripPartialDelimiter('texto |')).toBe('texto ');
    expect(stripPartialDelimiter('texto ||')).toBe('texto ');
  });
  it('no toca un delimitador completo ni texto normal', () => {
    expect(stripPartialDelimiter('a|||b')).toBe('a|||b');
    expect(stripPartialDelimiter('texto')).toBe('texto');
  });
});

describe('splitBlocks / validateBlocks', () => {
  const good = 'Bloque uno con contenido suficiente ||| Bloque dos con contenido suficiente ||| Bloque tres ||| Bloque cuatro';
  it('parte y recorta los bloques', () => {
    const parts = splitBlocks(good);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('Bloque uno con contenido suficiente');
  });
  it('acepta respuestas con formato correcto', () => {
    expect(validateBlocks(splitBlocks(good))).toBe(true);
  });
  it('rechaza respuestas sin delimitadores o con bloques vacíos', () => {
    expect(validateBlocks(splitBlocks('prosa suelta sin bloques'))).toBe(false);
    expect(validateBlocks(splitBlocks('||| ||| |||'))).toBe(false);
    expect(validateBlocks(splitBlocks(''))).toBe(false);
  });
});

describe('parseMeta', () => {
  it('extrae el JSON del bloque 5', () => {
    const parts = ['a', 'b', 'c', 'd', '{"estado":"fatigado","tendencia":"riesgo"}'];
    expect(parseMeta(parts)).toEqual({ estado: 'fatigado', tendencia: 'riesgo' });
  });
  it('tolera texto alrededor del JSON (```json, prosa)', () => {
    const parts = ['a', 'b', 'c', 'd', '```json\n{"estado":"en_forma"}\n```'];
    expect(parseMeta(parts)).toEqual({ estado: 'en_forma' });
  });
  it('devuelve null si falta el bloque o el JSON es inválido', () => {
    expect(parseMeta(['a', 'b', 'c', 'd'])).toBeNull();
    expect(parseMeta(['a', 'b', 'c', 'd', '{rota'])).toBeNull();
    expect(parseMeta(null)).toBeNull();
  });
});

describe('parseWorkout', () => {
  it('prioriza los metadatos JSON del bloque 5', () => {
    const meta = { sesion: { tipo: 'Tempo', distancia: '8-10 km', ritmo: '4:45-5:00 min/km', zona: 'Zona 3 · 158-168 ppm' } };
    expect(parseWorkout('texto irrelevante', meta)).toEqual({
      type: 'Tempo', distance: '8-10 km', pace: '4:45-5:00 min/km', hrZone: 'Zona 3 · 158-168 ppm',
    });
  });
  it('parsea la línea de plantilla estructurada', () => {
    const text = '- **Tempo** · **8-10 km** · **4:45-5:00 min/km** · **Zona 3 · 158-168 ppm**\n- Calentamiento 15 min';
    const w = parseWorkout(text, null);
    expect(w.type).toBe('Tempo');
    expect(w.distance).toBe('8-10 km');
    expect(w.pace).toBe('4:45-5:00 min/km');
    expect(w.hrZone).toBe('Zona 3 · 158-168 ppm');
  });
  it('cae a heurísticas si no hay plantilla ni metadatos', () => {
    const text = 'Haz un **Regenerativo** de **5 km** a **6:30 min/km** en **Zona 1**';
    const w = parseWorkout(text, null);
    expect(w.type).toBe('Regenerativo');
    expect(w.distance).toBe('5 km');
    expect(w.pace).toBe('6:30 min/km');
    expect(w.hrZone).toBe('Zona 1');
  });
  it('completa con el texto los campos que falten en los metadatos', () => {
    const meta = { sesion: { tipo: 'Series', distancia: null, ritmo: null, zona: null } };
    const text = '- **Series** · **6 km** · **4:30 min/km** · **Zona 4 · 165-175 ppm**';
    const w = parseWorkout(text, meta);
    expect(w.type).toBe('Series');
    expect(w.distance).toBe('6 km');
  });
  it('devuelve null sin texto ni sesión, y defaults con texto vago', () => {
    expect(parseWorkout('', null)).toBeNull();
    expect(parseWorkout('descansa hasta mañana', null).type).toBe('Base Aeróbica');
  });
});

describe('deriveStatusKey', () => {
  it('prioriza meta.estado sobre las keywords', () => {
    expect(deriveStatusKey('estás muy fatigado', { estado: 'en_forma' })).toBe('forma');
    expect(deriveStatusKey('lo que sea', { estado: 'sobreentrenado' })).toBe('sobreentrenamiento');
  });
  it('cae a keywords sin metadatos', () => {
    expect(deriveStatusKey('acumulas **fatiga** residual', null)).toBe('fatiga');
    expect(deriveStatusKey('estás **recuperado** y estable', null)).toBe('recuperado');
    expect(deriveStatusKey('texto neutro', null)).toBe('adaptativo');
  });
  it('devuelve null sin diagnóstico', () => {
    expect(deriveStatusKey('', null)).toBeNull();
  });
});

describe('deriveTrendKey', () => {
  it('prioriza meta.tendencia válida', () => {
    expect(deriveTrendKey('progresión clara', { tendencia: 'riesgo' })).toBe('riesgo');
  });
  it('ignora meta.tendencia fuera del vocabulario', () => {
    expect(deriveTrendKey('progresión clara y mejora', { tendencia: 'inventada' })).toBe('progresion');
  });
  it('no marca progresión si está negada (estancamiento)', () => {
    expect(deriveTrendKey('la mejora se ha estancado en meseta', null)).toBe('estable');
  });
});
