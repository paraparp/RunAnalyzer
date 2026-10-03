import { describe, it, expect } from 'vitest';
import { seasonTotals, pctChange } from './seasonTotals';

const run = (iso, km, min, elev = 0) => ({
  start_date: iso, distance: km * 1000, moving_time: min * 60, total_elevation_gain: elev,
});

describe('seasonTotals', () => {
  const now = new Date(2026, 5, 30, 12); // 30 jun 2026

  it('suma la temporada en curso y el mismo tramo del año anterior', () => {
    const runs = [
      run('2026-02-01T08:00:00Z', 10, 50, 100),
      run('2026-06-29T08:00:00Z', 5, 30, 20),
      run('2025-03-01T08:00:00Z', 8, 48),
      run('2025-09-01T08:00:00Z', 20, 120), // después del 30 jun: fuera del tramo
      run('2024-05-01T08:00:00Z', 12, 60),  // otra temporada
    ];
    const t = seasonTotals(runs, now);
    expect(t.year).toBe(2026);
    expect(t.cur.count).toBe(2);
    expect(t.cur.distKm).toBe(15);
    expect(t.cur.timeH).toBeCloseTo(80 / 60);
    expect(t.cur.elevM).toBe(120);
    expect(t.cur.paceSecKm).toBeCloseTo((80 * 60) / 15);
    expect(t.prev.count).toBe(1);
    expect(t.prev.distKm).toBe(8);
  });

  it('usa las mismas semanas para las dos medias semanales', () => {
    const t = seasonTotals([run('2026-01-10T08:00:00Z', 26, 130), run('2025-01-10T08:00:00Z', 13, 65)], now);
    expect(t.cur.kmPerWeek).toBeCloseTo(26 / t.weeks);
    expect(t.cur.kmPerWeek / t.prev.kmPerWeek).toBeCloseTo(2);
  });

  it('sin carreras no inventa ritmo', () => {
    const t = seasonTotals([], now);
    expect(t.cur.count).toBe(0);
    expect(t.cur.paceSecKm).toBeNull();
  });
});

describe('pctChange', () => {
  it('redondea la variación y no compara contra cero', () => {
    expect(pctChange(118, 100)).toBe(18);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
  });
});
