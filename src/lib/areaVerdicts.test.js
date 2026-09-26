import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadVerdict, engineVerdict } from './areaVerdicts';
import { karvonenBounds } from './hrZones';

afterEach(() => vi.useRealTimers());

const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

describe('loadVerdict', () => {
  it('usa los cortes compartidos de fase, ACWR y rampa', () => {
    const v = byId(loadVerdict({ ctl: 50, tsb: -15, acwr: 1.6, ramp: 6.2, pctPeak: 90 }));
    expect(v.phase.key).toBe('area_verdict.load.form_loaded');
    expect(v.phase.tone).toBe('neutral');
    expect(v.acwr.key).toBe('area_verdict.load.acwr_danger');
    expect(v.ctl.key).toBe('area_verdict.load.ctl_up_fast');
    expect(v.ctl.tone).toBe('warn');
  });

  it('fase en forma, carga habitual y forma bajando', () => {
    const v = byId(loadVerdict({ ctl: 40, tsb: 8, acwr: 1.0, ramp: -1.2, pctPeak: 70 }));
    expect(v.phase.tone).toBe('good');
    expect(v.acwr.key).toBe('area_verdict.load.acwr_optimal');
    expect(v.ctl.key).toBe('area_verdict.load.ctl_down');
  });

  it('sin PMC no dice nada', () => {
    expect(loadVerdict(null)).toEqual([]);
  });
});

// Carrera de 10 km llana con parciales por km: FC en banda aeróbica.
const run = (id, date, { paceMin = 5, hr = 145, hr2 = hr } = {}) => {
  const splits = Array.from({ length: 10 }, (_, i) => ({
    split: i + 1, distance: 1000, moving_time: paceMin * 60,
    average_speed: 1000 / (paceMin * 60), average_heartrate: i < 5 ? hr : hr2, elevation_difference: 0,
  }));
  return {
    id, type: 'Run', start_date: `${date}T08:00:00Z`, start_date_local: `${date}T08:00:00Z`,
    distance: 10000, moving_time: paceMin * 600, average_speed: 1000 / (paceMin * 60),
    average_heartrate: (hr + hr2) / 2, total_elevation_gain: 0, splits_metric: splits,
  };
};

describe('engineVerdict', () => {
  it('detecta la mejora de eficiencia y la deriva mediana', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26));
    // Mismo pulso, cada vez más rápido: la eficiencia sube.
    const runs = Array.from({ length: 8 }, (_, i) =>
      run(i, `2026-0${3 + Math.floor(i / 2)}-1${i % 2}`, { paceMin: 5.4 - i * 0.08, hr: 145, hr2: 150 }));
    const v = byId(engineVerdict(runs, { months: 12, hrmax: 190 }));
    expect(v.efficiency.key).toBe('area_verdict.engine.ef_up');
    expect(v.efficiency.tone).toBe('good');
    expect(v.drift.params.level).toBe('good');
    expect(v.polarization).toBeUndefined(); // sin límites de zona no hay 80/20
  });

  it('reparto de intensidad con límites de zona', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26));
    const runs = [run(1, '2026-09-01', { hr: 130 }), run(2, '2026-09-05', { hr: 130 })];
    const v = byId(engineVerdict(runs, { months: 12, hrmax: 190, bounds: karvonenBounds({ hrmax: 190, hrrest: 50 }) }));
    expect(v.polarization.params.low).toBe(100);
    expect(v.polarization.tone).toBe('good');
  });

  it('con pocas sesiones calla en vez de inventar tendencia', () => {
    expect(byId(engineVerdict([run(1, '2026-09-01')], { months: 12, hrmax: 190 })).efficiency).toBeUndefined();
    expect(engineVerdict([], {})).toEqual([]);
  });
});
