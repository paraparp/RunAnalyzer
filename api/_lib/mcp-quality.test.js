// Regresiones de las trampas de LECTURA del MCP: parametros de calibracion, mezcla
// de sesiones no equivalentes, ajustes espurios y origen de FC. Todas son cosas que
// el modelo se creia porque el servidor se las servia sin avisar.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  return new Map();
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
  getActivities, shapeSummary, compareSimilarSessions, getTrainingLoadModel, getCriticalSpeed,
} = await import('./mcp-store.js');

// mcp-store cachea las lecturas 15 s por (userId, key), asi que vaciar el almacen
// entre tests NO basta: el siguiente veria los datos del anterior. Cada test corre
// con su propio userId, que es lo unico que garantiza aislamiento sin tocar el cache.
let U = 'user-0';
let userSeq = 0;
const put = (key, val) => store.set(`${U}:${key}`, val);
beforeEach(() => { store.clear(); U = `user-${++userSeq}`; });

// Actividad de carrera minima. `speed` en m/s marca el ritmo.
let seq = 0;
const act = (o = {}) => {
  const id = o.id ?? ++seq;
  const distance = o.distance ?? 10000;
  const speed = o.speed ?? 1000 / (5.5 * 60); // 5:30/km
  return {
    id,
    name: o.name ?? `run ${id}`,
    type: 'Run',
    sport_type: 'Run',
    start_date: o.date ?? '2025-06-01T07:00:00Z',
    start_date_local: (o.date ?? '2025-06-01T07:00:00Z').replace('Z', ''),
    distance,
    moving_time: Math.round(distance / speed),
    elapsed_time: Math.round(distance / speed),
    average_speed: speed,
    average_heartrate: o.hr ?? 145,
    max_heartrate: o.maxHr ?? null,
    total_elevation_gain: o.elev ?? 20,
    ...o,
  };
};

describe('hr_source: la fecha de corte vale para TODOS los deportes', () => {
  // El agujero: la politica de `hr_strap_since` solo se aplicaba a las actividades
  // correlacionadas con un registro de Garmin. Una salida en bici caia a
  // unknown/missing aunque el atleta llevara banda ese dia.
  const bike = (date) => ({
    ...act({ id: 900, date, type: 'Ride', sport_type: 'Ride', hr: 130 }),
  });

  it('una salida en bici sin pareja en Garmin resuelve por la fecha declarada', () => {
    put('stravaData', [bike('2025-06-01T07:00:00Z')]);
    put('hr_strap_since', '2025-01-01');
    return getActivities(U).then((all) => {
      expect(shapeSummary(all[0])).toMatchObject({ hr_source: 'strap', hr_source_origin: 'cutoff' });
    });
  });

  it('antes del corte usa `before` y lo dice', async () => {
    put('stravaData', [bike('2024-06-01T07:00:00Z')]);
    put('hr_strap_since', { since: '2025-01-01', before: 'wrist' });
    const all = await getActivities(U);
    expect(shapeSummary(all[0])).toMatchObject({ hr_source: 'wrist', hr_source_origin: 'cutoff' });
  });

  it('sin FC no se atribuye sensor aunque la fecha entre en el corte', async () => {
    put('stravaData', [{ ...bike('2025-06-01T07:00:00Z'), average_heartrate: null }]);
    put('hr_strap_since', '2025-01-01');
    const all = await getActivities(U);
    expect(shapeSummary(all[0])).toMatchObject({ hr_source: 'unknown', hr_source_origin: 'missing' });
  });

  it('sin politica declarada sigue siendo unknown/missing', async () => {
    put('stravaData', [bike('2025-06-01T07:00:00Z')]);
    const all = await getActivities(U);
    expect(shapeSummary(all[0])).toMatchObject({ hr_source: 'unknown', hr_source_origin: 'missing' });
  });
});

describe('compare_similar_sessions: no mezclar peras y manzanas', () => {
  const rodajes = (n, from = 1) => Array.from({ length: n }, (_, i) => act({
    id: from + i,
    date: `2025-0${1 + (i % 6)}-1${i % 9}T07:00:00Z`,
    speed: 1000 / (5.5 * 60),
    hr: 145,
  }));

  it('excluye competiciones del grupo y las declara', async () => {
    put('stravaData', [
      ...rodajes(4),
      act({ id: 99, name: 'Ferrol 10K', date: '2023-05-01T09:00:00Z', workout_type: 1, speed: 1000 / (4.73 * 60), hr: 150 }),
    ]);
    const res = await compareSimilarSessions(U, { distance_km: 10 });
    expect(res.count).toBe(4);
    expect(res.sessions.map((s) => s.id)).not.toContain(99);
    expect(res.homogeneity.excluded_races).toBe(1);
    expect(res.homogeneity.races[0].name).toBe('Ferrol 10K');
  });

  it('include_races vuelve a meterlas', async () => {
    put('stravaData', [
      ...rodajes(4),
      act({ id: 99, name: 'Ferrol 10K', date: '2023-05-01T09:00:00Z', workout_type: 1, speed: 1000 / (4.73 * 60), hr: 150 }),
    ]);
    const res = await compareSimilarSessions(U, { distance_km: 10, include_races: true });
    expect(res.count).toBe(5);
    expect(res.homogeneity.excluded_races).toBe(0);
  });

  it('marca trend.comparable=false cuando cambia el sensor entre las dos mitades', async () => {
    // Antiguas de muñeca, recientes de banda: el salto de eficiencia es del sensor.
    put('stravaData', [
      act({ id: 1, date: '2024-01-01T07:00:00Z', hr: 155 }),
      act({ id: 2, date: '2024-02-01T07:00:00Z', hr: 155 }),
      act({ id: 3, date: '2025-06-01T07:00:00Z', hr: 140 }),
      act({ id: 4, date: '2025-07-01T07:00:00Z', hr: 140 }),
    ]);
    put('hr_strap_since', { since: '2025-01-01', before: 'wrist' });
    const res = await compareSimilarSessions(U, { distance_km: 10, avg_hr_min: 130, avg_hr_max: 160 });
    expect(res.trend.comparable).toBe(false);
    expect(res.trend.older_hr_source).toBe('wrist');
    expect(res.trend.recent_hr_source).toBe('strap');
    expect(res.trend.caveat).toMatch(/sensor/);
    expect(res.homogeneity.mixed_hr_sources).toBe(true);
  });

  it('con un solo sensor la tendencia es comparable y no lleva aviso', async () => {
    put('stravaData', [
      act({ id: 1, date: '2025-02-01T07:00:00Z', hr: 148 }),
      act({ id: 2, date: '2025-03-01T07:00:00Z', hr: 148 }),
      act({ id: 3, date: '2025-06-01T07:00:00Z', hr: 143 }),
      act({ id: 4, date: '2025-07-01T07:00:00Z', hr: 143 }),
    ]);
    put('hr_strap_since', '2025-01-01');
    const res = await compareSimilarSessions(U, { distance_km: 10, avg_hr_min: 130, avg_hr_max: 160 });
    expect(res.trend.comparable).toBe(true);
    expect(res.trend.caveat).toBeNull();
    expect(res.homogeneity.mixed_hr_sources).toBe(false);
  });

  it('hr_source acota el grupo a un solo origen', async () => {
    put('stravaData', [
      act({ id: 1, date: '2024-01-01T07:00:00Z' }),
      act({ id: 2, date: '2025-06-01T07:00:00Z' }),
      act({ id: 3, date: '2025-07-01T07:00:00Z' }),
    ]);
    put('hr_strap_since', { since: '2025-01-01', before: 'wrist' });
    const res = await compareSimilarSessions(U, { distance_km: 10, hr_source: 'strap' });
    expect(res.sessions.map((s) => s.id).sort()).toEqual([2, 3]);
    expect(res.criteria.hr_source).toBe('strap');
  });
});

describe('get_training_load_model: calibracion real y versionado', () => {
  // Historial con FCmax ~190 para que la deteccion tenga de donde tirar.
  const historial = () => Array.from({ length: 40 }, (_, i) => act({
    id: i + 1,
    date: `2025-0${1 + (i % 8)}-${String((i % 27) + 1).padStart(2, '0')}T07:00:00Z`,
    hr: 150,
    maxHr: 190,
  }));

  it('usa la FC de reposo de Garmin, no el default de 60', async () => {
    put('stravaData', historial());
    put('garmin_cardiac_data', [
      { date: '2025-08-01', restingHR: 53 },
      { date: '2025-08-02', restingHR: 52 },
    ]);
    const res = await getTrainingLoadModel(U, { summary_only: true });
    expect(res.model.hrrest).toBe(52);
    expect(res.model.hrrest_source).toBe('garmin');
  });

  it('sin datos de Garmin lo declara como estimado en vez de fingir medicion', async () => {
    put('stravaData', historial());
    const res = await getTrainingLoadModel(U, { summary_only: true });
    expect(res.model.hrrest_source).toBe('default');
    expect(res.model.note).toMatch(/estimado, no medido/);
  });

  it('expone el metodo del LTHR para no confundir formula con medicion', async () => {
    put('stravaData', historial());
    const res = await getTrainingLoadModel(U, { summary_only: true });
    expect(res.model).toHaveProperty('lthr_method');
    expect(res.model).toHaveProperty('lthr_confidence');
  });

  it('model.version distingue dos calibraciones, y el CTL se mueve con ellas', async () => {
    // Mismo historial de entrenos, distinta FC de reposo. Se usan dos userId porque
    // dentro del mismo el cache de lectura serviria el valor viejo 15 s (que es lo
    // correcto en produccion: la calibracion no puede bailar dentro de una consulta).
    const otro = `${U}-bis`;
    store.set(`${otro}:stravaData`, historial());
    put('stravaData', historial());
    put('garmin_cardiac_data', [{ date: '2025-08-01', restingHR: 52 }]);

    const conGarmin = await getTrainingLoadModel(U, {});
    const sinGarmin = await getTrainingLoadModel(otro, {});

    expect(conGarmin.model.hrrest).toBe(52);
    expect(sinGarmin.model.hrrest).toBe(60); // DEFAULT_REST_HR
    expect(conGarmin.model.version).not.toBe(sinGarmin.model.version);
    // Y el CTL se mueve de verdad: es justo el salto que no se podia detectar antes.
    // Se mira el pico de la serie, no `current`: el historial sintetico termina hace
    // meses y para hoy el CTL ya ha decaido a 0 en las dos calibraciones.
    const peak = (r) => Math.max(...r.series.map((s) => s.ctl));
    expect(peak(conGarmin)).toBeGreaterThan(peak(sinGarmin));
  });

  it('model.version se repite si nada cambia', async () => {
    put('stravaData', historial());
    put('garmin_cardiac_data', [{ date: '2025-08-01', restingHR: 52 }]);
    const a = await getTrainingLoadModel(U, { summary_only: true });
    const b = await getTrainingLoadModel(U, { summary_only: true });
    expect(a.model.version).toBe(b.model.version);
    expect(a.current.ctl).toBe(b.current.ctl);
  });
});

describe('critical_speed: r2 alto no es ajuste bueno', () => {
  // Best efforts que salen todos de la MISMA actividad: los tramos se solapan
  // (el de 3 min contiene al de 2 min), asi que la recta pasa casi por todos.
  const conEfforts = (id, date, efforts) => act({
    id,
    date,
    distance: 12000,
    speed: 1000 / (4.2 * 60),
    best_efforts: efforts.map(([name, distance, elapsed_time]) => ({ name, distance, elapsed_time, moving_time: elapsed_time })),
  });

  // Solo las distancias canonicas entran en la curva: un best effort de "2k" se
  // descarta y el ajuste se queda sin puntos (asi se colaba un test en vacio).
  it('avisa cuando los esfuerzos vienen de una sola actividad', async () => {
    put('stravaData', [conEfforts(1, '2025-06-01T07:00:00Z', [
      ['1k', 1000, 190], ['1 mile', 1609, 315], ['5k', 5000, 1050],
    ])]);
    const res = await getCriticalSpeed(U, {});
    expect(res.error).toBeUndefined();
    expect(res.fit.n_activities).toBe(1);
    expect(res.fit.concentrated).toBe(true);
    expect(res.fit.r2_caveat).toMatch(/r²/);
    expect(res.fit.span_days).toBe(0);
    // El r² es 1 clavado: la patologia exacta que hacia parecer excelente el ajuste.
    expect(res.fit.r2).toBe(1);
  });

  it('no avisa cuando vienen de 3+ actividades distintas', async () => {
    put('stravaData', [
      conEfforts(1, '2025-04-01T07:00:00Z', [['1k', 1000, 190]]),
      conEfforts(2, '2025-05-01T07:00:00Z', [['1 mile', 1609, 315]]),
      conEfforts(3, '2025-06-01T07:00:00Z', [['5k', 5000, 1050]]),
    ]);
    const res = await getCriticalSpeed(U, {});
    expect(res.error).toBeUndefined();
    expect(res.fit.n_activities).toBe(3);
    expect(res.fit.concentrated).toBe(false);
    expect(res.fit.r2_caveat).toBeNull();
    expect(res.fit.span_days).toBeGreaterThan(30);
  });
});
