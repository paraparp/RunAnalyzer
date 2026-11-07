import { describe, it, expect } from 'vitest';
import { compareEfficiency, selectGroup, sessionPoint, SLOPE_PRIOR } from './efficiencyCompare.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 1);

// Atleta sintético: FC = 150 + 40·(v − 3) − 1,5 ppm/mes. Mejora de forma real.
const pt = (i, v, extra = {}) => {
  const months = (i * 15) / 30.44;
  const hr = 150 + 40 * (v - 3) - 1.5 * months;
  return {
    ok: true, id: i, name: `r${i}`, date: new Date(T0 + i * 15 * DAY).toISOString(),
    ts: T0 + i * 15 * DAY, distance_m: 10000, effort: v, hr, wbgt: null,
    hr_source: 'strap', elev_per_km: 5, split_cv: 0.03, race: false, ...extra,
  };
};

describe('compareEfficiency', () => {
  const speeds = [3.0, 3.2, 2.9, 3.1, 3.3, 2.95, 3.15, 3.05, 3.25, 2.85, 3.1, 3.0];
  const pts = speeds.map((v, i) => pt(i, v));

  it('recupera la pendiente y no la aplana por la mejora de forma', () => {
    const m = compareEfficiency(pts);
    expect(m.ok).toBe(true);
    expect(m.slope_source).toBe('data');
    expect(m.slope).toBeGreaterThan(38);
    expect(m.slope).toBeLessThan(42);
  });

  it('detecta la mejora como ritmo más rápido a FC fija', () => {
    const m = compareEfficiency(pts);
    expect(m.trend.significant).toBe(true);
    expect(m.trend.pace_s_per_month).toBeLessThan(0);
  });

  it('la sesión más reciente queda mejor que la más antigua a pesar de ir más lenta', () => {
    const m = compareEfficiency(pts);
    const first = m.sessions[0];
    const last = m.sessions[m.sessions.length - 1];
    expect(last.pace_at_ref_s).toBeLessThan(first.pace_at_ref_s);
  });

  it('con pocas sesiones usa el prior', () => {
    const m = compareEfficiency(pts.slice(0, 4));
    expect(m.slope_source).toBe('prior');
    expect(m.slope).toBe(SLOPE_PRIOR.mean);
  });

  it('pide al menos 3 sesiones', () => {
    expect(compareEfficiency(pts.slice(0, 2)).ok).toBe(false);
  });
});

describe('selectGroup', () => {
  it('excluye competiciones y series, y no mezcla banda con muñeca', () => {
    const pts = [
      pt(1, 3), pt(2, 3), pt(3, 3),
      pt(4, 3, { race: true }),
      pt(5, 3, { split_cv: 0.2 }),
      pt(6, 3, { hr_source: 'wrist' }),
    ];
    const g = selectGroup(pts, { mode: 'family', family: 'medium' });
    expect(g.points.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(g.dropped).toEqual({ races: 1, variable: 1, sensor: 1 });
  });

  it('modo similar filtra por distancia alrededor de la referencia', () => {
    const pts = [pt(1, 3), pt(2, 3, { distance_m: 15000 }), pt(3, 3, { distance_m: 10800 })];
    const g = selectGroup(pts, { mode: 'similar', refId: 1 });
    expect(g.points.map((p) => p.id)).toEqual([1, 3]);
  });
});

describe('sessionPoint', () => {
  it('usa los parciales (sin el km 1) cuando no hay hr_effort', () => {
    const split = (hr) => ({ distance: 1000, moving_time: 300, average_speed: 1000 / 300, average_heartrate: hr, elevation_difference: 0 });
    const a = {
      id: 1, type: 'Run', start_date: '2026-01-01T08:00:00Z', distance: 5000, moving_time: 1500,
      average_heartrate: 145, splits_metric: [split(120), split(150), split(150), split(150), split(150)],
    };
    const p = sessionPoint(a);
    expect(p.source).toBe('splits');
    expect(p.hr).toBeCloseTo(150);
  });
});
