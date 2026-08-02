// Cálculo de "mejores tramos llanos" a partir de los streams de una actividad.
//
// A diferencia de los best_efforts de Strava (que ignoran el desnivel) o de los
// parciales fijos por km, aquí deslizamos una ventana continua sobre CUALQUIER
// punto de arranque del recorrido y nos quedamos con el tramo más rápido cuyo
// desnivel neto no supere FLAT_MAX_ELEV. El resultado es pequeño y se cachea por
// actividad (campo flat_efforts), así solo se calcula una vez.

// Distancias objetivo (metros), su clave en flat_efforts y el desnivel neto
// máximo (|altitud_fin − altitud_inicio|) tolerado para considerarlo "llano".
export const FLAT_TARGETS = [
  { id: '1k', dist: 1000, maxElev: 5 },
  { id: '2k', dist: 2000, maxElev: 10 },
];

// Tolerancia de sobre-distancia de la ventana (saltos de GPS): descartamos
// ventanas que cubran más de un 10% de la distancia objetivo.
const OVER_DIST = 1.1;

// streams: { distance:{data:[]}, altitude:{data:[]}, time:{data:[]} } (key_by_type).
// Devuelve { '1k': {time, distance, elevation}, '2k': {...} } o null.
export const computeFlatEfforts = (streams) => {
  const dist = streams?.distance?.data;
  const alt = streams?.altitude?.data;
  const time = streams?.time?.data;
  if (!Array.isArray(dist) || !Array.isArray(alt) || !Array.isArray(time)) return null;
  const n = Math.min(dist.length, alt.length, time.length);
  if (n < 2) return null;

  const result = {};
  for (const target of FLAT_TARGETS) {
    let best = null;
    let j = 1;
    // Ventana deslizante O(n): j nunca retrocede porque dist es monótona.
    for (let i = 0; i < n; i++) {
      if (j < i + 1) j = i + 1;
      while (j < n && dist[j] - dist[i] < target.dist) j++;
      if (j >= n) break; // ya no queda tramo tan largo desde aquí en adelante
      const covered = dist[j] - dist[i];
      if (covered > target.dist * OVER_DIST) continue; // hueco/salto GPS
      if (Math.abs(alt[j] - alt[i]) > target.maxElev) continue;
      const dt = time[j] - time[i];
      if (dt <= 0) continue;
      if (!best || dt / covered < best.time / best.distance) {
        best = { time: dt, distance: covered, elevation: alt[j] - alt[i] };
      }
    }
    if (best) result[target.id] = best;
  }
  return Object.keys(result).length ? result : null;
};
