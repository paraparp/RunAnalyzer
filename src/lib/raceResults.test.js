import { describe, it, expect } from 'vitest';
import { findRaceActivity, buildRaceResult, raceResult } from './raceResults';

const act = (o) => ({ id: 1, type: 'Run', start_date_local: '2026-04-12T09:00:00Z', distance: 21350, moving_time: 5936, ...o });
const media = { id: 'r1', name: 'Vigbay 21k', date: '2026-04-12', distance: '21k', goalTimeMin: 100 };

describe('findRaceActivity', () => {
  it('empareja por fecha aunque el nombre no se parezca', () => {
    const a = act({ name: 'Afternoon Run' });
    expect(findRaceActivity(media, [a])).toBe(a);
  });

  it('ignora actividades de otros días', () => {
    expect(findRaceActivity(media, [act({ start_date_local: '2026-04-11T09:00:00Z' })])).toBe(null);
  });

  it('descarta el rodaje suelto del mismo día y se queda con la carrera', () => {
    const trote = act({ id: 2, distance: 6000, moving_time: 2100 });
    const carrera = act({ id: 3 });
    expect(findRaceActivity(media, [trote, carrera]).id).toBe(3);
  });

  it('con varias candidatas elige la más cercana a la distancia oficial', () => {
    const larga = act({ id: 4, distance: 25000 });
    const justa = act({ id: 5, distance: 21100 });
    expect(findRaceActivity(media, [larga, justa]).id).toBe(5);
  });

  it('no empareja actividades que no son carrera a pie', () => {
    expect(findRaceActivity(media, [act({ type: 'Ride' })])).toBe(null);
  });

  it('sin fecha en la carrera no hay emparejamiento', () => {
    expect(findRaceActivity({ ...media, date: '' }, [act({})])).toBe(null);
  });
});

describe('buildRaceResult', () => {
  it('calcula tiempo, ritmo y diferencia contra el objetivo', () => {
    const r = buildRaceResult(media, act({ moving_time: 5936, distance: 21350 })); // 1:38:56
    expect(Math.round(r.time_min * 100) / 100).toBe(98.93);
    expect(r.delta_min).toBeCloseTo(-1.07, 2);   // negativo = objetivo cumplido
    expect(r.achieved).toBe(true);
    expect(Math.round(r.pace_min_km * 100) / 100).toBe(4.63);
  });

  it('marca objetivo no cumplido', () => {
    const r = buildRaceResult(media, act({ moving_time: 6300 })); // 1:45:00
    expect(r.achieved).toBe(false);
    expect(r.delta_min).toBeGreaterThan(0);
  });

  it('avisa de que se corrió más de la distancia oficial', () => {
    const r = buildRaceResult(media, act({ distance: 21350 }));
    expect(r.distance_delta_m).toBe(21350 - 21098);
  });

  it('sin tiempo objetivo devuelve el resultado sin veredicto', () => {
    const r = buildRaceResult({ ...media, goalTimeMin: null }, act({}));
    expect(r.achieved).toBe(null);
    expect(r.delta_min).toBe(null);
  });

  it('sin actividad no hay resultado', () => {
    expect(buildRaceResult(media, null)).toBe(null);
    expect(raceResult(media, [])).toBe(null);
  });
});
