import { describe, it, expect } from 'vitest';
import { computeStreamGap, needsStreamGap, hasStreamGap, activityGapSpeed, STREAM_GAP_VERSION } from './streamGap';
import { gapFactor, gapSpeedFromGain } from './gap';

// Mismo constructor de streams sintéticos que flatEfforts.test.js: tramos
// { m, pace (s/km), elev } muestreados cada `step` metros, con grade_smooth (%)
// opcional como lo emite Strava.
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

const gapPaceSKm = (r) => (r.gap_time_s / r.distance_m) * 1000;

describe('computeStreamGap', () => {
  it('en llano el GAP es el ritmo real', () => {
    const r = computeStreamGap(buildStreams([{ m: 3000, pace: 240 }], { grade: true }));
    expect(r.distance_m).toBe(3000);
    expect(gapPaceSKm(r)).toBeCloseTo(240, 1);
    expect(r.per_km).toHaveLength(3);
  });

  it('LA CORRECCIÓN: un km rompepiernas ya no se procesa como llano', () => {
    // 500 m al 4% y 500 m al −4%: desnivel NETO del km = 0, así que el GAP por
    // parciales (que sólo ve el neto) daría exactamente el ritmo real. Muestra a
    // muestra sí se paga la asimetría de Minetti: subir cuesta más de lo que
    // acredita bajar, luego el GAP tiene que salir MÁS RÁPIDO que el ritmo real.
    const streams = buildStreams(
      [{ m: 500, pace: 300, elev: 20 }, { m: 500, pace: 300, elev: -20 }],
      { grade: true },
    );
    const r = computeStreamGap(streams);
    expect(r.net_m).toBeCloseTo(0, 0);
    expect(gapPaceSKm(r)).toBeLessThan(300);
    // El valor es el del modelo: media armónica de los dos factores a ±4%.
    const esperado = 300 / ((0.5 / gapFactor(0.04)) + (0.5 / gapFactor(-0.04))) ** -1;
    expect(gapPaceSKm(r)).toBeCloseTo(esperado, 0);
    // Y el desnivel bruto se conserva, que es lo que el neto escondía.
    expect(r.gain_m).toBeCloseTo(20, 0);
    expect(r.loss_m).toBeCloseTo(20, 0);
  });

  it('subida sostenida: el GAP es más rápido que el ritmo real', () => {
    const r = computeStreamGap(buildStreams([{ m: 2000, pace: 300, elev: 100 }], { grade: true }));
    expect(gapPaceSKm(r)).toBeCloseTo(300 / gapFactor(0.05), 0);
    expect(r.gain_m).toBeCloseTo(100, 0);
    expect(r.loss_m).toBe(0);
  });

  it('bajada: el GAP es más lento que el ritmo real, con crédito amortiguado', () => {
    const r = computeStreamGap(buildStreams([{ m: 2000, pace: 300, elev: -100 }], { grade: true }));
    expect(gapPaceSKm(r)).toBeGreaterThan(300);
    expect(gapPaceSKm(r)).toBeCloseTo(300 / gapFactor(-0.05), 0);
  });

  it('descarta pausas y saltos de GPS en vez de repartir su tiempo', () => {
    const streams = buildStreams([{ m: 2000, pace: 240 }], { grade: true });
    const t = streams.time.data;
    // Semáforo en el metro 1000: 5 min parado, repartidos sobre el intervalo que
    // cruza. Ese intervalo entero (10 m, 2,4 s) se descarta con la pausa.
    for (let k = 100; k < t.length; k++) t[k] += 300;
    const r = computeStreamGap(streams);
    expect(r.distance_m).toBe(1990);             // los 10 m del intervalo roto
    expect(r.time_s).toBeCloseTo(477.6, 0);      // 2 km a 4:00 menos ese intervalo
    expect(gapPaceSKm(r)).toBeCloseTo(240, 1);
  });

  it('no publica agregado si los huecos se comen la sesión', () => {
    const streams = buildStreams([{ m: 2000, pace: 240 }], { grade: true });
    const t = streams.time.data;
    // Un intervalo de cada dos dura 60 s: la mitad de la distancia se descarta.
    for (let k = 1; k < t.length; k++) t[k] = t[k - 1] + (k % 2 ? 60 : 2.4);
    const r = computeStreamGap(streams);
    expect(r.distance_m).toBeUndefined();
    expect(r.coverage_pct).toBeLessThan(80);
    expect(hasStreamGap(r)).toBe(false);
  });

  it('funciona sin grade_smooth, derivando la pendiente de la altitud', () => {
    const r = computeStreamGap(buildStreams([{ m: 2000, pace: 300, elev: 100 }]));
    expect(r.grade_source).toBe('altitude');
    expect(gapPaceSKm(r)).toBeCloseTo(300 / gapFactor(0.05), 0);
  });

  it('reparte los kilómetros por distancia y publica el último incompleto', () => {
    const r = computeStreamGap(buildStreams([{ m: 2400, pace: 240 }], { grade: true }));
    expect(r.per_km.map((k) => k.distance_m)).toEqual([1000, 1000, 400]);
    expect(r.per_km[2].gap_speed_ms).toBeCloseTo(1000 / 240, 2);
  });

  it('devuelve siempre el objeto versionado aunque no haya streams', () => {
    expect(computeStreamGap(null)).toEqual({ _v: STREAM_GAP_VERSION });
    expect(computeStreamGap({ distance: { data: [0, 10] } })).toEqual({ _v: STREAM_GAP_VERSION });
    expect(hasStreamGap(computeStreamGap(null))).toBe(false);
  });
});

describe('needsStreamGap', () => {
  it('recalcula lo que no existe o quedó en una versión anterior', () => {
    expect(needsStreamGap({})).toBe(true);
    expect(needsStreamGap({ stream_gap: {} })).toBe(true);
    expect(needsStreamGap({ stream_gap: { _v: STREAM_GAP_VERSION - 1 } })).toBe(true);
    expect(needsStreamGap({ stream_gap: { _v: STREAM_GAP_VERSION } })).toBe(false);
  });
});

describe('activityGapSpeed', () => {
  const medida = computeStreamGap(buildStreams([{ m: 2000, pace: 300, elev: 100 }], { grade: true }));

  it('usa la medida por streams cuando está cacheada', () => {
    const v = activityGapSpeed({ distance: 2000, moving_time: 600, total_elevation_gain: 100, stream_gap: medida });
    expect(v).toBeCloseTo(medida.distance_m / medida.gap_time_s, 6);
  });

  it('cae a la hipótesis de perfil ondulado sin streams', () => {
    const a = { distance: 2000, moving_time: 600, total_elevation_gain: 100 };
    expect(activityGapSpeed(a)).toBeCloseTo(gapSpeedFromGain(2000 / 600, 2000, 100), 6);
    // La hipótesis (sube la mitad, baja la mitad) y la subida sostenida real no
    // coinciden: por eso interesa la medida cuando existe.
    expect(activityGapSpeed(a)).not.toBeCloseTo(medida.distance_m / medida.gap_time_s, 2);
  });

  it('devuelve 0 cuando no hay con qué calcular', () => {
    expect(activityGapSpeed(null)).toBe(0);
    expect(activityGapSpeed({ distance: 0, moving_time: 600 })).toBe(0);
  });
});
