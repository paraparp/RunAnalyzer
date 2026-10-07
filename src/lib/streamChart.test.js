import { describe, it, expect } from 'vitest';
import { buildChartSeries, sliceStreams, segmentStats } from './streamChart';

// 30 min a 1 Hz, 3.33 m/s en llano; FC sube de 140 a 150 de forma lineal.
function makeStreams(n = 1800, { speed = 10 / 3, hr0 = 140, hr1 = 150 } = {}) {
  const idx = Array.from({ length: n }, (_, i) => i);
  return {
    time: { data: idx },
    distance: { data: idx.map((i) => i * speed) },
    altitude: { data: idx.map(() => 100) },
    grade_smooth: { data: idx.map(() => 0) },
    heartrate: { data: idx.map((i) => hr0 + ((hr1 - hr0) * i) / (n - 1)) },
    velocity_smooth: { data: idx.map(() => speed) },
    cadence: { data: idx.map(() => 85) },
    latlng: { data: idx.map((i) => [42 + i * 1e-5, -8]) },
  };
}

describe('buildChartSeries', () => {
  const s = makeStreams();
  const pts = buildChartSeries(s, { target: 300 });

  it('diezma a ~target puntos y conserva el índice original y el final', () => {
    expect(pts.length).toBeLessThanOrEqual(302);
    expect(pts[0].i).toBe(0);
    expect(pts[pts.length - 1].i).toBe(1799);
  });

  it('ritmo en s/km desde velocity_smooth y cadencia en pasos por minuto', () => {
    expect(pts[1].pace).toBe(300);
    expect(pts[1].cad).toBe(170);
    expect(pts[1].lat).toBeCloseTo(42 + pts[1].i * 1e-5);
  });

  it('deja hueco en el ritmo cuando se está parado', () => {
    const st = makeStreams(100);
    st.velocity_smooth.data = st.velocity_smooth.data.map((v, i) => (i < 50 ? 0.3 : v));
    const p = buildChartSeries(st, { target: 100 });
    expect(p[10].pace).toBeNull();
    expect(p[80].pace).toBe(300);
  });

  it('vacío sin streams', () => {
    expect(buildChartSeries(null)).toEqual([]);
  });
});

describe('sliceStreams', () => {
  it('recorta todas las claves por índice, extremos incluidos', () => {
    const s = sliceStreams(makeStreams(10), 2, 4);
    expect(s.time.data).toEqual([2, 3, 4]);
    expect(s.latlng.data).toHaveLength(3);
  });
});

describe('segmentStats', () => {
  const s = makeStreams();

  it('distancia, tiempo, ritmo y FC del tramo', () => {
    const st = segmentStats(s, 0, 1799);
    expect(st.distance_m).toBe(5997);
    expect(st.time_s).toBe(1799);
    expect(st.speed_ms).toBeCloseTo(10 / 3);
    expect(st.avg_hr).toBe(145);
    expect(st.avg_cadence).toBe(170);
    expect(st.gap_speed_ms).toBeCloseTo(10 / 3, 1); // llano → GAP = ritmo
  });

  it('acepta el rango al revés (arrastre de derecha a izquierda)', () => {
    expect(segmentStats(s, 900, 100)).toEqual(segmentStats(s, 100, 900));
  });

  it('deriva positiva cuando la FC sube a ritmo constante', () => {
    expect(segmentStats(s, 0, 1799).drift_pct).toBeGreaterThan(3);
  });

  it('sin deriva en tramos de menos de 10 minutos', () => {
    expect(segmentStats(s, 0, 300).drift_pct).toBeNull();
  });

  it('null en tramos degenerados', () => {
    expect(segmentStats(s, 5, 6)).toBeNull();
    expect(segmentStats({}, 0, 100)).toBeNull();
  });
});
