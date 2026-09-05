// ── Zonas geográficas ────────────────────────────────────────────────────────
// Cuántos km corres en cada SITIO. Strava dejó de rellenar location_city /
// location_state hace años (llegan null en la práctica totalidad de las
// actividades) y además no los persistimos, así que lo único geográfico que hay
// es `start_latlng`: un par de coordenadas por actividad. Sin topónimos.
//
// De ahí a "zonas" se llega agrupando por proximidad del punto de salida: los
// sitios habituales (casa, el parque, la pista, el pueblo) emergen solos como
// cúmulos de salidas repetidas. Los NOMBRES los pone el atleta — el dato no los
// trae y no se inventan aquí.
//
// LIMITACIÓN, explícita: cada actividad cuenta ENTERA en su punto de salida. Una
// carrera punto a punto o una tirada que cruza medio término municipal suma el
// 100% de sus km en el origen. Para repartir los km a lo largo del recorrido
// haría falta decodificar `map.summary_polyline` de cada actividad y trocearla
// sobre una rejilla — otro cálculo, mucho más caro, y devuelve celdas anónimas.
//
// Puro: sin I/O, sin red, sin React. La UI vive en components/GeoZones.jsx.

/** Radio por defecto del cúmulo. 1,5 km cubre un barrio sin fundir dos pueblos. */
export const DEFAULT_RADIUS_KM = 1.5;

/** Radios ofrecidos en la UI (km). */
export const RADIUS_OPTIONS = [0.5, 1, 1.5, 3, 5, 10];

// Radio medio terrestre (IUGG). Con la fórmula del haversine el error a escala
// de barrio es de centímetros: de sobra para agrupar salidas.
const EARTH_R_KM = 6371.0088;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Distancia sobre la esfera entre dos `[lat, lng]`, en km. */
export function haversineKm([lat1, lng1], [lat2, lng2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Punto de salida utilizable de una actividad, o null.
 * Descarta cinta/indoor (`start_latlng: []`), la "isla nula" [0,0] que Strava
 * devuelve cuando el GPS no llegó a fijar, y cualquier coordenada imposible.
 */
export function startPoint(a) {
  const p = a?.start_latlng;
  if (!Array.isArray(p) || p.length < 2) return null;
  const [lat, lng] = p;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

/**
 * Clave estable de una zona: coordenadas de su semilla a 3 decimales (~110 m).
 * Es lo que persiste el nombre que pone el atleta, así que tiene que sobrevivir
 * a que se recalculen los cúmulos. Redondear a 3 decimales lo consigue mientras
 * la semilla siga cayendo en el mismo punto de salida.
 */
export const zoneKey = ([lat, lng]) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

const km = (m) => (m || 0) / 1000;
const dayOf = (a) => String(a.start_date_local || a.start_date || '').slice(0, 10);

/** Agregados de un conjunto de actividades: km, tiempo, desnivel, fechas. */
function summarize(acts) {
  let distanceKm = 0, movingSec = 0, elevationM = 0;
  let firstDate = null, lastDate = null;
  for (const a of acts) {
    distanceKm += km(a.distance);
    movingSec  += a.moving_time || 0;
    elevationM += a.total_elevation_gain || 0;
    const d = dayOf(a);
    if (d) {
      if (!firstDate || d < firstDate) firstDate = d;
      if (!lastDate  || d > lastDate)  lastDate  = d;
    }
  }
  return {
    count: acts.length,
    distanceKm,
    movingSec,
    elevationM,
    // Pendiente media de SUBIDA, en %: D+ sobre la distancia recorrida (10 m/km = 1 %).
    //
    // Por qué normalizado y no el desnivel medio por carrera: ese sube solo con
    // que las tiradas que sales de ahí sean largas, así que mide la duración, no
    // el terreno. En % son comparables un sitio de series de 8 km y otro de 30.
    //
    // Ojo con leerlo como "la cuesta que subo": `total_elevation_gain` es solo
    // desnivel POSITIVO, y en un circuito que vuelve al mismo punto la pendiente
    // NETA es cero. Esto es un índice de lo rompepiernas que es el sitio, no la
    // inclinación media del camino.
    elevPct: distanceKm > 0 ? elevationM / (distanceKm * 10) : 0,
    firstDate,
    lastDate,
  };
}

/** Media aritmética de las coordenadas de un grupo (centro visual del cúmulo). */
function centroidOf(points) {
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lng = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lat, lng];
}

/**
 * Agrupa actividades por proximidad del punto de salida.
 *
 * Algoritmo: "leader clustering" sembrado por densidad. Primero se cuenta, para
 * cada salida, cuántas otras caen dentro del radio; luego se recorren de más a
 * menos densa y cada una se une al cúmulo cuya SEMILLA le quede más cerca dentro
 * del radio, o funda uno nuevo. Sembrar por densidad hace que los sitios de
 * verdad habituales sean los que fijan el centro, en vez de que lo fije la
 * primera actividad que pase por ahí; y como las semillas no se mueven al añadir
 * miembros, ningún cúmulo se arrastra hasta tragarse al vecino.
 *
 * El orden es determinista (densidad desc., desempate por id), así que dos
 * ejecuciones sobre los mismos datos dan exactamente los mismos cúmulos.
 *
 * Devuelve { zones, unlocated }:
 *   zones     — [{ key, seed, centroid, activities, ...agregados }] por km desc.
 *   unlocated — agregados de las actividades sin coordenadas (cinta, sin fix).
 *               Se reportan aparte para que la suma de zonas + esto cuadre con
 *               el volumen real y ningún km desaparezca sin avisar.
 */
export function clusterActivities(activities, { radiusKm = DEFAULT_RADIUS_KM } = {}) {
  const located = [];
  const unlocatedActs = [];
  for (const a of activities ?? []) {
    const p = startPoint(a);
    if (p) located.push({ a, p });
    else unlocatedActs.push(a);
  }

  const n = located.length;
  const density = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineKm(located[i].p, located[j].p) <= radiusKm) { density[i]++; density[j]++; }
    }
  }

  const order = located
    .map((_, i) => i)
    .sort((i, j) => density[j] - density[i]
                 || String(located[i].a.id ?? i).localeCompare(String(located[j].a.id ?? j)));

  const seeds = [];    // [lat, lng] fija de cada cúmulo
  const groups = [];   // actividades de cada cúmulo
  const points = [];   // salidas de cada cúmulo (para el centroide)
  for (const i of order) {
    const { a, p } = located[i];
    let best = -1, bestDist = Infinity;
    for (let c = 0; c < seeds.length; c++) {
      const d = haversineKm(p, seeds[c]);
      if (d <= radiusKm && d < bestDist) { best = c; bestDist = d; }
    }
    if (best < 0) { seeds.push(p); groups.push([a]); points.push([p]); }
    else { groups[best].push(a); points[best].push(p); }
  }

  const zones = seeds.map((seed, c) => ({
    key: zoneKey(seed),
    seed,
    centroid: centroidOf(points[c]),
    activities: groups[c],
    ...summarize(groups[c]),
  })).sort((x, y) => y.distanceKm - x.distanceKm);

  return { zones, unlocated: { ...summarize(unlocatedActs), activities: unlocatedActs } };
}

/**
 * Resuelve la cadena de fusiones `key -> keyDestino` hasta la raíz.
 * Con guarda de ciclos: si A apunta a B y B a A (posible si el estado guardado
 * se corrompe), se corta en vez de colgarse.
 */
function resolveTarget(key, mergeInto) {
  const seen = new Set([key]);
  let cur = key;
  while (mergeInto?.[cur] && !seen.has(mergeInto[cur])) {
    cur = mergeInto[cur];
    seen.add(cur);
  }
  return cur;
}

/**
 * Aplica el estado que edita el atleta sobre los cúmulos crudos:
 *   labels    — { [key]: "nombre" }
 *   mergeInto — { [key]: keyDestino }, para unir cúmulos que son el mismo sitio
 *               (dos salidas del mismo barrio separadas por más del radio).
 *
 * Las claves huérfanas (de un radio anterior, o de una actividad ya borrada) se
 * ignoran sin ruido: el nombre sigue guardado por si el cúmulo reaparece.
 * Devuelve las zonas fusionadas y nombradas, por km desc.
 */
export function applyZoneEdits(zones, { labels = {}, mergeInto = {} } = {}) {
  const byTarget = new Map();
  for (const z of zones) {
    const target = resolveTarget(z.key, mergeInto);
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(z);
  }

  return [...byTarget.entries()].map(([key, members]) => {
    const acts = members.flatMap(m => m.activities);
    // El centroide pondera por salidas, no por cúmulo: así un cúmulo de 200
    // carreras no queda desplazado por otro de 3 que se le haya fusionado.
    const pts = acts.map(startPoint).filter(Boolean);
    const seed = (members.find(m => m.key === key) ?? members[0]).seed;
    return {
      key,
      seed,
      centroid: pts.length ? centroidOf(pts) : seed,
      name: labels[key] || null,
      mergedFrom: members.length > 1 ? members.map(m => m.key) : null,
      activities: acts,
      ...summarize(acts),
    };
  }).sort((x, y) => y.distanceKm - x.distanceKm);
}

/** Añade a cada zona su `pct` de km sobre el total localizado (0 si no hay km). */
export function shareOfKm(zones) {
  const total = zones.reduce((s, z) => s + z.distanceKm, 0);
  return zones.map(z => ({ ...z, pct: total > 0 ? (z.distanceKm / total) * 100 : 0 }));
}

// ── Estacionalidad ───────────────────────────────────────────────────────────

/**
 * Km por zona y MES DEL AÑO, agregando todos los años en los mismos doce cubos.
 *
 * Se agrega por mes natural y no por mes-año a propósito: lo que se busca es el
 * patrón que se repite —la sierra en julio, el parque iluminado en diciembre—, y
 * eso solo emerge apilando los eneros de todos los años. Un eje mes-año daría una
 * serie temporal larguísima donde el ciclo no se ve.
 *
 * Devuelve [{ key, name, months: number[12], total }] en el orden de entrada.
 */
export function monthlyByZone(zones) {
  return (zones ?? []).map(z => {
    const months = new Array(12).fill(0);
    for (const a of z.activities) {
      const d = dayOf(a);
      if (d.length < 7) continue;
      const m = Number(d.slice(5, 7)) - 1;
      if (m >= 0 && m < 12) months[m] += km(a.distance);
    }
    return { key: z.key, name: z.name ?? null, months, total: months.reduce((s, v) => s + v, 0) };
  });
}

// ── Sitios dormidos ──────────────────────────────────────────────────────────

/** Meses sin pisar un sitio a partir de los cuales se considera abandonado. */
export const DORMANT_MONTHS = 6;

/**
 * Zonas que llevan `months` sin una sola salida. `today` se inyecta para poder
 * testearlo sin depender de la fecha real de ejecución.
 * Devuelve las zonas con `monthsSince`, de la más abandonada a la menos.
 */
export function dormantZones(zones, { today = new Date(), months = DORMANT_MONTHS } = {}) {
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  return (zones ?? [])
    .filter(z => z.lastDate && z.lastDate < cutoffKey)
    .map(z => {
      const last = new Date(z.lastDate + 'T00:00:00');
      const monthsSince = (today.getFullYear() - last.getFullYear()) * 12
                        + (today.getMonth() - last.getMonth());
      return { ...z, monthsSince };
    })
    .sort((a, b) => b.monthsSince - a.monthsSince);
}

// ── Radio de exploración ─────────────────────────────────────────────────────

// Proyección plana local: a escala de una región, tratar lat/lng como un plano
// con el meridiano corregido por el coseno de la latitud da un error por debajo
// del ruido del propio GPS, y permite usar geometría euclídea (áreas, envolvente).
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG = 111.320;
const project = ([lat, lng], lat0) => [
  (lng - lat0[1]) * KM_PER_DEG_LNG * Math.cos(toRad(lat0[0])),
  (lat - lat0[0]) * KM_PER_DEG_LAT,
];

/**
 * Área de la envolvente convexa de un conjunto de puntos `[lat, lng]`, en km².
 * Es la superficie del territorio que abarcas: con menos de 3 puntos no hay
 * polígono y el área es 0 (una línea no encierra nada).
 */
export function hullAreaKm2(points) {
  if (!points || points.length < 3) return 0;
  const origin = points[0];
  const pts = points.map(p => project(p, origin))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // Andrew monotone chain.
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (seq) => {
    const out = [];
    for (const p of seq) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  if (hull.length < 3) return 0;

  // Fórmula del cordón (shoelace).
  let area2 = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    area2 += x1 * y2 - x2 * y1;
  }
  return Math.abs(area2) / 2;
}

/**
 * Exploración por año, tomando como "casa" el centroide de `home` (por defecto
 * la zona de más km, que es donde de verdad vives corriendo).
 *
 * Por año devuelve:
 *   radiusKm — lo más lejos de casa que te fuiste a correr
 *   places   — cuántos sitios distintos pisaste
 *   areaKm2  — superficie de la envolvente de esos sitios
 *   runs, distanceKm
 *
 * Se mide de centroide a centroide, no sobre el recorrido: dice hasta dónde te
 * DESPLAZASTE para correr, no cuánto abarcó la traza una vez allí.
 */
export function explorationByYear(zones, home = null) {
  const base = home ?? (zones ?? [])[0];
  if (!base) return [];

  const byYear = new Map();
  for (const z of zones) {
    const dist = haversineKm(base.centroid, z.centroid);
    for (const a of z.activities) {
      const d = dayOf(a);
      if (d.length < 4) continue;
      const year = d.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, { year, radiusKm: 0, runs: 0, distanceKm: 0, keys: new Map() });
      const y = byYear.get(year);
      y.runs++;
      y.distanceKm += km(a.distance);
      if (dist > y.radiusKm) y.radiusKm = dist;
      y.keys.set(z.key, z.centroid);
    }
  }

  return [...byYear.values()]
    .map(({ keys, ...y }) => ({
      ...y,
      places: keys.size,
      areaKm2: hullAreaKm2([...keys.values()]),
    }))
    .sort((a, b) => a.year.localeCompare(b.year));
}
