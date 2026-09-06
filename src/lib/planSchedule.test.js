// Tests de planSchedule: el plan de la IA da el día en texto y Garmin necesita una
// fecha. Lo que se fija aquí es que el nombre se resuelva bien (es/en, abreviado o
// con adornos) y que la fecha salga en local, no desplazada por la zona horaria.
import { describe, it, expect } from 'vitest';
import { weekdayIndex, nextDateForDay, toISODate } from './planSchedule';

describe('weekdayIndex', () => {
  it('reconoce los días en español, con y sin acento o abreviados', () => {
    expect(weekdayIndex('Lunes')).toBe(1);
    expect(weekdayIndex('Miércoles')).toBe(3);
    expect(weekdayIndex('miercoles')).toBe(3);
    expect(weekdayIndex('Mié.')).toBe(3);
    expect(weekdayIndex('Sa')).toBe(6);
    expect(weekdayIndex('Domingo')).toBe(0);
  });

  it('reconoce los días en inglés', () => {
    expect(weekdayIndex('Wednesday')).toBe(3);
    expect(weekdayIndex('Sun')).toBe(0);
  });

  it('ignora los adornos que a veces añade el modelo', () => {
    expect(weekdayIndex('Martes (series)')).toBe(2);
    expect(weekdayIndex('Jueves - Rodaje')).toBe(4);
  });

  it('devuelve null si no hay día reconocible', () => {
    expect(weekdayIndex('Semana 2')).toBeNull();
    expect(weekdayIndex('')).toBeNull();
    expect(weekdayIndex(null)).toBeNull();
  });
});

describe('nextDateForDay', () => {
  // 2026-09-09 es miércoles.
  const wed = new Date(2026, 8, 9, 10, 30);

  it('resuelve el mismo día cuando ya es hoy', () => {
    expect(nextDateForDay('Miércoles', wed)).toBe('2026-09-09');
  });

  it('avanza al próximo día de la semana con ese nombre', () => {
    expect(nextDateForDay('Sábado', wed)).toBe('2026-09-12');
    expect(nextDateForDay('Lunes', wed)).toBe('2026-09-14');   // ya pasó: el de la semana que viene
    expect(nextDateForDay('Domingo', wed)).toBe('2026-09-13');
  });

  it('cruza el cambio de mes', () => {
    expect(nextDateForDay('Jueves', new Date(2026, 8, 30))).toBe('2026-10-01');
  });

  it('sin día reconocible no inventa fecha', () => {
    expect(nextDateForDay('cuando pueda', wed)).toBeNull();
  });
});

describe('toISODate', () => {
  it('usa la fecha local, no UTC', () => {
    // 23:30 local: con toISOString() en zonas al este saldría el día siguiente.
    expect(toISODate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
