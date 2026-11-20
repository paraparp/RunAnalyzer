import { describe, it, expect } from 'vitest';
import { compareRows, compareVerdict, formChange, formEvolution, sessionMatch, deltaTone, splitSeries, kmWinner, compareCandidates, compareToText } from './sessionCompare';

const act = (id, km, secPerKm, hr, extra = {}) => ({
  id, type: 'Run', name: `S${id}`, start_date: `2026-11-${String(id).padStart(2, '0')}T08:00:00Z`,
  distance: km * 1000, moving_time: km * secPerKm, average_heartrate: hr, total_elevation_gain: 20, ...extra,
});

describe('compareRows', () => {
  const a = act(1, 10, 300, 150);
  const b = act(2, 10, 285, 148);
  const rows = Object.fromEntries(compareRows(a, b).map((r) => [r.key, r]));

  it('compara el ritmo como velocidad: más rápido = delta positivo y bueno', () => {
    expect(rows.pace.delta).toBeGreaterThan(0);
    expect(deltaTone(rows.pace)).toBe('good');
    expect(rows.pace.aLabel).toBe('5:00');
  });

  it('FC media más baja es mejor', () => {
    expect(rows.avg_hr.delta).toBe(-2);
    expect(deltaTone(rows.avg_hr)).toBe('good');
  });

  it('las métricas sin dirección son neutras', () => {
    expect(deltaTone(rows.distance)).toBe('neutral');
  });

  it('un dato que falta no rompe la fila', () => {
    const r = compareRows(act(1, 10, 300, null), b).find((x) => x.key === 'avg_hr');
    expect(r.a).toBeNull();
    expect(r.aLabel).toBe('—');
    expect(r.delta).toBeNull();
  });
});

describe('compareVerdict', () => {
  it('B más rápido con menos FC: mejor, por eficiencia', () => {
    const v = compareVerdict(compareRows(act(1, 10, 300, 150), act(2, 10, 285, 148)));
    expect(v.outcome).toBe('better');
    expect(v.basis).toBe('efficiency');
    expect(v.facts.map((f) => f.key)).toEqual(['faster', 'lower_hr']);
  });
  it('más rápido pero mucho más pulso: peor', () => {
    const v = compareVerdict(compareRows(act(1, 10, 300, 140), act(2, 10, 294, 155)));
    expect(v.outcome).toBe('worse');
  });
  it('sin FC decide el ritmo', () => {
    const v = compareVerdict(compareRows(act(1, 10, 300, null), act(2, 10, 280, null)));
    expect(v).toMatchObject({ outcome: 'better', basis: 'pace' });
  });
});

describe('sessionMatch', () => {
  it('idénticas: 100 %', () => {
    expect(sessionMatch(act(1, 10, 300, 150), act(2, 10, 300, 150)).pct).toBe(100);
  });
  it('baja con la distancia y el ritmo', () => {
    const m = sessionMatch(act(1, 10, 300, 150), act(2, 12, 330, 150));
    expect(m.parts.distance).toBe(44); // 2/12 = 16,7 % de 30 %
    expect(m.parts.pace).toBeLessThan(50);
    expect(m.pct).toBeGreaterThan(40);
    expect(m.pct).toBeLessThan(70);
  });
  it('muy distintas: solo puntúa el desnivel por km', () => {
    // 20 m en 5 km (4 m/km) frente a 20 m en 21 km (~1 m/km): desnivel al 80 %.
    expect(sessionMatch(act(1, 5, 240, 150), act(2, 21, 330, 150)).pct).toBe(16);
  });
});

describe('formChange', () => {
  it('más rápido al mismo pulso: mejor forma, confianza alta', () => {
    const f = formChange(act(1, 10, 300, 150), act(2, 10, 285, 150));
    expect(f.pct).toBeCloseTo(5.3, 1);
    expect(f.confidence).toBe('high');
    expect(f.netHr).toBe(false);
  });
  it('con reposo usa la FC neta, que amplifica la diferencia real', () => {
    const plain = formChange(act(1, 10, 300, 150), act(2, 10, 300, 145));
    const net = formChange(act(1, 10, 300, 150), act(2, 10, 300, 145), { hrrest: 50 });
    expect(net.netHr).toBe(true);
    expect(net.pct).toBeGreaterThan(plain.pct);
  });
  it('distancias e intensidades muy distintas bajan la confianza', () => {
    const f = formChange(act(1, 5, 270, 165), act(2, 20, 330, 140));
    expect(f.reasons).toEqual(expect.arrayContaining(['distance', 'intensity']));
    expect(f.confidence).toBe('low');
  });
  it('sin pulso: null', () => {
    expect(formChange(act(1, 10, 300, null), act(2, 10, 300, 150))).toBeNull();
  });
});

describe('deltaTone', () => {
  it('por debajo de 0,5 % es ruido', () => {
    expect(deltaTone({ delta: 0.1, deltaPct: 0.2, better: 'up' })).toBe('neutral');
  });
});

describe('splitSeries', () => {
  it('alinea km a km y descarta los parciales cortos', () => {
    const s = (n, t) => Array.from({ length: n }, () => ({ distance: 1000, moving_time: t, average_heartrate: 150 }));
    const a = { splits_metric: [...s(3, 300), { distance: 200, moving_time: 60 }] };
    const b = { splits_metric: s(4, 290) };
    const series = splitSeries(a, b);
    expect(series).toHaveLength(4);
    expect(series[0]).toMatchObject({ km: 1, paceA: 300, paceB: 290 });
    expect(series[3].paceA).toBeNull();
  });
});

describe('kmWinner', () => {
  const p = { hrA: 150, hrB: 145, effA: 1.30, effB: 1.40, paceA: 300, paceB: 310 };
  it('pulso: menos gana', () => expect(kmWinner(p, 'hr')).toBe('B'));
  it('eficiencia: más gana', () => expect(kmWinner(p, 'eff')).toBe('B'));
  it('ritmo: menos s/km gana', () => expect(kmWinner(p, 'pace')).toBe('A'));
  it('empate o sin dato: null', () => {
    expect(kmWinner({ hrA: 150, hrB: 150.5 }, 'hr')).toBeNull();
    expect(kmWinner({ hrA: null, hrB: 150 }, 'hr')).toBeNull();
  });
});

describe('compareCandidates', () => {
  const now = Date.parse('2026-11-30T00:00:00Z');
  it('≥70 % de coincidencia, de la más parecida a la menos, sin la propia', () => {
    const ref = act(10, 10, 300, 150);
    const all = [ref, act(1, 10.5, 305, 150), act(2, 5, 300, 150), act(3, 9.5, 320, 140), act(4, 10, 300, 150)];
    const list = compareCandidates(ref, all, { now });
    expect(list.map((c) => c.activity.id)).toEqual([4, 1, 3]);
    expect(list[0].match.pct).toBe(100);
    expect(list.every((c) => c.match.pct >= 70)).toBe(true);
  });
  it('solo los últimos 6 meses', () => {
    const ref = act(10, 10, 300, 150);
    const old = { ...act(1, 10, 300, 150), start_date: '2026-03-01T08:00:00Z' };
    expect(compareCandidates(ref, [ref, old], { now })).toEqual([]);
  });
});

describe('formEvolution', () => {
  it('la referencia en 0 %, ordenadas por fecha y con tendencia', () => {
    const ref = act(15, 10, 300, 150);
    const older = [act(1, 10, 315, 150), act(5, 10, 310, 150), act(10, 10, 305, 150)];
    const { points, trend } = formEvolution(ref, older);
    expect(points.map((p) => p.id)).toEqual([1, 5, 10, 15]);
    expect(points.find((p) => p.isRef).pct).toBe(0);
    expect(points[0].pct).toBeLessThan(0); // más lenta al mismo pulso: peor forma
    expect(trend.perMonth).toBeGreaterThan(0); // mejora con el tiempo
  });
  it('sin tendencia con menos de 3 puntos', () => {
    expect(formEvolution(act(2, 10, 300, 150), [act(1, 10, 300, 150)]).trend).toBeNull();
  });
});

describe('compareToText', () => {
  it('etiqueta A y B', () => {
    const a = act(1, 10, 300, 150);
    const b = act(2, 10, 285, 148);
    const txt = compareToText(a, b, compareRows(a, b), { pace: 'Ritmo' });
    expect(txt).toMatch(/^A = S1/);
    expect(txt).toContain('Ritmo: A 5:00');
  });
});
