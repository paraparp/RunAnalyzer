import { describe, it, expect } from 'vitest';
import {
  PACE_PLACEHOLDER,
  formatDuration,
  formatDurationHm,
  formatMinutesHm,
  formatPaceFromMinPerKm,
  formatPaceFromSecPerKm,
  formatPaceFromSpeed,
  paceMinPerKm,
} from './timeFormat';

describe('formatPaceFromMinPerKm', () => {
  it('formatea min/km como m:ss', () => {
    expect(formatPaceFromMinPerKm(5)).toBe('5:00');
    expect(formatPaceFromMinPerKm(4.5)).toBe('4:30');
    expect(formatPaceFromMinPerKm(6.25)).toBe('6:15');
  });

  it('arrastra el acarreo cuando el redondeo llega a 60 s', () => {
    // el bug clásico de estas copias: 4.999 -> "4:60"
    expect(formatPaceFromMinPerKm(4.999)).toBe('5:00');
    expect(formatPaceFromMinPerKm(3.9999)).toBe('4:00');
  });

  it('descarta ritmos fuera de la ventana plausible', () => {
    expect(formatPaceFromMinPerKm(1.5)).toBe(PACE_PLACEHOLDER);
    expect(formatPaceFromMinPerKm(45)).toBe(PACE_PLACEHOLDER);
  });

  it('acepta caminatas reales (antes se escondían con el corte en 15)', () => {
    expect(formatPaceFromMinPerKm(18)).toBe('18:00');
  });

  it('devuelve el marcador con entradas no utilizables', () => {
    for (const v of [null, undefined, NaN, Infinity, 0]) {
      expect(formatPaceFromMinPerKm(v)).toBe(PACE_PLACEHOLDER);
    }
  });

  it('admite un marcador propio', () => {
    expect(formatPaceFromMinPerKm(null, '—')).toBe('—');
    expect(formatPaceFromMinPerKm(null, null)).toBeNull();
  });
});

describe('formatPaceFromSecPerKm', () => {
  it('interpreta la entrada como segundos por km', () => {
    expect(formatPaceFromSecPerKm(300)).toBe('5:00');
    expect(formatPaceFromSecPerKm(272)).toBe('4:32');
  });

  it('redondea al segundo', () => {
    expect(formatPaceFromSecPerKm(299.6)).toBe('5:00');
  });
});

describe('paceMinPerKm / formatPaceFromSpeed', () => {
  it('convierte m/s a min/km', () => {
    expect(paceMinPerKm(1000 / 300)).toBeCloseTo(5, 9);
    expect(paceMinPerKm(4)).toBeCloseTo(4.1666667, 6);
  });

  it('mantiene el contrato numérico en crudo (alimenta más aritmética)', () => {
    expect(paceMinPerKm(0)).toBe(Infinity);
    expect(Number.isNaN(paceMinPerKm(undefined))).toBe(true);
  });

  it('formatea la velocidad ya con guardas', () => {
    expect(formatPaceFromSpeed(1000 / 300)).toBe('5:00');
    expect(formatPaceFromSpeed(0)).toBe(PACE_PLACEHOLDER);
    expect(formatPaceFromSpeed(null)).toBe(PACE_PLACEHOLDER);
    expect(formatPaceFromSpeed(undefined)).toBe(PACE_PLACEHOLDER);
    expect(formatPaceFromSpeed(0, null)).toBeNull();
  });

  it('las dos grafías antiguas dan ahora exactamente el mismo número', () => {
    // convivían 16.6667 / v y 1000 / (v * 60), que no coinciden
    const v = 3.21;
    expect(paceMinPerKm(v)).toBeCloseTo(1000 / (v * 60), 12);
  });
});

describe('formatDuration', () => {
  it('usa h:mm:ss sólo a partir de la hora', () => {
    expect(formatDuration(725)).toBe('12:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(36000)).toBe('10:00:00');
  });

  it('redondea segundos fraccionarios', () => {
    expect(formatDuration(59.6)).toBe('1:00');
  });

  it('devuelve el marcador sin dato', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
    expect(formatDuration(0)).toBe('0:00'); // cero es un dato, no un hueco
  });
});

describe('formatDurationHm / formatMinutesHm', () => {
  it('omite las horas cuando no llega a una', () => {
    expect(formatDurationHm(2700)).toBe('45m');
    expect(formatDurationHm(4800)).toBe('1h 20m');
  });

  it('formatMinutesHm toma MINUTOS, no segundos', () => {
    expect(formatMinutesHm(45)).toBe('45m');
    expect(formatMinutesHm(80)).toBe('1h 20m');
    expect(formatMinutesHm(null)).toBe('—');
  });
});
