import { describe, it, expect } from 'vitest';
import polyline from '@mapbox/polyline';
import { repeatedRoutes, slope, describeTrend } from './routeProgression';

// Vuelta de ~3 km en línea recta ida y vuelta desde (42.88, -8.54).
const loop = (dLat = 0) => polyline.encode(
  Array.from({ length: 30 }, (_, i) => [42.88 + dLat + (i < 15 ? i : 29 - i) * 0.001, -8.54]),
);
const other = polyline.encode(Array.from({ length: 30 }, (_, i) => [42.88, -8.54 + i * 0.001]));

const run = (id, date, { poly = loop(), hr = 145, speed = 3.3, name = 'Vuelta al parque' } = {}) => ({
  id, name, type: 'Run', start_date_local: `${date}T08:00:00Z`,
  distance: 3000, moving_time: Math.round(3000 / speed), average_speed: speed,
  average_heartrate: hr, total_elevation_gain: 0, map: { summary_polyline: poly },
});

describe('slope', () => {
  it('pendiente de una recta', () => {
    expect(slope([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toBe(2);
    expect(slope([{ x: 0, y: 1 }])).toBeNull();
  });
});

describe('repeatedRoutes', () => {
  // Mismo circuito 4 veces, cada vez con menos FC al mismo ritmo; otro circuito 2 veces.
  const acts = [
    run(1, '2026-01-01', { hr: 150 }),
    run(2, '2026-02-01', { hr: 146 }),
    run(3, '2026-03-01', { hr: 142, speed: 3.6 }),
    run(4, '2026-04-01', { hr: 138 }),
    run(5, '2026-02-10', { poly: other, name: 'Otra' }),
    run(6, '2026-03-10', { poly: other, name: 'Otra' }),
  ];
  const routes = repeatedRoutes(acts, { maxObservedHr: 190 });

  it('solo los recorridos con 3 o más salidas', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0].sessions.map((s) => s.id)).toEqual([1, 2, 3, 4]);
    expect(routes[0].name).toBe('Vuelta al parque');
    expect(routes[0].distance_km).toBe(3);
  });

  it('la mejor es la de mayor GAP y la tendencia de eficiencia sube', () => {
    expect(routes[0].best.id).toBe(3);
    expect(routes[0].ef_trend_pct_per_90d).toBeGreaterThan(1);
    expect(describeTrend(routes[0])).toMatch(/más eficiente/);
  });

  it('las salidas fuera de la banda aeróbica no cuentan para la tendencia', () => {
    const hard = repeatedRoutes([
      run(1, '2026-01-01', { hr: 185 }), run(2, '2026-02-01', { hr: 186 }), run(3, '2026-03-01', { hr: 184 }),
    ], { maxObservedHr: 190 });
    expect(hard[0].comparable).toBe(0);
    expect(hard[0].ef_trend_pct_per_90d).toBeNull();
    expect(describeTrend(hard[0])).toMatch(/Hacen falta/);
  });
});
