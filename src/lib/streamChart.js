// ============================================================================
// streamChart — streams de Strava → gráfico de sesión y estadísticas de tramo.
//
// Los streams llegan a 1 Hz (una tirada larga pasa de 10 000 muestras): Recharts
// no aguanta eso con fluidez, así que el gráfico pinta una versión diezmada. Las
// ESTADÍSTICAS de un tramo, en cambio, se calculan siempre sobre la muestra
// completa: cada punto del gráfico lleva `i`, su índice en el stream original.
//
// El GAP del tramo no se recalcula aquí: se recorta el stream y se pasa por
// `computeStreamGap`, el mismo que da el GAP de la sesión entera.
// ============================================================================
import { computeStreamGap, hasStreamGap } from './streamGap';
import { streamLength } from './streamProfile';

/** Claves que pide la vista de sesión (key_by_type). */
export const SESSION_STREAM_KEYS = [
  'time', 'distance', 'altitude', 'heartrate', 'velocity_smooth',
  'cadence', 'watts', 'grade_smooth', 'latlng',
];

const data = (streams, key) => streams?.[key]?.data ?? null;
const round = (n, d = 0) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d)));

// Por debajo de 1.2 m/s (≈ 14 min/km) es andar o estar parado: el ritmo se
// dispara a valores que aplastan el eje. Se deja el hueco.
const MIN_RUN_SPEED = 1.2;

// Strava da la cadencia de carrera por pierna.
const toSpm = (c) => (c == null ? null : c < 120 ? c * 2 : c);

/**
 * Serie para el gráfico, diezmada a ~`target` puntos. Cada punto:
 * `{ i, km, t, hr, pace (s/km), alt, cad, watts, lat, lng }`. El ritmo sale de
 * `velocity_smooth` (ya suavizado por Strava), no de derivar distancia/tiempo.
 */
export function buildChartSeries(streams, { target = 900 } = {}) {
  const n = streamLength(streams) || data(streams, 'time')?.length || 0;
  if (!n) return [];
  const dist = data(streams, 'distance');
  const time = data(streams, 'time');
  const hr = data(streams, 'heartrate');
  const vel = data(streams, 'velocity_smooth');
  const alt = data(streams, 'altitude');
  const cad = data(streams, 'cadence');
  const watts = data(streams, 'watts');
  const ll = data(streams, 'latlng');

  const step = Math.max(1, Math.ceil(n / target));
  const out = [];
  for (let i = 0; i < n; i += step) {
    // Media del bloque para FC/ritmo/cadencia (no muestreo puntual: un pico de
    // un segundo no debe decidir el punto); altitud y posición, la del inicio.
    const end = Math.min(n, i + step);
    const avg = (arr, map = (x) => x) => {
      if (!arr) return null;
      let s = 0, c = 0;
      for (let j = i; j < end; j++) {
        const v = map(arr[j]);
        if (v != null && Number.isFinite(v)) { s += v; c++; }
      }
      return c ? s / c : null;
    };
    const v = avg(vel);
    out.push({
      i,
      km: dist ? round(dist[i] / 1000, 3) : null,
      t: time ? time[i] : i,
      hr: round(avg(hr)),
      pace: v != null && v >= MIN_RUN_SPEED ? round(1000 / v) : null,
      alt: alt ? round(alt[i], 1) : null,
      cad: round(avg(cad, toSpm)),
      watts: round(avg(watts)),
      lat: ll?.[i]?.[0] ?? null,
      lng: ll?.[i]?.[1] ?? null,
    });
  }
  // El último punto siempre: si no, el gráfico se queda corto del final.
  if (out[out.length - 1].i !== n - 1 && step > 1) {
    const i = n - 1;
    out.push({
      i,
      km: dist ? round(dist[i] / 1000, 3) : null,
      t: time ? time[i] : i,
      hr: hr ? round(hr[i]) : null,
      pace: vel && vel[i] >= MIN_RUN_SPEED ? round(1000 / vel[i]) : null,
      alt: alt ? round(alt[i], 1) : null,
      cad: cad ? round(toSpm(cad[i])) : null,
      watts: watts ? round(watts[i]) : null,
      lat: ll?.[i]?.[0] ?? null,
      lng: ll?.[i]?.[1] ?? null,
    });
  }
  return out;
}

/** Recorta todos los streams al rango de índices [i0, i1] (incluidos). */
export function sliceStreams(streams, i0, i1) {
  const out = {};
  for (const [k, v] of Object.entries(streams || {})) {
    if (Array.isArray(v?.data)) out[k] = { ...v, data: v.data.slice(i0, i1 + 1) };
  }
  return out;
}

/**
 * Estadísticas del tramo [i0, i1] sobre la muestra completa:
 * distancia, tiempo, ritmo medio, GAP, FC media/máx, cadencia media, D+/D− y
 * deriva (FC/velocidad de la 2.ª mitad frente a la 1.ª, en %; solo si el tramo
 * dura al menos 10 minutos — antes de eso la FC aún está subiendo y la cifra no
 * significa nada).
 */
export function segmentStats(streams, i0, i1) {
  const lo = Math.max(0, Math.min(i0, i1));
  const hi = Math.max(i0, i1);
  const dist = data(streams, 'distance');
  const time = data(streams, 'time');
  if (!dist || !time || hi - lo < 2) return null;

  const distance_m = dist[hi] - dist[lo];
  const time_s = time[hi] - time[lo];
  if (!(distance_m > 0) || !(time_s > 0)) return null;

  const hr = data(streams, 'heartrate');
  const cad = data(streams, 'cadence');
  const alt = data(streams, 'altitude');
  const meanOf = (arr, a, b, map = (x) => x) => {
    if (!arr) return null;
    let s = 0, c = 0;
    for (let j = a; j <= b; j++) {
      const v = map(arr[j]);
      if (v != null && Number.isFinite(v) && v > 0) { s += v; c++; }
    }
    return c ? s / c : null;
  };

  let gain = 0, loss = 0;
  if (alt) {
    for (let j = lo + 1; j <= hi; j++) {
      const d = alt[j] - alt[j - 1];
      if (d > 0) gain += d; else loss -= d;
    }
  }

  let maxHr = null;
  if (hr) for (let j = lo; j <= hi; j++) if (hr[j] > (maxHr ?? 0)) maxHr = hr[j];

  const sg = computeStreamGap(sliceStreams(streams, lo, hi));
  const gap_speed_ms = hasStreamGap(sg) ? sg.distance_m / sg.gap_time_s : null;

  // Deriva: FC por unidad de velocidad, 2.ª mitad (en tiempo) frente a 1.ª.
  let drift_pct = null;
  if (hr && time_s >= 600) {
    const tMid = time[lo] + time_s / 2;
    let mid = lo;
    while (mid < hi && time[mid] < tMid) mid++;
    const half = (a, b) => {
      const h = meanOf(hr, a, b);
      const d = dist[b] - dist[a];
      const t = time[b] - time[a];
      return h && d > 0 && t > 0 ? h / (d / t) : null;
    };
    const r1 = half(lo, mid);
    const r2 = half(mid, hi);
    if (r1 && r2) drift_pct = round((r2 / r1 - 1) * 100, 1);
  }

  return {
    distance_m: round(distance_m),
    time_s: round(time_s),
    speed_ms: distance_m / time_s,
    gap_speed_ms,
    avg_hr: round(meanOf(hr, lo, hi)),
    max_hr: maxHr,
    avg_cadence: round(meanOf(cad, lo, hi, toSpm)),
    // D+/D− de la pendiente suavizada si hay; la altitud cruda inventa desnivel.
    gain_m: sg.gain_m != null ? round(sg.gain_m) : alt ? round(gain) : null,
    loss_m: sg.loss_m != null ? round(sg.loss_m) : alt ? round(loss) : null,
    drift_pct,
  };
}
