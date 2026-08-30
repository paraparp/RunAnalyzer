import { describe, it, expect } from 'vitest';
import {
  buildLoadParams, sessionLoad, dailyLoad, computePMC,
  estimateThresholdSpeed, activityDayKey, TRIMP_COEF,
} from './trainingLoad';

// Atleta de referencia: FCmax 190, FCrep 50, LTHR 170 → HRR umbral = 120/140 = 0.857
const PARAMS = buildLoadParams([], { hrmax: 190, hrrest: 50, lthr: 170, thresholdSpeed: 4.0 });

const run = (o) => ({
  id: 1,
  type: 'Run',
  start_date: '2026-05-10T08:00:00Z',
  start_date_local: '2026-05-10T10:00:00Z',
  distance: 10000,
  moving_time: 3000,
  total_elevation_gain: 0,
  ...o,
});

describe('escala TSS', () => {
  it('1 hora exacta al umbral vale 100', () => {
    const { load, method } = sessionLoad(run({ moving_time: 3600, average_heartrate: 170 }), PARAMS);
    expect(method).toBe('hrtss');
    expect(load).toBeCloseTo(100, 6);
  });

  it('media hora al umbral vale la mitad', () => {
    const { load } = sessionLoad(run({ moving_time: 1800, average_heartrate: 170 }), PARAMS);
    expect(load).toBeCloseTo(50, 6);
  });

  it('a igual duración, más intensidad pesa más que proporcionalmente', () => {
    const suave = sessionLoad(run({ moving_time: 3600, average_heartrate: 130 }), PARAMS).load;
    const umbral = sessionLoad(run({ moving_time: 3600, average_heartrate: 170 }), PARAMS).load;
    // HRR pasa de 0.571 a 0.857 (×1.5); la carga sube MÁS de 1.5× por el término
    // exponencial. Un modelo lineal (el que había antes) daría exactamente ×1.5.
    expect(umbral / suave).toBeGreaterThan(1.5);
    expect(umbral / suave).toBeCloseTo(2.6, 1);
  });

  it('una FC por debajo de reposo no genera carga negativa', () => {
    // FCrep 70: una lectura de 65 ppm daría HRR negativa sin el clamp.
    const alto = buildLoadParams([], { hrmax: 190, hrrest: 70, lthr: 170 });
    const { load, method } = sessionLoad(run({ average_heartrate: 65 }), alto);
    expect(method).toBe('hrtss');
    expect(load).toBe(0);
  });

  it('una lectura de FC absurda se descarta y la sesión pasa a ritmo', () => {
    // 40 ppm no es un esfuerzo suave, es la banda desenganchada: no debe valer 0.
    const { load, method } = sessionLoad(run({ average_heartrate: 40, average_speed: 4.0 }), PARAMS);
    expect(method).toBe('rtss');
    expect(load).toBeGreaterThan(0);
  });

  it('una FC por encima de FCmax se acota', () => {
    const enMax = sessionLoad(run({ moving_time: 3600, average_heartrate: 190 }), PARAMS).load;
    const imposible = sessionLoad(run({ moving_time: 3600, average_heartrate: 240 }), PARAMS).load;
    expect(imposible / enMax).toBeLessThan(1.2);
  });
});

describe('normalización y coeficientes de Banister', () => {
  it('k1 se cancela: cambiar de coeficientes no mueve la carga al umbral', () => {
    const male = buildLoadParams([], { hrmax: 190, hrrest: 50, lthr: 170, sex: 'male' });
    const female = buildLoadParams([], { hrmax: 190, hrrest: 50, lthr: 170, sex: 'female' });
    const act = run({ moving_time: 3600, average_heartrate: 170 });
    expect(sessionLoad(act, male).load).toBeCloseTo(100, 6);
    expect(sessionLoad(act, female).load).toBeCloseTo(100, 6);
  });

  it('k2 solo pesa lejos del umbral, y poco', () => {
    const male = buildLoadParams([], { hrmax: 190, hrrest: 50, lthr: 170, sex: 'male' });
    const female = buildLoadParams([], { hrmax: 190, hrrest: 50, lthr: 170, sex: 'female' });
    const suave = run({ moving_time: 3600, average_heartrate: 120 });
    const a = sessionLoad(suave, male).load;
    const b = sessionLoad(suave, female).load;
    // Desconocer el sexo desplaza la carga de un rodaje suave <20 %, no la invalida.
    expect(Math.abs(a - b) / a).toBeLessThan(0.20);
    expect(TRIMP_COEF.male.k2).toBeGreaterThan(TRIMP_COEF.female.k2);
  });
});

describe('método por splits', () => {
  const splits = (hrs, sec = 300) =>
    hrs.map((hr, i) => ({ split: i + 1, average_heartrate: hr, moving_time: sec, distance: 1000 }));

  it('se prefiere a la FC media cuando cubre la sesión', () => {
    const { method } = sessionLoad(
      run({ moving_time: 1500, average_heartrate: 150, splits_metric: splits([140, 175, 140, 175, 140]) }),
      PARAMS,
    );
    expect(method).toBe('hrtss_splits');
  });

  it('una sesión de series pesa más que un rodaje con la misma FC media', () => {
    // Ambas promedian 155 ppm en 25 min, pero una alterna 130/180.
    const series = sessionLoad(
      run({ moving_time: 1500, splits_metric: splits([130, 180, 130, 180, 155]) }),
      PARAMS,
    ).load;
    const rodaje = sessionLoad(
      run({ moving_time: 1500, splits_metric: splits([155, 155, 155, 155, 155]) }),
      PARAMS,
    ).load;
    expect(series).toBeGreaterThan(rodaje);
  });

  it('cae a la FC media si los splits cubren menos de la mitad', () => {
    const { method } = sessionLoad(
      run({ moving_time: 3000, average_heartrate: 150, splits_metric: splits([150], 300) }),
      PARAMS,
    );
    expect(method).toBe('hrtss');
  });
});

describe('fallbacks sin frecuencia cardiaca', () => {
  it('usa TSS por ritmo cuando hay velocidad umbral', () => {
    const { load, method } = sessionLoad(
      run({ moving_time: 3600, distance: 14400, average_speed: 4.0 }), // 1 h justo a velocidad umbral
      PARAMS,
    );
    expect(method).toBe('rtss');
    expect(load).toBeCloseTo(100, 6);
  });

  it('la pendiente sube la carga a igual velocidad medida', () => {
    const llano = sessionLoad(run({ moving_time: 3600, distance: 14400, average_speed: 4.0 }), PARAMS).load;
    const cuesta = sessionLoad(
      run({ moving_time: 3600, distance: 14400, average_speed: 4.0, total_elevation_gain: 720 }), // 5 %
      PARAMS,
    ).load;
    expect(cuesta).toBeGreaterThan(llano);
  });

  it('sin velocidad umbral ni FC cae a duración', () => {
    const sinUmbral = buildLoadParams([], { hrmax: 190, hrrest: 50, lthr: 170 });
    const { load, method } = sessionLoad(
      run({ moving_time: 3600, distance: 0, average_speed: 0 }),
      { ...sinUmbral, thresholdSpeed: null },
    );
    expect(method).toBe('duration');
    expect(load).toBeCloseTo(49, 6); // 1 h × 0.70² × 100
  });

  it('una sesión sin tiempo no aporta carga', () => {
    expect(sessionLoad(run({ moving_time: 0, elapsed_time: 0 }), PARAMS).load).toBe(0);
  });
});

describe('estimateThresholdSpeed', () => {
  it('coge el mejor esfuerzo sostenido en llano de 25–70 min', () => {
    const v = estimateThresholdSpeed([
      run({ moving_time: 1800, distance: 6000, average_speed: 3.33 }),
      run({ moving_time: 2400, distance: 9600, average_speed: 4.0 }),  // el bueno
      run({ moving_time: 600, distance: 3000, average_speed: 5.0 }),   // muy corto: fuera
    ]);
    expect(v).toBeCloseTo(4.0, 2);
  });

  it('descarta los esfuerzos con demasiada pendiente', () => {
    const v = estimateThresholdSpeed([
      run({ moving_time: 2400, distance: 9600, average_speed: 4.5, total_elevation_gain: 500 }),
      run({ moving_time: 2400, distance: 9600, average_speed: 4.0 }),
    ]);
    expect(v).toBeCloseTo(4.0, 2);
  });

  it('devuelve null si no hay nada utilizable', () => {
    expect(estimateThresholdSpeed([])).toBe(null);
  });
});

describe('agregación diaria', () => {
  it('agrupa por día LOCAL, no UTC', () => {
    // 23:30 local del día 10 = 21:30 UTC del 10; pero con offset +03:00 el
    // start_date UTC podría caer en otro día. Manda la fecha local.
    const a = run({ start_date: '2026-05-11T01:30:00Z', start_date_local: '2026-05-10T23:30:00Z' });
    expect(activityDayKey(a)).toBe('2026-05-10');
  });

  it('suma varias sesiones del mismo día', () => {
    const map = dailyLoad([
      run({ id: 1, moving_time: 3600, average_heartrate: 170 }),
      run({ id: 2, moving_time: 3600, average_heartrate: 170 }),
    ], PARAMS);
    expect(map.get('2026-05-10').load).toBeCloseTo(200, 6);
    expect(map.get('2026-05-10').activities).toHaveLength(2);
  });
});

describe('computePMC', () => {
  // 60 días seguidos con 1 h al umbral cada día = 100 TSS/día.
  const daily = Array.from({ length: 60 }, (_, i) => {
    const d = new Date(2026, 0, 1 + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return run({ id: i, start_date_local: `${iso}T10:00:00Z`, moving_time: 3600, average_heartrate: 170 });
  });

  it('CTL y ATL convergen hacia la carga diaria, ATL más rápido', () => {
    const pmc = computePMC(daily, { params: PARAMS, until: new Date(2026, 1, 29) });
    expect(pmc.current.atl).toBeGreaterThan(pmc.current.ctl);
    expect(pmc.current.atl).toBeGreaterThan(99);   // τ=7 saturado a 100
    expect(pmc.current.ctl).toBeLessThan(100);     // τ=42 aún subiendo
    expect(pmc.current.tsb).toBeLessThan(0);       // cargado
  });

  it('con carga constante el ACWR tiende a 1', () => {
    const pmc = computePMC(daily, { params: PARAMS, until: new Date(2026, 1, 29) });
    expect(pmc.current.acwr).toBeGreaterThan(0.95);
    expect(pmc.current.acwr).toBeLessThan(1.15);
  });

  it('el ACWR usa 7:28, no ATL/CTL(42)', () => {
    const pmc = computePMC(daily, { params: PARAMS, until: new Date(2026, 1, 29) });
    const ingenuo = pmc.current.atl / pmc.current.ctl;
    // La versión antigua inflaba el ratio por usar una crónica de 42 días.
    expect(ingenuo).toBeGreaterThan(pmc.current.acwr);
  });

  it('la serie cubre todos los días, también los de descanso', () => {
    const pmc = computePMC([
      run({ id: 1, start_date_local: '2026-03-01T10:00:00Z' }),
      run({ id: 2, start_date_local: '2026-03-10T10:00:00Z' }),
    ], { params: PARAMS, until: new Date(2026, 2, 10) });
    expect(pmc.series).toHaveLength(10);
    expect(pmc.series[5].load).toBe(0);
    expect(pmc.series[5].activities).toEqual([]);
  });

  it('el descanso baja la fatiga más rápido que la forma', () => {
    const pmc = computePMC(daily, { params: PARAMS, until: new Date(2026, 2, 15) }); // +14 d de descanso
    expect(pmc.current.tsb).toBeGreaterThan(0);  // afinado
    expect(pmc.current.ctl).toBeGreaterThan(pmc.current.atl);
  });

  it('registra el pico de CTL con su fecha', () => {
    const pmc = computePMC(daily, { params: PARAMS, until: new Date(2026, 2, 15) });
    expect(pmc.current.peak).toBeGreaterThan(pmc.current.ctl);
    expect(pmc.current.peakDate).toBe('2026-03-01'); // último día con carga
    expect(pmc.current.pctPeak).toBeLessThan(100);
  });

  it('devuelve null sin actividades', () => {
    expect(computePMC([])).toBe(null);
    expect(computePMC(null)).toBe(null);
  });

  it('no salta días en un cambio de horario', () => {
    // DST en España: 29 de marzo de 2026 a las 02:00.
    const pmc = computePMC([
      run({ id: 1, start_date_local: '2026-03-27T10:00:00Z' }),
    ], { params: PARAMS, until: new Date(2026, 2, 31) });
    const dias = pmc.series.map((p) => p.date);
    expect(dias).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
  });
});
