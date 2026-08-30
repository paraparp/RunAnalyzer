import { describe, it, expect } from 'vitest';
import { computeSplitDecoupling, decouplingPct } from './decoupling';

// Un parcial de 1 km: velocidad en m/s a partir del ritmo en min/km.
const km = (paceMin, hr, split) => ({
  split,
  distance: 1000,
  moving_time: paceMin * 60,
  average_speed: 1000 / (paceMin * 60),
  average_heartrate: hr,
});

const steady = [1, 2, 3, 4, 5, 6].map((i) => km(5, 150, i));

describe('signo de la deriva', () => {
  it('aflojar el ritmo a la misma FC es deriva POSITIVA', () => {
    // 1ª mitad a 5:00, 2ª a 5:30 con FC clavada: la eficiencia cae.
    const splits = [km(5, 150, 1), km(5, 150, 2), km(5, 150, 3), km(5.5, 150, 4), km(5.5, 150, 5), km(5.5, 150, 6)];
    const pct = decouplingPct(splits);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeCloseTo(10, 0);   // 5:30/5:00 − 1 = +10%
  });

  it('subir la FC al mismo ritmo también es deriva positiva', () => {
    const splits = [km(5, 140, 1), km(5, 140, 2), km(5, 140, 3), km(5, 154, 4), km(5, 154, 5), km(5, 154, 6)];
    expect(decouplingPct(splits)).toBeCloseTo(10, 0);
  });

  it('una sesión clavada no deriva', () => {
    expect(decouplingPct(steady)).toBeCloseTo(0, 6);
  });

  it('apretar al final es deriva negativa (negative split)', () => {
    const splits = [km(5.5, 150, 1), km(5.5, 150, 2), km(5.5, 150, 3), km(5, 150, 4), km(5, 150, 5), km(5, 150, 6)];
    expect(decouplingPct(splits)).toBeLessThan(0);
  });
});

describe('cómo se agrega cada tramo', () => {
  it('la FC del tramo se pondera por tiempo, no por número de parciales', () => {
    // 2ª mitad: km a 4:00 con 140 ppm y km a 6:00 con 160 ppm. Por conteo la FC
    // media sería 150 (deriva 0); el km lento dura 1,5 veces más, así que la FC
    // real del tramo es 152 y la deriva sale positiva.
    const splits = [km(5, 150, 1), km(5, 150, 2), km(4, 140, 3), km(6, 160, 4)];
    const d = computeSplitDecoupling(splits);
    expect(d.final.avg_hr).toBeCloseTo(152, 6);
    expect(d.pct).toBeGreaterThan(0);
  });

  it('la velocidad del tramo es distancia/tiempo, no la media de las velocidades', () => {
    // Un km a 4:00 y otro a 6:00 son 2 km en 10 min: 3,33 m/s (5:00/km).
    // Promediar las dos velocidades daría 3,47 m/s, que no corresponde a nada.
    const splits = [km(5, 150, 1), km(5, 150, 2), km(4, 150, 3), km(6, 150, 4)];
    const d = computeSplitDecoupling(splits);
    expect(d.final.avg_speed_ms).toBeCloseTo(1000 / 300, 6);
    expect(d.pct).toBeCloseTo(0, 6);
  });
});

describe('cuándo no se puede calcular', () => {
  it('sin parciales dice por qué', () => {
    expect(computeSplitDecoupling([])).toEqual({ pct: null, reason: 'no_splits' });
    expect(computeSplitDecoupling(null)).toEqual({ pct: null, reason: 'no_splits' });
  });

  it('con menos parciales válidos de los que pide la ventana', () => {
    expect(computeSplitDecoupling(steady.slice(0, 3)).reason).toBe('few_splits');
    expect(computeSplitDecoupling(steady, { window: 'durability' }).reason).toBe('few_splits');
  });

  it('descarta parciales sin FC o demasiado cortos', () => {
    const sucios = steady.map((s) => ({ ...s, distance: 300 }));
    expect(computeSplitDecoupling(sucios).reason).toBe('few_splits');
  });

  it('una ventana inexistente es un error de programación, no un null', () => {
    expect(() => computeSplitDecoupling(steady, { window: 'inventada' })).toThrow();
  });
});

describe('ventana durability', () => {
  const long = Array.from({ length: 16 }, (_, i) => km(i < 12 ? 5 : 5.5, 150, i + 1));

  it('compara km 5–10 con el último 25% e ignora el calentamiento', () => {
    const d = computeSplitDecoupling(long, { window: 'durability' });
    expect(d.initial.window).toBe('km 5–10');
    expect(d.final.window).toBe('último 25% (4 km)');
    expect(d.pct).toBeCloseTo(10, 0);
    expect(d.initial.avg_hr).toBeCloseTo(150, 6);
  });

  it('da un número distinto de la ventana por mitades: miden cosas distintas', () => {
    const mitades = computeSplitDecoupling(long).pct;
    const durab = computeSplitDecoupling(long, { window: 'durability' }).pct;
    expect(mitades).not.toBeCloseTo(durab, 3);
  });
});
