// Perfil de altitud/pendiente a partir de los streams de una actividad.
//
// Este módulo no calcula ninguna métrica: reconstruye el terreno muestra a muestra
// para que quien sí la calcula (`flatEfforts.js`, `streamGap.js`) trabaje sobre el
// MISMO perfil. Antes vivía dentro de flatEfforts; se extrae aquí en cuanto un
// segundo consumidor lo necesitó, porque duplicar la histéresis o el suavizado
// habría hecho que "llano" significara una cosa en los PBs y otra en el GAP.
//
// Las dos decisiones delicadas (documentadas de nuevo abajo, cada una junto a su
// función): partir de la PENDIENTE ya suavizada y contar el desnivel bruto con
// HISTÉRESIS. Sin ambas, el ruido de la altitud GPS se convierte en desnivel
// inventado — varios metros por muestra que suman decenas de metros falsos por km.

// Hueco máximo (metros) entre dos muestras consecutivas para considerarlas
// continuas. Con muestreo de 1 s, 50 m son ~10 s de carrera: por encima es un
// salto de GPS o una pausa, no un dato.
export const MAX_GAP_M = 50;

// Semi-ventana (metros) del suavizado de altitud del camino de respaldo. Es un
// paso-bajo agresivo a propósito: sin él, el ruido de la altitud GPS (varios
// metros por muestra) se acumularía como D+ y D− falsos.
const SMOOTH_HALF_WINDOW_M = 25;

// Histéresis (metros) del contador de desnivel bruto: un cambio de sentido no
// cuenta hasta que acumula este desplazamiento. Suavizar NO basta —el residuo que
// queda oscila, y una oscilación de ±0,4 m muestra a muestra suma decenas de
// metros de D+ falso a lo largo de un kilómetro—, así que hace falta además el
// umbral de reversión. Es el mismo principio que el "minimum elevation increment"
// que aplican los relojes.
const ELEV_HYSTERESIS_M = 2;

// Fracción mínima de muestras válidas para fiarse de grade_smooth.
const GRADE_COVERAGE = 0.9;

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
export const gradeSeries = (streams, dist, alt, n) => {
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
 * Perfil de elevación denso reconstruido integrando la pendiente. Integrar y
 * volver a derivar puede parecer un rodeo, pero es lo que permite tratar igual
 * las dos fuentes: `grade_smooth` de Strava y la altitud suavizada.
 */
export const elevationProfile = (grade, dist, n) => {
  const elev = new Float64Array(n);
  for (let i = 1; i < n; i++) elev[i] = elev[i - 1] + grade[i] * (dist[i] - dist[i - 1]);
  return elev;
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
export const grossPrefix = (elev, n) => {
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

/**
 * Longitud útil de los tres streams base (distance, altitude, time) o 0 si falta
 * alguno. Todos los consumidores empiezan igual: aquí se hace una vez.
 */
export const streamLength = (streams) => {
  const dist = streams?.distance?.data;
  const alt = streams?.altitude?.data;
  const time = streams?.time?.data;
  if (!Array.isArray(dist) || !Array.isArray(alt) || !Array.isArray(time)) return 0;
  const n = Math.min(dist.length, alt.length, time.length);
  return n < 2 ? 0 : n;
};
