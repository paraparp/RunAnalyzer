import { describe, it, expect } from 'vitest';
import {
  detectShoeCategory, categoryLifeKm, shoeLifeKm, isValidLifeKm, sanitizeLifeOverrides,
  SHOE_CATEGORIES, DEFAULT_SHOE_LIFE_KM, MIN_SHOE_LIFE_KM, MAX_SHOE_LIFE_KM,
} from './shoeLife';

describe('detectShoeCategory', () => {
  it.each([
    ['Nike ZoomX Vaporfly Next% 3', 'plated_racer'],
    ['Nike Alphafly 3', 'plated_racer'],
    ['adidas Adizero Adios Pro 4', 'plated_racer'],
    ['ASICS Metaspeed Sky Paris', 'plated_racer'],
    ['Saucony Endorphin Elite', 'plated_racer'],
    ['Hoka Cielo X1', 'plated_racer'],
    ['New Balance FuelCell SC Elite v4 (placa de carbono)', 'plated_racer'],
  ])('%s → placa de carbono', (name, id) => {
    expect(detectShoeCategory(name)).toBe(id);
  });

  it.each([
    ['Nike Streakfly', 'racing_flat'],
    ['adidas Adizero Adios 8', 'racing_flat'],
    ['Hoka Rocket X2', 'plated_racer'],   // la placa gana a la voladora
  ])('%s → %s', (name, id) => {
    expect(detectShoeCategory(name)).toBe(id);
  });

  it.each([
    ['Saucony Endorphin Speed 4', 'tempo_trainer'],
    ['adidas Adizero Boston 12', 'tempo_trainer'],
    ['ASICS Superblast 2', 'tempo_trainer'],
    ['Hoka Mach X', 'tempo_trainer'],
  ])('%s → entreno rápido', (name, id) => {
    expect(detectShoeCategory(name)).toBe(id);
  });

  it.each([
    ['Hoka Speedgoat 5', 'trail'],
    ['Saucony Peregrine 14', 'trail'],
    ['Salomon Sense Ride 5', 'trail'],
    ['Brooks Cascadia 18', 'trail'],
    ['Zapatilla de trail sin marca', 'trail'],
  ])('%s → trail', (name, id) => {
    expect(detectShoeCategory(name)).toBe(id);
  });

  it.each([
    ['Nike Pegasus 41', 'daily_trainer'],
    ['Hoka Clifton 9', 'daily_trainer'],
    ['ASICS Gel-Nimbus 26', 'daily_trainer'],
    ['Brooks Ghost 16', 'daily_trainer'],
    ['New Balance 1080 v13', 'daily_trainer'],
  ])('%s → rodaje', (name, id) => {
    expect(detectShoeCategory(name)).toBe(id);
  });

  it('devuelve null cuando el nombre no dice nada', () => {
    expect(detectShoeCategory('Zapatilla (g1234567)')).toBeNull();
    expect(detectShoeCategory('las azules')).toBeNull();
    expect(detectShoeCategory('')).toBeNull();
    expect(detectShoeCategory('   ')).toBeNull();
    expect(detectShoeCategory(null)).toBeNull();
    expect(detectShoeCategory(undefined)).toBeNull();
  });

  it('ignora mayúsculas y acentos', () => {
    expect(detectShoeCategory('NIKE VAPORFLY')).toBe('plated_racer');
    expect(detectShoeCategory('Zapatillas de tráil')).toBe('trail');
  });

  it('el orden de las categorías es el que resuelve los nombres solapados', () => {
    // "Adios Pro" es placa y "Adios" a secas es voladora: si alguien reordena la
    // tabla y pone racing_flat antes, la placa de carbono deja de detectarse.
    const ids = SHOE_CATEGORIES.map((c) => c.id);
    expect(ids.indexOf('plated_racer')).toBeLessThan(ids.indexOf('racing_flat'));
    expect(ids.indexOf('racing_flat')).toBeLessThan(ids.indexOf('tempo_trainer'));
    expect(detectShoeCategory('adidas Adizero Adios Pro 3')).toBe('plated_racer');
    expect(detectShoeCategory('adidas Adizero Adios 8')).toBe('racing_flat');
  });
});

describe('vida por categoría', () => {
  it('la placa de carbono dura mucho menos que el rodaje', () => {
    expect(categoryLifeKm('plated_racer')).toBeLessThan(categoryLifeKm('daily_trainer'));
    expect(categoryLifeKm('plated_racer')).toBe(250);
  });

  it('las categorías están ordenadas de menos a más vida', () => {
    const vidas = SHOE_CATEGORIES.map((c) => c.lifeKm);
    expect(vidas).toEqual([...vidas].sort((a, b) => a - b));
  });

  it('el rodaje conserva los 800 km que había fijos', () => {
    expect(categoryLifeKm('daily_trainer')).toBe(DEFAULT_SHOE_LIFE_KM);
  });

  it('una categoría inexistente cae al valor por defecto en vez de a NaN', () => {
    expect(categoryLifeKm('inventada')).toBe(DEFAULT_SHOE_LIFE_KM);
    expect(categoryLifeKm(undefined)).toBe(DEFAULT_SHOE_LIFE_KM);
  });
});

describe('isValidLifeKm', () => {
  it('acepta números y textos de input dentro de rango', () => {
    expect(isValidLifeKm(600)).toBe(true);
    expect(isValidLifeKm('600')).toBe(true);
    expect(isValidLifeKm(MIN_SHOE_LIFE_KM)).toBe(true);
    expect(isValidLifeKm(MAX_SHOE_LIFE_KM)).toBe(true);
  });

  it('rechaza lo que rompería la barra de desgaste sin avisar', () => {
    expect(isValidLifeKm(0)).toBe(false);
    expect(isValidLifeKm(-100)).toBe(false);
    expect(isValidLifeKm(100000)).toBe(false);
    expect(isValidLifeKm('')).toBe(false);
    expect(isValidLifeKm('mucho')).toBe(false);
    expect(isValidLifeKm(null)).toBe(false);
    expect(isValidLifeKm(undefined)).toBe(false);
    expect(isValidLifeKm(NaN)).toBe(false);
    expect(isValidLifeKm(Infinity)).toBe(false);
  });
});

describe('shoeLifeKm · precedencia', () => {
  it('el override del atleta manda sobre el tipo detectado', () => {
    const r = shoeLifeKm('Nike Vaporfly 3', 400);
    expect(r.km).toBe(400);
    expect(r.source).toBe('override');
    expect(r.category).toBe('plated_racer'); // el tipo se sigue informando
  });

  it('sin override manda el tipo detectado', () => {
    const r = shoeLifeKm('Nike Vaporfly 3');
    expect(r.km).toBe(250);
    expect(r.source).toBe('category');
    expect(r.category).toBe('plated_racer');
  });

  it('un override inválido NO tumba el cálculo: se ignora y se usa el tipo', () => {
    for (const malo of [0, -1, 'x', null, undefined, 99999]) {
      const r = shoeLifeKm('Hoka Speedgoat 5', malo);
      expect(r.km).toBe(600);
      expect(r.source).toBe('category');
    }
  });

  it('sin nada reconocible cae a los 800 km de siempre', () => {
    const r = shoeLifeKm('Zapatilla (g987)');
    expect(r.km).toBe(DEFAULT_SHOE_LIFE_KM);
    expect(r.source).toBe('default');
    expect(r.category).toBeNull();
  });

  it('la vida devuelta siempre es un número positivo utilizable como divisor', () => {
    for (const nombre of ['', null, 'algo raro', 'Nike Pegasus 41']) {
      expect(shoeLifeKm(nombre).km).toBeGreaterThan(0);
    }
  });

  it('el caso que motivó el arreglo: la misma barra ya no vale para los dos pares', () => {
    // 260 km recorridos: la de placa está para tirar, la de rodaje va por un tercio.
    const km = 260;
    const placa = shoeLifeKm('Nike Alphafly 3').km;
    const rodaje = shoeLifeKm('Hoka Clifton 9').km;
    expect(km / placa).toBeGreaterThan(1);
    expect(km / rodaje).toBeLessThan(0.4);
  });
});

describe('sanitizeLifeOverrides', () => {
  it('deja pasar lo válido y lo normaliza a número', () => {
    expect(sanitizeLifeOverrides({ g1: 500, g2: '650' })).toEqual({ g1: 500, g2: 650 });
  });

  it('descarta valores fuera de rango y claves vacías', () => {
    expect(sanitizeLifeOverrides({ g1: 0, g2: 99999, g3: 'x', '': 500, g4: 700 }))
      .toEqual({ g4: 700 });
  });

  it('un JSON corrupto no envenena la vista entera', () => {
    expect(sanitizeLifeOverrides(null)).toEqual({});
    expect(sanitizeLifeOverrides(undefined)).toEqual({});
    expect(sanitizeLifeOverrides('{}')).toEqual({});
    expect(sanitizeLifeOverrides([1, 2, 3])).toEqual({});
  });
});
