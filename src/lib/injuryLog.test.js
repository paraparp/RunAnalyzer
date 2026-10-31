import { describe, it, expect } from 'vitest';
import {
  readInjuries, normalizeInjury, saveInjury, deleteInjury, injuryLabel, injuryDays,
  injuryStats, injuryTimeline,
} from './injuryLog';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const knee = { zone: 'knee', side: 'L', start_date: '2026-10-18' };

describe('normalizeInjury', () => {
  it('exige inicio y zona o nombre', () => {
    expect(() => normalizeInjury({ zone: 'knee' })).toThrow(/inicio/);
    expect(() => normalizeInjury({ start_date: '2026-10-18' })).toThrow(/zona o el nombre/);
    expect(() => normalizeInjury({ ...knee, zone: 'nariz' })).toThrow(/Zona desconocida/);
  });

  it('rechaza un fin anterior al inicio', () => {
    expect(() => normalizeInjury({ ...knee, end_date: '2026-10-01' })).toThrow(/anterior/);
  });

  it('permite lado desconocido, y la lumbar no tiene lado', () => {
    expect(normalizeInjury({ ...knee, side: undefined }).side).toBeNull();
    expect(normalizeInjury({ zone: 'lower_back', side: 'L', start_date: '2026-10-18' }).side).toBe('C');
  });
});

describe('saveInjury', () => {
  it('cerrar una lesión conserva su inicio', () => {
    const st = memStorage();
    const { injury } = saveInjury(st, knee);
    saveInjury(st, { ...injury, end_date: '2026-10-25' });
    const list = readInjuries(st);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ start_date: '2026-10-18', end_date: '2026-10-25' });
  });

  it('una recaída es otro episodio y el anterior no se toca', () => {
    const st = memStorage();
    saveInjury(st, { ...knee, end_date: '2026-10-25' });
    saveInjury(st, { ...knee, start_date: '2026-11-02' });
    expect(readInjuries(st).map((i) => [i.start_date, i.end_date])).toEqual([
      ['2026-11-02', null], ['2026-10-18', '2026-10-25'],
    ]);
  });

  it('ordena las activas primero aunque sean más antiguas', () => {
    const st = memStorage();
    saveInjury(st, { ...knee, start_date: '2026-01-01' });
    saveInjury(st, { ...knee, start_date: '2026-10-01', end_date: '2026-10-02' });
    expect(readInjuries(st)[0].start_date).toBe('2026-01-01');
  });
});

describe('deleteInjury', () => {
  it('borra solo el episodio indicado', () => {
    const st = memStorage();
    const { injury } = saveInjury(st, knee);
    saveInjury(st, { ...knee, start_date: '2026-11-02' });
    expect(deleteInjury(st, injury.id).map((i) => i.start_date)).toEqual(['2026-11-02']);
  });
});

describe('injuryStats', () => {
  it('no cuenta dos veces los días en que se solapan dos lesiones', () => {
    const s = injuryStats([
      { id: 'a', zone: 'glute', side: 'L', start_date: '2026-10-11', end_date: '2026-10-26' },
      { id: 'b', zone: 'knee', side: 'L', start_date: '2026-10-18', end_date: '2026-10-26' },
    ], '2026-10-31');
    expect(s).toMatchObject({ total: 2, active: 0, daysInjured: 16, repeated: null });
  });

  it('señala la zona que repite y cuenta una activa hasta hoy', () => {
    const s = injuryStats([
      { id: 'a', zone: 'knee', side: 'L', start_date: '2026-01-01', end_date: '2026-01-02' },
      { id: 'b', zone: 'knee', side: 'L', start_date: '2026-10-30', end_date: null },
    ], '2026-10-31');
    expect(s).toMatchObject({ active: 1, daysInjured: 4, repeated: { label: 'Rodilla izq.', count: 2 } });
  });
});

describe('injuryTimeline', () => {
  it('sin lesiones no hay línea temporal', () => {
    expect(injuryTimeline([], '2026-10-31')).toBeNull();
  });

  it('alinea las recaídas de una zona en la misma fila, en orden', () => {
    const t = injuryTimeline([
      { id: 'b', zone: 'knee', side: 'L', start_date: '2026-10-01', end_date: null },
      { id: 'a', zone: 'knee', side: 'L', start_date: '2026-01-01', end_date: '2026-02-01' },
      { id: 'c', zone: 'calf', side: 'R', start_date: '2026-05-01', end_date: '2026-05-02' },
    ], '2026-10-31');
    expect(t.rows.map((r) => r.label)).toEqual(['Rodilla izq.', 'Gemelo / sóleo dcha.']);
    expect(t.rows[0].episodes.map((e) => e.id)).toEqual(['a', 'b']);
    expect(t.rows[0].episodes[0].left).toBe(0);
    const last = t.rows[0].episodes[1];
    expect(last.left + last.width).toBeCloseTo(100, 5); // una activa llega hasta hoy
  });

  it('una lesión corta no ocupa todo el eje, y las marcas son inicios de mes dentro del rango', () => {
    const t = injuryTimeline([{ id: 'a', zone: 'calf', side: 'L', start_date: '2026-10-28', end_date: '2026-10-31' }], '2026-10-31');
    expect(t.rows[0].episodes[0].width).toBeLessThan(10);
    expect(t.ticks.map((x) => x.iso)).toEqual(['2026-10-01']);
    expect(t.ticks.every((x) => x.left >= 0 && x.left < 100)).toBe(true);
  });

  it('en históricos largos espacia las marcas', () => {
    const t = injuryTimeline([{ id: 'a', zone: 'calf', start_date: '2022-03-15', end_date: '2022-03-20' }], '2026-10-31');
    expect(t.ticks.map((x) => x.iso)).toEqual(['2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01']);
  });
});

describe('lectura', () => {
  it('un almacén corrupto se lee como vacío', () => {
    expect(readInjuries({ getItem: () => '{roto' })).toEqual([]);
  });

  it('une diagnóstico y zona', () => {
    expect(injuryLabel({ title: 'Tendinopatía', zone: 'glute', side: 'L' })).toBe('Tendinopatía · Glúteo izq.');
    expect(injuryLabel({ title: 'Costilla', zone: null, side: null })).toBe('Costilla');
  });

  it('cuenta los días incluyendo inicio y fin, y una activa hasta hoy', () => {
    expect(injuryDays({ start_date: '2026-10-18', end_date: '2026-10-25' }, '2026-10-31')).toBe(8);
    expect(injuryDays({ start_date: '2026-10-18', end_date: null }, '2026-10-31')).toBe(14);
  });
});
