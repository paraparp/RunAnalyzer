// Tests de la CAPA PROPIA de mcp-store: lo que no cubren los tests de `src/lib/`
// (la física ya está cubierta allí) y que un LLM lee sin poder verificarlo — el
// reshape, los filtros de `list_activities`, el contrato de
// `hr_source`/`hr_source_origin` y el recálculo de calor en lectura.
import { describe, it, expect, vi } from 'vitest';

// El módulo lee las credenciales al importarse y crea el cliente de forma perezosa:
// se ponen ANTES del import (hoisted) y se sustituye `createClient` por un almacén
// en memoria, para poder ejercitar getActivities sin red.
const store = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  return new Map(); // `${userId}:${key}` -> valor ya parseado
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const f = {};
      const builder = {
        select: () => builder,
        eq: (col, val) => { f[col] = val; return builder; },
        maybeSingle: async () => ({
          data: store.has(`${f.user_id}:${f.key}`)
            ? { value: JSON.stringify(store.get(`${f.user_id}:${f.key}`)) }
            : null,
          error: null,
        }),
      };
      return builder;
    },
  }),
}));

const {
  calcPace, isRunning, shapeSummary, shapeFull, filterActivities,
  summarizeActivities, computeDecoupling, getActivities,
} = await import('./mcp-store.js');

const run = (o = {}) => ({
  id: 1,
  name: 'Rodaje',
  type: 'Run',
  sport_type: 'Run',
  start_date: '2026-06-10T06:00:00Z',
  distance: 10000,
  moving_time: 3000,
  elapsed_time: 3120,
  average_speed: 10000 / 3000,
  average_heartrate: 145,
  max_heartrate: 165,
  total_elevation_gain: 40,
  ...o,
});

describe('calcPace', () => {
  it('trunca a segundo entero y rellena con cero', () => {
    expect(calcPace(10000 / 3000)).toBe('5:00');
    expect(calcPace(1000 / 261)).toBe('4:21');
  });

  it('devuelve null sin velocidad (nunca "0:00", que se leeria como ritmo real)', () => {
    expect(calcPace(0)).toBeNull();
    expect(calcPace(null)).toBeNull();
    expect(calcPace(undefined)).toBeNull();
  });
});

describe('isRunning', () => {
  it('acepta type o sport_type, y descarta lo que no es carrera', () => {
    expect(isRunning({ type: 'TrailRun' })).toBe(true);
    expect(isRunning({ type: 'Workout', sport_type: 'VirtualRun' })).toBe(true);
    expect(isRunning({ type: 'Ride', sport_type: 'Ride' })).toBe(false);
  });
});

// ── El contrato que documenta el server MCP: hr_source NUNCA es null, y
//    hr_source_origin dice siempre de dónde sale el valor. ────────────────────
describe('shapeSummary: contrato de hr_source', () => {
  it('sin Garmin correlacionado es unknown/missing, no null ("no lo se" != "sin banda")', () => {
    const s = shapeSummary(run());
    expect(s.hr_source).toBe('unknown');
    expect(s.hr_source_origin).toBe('missing');
    expect(s.has_garmin).toBe(false);
  });

  it('con Garmin correlacionado propaga el valor y su origen', () => {
    const s = shapeSummary(run({ _garmin: { hr_source: 'strap', hr_source_origin: 'sensors' } }));
    expect(s).toMatchObject({ hr_source: 'strap', hr_source_origin: 'sensors', has_garmin: true });
  });

  it('un _garmin sin origen declarado no inventa: missing', () => {
    expect(shapeSummary(run({ _garmin: { garmin_id: 7 } })).hr_source_origin).toBe('missing');
  });
});

describe('shapeSummary: distancias y tiempos', () => {
  it('publica el metro entero ademas del km redondeado (los ritmos se recalculan con el entero)', () => {
    const s = shapeSummary(run({ distance: 10437.6 }));
    expect(s.distance_m).toBe(10438);
    expect(s.distance_km).toBe(10.44);
  });

  it('separa tiempo en movimiento de tiempo total y expone la parada', () => {
    const s = shapeSummary(run({ moving_time: 3000, elapsed_time: 3300 }));
    expect(s.moving_time_min).toBe(50);
    expect(s.elapsed_time_min).toBe(55);
    expect(s.stopped_time_s).toBe(300);
  });

  it('en no-carrera da velocidad en km/h en vez de ritmo', () => {
    const s = shapeSummary(run({ type: 'Ride', sport_type: 'Ride', average_speed: 8 }));
    expect(s.pace_per_km).toBeUndefined();
    expect(s.speed_kmh).toBe(28.8);
  });
});

describe('filterActivities', () => {
  const list = [
    run({ id: 1, start_date: '2026-06-01T05:00:00Z', average_heartrate: 130, distance: 5000, total_elevation_gain: 20 }),
    run({ id: 2, start_date: '2026-06-15T21:30:00Z', average_heartrate: 155, distance: 21000, total_elevation_gain: 400 }),
    run({ id: 3, start_date: '2026-06-30T05:00:00Z', average_heartrate: 170, distance: 12000, total_elevation_gain: 30, _garmin: { hr_source: 'strap' } }),
    run({ id: 4, start_date: '2026-06-20T05:00:00Z', type: 'Ride', sport_type: 'Ride' }),
  ];
  const ids = (args) => filterActivities(list, args).map((a) => a.id);

  it('sin argumentos no filtra nada', () => {
    expect(ids()).toEqual([1, 2, 3, 4]);
    expect(ids({})).toEqual([1, 2, 3, 4]);
  });

  it('from/to son fechas de CALENDARIO e incluyen ambos extremos', () => {
    expect(ids({ from: '2026-06-01', to: '2026-06-01' })).toEqual([1]);
    expect(ids({ from: '2026-06-15', to: '2026-06-30' })).toEqual([2, 3, 4]);
  });

  it('compara por el dia UTC de la actividad, sin depender del huso del servidor', () => {
    // 21:30Z del dia 15 sigue siendo dia 15 en la clave (en Nueva York serian las
    // 17:30 del 15; en Tokio, las 06:30 del 16 — el limite no debe moverse con el TZ).
    expect(ids({ from: '2026-06-16' })).toEqual([3, 4]);
  });

  it('only_running descarta la bici; sport filtra por type o sport_type', () => {
    expect(ids({ only_running: true })).toEqual([1, 2, 3]);
    expect(ids({ sport: 'Ride' })).toEqual([4]);
  });

  it('avg_hr_min/avg_hr_max filtran por FC MEDIA y aceptan los nombres antiguos', () => {
    expect(ids({ avg_hr_min: 150 })).toEqual([2, 3]);
    expect(ids({ avg_hr_max: 150 })).toEqual([1, 4]); // la 4 es bici, pero 145 ppm cumple
    expect(ids({ hr_min: 150, hr_max: 160 })).toEqual([2]); // retrocompatibilidad
  });

  it('avg_hr_min tiene prioridad sobre el alias antiguo si vienen los dos', () => {
    expect(ids({ avg_hr_min: 165, hr_min: 100 })).toEqual([3]);
  });

  it('las actividades sin FC media caen fuera de CUALQUIER filtro de FC', () => {
    // El de arriba es el que se colaba: `null <= 200` es true por coercion, asi que
    // "sesiones con FC media por debajo de 200" incluia las que no tienen FC.
    const sinFc = [run({ id: 9, average_heartrate: null }), run({ id: 10, average_heartrate: 0 })];
    expect(filterActivities(sinFc, { avg_hr_max: 200 })).toHaveLength(0);
    expect(filterActivities(sinFc, { avg_hr_min: 100 })).toHaveLength(0);
    expect(filterActivities(sinFc, { hr_max: 200 })).toHaveLength(0);
    expect(filterActivities(sinFc, {})).toHaveLength(2); // sin filtro de FC siguen estando
  });

  it('min/max_distance_km acotan en kilometros', () => {
    expect(ids({ min_distance_km: 10, max_distance_km: 15 })).toEqual([3, 4]);
  });

  it('flat_only exige menos de 10 m/km de desnivel', () => {
    expect(ids({ flat_only: true })).toEqual([1, 3, 4]); // la 2 son 19 m/km
  });

  it('hr_source trata la ausencia de dato como "unknown", no como exclusion', () => {
    expect(ids({ hr_source: 'strap' })).toEqual([3]);
    expect(ids({ hr_source: 'unknown' })).toEqual([1, 2, 4]);
  });
});

describe('summarizeActivities', () => {
  it('agrega totales, cuenta por tipo y da el rango de fechas ordenado', () => {
    const s = summarizeActivities([
      run({ start_date: '2026-06-15T06:00:00Z', distance: 21097, moving_time: 5400, total_elevation_gain: 120 }),
      run({ start_date: '2026-06-01T06:00:00Z', distance: 10000, moving_time: 3000, total_elevation_gain: 40.4 }),
      run({ start_date: '2026-06-08T06:00:00Z', type: 'Ride', distance: 30000, moving_time: 3600, total_elevation_gain: 200 }),
    ]);
    expect(s.count).toBe(3);
    expect(s.total_distance_km).toBe(61.1);
    expect(s.total_moving_time_h).toBe(3.3);
    expect(s.total_elevation_gain_m).toBe(360);
    expect(s.by_type).toEqual({ Run: 2, Ride: 1 });
    // El rango NO es el orden de entrada: la lista llega desordenada a proposito.
    expect(s.date_range).toEqual({ first: '2026-06-01T06:00:00Z', last: '2026-06-15T06:00:00Z' });
  });

  it('lista vacia: ceros y date_range null (no un rango inventado)', () => {
    expect(summarizeActivities([])).toMatchObject({ count: 0, total_distance_km: 0, date_range: null });
  });

  it('tolera campos ausentes sin propagar NaN', () => {
    const s = summarizeActivities([{ type: 'Run', start_date: '2026-06-01T06:00:00Z' }]);
    expect(s.total_distance_km).toBe(0);
    expect(s.total_elevation_gain_m).toBe(0);
  });
});

// ── shapeWeather no se exporta: se ejercita por su unica puerta publica. ─────
describe('shapeFull: calor recalculado en lectura', () => {
  const withWeather = (weather, extra = {}) => run({ ...extra, _garmin: { garmin_id: 42, weather } });
  const weatherOf = (a, opts) => shapeFull(a, ['garmin'], opts).garmin.weather;

  it('renormaliza unidades del cache viejo y recalcula el WBGT en vez de servir el guardado', () => {
    const w = weatherOf(withWeather({
      temp_c: 75,        // guardado en °F sin convertir por la heuristica vieja
      dew_point_c: 57,
      humidity_pct: 55,
      wbgt_c: 40,        // valor rancio del modelo lineal antiguo
    }), { hrMax: 185 });
    expect(w.temp_c).toBeGreaterThan(23);
    expect(w.temp_c).toBeLessThan(25);
    expect(w.dew_point_c).toBeLessThan(w.temp_c);
    expect(w.wbgt_c).not.toBe(40);
    expect(w.wbgt_c).toBeGreaterThan(18);
    expect(w.wbgt_c).toBeLessThan(26);
  });

  it('la penalizacion de ESTA sesion es menor que la de tabla en un rodaje suave', () => {
    const w = weatherOf(
      withWeather({ temp_c: 28, dew_point_c: 20, humidity_pct: 65 }, { average_heartrate: 140 }),
      { hrMax: 185 },
    );
    expect(w.pct_hr_max).toBe(75.7);
    expect(w.intensity_factor).toBeCloseTo(0.38, 2);
    expect(w.heat_penalty_pct).toBeGreaterThan(0);
    expect(w.heat_penalty_session_pct).toBeGreaterThan(0);
    expect(w.heat_penalty_session_pct).toBeLessThan(w.heat_penalty_pct);
    expect(w.heat_note).toContain('ESTA sesión');
  });

  it('sin FCmax no se puede escalar: solo la de tabla, y el aviso lo dice', () => {
    const w = weatherOf(withWeather({ temp_c: 28, dew_point_c: 20, humidity_pct: 65 }));
    expect(w.intensity_factor).toBeNull();
    expect(w.pct_hr_max).toBeNull();
    expect(w.heat_penalty_session_pct).toBeNull();
    expect(w.heat_penalty_pct).toBeGreaterThan(0);
    expect(w.heat_note).toContain('Sin FC media o sin FCmax');
  });

  it('sin parte meteorologica devuelve null, no un objeto de ceros', () => {
    expect(weatherOf(withWeather(null), { hrMax: 185 })).toBeNull();
  });
});

describe('shapeFull: secciones e incoherencia cabecera/laps', () => {
  const laps = [
    { lap_index: 1, distance: 5000, moving_time: 1500, average_speed: 10 / 3, average_heartrate: 140, average_cadence: 88 },
    { lap_index: 2, distance: 5000, moving_time: 1500, average_speed: 10 / 3, average_heartrate: 150, average_cadence: 90 },
  ];

  it('include limita las secciones pesadas pero mantiene el resumen base', () => {
    const out = shapeFull(run({ laps, splits_metric: [{ split: 1, distance: 1000 }] }), ['laps']);
    expect(out.id).toBe(1);
    expect(out.laps).toHaveLength(2);
    expect(out.splits_metric).toBeUndefined();
    expect(out.garmin).toBeUndefined();
  });

  it('acepta los alias splits_metric/polyline como nombres de seccion', () => {
    const a = run({ splits_metric: [{ split: 1, distance: 1000, average_speed: 10 / 3 }], map: { summary_polyline: 'abc' } });
    expect(shapeFull(a, ['splits_metric']).splits_metric).toHaveLength(1);
    expect(shapeFull(a, ['polyline']).map_polyline).toBe('abc');
  });

  it('dobla la cadencia de Strava en carrera (por pierna -> spm) y no en bici', () => {
    expect(shapeFull(run({ laps }), ['laps']).laps[0].cadence_spm).toBe(176);
    const bike = shapeFull(run({ type: 'Ride', sport_type: 'Ride', laps }), ['laps']).laps[0];
    expect(bike.cadence_rpm).toBe(88);
    expect(bike.cadence_spm).toBeUndefined();
  });

  it('las claves internas de flat_efforts no salen al consumidor', () => {
    const out = shapeFull(run({ flat_efforts: { '1k': { time: 200 }, _v: 3, _grade_source: 'altitude' } }), ['flat_efforts']);
    expect(Object.keys(out.flat_efforts)).toEqual(['1k']);
  });

  it('data_consistency va siempre que haya laps, aunque no se pidan', () => {
    const out = shapeFull(run({ laps }), ['garmin']);
    expect(out.laps).toBeUndefined();
    expect(out.data_consistency.consistent).toBe(true);
    expect(out.data_consistency.warning).toBeNull();
  });

  it('avisa cuando la suma de los laps se desvia mas del 1 % de la cabecera', () => {
    const c = shapeFull(run({
      distance: 11310,
      moving_time: 3582,
      laps: [{ lap_index: 1, distance: 11280, moving_time: 3628, average_speed: 11280 / 3628 }],
    }), ['laps']).data_consistency;
    expect(c.consistent).toBe(false);
    expect(c.warning).toContain('NO son comparables');
    expect(c.delta.moving_time_s).toBe(46);
    expect(c.header.pace_per_km).not.toBe(c.laps_sum.pace_per_km);
  });
});

describe('computeDecoupling: por que no hay numero', () => {
  it('sin splits lo dice, en vez de un null mudo', () => {
    expect(computeDecoupling(run({ splits_metric: [] }))).toEqual({
      decoupling_pct: null,
      reason: 'Sin splits por km',
    });
  });

  it('por debajo de 45 min la deriva es ruido y no se publica', () => {
    const splits = Array.from({ length: 10 }, (_, i) => ({
      split: i + 1, distance: 1000, average_speed: 10 / 3, average_heartrate: 140 + i,
    }));
    const d = computeDecoupling(run({ moving_time: 2400, splits_metric: splits }));
    expect(d.decoupling_pct).toBeNull();
    expect(d.reason).toContain('45 min');
  });
});

// ── Politica hr_strap_since: la parte del contrato de hr_source que necesita el
//    almacen (getActivities correlaciona con Garmin y aplica la politica). ────
describe('getActivities: correlacion con Garmin y politica de hr_source', () => {
  // Cada caso usa su propio userId: readKey cachea 15 s por (userId, key).
  const seed = (userId, rows) => {
    for (const [key, value] of Object.entries(rows)) store.set(`${userId}:${key}`, value);
  };
  const strava = [
    { id: 1, type: 'Run', start_date: '2026-01-10T06:00:00Z', distance: 10000, moving_time: 3000 },
    { id: 2, type: 'Run', start_date: '2026-06-10T06:00:00Z', distance: 10000, moving_time: 3000 },
    { id: 3, type: 'Run', start_date: '2026-06-20T06:00:00Z', distance: 10000, moving_time: 3000 },
  ];

  it('ordena por fecha descendente y adjunta el Garmin que cae dentro de +-3 min', async () => {
    seed('u-attach', {
      stravaData: strava,
      garmin_activities: [{ garmin_id: 'g2', start_time: '2026-06-10T06:02:00Z' }],
    });
    const list = await getActivities('u-attach');
    expect(list.map((a) => a.id)).toEqual([3, 2, 1]);
    expect(list.find((a) => a.id === 2)._garmin.garmin_id).toBe('g2');
    expect(list.find((a) => a.id === 3)._garmin).toBeUndefined();
  });

  it('no correlaciona mas alla de la tolerancia', async () => {
    seed('u-far', {
      stravaData: strava,
      garmin_activities: [{ garmin_id: 'g2', start_time: '2026-06-10T06:05:00Z' }],
    });
    expect((await getActivities('u-far')).every((a) => !a._garmin)).toBe(true);
  });

  it('con hr_strap_since infiere strap a partir del corte y marca el origen "cutoff"', async () => {
    seed('u-cutoff', {
      stravaData: strava,
      hr_strap_since: '2026-06-01',
      garmin_activities: [
        { garmin_id: 'g1', start_time: '2026-01-10T06:00:00Z' },
        { garmin_id: 'g2', start_time: '2026-06-10T06:00:00Z' },
      ],
    });
    const byId = Object.fromEntries((await getActivities('u-cutoff')).map((a) => [a.id, a._garmin]));
    expect(byId[2]).toMatchObject({ hr_source: 'strap', hr_source_origin: 'cutoff' });
    expect(byId[1]).toMatchObject({ hr_source: 'unknown', hr_source_origin: 'cutoff' });
  });

  it('la forma { since, before } declara que asumir ANTES del corte', async () => {
    seed('u-before', {
      stravaData: strava,
      hr_strap_since: { since: '2026-06-01', before: 'wrist' },
      garmin_activities: [{ garmin_id: 'g1', start_time: '2026-01-10T06:00:00Z' }],
    });
    const g = (await getActivities('u-before')).find((a) => a.id === 1)._garmin;
    expect(g).toMatchObject({ hr_source: 'wrist', hr_source_origin: 'cutoff' });
  });

  it('el dato de los sensores manda sobre el corte declarado', async () => {
    seed('u-sensors', {
      stravaData: strava,
      hr_strap_since: '2026-06-01',
      garmin_activities: [{ garmin_id: 'g2', start_time: '2026-06-10T06:00:00Z', hr_source: 'wrist' }],
    });
    const g = (await getActivities('u-sensors')).find((a) => a.id === 2)._garmin;
    expect(g).toMatchObject({ hr_source: 'wrist', hr_source_origin: 'sensors' });
  });

  it('un hr_strap_since con formato invalido se ignora (no se infiere nada)', async () => {
    seed('u-bad', {
      stravaData: strava,
      hr_strap_since: 'junio de 2026',
      garmin_activities: [{ garmin_id: 'g2', start_time: '2026-06-10T06:00:00Z' }],
    });
    const g = (await getActivities('u-bad')).find((a) => a.id === 2)._garmin;
    expect(g).toMatchObject({ hr_source: 'unknown', hr_source_origin: 'missing' });
  });

  it('acepta el blob envuelto { activities: [...] } y devuelve [] si no hay nada', async () => {
    seed('u-wrapped', { stravaData: { activities: strava } });
    expect(await getActivities('u-wrapped')).toHaveLength(3);
    expect(await getActivities('u-vacio')).toEqual([]);
  });
});
