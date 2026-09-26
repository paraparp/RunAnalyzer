import { describe, it, expect } from 'vitest';
import {
  findSimilarSessions, sessionDecoupling, sessionEfficiency, sessionGap, sessionZones, sessionWeather,
} from './sessionAnalysis';
import { karvonenBounds } from './hrZones';

// Un parcial de 1 km: velocidad en m/s a partir del ritmo en min/km.
const km = (paceMin, hr, split) => ({
  split,
  distance: 1000,
  moving_time: paceMin * 60,
  average_speed: 1000 / (paceMin * 60),
  average_heartrate: hr,
});

const run = (id, { distance = 10000, paceMin = 5, hr = 150, date = '2026-09-01', ...rest } = {}) => ({
  id,
  type: 'Run',
  name: `run ${id}`,
  start_date: `${date}T08:00:00Z`,
  distance,
  moving_time: (distance / 1000) * paceMin * 60,
  average_heartrate: hr,
  total_elevation_gain: 20,
  ...rest,
});

describe('findSimilarSessions', () => {
  it('filtra por distancia ±10 % y FC ±5, sin la propia sesión ni competiciones', () => {
    const ref = run(1);
    const all = [
      ref,
      run(2),                                   // igual → entra
      run(3, { distance: 10800 }),              // +8 % → entra
      run(4, { distance: 12000 }),              // +20 % → fuera
      run(5, { hr: 160 }),                      // +10 ppm → fuera
      run(6, { workout_type: 1 }),              // competición → fuera
      { ...run(7), type: 'Ride' },              // otro deporte → fuera
    ];
    const res = findSimilarSessions(ref, all);
    expect(res.sessions.map((s) => s.id).sort()).toEqual([2, 3]);
    expect(res.n).toBe(2);
  });

  it('sitúa la eficiencia de la sesión frente a la mediana del grupo', () => {
    // Misma FC; la referencia va más rápida → más metros por latido.
    const ref = run(1, { paceMin: 4.5 });
    const all = [ref, run(2), run(3), run(4)];
    const res = findSimilarSessions(ref, all);
    expect(res.rank).toBe(1);
    expect(res.ef_delta_pct).toBeCloseTo((5 / 4.5 - 1) * 100, 5);
  });

  it('sin FC en la referencia compara solo por distancia', () => {
    const ref = run(1, { hr: null });
    const res = findSimilarSessions(ref, [ref, run(2, { hr: 170 })]);
    expect(res.n).toBe(1);
    expect(res.criteria.hr_tol_bpm).toBeNull();
  });

  it('devuelve null sin distancia', () => {
    expect(findSimilarSessions({ id: 1, distance: 0 }, [])).toBeNull();
  });
});

describe('sessionDecoupling', () => {
  it('califica la deriva con la escala compartida', () => {
    const splits = [1, 2, 3, 4, 5, 6].map((i) => km(5, i <= 3 ? 150 : 165, i));
    const d = sessionDecoupling({ splits_metric: splits });
    expect(d.halves.pct).toBeCloseTo(10, 5);
    expect(d.halves.level).toBe('high');
    // 6 km no llegan a la ventana de durabilidad: se explica, no se inventa.
    expect(d.durability.pct).toBeNull();
    expect(d.durability.reason).toBe('few_splits');
  });
});

describe('sessionGap', () => {
  it('declara la fuente', () => {
    const a = run(1);
    expect(sessionGap(a).source).toBe('gain');
    const withStreams = { ...a, stream_gap: { _v: 1, distance_m: 10000, gap_time_s: 2900 } };
    expect(sessionGap(withStreams)).toEqual({ speed_ms: 10000 / 2900, source: 'streams' });
  });
});

describe('sessionEfficiency', () => {
  it('da m/latido de la sesión entera', () => {
    const e = sessionEfficiency(run(1, { paceMin: 5, hr: 150 }));
    expect(e.whole).toBeCloseTo((1000 / 300) * 60 / 150, 6);
  });
});

describe('sessionZones', () => {
  const bounds = karvonenBounds({ hrmax: 190, hrrest: 50 });

  it('reparte por parciales y lo dice', () => {
    const a = { ...run(1), splits_metric: [km(5, 120, 1), km(5, 150, 2), km(5, 175, 3)] };
    const z = sessionZones(a, bounds);
    expect(z.resolution).toBe('splits');
    expect(z.pct.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 0);
  });

  it('cae a la media cuando no hay parciales', () => {
    expect(sessionZones(run(1), bounds).resolution).toBe('average');
  });

  it('null sin límites de zona', () => {
    expect(sessionZones(run(1), null)).toBeNull();
  });
});

describe('sessionWeather', () => {
  it('escala la penalización a la intensidad de la sesión', () => {
    const g = { weather: { temp_c: 25, dew_point_c: 18, humidity_pct: 65 } };
    const w = sessionWeather(g, { average_heartrate: 145 }, { hrMax: 190 });
    expect(w.wbgt_plausible).toBe(true);
    expect(w.heat_penalty_session_pct).toBeLessThan(w.heat_penalty_pct);
  });

  it('null sin meteorología', () => {
    expect(sessionWeather(null, run(1), { hrMax: 190 })).toBeNull();
  });
});
