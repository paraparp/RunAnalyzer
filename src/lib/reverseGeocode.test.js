import { describe, it, expect } from 'vitest';
import { pickPlaceName, uniqueLabels } from './reverseGeocode';

describe('pickPlaceName', () => {
  it('prefiere el nombre más específico disponible', () => {
    expect(pickPlaceName({ address: { suburb: 'Chamberí', city: 'Madrid' } }))
      .toMatchObject({ local: 'Chamberí', area: 'Madrid' });
  });

  it('respeta el orden de especificidad: barrio gana a distrito y a pueblo', () => {
    const addr = {
      neighbourhood: 'Ríos Rosas',
      suburb: 'Chamberí',
      city_district: 'Centro',
      city: 'Madrid',
    };
    expect(pickPlaceName({ address: addr }).local).toBe('Ríos Rosas');
  });

  it('en un pueblo sin barrios usa el pueblo y da la provincia como área', () => {
    expect(pickPlaceName({ address: { village: 'Rascafría', county: 'Madrid', state: 'Comunidad de Madrid' } }))
      .toMatchObject({ local: 'Rascafría', area: 'Madrid' });
  });

  it('no repite el mismo topónimo como nombre y como área', () => {
    const { local, area } = pickPlaceName({ address: { town: 'Cercedilla', city: 'Cercedilla', state: 'Madrid' } });
    expect(local).toBe('Cercedilla');
    expect(area).not.toBe('Cercedilla');
    expect(area).toBe('Madrid');
  });

  it('si no hay nada específico, el área hace de nombre y no queda desambiguador', () => {
    expect(pickPlaceName({ address: { city: 'Valladolid', state: 'Castilla y León' } }))
      .toMatchObject({ local: 'Valladolid', area: null });
  });

  it('aguanta respuestas vacías, de error o sin address', () => {
    const none = { local: null, area: null, context: null };
    expect(pickPlaceName(null)).toEqual(none);
    expect(pickPlaceName({})).toEqual(none);
    expect(pickPlaceName({ error: 'Unable to geocode' })).toEqual(none);
    expect(pickPlaceName({ address: {} })).toEqual(none);
  });
});

describe('pickPlaceName › contexto', () => {
  it('encadena la jerarquía administrativa de dentro a fuera', () => {
    const { context } = pickPlaceName({ address: {
      suburb: 'Chamberí', city: 'Madrid', state: 'Comunidad de Madrid', country: 'España',
    } });
    expect(context).toBe('Madrid, Comunidad de Madrid, España');
  });

  it('nunca repite el propio nombre dentro del contexto', () => {
    const { local, context } = pickPlaceName({ address: {
      town: 'Cercedilla', city: 'Cercedilla', county: 'Madrid', country: 'España',
    } });
    expect(local).toBe('Cercedilla');
    expect(context).toBe('Madrid, España');
  });

  it('colapsa los escalones duplicados de un municipio pequeño', () => {
    // En pueblos, city/town/municipality suelen traer la misma cadena.
    const { context } = pickPlaceName({ address: {
      neighbourhood: 'El Ventorrillo',
      city: 'Navacerrada', town: 'Navacerrada', municipality: 'Navacerrada',
      state: 'Comunidad de Madrid',
    } });
    expect(context).toBe('Navacerrada, Comunidad de Madrid');
  });

  it('se corta a tres escalones para no desbordar la fila', () => {
    const { context } = pickPlaceName({ address: {
      suburb: 'X', city: 'A', county: 'B', state: 'C', country: 'D',
    } });
    expect(context.split(', ')).toHaveLength(3);
    expect(context).toBe('A, B, C');
  });

  it('es null cuando no hay nada por encima del nombre', () => {
    expect(pickPlaceName({ address: { city: 'Madrid' } }).context).toBeNull();
  });
});

describe('uniqueLabels', () => {
  it('deja los nombres tal cual cuando ya son distintos', () => {
    expect(uniqueLabels([
      { key: 'a', local: 'Chamberí', area: 'Madrid' },
      { key: 'b', local: 'Rascafría', area: 'Madrid' },
    ])).toEqual({ a: 'Chamberí', b: 'Rascafría' });
  });

  it('desambigua con el área cuando dos cúmulos resuelven al mismo nombre', () => {
    expect(uniqueLabels([
      { key: 'a', local: 'Centro', area: 'Madrid' },
      { key: 'b', local: 'Centro', area: 'Valladolid' },
    ])).toEqual({ a: 'Centro (Madrid)', b: 'Centro (Valladolid)' });
  });

  it('recurre a un ordinal cuando ni el área desambigua', () => {
    const out = uniqueLabels([
      { key: 'a', local: 'Centro', area: 'Madrid' },
      { key: 'b', local: 'Centro', area: 'Madrid' },
    ]);
    expect(out.a).toBe('Centro (Madrid)');
    expect(out.b).toBe('Centro (Madrid) 2');
    expect(new Set(Object.values(out)).size).toBe(2);
  });

  it('nunca produce dos etiquetas iguales, ni en el caso feo', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, local: 'Centro', area: null }));
    const out = uniqueLabels(entries);
    expect(Object.keys(out)).toHaveLength(5);
    expect(new Set(Object.values(out)).size).toBe(5);
  });

  it('descarta las entradas sin nombre en vez de inventarlo', () => {
    expect(uniqueLabels([
      { key: 'a', local: null, area: null },
      { key: 'b', local: 'Chamberí', area: null },
    ])).toEqual({ b: 'Chamberí' });
  });

  it('es determinista', () => {
    const entries = [
      { key: 'a', local: 'Centro', area: 'Madrid' },
      { key: 'b', local: 'Centro', area: 'Madrid' },
      { key: 'c', local: 'Chamberí', area: 'Madrid' },
    ];
    expect(uniqueLabels(entries)).toEqual(uniqueLabels(entries));
  });
});
