// Regresiones de los seis fallos que salieron usando el MCP con un agente. Cada
// bloque fija el caso REAL que los destapó, con los números que devolvió el
// servidor, para que no vuelvan sin que un test se entere.
import { describe, it, expect } from 'vitest';
import {
  normalizeWeatherTemps, wbgtFromCelsius, heatPenaltyPct, heatIntensityFactor,
} from './garmin-helpers.js';

describe('normalizeWeatherTemps: el arbitro degenerado con humedad alta', () => {
  // A 100 % de humedad el punto de rocio es IGUAL a la temperatura del aire en
  // cualquier escala, asi que las dos hipotesis de unidad explican el dato con
  // error ~0 y quien ganaba era el ruido de coma flotante. Salia en las dos
  // direcciones: unas sesiones se quedaban en °F y otras se convertian de mas.
  it('55 °F al 100 % no se sirve como 55 °C (sesion del 1 de septiembre)', () => {
    const n = normalizeWeatherTemps(55, 55, 100);
    expect(n.temp_c).toBeCloseTo(12.8, 1);
    expect(n.dew_point_c).toBeCloseTo(12.8, 1);
    expect(wbgtFromCelsius(n.temp_c, 100)).toBeCloseTo(17.0, 1);
  });

  it('14 °C al 100 % no se convierte como si fueran °F (WBGT −2,1)', () => {
    const n = normalizeWeatherTemps(14, 14, 100);
    expect(n.temp_c).toBeCloseTo(14, 1);
    expect(wbgtFromCelsius(n.temp_c, 100)).toBeGreaterThan(0);
  });

  it('el WBGT de la sesion de septiembre deja de dar 96,7', () => {
    // El valor viejo: 0,567·55 + 0,393·e(55,100) + 3,94.
    expect(wbgtFromCelsius(55, 100)).toBeCloseTo(96.7, 1); // la formula no cambia
    const n = normalizeWeatherTemps(55, 55, 100);
    expect(wbgtFromCelsius(n.temp_c, 100)).toBeLessThan(25); // lo que cambia es la entrada
  });

  it('la penalizacion por calor cae de ~10 % a ~1 % en esa sesion', () => {
    const n = normalizeWeatherTemps(55, 55, 100);
    const wbgt = wbgtFromCelsius(n.temp_c, 100);
    // Rodaje suave: ~78 % FCmax → factor de intensidad bien por debajo de 1.
    const session = heatPenaltyPct(wbgt) * heatIntensityFactor(78);
    expect(session).toBeLessThan(2);
    expect(heatPenaltyPct(96.7)).toBe(20); // lo que daba antes, con tope
  });
});

describe('normalizeWeatherTemps: el arbitro sigue mandando cuando SI decide', () => {
  it('resuelve °F por debajo del umbral de magnitud (41 °F / 32 °F)', () => {
    // 41 <= 45, asi que el respaldo por magnitud lo dejaria en 41 °C. El rocio
    // desempata sin ambiguedad: solo la lectura en °F es coherente con 70 % HR.
    const n = normalizeWeatherTemps(41, 32, 70);
    expect(n.temp_c).toBeCloseTo(5, 1);
    expect(n.dew_point_c).toBeCloseTo(0, 1);
    expect(n.unit_source).toBe('dew_point');
  });

  it('68 °F / 50 °F al 52 % se resuelven a 20 °C / 10 °C', () => {
    const n = normalizeWeatherTemps(68, 50, 52);
    expect(n.temp_c).toBeCloseTo(20, 1);
    expect(n.dew_point_c).toBeCloseTo(10, 1);
    expect(n.unit_source).toBe('dew_point');
  });

  it('cae al umbral de magnitud cuando las dos hipotesis empatan', () => {
    expect(normalizeWeatherTemps(55, 55, 100).unit_source).toBe('threshold');
  });
});

describe('normalizeWeatherTemps: coherencia e idempotencia', () => {
  it('nunca mezcla unidades dentro de la misma actividad', () => {
    // El rocio siempre queda en la MISMA escala que el aire: nunca uno en °C y
    // otro en °F, que es lo que permitia elegirlos por separado.
    for (const [t, d, h] of [[55, 54, 96], [68, 50, 52], [41, 32, 70], [20, 10, 52], [5, 3, 85]]) {
      const n = normalizeWeatherTemps(t, d, h);
      expect(n.dew_point_c).toBeLessThanOrEqual(n.temp_c + 0.5);
      expect(n.temp_c).toBeLessThan(45);
    }
  });

  it('es idempotente sobre valores ya en °C', () => {
    for (const [t, d, h] of [[12.8, 12.8, 100], [20, 10, 52], [5, 3, 85], [10, 10, 100]]) {
      const once = normalizeWeatherTemps(t, d, h);
      const twice = normalizeWeatherTemps(once.temp_c, once.dew_point_c, h);
      expect(twice.temp_c).toBeCloseTo(once.temp_c, 6);
      expect(twice.dew_point_c).toBeCloseTo(once.dew_point_c, 6);
    }
  });

  it('sin rocio o sin humedad usa el umbral y lo aplica a los dos campos', () => {
    expect(normalizeWeatherTemps(55, null, null)).toMatchObject({ unit_source: 'threshold' });
    expect(normalizeWeatherTemps(55, null, null).temp_c).toBeCloseTo(12.8, 1);
    expect(normalizeWeatherTemps(20, null, null).temp_c).toBe(20);
    expect(normalizeWeatherTemps(null, null, 80)).toMatchObject({ temp_c: null, dew_point_c: null });
  });
});
