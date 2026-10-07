import { describe, it, expect } from 'vitest';
import {
  parseCourseFile, buildCourse, compactCourse, pacePlan, raceHeat, typicalFade, timeWithFade, fuelPlan, haversine,
} from './raceStrategy';

// Recorrido recto hacia el norte: 0.009° ≈ 1 km. `eleAt(km)` define el perfil.
function gpx(km, eleAt, step = 0.1) {
  const pts = [];
  for (let d = 0; d <= km + 1e-9; d += step) {
    pts.push(`<trkpt lat="${(42 + d * 0.0089932).toFixed(7)}" lon="-8.5"><ele>${eleAt(d).toFixed(1)}</ele></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

describe('parseCourseFile', () => {
  it('lee GPX con altitud', () => {
    const p = parseCourseFile(gpx(1, () => 100));
    expect(p.length).toBe(11);
    expect(p[0]).toEqual([42, -8.5, 100]);
  });
  it('lee TCX', () => {
    const tcx = '<Trackpoint><Position><LatitudeDegrees>42</LatitudeDegrees><LongitudeDegrees>-8</LongitudeDegrees></Position><AltitudeMeters>5</AltitudeMeters></Trackpoint>'.repeat(2);
    expect(parseCourseFile(tcx)).toEqual([[42, -8, 5], [42, -8, 5]]);
  });
});

describe('buildCourse', () => {
  it('distancia y desnivel del recorrido', () => {
    const c = buildCourse(parseCourseFile(gpx(5, (d) => (d < 2.5 ? d * 20 : (5 - d) * 20))));
    expect(c.distance_m).toBeGreaterThan(4950);
    expect(c.distance_m).toBeLessThan(5050);
    expect(c.gain_m).toBeGreaterThan(40);
    expect(c.gain_m).toBeLessThan(55);
    expect(compactCourse(c).points.length).toBeLessThan(c.points.length);
  });
  it('null con menos de 2 puntos', () => {
    expect(buildCourse([[42, -8, 0]])).toBeNull();
  });
  it('haversine ~1 km', () => {
    expect(haversine([42, -8.5], [42.0089932, -8.5])).toBeCloseTo(1000, -1);
  });
});

describe('pacePlan', () => {
  it('en llano reparte el objetivo en ritmo constante', () => {
    const c = buildCourse(parseCourseFile(gpx(10, () => 50)));
    const p = pacePlan(c, 10000, 3000);
    expect(p.kms).toHaveLength(10);
    expect(new Set(p.kms.map((k) => k.pace_s))).toEqual(new Set([300]));
    expect(p.kms[9].cum_s).toBe(3000);
  });

  it('sube más lento y baja más rápido, cuadrando el total', () => {
    // 5 km subiendo al 4 % y 5 km bajando.
    const c = buildCourse(parseCourseFile(gpx(10, (d) => (d < 5 ? d * 40 : (10 - d) * 40))));
    const p = pacePlan(c, 10000, 3000);
    expect(p.kms[1].pace_s).toBeGreaterThan(300);
    expect(p.kms[7].pace_s).toBeLessThan(300);
    expect(Math.abs(p.kms[9].cum_s - 3000)).toBeLessThanOrEqual(2);
    expect(p.kms[1].grade_pct).toBeGreaterThan(3);
  });

  it('escala el GPX a la distancia oficial', () => {
    const c = buildCourse(parseCourseFile(gpx(10.3, () => 0)));
    const p = pacePlan(c, 10000, 3000);
    expect(p.kms).toHaveLength(10);
    expect(p.kms[9].cum_s).toBe(3000);
  });
});

describe('raceHeat', () => {
  it('penaliza el calor y ajusta el objetivo', () => {
    const h = raceHeat({ temp_c: 28, humidity_pct: 70, source: 'forecast' }, 3600);
    expect(h.wbgt_c).toBeGreaterThan(23);
    expect(h.penalty_pct).toBeGreaterThan(3);
    expect(h.adjusted_goal_s).toBeGreaterThan(3600);
  });
  it('sin penalización con fresco', () => {
    expect(raceHeat({ temp_c: 8, humidity_pct: 60 }, 3600).penalty_pct).toBe(0);
  });
});

describe('typicalFade y timeWithFade', () => {
  const longRun = (date, speeds) => ({
    type: 'Run', start_date_local: `${date}T08:00:00Z`, distance: speeds.length * 1000,
    splits_metric: speeds.map((v) => ({ distance: 1000, average_speed: v })),
  });
  it('mediana de lo que se pierde en el último tercio', () => {
    const acts = [
      longRun('2026-09-01', [3.3, 3.3, 3.3, 3.3, 3.2, 3.2, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0]),
      longRun('2026-09-15', Array(16).fill(3.2)),
      longRun('2026-09-22', [3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.1, 3.1, 3.1, 3.1, 3.1, 3.1, 3.1, 3.1, 3.1, 3.1]),
    ];
    const f = typicalFade(acts, 21097, { now: Date.parse('2026-10-07') });
    expect(f.runs).toBe(3);
    expect(f.fade_pct).toBeGreaterThan(5);
  });
  it('el fade alarga solo el último tercio', () => {
    const plan = { kms: [1, 2, 3].map((km) => ({ km, split_s: 300, cum_s: km * 300 })) };
    expect(timeWithFade(plan, 10)).toBe(930);
  });
});

describe('fuelPlan', () => {
  it('sin geles en un 10k', () => {
    const f = fuelPlan(45 * 60, 15, null);
    expect(f.gels).toHaveLength(0);
    expect(f.carbs_g_h.lo).toBe(0);
  });
  it('maratón: 60-90 g/h y geles situados en su km', () => {
    const plan = { kms: Array.from({ length: 42 }, (_, i) => ({ km: i + 1, cum_s: (i + 1) * 300 })) };
    const f = fuelPlan(3.5 * 3600, 22, plan);
    expect(f.carbs_g_h).toMatchObject({ lo: 60, hi: 90 });
    expect(f.fluid_ml_h.lo).toBe(600);
    expect(f.gels[0]).toEqual({ at_min: 35, km: 7 });
    expect(f.gels.length).toBeGreaterThan(5);
  });
});
