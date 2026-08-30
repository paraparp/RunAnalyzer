// ============================================================================
// raceDistances — tabla ÚNICA de distancias oficiales de carretera.
//
// Estaba repetida en 7 sitios y con valores distintos para la media maratón
// (21097, 21097.5, 21098 m), así que el mismo objetivo daba ritmos y deltas
// ligeramente distintos según la vista. El valor bueno es el oficial de World
// Athletics: 21.0975 km / 42.195 km.
//
// Cada distancia tiene tres nombres porque cada consumidor usa el suyo:
//   key   → clave de almacenamiento y de los selectores ('21k')
//   id    → id canónico de la curva de esfuerzos ('half-marathon')
//   label → etiqueta larga, la que devuelve/espera el modelo ('Media Maratón')
//   short → etiqueta corta de gráficas ('21K')
// ============================================================================

export const RACE_DISTANCES = [
  { key: '5k',  id: '5k',            m: 5000,    label: '5K',            short: '5K'  },
  { key: '10k', id: '10k',           m: 10000,   label: '10K',           short: '10K' },
  { key: '21k', id: 'half-marathon', m: 21097.5, label: 'Media Maratón', short: '21K' },
  { key: '42k', id: 'marathon',      m: 42195,   label: 'Maratón',       short: '42K' },
];

/** Claves soportadas, en orden creciente de distancia. */
export const RACE_KEYS = RACE_DISTANCES.map((d) => d.key);

/** { '5k': 5000, … } metros exactos. */
export const DISTANCE_M = Object.fromEntries(RACE_DISTANCES.map((d) => [d.key, d.m]));

/** { '5k': 5, '21k': 21.0975, … } kilómetros, para dividir tiempos. */
export const DISTANCE_KM = Object.fromEntries(RACE_DISTANCES.map((d) => [d.key, d.m / 1000]));

/** { '21k': 'Media Maratón', … } */
export const LABEL_BY_KEY = Object.fromEntries(RACE_DISTANCES.map((d) => [d.key, d.label]));

/** { 'Media Maratón': 21.0975, … } el inverso, para lo que llega etiquetado. */
export const KM_BY_LABEL = Object.fromEntries(RACE_DISTANCES.map((d) => [d.label, d.m / 1000]));
