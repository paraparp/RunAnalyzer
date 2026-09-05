import { describe, it, expect } from 'vitest';
import { calculateVDOT, predictRaceTime, vdotFromCurve, VDOT_MIN_S, VDOT_MAX_S } from './vdot.js';

// Punto de referencia de las tablas de Daniels: VDOT 50 = 10K en 41:21.
const TEN_K = { d: 10000, t: 2481 };

describe('calculateVDOT', () => {
  it('reproduce el VDOT 50 de tabla (10K en 41:21)', () => {
    expect(calculateVDOT(TEN_K.d, TEN_K.t)).toBeCloseTo(50, 1);
  });

  it('crece cuando el mismo atleta corre más rápido', () => {
    expect(calculateVDOT(10000, 2200)).toBeGreaterThan(calculateVDOT(10000, 2400));
  });

  it('da el mismo VDOT a rendimientos equivalentes de la tabla', () => {
    // VDOT 50: 5K en 19:57 y 10K en 41:21.
    expect(calculateVDOT(5000, 1197)).toBeCloseTo(calculateVDOT(10000, 2481), 1);
  });

  it('descarta entradas sin sentido', () => {
    expect(calculateVDOT(0, 2400)).toBeNull();
    expect(calculateVDOT(10000, 0)).toBeNull();
  });
});

describe('predictRaceTime', () => {
  it('es la inversa de calculateVDOT', () => {
    const vdot = calculateVDOT(TEN_K.d, TEN_K.t);
    expect(predictRaceTime(vdot, TEN_K.d)).toBeCloseTo(TEN_K.t, 0);
  });

  it('predice más tiempo para más distancia', () => {
    const vdot = calculateVDOT(TEN_K.d, TEN_K.t);
    expect(predictRaceTime(vdot, 21097)).toBeGreaterThan(predictRaceTime(vdot, 10000));
  });

  // Regresión: la bisección leía el `null` de una velocidad demasiado lenta como
  // "demasiado rápido" y devolvía el tope de 10 h en toda distancia < ~7,5 km.
  it('invierte también las distancias cortas (VDOT 50 → 5K en 19:57)', () => {
    const vdot = calculateVDOT(TEN_K.d, TEN_K.t);
    expect(predictRaceTime(vdot, 5000)).toBeCloseTo(1197, -1);
  });

  it('es la inversa de calculateVDOT en todo el rango de distancias', () => {
    const vdot = calculateVDOT(TEN_K.d, TEN_K.t);
    for (const d of [1500, 3000, 5000, 10000, 21097.5, 42195]) {
      expect(calculateVDOT(d, predictRaceTime(vdot, d))).toBeCloseTo(vdot, 1);
    }
  });
});

describe('vdotFromCurve', () => {
  const punto = (id, distance_m, time_s, date) => ({
    id, distance_m, time_s, date,
    speed_m_s: distance_m / time_s,
    pace_min_km: (time_s / 60) / (distance_m / 1000),
  });

  it('toma el MEJOR rendimiento de la curva, no el último ni la media', () => {
    const r = vdotFromCurve([
      punto('5k', 5000, 1360, '2026-01-10'),    // flojo
      punto('10k', 10000, 2481, '2026-02-10'),  // el bueno
      punto('21k', 21097, 6000, '2026-03-10'),
    ]);
    expect(r.anchor.id).toBe('10k');
    expect(r.vdot).toBeCloseTo(Math.round(calculateVDOT(10000, 2481) * 10) / 10, 5);
    expect(r.n).toBe(3);
  });

  it('A1: un rodaje suave no puede subir la cifra', () => {
    const soloEsfuerzo = [punto('10k', 10000, 2481, '2026-02-10')];
    const conRodaje = [...soloEsfuerzo, punto('5k', 5000, 1500, '2026-02-11')];
    expect(vdotFromCurve(conRodaje).vdot).toBe(vdotFromCurve(soloEsfuerzo).vdot);
  });

  it('ignora los puntos fuera de la ventana de validez', () => {
    const fuera = [
      punto('400m', 400, 70, '2026-02-10'),               // por debajo de VDOT_MIN_S
      punto('50k', 50000, VDOT_MAX_S + 600, '2026-02-10'), // por encima de VDOT_MAX_S
    ];
    expect(vdotFromCurve(fuera)).toBeNull();
    expect(VDOT_MIN_S).toBeLessThan(VDOT_MAX_S);
  });

  it('devuelve null sin puntos utilizables', () => {
    expect(vdotFromCurve([])).toBeNull();
    expect(vdotFromCurve()).toBeNull();
  });
});
