import { describe, it, expect } from 'vitest';
import { routeSignature, jaccard, similarity, groupRoutes, routineIndex, CELL_M } from './routeSimilarity';

const ORIGIN = [40.4168, -3.7038];

// Un tramo recto hacia el norte de `km` kilómetros, muestreado cada 50 m, con un
// ruido opcional para imitar la dispersión del GPS entre dos vueltas iguales.
const leg = (km, { jitter = 0, from = ORIGIN } = {}) => {
  const pts = [];
  const steps = Math.round((km * 1000) / 50);
  for (let i = 0; i <= steps; i++) {
    const wobble = jitter ? (Math.sin(i * 1.7) * jitter) / 111000 : 0;
    pts.push([from[0] + (i * 50) / 110574 + wobble, from[1] + wobble]);
  }
  return pts;
};

const route = (id, positions) => ({ id, positions });

describe('routeSignature', () => {
  it('reduce la traza a las celdas que pisa, no a sus puntos', () => {
    const sig = routeSignature(leg(1), ORIGIN);
    // 1 km muestreado cada 50 m son 21 puntos; en celdas de 100 m son ~11.
    expect(sig.size).toBeLessThan(21);
    expect(sig.size).toBeGreaterThanOrEqual(8);
  });

  it('el origen común es lo que alinea las celdas', () => {
    const a = routeSignature(leg(1), ORIGIN);
    const b = routeSignature(leg(1), ORIGIN);
    expect(jaccard(a, b)).toBe(1);
  });

  it('aguanta entrada vacía', () => {
    expect(routeSignature([], ORIGIN).size).toBe(0);
    expect(routeSignature(null, ORIGIN).size).toBe(0);
  });

  it('el tamaño de celda cambia la resolución', () => {
    const fina = routeSignature(leg(2), ORIGIN, { cellM: 50 });
    const gruesa = routeSignature(leg(2), ORIGIN, { cellM: CELL_M });
    expect(fina.size).toBeGreaterThan(gruesa.size);
  });
});

describe('jaccard', () => {
  it('1 para conjuntos idénticos, 0 para disjuntos', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('mide el solape parcial', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3, 6);
  });

  it('es simétrico y no explota con vacíos', () => {
    const a = new Set(['a', 'b']), b = new Set(['b']);
    expect(jaccard(a, b)).toBe(jaccard(b, a));
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(a, new Set())).toBe(0);
  });
});

describe('similarity', () => {
  it('sobrevive al ruido del GPS entre dos vueltas iguales', () => {
    const limpia = routeSignature(leg(2), ORIGIN);
    const ruidosa = routeSignature(leg(2, { jitter: 25 }), ORIGIN);
    expect(similarity(limpia, ruidosa)).toBeGreaterThan(0.9);
  });

  it('sobrevive a que la traza vaya justo por el borde de la rejilla', () => {
    // El caso que rompía el Jaccard crudo: oscilar un metro salta de columna y
    // duplica las celdas, y la traza dejaba de parecerse a sí misma.
    const borde = routeSignature(leg(2, { from: ORIGIN }), ORIGIN);
    const borde2 = routeSignature(leg(2, { from: ORIGIN, jitter: 3 }), ORIGIN);
    expect(similarity(borde, borde2)).toBeGreaterThan(0.9);
  });

  it('la tolerancia no llega a fundir recorridos separados de verdad', () => {
    const norte = routeSignature(leg(3), ORIGIN);
    const lejos = routeSignature(leg(3, { from: [ORIGIN[0], ORIGIN[1] + 0.02] }), ORIGIN);
    expect(similarity(norte, lejos)).toBe(0);
  });

  it('es simétrico y devuelve 0 con un conjunto vacío', () => {
    const a = routeSignature(leg(2), ORIGIN);
    const b = routeSignature(leg(3), ORIGIN);
    expect(similarity(a, b)).toBe(similarity(b, a));
    expect(similarity(a, new Set())).toBe(0);
  });

  it('la cobertura mínima castiga la diferencia de longitud', () => {
    // El corto está contenido al 100% en el largo, pero el largo no en el corto.
    const corto = routeSignature(leg(3), ORIGIN);
    const largo = routeSignature(leg(9), ORIGIN);
    expect(similarity(corto, largo)).toBeLessThan(0.5);
  });
});

describe('groupRoutes', () => {
  it('junta las repeticiones de la misma vuelta en un grupo', () => {
    const groups = groupRoutes([
      route(1, leg(3)),
      route(2, leg(3, { jitter: 20 })),
      route(3, leg(3, { jitter: 35 })),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].size).toBe(3);
  });

  it('separa recorridos que van a sitios distintos', () => {
    const norte = leg(3);
    const este = leg(3).map(([lat, lng]) => [ORIGIN[0], lng + (lat - ORIGIN[0])]);
    const groups = groupRoutes([route(1, norte), route(2, este)]);
    expect(groups).toHaveLength(2);
  });

  it('un 3 km contenido en un 9 km NO es la misma ruta', () => {
    // El corto está cubierto al 100% por el largo, pero el largo solo a un tercio
    // por el corto: la cobertura mínima los separa, que es lo correcto.
    const groups = groupRoutes([route(1, leg(9)), route(2, leg(3))]);
    expect(groups).toHaveLength(2);
  });

  it('la vuelta en sentido contrario cuenta como la misma ruta', () => {
    const ida = leg(4);
    const vuelta = [...leg(4)].reverse();
    expect(groupRoutes([route(1, ida), route(2, vuelta)])).toHaveLength(1);
  });

  it('el representante de cada grupo es la traza más larga, no la primera', () => {
    const groups = groupRoutes([route('corta', leg(3)), route('larga', leg(3.4))]);
    expect(groups[0].id).toBe('larga');
  });

  it('es determinista: el orden de entrada no cambia el resultado', () => {
    const rutas = [route(1, leg(3)), route(2, leg(6)), route(3, leg(3, { jitter: 20 }))];
    const a = groupRoutes(rutas);
    const b = groupRoutes([...rutas].reverse());
    expect(b.map(g => g.id)).toEqual(a.map(g => g.id));
    expect(b.map(g => g.size)).toEqual(a.map(g => g.size));
  });

  it('descarta trazas vacías o de un solo punto y aguanta la lista vacía', () => {
    expect(groupRoutes([])).toEqual([]);
    expect(groupRoutes(null)).toEqual([]);
    expect(groupRoutes([route(1, []), route(2, [ORIGIN])])).toEqual([]);
  });
});

describe('routineIndex', () => {
  it('siempre la misma vuelta: repetición 100, una sola ruta', () => {
    const groups = groupRoutes([route(1, leg(3)), route(2, leg(3)), route(3, leg(3))]);
    const idx = routineIndex(groups);
    expect(idx.distinct).toBe(1);
    expect(idx.total).toBe(3);
    expect(idx.topShare).toBe(100);
    expect(idx.repetition).toBe(100);
  });

  it('nunca repites: repetición 0', () => {
    const groups = [
      { id: 1, memberIds: [1], size: 1 },
      { id: 2, memberIds: [2], size: 1 },
      { id: 3, memberIds: [3], size: 1 },
    ];
    const idx = routineIndex(groups);
    expect(idx.distinct).toBe(3);
    expect(idx.repetition).toBe(0);
    expect(idx.topShare).toBeCloseTo(33.33, 1);
  });

  it('el caso intermedio queda entre medias', () => {
    const groups = [
      { id: 1, memberIds: [1, 2, 3], size: 3 },
      { id: 4, memberIds: [4], size: 1 },
    ];
    const idx = routineIndex(groups);
    expect(idx.repetition).toBeGreaterThan(0);
    expect(idx.repetition).toBeLessThan(100);
    expect(idx.topShare).toBe(75);
  });

  it('una sola salida no tiene variedad que medir', () => {
    expect(routineIndex([{ id: 1, memberIds: [1], size: 1 }]))
      .toMatchObject({ distinct: 1, total: 1, repetition: 100 });
  });

  it('sin grupos devuelve ceros en vez de NaN', () => {
    expect(routineIndex([])).toEqual({ distinct: 0, total: 0, topShare: 0, repetition: 0 });
    expect(routineIndex(null)).toEqual({ distinct: 0, total: 0, topShare: 0, repetition: 0 });
  });
});
