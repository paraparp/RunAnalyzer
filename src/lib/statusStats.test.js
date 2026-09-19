import { describe, it, expect } from 'vitest';
import { computeStats, computeGarminStats, isRun } from './statusStats';

// La matemática del estado del atleta no tenía tests: vivía dentro de un
// componente de 1256 líneas. Lo que se fija aquí es lo que se rompe al moverla y
// lo que depende de la ventana temporal, que ahora se inyecta.

const NOW = new Date('2026-09-13T10:00:00').getTime();
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const dateKey = (n) => {
  const d = new Date(NOW - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const run = (daysAgo, { km = 10, speed = 3, hr = null, elev = 0 } = {}) => ({
  id: `a${daysAgo}-${km}`,
  type: 'Run',
  start_date: day(daysAgo),
  distance: km * 1000,
  moving_time: Math.round((km * 1000) / speed),
  average_speed: speed,
  average_heartrate: hr,
  total_elevation_gain: elev,
  suffer_score: 40,
});

// El PMC llega resuelto de `useCalibratedPMC`: aquí se simula su forma.
const pmcFor = (activities, { ctl = 50, atl = 45, tsb = 5, acwr = 1.1, trend7 = 3, trend28 = 8 } = {}) => {
  const byDay = {};
  activities.forEach((a) => { (byDay[a.start_date.slice(0, 10)] ||= []).push(a); });
  const series = Array.from({ length: 120 }, (_, i) => {
    const k = dateKey(119 - i);
    return { date: k, ctl: 30 + i * 0.2, atl: 28 + i * 0.2, tsb: 2, load: 50, activities: byDay[k] ?? [] };
  });
  return { series, current: { ctl, atl, tsb, acwr, ctlTrend7: trend7, ctlTrend28: trend28 } };
};

describe('isRun', () => {
  it('acepta type y sport_type', () => {
    expect(isRun({ type: 'Run' })).toBe(true);
    expect(isRun({ sport_type: 'TrailRun' })).toBe(true);
    expect(isRun({ type: 'Ride' })).toBe(false);
  });
});

describe('computeStats', () => {
  it('sin actividades o sin PMC devuelve null', () => {
    expect(computeStats([], pmcFor([]), { now: NOW })).toBeNull();
    expect(computeStats([run(1)], null, { now: NOW })).toBeNull();
  });

  it('el volumen de 7 días solo cuenta lo que cae dentro de la ventana', () => {
    const acts = [run(1, { km: 10 }), run(6, { km: 8 }), run(9, { km: 20 })];
    const s = computeStats(acts, pmcFor(acts), { now: NOW });
    expect(s.last7daysKm).toBeCloseTo(18, 5);
  });

  it('la ventana se mueve con el `now` inyectado', () => {
    const acts = [run(9, { km: 20 })];
    const dentro = computeStats(acts, pmcFor(acts), { now: NOW + 0 });
    const fuera = computeStats(acts, pmcFor(acts), { now: NOW - 5 * 86400000 });
    expect(dentro.last7daysKm).toBe(0);          // hace 9 días: fuera de los 7
    expect(fuera.last7daysKm).toBeCloseTo(20, 5); // "ahora" 5 días antes: dentro
  });

  it('deriva CTL de hace 7 y 28 días de las tendencias del PMC', () => {
    const acts = [run(1)];
    const s = computeStats(acts, pmcFor(acts, { ctl: 50, trend7: 3, trend28: 8 }), { now: NOW });
    expect(s.ctl7ago).toBe(47);
    expect(s.ctl28ago).toBe(42);
  });

  it('los mejores esfuerzos respetan la tolerancia de distancia', () => {
    const acts = [
      run(2, { km: 10.2, speed: 3.5 }),   // cuenta como 10k
      run(3, { km: 11.0, speed: 4.0 }),   // demasiado largo: no es 10k
      run(4, { km: 5.1, speed: 3.8 }),    // cuenta como 5k
    ];
    const s = computeStats(acts, pmcFor(acts), { now: NOW });
    expect(s.bestPace10kRecent).toBe(3.5);
    expect(s.bestPace5kRecent).toBe(3.8);
  });

  it('la racha se corta en el primer día sin actividad', () => {
    const acts = [run(0), run(1), run(3)];
    const s = computeStats(acts, pmcFor(acts), { now: NOW });
    expect(s.streak).toBe(2);
    expect(s.activeLast7).toBe(3);
  });

  it('la eficiencia cardíaca ignora las sesiones cortas y las sin FC', () => {
    const conFC = [run(2, { km: 10, speed: 3, hr: 150 })];
    const sinFC = [run(2, { km: 10, speed: 3 })];
    const corta = [run(2, { km: 2, speed: 3, hr: 150 })];
    expect(computeStats(conFC, pmcFor(conFC), { now: NOW }).hrEffRecent).toBeCloseTo(150 / (3 * 3.6), 5);
    expect(computeStats(sinFC, pmcFor(sinFC), { now: NOW }).hrEffRecent).toBeNull();
    expect(computeStats(corta, pmcFor(corta), { now: NOW }).hrEffRecent).toBeNull();
  });

  it('el pico de CTL sale de la serie, no del valor actual', () => {
    const acts = [run(1)];
    const s = computeStats(acts, pmcFor(acts, { ctl: 40 }), { now: NOW });
    expect(s.peakCTL).toBeGreaterThan(40);   // la serie sube hasta ~53
    expect(s.currentCTL).toBe(40);
  });

  it('solo cuenta carreras: una salida en bici no suma kilómetros', () => {
    const ride = { ...run(1, { km: 60 }), type: 'Ride' };
    const acts = [run(1, { km: 10 }), ride];
    const s = computeStats(acts, pmcFor(acts), { now: NOW });
    expect(s.last7daysKm).toBeCloseTo(10, 5);
  });
});

describe('computeGarminStats', () => {
  const health = (n, extra) => ({ date: dateKey(n), ...extra });

  it('sin datos devuelve null', () => {
    expect(computeGarminStats([], { now: NOW })).toBeNull();
    expect(computeGarminStats(null, { now: NOW })).toBeNull();
  });

  it('el valor actual es el último con dato, no el último registro', () => {
    const rows = [
      health(3, { restingHR: 48, hrv: 70 }),
      health(1, { hrv: 72 }),                 // sin FC reposo
    ];
    const g = computeGarminStats(rows, { now: NOW });
    expect(g.currentRHR).toBe(48);
    expect(g.currentRec).toBe(72);
  });

  it('sin VFC cae a Body Battery como métrica de recuperación', () => {
    const rows = [health(2, { restingHR: 50, bbHigh: 85, bbLow: 20 })];
    const g = computeGarminStats(rows, { now: NOW });
    expect(g.currentRec).toBe(85);
    expect(g.currentBBLow).toBe(20);
  });

  it('las medias de 7 y 28 días son ventanas distintas', () => {
    const rows = [
      health(2, { restingHR: 44 }),
      health(20, { restingHR: 56 }),
    ];
    const g = computeGarminStats(rows, { now: NOW });
    expect(g.rhr7avg).toBe(44);
    expect(g.rhr28avg).toBe(50);
  });

  it('ignora los nulos en vez de contarlos como cero', () => {
    const rows = [
      health(1, { restingHR: 50 }),
      health(2, { restingHR: null }),
      health(3, { restingHR: 54 }),
    ];
    const g = computeGarminStats(rows, { now: NOW });
    expect(g.rhr7avg).toBe(52);
  });
});
