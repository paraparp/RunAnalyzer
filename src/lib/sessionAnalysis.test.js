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
  it('filtra por distancia ±10 % y desnivel parecido, sin la propia sesión ni competiciones', () => {
    const ref = run(1);
    const all = [
      ref,
      run(2),                                                // igual → entra
      run(3, { distance: 10800, total_elevation_gain: 22 }), // +8 % dist, D+ similar → entra
      run(4, { distance: 12000 }),                           // +20 % dist → fuera
      run(5, { total_elevation_gain: 150 }),                 // 15 m/km vs 2 m/km → fuera por desnivel
      run(6, { workout_type: 1 }),                           // competición → fuera
      { ...run(7), type: 'Ride' },                           // otro deporte → fuera
    ];
    const res = findSimilarSessions(ref, all);
    expect(res.sessions.map((s) => s.id).sort()).toEqual([2, 3]);
    expect(res.n).toBe(2);
  });

  it('permite comparar sesiones a distinta FC para evaluar el m/lat libremente', () => {
    const ref = run(1, { hr: 150 });
    const all = [ref, run(2, { hr: 165 })];
    const res = findSimilarSessions(ref, all);
    expect(res.n).toBe(1);
    expect(res.sessions[0].id).toBe(2);
    expect(res.criteria.hr_tol_bpm).toBeNull();
  });

  it('si se especifica hrTolBpm filtra también por FC', () => {
    const ref = run(1, { hr: 150 });
    const all = [ref, run(2, { hr: 153 }), run(3, { hr: 165 })];
    const res = findSimilarSessions(ref, all, { hrTolBpm: 5 });
    expect(res.n).toBe(1);
    expect(res.sessions[0].id).toBe(2);
    expect(res.criteria.hr_tol_bpm).toBe(5);
  });

  it('filtra por ritmo similar cuando paceTolPct está activo y permite abrirlo', () => {
    const ref = run(1, { paceMin: 5 });
    const all = [
      ref,
      run(2, { paceMin: 5.1 }), // +2% → entra
      run(3, { paceMin: 4.6 }), // -8% → entra
      run(4, { paceMin: 6.0 }), // +20% → fuera con ±10%
    ];
    const strict = findSimilarSessions(ref, all, { paceTolPct: 10 });
    expect(strict.sessions.map((s) => s.id).sort()).toEqual([2, 3]);

    const broad = findSimilarSessions(ref, all, { paceTolPct: null });
    expect(broad.sessions.map((s) => s.id).sort()).toEqual([2, 3, 4]);
  });

  it('permite cambiar el modo de desnivel entre similar, flat y any', () => {
    const ref = run(1, { distance: 10000, total_elevation_gain: 20 });
    const all = [
      ref,
      run(2, { total_elevation_gain: 25 }),
      run(3, { total_elevation_gain: 90 }),
      run(4, { total_elevation_gain: 250 }),
    ];
    const sim = findSimilarSessions(ref, all, { elevMode: 'similar' });
    expect(sim.sessions.map((s) => s.id)).toEqual([2]);

    const flat = findSimilarSessions(ref, all, { elevMode: 'flat' });
    expect(flat.sessions.map((s) => s.id).sort()).toEqual([2, 3]);

    const any = findSimilarSessions(ref, all, { elevMode: 'any' });
    expect(any.sessions.map((s) => s.id).sort()).toEqual([2, 3, 4]);
  });

  it('sitúa la eficiencia de la sesión frente a la mediana del grupo', () => {
    // Misma FC; la referencia va más rápida → más metros por latido.
    const ref = run(1, { paceMin: 4.5 });
    const all = [ref, run(2), run(3), run(4)];
    const res = findSimilarSessions(ref, all);
    expect(res.rank).toBe(1);
    expect(res.ef_delta_pct).toBeCloseTo((5 / 4.5 - 1) * 100, 5);
  });

  it('sin FC en la referencia compara igualmente', () => {
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
