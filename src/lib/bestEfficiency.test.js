import { describe, it, expect } from 'vitest';
import { bestEfficiencyWindows } from './streamChart';

const make = (n, hrAt) => {
  const distance = [], time = [], heartrate = [];
  for (let j = 0; j < n; j++) { time.push(j); distance.push(j * 4); heartrate.push(hrAt(j)); }
  return { distance: { data: distance }, time: { data: time }, heartrate: { data: heartrate } };
};

describe('bestEfficiencyWindows', () => {
  it('encuentra el tramo más eficiente y omite distancias que no caben', () => {
    const res = bestEfficiencyWindows(make(1801, (j) => (j < 1200 ? 160 : 140)), [3000, 10000]);
    expect(res).toHaveLength(1);
    expect(res[0].distance_m).toBe(3000);
    expect(res[0].i0).toBeGreaterThanOrEqual(1000);
  });

  it('ignora el calentamiento (FC aún baja) y las caídas del sensor', () => {
    // FC 110 los primeros 5 min (retraso cardiaco), 150 después, con un hueco a 60.
    const res = bestEfficiencyWindows(make(2401, (j) => (j < 300 ? 110 : j > 1500 && j < 1560 ? 60 : 150)), [3000]);
    expect(res[0].i0).toBeGreaterThanOrEqual(300);
    expect(res[0].avg_hr).toBeCloseTo(150, 0);
  });
});
