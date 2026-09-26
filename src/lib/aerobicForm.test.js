import { describe, it, expect } from 'vitest';
import {
  hrAtFixedEffort, sessionWindow, periodOf, fitOls, paceFromSpeed,
} from './aerobicForm';
import { HR_EFFORT_VERSION } from './hrEffortWindow';

// Sesión sintética: bloques de 5 min desde t=0 hasta 55 min, todos al mismo
// esfuerzo y la misma FC (el ruido lo mete cada test si lo necesita).
const session = (date, { id = date, effort = 3.3, hr = 150, cv = 0.01, watts = null, wbgt = null, ...rest } = {}) => ({
  id,
  start_date: `${date}T07:00:00Z`,
  start_date_local: `${date}T09:00:00`,
  name: `run ${date}`,
  _hr: { hr_source: 'strap' },
  _wbgt: wbgt,
  hr_effort: {
    _v: HR_EFFORT_VERSION,
    has_power: watts != null,
    bins: Array.from({ length: 11 }, (_, i) => ({
      t0: i * 300,
      s: 300,
      drop_s: 0,
      hr,
      hr_cv: 0.01,
      gap: effort,
      gap_cv: cv,
      spd: effort,
      grade_abs: 0.01,
      ...(watts != null ? { w: watts, w_cv: cv } : {}),
    })),
  },
  ...rest,
});

// Cohorte con pendiente y efecto de periodo CONOCIDOS: FC = 150 + slope·(v − 3.3) + offset.
const SLOPE = 20; // bpm por m/s
const cohort = (month, offset, efforts) => efforts.map((v, i) => session(
  `2026-${month}-0${i + 1}`,
  { effort: v, hr: 150 + SLOPE * (v - 3.3) + offset },
));

describe('periodOf', () => {
  it('agrupa por mes', () => {
    expect(periodOf('2026-03-14').key).toBe('2026-03');
    expect(periodOf('2026-03-14').label).toBe('mar 2026');
  });
  it('agrupa por bimestres anclados a enero', () => {
    expect(periodOf('2026-03-14', 'block').key).toBe('2026-B03');
    expect(periodOf('2026-04-30', 'block').key).toBe('2026-B03');
    expect(periodOf('2026-05-01', 'block').key).toBe('2026-B05');
    expect(periodOf('2026-03-14', 'block').label).toBe('mar-abr 2026');
  });
});

describe('sessionWindow', () => {
  it('promedia solo los bloques que caben enteros en la ventana 15-45', () => {
    const w = sessionWindow(session('2026-03-01'), {});
    expect(w.ok).toBe(true);
    expect(w.bins).toBe(6);          // t0 = 900…2400
    expect(w.seconds).toBe(1800);
    expect(w.effort).toBeCloseTo(3.3, 3);
    expect(w.hr).toBeCloseTo(150, 3);
  });

  it('suma la variación ENTRE bloques, no solo la de dentro', () => {
    // Cada bloque es estable por dentro (cv 0.01) pero la sesión va acelerando:
    // un CV que solo promediara los de dentro la daría por estable.
    const a = session('2026-03-01');
    a.hr_effort.bins = a.hr_effort.bins.map((b, i) => ({ ...b, gap: 3.0 + i * 0.1 }));
    const w = sessionWindow(a, {});
    expect(w.effort_cv).toBeGreaterThan(0.04);
  });

  it('el eje de potencia se declara no utilizable si la sesión no la trae', () => {
    expect(sessionWindow(session('2026-03-01'), { axis: 'power' }))
      .toMatchObject({ ok: false, reason: 'sin-potencia' });
    expect(sessionWindow(session('2026-03-01', { watts: 310 }), { axis: 'power' }))
      .toMatchObject({ ok: true, effort: 310 });
  });

  it('una sesión corta no llega a la ventana mínima', () => {
    const a = session('2026-03-01');
    a.hr_effort.bins = a.hr_effort.bins.slice(0, 5); // termina en el minuto 25
    expect(sessionWindow(a, {})).toMatchObject({ ok: false, reason: 'ventana-corta' });
  });
});

describe('fitOls', () => {
  it('recupera los coeficientes de una recta exacta', () => {
    const X = [[1, 0], [1, 1], [1, 2], [1, 3]];
    const y = [10, 12, 14, 16];
    const f = fitOls(X, y);
    expect(f.beta[0]).toBeCloseTo(10, 6);
    expect(f.beta[1]).toBeCloseTo(2, 6);
    expect(f.r2).toBeCloseTo(1, 6);
  });
  it('devuelve null sin grados de libertad o con columnas colineales', () => {
    expect(fitOls([[1, 0], [1, 1]], [1, 2])).toBeNull();
    expect(fitOls([[1, 1], [1, 1], [1, 1], [1, 1]], [1, 2, 3, 4])).toBeNull();
  });
});

describe('hrAtFixedEffort', () => {
  const activities = [
    ...cohort('03', 0, [3.1, 3.3, 3.5, 3.2]),
    ...cohort('06', -4, [3.2, 3.4, 3.6, 3.3]),
    ...cohort('09', -9, [3.3, 3.5, 3.7, 3.4]),
  ];

  it('separa el efecto de periodo del esfuerzo al que se corrió cada día', () => {
    const r = hrAtFixedEffort(activities, { ref_effort: 3.3 });
    expect(r.n_sessions).toBe(12);
    expect(r.slope_bpm_per_unit).toBeCloseTo(SLOPE, 3);
    expect(r.slope_ok).toBe(true);
    expect(r.periods.map((p) => p.period)).toEqual(['2026-03', '2026-06', '2026-09']);
    expect(r.periods.map((p) => p.hr_at_ref)).toEqual([150, 146, 141]);
    expect(r.change_bpm).toBe(-9);
  });

  it('la FC media CRUDA no ve la mejora: es justo lo que corrige el modelo', () => {
    // Cada periodo corrió más rápido, así que la FC media apenas se mueve…
    const r = hrAtFixedEffort(activities, { ref_effort: 3.3 });
    const crude = r.periods.map((p) => p.hr_mean);
    const crudeDrop = crude[0] - crude[2];
    const modelDrop = r.periods[0].hr_at_ref - r.periods[2].hr_at_ref;
    expect(modelDrop).toBe(9);
    // La FC media cruda se queda a la mitad: la otra mitad de la mejora se la comió
    // haber corrido más rápido en septiembre.
    expect(crudeDrop).toBeLessThan(modelDrop * 0.7);
  });

  it('el esfuerzo de referencia por defecto es la mediana del atleta', () => {
    const r = hrAtFixedEffort(activities, {});
    expect(r.ref_effort).toBeCloseTo(3.35, 2);
    expect(r.ref_pace_per_km).toBe(paceFromSpeed(r.ref_effort));
    // Cambiar el punto de lectura mueve el nivel pero no la DIFERENCIA entre
    // periodos: el modelo es paralelo por construcción.
    const ref33 = hrAtFixedEffort(activities, { ref_effort: 3.3 });
    expect(r.change_bpm).toBeCloseTo(ref33.change_bpm, 6);
  });

  it('la sensibilidad repite la lectura con la pendiente a la mitad y a 1,5x', () => {
    const r = hrAtFixedEffort(activities, { ref_effort: 3.3 });
    // Las columnas se identifican por FACTOR, no por el valor de la pendiente: el
    // valor va aparte, para que la cabecera de la tabla sea legible.
    expect(Object.keys(r.periods[0].sensitivity)).toEqual(['x0.5', 'x1', 'x1.5']);
    expect(r.sensitivity_slopes).toEqual({ 'x0.5': 10, x1: 20, 'x1.5': 30 });
    // Con la pendiente correcta, la sensibilidad coincide con la regresión.
    expect(r.periods[2].sensitivity.x1).toBeCloseTo(141, 1);
    // Con la pendiente mal, la lectura se desplaza: por eso se publica.
    expect(r.periods[2].sensitivity['x0.5']).not.toBeCloseTo(141, 1);
  });

  it('marca la conclusión como frágil cuando depende de la pendiente', () => {
    // Los tres periodos se corrieron a esfuerzos crecientes, así que aquí la
    // pendiente SÍ manda: con la correcta el cambio es claro y del mismo signo en
    // las tres lecturas.
    const solid = hrAtFixedEffort(activities, { ref_effort: 3.3 });
    expect(solid.change_robust).toBe(true);
    expect(Object.keys(solid.change_sensitivity)).toEqual(['x0.5', 'x1', 'x1.5']);

    // Caso frágil: cada periodo tiene su pendiente interna, pero el segundo se corrió
    // ENTERO más rápido (media 3,5 frente a 3,2 m/s), así que leer en 3,3 obliga a
    // extrapolar los dos en direcciones opuestas. Según la pendiente que se use, el
    // mismo dato es mejorar o empeorar.
    const fragile = [
      ...[3.1, 3.2, 3.3].map((v, i) => session(`2026-03-0${i + 1}`, {
        effort: v, hr: 150 + SLOPE * (v - 3.2),
      })),
      ...[3.4, 3.5, 3.6].map((v, i) => session(`2026-09-0${i + 1}`, {
        effort: v, hr: 154 + SLOPE * (v - 3.5),
      })),
    ];
    const r = hrAtFixedEffort(fragile, { ref_effort: 3.3 });
    expect(r.change_robust).toBe(false);
    const vals = Object.values(r.change_sensitivity);
    expect(Math.min(...vals)).toBeLessThan(0);
    expect(Math.max(...vals)).toBeGreaterThan(0);
  });

  it('traduce la pendiente del eje GAP a ppm por cada 10 s/km', () => {
    const r = hrAtFixedEffort(activities, { ref_effort: 3.3 });
    // 20 ppm por m/s a 3,3 m/s (5:03/km): apretar 10 s/km son ~0,108 m/s.
    expect(r.slope_bpm_per_10s_per_km).toBeCloseTo(2.11, 2);
    // En el eje de potencia no hay ritmo que traducir.
    const power = [
      ...[300, 310, 320].map((w, i) => session(`2026-03-0${i + 1}`, { watts: w, hr: 150 + 0.4 * (w - 310) })),
      ...[300, 310, 320].map((w, i) => session(`2026-09-0${i + 1}`, { watts: w, hr: 146 + 0.4 * (w - 310) })),
    ];
    const r2 = hrAtFixedEffort(power, { axis: 'power' });
    expect(r2.error).toBeUndefined();
    expect(r2.slope_bpm_per_10s_per_km).toBeNull();
  });

  it('descarta con motivo: carreras, otro sensor, esfuerzo inestable y sin enriquecer', () => {
    const extra = [
      { ...session('2026-09-20', { effort: 3.4, hr: 175 }), workout_type: 1 },
      session('2026-09-21', { effort: 3.4, hr: 158, _hr: { hr_source: 'wrist' } }),
      session('2026-09-22', { effort: 3.4, hr: 158, cv: 0.2 }),
      { id: 'raw', start_date: '2026-09-23T07:00:00Z', start_date_local: '2026-09-23T09:00:00', name: 'sin streams' },
    ];
    const r = hrAtFixedEffort([...activities, ...extra], { ref_effort: 3.3 });
    const reasons = Object.fromEntries(r.excluded.map((e) => [e.id, e.reason]));
    expect(reasons['2026-09-20']).toBe('carrera');
    expect(reasons['2026-09-21']).toBe('origen-fc');
    expect(reasons['2026-09-22']).toBe('esfuerzo-inestable');
    expect(reasons.raw).toBe('sin-enriquecer');
    expect(r.n_sessions).toBe(12); // ninguna de las cuatro entra en el modelo
  });

  it('un periodo con una sola sesión se deja fuera', () => {
    const r = hrAtFixedEffort([...activities, session('2026-12-01', { effort: 3.4, hr: 140 })], {});
    expect(r.periods.map((p) => p.period)).not.toContain('2026-12');
    expect(r.excluded.some((e) => e.reason === 'periodo-con-pocas-sesiones')).toBe(true);
  });

  it('ajusta por WBGT cuando casi todas las sesiones lo traen', () => {
    // Mismo atleta, misma forma en los dos periodos: lo único que cambia es que en
    // junio hizo más calor (WBGT medio 25 °C) que en septiembre (20 °C), a +0,5 ppm
    // por grado. Cada periodo tiene calor VARIADO por dentro; si no, la columna del
    // WBGT sería la propia dummy del periodo y no habría nada que repartir.
    const hrOf = (v, wbgt) => 150 + SLOPE * (v - 3.3) + 0.5 * (wbgt - 21);
    const heat = [
      ...[[3.2, 22], [3.3, 24], [3.4, 26], [3.5, 28]].map(([v, wbgt], i) => session(
        `2026-06-0${i + 1}`, { effort: v, hr: hrOf(v, wbgt), wbgt },
      )),
      ...[[3.2, 14], [3.3, 18], [3.4, 22], [3.5, 26]].map(([v, wbgt], i) => session(
        `2026-09-0${i + 1}`, { effort: v, hr: hrOf(v, wbgt), wbgt },
      )),
    ];
    const withHeat = hrAtFixedEffort(heat, { ref_effort: 3.3 });
    expect(withHeat.wbgt_adjusted).toBe(true);
    // Corregido por calor, los dos periodos son el mismo atleta.
    expect(withHeat.change_bpm).toBeCloseTo(0, 1);
    // Sin corregir, los 5 °C de diferencia se leerían como 2,5 ppm de "forma".
    const raw = hrAtFixedEffort(heat, { ref_effort: 3.3, use_wbgt: false });
    expect(raw.change_bpm).toBeCloseTo(-2.5, 1);
  });

  it('si el calor no varía dentro del periodo, reintenta sin él en vez de fallar', () => {
    // WBGT constante por periodo: colineal con la dummy. El modelo sin calor sigue
    // siendo informativo, y `wbgt_adjusted: false` avisa de que no está corregido.
    const degenerate = [
      ...[3.2, 3.3, 3.4, 3.5].map((v, i) => session(`2026-06-0${i + 1}`, {
        effort: v, hr: 150 + SLOPE * (v - 3.3), wbgt: 26,
      })),
      ...[3.2, 3.3, 3.4, 3.5].map((v, i) => session(`2026-09-0${i + 1}`, {
        effort: v, hr: 150 + SLOPE * (v - 3.3) - 6, wbgt: 16,
      })),
    ];
    const r = hrAtFixedEffort(degenerate, { ref_effort: 3.3 });
    expect(r.error).toBeUndefined();
    expect(r.wbgt_adjusted).toBe(false);
    expect(r.wbgt_ref_c).toBeNull();
    expect(r.change_bpm).toBeCloseTo(-6, 1);
  });

  it('el eje de potencia da el mismo efecto de periodo en su propia escala', () => {
    const power = [
      ...[300, 310, 320, 305].map((w, i) => session(`2026-03-0${i + 1}`, {
        watts: w, effort: 3.3, hr: 150 + 0.4 * (w - 310),
      })),
      ...[305, 315, 325, 310].map((w, i) => session(`2026-09-0${i + 1}`, {
        watts: w, effort: 3.3, hr: 150 + 0.4 * (w - 310) - 8,
      })),
    ];
    const r = hrAtFixedEffort(power, { axis: 'power', ref_effort: 310 });
    expect(r.unit).toBe('W');
    expect(r.slope_bpm_per_unit).toBeCloseTo(0.4, 3);
    expect(r.change_bpm).toBeCloseTo(-8, 1);
    expect(r.ref_pace_per_km).toBeNull();
  });

  it('avisa en vez de inventar cuando no hay material', () => {
    expect(hrAtFixedEffort([], {}).error).toBeTruthy();
    expect(hrAtFixedEffort(activities, { from: '2027-01-01' }).error).toBeTruthy();
  });

  it('cuando no sale modelo, sigue diciendo POR QUE quedo fuera cada sesion', () => {
    // El caso real del primer arranque: todo el historico sin enriquecer. Un
    // "no hay datos" pelado no distingue eso de "no llevabas banda".
    const raw = Array.from({ length: 40 }, (_, i) => ({
      id: i, start_date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T07:00:00Z`,
      start_date_local: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T09:00:00`,
      name: 'rodaje',
    }));
    const r = hrAtFixedEffort(raw, {});
    expect(r.error_code).toBe('few-sessions');
    expect(r.excluded).toHaveLength(40);
    expect(r.excluded.every((e) => e.reason === 'sin-enriquecer')).toBe(true);
  });

  it('cada motivo de descarte sobrevive al camino sin modelo', () => {
    const mixed = [
      { ...session('2026-09-01', { effort: 3.4, hr: 175 }), workout_type: 1 },
      session('2026-09-02', { effort: 3.4, hr: 158, _hr: { hr_source: 'wrist' } }),
      session('2026-09-03', { effort: 3.4, hr: 158, cv: 0.2 }),
    ];
    const reasons = hrAtFixedEffort(mixed, {}).excluded.map((e) => e.reason).sort();
    expect(reasons).toEqual(['carrera', 'esfuerzo-inestable', 'origen-fc']);
  });
});

describe('paceFromSpeed', () => {
  it('convierte m/s a mm:ss por km', () => {
    expect(paceFromSpeed(3.3)).toBe('5:03');
    expect(paceFromSpeed(0)).toBeNull();
  });
});
