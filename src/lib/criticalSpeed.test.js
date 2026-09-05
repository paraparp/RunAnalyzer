import { describe, it, expect } from 'vitest';
import {
  buildMeanMaxCurve, fitCriticalSpeed, predictTime, speedForDuration,
  canonByMeters, raceDistanceId, hasNonMaximalPoints, monthsAgoISO, daysAgoISO, activityWithinMonths,
  fitCriticalSpeed3P, VMAX_MIN_M_S, VMAX_MAX_M_S,
} from './criticalSpeed';

// Distancia por defecto NO canónica (12,4 km): así la actividad solo aporta los
// best_efforts que se le pongan, sin sintetizar además un punto por su total.
const run = (o) => ({ id: 1, type: 'Run', start_date_local: '2026-05-10T08:00:00Z', distance: 12400, moving_time: 3400, best_efforts: [], ...o });
const effort = (distance, time) => ({ distance, moving_time: time, elapsed_time: time });

describe('reconocimiento de distancias', () => {
  it('casa por metros, no por nombre localizado', () => {
    expect(canonByMeters(5000)).toBe('5k');
    expect(canonByMeters(21097)).toBe('half-marathon');
    expect(canonByMeters(1609)).toBe('1 mile');
    expect(canonByMeters(7000)).toBe(null);
  });

  it('una carrera medida algo larga sigue siendo su distancia', () => {
    expect(raceDistanceId(21350)).toBe('half-marathon');   // +1.2%
    expect(raceDistanceId(20800)).toBe(null);              // corta: no cuenta
  });
});

describe('buildMeanMaxCurve', () => {
  it('se queda con el mejor tiempo de cada distancia', () => {
    const acts = [
      run({ id: 1, best_efforts: [effort(5000, 1200)] }),
      run({ id: 2, best_efforts: [effort(5000, 1140)] }),   // más rápido
      run({ id: 3, best_efforts: [effort(1000, 200)] }),
    ];
    const curve = buildMeanMaxCurve(acts);
    expect(curve.map(p => p.id)).toEqual(['1k', '5k']);
    expect(curve.find(p => p.id === '5k').time_s).toBe(1140);
    expect(curve.find(p => p.id === '5k').activity_id).toBe(2);
  });

  it('rescata carreras antiguas sin best_efforts usando el tiempo total', () => {
    const curve = buildMeanMaxCurve([run({ distance: 21350, moving_time: 5936, best_efforts: [] })]);
    expect(curve[0].id).toBe('half-marathon');
    expect(curve[0].source).toBe('total_distance');
  });

  it('respeta el rango de fechas y descarta lo que no es carrera a pie', () => {
    const acts = [
      run({ id: 1, start_date_local: '2025-01-05T08:00:00Z', best_efforts: [effort(5000, 1100)] }),
      run({ id: 2, start_date_local: '2026-05-05T08:00:00Z', best_efforts: [effort(5000, 1200)] }),
      run({ id: 3, type: 'Ride', start_date_local: '2026-05-06T08:00:00Z', best_efforts: [effort(5000, 600)] }),
    ];
    const curve = buildMeanMaxCurve(acts, { from: '2026-01-01' });
    expect(curve).toHaveLength(1);
    expect(curve[0].time_s).toBe(1200);
  });
});

describe('fitCriticalSpeed', () => {
  // Atleta sintético con CS = 4 m/s (4:10/km) y D′ = 200 m: d = 4t + 200
  const synthetic = [180, 300, 600, 1200].map((t) => ({
    id: `t${t}`, time_s: t, distance_m: 4 * t + 200,
  }));

  it('recupera CS y D′ de datos que siguen el modelo', () => {
    const fit = fitCriticalSpeed(synthetic);
    expect(fit.cs_m_s).toBeCloseTo(4, 6);
    expect(fit.d_prime_m).toBeCloseTo(200, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(fit.cs_pace_min_km).toBeCloseTo(4.1667, 3);   // 4:10/km
  });

  it('ignora los puntos fuera de la ventana de validez', () => {
    const conRuido = [
      { id: 'sprint', time_s: 60, distance_m: 400 },        // demasiado corto
      ...synthetic,
      { id: 'maraton', time_s: 9000, distance_m: 30000 },   // demasiado largo
    ];
    const fit = fitCriticalSpeed(conRuido);
    expect(fit.n).toBe(4);
    expect(fit.cs_m_s).toBeCloseTo(4, 6);
  });

  it('sin puntos suficientes no inventa un ajuste', () => {
    expect(fitCriticalSpeed(synthetic.slice(0, 2))).toBe(null);
    expect(fitCriticalSpeed([])).toBe(null);
  });

  it('rechaza ajustes sin sentido físico', () => {
    // Puntos incoherentes (más lento cuanto más corto) → pendiente o corte negativos
    const absurdo = [
      { id: 'a', time_s: 200, distance_m: 3000 },
      { id: 'b', time_s: 600, distance_m: 3200 },
      { id: 'c', time_s: 1200, distance_m: 3300 },
    ];
    const fit = fitCriticalSpeed(absurdo);
    expect(fit === null || fit.d_prime_m > 0).toBe(true);
  });
});

describe('predicciones', () => {
  const fit = fitCriticalSpeed([180, 300, 600, 1200].map((t) => ({ id: `t${t}`, time_s: t, distance_m: 4 * t + 200 })));

  it('predice el tiempo de una distancia dentro de la ventana', () => {
    const p = predictTime(fit, 5000);
    expect(p.time_s).toBeCloseTo(1200, 4);      // (5000-200)/4
    expect(p.optimistic).toBe(false);
  });

  it('marca como optimista lo que cae fuera de la ventana', () => {
    expect(predictTime(fit, 21097).optimistic).toBe(true);
    expect(predictTime(fit, 42195).optimistic).toBe(true);
  });

  it('la velocidad sostenible tiende a CS al alargar el esfuerzo', () => {
    expect(speedForDuration(fit, 300)).toBeGreaterThan(fit.cs_m_s);
    expect(speedForDuration(fit, 36000)).toBeCloseTo(fit.cs_m_s, 1);
  });
});

describe('banda de plausibilidad', () => {
  it('descarta una pendiente que no es de un corredor', () => {
    // d = 12·t + 100 → CS de 12 m/s (1:23/km): matemáticamente perfecto, humanamente falso.
    const irreal = [180, 600, 1200].map((t) => ({ id: `t${t}`, time_s: t, distance_m: 12 * t + 100 }));
    expect(fitCriticalSpeed(irreal)).toBe(null);
  });
});

describe('hasNonMaximalPoints', () => {
  const pt = (t, speed) => ({ id: `t${t}`, time_s: t, speed_m_s: speed });

  it('una curva que decrece con la duración es coherente', () => {
    expect(hasNonMaximalPoints([pt(180, 5), pt(600, 4.5), pt(1200, 4.2)])).toBe(false);
  });

  it('detecta que un esfuerzo más largo salió más rápido que uno más corto', () => {
    expect(hasNonMaximalPoints([pt(180, 4.2), pt(600, 4.5)])).toBe(true);
  });

  it('ignora lo que cae fuera de la ventana de ajuste', () => {
    // El sprint de 60 s es más lento que el de 600 s, pero no entra en el ajuste.
    expect(hasNonMaximalPoints([pt(60, 4), pt(600, 4.5), pt(1200, 4.2)])).toBe(false);
  });
});

describe('monthsAgoISO', () => {
  it('sin meses no pone límite inferior', () => {
    expect(monthsAgoISO(null)).toBe(null);
  });

  it('devuelve una fecha ISO anterior a hoy', () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const hace6 = monthsAgoISO(6);
    expect(hace6).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hace6 < hoy).toBe(true);
  });
});

describe('daysAgoISO', () => {
  const dayISO = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('sin días no pone límite inferior', () => {
    expect(daysAgoISO(null)).toBe(null);
  });

  it('es el día LOCAL de hace N días, no un desfase UTC', () => {
    // Al oeste de Greenwich `toISOString()` a última hora da ya el día siguiente:
    // esa era la frontera que movía la ventana de "últimos 30 días" un día entero.
    expect(daysAgoISO(30)).toBe(dayISO(30));
    expect(daysAgoISO(0)).toBe(dayISO(0));
  });

  it('cruza el cambio de mes sin saltarse días', () => {
    const from = daysAgoISO(45);
    const hoy = dayISO(0);
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from < hoy).toBe(true);
  });
});

describe('activityWithinMonths', () => {
  const dayISO = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('sin meses acepta cualquier actividad', () => {
    const inWindow = activityWithinMonths(null);
    expect(inWindow({ start_date_local: '2001-01-01T08:00:00Z' })).toBe(true);
  });

  it('acepta lo reciente y descarta lo anterior a la frontera', () => {
    const inWindow = activityWithinMonths(6);
    expect(inWindow({ start_date_local: `${dayISO(30)}T08:00:00Z` })).toBe(true);
    expect(inWindow({ start_date_local: `${dayISO(400)}T08:00:00Z` })).toBe(false);
  });

  it('la frontera es de calendario, no bloques de 30 días', () => {
    // 12 meses de 30 días son 360 días: un esfuerzo de hace 362 quedaba fuera
    // de la ventana de la CS y dentro de la del contraste por FC, o al revés.
    const inWindow = activityWithinMonths(12);
    expect(inWindow({ start_date_local: `${dayISO(362)}T08:00:00Z` })).toBe(true);
  });

  it('usa el día LOCAL de la actividad, no el instante UTC', () => {
    // 00:30 local en UTC+2 es el día anterior en UTC: si la frontera cae ese día,
    // la comparación por timestamp UTC la descartaba y la de día local la mantiene.
    const from = monthsAgoISO(6);
    const inWindow = activityWithinMonths(6);
    expect(inWindow({ start_date_local: `${from}T00:30:00`, start_date: `${from}T22:30:00Z` })).toBe(true);
  });

  it('sin fecha, fuera', () => {
    expect(activityWithinMonths(6)({})).toBe(false);
  });
});

describe('fitCriticalSpeed3P (Morton)', () => {
  // Atleta sintético con CS = 4 m/s, D′ = 200 m y vMax = 9 m/s
  // → k = D′/(vMax − CS) = 40 s, d = 4t + 200·t/(t+40).
  const CS = 4, DP = 200, VMAX = 9, K = DP / (VMAX - CS);
  const dist3p = (t) => CS * t + DP * (t / (t + K));
  const synthetic = [60, 120, 300, 600, 1200].map((t) => ({ id: `t${t}`, time_s: t, distance_m: dist3p(t) }));

  it('recupera los tres parámetros de una curva generada con el modelo', () => {
    const fit = fitCriticalSpeed3P(synthetic);
    expect(fit.cs_m_s).toBeCloseTo(CS, 2);
    expect(fit.d_prime_m).toBeCloseTo(DP, 0);
    expect(fit.v_max_m_s).toBeCloseTo(VMAX, 1);
    expect(fit.k_s).toBeCloseTo(K, 0);
    expect(fit.r2).toBeGreaterThan(0.999);
    expect(fit.model).toBe('3p');
    expect(fit.n).toBe(5);
  });

  it('sobre esos mismos datos el modelo de 2 parámetros sobreestima la CS', () => {
    // Es el sesgo que motiva el tercer parámetro: sin techo de velocidad, los
    // esfuerzos cortos empujan la pendiente hacia arriba.
    const two = fitCriticalSpeed(synthetic);
    const three = fitCriticalSpeed3P(synthetic);
    expect(two.cs_m_s).toBeGreaterThan(three.cs_m_s);
    expect(three.cs_m_s).toBeCloseTo(CS, 2);
  });

  it('sin curvatura no se inventa un techo: cede al modelo de dos parámetros', () => {
    // Curva generada SIN curvatura (d = CS·t + D′, k = 0): no hay vMax que
    // estimar —saldría de cientos de m/s— y el ajuste se declara nulo en vez de
    // devolver un tercer parámetro sacado del ruido.
    const linear = [180, 300, 600, 1200].map((t) => ({ id: `t${t}`, time_s: t, distance_m: CS * t + DP }));
    expect(fitCriticalSpeed3P(linear)).toBe(null);
    expect(fitCriticalSpeed(linear).cs_m_s).toBeCloseTo(CS, 3);
  });

  it('predictTime invierte el modelo de tres parámetros', () => {
    const fit = fitCriticalSpeed3P(synthetic);
    for (const t of [90, 400, 900]) {
      const p = predictTime(fit, dist3p(t));
      expect(p.time_s).toBeCloseTo(t, 0);
    }
  });

  it('speedForDuration no se dispara al acortar la duración', () => {
    const fit = fitCriticalSpeed3P(synthetic);
    // A 1 s el 2P daría CS + D′ = cientos de m/s; el 3P se queda bajo vMax.
    expect(speedForDuration(fit, 1)).toBeLessThanOrEqual(fit.v_max_m_s);
    expect(speedForDuration(fit, 1)).toBeGreaterThan(fit.cs_m_s);
    // Y la curva sigue siendo decreciente en duración.
    expect(speedForDuration(fit, 300)).toBeGreaterThan(speedForDuration(fit, 1200));
  });

  it('marca como optimista lo que cae más allá de la ventana', () => {
    const fit = fitCriticalSpeed3P(synthetic);
    expect(predictTime(fit, 5000).optimistic).toBe(false);
    expect(predictTime(fit, 42195).optimistic).toBe(true);
  });

  it('exige cuatro puntos: con tres el ajuste sería una interpolación', () => {
    expect(fitCriticalSpeed3P(synthetic.slice(0, 3))).toBe(null);
    expect(fitCriticalSpeed3P([])).toBe(null);
  });

  it('descarta el ajuste si vMax sale fuera de la banda fisiológica', () => {
    // Curva plana: todos los puntos al mismo ritmo, sin reserva anaeróbica que
    // explique un techo de velocidad.
    const flat = [60, 120, 300, 600].map((t) => ({ id: `t${t}`, time_s: t, distance_m: CS * t }));
    expect(fitCriticalSpeed3P(flat)).toBe(null);
    // Y cuando sí ajusta, vMax cae dentro de la banda declarada.
    const fit = fitCriticalSpeed3P(synthetic);
    expect(fit.v_max_m_s).toBeGreaterThanOrEqual(VMAX_MIN_M_S);
    expect(fit.v_max_m_s).toBeLessThanOrEqual(VMAX_MAX_M_S);
  });

  it('respeta la ventana temporal y la deja anotada', () => {
    const fit = fitCriticalSpeed3P(synthetic, { minTime: 100, maxTime: 1800 });
    expect(fit.window_s).toEqual([100, 1800]);
    expect(fit.used_ids).not.toContain('t60');
  });
});
