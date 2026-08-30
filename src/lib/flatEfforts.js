// Cálculo de "mejores tramos llanos" a partir de los streams de una actividad.
//
// A diferencia de los best_efforts de Strava (que ignoran el desnivel) o de los
// parciales fijos por km, aquí deslizamos una ventana continua sobre CUALQUIER
// punto de arranque del recorrido y nos quedamos con el tramo más rápido que
// cumpla el criterio de llaneza. Ni Strava ni Garmin publican un "mejor km
// llano": el stream es la única fuente con granularidad de ventana arbitraria
// (los laps de Garmin traen D+/D− y GAP propios, pero solo por lap).
// El resultado es pequeño y se cachea por actividad (campo flat_efforts).
//
// DOS DECISIONES QUE COSTARON UNA VERSIÓN CADA UNA:
//
// v2 — La ventana cubre EXACTAMENTE la distancia objetivo, interpolando el punto
// final entre las dos muestras que cruzan `dist[i] + objetivo`. La v1 aceptaba
// hasta 1,1× el objetivo y elegía la de mejor RITMO, así que un "Flat 1K" podía
// ser 3:22 sobre 1010 m (3:20/km) y aparecer junto a un 3:26 sobre 1000 m:
// tiempos no comparables, y empates decididos por un metro de ruido GPS.
//
// v3 — Llaneza por desnivel BRUTO (D+ y D− acumulados dentro de la ventana), no
// solo por el neto. Con el criterio neto, un kilómetro que sube 20 m y baja 20 m
// daba neto 0 y pasaba como "llano".
// El bruto es traicionero: sumar |Δalt| muestra a muestra sobre altitud GPS
// convierte el ruido del sensor en desnivel inventado. Hacen falta las dos cosas:
// partir de la PENDIENTE (`grade_smooth` de Strava, o altitud suavizada como
// respaldo — ver `gradeSeries`) y contar con HISTÉRESIS (ver `grossPrefix`).
// Ninguna de las dos basta por separado; los tests cubren ambos escenarios.

// Versión del algoritmo. Va dentro del propio `flat_efforts` como `_v` para que
// los consumidores sepan si el valor cacheado se calculó con esta lógica; ver
// `needsFlatEfforts`. Súbela SIEMPRE que cambie el criterio de cálculo.
export const FLAT_EFFORTS_VERSION = 3;

// Distancias objetivo (metros) y su criterio de llaneza:
//   maxNet   — |altitud_fin − altitud_inicio|: el tramo acaba donde empezó.
//   maxGross — D+ y D− acumulados por separado: el tramo es llano POR DENTRO.
// El bruto es el que manda (implica |neto| ≤ maxGross); el neto se conserva como
// filtro más estricto para el caso de la rampa sostenida compensada.
export const FLAT_TARGETS = [
  { id: '1k', dist: 1000, maxNet: 5, maxGross: 10 },
  { id: '2k', dist: 2000, maxNet: 10, maxGross: 20 },
];

// Hueco máximo (metros) entre las dos muestras que cierran la ventana. Interpolar
// a través de un salto de GPS o de una pausa larga sería inventar el tiempo del
// tramo, así que esas ventanas se descartan. Con muestreo de 1 s, 50 m son ~10 s
// de carrera: cualquier cosa por encima es un hueco, no un dato.
const MAX_GAP_M = 50;

// Semi-ventana (metros) del suavizado de altitud del camino de respaldo. Es un
// paso-bajo agresivo a propósito: sin él, el ruido de la altitud GPS (varios
// metros por muestra) se acumularía como D+ y D− falsos y ningún tramo sería llano.
const SMOOTH_HALF_WINDOW_M = 25;

// Histéresis (metros) del contador de desnivel bruto: un cambio de sentido no
// cuenta hasta que acumula este desplazamiento. Suavizar NO basta —el residuo que
// queda oscila, y una oscilación de ±0,4 m muestra a muestra suma decenas de
// metros de D+ falso a lo largo de un kilómetro—, así que hace falta además el
// umbral de reversión. Es el mismo principio que el "minimum elevation increment"
// que aplican los relojes. Ver `grossPrefix`.
const ELEV_HYSTERESIS_M = 2;

// Fracción mínima de muestras válidas para fiarse de grade_smooth.
const GRADE_COVERAGE = 0.9;

/**
 * ¿Hay que (re)calcular los tramos llanos de esta actividad?
 * true si nunca se calcularon o si se cachearon con una versión anterior del
 * algoritmo. Sustituye al viejo `!a.flat_efforts`, que dejaba los valores
 * antiguos congelados para siempre al cambiar el cálculo.
 */
export const needsFlatEfforts = (activity) =>
  !activity?.flat_efforts || activity.flat_efforts._v !== FLAT_EFFORTS_VERSION;

/** Media móvil de altitud en una ventana de ±SMOOTH_HALF_WINDOW_M metros. O(n). */
const smoothAltitude = (dist, alt, n) => {
  const out = new Float64Array(n);
  let lo = 0, hi = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    while (hi < n && dist[hi] <= dist[i] + SMOOTH_HALF_WINDOW_M) sum += alt[hi++];
    while (dist[lo] < dist[i] - SMOOTH_HALF_WINDOW_M) sum -= alt[lo++];
    out[i] = hi > lo ? sum / (hi - lo) : alt[i];
  }
  return out;
};

/**
 * Pendiente con signo (fracción) por muestra, aplicable al intervalo (i−1, i].
 *
 * Preferimos `grade_smooth` de Strava: es la pendiente que ellos ya han suavizado
 * y desruidizado, y evita que la calidad del resultado dependa de si el reloj
 * llevaba barómetro. Si no viene —o viene incompleto— se deriva de la altitud
 * suavizada, que es peor pero utilizable.
 */
const gradeSeries = (streams, dist, alt, n) => {
  const raw = streams?.grade_smooth?.data;
  if (Array.isArray(raw) && raw.length >= n) {
    const grade = new Float64Array(n);
    let valid = 0;
    for (let i = 0; i < n; i++) {
      // OJO con Number(): Number(null) y Number('') son 0, que es finito, así que
      // un stream lleno de huecos pasaba el umbral de cobertura como si viniera
      // completo. Hay que comprobar el tipo antes.
      const v = raw[i];
      if (typeof v === 'number' && Number.isFinite(v)) { grade[i] = v / 100; valid++; } // Strava lo da en %
    }
    if (valid >= n * GRADE_COVERAGE) return { grade, source: 'grade_smooth' };
  }
  const sm = smoothAltitude(dist, alt, n);
  const grade = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dd = dist[i] - dist[i - 1];
    grade[i] = dd > 0 ? (sm[i] - sm[i - 1]) / dd : 0;
  }
  grade[0] = grade[1];
  return { grade, source: 'altitude' };
};

/**
 * Sumas por prefijo de D+ y D− con histéresis, para que el bruto de cualquier
 * ventana salga de una resta y el barrido siga siendo O(n).
 *
 * `ref` es el último extremo confirmado. Mientras el perfil no se aleje de él
 * ELEV_HYSTERESIS_M en el sentido contrario al actual, la oscilación se ignora;
 * una vez confirmado el sentido, se acumula cada incremento y `ref` avanza, así
 * que la suma telescopa hasta el desnivel real del tramo (el umbral retrasa el
 * arranque, no recorta el total).
 */
const grossPrefix = (elev, n) => {
  const asc = new Float64Array(n), desc = new Float64Array(n);
  let ref = elev[0], dir = 0;
  for (let i = 1; i < n; i++) {
    asc[i] = asc[i - 1];
    desc[i] = desc[i - 1];
    const d = elev[i] - ref;
    if (d > 0 && (dir === 1 || d >= ELEV_HYSTERESIS_M)) {
      asc[i] += d; ref = elev[i]; dir = 1;
    } else if (d < 0 && (dir === -1 || -d >= ELEV_HYSTERESIS_M)) {
      desc[i] += -d; ref = elev[i]; dir = -1;
    }
  }
  return { asc, desc };
};

// streams: { distance:{data}, altitude:{data}, time:{data}, grade_smooth?:{data} }
// (key_by_type). Devuelve SIEMPRE un objeto versionado
//   { _v, _grade_source?, '1k'?: {time, distance, elevation, gain, loss}, '2k'?: {...} }
// —también cuando no hay ningún tramo válido— para que el llamante lo cachee tal
// cual y no vuelva a pedir los streams de esa actividad.
export const computeFlatEfforts = (streams) => {
  const result = { _v: FLAT_EFFORTS_VERSION };
  const dist = streams?.distance?.data;
  const alt = streams?.altitude?.data;
  const time = streams?.time?.data;
  if (!Array.isArray(dist) || !Array.isArray(alt) || !Array.isArray(time)) return result;
  const n = Math.min(dist.length, alt.length, time.length);
  if (n < 2) return result;

  const { grade, source } = gradeSeries(streams, dist, alt, n);
  result._grade_source = source;

  // Perfil de elevación denso reconstruido integrando la pendiente. Integrar y
  // volver a derivar puede parecer un rodeo, pero es lo que permite tratar igual
  // las dos fuentes: `grade_smooth` de Strava y la altitud suavizada.
  const elev = new Float64Array(n);
  for (let i = 1; i < n; i++) elev[i] = elev[i - 1] + grade[i] * (dist[i] - dist[i - 1]);
  const { asc, desc } = grossPrefix(elev, n);

  for (const target of FLAT_TARGETS) {
    let best = null;
    let bestDt = Infinity; // sin redondear: el redondeo solo se aplica al guardar
    let j = 1;
    // Ventana deslizante O(n): j nunca retrocede porque dist es monótona.
    for (let i = 0; i < n; i++) {
      if (j < i + 1) j = i + 1;
      const end = dist[i] + target.dist;
      while (j < n && dist[j] < end) j++;
      if (j >= n) break; // ya no queda tramo tan largo desde aquí en adelante

      // Interpolación lineal en la muestra que cruza `end`: la ventana mide
      // exactamente target.dist, no "lo que hubiera en la muestra siguiente".
      const span = dist[j] - dist[j - 1];
      if (span <= 0 || span > MAX_GAP_M) continue; // hueco/salto GPS
      const tail = end - dist[j - 1];
      const frac = tail / span;
      const tEnd = time[j - 1] + frac * (time[j] - time[j - 1]);
      const aEnd = alt[j - 1] + frac * (alt[j] - alt[j - 1]);

      // El desnivel bruto del último paso se prorratea igual que el tiempo.
      const gain = asc[j - 1] + (asc[j] - asc[j - 1]) * frac - asc[i];
      const loss = desc[j - 1] + (desc[j] - desc[j - 1]) * frac - desc[i];
      if (gain > target.maxGross || loss > target.maxGross) continue;

      const elevation = aEnd - alt[i];
      if (Math.abs(elevation) > target.maxNet) continue;
      const dt = tEnd - time[i];
      if (dt <= 0) continue;
      // Misma distancia en todas las ventanas: comparar tiempos ya es comparar ritmos.
      if (dt < bestDt) {
        bestDt = dt;
        best = {
          time: Math.round(dt * 10) / 10,
          distance: target.dist,
          elevation: Math.round(elevation * 10) / 10,
          gain: Math.round(gain * 10) / 10,
          loss: Math.round(loss * 10) / 10,
        };
      }
    }
    if (best) result[target.id] = best;
  }
  return result;
};
