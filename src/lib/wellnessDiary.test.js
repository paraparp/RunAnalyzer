import { describe, it, expect } from 'vitest';
import {
  normalizeEntry, saveEntry, readDiary, painSignals, sessionRpeLoads, subjectiveRisk,
  diaryRecommendations, painLabel,
} from './wellnessDiary';

const memStorage = () => {
  const mem = {};
  return { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
};
const day = (date, pains = [], extra = {}) => ({ date, pains, ...extra });
const knee = (level) => ({ zone: 'knee', side: 'R', level });

describe('normalizeEntry', () => {
  it('acota niveles, quita dolores a 0 y zonas desconocidas', () => {
    const e = normalizeEntry({
      date: '2026-10-07',
      pains: [knee(12), { zone: 'knee', side: 'L', level: 0 }, { zone: 'nariz', side: 'C', level: 5 }],
      rpe: 14, mood: 0,
    });
    expect(e.pains).toEqual([{ zone: 'knee', side: 'R', level: 10 }]);
    expect(e.rpe).toBe(10);
    expect(e.mood).toBe(1);
  });

  it('la lumbar no tiene lado', () => {
    expect(normalizeEntry({ date: 'x', pains: [{ zone: 'lower_back', side: 'L', level: 4 }] }).pains[0].side).toBe('C');
  });
});

describe('saveEntry', () => {
  it('sustituye la entrada del mismo día y borra las vacías', () => {
    const st = memStorage();
    saveEntry(st, day('2026-10-06', [knee(3)]));
    saveEntry(st, day('2026-10-07', [knee(4)]));
    saveEntry(st, day('2026-10-07', [knee(5)]));
    expect(readDiary(st).map((e) => e.pains[0].level)).toEqual([3, 5]);
    saveEntry(st, day('2026-10-06'));
    expect(readDiary(st)).toHaveLength(1);
  });
});

describe('painSignals', () => {
  it('alerta con dolor fuerte reciente', () => {
    const s = painSignals([day('2026-10-06', [knee(7)])], '2026-10-07');
    expect(s[0]).toMatchObject({ signal: 'alert', max: 7, label: 'Rodilla dcha.' });
  });

  it('alerta por molestia persistente', () => {
    const entries = ['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-07'].map((d) => day(d, [knee(3)]));
    expect(painSignals(entries, '2026-10-07')[0].signal).toBe('alert');
  });

  it('alerta si va a más', () => {
    const entries = [day('2026-10-03', [knee(1)]), day('2026-10-06', [knee(4)]), day('2026-10-07', [knee(5)])];
    const s = painSignals(entries, '2026-10-07')[0];
    expect(s.trend).toBeGreaterThanOrEqual(2);
    expect(s.signal).toBe('alert');
  });

  it('vigilar con dos días de molestia leve; ignora lo de hace más de una semana', () => {
    const entries = [day('2026-09-20', [knee(9)]), day('2026-10-02', [knee(3)]), day('2026-10-03', [knee(3)])];
    expect(painSignals(entries, '2026-10-07')[0].signal).toBe('watch');
  });
});

describe('sessionRpeLoads', () => {
  it('RPE × minutos del día (Foster)', () => {
    const loads = sessionRpeLoads(
      [day('2026-10-07', [], { rpe: 6 }), day('2026-10-06', [], { rpe: 3 })],
      [{ start_date_local: '2026-10-07T08:00:00Z', moving_time: 3000 }],
    );
    expect(loads).toEqual({ '2026-10-07': { rpe: 6, minutes: 50, load: 300 } });
  });
});

describe('subjectiveRisk', () => {
  it('null sin anotaciones en la última semana', () => {
    expect(subjectiveRisk([day('2026-09-01', [knee(8)])], '2026-10-07')).toBeNull();
  });

  it('alto con alerta de dolor; sube con ánimo bajo y estrés alto', () => {
    const base = subjectiveRisk([day('2026-10-07', [knee(7)])], '2026-10-07');
    const worse = subjectiveRisk([day('2026-10-07', [knee(7)], { mood: 1, stress: 5 })], '2026-10-07');
    expect(base.score).toBeGreaterThan(55);
    expect(worse.score).toBeGreaterThan(base.score);
  });

  it('bajo si todo está bien', () => {
    expect(subjectiveRisk([day('2026-10-07', [], { mood: 4, stress: 2 })], '2026-10-07').score).toBe(0);
  });
});

describe('diaryRecommendations', () => {
  it('nombra la zona y el motivo', () => {
    const recs = diaryRecommendations(subjectiveRisk([day('2026-10-07', [knee(7)], { stress: 5 })], '2026-10-07'));
    expect(recs[0]).toMatch(/^Rodilla dcha\.: dolor ≥ 6/);
    expect(recs.some((r) => /Estrés alto/.test(r))).toBe(true);
  });
  it('painLabel sin lado en zonas centrales', () => {
    expect(painLabel({ zone: 'lower_back', side: 'C' })).toBe('Lumbar');
  });
});
