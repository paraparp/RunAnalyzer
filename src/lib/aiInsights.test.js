import { describe, it, expect } from 'vitest';
import {
  paceStr, formatDataDate,
  coachObjectToBlocks, coachCoherenceWarnings,
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

describe('coachObjectToBlocks', () => {
  const obj = {
    diagnostico: ['**Recuperado** y con buena forma esta semana', 'VFC sobre baseline'],
    tendencia: ['**Progresión** sostenida en los últimos 2 meses', 'Rampa de carga segura'],
    sesion: {
      tipo: 'Tempo', distancia: '8-10 km', ritmo: '4:45-5:00 min/km',
      zona: 3, fcMin: 158, fcMax: 168,
      instrucciones: ['Calentamiento 15 min', 'Para si FC>172 ppm'],
    },
    ultimoEntreno: ['**Rodaje aeróbico** bien ejecutado', 'Acierto: ritmo parejo'],
    estado: 'recuperado',
    tendenciaClave: 'progresion',
  };
  it('convierte el objeto estructurado a bloques de texto + metadatos', () => {
    const b = coachObjectToBlocks(obj);
    expect(b.cur).toContain('Recuperado');
    expect(b.trend).toContain('Progresión');
    expect(b.nextWork).toContain('Calentamiento');
    expect(b.lastWork).toContain('Rodaje aeróbico');
    expect(b.meta.estado).toBe('recuperado');
    expect(b.meta.tendencia).toBe('progresion');
    expect(b.meta.sesion).toMatchObject({ tipo: 'Tempo', distancia: '8-10 km', ritmo: '4:45-5:00 min/km' });
    expect(b.meta.sesion.zona).toBe('Zona 3 · 158-168 ppm');
  });
  it('rechaza objetos sin diagnóstico/tendencia con contenido real', () => {
    expect(coachObjectToBlocks(null)).toBeNull();
    expect(coachObjectToBlocks({ diagnostico: ['x'], tendencia: ['y'] })).toBeNull();
    expect(coachObjectToBlocks({ diagnostico: 'no-array', tendencia: [] })).toBeNull();
  });
});

describe('coachCoherenceWarnings', () => {
  const sesion = (over) => ({ sesion: { tipo: 'Tempo', fcMin: 158, fcMax: 168, ...over } });
  it('avisa si un readiness muy bajo lleva sesión de calidad', () => {
    const w = coachCoherenceWarnings(sesion({ tipo: 'Intervalos' }), { readiness: { score: 40 } });
    expect(w.join(' ')).toMatch(/regenerativo o descansar/);
  });
  it('avisa si el tope de FC supera la FCmax', () => {
    const w = coachCoherenceWarnings(sesion({ fcMax: 200 }), { fcmax: 190, readiness: { score: 80 } });
    expect(w.join(' ')).toMatch(/supera tu FCmax/);
  });
  it('avisa si una sesión fácil supera el LT1', () => {
    const w = coachCoherenceWarnings(
      sesion({ tipo: 'Regenerativo', fcMax: 155 }),
      { readiness: { score: 80 }, lt: { lt1Hr: 145 } },
    );
    expect(w.join(' ')).toMatch(/umbral aeróbico/);
  });
  it('no genera avisos con una prescripción coherente', () => {
    const w = coachCoherenceWarnings(
      sesion({ tipo: 'Aeróbico base', fcMin: 138, fcMax: 150 }),
      { readiness: { score: 80 }, fcmax: 190, lt: { lt1Hr: 152 } },
    );
    expect(w).toEqual([]);
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
