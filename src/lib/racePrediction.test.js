import { describe, it, expect } from 'vitest';
import {
  fitRiegelExponent,
  riegelTime,
  confidenceFor,
  predictRaces,
  applyCoachAdjustment,
  normalizeRaceKey,
  MAX_ADJUST_PCT,
  RIEGEL_DEFAULT,
  RIEGEL_MIN,
  RIEGEL_MAX,
  ANCHOR_FRESH_DAYS,
} from './racePrediction.js';

// Un día ISO a N días de la fecha de referencia de los tests.
const NOW = Date.parse('2026-08-30T00:00:00');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

const run = (date, distance, timeS, efforts = []) => ({
  id: `${date}-${distance}`,
  type: 'Run',
  start_date_local: `${date}T08:00:00`,
  distance,
  moving_time: timeS,
  best_efforts: efforts.map(([d, t]) => ({ distance: d, moving_time: t })),
});

// Atleta sintético coherente: marcas generadas con Riegel exacto b = 1.08 desde
// un 5K en 20:00, así que el exponente ajustado debe recuperar ese 1.08.
const RIEGEL_ATHLETE = (b = 1.08) => {
  const base = { d: 5000, t: 1200 };
  const at = (d) => Math.round(base.t * (d / base.d) ** b);
  return [
    run(daysAgo(20), 5000, base.t),
    run(daysAgo(40), 10000, at(10000)),
    run(daysAgo(60), 21097.5, at(21097.5)),
  ];
};

describe('fitRiegelExponent', () => {
  it('recupera el exponente con el que se generaron las marcas', () => {
    const points = [
      { distance_m: 5000, time_s: 1200 },
      { distance_m: 10000, time_s: Math.round(1200 * 2 ** 1.08) },
      { distance_m: 21097.5, time_s: Math.round(1200 * (21097.5 / 5000) ** 1.08) },
    ];
    const fit = fitRiegelExponent(points);
    expect(fit.fitted).toBe(true);
    expect(fit.exponent).toBeCloseTo(1.08, 2);
    expect(fit.r2).toBeGreaterThan(0.99);
  });

  it('cae al 1,06 clásico con menos de 3 puntos', () => {
    const fit = fitRiegelExponent([
      { distance_m: 5000, time_s: 1200 },
      { distance_m: 10000, time_s: 2500 },
    ]);
    expect(fit.fitted).toBe(false);
    expect(fit.exponent).toBe(RIEGEL_DEFAULT);
  });

  it('cae al clásico si las distancias están apelotonadas (spread < 2×)', () => {
    const fit = fitRiegelExponent([
      { distance_m: 5000, time_s: 1200 },
      { distance_m: 6000, time_s: 1460 },
      { distance_m: 8000, time_s: 1980 },
    ]);
    expect(fit.fitted).toBe(false);
    expect(fit.exponent).toBe(RIEGEL_DEFAULT);
  });

  it('cae al clásico si la pendiente sale fuera de la banda plausible', () => {
    // Un 21K corrido de paseo tras un 5K a tope da un exponente disparatado.
    const fit = fitRiegelExponent([
      { distance_m: 5000, time_s: 1200 },
      { distance_m: 10000, time_s: 2600 },
      { distance_m: 21097.5, time_s: 9000 },
    ]);
    expect(fit.exponent).toBeGreaterThanOrEqual(RIEGEL_MIN);
    expect(fit.exponent).toBeLessThanOrEqual(RIEGEL_MAX);
    expect(fit.fitted).toBe(false);
  });

  it('ignora los puntos fuera de la ventana de validez', () => {
    const fit = fitRiegelExponent([
      { distance_m: 400, time_s: 70 },      // demasiado corto
      { distance_m: 5000, time_s: 1200 },
      { distance_m: 10000, time_s: Math.round(1200 * 2 ** 1.08) },
    ]);
    expect(fit.n).toBe(2);
    expect(fit.fitted).toBe(false);
  });
});

describe('riegelTime', () => {
  it('aplica T2 = T1 × (D2/D1)^b', () => {
    const anchor = { distance_m: 5000, time_s: 1200 };
    expect(riegelTime(anchor, 10000, 1.06)).toBeCloseTo(1200 * 2 ** 1.06, 3);
  });

  it('devuelve el mismo tiempo a la misma distancia', () => {
    expect(riegelTime({ distance_m: 10000, time_s: 2400 }, 10000, 1.08)).toBeCloseTo(2400, 6);
  });

  it('devuelve null con entradas inválidas', () => {
    expect(riegelTime(null, 10000)).toBeNull();
    expect(riegelTime({ distance_m: 0, time_s: 1200 }, 10000)).toBeNull();
    expect(riegelTime({ distance_m: 5000, time_s: 1200 }, 0)).toBeNull();
  });
});

describe('confidenceFor', () => {
  it('"Alta" solo cerca del ancla, con acuerdo entre modelos y ancla reciente', () => {
    expect(confidenceFor({ ratio: 1.2, spread: 0.02, anchorAgeDays: 30 })).toBe('Alta');
  });

  it('baja a "Media" si el ancla es vieja aunque todo lo demás cuadre', () => {
    expect(confidenceFor({ ratio: 1.2, spread: 0.02, anchorAgeDays: ANCHOR_FRESH_DAYS + 1 })).toBe('Media');
  });

  it('baja a "Media" si los modelos discrepan', () => {
    expect(confidenceFor({ ratio: 1.2, spread: 0.06, anchorAgeDays: 10 })).toBe('Media');
  });

  it('"Baja" al extrapolar lejos del ancla', () => {
    expect(confidenceFor({ ratio: 4.2, spread: 0.02, anchorAgeDays: 10 })).toBe('Baja');
  });
});

describe('predictRaces', () => {
  it('devuelve las cuatro distancias con ritmo estrictamente creciente', () => {
    const out = predictRaces(RIEGEL_ATHLETE(), { now: NOW });
    expect(out.items.map((i) => i.key)).toEqual(['5k', '10k', '21k', '42k']);
    for (let i = 1; i < out.items.length; i++) {
      expect(out.items[i].paceSec).toBeGreaterThan(out.items[i - 1].paceSec);
    }
  });

  it('ancla en el mejor rendimiento y reporta VDOT y exponente', () => {
    const out = predictRaces(RIEGEL_ATHLETE(), { now: NOW });
    expect(out.anchor).toBeTruthy();
    expect(out.vdot).toBeGreaterThan(30);
    expect(out.riegel.exponent).toBeGreaterThanOrEqual(RIEGEL_MIN);
    expect(out.anchorAgeDays).toBeGreaterThanOrEqual(20);
  });

  it('reproduce aproximadamente la marca real de la distancia del ancla', () => {
    // 10K en 41:21 es el VDOT 50 de tabla: la predicción a 10K no puede alejarse.
    const out = predictRaces([run(daysAgo(10), 10000, 2481)], { now: NOW });
    const tenK = out.items.find((i) => i.key === '10k');
    expect(tenK.timeSeconds).toBeGreaterThan(2481 * 0.95);
    expect(tenK.timeSeconds).toBeLessThan(2481 * 1.05);
  });

  it('un rodaje suave no mejora la predicción (la curva es de esfuerzos máximos)', () => {
    const base = [run(daysAgo(10), 10000, 2481)];
    const conRodaje = [...base, run(daysAgo(2), 12000, 4320)]; // 6:00/km
    const a = predictRaces(base, { now: NOW }).items.find((i) => i.key === '10k');
    const b = predictRaces(conRodaje, { now: NOW }).items.find((i) => i.key === '10k');
    expect(b.timeSeconds).toBe(a.timeSeconds);
  });

  it('un esfuerzo mejor sí adelanta la predicción', () => {
    const base = [run(daysAgo(60), 10000, 2600)];
    const mejor = [...base, run(daysAgo(5), 10000, 2400)];
    const a = predictRaces(base, { now: NOW }).items.find((i) => i.key === '10k');
    const b = predictRaces(mejor, { now: NOW }).items.find((i) => i.key === '10k');
    expect(b.timeSeconds).toBeLessThan(a.timeSeconds);
  });

  it('sin esfuerzos utilizables devuelve vacío y explica por qué', () => {
    const out = predictRaces([], { now: NOW });
    expect(out.items).toEqual([]);
    expect(out.reason).toMatch(/esfuerzo/);
    expect(out.vdot).toBeNull();
  });

  it('ignora actividades que no son carrera', () => {
    const ride = { ...run(daysAgo(10), 10000, 2481), type: 'Ride', sport_type: 'Ride' };
    expect(predictRaces([ride], { now: NOW }).items).toEqual([]);
  });

  it('cada predicción declara de qué modelos sale', () => {
    const out = predictRaces(RIEGEL_ATHLETE(), { now: NOW });
    for (const item of out.items) {
      expect(Object.keys(item.models).length).toBeGreaterThan(0);
      expect(item.models.vdot).toBeGreaterThan(0);
    }
  });
});

describe('normalizeRaceKey', () => {
  it('reconoce las variantes que devuelve el modelo', () => {
    expect(normalizeRaceKey('5K')).toBe('5k');
    expect(normalizeRaceKey('10 km')).toBe('10k');
    expect(normalizeRaceKey('Media Maratón')).toBe('21k');
    expect(normalizeRaceKey('half marathon')).toBe('21k');
    expect(normalizeRaceKey('21K')).toBe('21k');
    expect(normalizeRaceKey('Maratón')).toBe('42k');
    expect(normalizeRaceKey('42.2 km')).toBe('42k');
  });

  it('descarta lo que no reconoce', () => {
    expect(normalizeRaceKey('milla')).toBeNull();
    expect(normalizeRaceKey('')).toBeNull();
    expect(normalizeRaceKey(null)).toBeNull();
  });
});

describe('applyCoachAdjustment', () => {
  const base = () => predictRaces(RIEGEL_ATHLETE(), { now: NOW }).items;

  it('acepta un ajuste dentro de la banda y guarda el tiempo original', () => {
    const items = base();
    const target = Math.round(items[0].timeSeconds * 1.03);
    const out = applyCoachAdjustment(items, [{ label: items[0].label, time_seconds: target, rationale: 'TSB bajo' }]);
    expect(out[0].timeSeconds).toBe(target);
    expect(out[0].baseTimeSeconds).toBe(items[0].timeSeconds);
    expect(out[0].rationale).toBe('TSB bajo');
    expect(out[0].clamped).toBe(false);
  });

  it('recorta el ajuste al ±8 % y lo marca', () => {
    const items = base();
    const out = applyCoachAdjustment(items, [{ label: items[0].label, time_seconds: items[0].timeSeconds * 2 }]);
    expect(out[0].timeSeconds).toBe(Math.round(items[0].timeSeconds * (1 + MAX_ADJUST_PCT)));
    expect(out[0].clamped).toBe(true);
  });

  it('un tiempo alucinado no puede reescribir la predicción', () => {
    const items = base();
    const out = applyCoachAdjustment(items, items.map((i) => ({ label: i.label, time_seconds: 60 })));
    for (let i = 0; i < items.length; i++) {
      expect(out[i].timeSeconds).toBe(Math.round(items[i].timeSeconds * (1 - MAX_ADJUST_PCT)));
    }
  });

  it('conserva el tiempo calculado si la IA no cubre esa distancia', () => {
    const items = base();
    const out = applyCoachAdjustment(items, [{ label: '10K', time_seconds: items[1].timeSeconds }]);
    expect(out[0].timeSeconds).toBe(items[0].timeSeconds);
    expect(out[0].baseTimeSeconds).toBeUndefined();
  });

  it('no acepta que el ajuste invierta el orden de los ritmos', () => {
    const items = base();
    // La IA acelera la distancia larga y frena la corta: imposible en un corredor.
    const out = applyCoachAdjustment(items, [
      { label: items[0].label, time_seconds: items[0].timeSeconds * 1.08 },
      { label: items[1].label, time_seconds: items[1].timeSeconds * 0.92 },
    ]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].paceSec).toBeGreaterThan(out[i - 1].paceSec);
    }
  });

  it('la confianza no la pone la IA', () => {
    const items = base();
    const out = applyCoachAdjustment(items, [{ label: items[0].label, time_seconds: items[0].timeSeconds, confidence: 'Alta' }]);
    expect(out[0].confidence).toBe(items[0].confidence);
  });
});
