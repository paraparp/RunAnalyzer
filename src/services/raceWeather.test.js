import { describe, it, expect } from 'vitest';
import { averageHours } from './raceWeather';

describe('averageHours', () => {
  const hourly = {
    time: ['2026-10-10T08:00', '2026-10-10T09:00', '2026-10-10T10:00', '2026-10-10T11:00', '2026-10-11T09:00'],
    temperature_2m: [10, 12, 14, 16, 30],
    relative_humidity_2m: [80, 70, 60, 50, 10],
  };
  it('promedia solo las horas de carrera de las fechas pedidas', () => {
    expect(averageHours(hourly, ['2026-10-10'], 9, 2)).toEqual({ temp_c: 13, humidity_pct: 65, samples: 2 });
  });
  it('null sin datos', () => {
    expect(averageHours(hourly, ['2026-12-01'], 9, 2)).toBeNull();
  });
});
