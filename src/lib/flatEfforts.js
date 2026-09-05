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
// respaldo) y contar con HISTÉRESIS. Ninguna de las dos basta por separado; los
// tests cubren ambos escenarios. Ambas viven en `streamProfile.js` desde que
// `streamGap.js` necesitó el mismo perfil: el terreno se reconstruye una sola vez
// y de una sola manera.

import { MAX_GAP_M, gradeSeries, elevationProfile, grossPrefix, streamLength } from './streamProfile.js';

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

/**
 * ¿Hay que (re)calcular los tramos llanos de esta actividad?
 * true si nunca se calcularon o si se cachearon con una versión anterior del
 * algoritmo. Sustituye al viejo `!a.flat_efforts`, que dejaba los valores
 * antiguos congelados para siempre al cambiar el cálculo.
 */
export const needsFlatEfforts = (activity) =>
  !activity?.flat_efforts || activity.flat_efforts._v !== FLAT_EFFORTS_VERSION;

// streams: { distance:{data}, altitude:{data}, time:{data}, grade_smooth?:{data} }
// (key_by_type). Devuelve SIEMPRE un objeto versionado
//   { _v, _grade_source?, '1k'?: {time, distance, elevation, gain, loss}, '2k'?: {...} }
// —también cuando no hay ningún tramo válido— para que el llamante lo cachee tal
// cual y no vuelva a pedir los streams de esa actividad.
export const computeFlatEfforts = (streams) => {
  const result = { _v: FLAT_EFFORTS_VERSION };
  const n = streamLength(streams);
  if (!n) return result;
  const dist = streams.distance.data;
  const alt = streams.altitude.data;
  const time = streams.time.data;

  const { grade, source } = gradeSeries(streams, dist, alt, n);
  result._grade_source = source;

  const { asc, desc } = grossPrefix(elevationProfile(grade, dist, n), n);

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
