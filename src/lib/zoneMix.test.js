import { describe, it, expect } from 'vitest';
import { zoneMix, hrSegments, hasSegmentHR, polarizedGroups, polarizationStatus } from './zoneMix';
import { karvonenBounds } from './hrZones';

// El reparto por zonas pasó a ser compartido (Zonas y la portada de Hoy). Estos
// tests fijan lo que ese contrato promete: resolución de parcial, ventana
// temporal con "ahora" inyectable, la agrupación polarizada de las 5 zonas de
// Karvonen y su veredicto.

// hrmax 190, hrrest 50 → HRR 140 → cortes 134 / 148 / 162 / 176
const bounds = karvonenBounds({ hrmax: 190, hrrest: 50 });

const NOW = new Date('2026-09-19T10:00:00Z').getTime();
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const withSplits = (n, splits) => ({
  id: `s${n}`,
  start_date: daysAgo(n),
  average_heartrate: 150,
  moving_time: splits.reduce((s, x) => s + x.moving_time, 0),
  splits_metric: splits,
});

const avgOnly = (n, hr, sec) => ({
  id: `a${n}`, start_date: daysAgo(n), average_heartrate: hr, moving_time: sec,
});

describe('hrSegments', () => {
  it('prefiere los parciales a la media de la sesión', () => {
    const a = withSplits(1, [
      { average_heartrate: 140, moving_time: 300 },
      { average_heartrate: 165, moving_time: 300 },
    ]);
    expect(hrSegments(a)).toEqual([{ hr: 140, time: 300 }, { hr: 165, time: 300 }]);
    expect(hasSegmentHR(a)).toBe(true);
  });

  it('cae a la media solo cuando no hay FC por segmento', () => {
    const a = avgOnly(1, 150, 3600);
    expect(hrSegments(a)).toEqual([{ hr: 150, time: 3600 }]);
    expect(hasSegmentHR(a)).toBe(false);
  });
});

describe('zoneMix', () => {
  it('reparte el tiempo parcial a parcial, no por la FC media', () => {
    // Media 150 ppm → clasificada entera caería en Z3. Los parciales dicen que
    // fue mitad Z2 y mitad Z4, que es lo que de verdad pasó.
    const mix = zoneMix([withSplits(2, [
      { average_heartrate: 140, moving_time: 1800 },
      { average_heartrate: 170, moving_time: 1800 },
    ])], bounds, { now: NOW });

    expect(mix.times).toEqual([0, 1800, 0, 1800, 0]);
    expect(mix.pct).toEqual([0, 50, 0, 50, 0]);
    expect(mix.totalSec).toBe(3600);
    expect(mix.sessions).toBe(1);
    expect(mix.avgOnlySessions).toBe(0);
  });

  it('cuenta aparte las sesiones que solo aportan su media', () => {
    const mix = zoneMix(
      [
        avgOnly(1, 140, 1800),
        withSplits(1, [{ average_heartrate: 180, moving_time: 900 }, { average_heartrate: 170, moving_time: 900 }]),
      ],
      bounds, { now: NOW },
    );
    expect(mix.sessions).toBe(2);
    expect(mix.avgOnlySessions).toBe(1);
  });

  it('respeta la ventana de días con el "ahora" inyectado', () => {
    const list = [avgOnly(3, 140, 1800), avgOnly(40, 180, 1800)];
    const window28 = zoneMix(list, bounds, { days: 28, now: NOW });
    expect(window28.sessions).toBe(1);
    expect(window28.times[4]).toBe(0);

    // Mover el "ahora" atrás mete la sesión vieja y saca la reciente.
    const shifted = zoneMix(list, bounds, { days: 28, now: NOW - 20 * 86400000 });
    expect(shifted.sessions).toBe(1);
    expect(shifted.times[4]).toBe(1800);

    // Sin ventana entran las dos.
    expect(zoneMix(list, bounds, { now: NOW }).sessions).toBe(2);
  });

  it('sin FC devuelve un reparto vacío en vez de dividir por cero', () => {
    const mix = zoneMix([{ id: 'x', start_date: daysAgo(1), moving_time: 1800 }], bounds, { now: NOW });
    expect(mix.hasData).toBe(false);
    expect(mix.totalSec).toBe(0);
    expect(mix.pct).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('polarizedGroups', () => {
  it('agrupa Z1+Z2 como fácil, Z3 como gris y Z4+Z5 como duro', () => {
    expect(polarizedGroups([54, 28, 8, 7, 3])).toEqual({ low: 82, mod: 8, high: 10 });
  });

  it('tolera un reparto incompleto sin devolver NaN', () => {
    expect(polarizedGroups([100])).toEqual({ low: 100, mod: 0, high: 0 });
    expect(polarizedGroups()).toEqual({ low: 0, mod: 0, high: 0 });
  });
});

describe('polarizationStatus', () => {
  it('cumple el 80/20 con volumen fácil alto y poca zona gris', () => {
    expect(polarizationStatus(82, 8, 10)).toBe('ok');
    expect(polarizationStatus(70, 15, 15)).toBe('ok'); // justo en la tolerancia
  });

  it('marca zona gris cuando Z3 se dispara', () => {
    expect(polarizationStatus(55, 30, 15)).toBe('gray');
  });

  it('avisa de falta de calidad cuando lo duro no llega ni a la mitad del objetivo', () => {
    expect(polarizationStatus(65, 30, 5)).toBe('gray'); // la zona gris manda
    expect(polarizationStatus(65, 18, 5)).toBe('low');
  });

  it('el resto es reparto mixto', () => {
    expect(polarizationStatus(60, 18, 22)).toBe('mod');
  });
});
