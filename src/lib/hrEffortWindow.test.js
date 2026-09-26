import { describe, it, expect } from 'vitest';
import { computeHrEffort, needsHrEffort, hasHrEffort, HR_EFFORT_VERSION } from './hrEffortWindow';

// Fabrica streams de un rodaje sintético a 1 Hz.
// `at(t)` devuelve { speed, hr, grade?, watts? } para cada segundo.
const makeStreams = (seconds, at) => {
  const time = [], distance = [], altitude = [], grade_smooth = [], heartrate = [], watts = [];
  let d = 0, alt = 100;
  for (let t = 0; t <= seconds; t++) {
    const s = at(t);
    time.push(t);
    distance.push(d);
    altitude.push(alt);
    grade_smooth.push((s.grade || 0) * 100);
    heartrate.push(s.hr);
    watts.push(s.watts ?? 0);
    d += s.speed;
    alt += s.speed * (s.grade || 0);
  }
  return {
    time: { data: time },
    distance: { data: distance },
    altitude: { data: altitude },
    grade_smooth: { data: grade_smooth },
    heartrate: { data: heartrate },
    watts: { data: watts },
  };
};

const steady = (seconds, { speed = 3.3, hr = 150, grade = 0, watts = 310 } = {}) =>
  makeStreams(seconds, () => ({ speed, hr, grade, watts }));

describe('computeHrEffort', () => {
  it('resume un rodaje llano y estable en bloques de 5 min', () => {
    const he = computeHrEffort(steady(1800));
    expect(he._v).toBe(HR_EFFORT_VERSION);
    expect(hasHrEffort(he)).toBe(true);
    expect(he.bins).toHaveLength(6);
    expect(he.bins[0].t0).toBe(0);
    expect(he.bins[0].hr).toBeCloseTo(150, 1);
    // En llano el GAP es la velocidad: gapFactor(0) = 1.
    expect(he.bins[0].gap).toBeCloseTo(3.3, 2);
    expect(he.bins[0].gap_cv).toBeCloseTo(0, 3);
    expect(he.has_power).toBe(true);
    expect(he.bins[0].w).toBeCloseTo(310, 1);
  });

  it('en subida el GAP va por encima de la velocidad real', () => {
    const flat = computeHrEffort(steady(900));
    const up = computeHrEffort(steady(900, { grade: 0.05 }));
    expect(up.bins[0].spd).toBeCloseTo(flat.bins[0].spd, 2);
    expect(up.bins[0].gap).toBeGreaterThan(flat.bins[0].gap * 1.05);
  });

  it('descarta la parada y los 120 s siguientes', () => {
    // Parada de 60 s en t=600: el hueco de tiempo rompe la continuidad.
    const streams = makeStreams(1500, (t) => ({
      speed: t >= 600 && t < 660 ? 0 : 3.3,
      hr: t >= 600 && t < 760 ? 120 : 150, // FC hundida durante y tras la parada
      watts: t >= 600 && t < 660 ? 0 : 310,
    }));
    const he = computeHrEffort(streams);
    const bin = he.bins.find((b) => b.t0 === 600);
    // El bloque de la parada pierde tiempo y lo que sobrevive NO arrastra la FC baja.
    expect(bin.drop_s).toBeGreaterThan(100);
    expect(bin.hr).toBeGreaterThan(145);
  });

  it('descarta el pico de ritmo y los 90 s posteriores', () => {
    const streams = makeStreams(1200, (t) => {
      const sprint = t >= 300 && t < 360;
      return {
        speed: sprint ? 5.5 : 3.3,
        hr: sprint || (t >= 360 && t < 450) ? 175 : 150,
        watts: sprint ? 480 : 310,
      };
    });
    const he = computeHrEffort(streams);
    const bin = he.bins.find((b) => b.t0 === 300);
    expect(bin.drop_s).toBeGreaterThan(50);
    expect(bin.hr).toBeCloseTo(150, 0); // la FC alta del pico y su arrastre quedan fuera
    expect(bin.gap).toBeCloseTo(3.3, 1);
  });

  it('un bloque con minuto y medio útil se publica; por debajo, no', () => {
    // 1000 s: tres bloques enteros y una cola de 100 s, que ya promedia bien.
    expect(computeHrEffort(steady(1000)).bins.map((b) => b.t0)).toEqual([0, 300, 600, 900]);
    // 960 s: la misma cola se queda en 60 s y no da para una media.
    expect(computeHrEffort(steady(960)).bins.map((b) => b.t0)).toEqual([0, 300, 600]);
  });

  it('sin FC devuelve el sello de versión y el motivo, para no volver a pedir los streams', () => {
    const streams = steady(900);
    delete streams.heartrate;
    const he = computeHrEffort(streams);
    expect(he).toEqual({ _v: HR_EFFORT_VERSION, reason: 'sin-fc' });
    expect(hasHrEffort(he)).toBe(false);
    expect(needsHrEffort({ hr_effort: he })).toBe(false); // cacheado: no se reintenta
  });

  it('sin potencia se calcula igual el eje GAP', () => {
    const streams = steady(900);
    streams.watts = { data: streams.watts.data.map(() => 0) };
    const he = computeHrEffort(streams);
    expect(he.has_power).toBe(false);
    expect(he.bins[0].w).toBeUndefined();
    expect(he.bins[0].gap).toBeCloseTo(3.3, 2);
  });

  it('el ruido de GPS no se confunde con picos (regresión del bug de producción)', () => {
    // Velocidad con ±25 % de jitter muestra a muestra, que es lo normal a 1 Hz.
    // Medido sobre la muestra cruda, CASI TODO superaba el umbral del 15 %, el
    // cegado de 90 s se encadenaba y la sesión entera salía 'sin-bloques-estables':
    // 27 de 30 sesiones reales se perdían así.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const noisy = makeStreams(3600, () => ({
      speed: 3.3 * (1 + (rnd() - 0.5) * 0.5),
      hr: 150,
      watts: 310 * (1 + (rnd() - 0.5) * 0.5),
    }));
    const he = computeHrEffort(noisy);
    expect(he.reason).toBeUndefined();
    expect(he.bins.length).toBeGreaterThanOrEqual(11);
    expect(he.bins.every((b) => b.drop_s === 0)).toBe(true);
    // Y el CV publicado mide el NIVEL, no el ruido: por debajo del 6 % con el que
    // la capa de agregación decide si la sesión es utilizable.
    expect(Math.max(...he.bins.map((b) => b.gap_cv))).toBeLessThan(0.06);
  });

  it('un surge de verdad sigue detectándose sobre el mismo ruido', () => {
    // Lo que el suavizado NO puede tragarse: 60 s un 40 % más rápido.
    let seed = 11;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const streams = makeStreams(1800, (t) => {
      const surge = t >= 600 && t < 660;
      return {
        speed: (surge ? 4.6 : 3.3) * (1 + (rnd() - 0.5) * 0.5),
        hr: surge || (t >= 660 && t < 750) ? 172 : 150,
        watts: surge ? 450 : 310,
      };
    });
    const he = computeHrEffort(streams);
    const bin = he.bins.find((b) => b.t0 === 600);
    expect(bin.drop_s).toBeGreaterThan(60);
    expect(bin.hr).toBeLessThan(155); // la FC arrastrada por el surge queda fuera
  });

  it('needsHrEffort detecta lo no calculado y lo de versión vieja', () => {
    expect(needsHrEffort({})).toBe(true);
    expect(needsHrEffort({ hr_effort: { _v: HR_EFFORT_VERSION - 1 } })).toBe(true);
    expect(needsHrEffort({ hr_effort: { _v: HR_EFFORT_VERSION } })).toBe(false);
  });
});
