import { describe, it, expect } from 'vitest';
import { computeFlatEfforts, needsFlatEfforts, FLAT_EFFORTS_VERSION } from './flatEfforts';

// Construye streams sintéticos a partir de tramos { m, pace (s/km), elev }.
// El muestreo es cada `step` metros para poder colocar el cruce del kilómetro
// justo entre dos muestras y comprobar la interpolación. Con `grade: true` se
// emite además grade_smooth (%), como hace Strava.
const buildStreams = (segments, { step = 10, startAlt = 100, grade = false } = {}) => {
  const distance = [0], time = [0], altitude = [startAlt], grade_smooth = [0];
  for (const seg of segments) {
    const n = Math.round(seg.m / step);
    const dtStep = (step / 1000) * seg.pace;
    const dAltStep = (seg.elev ?? 0) / n;
    for (let k = 0; k < n; k++) {
      distance.push(distance.at(-1) + step);
      time.push(time.at(-1) + dtStep);
      altitude.push(altitude.at(-1) + dAltStep);
      grade_smooth.push((dAltStep / step) * 100);
    }
  }
  const streams = { distance: { data: distance }, time: { data: time }, altitude: { data: altitude } };
  if (grade) streams.grade_smooth = { data: grade_smooth };
  return streams;
};

// Mejor ventana de 1 km SIN filtro de desnivel: la cota que ningún tramo llano
// puede batir. Es el equivalente local del best_effort de 1k de Strava.
const fastestKm = (streams) => {
  const d = streams.distance.data, t = streams.time.data;
  let best = Infinity, j = 1;
  for (let i = 0; i < d.length; i++) {
    const end = d[i] + 1000;
    while (j < d.length && d[j] < end) j++;
    if (j >= d.length) break;
    const span = d[j] - d[j - 1];
    const tEnd = t[j - 1] + ((end - d[j - 1]) / span) * (t[j] - t[j - 1]);
    best = Math.min(best, tEnd - t[i]);
  }
  return best;
};

describe('computeFlatEfforts', () => {
  it('devuelve la distancia EXACTA, no la de la muestra siguiente', () => {
    // Muestreo cada 30 m: ninguna muestra cae en el metro 1000 (990, 1020...).
    const streams = buildStreams([{ m: 1980, pace: 240 }], { step: 30 });
    const { '1k': k1 } = computeFlatEfforts(streams);
    expect(k1.distance).toBe(1000);
    expect(k1.time).toBeCloseTo(240, 1); // 4:00/km sobre 1000 m = 240 s
  });

  it('el tiempo y el ritmo son coherentes entre sí', () => {
    const streams = buildStreams([{ m: 1500, pace: 200 }]);
    const { '1k': k1 } = computeFlatEfforts(streams);
    const paceSegPorKm = (k1.time / k1.distance) * 1000;
    expect(paceSegPorKm).toBeCloseTo(k1.time, 6); // solo se cumple si distance === 1000
    expect(paceSegPorKm).toBeCloseTo(200, 1);
  });

  it('encuentra el kilómetro más rápido, no el primero', () => {
    const streams = buildStreams([
      { m: 1000, pace: 300 },
      { m: 1000, pace: 210 }, // el rápido va en medio
      { m: 1000, pace: 300 },
    ]);
    expect(computeFlatEfforts(streams)['1k'].time).toBeCloseTo(210, 0);
  });

  it('la ventana arranca en cualquier punto, no solo en múltiplos de km', () => {
    const streams = buildStreams([
      { m: 500, pace: 300 },
      { m: 1000, pace: 200 }, // km rápido desplazado 500 m
      { m: 500, pace: 300 },
    ]);
    expect(computeFlatEfforts(streams)['1k'].time).toBeCloseTo(200, 0);
  });

  it('calcula el 2k además del 1k', () => {
    const res = computeFlatEfforts(buildStreams([{ m: 3000, pace: 240 }]));
    expect(res['1k'].distance).toBe(1000);
    expect(res['2k'].distance).toBe(2000);
    expect(res['2k'].time).toBeCloseTo(480, 1);
  });

  it('devuelve siempre un objeto versionado, aunque no haya tramo válido', () => {
    expect(computeFlatEfforts(null)).toEqual({ _v: FLAT_EFFORTS_VERSION });
    expect(computeFlatEfforts({ distance: { data: [0, 10] } })).toEqual({ _v: FLAT_EFFORTS_VERSION });
    // Una actividad de 600 m no da ni un 1k.
    const short = computeFlatEfforts(buildStreams([{ m: 600, pace: 240 }]));
    expect(short['1k']).toBeUndefined();
    expect(short._v).toBe(FLAT_EFFORTS_VERSION);
  });
});

describe('criterio de llaneza (v3: desnivel bruto)', () => {
  it('rechaza el tramo rápido cuesta abajo', () => {
    const streams = buildStreams([
      { m: 1000, pace: 200, elev: -40 }, // rápido pero cuesta abajo
      { m: 1000, pace: 260, elev: 0 },   // más lento pero llano
    ], { grade: true });
    const { '1k': k1 } = computeFlatEfforts(streams);
    expect(k1.time).toBeGreaterThan(250); // el km de bajada (200 s) queda descartado
    expect(k1.loss).toBeLessThanOrEqual(10);
  });

  it('un sube-y-baja compensado YA NO cuenta como llano (el fallo del criterio neto)', () => {
    // +20 m y −20 m: neto 0, así que la v2 lo aceptaba. El bruto lo caza.
    const roto = computeFlatEfforts(buildStreams([
      { m: 500, pace: 220, elev: 20 },
      { m: 500, pace: 220, elev: -20 },
    ], { grade: true }));
    expect(roto['1k']).toBeUndefined();

    // Control: el mismo perfil con ±4 m sí es llano de verdad.
    const ok = computeFlatEfforts(buildStreams([
      { m: 500, pace: 220, elev: 4 },
      { m: 500, pace: 220, elev: -4 },
    ], { grade: true }))['1k'];
    expect(ok).toBeDefined();
    expect(ok.elevation).toBeCloseTo(0, 1);
    expect(ok.gain).toBeLessThanOrEqual(10);
    expect(ok.loss).toBeLessThanOrEqual(10);
  });

  it('informa de gain y loss por separado, no solo del neto', () => {
    const { '1k': k1 } = computeFlatEfforts(buildStreams([
      { m: 500, pace: 220, elev: 6 },
      { m: 500, pace: 220, elev: -6 },
    ], { grade: true }));
    expect(k1.gain).toBeCloseTo(6, 0);
    expect(k1.loss).toBeCloseTo(6, 0);
    expect(k1.elevation).toBeCloseTo(0, 1);
  });
});

describe('fuente de pendiente', () => {
  it('usa grade_smooth cuando Strava lo manda', () => {
    const res = computeFlatEfforts(buildStreams([{ m: 1500, pace: 240 }], { grade: true }));
    expect(res._grade_source).toBe('grade_smooth');
  });

  it('cae a la altitud suavizada cuando no viene', () => {
    const res = computeFlatEfforts(buildStreams([{ m: 1500, pace: 240 }]));
    expect(res._grade_source).toBe('altitude');
  });

  it('el suavizado evita que el ruido de altitud invente desnivel bruto', () => {
    // Terreno plano de verdad con ±2 m de ruido GPS muestra a muestra: sumar
    // |Δalt| en crudo daría cientos de metros de D+ y ningún tramo sería llano.
    const streams = buildStreams([{ m: 1500, pace: 240 }]);
    const alt = streams.altitude.data;
    for (let i = 0; i < alt.length; i++) alt[i] += (i % 2 ? 2 : -2);
    const { '1k': k1 } = computeFlatEfforts(streams);
    expect(k1).toBeDefined();
    expect(k1.gain).toBeLessThanOrEqual(10);
  });

  it('ignora grade_smooth si viene demasiado incompleto', () => {
    const streams = buildStreams([{ m: 1500, pace: 240 }], { grade: true });
    streams.grade_smooth.data = streams.grade_smooth.data.map((v, i) => (i % 3 ? null : v));
    expect(computeFlatEfforts(streams)._grade_source).toBe('altitude');
  });
});

describe('invariantes', () => {
  // El flat 1K es el mejor km que además es llano, así que nunca puede batir al
  // mejor km sin restricciones — que es lo que calcula el best_effort '1k' de
  // Strava. Si esta invariante se rompe, el filtro o la ventana tienen un bug.
  it('el flat 1K nunca es más rápido que el mejor 1K sin filtrar', () => {
    const streams = buildStreams([
      { m: 900, pace: 300, elev: 0 },
      { m: 1000, pace: 195, elev: -35 }, // el más rápido, pero en bajada
      { m: 1100, pace: 245, elev: 0 },
    ], { grade: true });
    const { '1k': k1 } = computeFlatEfforts(streams);
    expect(k1.time).toBeGreaterThanOrEqual(fastestKm(streams));
  });

  it('el flat 1k nunca es más lento que la mitad del flat 2k', () => {
    const res = computeFlatEfforts(buildStreams([
      { m: 800, pace: 300 },
      { m: 1000, pace: 190 },
      { m: 1200, pace: 300 },
    ], { grade: true }));
    expect(res['1k'].time).toBeLessThanOrEqual(res['2k'].time / 2 + 0.001);
  });

  it('no interpola a través de un salto de GPS', () => {
    // Un único salto de 400 m: cualquier ventana que lo cruce se descarta.
    expect(computeFlatEfforts({
      distance: { data: [0, 500, 900] },
      time: { data: [0, 100, 180] },
      altitude: { data: [100, 100, 100] },
    })['1k']).toBeUndefined();
  });
});

describe('needsFlatEfforts', () => {
  it('pide cálculo si falta o si la versión cacheada es antigua', () => {
    expect(needsFlatEfforts({})).toBe(true);
    expect(needsFlatEfforts({ flat_efforts: {} })).toBe(true);                      // cache v1 vacío
    expect(needsFlatEfforts({ flat_efforts: { _v: 2, '1k': { time: 200 } } })).toBe(true); // cache v2
    expect(needsFlatEfforts({ flat_efforts: { _v: FLAT_EFFORTS_VERSION } })).toBe(false);
  });
});
