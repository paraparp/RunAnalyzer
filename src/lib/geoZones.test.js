import { describe, it, expect } from 'vitest';
import {
  haversineKm, startPoint, zoneKey,
  clusterActivities, applyZoneEdits, shareOfKm,
  monthlyByZone, dormantZones, explorationByYear, hullAreaKm2,
  DEFAULT_RADIUS_KM,
} from './geoZones';

// Actividad mínima con lo que consume la librería.
let nextId = 1;
const act = (o = {}) => ({
  id: nextId++,
  distance: 10000,
  moving_time: 3000,
  total_elevation_gain: 100,
  start_date_local: '2026-05-10T08:00:00',
  ...o,
});

// Un punto desplazado `dLatKm` al norte de otro. 1 grado de latitud ≈ 111,2 km,
// así que sirve para construir cúmulos a distancias controladas.
const northOf = ([lat, lng], dKm) => [lat + dKm / 111.19, lng];

const MADRID = [40.4168, -3.7038];

describe('haversineKm', () => {
  it('da 0 para el mismo punto', () => {
    expect(haversineKm(MADRID, MADRID)).toBe(0);
  });

  it('un grado de latitud son ~111 km, en cualquier meridiano', () => {
    expect(haversineKm([0, 0], [1, 0])).toBeCloseTo(111.19, 1);
    expect(haversineKm([40, -3], [41, -3])).toBeCloseTo(111.19, 1);
  });

  it('es simétrica', () => {
    const a = MADRID, b = [41.3874, 2.1686]; // Barcelona
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it('mide bien una distancia larga conocida (Madrid–Barcelona ≈ 505 km)', () => {
    expect(haversineKm(MADRID, [41.3874, 2.1686])).toBeCloseTo(505, 0);
  });
});

describe('startPoint', () => {
  it('acepta un par de coordenadas válido', () => {
    expect(startPoint(act({ start_latlng: MADRID }))).toEqual(MADRID);
  });

  it('descarta la cinta: start_latlng vacío o ausente', () => {
    expect(startPoint(act({ start_latlng: [] }))).toBeNull();
    expect(startPoint(act({ start_latlng: null }))).toBeNull();
    expect(startPoint(act())).toBeNull();
  });

  it('descarta la "isla nula" [0,0] del GPS sin fix', () => {
    expect(startPoint(act({ start_latlng: [0, 0] }))).toBeNull();
  });

  it('descarta coordenadas imposibles o no numéricas', () => {
    expect(startPoint(act({ start_latlng: [91, 0] }))).toBeNull();
    expect(startPoint(act({ start_latlng: [0, 181] }))).toBeNull();
    expect(startPoint(act({ start_latlng: ['40.4', '-3.7'] }))).toBeNull();
    expect(startPoint(act({ start_latlng: [NaN, 0] }))).toBeNull();
  });
});

describe('zoneKey', () => {
  it('redondea a 3 decimales, así que dos salidas a <110 m comparten clave', () => {
    expect(zoneKey([40.41681, -3.70382])).toBe(zoneKey([40.41684, -3.70379]));
  });

  it('distingue puntos claramente distintos', () => {
    expect(zoneKey(MADRID)).not.toBe(zoneKey([41.3874, 2.1686]));
  });
});

describe('clusterActivities', () => {
  it('agrupa las salidas cercanas y separa las lejanas', () => {
    const casa = [MADRID, northOf(MADRID, 0.3), northOf(MADRID, 0.6)];
    const pueblo = [[41.65, -4.72], northOf([41.65, -4.72], 0.4)];
    const acts = [...casa, ...pueblo].map(p => act({ start_latlng: p }));

    const { zones } = clusterActivities(acts, { radiusKm: DEFAULT_RADIUS_KM });
    expect(zones).toHaveLength(2);
    expect(zones.map(z => z.count)).toEqual([3, 2]); // ordenado por km desc.
  });

  it('ordena las zonas por km, no por número de salidas', () => {
    const acts = [
      ...Array.from({ length: 4 }, () => act({ start_latlng: MADRID, distance: 5000 })),
      act({ start_latlng: [41.65, -4.72], distance: 42000 }),
    ];
    const { zones } = clusterActivities(acts);
    expect(zones[0].distanceKm).toBe(42);   // una sola salida, pero más km
    expect(zones[1].distanceKm).toBe(20);
  });

  it('el radio manda: el mismo dato da más zonas si se estrecha', () => {
    const acts = [MADRID, northOf(MADRID, 2)].map(p => act({ start_latlng: p }));
    expect(clusterActivities(acts, { radiusKm: 3 }).zones).toHaveLength(1);
    expect(clusterActivities(acts, { radiusKm: 1 }).zones).toHaveLength(2);
  });

  it('siembra en el punto denso, no en la salida suelta que llegue antes', () => {
    // Cinco salidas repartidas por un mismo barrio y una suelta a 1,45 km. Con
    // radio 1,5 km todas acaban en un cúmulo, pero el centro lo tiene que fijar
    // el barrio. La suelta lleva el id más bajo: ganaría cualquier desempate, así
    // que si la semilla no cae en ella es porque mandó la densidad.
    const barrio = [0, 0.2, -0.2, 0.1, -0.1].map(d => northOf(MADRID, d));
    const suelta = northOf(MADRID, 1.45);
    const acts = [
      act({ id: 1, start_latlng: suelta }),
      ...barrio.map((p, i) => act({ id: 10 + i, start_latlng: p })),
    ];
    const { zones } = clusterActivities(acts, { radiusKm: 1.5 });
    expect(zones).toHaveLength(1);
    expect(zones[0].key).not.toBe(zoneKey(suelta));
    expect(haversineKm(zones[0].seed, MADRID)).toBeLessThan(0.3);
  });

  it('es determinista: el orden de entrada no cambia el resultado', () => {
    const pts = [MADRID, northOf(MADRID, 0.5), [41.65, -4.72], northOf(MADRID, 0.9)];
    const acts = pts.map((p, i) => act({ id: 100 + i, start_latlng: p }));
    const a = clusterActivities(acts);
    const b = clusterActivities([...acts].reverse());
    expect(b.zones.map(z => z.key)).toEqual(a.zones.map(z => z.key));
    expect(b.zones.map(z => z.count)).toEqual(a.zones.map(z => z.count));
  });

  it('separa las actividades sin coordenadas en `unlocated`, sin perder sus km', () => {
    const acts = [
      act({ start_latlng: MADRID, distance: 10000 }),
      act({ start_latlng: [], distance: 8000 }),      // cinta
      act({ start_latlng: [0, 0], distance: 5000 }),  // sin fix
    ];
    const { zones, unlocated } = clusterActivities(acts);
    expect(zones).toHaveLength(1);
    expect(zones[0].distanceKm).toBe(10);
    expect(unlocated.count).toBe(2);
    expect(unlocated.distanceKm).toBe(13);
    // Nada se evapora: zonas + sin ubicar = volumen real.
    const total = zones.reduce((s, z) => s + z.distanceKm, 0) + unlocated.distanceKm;
    expect(total).toBe(23);
  });

  it('agrega km, tiempo, desnivel y rango de fechas de cada zona', () => {
    const acts = [
      act({ start_latlng: MADRID, distance: 10000, moving_time: 3000, total_elevation_gain: 100, start_date_local: '2026-03-01T08:00:00' }),
      act({ start_latlng: MADRID, distance: 5000,  moving_time: 1500, total_elevation_gain: 50,  start_date_local: '2026-01-15T08:00:00' }),
    ];
    const [z] = clusterActivities(acts).zones;
    expect(z.count).toBe(2);
    expect(z.distanceKm).toBe(15);
    expect(z.movingSec).toBe(4500);
    expect(z.elevationM).toBe(150);
    expect(z.firstDate).toBe('2026-01-15');
    expect(z.lastDate).toBe('2026-03-01');
  });

  it('expresa la pendiente en %: 10 m/km es 1 %', () => {
    const [z] = clusterActivities([
      act({ start_latlng: MADRID, distance: 10000, total_elevation_gain: 100 }),
    ]).zones;
    expect(z.elevPct).toBeCloseTo(1, 6);
  });

  it('la pendiente es independiente de lo largas que sean las tiradas', () => {
    // Mismo terreno (1 %) en dos sitios, pero en uno se sale a tiradas largas.
    const largo = clusterActivities([
      act({ start_latlng: MADRID, distance: 30000, total_elevation_gain: 300 }),
    ]).zones[0];
    const corto = clusterActivities([
      act({ start_latlng: MADRID, distance: 5000, total_elevation_gain: 50 }),
    ]).zones[0];
    expect(largo.elevPct).toBeCloseTo(1, 6);
    expect(corto.elevPct).toBeCloseTo(1, 6);
    // La media por carrera los habría dado como sitios distintos (300 m vs 50 m).
    expect(largo.elevationM / largo.count).not.toBeCloseTo(corto.elevationM / corto.count, 1);
  });

  it('distingue el sitio llano del rompepiernas', () => {
    const llano = clusterActivities([
      act({ start_latlng: MADRID, distance: 10000, total_elevation_gain: 40 }),
      act({ start_latlng: MADRID, distance: 10000, total_elevation_gain: 60 }),
    ]).zones[0];
    const monte = clusterActivities([
      act({ start_latlng: MADRID, distance: 10000, total_elevation_gain: 600 }),
    ]).zones[0];
    expect(llano.elevPct).toBeCloseTo(0.5, 6);
    expect(monte.elevPct).toBeCloseTo(6, 6);
  });

  it('no divide por cero si la zona no tiene km', () => {
    const [z] = clusterActivities([
      act({ start_latlng: MADRID, distance: 0, total_elevation_gain: 0 }),
    ]).zones;
    expect(z.elevPct).toBe(0);
  });

  it('aguanta campos ausentes y entrada vacía', () => {
    expect(clusterActivities(null).zones).toEqual([]);
    expect(clusterActivities([]).unlocated.count).toBe(0);
    const [z] = clusterActivities([{ id: 1, start_latlng: MADRID }]).zones;
    expect(z.distanceKm).toBe(0);
    expect(z.elevationM).toBe(0);
    expect(z.firstDate).toBeNull();
  });
});

describe('applyZoneEdits', () => {
  const build = () => clusterActivities([
    act({ id: 1, start_latlng: MADRID, distance: 10000 }),
    act({ id: 2, start_latlng: northOf(MADRID, 5), distance: 6000 }),
    act({ id: 3, start_latlng: [41.65, -4.72], distance: 4000 }),
  ], { radiusKm: 1.5 }).zones;

  it('sin ediciones devuelve las mismas zonas, sin nombre', () => {
    const zones = applyZoneEdits(build());
    expect(zones).toHaveLength(3);
    expect(zones.every(z => z.name === null)).toBe(true);
    expect(zones.every(z => z.mergedFrom === null)).toBe(true);
  });

  it('aplica los nombres del atleta por clave', () => {
    const raw = build();
    const zones = applyZoneEdits(raw, { labels: { [raw[0].key]: 'Casa' } });
    expect(zones.find(z => z.key === raw[0].key).name).toBe('Casa');
  });

  it('fusiona cúmulos y suma sus km bajo la clave destino', () => {
    const raw = build();
    const [a, b] = raw;
    const zones = applyZoneEdits(raw, {
      labels: { [a.key]: 'Madrid' },
      mergeInto: { [b.key]: a.key },
    });
    expect(zones).toHaveLength(2);
    const merged = zones.find(z => z.key === a.key);
    expect(merged.name).toBe('Madrid');
    expect(merged.count).toBe(2);
    expect(merged.distanceKm).toBe(a.distanceKm + b.distanceKm);
    expect(merged.mergedFrom).toContain(b.key);
  });

  it('sigue cadenas de fusión A→B→C', () => {
    const raw = build();
    const [a, b, c] = raw;
    const zones = applyZoneEdits(raw, { mergeInto: { [c.key]: b.key, [b.key]: a.key } });
    expect(zones).toHaveLength(1);
    expect(zones[0].key).toBe(a.key);
    expect(zones[0].count).toBe(3);
  });

  it('no se cuelga con un ciclo de fusiones', () => {
    const raw = build();
    const [a, b] = raw;
    const zones = applyZoneEdits(raw, { mergeInto: { [a.key]: b.key, [b.key]: a.key } });
    expect(zones.reduce((s, z) => s + z.count, 0)).toBe(3); // no se pierde nada
  });

  it('ignora claves huérfanas de un radio anterior', () => {
    const raw = build();
    const zones = applyZoneEdits(raw, {
      labels: { 'zona-que-ya-no-existe': 'Fantasma' },
      mergeInto: { 'otra-vieja': raw[0].key },
    });
    expect(zones).toHaveLength(3);
    expect(zones.every(z => z.name === null)).toBe(true);
  });
});

describe('shareOfKm', () => {
  it('reparte el 100% entre las zonas', () => {
    const zones = shareOfKm([{ distanceKm: 30 }, { distanceKm: 10 }]);
    expect(zones[0].pct).toBe(75);
    expect(zones[1].pct).toBe(25);
  });

  it('no divide por cero cuando no hay km', () => {
    expect(shareOfKm([{ distanceKm: 0 }])[0].pct).toBe(0);
    expect(shareOfKm([])).toEqual([]);
  });
});

describe('monthlyByZone', () => {
  const zone = (acts) => ({ key: 'z', name: 'Sierra', activities: acts });

  it('reparte los km en los doce meses naturales', () => {
    const [z] = monthlyByZone([zone([
      act({ distance: 10000, start_date_local: '2026-01-10T08:00:00' }),
      act({ distance: 5000,  start_date_local: '2026-07-20T08:00:00' }),
    ])]);
    expect(z.months).toHaveLength(12);
    expect(z.months[0]).toBe(10);
    expect(z.months[6]).toBe(5);
    expect(z.total).toBe(15);
  });

  it('apila los mismos meses de años distintos: el ciclo está en el mes, no en la fecha', () => {
    const [z] = monthlyByZone([zone([
      act({ distance: 10000, start_date_local: '2024-07-01T08:00:00' }),
      act({ distance: 10000, start_date_local: '2025-07-01T08:00:00' }),
      act({ distance: 10000, start_date_local: '2026-07-01T08:00:00' }),
    ])]);
    expect(z.months[6]).toBe(30);
    expect(z.total).toBe(30);
  });

  it('conserva clave y nombre de la zona', () => {
    const [z] = monthlyByZone([zone([act({ start_date_local: '2026-03-01T08:00:00' })])]);
    expect(z.key).toBe('z');
    expect(z.name).toBe('Sierra');
  });

  it('ignora actividades sin fecha utilizable', () => {
    const [z] = monthlyByZone([zone([
      act({ distance: 8000, start_date_local: null, start_date: null }),
      act({ distance: 2000, start_date_local: '2026-05-05T08:00:00' }),
    ])]);
    expect(z.total).toBe(2);
  });

  it('aguanta la lista vacía', () => {
    expect(monthlyByZone([])).toEqual([]);
    expect(monthlyByZone(null)).toEqual([]);
  });
});

describe('dormantZones', () => {
  const TODAY = new Date('2026-08-30T00:00:00');
  const zone = (key, lastDate) => ({ key, lastDate, distanceKm: 10 });

  it('marca los sitios sin pisar desde hace más de seis meses', () => {
    const out = dormantZones(
      [zone('viejo', '2025-09-01'), zone('reciente', '2026-08-01')],
      { today: TODAY },
    );
    expect(out.map(z => z.key)).toEqual(['viejo']);
  });

  it('cuenta los meses transcurridos y ordena por abandono', () => {
    const out = dormantZones(
      [zone('a', '2026-01-15'), zone('b', '2024-08-30')],
      { today: TODAY },
    );
    expect(out.map(z => z.key)).toEqual(['b', 'a']);
    expect(out[0].monthsSince).toBe(24);
    expect(out[1].monthsSince).toBe(7);
  });

  it('el umbral es configurable', () => {
    const zones = [zone('a', '2026-06-01')]; // 3 meses
    expect(dormantZones(zones, { today: TODAY })).toHaveLength(0);
    expect(dormantZones(zones, { today: TODAY, months: 2 })).toHaveLength(1);
  });

  it('ignora zonas sin fecha y la lista vacía', () => {
    expect(dormantZones([zone('a', null)], { today: TODAY })).toEqual([]);
    expect(dormantZones(null, { today: TODAY })).toEqual([]);
  });
});

describe('hullAreaKm2', () => {
  it('mide el área de un cuadrado de un grado de lado', () => {
    // ~111 km x ~85 km a la latitud de Madrid -> del orden de 9.000 km2.
    const area = hullAreaKm2([[40, -4], [41, -4], [41, -3], [40, -3]]);
    expect(area).toBeGreaterThan(8000);
    expect(area).toBeLessThan(10500);
  });

  it('los puntos interiores no cambian la envolvente', () => {
    const cuadrado = [[40, -4], [41, -4], [41, -3], [40, -3]];
    expect(hullAreaKm2([...cuadrado, [40.5, -3.5]])).toBeCloseTo(hullAreaKm2(cuadrado), 3);
  });

  it('sin polígono no hay área: menos de tres puntos, o todos alineados', () => {
    expect(hullAreaKm2([])).toBe(0);
    expect(hullAreaKm2([[40, -4]])).toBe(0);
    expect(hullAreaKm2([[40, -4], [41, -3]])).toBe(0);
    expect(hullAreaKm2([[40, -4], [40.5, -4], [41, -4]])).toBeCloseTo(0, 6);
  });
});

describe('explorationByYear', () => {
  const zoneOf = (key, centroid, acts) => ({ key, centroid, activities: acts });
  const CASA = [40.4168, -3.7038];

  it('mide hasta dónde te fuiste de casa cada año', () => {
    const casa = zoneOf('casa', CASA, [act({ start_date_local: '2026-03-01T08:00:00' })]);
    const sierra = zoneOf('sierra', [40.9, -3.9], [act({ start_date_local: '2026-07-01T08:00:00' })]);
    const [y] = explorationByYear([casa, sierra]);
    expect(y.year).toBe('2026');
    expect(y.radiusKm).toBeCloseTo(haversineKm(CASA, [40.9, -3.9]), 6);
  });

  it('cuenta los sitios distintos pisados en cada año, no las salidas', () => {
    const casa = zoneOf('casa', CASA, [
      act({ start_date_local: '2025-03-01T08:00:00' }),
      act({ start_date_local: '2025-04-01T08:00:00' }),
      act({ start_date_local: '2026-01-01T08:00:00' }),
    ]);
    const otro = zoneOf('otro', [40.6, -3.8], [act({ start_date_local: '2026-05-01T08:00:00' })]);
    const years = explorationByYear([casa, otro]);
    expect(years.map(y => y.year)).toEqual(['2025', '2026']);
    expect(years[0].places).toBe(1);
    expect(years[0].runs).toBe(2);
    expect(years[1].places).toBe(2);
  });

  it('un año en un solo sitio no encierra área', () => {
    const casa = zoneOf('casa', CASA, [act({ start_date_local: '2026-03-01T08:00:00' })]);
    expect(explorationByYear([casa])[0].areaKm2).toBe(0);
  });

  it('con tres sitios o más aparece la superficie cubierta', () => {
    const zs = [
      zoneOf('a', CASA, [act({ start_date_local: '2026-01-01T08:00:00' })]),
      zoneOf('b', [40.9, -3.7], [act({ start_date_local: '2026-02-01T08:00:00' })]),
      zoneOf('c', [40.6, -3.2], [act({ start_date_local: '2026-03-01T08:00:00' })]),
    ];
    expect(explorationByYear(zs)[0].areaKm2).toBeGreaterThan(100);
  });

  it('la casa se puede fijar a mano; por defecto es la primera zona', () => {
    const a = zoneOf('a', CASA, [act({ start_date_local: '2026-01-01T08:00:00' })]);
    const b = zoneOf('b', [40.9, -3.7], [act({ start_date_local: '2026-01-02T08:00:00' })]);
    expect(explorationByYear([a, b], b)[0].radiusKm)
      .toBeCloseTo(explorationByYear([b, a])[0].radiusKm, 6);
  });

  it('sin zonas no hay nada que medir', () => {
    expect(explorationByYear([])).toEqual([]);
    expect(explorationByYear(null)).toEqual([]);
  });
});
