import { describe, it, expect } from 'vitest';
import {
  minettiCost, gapFactor, gapFactorFromGain, gapSpeed, gapSpeedFromGain, FLAT_COST,
} from './gap';

describe('minettiCost', () => {
  it('en llano vale C(0) = 3.6', () => {
    expect(minettiCost(0)).toBeCloseTo(FLAT_COST, 10);
  });

  it('crece monótonamente en subida', () => {
    const costs = [0, 0.02, 0.05, 0.10, 0.20].map(minettiCost);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
  });

  it('bajar cuesta menos que el llano', () => {
    expect(minettiCost(-0.05)).toBeLessThan(FLAT_COST);
  });
});

describe('gapFactor', () => {
  it('el llano no ajusta nada', () => {
    expect(gapFactor(0)).toBe(1);
  });

  it('ignora entradas no numéricas', () => {
    expect(gapFactor(NaN)).toBe(1);
    expect(gapFactor(undefined)).toBe(1);
    expect(gapFactor(null)).toBe(1);
  });

  it('subir da factor > 1 y bajar < 1', () => {
    expect(gapFactor(0.05)).toBeGreaterThan(1);
    expect(gapFactor(-0.05)).toBeLessThan(1);
  });

  it('es asimétrico: la subida penaliza más de lo que premia la bajada', () => {
    const up = gapFactor(0.05) - 1;
    const down = 1 - gapFactor(-0.05);
    expect(up).toBeGreaterThan(down);
  });

  it('reproduce la regla clásica de ~8 s/km por cada 1% de pendiente neta', () => {
    // 5:00/km = 300 s/km. El modelo lineal que se retiró restaba 8 s por cada
    // 10 m D+/km, que es justo un 1% de pendiente.
    const gapPaceS = 300 / gapFactor(0.01);
    expect(300 - gapPaceS).toBeGreaterThan(6);
    expect(300 - gapPaceS).toBeLessThan(10);
  });

  it('respeta el suelo y el techo', () => {
    expect(gapFactor(-0.50)).toBeGreaterThanOrEqual(0.86);
    expect(gapFactor(0.50)).toBeLessThanOrEqual(1.35);
  });
});

describe('gapFactorFromGain', () => {
  it('sin desnivel no ajusta', () => {
    expect(gapFactorFromGain(10000, 0)).toBe(1);
    expect(gapFactorFromGain(10000, undefined)).toBe(1);
  });

  it('protege distancias inválidas', () => {
    expect(gapFactorFromGain(0, 100)).toBe(1);
    expect(gapFactorFromGain(-5, 100)).toBe(1);
  });

  it('con D+ acumulado el ajuste es mucho menor que tratarlo como pendiente neta', () => {
    // 10 km con 100 m D+ = 10 m/km. El modelo lineal antiguo cobraba 8 s/km.
    const ondulado = 300 / gapFactorFromGain(10000, 100);
    const comoNeta = 300 / gapFactor(0.01);
    expect(300 - ondulado).toBeGreaterThan(0);
    expect(300 - ondulado).toBeLessThan(300 - comoNeta);
  });

  it('crece con el desnivel acumulado', () => {
    const suave = gapFactorFromGain(10000, 50);
    const duro = gapFactorFromGain(10000, 400);
    expect(duro).toBeGreaterThan(suave);
    expect(suave).toBeGreaterThan(1);
  });
});

describe('gapSpeed / gapSpeedFromGain', () => {
  it('devuelven 0 sin velocidad', () => {
    expect(gapSpeed(0, 0.05)).toBe(0);
    expect(gapSpeedFromGain(0, 10000, 100)).toBe(0);
  });

  it('la velocidad equivalente en subida es mayor que la medida', () => {
    expect(gapSpeed(3, 0.05)).toBeGreaterThan(3);
    expect(gapSpeedFromGain(3, 10000, 200)).toBeGreaterThan(3);
  });
});
