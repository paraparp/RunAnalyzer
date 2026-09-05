import { describe, it, expect } from 'vitest';
import {
  RACE_DISTANCES, RACE_KEYS, DISTANCE_M, DISTANCE_KM, LABEL_BY_KEY, KM_BY_LABEL,
} from './raceDistances';

// El motivo de que este módulo exista es que la media maratón estaba escrita con
// tres valores distintos en siete sitios. Estos tests fijan el valor oficial y,
// sobre todo, que los seis mapas derivados no se puedan desincronizar entre sí.

describe('valores oficiales de World Athletics', () => {
  it('la media maratón son 21097.5 m exactos', () => {
    expect(DISTANCE_M['21k']).toBe(21097.5);
    expect(DISTANCE_KM['21k']).toBe(21.0975);
  });

  it('la maratón son 42195 m exactos', () => {
    expect(DISTANCE_M['42k']).toBe(42195);
    expect(DISTANCE_KM['42k']).toBe(42.195);
  });

  it('la maratón mide exactamente el doble que la media', () => {
    expect(DISTANCE_M['42k']).toBeCloseTo(DISTANCE_M['21k'] * 2, 6);
  });

  it('5K y 10K son redondas', () => {
    expect(DISTANCE_M['5k']).toBe(5000);
    expect(DISTANCE_M['10k']).toBe(10000);
  });
});

describe('integridad de la tabla', () => {
  it('las claves están en orden creciente de distancia', () => {
    const metros = RACE_DISTANCES.map((d) => d.m);
    expect(metros).toEqual([...metros].sort((a, b) => a - b));
    expect(RACE_KEYS).toEqual(['5k', '10k', '21k', '42k']);
  });

  it('no hay claves, ids ni etiquetas repetidas', () => {
    for (const campo of ['key', 'id', 'label', 'short']) {
      const vals = RACE_DISTANCES.map((d) => d[campo]);
      expect(new Set(vals).size).toBe(vals.length);
    }
  });

  it('cada entrada trae los cuatro nombres que espera algún consumidor', () => {
    for (const d of RACE_DISTANCES) {
      expect(typeof d.key).toBe('string');
      expect(typeof d.id).toBe('string');
      expect(typeof d.label).toBe('string');
      expect(typeof d.short).toBe('string');
      expect(d.m).toBeGreaterThan(0);
    }
  });
});

describe('mapas derivados', () => {
  it('todos cubren exactamente las mismas claves', () => {
    for (const mapa of [DISTANCE_M, DISTANCE_KM, LABEL_BY_KEY]) {
      expect(Object.keys(mapa).sort()).toEqual([...RACE_KEYS].sort());
    }
  });

  it('DISTANCE_KM es DISTANCE_M / 1000, sin redondeos por el camino', () => {
    for (const k of RACE_KEYS) {
      expect(DISTANCE_KM[k]).toBe(DISTANCE_M[k] / 1000);
    }
  });

  it('KM_BY_LABEL es el inverso exacto de LABEL_BY_KEY', () => {
    for (const k of RACE_KEYS) {
      expect(KM_BY_LABEL[LABEL_BY_KEY[k]]).toBe(DISTANCE_KM[k]);
    }
    expect(Object.keys(KM_BY_LABEL)).toHaveLength(RACE_KEYS.length);
  });

  it("la clave se indexa en minúsculas (el planificador manda '21K')", () => {
    // athleteContext.buildPrompt hace DISTANCE_KM[goal.distance.toLowerCase()];
    // si alguien mete una clave en mayúsculas aquí, ese lookup se rompe.
    for (const k of RACE_KEYS) expect(k).toBe(k.toLowerCase());
  });
});
