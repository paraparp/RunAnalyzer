import { describe, it, expect } from 'vitest';
import { buildMeanMaxCurve, fitCriticalSpeed, monthsAgoISO } from './criticalSpeed';
import { computeCriticalSpeed } from './lactateThreshold';

const today = new Date().toISOString().slice(0, 10);
const effort = (distance, time) => ({ distance, moving_time: time, elapsed_time: time });

// Atleta sintético con CS = 4 m/s y D′ = 200 m: d = 4t + 200. Los tres esfuerzos
// caen dentro de la ventana 120–1800 s (1K → 200 s, 2 millas → 755 s, 5K → 1200 s).
const athlete = [{
  id: 1, type: 'Run', start_date_local: `${today}T08:00:00Z`,
  distance: 12400, moving_time: 3400,   // total NO canónico: no sintetiza punto extra
  best_efforts: [1000, 3219, 5000].map((d) => effort(d, (d - 200) / 4)),
}];

describe('computeCriticalSpeed delega en el modelo compartido', () => {
  it('da EXACTAMENTE la misma CS que la pestaña de Velocidad Crítica', () => {
    const tab = fitCriticalSpeed(buildMeanMaxCurve(athlete, { from: monthsAgoISO(12) }));
    const lt = computeCriticalSpeed(athlete, 12);

    expect(lt.valid).toBe(true);
    expect(lt.cs).toBe(tab.cs_m_s);
    expect(lt.dPrime).toBe(tab.d_prime_m);
    expect(lt.csPace).toBe(tab.cs_pace_min_km);
    expect(lt.r2).toBe(tab.r2);
    expect(lt.nEfforts).toBe(tab.n);
  });

  it('recupera el CS del atleta sintético', () => {
    const lt = computeCriticalSpeed(athlete, 12);
    expect(lt.cs).toBeCloseTo(4, 2);
    expect(lt.dPrime).toBeCloseTo(200, 0);
  });

  it('expone los puntos de la ventana para la gráfica', () => {
    const { efforts } = computeCriticalSpeed(athlete, 12);
    expect(efforts).toHaveLength(3);
    expect(efforts.every((e) => e.t >= 120 && e.t <= 1800)).toBe(true);
    expect(efforts.every((e) => e.durMin > 0 && e.pace > 0)).toBe(true);
  });

  it('sin esfuerzos suficientes no inventa un umbral', () => {
    const flojo = [{ ...athlete[0], best_efforts: [effort(1000, 200)] }];
    const lt = computeCriticalSpeed(flojo, 12);
    expect(lt.valid).toBe(false);
    expect(lt.cs).toBeUndefined();
    expect(lt.nEfforts).toBe(1);
  });

  it('marca como no máximos los esfuerzos que se contradicen entre sí', () => {
    // El 5K a 4,5 m/s siendo el 1K más lento: imposible corriendo a tope.
    const incoherente = [{
      ...athlete[0],
      best_efforts: [effort(1000, 250), effort(3219, 780), effort(5000, 1111)],
    }];
    expect(computeCriticalSpeed(incoherente, 12).nonMaximal).toBe(true);
    expect(computeCriticalSpeed(athlete, 12).nonMaximal).toBe(false);
  });

  it('respeta la ventana temporal: lo viejo no entra', () => {
    const viejo = [{ ...athlete[0], start_date_local: '2019-01-01T08:00:00Z' }];
    expect(computeCriticalSpeed(viejo, 12).valid).toBe(false);
    expect(computeCriticalSpeed(viejo, null).valid).toBe(true);  // null = sin límite
  });
});
