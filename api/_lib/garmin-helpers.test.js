// Tests de garmin-helpers: la parte que NO quedaba cubierta de rebote por los casos
// de `shapeFull` en `mcp-store.test.js` (allí se ejercita la meteorología: WBGT,
// normalización de unidades y penalización por calor). Lo que se fija aquí es la
// normalización de actividades y laps, el origen de la FC, los rellenos de dinámica
// del enriquecido y el reparto del presupuesto de `fetchGarminActivities`.
import { describe, it, expect, vi } from 'vitest';

// El módulo instancia `GarminConnect` solo dentro de `createClient`; se sustituye para
// no arrastrar la librería (ni su login) al importar.
vi.mock('garmin-connect', () => ({ default: { GarminConnect: class { async login() {} } } }));

const {
  normalizeGarminActivity, normalizeGarminLap, deriveHrSource, deriveDataQuality,
  enrichGarminActivity, fetchGarminActivities, fetchDayData,
  mergeData, mergeSleepData, threeMonthChunks, toDateStr,
} = await import('./garmin-helpers.js');

// Cliente doble: `client.client.get(url)` enruta por la URL. Primero por SUFIJO
// (`/splits`, `/weather`, `/activity/7`), que es lo que distingue los tres endpoints
// del enriquecido —el de resumen es prefijo de los otros dos—, y solo después por
// subcadena para los patrones genéricos.
const clientWith = (routes, { log = [] } = {}) => ({
  log,
  client: {
    get: async (url) => {
      log.push(url);
      const entries = Object.entries(routes);
      const hit = entries.find(([p]) => url.endsWith(p)) || entries.find(([p]) => url.includes(p));
      if (!hit) throw new Error(`404 ${url}`);
      const value = hit[1];
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(url) : value;
    },
  },
});

describe('normalizeGarminActivity', () => {
  const raw = (o = {}) => ({ activityId: 1, startTimeGMT: '2026-07-15 06:00:00', ...o });

  it('descarta lo que no tiene activityId', () => {
    expect(normalizeGarminActivity(null)).toBeNull();
    expect(normalizeGarminActivity({ activityName: 'sin id' })).toBeNull();
  });

  it('convierte el startTimeGMT de Garmin en ISO con Z (sin duplicarla ni arrastrar fracciones)', () => {
    expect(normalizeGarminActivity(raw()).start_time).toBe('2026-07-15T06:00:00Z');
    expect(normalizeGarminActivity(raw({ startTimeGMT: '2026-07-15 06:00:00.0' })).start_time).toBe('2026-07-15T06:00:00Z');
    expect(normalizeGarminActivity(raw({ startTimeGMT: '2026-07-15T06:00:00Z' })).start_time).toBe('2026-07-15T06:00:00Z');
    expect(normalizeGarminActivity(raw({ startTimeGMT: null })).start_time).toBeNull();
  });

  it('solo acepta números: un string o un NaN se guardan como null, no como dato', () => {
    const a = normalizeGarminActivity(raw({ distance: '10000', duration: NaN, averageHR: 145, calories: undefined }));
    expect(a.distance_m).toBeNull();
    expect(a.duration_s).toBeNull();
    expect(a.avg_hr).toBe(145);
    expect(a.calories).toBeNull();
  });

  it('redondea la dinámica a una décima y marca el origen del equilibrio GCT', () => {
    const a = normalizeGarminActivity(raw({
      averageRunningCadenceInStepsPerMinute: 180.46,
      avgGroundContactTime: 243.77,
      avgGroundContactBalance: 49.88,
      avgVerticalRatio: 7.049,
    }));
    expect(a.dynamics.cadence_spm).toBe(180.5);
    expect(a.dynamics.ground_contact_ms).toBe(243.8);
    expect(a.dynamics.vertical_ratio_pct).toBe(7);
    expect(a.dynamics.gct_balance_pct).toBe(49.9);
    expect(a.dynamics.gct_balance_source).toBe('activity');
  });

  it('sin equilibrio GCT el origen queda null (no "activity")', () => {
    const a = normalizeGarminActivity(raw());
    expect(a.dynamics.gct_balance_pct).toBeNull();
    expect(a.dynamics.gct_balance_source).toBeNull();
  });
});

describe('normalizeGarminLap', () => {
  it('mapea el lap del reloj al shape compacto, con el GAP de Garmin aparte', () => {
    const lap = normalizeGarminLap({
      lapIndex: 3, intensityType: 'INTERVAL', distance: 400.5, duration: 78.44,
      averageSpeed: 5.1, avgGradeAdjustedSpeed: 5.34, averageHR: 172, maxHR: 180,
      averageRunCadence: 186.66, averagePower: 320, normalizedPower: 330,
      groundContactBalanceLeft: 50.24, elevationGain: 12.55,
    });
    expect(lap).toEqual({
      lap_index: 3, intensity_type: 'INTERVAL', distance_m: 400.5, duration_s: 78.4,
      avg_speed_ms: 5.1, gap_speed_ms: 5.34, avg_hr: 172, max_hr: 180,
      cadence_spm: 186.7, avg_power_w: 320, norm_power_w: 330,
      gct_balance_pct: 50.2, elevation_gain_m: 12.6,
    });
  });

  it('un lap sin datos no inventa ceros', () => {
    const lap = normalizeGarminLap({});
    expect(lap.lap_index).toBeNull();
    expect(lap.distance_m).toBeNull();
    expect(lap.gap_speed_ms).toBeNull();
  });
});

describe('deriveHrSource / deriveDataQuality', () => {
  const sensor = (o) => ({ bleDeviceType: '', antDeviceType: '', sku: '', ...o });

  it('detecta la banda por cualquiera de los dos buses y sin depender de mayúsculas', () => {
    expect(deriveHrSource({ sensors: [sensor({ bleDeviceType: 'heart_rate' })] }, {})).toBe('strap');
    expect(deriveHrSource({ sensors: [sensor({ antDeviceType: 'HRM' })] }, {})).toBe('strap');
    expect(deriveHrSource({ sensors: [sensor({ bleDeviceType: 'HEARTRATE' })] }, {})).toBe('strap');
  });

  it('sin banda pero con FC media es muñeca; sin nada, unknown (nunca null)', () => {
    expect(deriveHrSource({ sensors: [] }, { averageHR: 145 })).toBe('wrist');
    expect(deriveHrSource({ sensors: [] }, {})).toBe('unknown');
    expect(deriveHrSource(null, null)).toBe('unknown');
    expect(deriveHrSource({ sensors: 'no-es-lista' }, { averageHR: 145 })).toBe('wrist');
  });

  it('la calidad de datos suma el medidor de potencia externo y el número de sensores', () => {
    const meta = { sensors: [sensor({ bleDeviceType: 'HEART_RATE' }), sensor({ sku: 'STRYD-XYZ' })] };
    expect(deriveDataQuality(meta, { averageHR: 150 })).toEqual({
      hr_source: 'strap', external_power_meter: true, sensor_count: 2,
    });
    expect(deriveDataQuality({ sensors: [] }, {})).toEqual({
      hr_source: 'unknown', external_power_meter: false, sensor_count: 0,
    });
  });
});

describe('enrichGarminActivity', () => {
  const base = () => normalizeGarminActivity({ activityId: 7, startTimeGMT: '2026-07-15 06:00:00', activityType: { typeKey: 'running' } });

  it('añade origen de FC, calidad, laps, GAP de Garmin y meteorología', async () => {
    const client = clientWith({
      '/splits': { lapDTOs: [{ lapIndex: 1, distance: 1000, duration: 300 }] },
      '/weather': { temp: 15, relativeHumidity: 60, dewPoint: 7 },
      '/activity/7': {
        metadataDTO: { sensors: [{ bleDeviceType: 'HEART_RATE' }] },
        summaryDTO: { averageHR: 150, avgGradeAdjustedSpeed: 3.4 },
      },
    });
    const a = await enrichGarminActivity(client, base());
    expect(a.hr_source).toBe('strap');
    expect(a.data_quality.sensor_count).toBe(1);
    expect(a.gap_speed_ms).toBe(3.4);
    expect(a.laps).toHaveLength(1);
    expect(a.weather.wbgt_c).toBeGreaterThan(0);
  });

  it('rellena la dinámica que falta desde el summary sin pisar la que ya venía', async () => {
    const b = base();
    b.dynamics.cadence_spm = 180;                       // ya la traía el listado
    const client = clientWith({
      '/activity/7': {
        summaryDTO: {
          averageRunCadence: 999,                       // clave alternativa: NO debe ganar
          groundContactTime: 240.44,
          avgGroundContactBalance: 50.6,
          verticalOscillation: 8.12,
        },
      },
      '/splits': { lapDTOs: [] },
      '/weather': null,
    });
    const a = await enrichGarminActivity(client, b);
    expect(a.dynamics.cadence_spm).toBe(180);
    expect(a.dynamics.ground_contact_ms).toBe(240.4);   // clave antigua del summary
    expect(a.dynamics.vertical_oscillation_cm).toBe(8.1);
    expect(a.dynamics.gct_balance_pct).toBe(50.6);
    expect(a.dynamics.gct_balance_source).toBe('summary');
  });

  it('reconstruye el equilibrio GCT desde los laps, ponderado por duración', async () => {
    const client = clientWith({
      '/activity/7': { summaryDTO: {} },
      '/splits': {
        lapDTOs: [
          { lapIndex: 1, duration: 100, groundContactBalanceLeft: 50 },
          { lapIndex: 2, duration: 300, groundContactBalanceLeft: 48 },
          { lapIndex: 3, duration: 200 },               // sin dato: no entra en la media
        ],
      },
      '/weather': null,
    });
    const a = await enrichGarminActivity(client, base());
    expect(a.dynamics.gct_balance_pct).toBe(48.5);      // (50·100 + 48·300) / 400
    expect(a.dynamics.gct_balance_source).toBe('laps');
  });

  it('un endpoint caído no arrastra a los otros dos', async () => {
    const client = clientWith({
      '/activity/7': new Error('500'),
      '/splits': { lapDTOs: [{ lapIndex: 1, distance: 1000 }] },
      '/weather': { temp: 15, relativeHumidity: 60, dewPoint: 7 },
    });
    const a = await enrichGarminActivity(client, base());
    expect(a.hr_source).toBeUndefined();                // el summary falló
    expect(a.laps).toHaveLength(1);                     // pero los laps entraron
    expect(a.weather).toBeTruthy();
  });

  it('sin laps no deja el campo puesto a lista vacía', async () => {
    const client = clientWith({ '/activity/7': { summaryDTO: {} }, '/splits': { lapDTOs: [] }, '/weather': null });
    const a = await enrichGarminActivity(client, base());
    expect(a.laps).toBeUndefined();
  });
});

describe('fetchGarminActivities', () => {
  const item = (id, o = {}) => ({
    activityId: id,
    activityName: `A${id}`,
    activityType: { typeKey: 'running' },
    startTimeGMT: `2026-07-${String(id).padStart(2, '0')} 06:00:00`,
    ...o,
  });
  const detailRoutes = { '/splits': { lapDTOs: [] }, '/weather': null, '/activity/': { summaryDTO: { averageHR: 150 } } };
  const listUrl = 'activitylist-service';

  it('LANZA si Garmin falla o responde algo raro (un [] borraría el histórico)', async () => {
    await expect(fetchGarminActivities(clientWith({ [listUrl]: new Error('427') }))).rejects.toThrow(/No se pudo listar/);
    await expect(fetchGarminActivities(clientWith({ [listUrl]: { error: 'x' } }))).rejects.toThrow(/Respuesta inesperada/);
  });

  it('acota el limit al rango [1, 300] de Garmin', async () => {
    const log = [];
    const client = clientWith({ [listUrl]: [] }, { log });
    await fetchGarminActivities(client, 5000);
    await fetchGarminActivities(client, 0);
    expect(log[0]).toContain('limit=300');
    expect(log[1]).toContain('limit=1');
  });

  it('descarta las actividades sin fecha de inicio', async () => {
    const client = clientWith({ [listUrl]: [item(1), item(2, { startTimeGMT: null }), { activityName: 'sin id' }] });
    const out = await fetchGarminActivities(client, 100, { enrichDetail: 0 });
    expect(out.map((a) => a.garmin_id)).toEqual([1]);
  });

  it('con presupuesto 0 no pide ni un detalle', async () => {
    const log = [];
    const client = clientWith({ [listUrl]: [item(1)], ...detailRoutes }, { log });
    const out = await fetchGarminActivities(client, 100, { enrichDetail: 0 });
    expect(out[0].hr_source).toBeUndefined();
    expect(log.filter((u) => u.includes('/splits'))).toHaveLength(0);
  });

  it('salta las ya enriquecidas y reparte el presupuesto entre recientes y backlog', async () => {
    const log = [];
    const ids = Array.from({ length: 15 }, (_, i) => i + 1);       // 1 = más antigua, 15 = más reciente
    const client = clientWith({ [listUrl]: ids.map((i) => item(i)), ...detailRoutes }, { log });
    await fetchGarminActivities(client, 100, { enrichDetail: 12, alreadyEnriched: ['15'] });

    const enriched = [...new Set(log.filter((u) => u.includes('/splits')).map((u) => Number(u.match(/activity\/(\d+)\//)[1])))];
    expect(enriched).toHaveLength(12);
    expect(enriched).not.toContain(15);                            // ya la teníamos
    // 10 plazas para las más recientes pendientes (14…5) y las 2 restantes al backlog
    // por el extremo antiguo (1 y 2): lo nuevo entra ya en este sync y el histórico
    // se va completando por detrás.
    for (const id of [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 1, 2]) expect(enriched).toContain(id);
    expect(enriched).not.toContain(3);
  });

  it('acepta un Set en alreadyEnriched y el nombre antiguo enrichRuns', async () => {
    const log = [];
    const client = clientWith({ [listUrl]: [item(1), item(2)], ...detailRoutes }, { log });
    await fetchGarminActivities(client, 100, { enrichRuns: 1, alreadyEnriched: new Set(['2']) });
    const enriched = [...new Set(log.filter((u) => u.includes('/splits')).map((u) => u.match(/activity\/(\d+)\//)[1]))];
    expect(enriched).toEqual(['1']);
  });

  it('enriquece también las salidas en bici, no solo lo que lleve "run" en el tipo', async () => {
    const log = [];
    const client = clientWith({
      [listUrl]: [item(1, { activityType: { typeKey: 'cycling' } }), item(2, { activityType: { typeKey: 'strength_training' } })],
      ...detailRoutes,
    }, { log });
    await fetchGarminActivities(client, 100, { enrichDetail: 10 });
    const enriched = [...new Set(log.filter((u) => u.includes('/splits')).map((u) => u.match(/activity\/(\d+)\//)[1]))];
    expect(enriched).toEqual(['1']);   // la bici sí, la fuerza no
  });
});

describe('fetchDayData', () => {
  const client = (o = {}) => ({
    getHeartRate: o.hr ?? (async () => ({})),
    getSleepData: o.sleep ?? (async () => ({})),
    client: { get: o.get ?? (async () => { throw new Error('404'); }) },
  });

  it('devuelve null cuando el día no trae nada aprovechable', async () => {
    expect(await fetchDayData(client(), '2026-07-15')).toBeNull();
  });

  it('descarta una FC en reposo imposible en vez de guardarla', async () => {
    const c = client({ hr: async () => ({ restingHeartRate: 12 }) });
    expect(await fetchDayData(c, '2026-07-15')).toBeNull();
  });

  it('el HRV del bulk gana y evita ir a buscar el sueño', async () => {
    let sleepCalls = 0;
    const c = client({
      hr: async () => ({ restingHeartRate: 45 }),
      sleep: async () => { sleepCalls++; return { avgOvernightHrv: 99 }; },
    });
    const map = new Map([['2026-07-15', { hrv: 62, hrvStatus: 'BALANCED' }]]);
    const row = await fetchDayData(c, '2026-07-15', map, new Map([['2026-07-15', { bbLow: 20, bbHigh: 90 }]]));
    expect(row).toEqual({ date: '2026-07-15', restingHR: 45, hrv: 62, hrvStatus: 'BALANCED', bbLow: 20, bbHigh: 90 });
    expect(sleepCalls).toBe(0);
  });

  it('sin bulk cae al sueño y, si tampoco, al hrv-service', async () => {
    const porSueno = await fetchDayData(client({ sleep: async () => ({ avgOvernightHrv: 58, restingHeartRate: 44 }) }), '2026-07-15');
    expect(porSueno).toMatchObject({ hrv: 58, restingHR: 44 });

    const porServicio = await fetchDayData(client({ get: async () => ({ hrvSummary: { lastNight: 55, status: 'LOW' } }) }), '2026-07-15');
    expect(porServicio).toMatchObject({ hrv: 55, hrvStatus: 'LOW' });
  });
});

describe('merges y ventanas', () => {
  it('mergeData mezcla campos por fecha (no reemplaza la fila) y ordena', () => {
    const out = mergeData(
      [{ date: '2026-07-02', restingHR: 45 }, { date: '2026-07-01', hrv: 60 }],
      [{ date: '2026-07-02', hrv: 62 }],
    );
    expect(out.map((r) => r.date)).toEqual(['2026-07-01', '2026-07-02']);
    expect(out[1]).toEqual({ date: '2026-07-02', restingHR: 45, hrv: 62 });
  });

  it('mergeSleepData REEMPLAZA la semana entera (la nueva lectura manda)', () => {
    const out = mergeSleepData(
      [{ weekStart: '2026-06-29', avg: 7, extra: 1 }],
      [{ weekStart: '2026-06-29', avg: 8 }],
    );
    expect(out).toEqual([{ weekStart: '2026-06-29', avg: 8 }]);
    expect(mergeSleepData()).toEqual([]);
  });

  it('threeMonthChunks cubre el rango entero, de más antiguo a más nuevo y sin repetir días', () => {
    const chunks = threeMonthChunks(200);
    const dias = chunks.flat();
    expect(new Set(dias).size).toBe(dias.length);          // sin solapes
    expect(dias).toEqual([...dias].sort());                // en orden
    expect(dias[dias.length - 1]).toBe(toDateStr(new Date()));
    expect(chunks.length).toBeGreaterThan(1);
    expect(threeMonthChunks(1)).toEqual([[toDateStr(new Date())]]);
  });
});
