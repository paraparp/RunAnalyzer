// La invariante que justifica este módulo: UN solo CTL. Las cuatro vistas, el
// coach y el MCP tienen que salir del mismo sitio, y `computePMC(activities)` a
// secas —lo que hacían antes— NO es ese sitio.
import { describe, it, expect } from 'vitest';
import { resolveHrCalibration, computeCalibratedPMC, OVERRIDES_KEY } from './loadCalibration';
import { computePMC } from './trainingLoad';
import { DEFAULT_REST_HR } from './hrZones';

// Historial sintético con FCmax detectable y FC media de trabajo.
const historial = (n = 60) => Array.from({ length: n }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (n - i) * 2); // uno cada dos días hasta hoy
  const iso = d.toISOString();
  const speed = 1000 / (5.2 * 60);
  return {
    id: i + 1,
    name: `run ${i + 1}`,
    type: 'Run',
    sport_type: 'Run',
    start_date: iso,
    start_date_local: iso.replace('Z', ''),
    distance: 10000,
    moving_time: Math.round(10000 / speed),
    elapsed_time: Math.round(10000 / speed),
    average_speed: speed,
    average_heartrate: 150,
    max_heartrate: 188,
    total_elevation_gain: 20,
  };
});

const garmin = [{ date: '2026-09-01', restingHR: 52 }];

describe('resolveHrCalibration: la cascada', () => {
  it('sin datos de Garmin la FC de reposo queda como estimada, no como medida', () => {
    const cal = resolveHrCalibration(historial(), {});
    expect(cal.hrrest).toBe(DEFAULT_REST_HR);
    expect(cal.sources.hrrest).toBe('default');
  });

  it('con Garmin usa la medicion real y lo declara', () => {
    const cal = resolveHrCalibration(historial(), { garminData: garmin });
    expect(cal.hrrest).toBe(52);
    expect(cal.sources.hrrest).toBe('garmin');
  });

  it('un override manual valido gana a la deteccion', () => {
    const cal = resolveHrCalibration(historial(), {
      garminData: garmin,
      overrides: { max: 191, rest: 50, lthr: 181 },
    });
    expect(cal).toMatchObject({ hrmax: 191, hrrest: 50, lthr: 181 });
    expect(cal.sources).toEqual({ hrmax: 'manual', hrrest: 'manual', lthr: 'manual' });
  });

  it('un override fuera de rango se ignora y vuelve a la deteccion', () => {
    const cal = resolveHrCalibration(historial(), { overrides: { max: 400, rest: 5, lthr: 999 } });
    expect(cal.hrmax).not.toBe(400);
    expect(cal.hrrest).not.toBe(5);
    expect(cal.lthr).not.toBe(999);
    expect(cal.sources.hrmax).toBe('detected');
  });

  it('la FC de reposo nunca deja una reserva de FC absurda', () => {
    // Sin el tope hrmax-20, un reposo alto dispararia el TRIMP de cualquier rodaje.
    const cal = resolveHrCalibration(historial(), { garminData: [{ date: '2026-09-01', restingHR: 185 }] });
    expect(cal.hrrest).toBeLessThanOrEqual(cal.hrmax - 20);
    expect(cal.hrr).toBeGreaterThanOrEqual(20);
  });

  it('version resume la calibracion y solo se repite si los tres coinciden', () => {
    const a = resolveHrCalibration(historial(), { garminData: garmin });
    const b = resolveHrCalibration(historial(), { garminData: garmin });
    const c = resolveHrCalibration(historial(), {});
    expect(a.version).toBe(b.version);
    expect(a.version).not.toBe(c.version);
    expect(a.version).toContain('hrrest=52');
  });
});

describe('computeCalibratedPMC: es OTRO numero que el computePMC pelado', () => {
  it('el CTL calibrado no coincide con el de los defaults', () => {
    // Justo el fallo reportado: las vistas llamaban a computePMC(activities) sin
    // opts y se llevaban FC reposo 60 + LTHR por formula.
    const acts = historial();
    const { pmc } = computeCalibratedPMC(acts, { garminData: garmin });
    const crudo = computePMC(acts);
    expect(pmc.params.hrrest).toBe(52);
    expect(crudo.params.hrrest).toBe(DEFAULT_REST_HR);
    expect(pmc.current.ctl).not.toBe(crudo.current.ctl);
  });

  it('dos consumidores con las mismas entradas obtienen el MISMO objeto', () => {
    // Es lo que garantiza que Estado, PMC, Lesion y Vitales pinten un solo CTL:
    // misma entrada → misma salida, y ademas memoizada (no se recalcula 4 veces).
    const acts = historial();
    const uno = computeCalibratedPMC(acts, { garminData: garmin });
    const dos = computeCalibratedPMC(acts, { garminData: garmin });
    expect(dos).toBe(uno);
    expect(dos.pmc.current.ctl).toBe(uno.pmc.current.ctl);
  });

  it('un override manual mueve el CTL y la memoizacion no lo enmascara', () => {
    const acts = historial();
    const sin = computeCalibratedPMC(acts, { garminData: garmin });
    const con = computeCalibratedPMC(acts, { garminData: garmin, overrides: { lthr: 181 } });
    expect(con.calibration.version).not.toBe(sin.calibration.version);
    expect(con.pmc.current.ctl).not.toBe(sin.pmc.current.ctl);
  });

  it('sin actividades devuelve pmc null sin reventar', () => {
    expect(computeCalibratedPMC([], {}).pmc).toBeNull();
    expect(computeCalibratedPMC(null, {}).pmc).toBeNull();
  });
});

describe('contrato compartido con el servidor', () => {
  it('la clave de overrides es la que lee el MCP en user_storage', () => {
    expect(OVERRIDES_KEY).toBe('hr_zone_overrides');
  });
});
