import { describe, it, expect } from 'vitest';
import { weeklyVolumeRamp, WEEKLY_RAMP } from './weeklyVolume';

describe('weeklyVolumeRamp', () => {
  it('devuelve las dos escalas del salto', () => {
    const r = weeklyVolumeRamp(55, 50);
    expect(r.changePct).toBeCloseTo(10, 6);
    expect(r.absDeltaKm).toBeCloseTo(5, 6);
  });

  it('sin semana previa no inventa un porcentaje, pero sí lee el salto', () => {
    // Volver de una semana en blanco a 40 km ES una rampa: no hay % que calcular
    // (dividir por cero), pero la escala absoluta sigue valiendo. Es el criterio
    // que InjuryRisk ya aplicaba.
    const r = weeklyVolumeRamp(40, 0);
    expect(r.changePct).toBe(0);
    expect(r.pctRisk).toBe(0);
    expect(r.absRisk).toBe(80);
    expect(r.exceeds).toBe(true);
  });

  it('escala el riesgo por porcentaje', () => {
    expect(weeklyVolumeRamp(70, 50).pctRisk).toBe(80); // +40 %, +20 km
    expect(weeklyVolumeRamp(140, 100).pctRisk).toBe(80); // +40 % con base grande
  });

  it('un porcentaje grande sobre base pequeña no dispara la alerta', () => {
    // +40 % sobre 5 km/sem son 2 km: la regla en porcentaje lo pintaba en rojo.
    const r = weeklyVolumeRamp(7, 5);
    expect(r.changePct).toBeCloseTo(40, 6);
    expect(r.absDeltaKm).toBeLessThan(WEEKLY_RAMP.minAbsKm);
    expect(r.exceeds).toBe(false);
  });

  it('un salto absoluto grande dispara aunque el porcentaje sea bajo', () => {
    // +15 % sobre 90 km/sem son 13,5 km: la lectura en porcentaje se quedaba corta.
    const r = weeklyVolumeRamp(103.5, 90);
    expect(r.changePct).toBeCloseTo(15, 6);
    expect(r.absRisk).toBe(50);
    expect(r.exceeds).toBe(true);
  });

  it('el tope del porcentaje solo aplica a subidas pequeñas en km', () => {
    const small = weeklyVolumeRamp(12, 8);   // +50 %, +4 km
    expect(small.pctRisk).toBe(25);
    const big = weeklyVolumeRamp(80, 50);    // +60 %, +30 km
    expect(big.pctRisk).toBe(80);
  });

  it('una caída brusca también puntúa, pero no marca exceso', () => {
    const r = weeklyVolumeRamp(20, 50);
    expect(r.pctRisk).toBe(15);
    expect(r.exceeds).toBe(false);
  });

  it('una semana igual a la anterior no arroja riesgo', () => {
    const r = weeklyVolumeRamp(50, 50);
    expect(r.risk).toBe(0);
    expect(r.exceeds).toBe(false);
  });
});
