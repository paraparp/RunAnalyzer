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
