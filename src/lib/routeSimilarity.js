// ── Índice de rutina: cuántas rutas DISTINTAS haces en un sitio ──────────────
// Un cúmulo geográfico dice dónde sales, no por dónde vas. Dos atletas con el
// mismo "50 km en el parque" pueden estar haciendo siempre exactamente la misma
// vuelta, o veinte recorridos diferentes. Ese matiz no está en ninguna métrica
// que dé Strava, y es el que separa la rutina de la exploración.
//
// Cómo se mide: cada traza se reduce al CONJUNTO DE CELDAS de ~100 m que pisa, y
// dos trazas se parecen según cuánto se cubren mutuamente. La rejilla absorbe el
// ruido del GPS —dos vueltas idénticas nunca dan los mismos puntos, pero sí casi
// las mismas celdas— y comparar conjuntos, en vez de secuencias, hace que dar la
// vuelta al circuito al revés siga contando como el mismo recorrido, que es lo
// que uno querría.
//
// La comparación es a MÍNIMO DE COBERTURAS con tolerancia de una celda, no un
// Jaccard crudo, por dos motivos que se ven en cuanto lo pruebas con datos
// reales:
//   · Una traza que corre paralela al borde de la rejilla salta entre dos
//     columnas de celdas con oscilar un metro, y dejaría de parecerse a sí misma.
//     Aceptar las 8 celdas vecinas mata ese artefacto.
//   · La cobertura mínima sigue penalizando la diferencia de longitud, que es lo
//     que queremos: un 5 km contenido en un 10 km está cubierto al 100%, pero el
//     10 km solo lo está al 50%, así que quedan separados. No son la misma ruta.
//
// Puro: recibe posiciones ya decodificadas, no toca red ni polyline.

/** Lado de la celda de la rejilla, en metros. Con la tolerancia vecina, dos
 *  trazas se dan por iguales si van a menos de ~100–140 m la una de la otra. */
export const CELL_M = 100;

/** Cobertura mutua a partir de la cual dos trazas son la misma ruta. */
export const SAME_ROUTE = 0.6;

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320;
const toRad = (d) => (d * Math.PI) / 180;

/**
 * Conjunto de celdas que pisa una traza. El origen de la rejilla se pasa desde
 * fuera (`origin`) y es común a todas las trazas del mismo sitio: si cada una
 * usara el suyo, las celdas no alinearían y nada se parecería a nada.
 */
export function routeSignature(positions, origin, { cellM = CELL_M } = {}) {
  const cells = new Set();
  const kx = M_PER_DEG_LNG * Math.cos(toRad(origin[0]));
  for (const [lat, lng] of positions ?? []) {
    const x = Math.floor(((lng - origin[1]) * kx) / cellM);
    const y = Math.floor(((lat - origin[0]) * M_PER_DEG_LAT) / cellM);
    cells.add(`${x},${y}`);
  }
  return cells;
}

/** Índice de Jaccard entre dos conjuntos: |A∩B| / |A∪B|. 0 si ambos vacíos. */
export function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const c of small) if (big.has(c)) inter++;
  return inter / (a.size + b.size - inter);
}

// Las 9 celdas del entorno (la propia incluida). Es la tolerancia que impide que
// una traza pegada al borde de la rejilla deje de parecerse a sí misma.
const NEIGHBOURHOOD = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 0], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/** Fracción de celdas de `a` que `b` pisa, admitiendo una celda de desvío. */
function coverage(a, b) {
  if (!a.size) return 0;
  let hit = 0;
  for (const cell of a) {
    const comma = cell.indexOf(',');
    const x = Number(cell.slice(0, comma));
    const y = Number(cell.slice(comma + 1));
    for (const [dx, dy] of NEIGHBOURHOOD) {
      if (b.has(`${x + dx},${y + dy}`)) { hit++; break; }
    }
  }
  return hit / a.size;
}

/**
 * Parecido entre dos trazas: el mínimo de lo que cada una cubre de la otra.
 * Simétrico por construcción y en el rango 0–1.
 */
export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  return Math.min(coverage(a, b), coverage(b, a));
}

/**
 * Agrupa trazas en rutas distintas.
 *
 * Leader clustering igual que el de los cúmulos: cada traza se une al grupo cuyo
 * REPRESENTANTE más se le parezca por encima del umbral, o funda uno nuevo. Se
 * recorre de la traza más larga a la más corta (desempate por id) para que el
 * representante de cada grupo sea el recorrido completo y no un trozo suelto, y
 * para que el resultado no dependa del orden de entrada.
 *
 * routes: [{ id, positions }] → [{ id, memberIds, size }] por tamaño desc.
 */
export function groupRoutes(routes, { threshold = SAME_ROUTE, cellM = CELL_M } = {}) {
  const list = (routes ?? []).filter(r => r.positions?.length > 1);
  if (!list.length) return [];

  // Origen común: el primer punto de la primera traza sirve, solo fija la rejilla.
  const origin = list[0].positions[0];
  const sigs = new Map(list.map(r => [r.id, routeSignature(r.positions, origin, { cellM })]));

  const order = [...list].sort(
    (a, b) => sigs.get(b.id).size - sigs.get(a.id).size || String(a.id).localeCompare(String(b.id)),
  );

  const groups = [];
  for (const r of order) {
    const sig = sigs.get(r.id);
    let best = null, bestScore = threshold;
    for (const g of groups) {
      const score = similarity(sig, g.sig);
      if (score >= bestScore) { best = g; bestScore = score; }
    }
    if (best) best.memberIds.push(r.id);
    else groups.push({ id: r.id, sig, memberIds: [r.id] });
  }

  return groups
    .map(({ id, memberIds }) => ({ id, memberIds, size: memberIds.length }))
    .sort((a, b) => b.size - a.size || String(a.id).localeCompare(String(b.id)));
}

/**
 * Resumen legible del reparto: cuántas rutas distintas, qué porcentaje de las
 * salidas cae en la más repetida, y un índice 0–100 donde 100 es "siempre la
 * misma vuelta" y 0 es "nunca repites".
 */
export function routineIndex(groups) {
  const total = (groups ?? []).reduce((s, g) => s + g.size, 0);
  if (!total) return { distinct: 0, total: 0, topShare: 0, repetition: 0 };
  const distinct = groups.length;
  return {
    distinct,
    total,
    topShare: (groups[0].size / total) * 100,
    // 1 ruta para N salidas → 100. N rutas para N salidas → 0.
    repetition: total > 1 ? ((total - distinct) / (total - 1)) * 100 : 100,
  };
}
