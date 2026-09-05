import { describe, it, expect } from 'vitest';
import { isoWeek, isoWeekKey, weekStartDate, weekStartFromIso, weekStartKey } from './isoWeek';

describe('isoWeek', () => {
  it('la semana 1 es la que contiene el 4 de enero', () => {
    // 2026-01-01 es jueves -> cae en la W01 de 2026
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    // 2025-12-29 es lunes -> ya pertenece a la W01 de 2026
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
    // 2024-12-30 es lunes -> W01 de 2025
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01');
  });

  it('la clave va con la semana a dos dígitos, para que ordene como texto', () => {
    expect(isoWeekKey('2026-03-04')).toMatch(/^\d{4}-W\d{2}$/);
    const keys = ['2026-08-29', '2026-01-05', '2026-11-02'].map(isoWeekKey);
    expect([...keys].sort()).toEqual(['2026-W02', '2026-W35', '2026-W45']);
  });

  it('todos los días de una misma semana comparten clave', () => {
    // lunes 24 a domingo 30 de agosto de 2026
    const days = ['24', '25', '26', '27', '28', '29', '30'].map(d => `2026-08-${d}`);
    const keys = new Set(days.map(isoWeekKey));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('2026-W35');
  });
});

describe('weekStartDate', () => {
  it('devuelve el lunes a medianoche local', () => {
    const d = weekStartDate('2026-08-29'); // sábado
    expect(d.getDay()).toBe(1);            // lunes
    expect(d.getDate()).toBe(24);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });

  it('un lunes se devuelve a sí mismo', () => {
    const d = weekStartDate('2026-08-24');
    expect(d.getDate()).toBe(24);
  });

  it('un domingo retrocede a su lunes, no avanza al siguiente', () => {
    const d = weekStartDate('2026-08-30'); // domingo
    expect(d.getDate()).toBe(24);
  });
});

describe('weekStartKey', () => {
  it('fecha el lunes en hora LOCAL, sin el desfase de toISOString', () => {
    // toISOString() sobre la medianoche local de un huso al este de UTC devolvía
    // el domingo. La clave debe ser el lunes en cualquier huso.
    expect(weekStartKey('2026-08-29')).toBe('2026-08-24');
    expect(weekStartKey('2026-08-24')).toBe('2026-08-24');
  });

  it('rellena mes y día a dos dígitos', () => {
    expect(weekStartKey('2026-01-08')).toBe('2026-01-05');
  });
});

describe('weekStartFromIso', () => {
  it('es la inversa de isoWeek', () => {
    for (const day of ['2026-08-29', '2026-01-01', '2025-12-29', '2024-06-15']) {
      const { year, week } = isoWeek(day);
      expect(weekStartFromIso(year, week).getTime()).toBe(weekStartDate(day).getTime());
    }
  });
});

describe('claves de día "YYYY-MM-DD" (independencia del huso)', () => {
  // `new Date('2026-08-30')` es medianoche UTC: al oeste de Greenwich caía en el
  // día 29 y la actividad cambiaba de semana. Las claves de `dayKey`/
  // `activityDayKey` deben resolverse en LOCAL, igual que el Date equivalente.
  const days = ['2026-08-30', '2026-01-01', '2025-12-29', '2026-03-01'];

  it('coincide con el Date local del mismo día', () => {
    for (const day of days) {
      const [y, m, d] = day.split('-').map(Number);
      const local = new Date(y, m - 1, d, 23, 30);
      expect(isoWeekKey(day)).toBe(isoWeekKey(local));
      expect(weekStartKey(day)).toBe(weekStartKey(local));
      expect(isoWeek(day)).toEqual(isoWeek(local));
    }
  });

  it('un domingo por la noche pertenece a su propia semana', () => {
    // 2026-08-30 es domingo: cierra la semana que empieza el lunes 24.
    expect(weekStartKey('2026-08-30')).toBe('2026-08-24');
  });
});
