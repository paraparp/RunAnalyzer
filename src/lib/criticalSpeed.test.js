import { describe, it, expect } from 'vitest';
import {
  buildMeanMaxCurve, fitCriticalSpeed, predictTime, speedForDuration,
  canonByMeters, raceDistanceId,
} from './criticalSpeed';

// Distancia por defecto NO canónica (12,4 km): así la actividad solo aporta los
// best_efforts que se le pongan, sin sintetizar además un punto por su total.
const run = (o) => ({ id: 1, type: 'Run', start_date_local: '2026-05-10T08:00:00Z', distance: 12400, moving_time: 3400, best_efforts: [], ...o });
const effort = (distance, time) => ({ distance, moving_time: time, elapsed_time: time });

describe('reconocimiento de distancias', () => {
  it('casa por metros, no por nombre localizado', () => {
    expect(canonByMeters(5000)).toBe('5k');
    expect(canonByMeters(21097)).toBe('half-marathon');
    expect(canonByMeters(1609)).toBe('1 mile');
    expect(canonByMeters(7000)).toBe(null);
  });

  it('una carrera medida algo larga sigue siendo su distancia', () => {
    expect(raceDistanceId(21350)).toBe('half-marathon');   // +1.2%
    expect(raceDistanceId(20800)).toBe(null);              // corta: no cuenta
  });
});

describe('buildMeanMaxCurve', () => {
  it('se queda con el mejor tiempo de cada distancia', () => {
    const acts = [
      run({ id: 1, best_efforts: [effort(5000, 1200)] }),
      run({ id: 2, best_efforts: [effort(5000, 1140)] }),   // más rápido
      run({ id: 3, best_efforts: [effort(1000, 200)] }),
    ];
    const curve = buildMeanMaxCurve(acts);
    expect(curve.map(p => p.id)).toEqual(['1k', '5k']);
    expect(curve.find(p => p.id === '5k').time_s).toBe(1140);
    expect(curve.find(p => p.id === '5k').activity_id).toBe(2);
  });

  it('rescata carreras antiguas sin best_efforts usando el tiempo total', () => {
    const curve = buildMeanMaxCurve([run({ distance: 21350, moving_time: 5936, best_efforts: [] })]);
    expect(curve[0].id).toBe('half-marathon');
    expect(curve[0].source).toBe('total_distance');
  });

  it('respeta el rango de fechas y descarta lo que no es carrera a pie', () => {
    const acts = [
      run({ id: 1, start_date_local: '2025-01-05T08:00:00Z', best_efforts: [effort(5000, 1100)] }),
      run({ id: 2, start_date_local: '2026-05-05T08:00:00Z', best_efforts: [effort(5000, 1200)] }),
      run({ id: 3, type: 'Ride', start_date_local: '2026-05-06T08:00:00Z', best_efforts: [effort(5000, 600)] }),
    ];
    const curve = buildMeanMaxCurve(acts, { from: '2026-01-01' });
    expect(curve).toHaveLength(1);
    expect(curve[0].time_s).toBe(1200);
  });
});

describe('fitCriticalSpeed', () => {
  // Atleta sintético con CS = 4 m/s (4:10/km) y D′ = 200 m: d = 4t + 200
  const synthetic = [180, 300, 600, 1200].map((t) => ({
    id: `t${t}`, time_s: t, distance_m: 4 * t + 200,
  }));

  it('recupera CS y D′ de datos que siguen el modelo', () => {
    const fit = fitCriticalSpeed(synthetic);
    expect(fit.cs_m_s).toBeCloseTo(4, 6);
    expect(fit.d_prime_m).toBeCloseTo(200, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(fit.cs_pace_min_km).toBeCloseTo(4.1667, 3);   // 4:10/km
  });

  it('ignora los puntos fuera de la ventana de validez', () => {
    const conRuido = [
      { id: 'sprint', time_s: 60, distance_m: 400 },        // demasiado corto
      ...synthetic,
      { id: 'maraton', time_s: 9000, distance_m: 30000 },   // demasiado largo
    ];
    const fit = fitCriticalSpeed(conRuido);
    expect(fit.n).toBe(4);
    expect(fit.cs_m_s).toBeCloseTo(4, 6);
  });

  it('sin puntos suficientes no inventa un ajuste', () => {
    expect(fitCriticalSpeed(synthetic.slice(0, 2))).toBe(null);
    expect(fitCriticalSpeed([])).toBe(null);
  });

  it('rechaza ajustes sin sentido físico', () => {
    // Puntos incoherentes (más lento cuanto más corto) → pendiente o corte negativos
    const absurdo = [
      { id: 'a', time_s: 200, distance_m: 3000 },
      { id: 'b', time_s: 600, distance_m: 3200 },
      { id: 'c', time_s: 1200, distance_m: 3300 },
    ];
    const fit = fitCriticalSpeed(absurdo);
    expect(fit === null || fit.d_prime_m > 0).toBe(true);
  });
});

describe('predicciones', () => {
  const fit = fitCriticalSpeed([180, 300, 600, 1200].map((t) => ({ id: `t${t}`, time_s: t, distance_m: 4 * t + 200 })));

  it('predice el tiempo de una distancia dentro de la ventana', () => {
    const p = predictTime(fit, 5000);
    expect(p.time_s).toBeCloseTo(1200, 4);      // (5000-200)/4
    expect(p.optimistic).toBe(false);
  });

  it('marca como optimista lo que cae fuera de la ventana', () => {
    expect(predictTime(fit, 21097).optimistic).toBe(true);
    expect(predictTime(fit, 42195).optimistic).toBe(true);
  });

  it('la velocidad sostenible tiende a CS al alargar el esfuerzo', () => {
    expect(speedForDuration(fit, 300)).toBeGreaterThan(fit.cs_m_s);
    expect(speedForDuration(fit, 36000)).toBeCloseTo(fit.cs_m_s, 1);
  });
});
