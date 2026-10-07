import { describe, it, expect } from 'vitest';
import {
  withRollingAverage, changeOver, pearson, monthlyWeightVsEfficiency, describeCorrelation,
} from './weightTrend';

const w = (date, weight_kg) => ({ date, weight_kg });

describe('withRollingAverage', () => {
  it('promedia las pesadas de los 7 días naturales que acaban en la fecha', () => {
    const out = withRollingAverage([
      w('2026-01-01', 70), w('2026-01-03', 72), w('2026-01-07', 74), w('2026-01-08', 76),
    ]);
    expect(out.map((r) => r.avg7)).toEqual([70, 71, 72, 74]); // el 8 ya no ve el día 1
  });

  it('no inventa pesadas en los huecos', () => {
    const out = withRollingAverage([w('2026-01-01', 70), w('2026-02-01', 80)]);
    expect(out[1].avg7).toBe(80);
  });
});

describe('changeOver', () => {
  const s = withRollingAverage([w('2026-01-01', 72), w('2026-01-20', 71), w('2026-02-01', 70)]);
  it('compara la última media con la más cercana sin pasarse de la fecha objetivo', () => {
    expect(changeOver(s, 30)).toBe(-2);
  });
  it('null si no hay histórico tan antiguo', () => {
    expect(changeOver(s, 90)).toBeNull();
  });
});

describe('pearson', () => {
  it('detecta una relación inversa perfecta', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBe(-1);
  });
  it('null con pocos puntos o varianza nula', () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull();
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });
});

describe('monthlyWeightVsEfficiency', () => {
  // Rodaje llano, 10 km a 4.5 m/s y FC 150: entra en la banda con FCmax 190.
  const run = (date, hr) => ({
    type: 'Run', start_date_local: `${date}T08:00:00Z`, distance: 10000,
    moving_time: 2400, average_speed: 4.17, average_heartrate: hr, total_elevation_gain: 20,
  });
  const months = ['2026-01', '2026-02', '2026-03', '2026-04'];
  const weights = months.map((m, i) => w(`${m}-10`, 74 - i));
  const acts = months.flatMap((m, i) => [5, 12, 19].map((d) => run(`${m}-${String(d).padStart(2, '0')}`, 152 - i * 2)));

  it('cruza peso y EF por mes y mide la correlación', () => {
    const { months: rows, r } = monthlyWeightVsEfficiency(weights, acts, { maxObservedHr: 190 });
    expect(rows).toHaveLength(4);
    expect(rows[0].runs).toBe(3);
    expect(r).toBeLessThan(-0.9); // menos peso, menos FC al mismo ritmo → más EF
  });

  it('descarta meses sin rodajes suficientes', () => {
    const { months: rows } = monthlyWeightVsEfficiency(weights, acts.slice(0, 2), { maxObservedHr: 190 });
    expect(rows).toHaveLength(0);
  });
});

describe('describeCorrelation', () => {
  it('lee el signo y la fuerza', () => {
    expect(describeCorrelation(-0.8)).toMatch(/fuerte.*menos peso/);
    expect(describeCorrelation(0.1)).toMatch(/Sin relación/);
    expect(describeCorrelation(null)).toBeNull();
  });
});
