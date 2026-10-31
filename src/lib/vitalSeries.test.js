import { describe, it, expect } from 'vitest';
import { buildVitalMetrics } from './vitalSeries';

const DAY = 86400000;
const NOW = new Date(2026, 9, 10, 12).getTime();
const iso = (daysAgo) => {
  const d = new Date(NOW - daysAgo * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// 60 días de PMC: una sesión de 70 TSS cada 3 días, CTL subiendo 0,1/día.
const pmc = Array.from({ length: 61 }, (_, i) => {
  const daysAgo = 60 - i;
  return { date: iso(daysAgo), load: daysAgo % 3 ? 0 : 70, ctl: 30 + i / 10, atl: 40, tsb: -10 + i / 10 };
});
const metric = (r, key) => r.metrics.find((m) => m.key === key);

describe('buildVitalMetrics · carga', () => {
  const r = buildVitalMetrics({ pmc, days: 30, gran: 'day', nowMs: NOW });

  it('CTL/ATL/TSB se pintan tal cual, sin puntos diarios', () => {
    const ctl = metric(r, 'ctl');
    expect(ctl.data.at(-1)).toMatchObject({ smooth: 36, raw: null });
    expect(ctl.data.every((d) => d.raw == null)).toBe(true);
    expect(metric(r, 'tsb').data.at(-1).smooth).toBe(-4);
  });

  it('la carga diaria es la media de 7 días contando los descansos', () => {
    const load = metric(r, 'load');
    // Últimos 8 días (ventana [hoy-7, hoy]): sesiones a 0, 3 y 6 días → 3 × 70 / 8.
    expect(load.data.at(-1).smooth).toBe(Math.round((3 * 70) / 8));
    expect(load.data.at(-1).raw).toBe(70);
  });

  it('el histórico cubre la serie completa, no solo el período', () => {
    expect(metric(r, 'ctl').history.min.v).toBe(30);
    expect(metric(r, 'ctl').data[0].smooth).toBeGreaterThan(30);
  });

  it('sin PMC, las métricas de carga salen vacías', () => {
    const empty = buildVitalMetrics({ days: 30, gran: 'day', nowMs: NOW });
    expect(metric(empty, 'ctl').data).toEqual([]);
    expect(metric(empty, 'ctl').history).toBeNull();
  });
});

describe('estrés y respiración', () => {
  it('salen de las filas diarias de Garmin', () => {
    const garmin = [{ date: iso(2), avgStress: 34, respiration: 19.2 }];
    const r = buildVitalMetrics({ garmin, days: 30, gran: 'day', nowMs: NOW });
    expect(metric(r, 'stress').data.find((d) => d.raw != null).raw).toBe(34);
    expect(metric(r, 'respiration').data.find((d) => d.raw != null).raw).toBe(19.2);
  });
});

describe('sueño y huecos', () => {
  it('prefiere las noches a la media semanal y no duplica esa semana', () => {
    const garmin = [{ date: iso(2), sleepScore: 55, sleepMin: 400, sleepAvgHR: 52 }];
    const sleep = [{ weekStart: iso(4), score: 80, durationMin: 450 }]; // misma semana o la anterior
    const r = buildVitalMetrics({ garmin, sleep, days: 30, gran: 'day', nowMs: NOW });
    const raws = metric(r, 'sleep').data.filter((d) => d.raw != null).map((d) => d.raw);
    expect(raws).toContain(55);
    expect(metric(r, 'sleepHR').data.find((d) => d.raw != null).raw).toBe(52);
  });

  it('no dibuja línea a través de un hueco de meses', () => {
    const garmin = [{ date: iso(200), hrv: 40 }, { date: iso(1), hrv: 50 }];
    const r = buildVitalMetrics({ garmin, days: 365, gran: 'day', nowMs: NOW });
    const mid = metric(r, 'hrv').data.find((d) => d.ms === new Date(iso(100) + 'T00:00:00').getTime());
    expect(mid.line).toBeNull();
  });

  it('une dos datos cercanos aunque la media tenga hueco', () => {
    const sleep = [{ weekStart: iso(20), score: 70 }, { weekStart: iso(13), score: 80 }];
    const r = buildVitalMetrics({ sleep, days: 30, gran: 'day', nowMs: NOW });
    const between = metric(r, 'sleep').data.filter((d) => d.smooth == null && d.line != null);
    expect(between.length).toBeGreaterThan(0);
    between.forEach((d) => { expect(d.line).toBeGreaterThan(70); expect(d.line).toBeLessThan(80); });
  });
});
