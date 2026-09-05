// GAP muestra a muestra sobre los streams de la actividad.
//
// POR QUÉ EXISTE: el GAP por parciales de 1 km (el que servía `computeGap` en
// `api/_lib/mcp-store.js`) sólo conoce el desnivel NETO de cada km, así que las
// subidas y bajadas dentro del mismo kilómetro se cancelan antes de entrar al
// modelo y un km rompepiernas se procesa como llano. El sesgo es sistemático y
// hacia el lado equivocado —Minetti no es simétrico: subir cuesta más de lo que
// baja acredita—, de modo que ese GAP es una COTA INFERIOR del ajuste, no una
// medida. Aquí se integra el modelo sobre la pendiente instantánea, que es donde
// la asimetría sí se paga km a km.
//
// El modelo es el mismo de siempre (`gap.js`, Minetti amortiguado): lo que cambia
// es la resolución de la entrada, no la física. El GAP agregado sale de sumar el
// tiempo equivalente en llano de cada intervalo:
//     t_llano = Σ Δt / gapFactor(pendiente del intervalo)
// —que es exactamente Σ Δd / (v·factor), sólo que sin dividir y multiplicar por v.
//
// El terreno se reconstruye con `streamProfile.js`, el mismo perfil suavizado y
// con histéresis que usan los tramos llanos: si "llano" significa una cosa en los
// PBs, tiene que significar lo mismo aquí.
//
// El resultado es pequeño y se cachea por actividad (campo `stream_gap`), igual
// que `flat_efforts` y desde la misma descarga de streams: no cuesta ni una
// petición extra a Strava.

import { MAX_GAP_M, gradeSeries, elevationProfile, grossPrefix, streamLength } from './streamProfile.js';
import { gapFactor, gapSpeedFromGain } from './gap.js';

// Versión del algoritmo, dentro del propio `stream_gap` como `_v`. Súbela SIEMPRE
// que cambie el cálculo, para que los valores cacheados se recalculen.
export const STREAM_GAP_VERSION = 1;

// Un intervalo con más de esto entre muestras no es carrera continua: es una pausa
// o un hueco de grabación. Se descarta en vez de repartir su tiempo por el tramo.
const MAX_STEP_S = 30;

// Ventana de velocidad admisible (m/s) por intervalo. Por debajo hay parado con
// deriva de GPS (0,5 m/s = 1,8 km/h, más lento que andar); por encima, un salto de
// posición (10 m/s = 36 km/h). Ambos casos meten tiempo o distancia que no existen.
const MIN_SPEED_MS = 0.5;
const MAX_SPEED_MS = 10;

// Cobertura mínima: si tras descartar huecos queda menos de esta fracción de la
// distancia de la actividad, el número no representa la sesión y no se publica.
const MIN_COVERAGE = 0.8;

const round = (v, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/**
 * ¿Hay que (re)calcular el GAP por streams de esta actividad?
 * true si nunca se calculó o si se cacheó con una versión anterior.
 */
export const needsStreamGap = (activity) =>
  !activity?.stream_gap || activity.stream_gap._v !== STREAM_GAP_VERSION;

/** ¿El `stream_gap` cacheado trae una medida utilizable (y no sólo el sello de versión)? */
export const hasStreamGap = (sg) => !!sg && sg.distance_m > 0 && sg.gap_time_s > 0;

/**
 * Velocidad equivalente en llano (m/s) de una actividad entera, con la mejor
 * fuente disponible: la MEDIDA por streams si está cacheada, y si no la hipótesis
 * de perfil ondulado sobre el D+ de la cabecera (`gapSpeedFromGain`).
 *
 * Es el punto de entrada para cualquier vista que hoy llama a `gapSpeedFromGain`
 * con una actividad en la mano: el enriquecido va por backlog, así que las dos
 * ramas conviven y conviene que la elección se tome en un solo sitio.
 * Devuelve 0 si no hay con qué calcular.
 */
export const activityGapSpeed = (activity) => {
  const sg = activity?.stream_gap;
  if (hasStreamGap(sg)) return sg.distance_m / sg.gap_time_s;
  const t = activity?.moving_time || activity?.elapsed_time;
  if (!(activity?.distance > 0) || !(t > 0)) return 0;
  return gapSpeedFromGain(activity.distance / t, activity.distance, activity.total_elevation_gain || 0);
};

// streams: { distance:{data}, altitude:{data}, time:{data}, grade_smooth?:{data} }
// (key_by_type, los mismos que pide `computeFlatEfforts`).
//
// Devuelve SIEMPRE un objeto versionado —también cuando no se puede calcular—
// para que el llamante lo cachee tal cual y no vuelva a pedir esos streams:
//   { _v, grade_source?, distance_m?, time_s?, gap_time_s?, gain_m?, loss_m?,
//     net_m?, per_km?: [{ km, distance_m, gap_speed_ms, gain_m, loss_m, net_m }] }
export const computeStreamGap = (streams) => {
  const result = { _v: STREAM_GAP_VERSION };
  const n = streamLength(streams);
  if (!n) return result;
  const dist = streams.distance.data;
  const alt = streams.altitude.data;
  const time = streams.time.data;

  const { grade, source } = gradeSeries(streams, dist, alt, n);
  const { asc, desc } = grossPrefix(elevationProfile(grade, dist, n), n);
  result.grade_source = source;

  let covered = 0, elapsed = 0, gapTime = 0, gain = 0, loss = 0, net = 0;
  const per_km = [];
  let km = { d: 0, t: 0, gap: 0, up: 0, down: 0, net: 0 };
  const closeKm = () => {
    if (km.d <= 0 || km.gap <= 0) return;
    per_km.push({
      km: per_km.length + 1,
      distance_m: round(km.d),
      gap_speed_ms: round(km.d / km.gap, 3),
      gain_m: round(km.up, 1),
      loss_m: round(km.down, 1),
      net_m: round(km.net, 1),
    });
    km = { d: 0, t: 0, gap: 0, up: 0, down: 0, net: 0 };
  };

  for (let i = 1; i < n; i++) {
    const dd = dist[i] - dist[i - 1];
    const dt = time[i] - time[i - 1];
    if (!(dd > 0) || !(dt > 0) || dd > MAX_GAP_M || dt > MAX_STEP_S) continue;
    const speed = dd / dt;
    if (speed < MIN_SPEED_MS || speed > MAX_SPEED_MS) continue;

    // Aquí está el arreglo: el factor se evalúa en la pendiente DEL INTERVALO, no
    // en la media del kilómetro. Un km que sube 20 m y baja 20 m ya no sale llano.
    const f = gapFactor(grade[i]);
    const gap = dt / f;                       // tiempo equivalente en llano
    const dAsc = asc[i] - asc[i - 1];
    const dDesc = desc[i] - desc[i - 1];
    const dNet = grade[i] * dd;

    covered += dd; elapsed += dt; gapTime += gap;
    gain += dAsc; loss += dDesc; net += dNet;

    // Reparto por kilómetro: si el intervalo cruza el corte, se prorratea (la
    // pendiente es constante dentro del intervalo, así que el reparto es lineal).
    let rest = 1;
    while (rest > 0) {
      const room = 1000 - km.d;
      const part = Math.min(rest, room / dd);
      km.d += dd * part; km.t += dt * part; km.gap += gap * part;
      km.up += dAsc * part; km.down += dDesc * part; km.net += dNet * part;
      rest -= part;
      if (km.d >= 1000 - 1e-9) closeKm();
      else break;
    }
  }
  closeKm();  // último kilómetro incompleto: se publica con su distancia real

  const total = dist[n - 1] - dist[0];
  if (!(covered > 0) || !(gapTime > 0)) return result;
  // Sin cobertura suficiente el agregado mezclaría tramos sueltos: mejor no dar
  // un número que parece de la sesión entera y no lo es.
  if (total > 0 && covered < total * MIN_COVERAGE) {
    result.coverage_pct = round((covered / total) * 100, 1);
    return result;
  }

  result.distance_m = round(covered);
  result.time_s = round(elapsed);
  result.gap_time_s = round(gapTime, 1);
  result.gain_m = round(gain);
  result.loss_m = round(loss);
  result.net_m = round(net);
  result.coverage_pct = total > 0 ? round((covered / total) * 100, 1) : 100;
  result.per_km = per_km;
  return result;
};
