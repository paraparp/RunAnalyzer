import { describe, it, expect } from 'vitest';
import {
  EF_HRMAX_FLOOR, EF_HR_BAND,
  efficiencyMPerBeat, toBeatsPerKm, efHrBand,
  efFromSplits, efFromWholeRun, efficiencyFactorRun,
} from './efficiencyFactor';

// Estos tests fijan las dos cosas que la auditoría señalaba como rotas: la
// CONVENCIÓN (m/latido, más es mejor, no su inverso) y los FILTROS (sin banda
// aeróbica un EF mezcla series con rodajes y no significa nada).

const split = (over = {}) => ({
  average_heartrate: 140, average_speed: 3.0, distance: 1000,
  moving_time: 333, elevation_difference: 0, ...over,
});

// FCmax observada 200 → banda 140–170 ppm
const MAX_HR = 200;
const run = (over = {}) => ({
  type: 'Run', distance: 10000, average_speed: 3.0, average_heartrate: 150,
  moving_time: 3333, total_elevation_gain: 0, start_date: '2026-08-20T07:00:00Z', ...over,
});

describe('efficiencyMPerBeat', () => {
  it('son los metros recorridos por latido: v·60/FC', () => {
    // 3 m/s a 150 ppm → 180 m/min / 150 lat/min = 1.2 m/latido
    expect(efficiencyMPerBeat(3.0, 150)).toBeCloseTo(1.2, 10);
  });

  it('más alto es mejor: a igual FC, más velocidad sube el EF', () => {
    expect(efficiencyMPerBeat(3.3, 150)).toBeGreaterThan(efficiencyMPerBeat(3.0, 150));
    // y a igual velocidad, más FC lo baja
    expect(efficiencyMPerBeat(3.0, 160)).toBeLessThan(efficiencyMPerBeat(3.0, 150));
  });

  it('devuelve null en vez de Infinity o NaN', () => {
    expect(efficiencyMPerBeat(0, 150)).toBeNull();
    expect(efficiencyMPerBeat(3.0, 0)).toBeNull();
    expect(efficiencyMPerBeat(null, null)).toBeNull();
  });
});

describe('latidos por km', () => {
  it('es el recíproco EXACTO del EF, no una segunda métrica', () => {
    for (const [v, hr] of [[3.0, 150], [2.5, 140], [4.1, 168]]) {
      const ef = efficiencyMPerBeat(v, hr);
      expect(toBeatsPerKm(ef)).toBeCloseTo(1000 / ef, 10);
      expect(toBeatsPerKm(toBeatsPerKm(ef))).toBeCloseTo(ef, 10); // es su propia inversa
    }
  });

  it('va en sentido contrario al EF: menos latidos/km = mejor', () => {
    const rapido = { v: 3.3, hr: 150 };
    const lento = { v: 3.0, hr: 150 };
    expect(efficiencyMPerBeat(rapido.v, rapido.hr)).toBeGreaterThan(efficiencyMPerBeat(lento.v, lento.hr));
    expect(toBeatsPerKm(efficiencyMPerBeat(rapido.v, rapido.hr)))
      .toBeLessThan(toBeatsPerKm(efficiencyMPerBeat(lento.v, lento.hr)));
  });

  it('da valores en el rango publicado para un corredor entrenado', () => {
    // 3 m/s (5:33/km) a 150 ppm → ~833 lat/km, dentro del 600-900 típico
    const latPorKm = toBeatsPerKm(efficiencyMPerBeat(3.0, 150));
    expect(latPorKm).toBeGreaterThan(600);
    expect(latPorKm).toBeLessThan(900);
  });
});

describe('efHrBand', () => {
  it('es el 70-85 % de la FCmax observada', () => {
    expect(efHrBand(200)).toEqual({ lo: 200 * EF_HR_BAND.lo, hi: 200 * EF_HR_BAND.hi });
  });

  it('aplica un suelo de FCmax para no excluir rodajes normales', () => {
    // Sin suelo, una FCmax observada de 160 dejaría la banda en 112-136 ppm
    expect(efHrBand(160)).toEqual({
      lo: EF_HRMAX_FLOOR * EF_HR_BAND.lo,
      hi: EF_HRMAX_FLOOR * EF_HR_BAND.hi,
    });
    expect(efHrBand(null).hi).toBeCloseTo(157.25, 6);
  });
});

describe('efFromSplits', () => {
  const opts = { band: efHrBand(MAX_HR), gradeCap: 1, gapAdjust: false };

  it('promedia los km aeróbicos ponderando por tiempo', () => {
    const splits = [split(), split(), split(), split()];
    // el primero se descarta (retardo de FC) → quedan 3, todos iguales
    expect(efFromSplits(splits, opts)).toBeCloseTo(efficiencyMPerBeat(3.0, 140), 10);
  });

  it('exige al menos 3 km válidos', () => {
    expect(efFromSplits([split(), split(), split()], opts)).toBeNull(); // 2 tras descartar el 1.º
  });

  it('descarta los km fuera de la banda aeróbica', () => {
    // FC 185 = 92 % de 200: por encima del umbral, el EF ahí no es comparable
    const splits = [split(), split(), split(), split(), split({ average_heartrate: 185 })];
    const conSerie = efFromSplits(splits, opts);
    const sinSerie = efFromSplits([split(), split(), split(), split()], opts);
    expect(conSerie).toBeCloseTo(sinSerie, 10);
  });

  it('descarta los km con demasiada pendiente', () => {
    const cuesta = split({ elevation_difference: 20 }); // 2 % > tope de 1 %
    expect(efFromSplits([split(), cuesta, cuesta, cuesta], opts)).toBeNull();
  });

  it('descarta los km cortos (parciales sueltos al final)', () => {
    const corto = split({ distance: 400, moving_time: 133 });
    expect(efFromSplits([split(), corto, corto, corto], opts)).toBeNull();
  });

  it('corta a los 75 min para no medir deriva cardiaca', () => {
    // 20 km a 333 s cada uno = 111 min; solo cuentan los que EMPIEZAN antes de 4500 s
    const splits = Array.from({ length: 20 }, () => split());
    const ef = efFromSplits(splits, opts);
    expect(ef).not.toBeNull();
    // el corte se nota: un km lento pasadas las 2 h no mueve el resultado
    const conCola = [...splits, split({ average_speed: 2.0, moving_time: 500 })];
    expect(efFromSplits(conCola, opts)).toBeCloseTo(ef, 10);
  });

  it('el ajuste por GAP premia el mismo esfuerzo en cuesta', () => {
    const gapOpts = { band: efHrBand(MAX_HR), gradeCap: 4, gapAdjust: true };
    const cuesta = split({ elevation_difference: 25 }); // 2.5 %
    const llano = split();
    const enCuesta = efFromSplits([llano, cuesta, cuesta, cuesta], gapOpts);
    const enLlano = efFromSplits([llano, llano, llano, llano], gapOpts);
    expect(enCuesta).toBeGreaterThan(enLlano);
  });

  it('no explota sin parciales', () => {
    expect(efFromSplits(undefined, opts)).toBeNull();
    expect(efFromSplits([], opts)).toBeNull();
  });
});

describe('efFromWholeRun', () => {
  const opts = { band: efHrBand(MAX_HR), gradeCap: 1, gapAdjust: false };

  it('acepta un rodaje llano y aeróbico de 20-75 min', () => {
    const a = run({ moving_time: 2400, average_heartrate: 150 });
    expect(efFromWholeRun(a, opts)).toBeCloseTo(efficiencyMPerBeat(3.0, 150), 10);
  });

  it('rechaza lo que dura menos de 20 min o más de 75', () => {
    expect(efFromWholeRun(run({ moving_time: 900 }), opts)).toBeNull();
    expect(efFromWholeRun(run({ moving_time: 7200 }), opts)).toBeNull();
  });

  it('rechaza el esfuerzo por encima de la banda aeróbica', () => {
    expect(efFromWholeRun(run({ moving_time: 2400, average_heartrate: 180 }), opts)).toBeNull();
  });

  it('rechaza el trail: el desnivel rompe la comparación', () => {
    const trail = run({ moving_time: 2400, total_elevation_gain: 400 }); // 4 %
    expect(efFromWholeRun(trail, opts)).toBeNull();
  });
});

describe('efficiencyFactorRun', () => {
  it('usa los parciales cuando hay al menos cuatro', () => {
    const conSplits = run({ splits_metric: [split(), split(), split(), split()] });
    expect(efficiencyFactorRun(conSplits, { maxObservedHr: MAX_HR }))
      .toBeCloseTo(efficiencyMPerBeat(3.0, 140), 10);
  });

  it('cae a la carrera entera con menos de cuatro parciales', () => {
    const pocos = run({ moving_time: 2400, splits_metric: [split(), split()] });
    expect(efficiencyFactorRun(pocos, { maxObservedHr: MAX_HR }))
      .toBeCloseTo(efficiencyMPerBeat(3.0, 150), 10);
  });

  it('descarta lo que no es carrera a pie', () => {
    const bici = run({ type: 'Ride', sport_type: 'Ride', moving_time: 2400 });
    expect(efficiencyFactorRun(bici, { maxObservedHr: MAX_HR })).toBeNull();
  });

  it('descarta las salidas de menos de 2 km', () => {
    const corta = run({ distance: 1500, moving_time: 2400 });
    expect(efficiencyFactorRun(corta, { maxObservedHr: MAX_HR })).toBeNull();
  });

  it('devuelve null —no un número— cuando la sesión no es comparable', () => {
    // Serie a FC de umbral: es exactamente el punto que no debe entrar en la serie
    const series = run({ moving_time: 2400, average_heartrate: 182 });
    expect(efficiencyFactorRun(series, { maxObservedHr: MAX_HR })).toBeNull();
    expect(efficiencyFactorRun(null)).toBeNull();
  });
});
