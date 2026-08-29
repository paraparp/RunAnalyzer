import { describe, it, expect, beforeEach, vi } from 'vitest';

// cloudStorage habla con Supabase; aquí basta un almacén en memoria con la misma API.
const store = new Map();
vi.mock('./cloudStorage', () => ({
  default: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
}));

const {
  saveTargetRace, setPrimaryTargetRace, getPrimaryTargetRace, getTargetRaces,
  parseTimeToMinutes, formatMinutes, DISTANCES, normalizeStartTime, stampPlan,
} = await import('./targetRaces');

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

describe('carrera objetivo principal', () => {
  beforeEach(() => store.clear());

  it('la primera carrera que se añade queda como principal', () => {
    saveTargetRace({ name: 'Maratón', date: day(90), distance: '42k' });
    expect(getPrimaryTargetRace().name).toBe('Maratón');
  });

  it('añadir otra carrera NO le quita el puesto a la principal marcada', () => {
    saveTargetRace({ name: 'Maratón', date: day(90), distance: '42k' });
    const maraton = getTargetRaces()[0];
    setPrimaryTargetRace(maraton.id);

    saveTargetRace({ name: '10K del club', date: day(10), distance: '10k' });

    expect(getPrimaryTargetRace().name).toBe('Maratón');
  });

  it('sin marca explícita, añadir una carrera más cercana tampoco cambia la principal', () => {
    saveTargetRace({ name: 'Maratón', date: day(90), distance: '42k' });
    saveTargetRace({ name: '10K del club', date: day(10), distance: '10k' });

    expect(getPrimaryTargetRace().name).toBe('Maratón');
  });

  it('marcar otra como principal desmarca la anterior', () => {
    saveTargetRace({ name: 'Maratón', date: day(90), distance: '42k' });
    saveTargetRace({ name: '10K del club', date: day(10), distance: '10k' });
    const diez = getTargetRaces().find(r => r.name === '10K del club');

    setPrimaryTargetRace(diez.id);

    expect(getPrimaryTargetRace().name).toBe('10K del club');
    expect(getTargetRaces().filter(r => r.primary)).toHaveLength(1);
  });

  it('quitar la marca devuelve el mando a la más próxima', () => {
    saveTargetRace({ name: 'Maratón', date: day(90), distance: '42k' });
    saveTargetRace({ name: '10K del club', date: day(10), distance: '10k' });
    setPrimaryTargetRace(null);

    expect(getPrimaryTargetRace().name).toBe('10K del club');
  });

  it('editar una carrera no altera quién es la principal', () => {
    saveTargetRace({ name: 'Maratón', date: day(90), distance: '42k' });
    saveTargetRace({ name: '10K del club', date: day(10), distance: '10k' });
    const diez = getTargetRaces().find(r => r.name === '10K del club');

    saveTargetRace({ ...diez, goalTimeMin: 40 });

    expect(getPrimaryTargetRace().name).toBe('Maratón');
  });
});

describe('tiempo objetivo y ritmo medio', () => {
  it('el ritmo sale del tiempo con la distancia oficial de la prueba', () => {
    // Media maratón (21.0975 km) en 1:38:00 → 4:38.7 → 4:39/km
    expect(formatMinutes(parseTimeToMinutes('1:38:00') / DISTANCES['21k'])).toBe('4:39');
    // Maratón (42.195 km) en 3:30:00 → 4:59/km
    expect(formatMinutes(parseTimeToMinutes('3:30:00') / DISTANCES['42k'])).toBe('4:59');
  });

  it('el tiempo sale del ritmo', () => {
    expect(formatMinutes(parseTimeToMinutes('4:00') * DISTANCES['10k'])).toBe('40:00');
    expect(formatMinutes(parseTimeToMinutes('3:57') * DISTANCES['5k'])).toBe('19:45');
  });

  it('ida y vuelta no desvía el tiempo original', () => {
    const pace = parseTimeToMinutes('1:38:00') / DISTANCES['21k'];
    expect(formatMinutes(pace * DISTANCES['21k'])).toBe('1:38:00');
  });
});

describe('hora de salida', () => {
  it('normaliza a HH:MM y acepta el hueco vacío', () => {
    expect(normalizeStartTime('7:30')).toBe('07:30');
    expect(normalizeStartTime(' 09:05 ')).toBe('09:05');
    expect(normalizeStartTime('')).toBe('');
    expect(normalizeStartTime(undefined)).toBe('');
  });

  it('rechaza horas imposibles o mal escritas', () => {
    expect(normalizeStartTime('24:00')).toBeNull();
    expect(normalizeStartTime('08:60')).toBeNull();
    expect(normalizeStartTime('mañana')).toBeNull();
  });

  it('viaja con la carrera', () => {
    store.clear();
    saveTargetRace({ name: 'Media', date: day(30), distance: '21k', startTime: '09:00' });
    expect(getTargetRaces()[0].startTime).toBe('09:00');
  });
});

describe('fecha de actualización del plan', () => {
  it('se sella al cambiar el texto del plan', () => {
    const stamped = stampPlan({ plan: 'semana 1' }, { plan: '' });
    expect(stamped.planUpdatedAt).toBeTruthy();
  });

  it('no se toca si el plan no cambia', () => {
    const prev = { plan: 'igual', planUpdatedAt: '2026-01-01T00:00:00.000Z' };
    expect(stampPlan({ ...prev, name: 'otro nombre' }, prev).planUpdatedAt).toBe(prev.planUpdatedAt);
  });

  it('borrar el plan quita el sello', () => {
    const prev = { plan: 'algo', planUpdatedAt: '2026-01-01T00:00:00.000Z' };
    expect(stampPlan({ ...prev, plan: '' }, prev).planUpdatedAt).toBeUndefined();
  });
});
