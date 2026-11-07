import { describe, it, expect } from 'vitest';
import { epochAdjusters, fitAdjusters, runSplits, adjustRun } from './driftAdjust.js';

// Atleta sintético con deriva conocida: 1 ppm/km hasta el 10, +0,6 ppm/km extra
// después, y 40 ppm por m/s de ritmo. Cada tirada lleva su "día" (α) propio.
const TRUE = { drift: 1, driftLong: 0.6, pace: 40 };
const REF = 1000 / 330; // 5:30/km

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };

function makeRun(id, day, km, paceS, alpha, { progressive = 0 } = {}) {
  const splits = [];
  for (let k = 1; k <= km; k++) {
    const p = paceS - progressive * (k - 1); // s/km
    const v = 1000 / p;
    const hr = alpha + TRUE.pace * (v - REF) + TRUE.drift * (k - 1) + TRUE.driftLong * Math.max(0, k - 10) + rnd();
    splits.push({ distance: 1000, moving_time: p, average_speed: v, average_heartrate: hr, elevation_difference: 0 });
  }
  return {
    id, type: 'Run', start_date: new Date(Date.UTC(2026, 3, 1) + day * 86400000).toISOString(),
    distance: km * 1000, splits_metric: splits,
  };
}

const runs = [];
for (let i = 0; i < 24; i++) {
  const km = [6, 8, 10, 12, 16, 21][i % 6];
  const pace = [300, 315, 330, 345, 360][i % 5];
  runs.push(makeRun(i, i * 3, km, pace, 140 + rnd() * 6, { progressive: i % 4 === 0 ? 2 : 0 }));
}

describe('fitAdjusters', () => {
  it('recupera deriva y coste del ritmo desde dentro de cada tirada', () => {
    const coef = fitAdjusters(runs.map(runSplits).filter(Boolean), REF);
    expect(coef.drift.value).toBeCloseTo(TRUE.drift, 0);
    expect(coef.driftLong.value).toBeGreaterThan(0.3);
    expect(coef.driftLong.value).toBeLessThan(0.9);
    expect(coef.pace.value).toBeGreaterThan(30);
    expect(coef.pace.value).toBeLessThan(50);
  });
});

describe('epochAdjusters', () => {
  it('el 10k llano equivalente no depende de la distancia ni del ritmo del día', () => {
    // Mismo α (misma forma), tiradas muy distintas.
    const extra = [
      makeRun('a', 30, 6, 300, 142),
      makeRun('b', 31, 18, 360, 142),
      makeRun('c', 32, 10, 330, 142),
    ];
    const res = epochAdjusters([...runs, ...extra], { refPaceS: 330 });
    const v = ['a', 'b', 'c'].map((id) => res.byId.get(id).mpb_10k);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThan(0.01); // m/latido, sobre ~1,28
    // Y en crudo sí eran muy distintos.
    const raw = ['a', 'b', 'c'].map((id) => res.byId.get(id).mpb_raw);
    expect(Math.max(...raw) - Math.min(...raw)).toBeGreaterThan(0.05);
  });

  it('los ajustadores suman de lo medido al 10k equivalente', () => {
    const res = epochAdjusters(runs, { refPaceS: 330 });
    const r = res.byId.get('5') || [...res.byId.values()][0];
    const sum = r.mpb_raw + r.adj.grade + r.adj.distance + r.adj.pace;
    expect(sum).toBeCloseTo(r.mpb_10k, 6);
  });

  it('publica un ajuste por mes', () => {
    const res = epochAdjusters(runs, { refPaceS: 330 });
    expect(res.epochs.length).toBeGreaterThan(0);
    expect(res.epochs[0].drift).toBeGreaterThan(0);
  });

  it('una tirada corta suma deriva y una larga la resta', () => {
    const coef = { drift: { value: 1 }, driftLong: { value: 0.5 }, pace: { value: 40 } };
    const short = adjustRun(runSplits(makeRun('s', 0, 6, 330, 140)), coef, REF);
    const long = adjustRun(runSplits(makeRun('l', 0, 20, 330, 140)), coef, REF);
    // Corta: le falta deriva → baja su m/latido. Larga: le sobra → sube.
    expect(short.adj.distance).toBeLessThan(0);
    expect(long.adj.distance).toBeGreaterThan(0);
  });
});
