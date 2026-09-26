// Perfil FC-vs-esfuerzo por bloques de una actividad, desde los streams.
//
// POR QUÉ EXISTE: las métricas de eficiencia que ya tiene la app son COCIENTES de
// sesión entera (m/latido en `compare_similar_sessions`, W/ppm) y no sirven para
// comparar la forma entre meses:
//
//   · El cociente tiene sesgo de intensidad. La relación FC-esfuerzo no pasa por
//     el origen (hay intercepto), así que a menor intensidad el cociente sube
//     aunque el atleta no haya mejorado nada.
//   · La sesión entera mezcla el calentamiento (FC todavía subiendo) con la
//     deriva cardiaca del final. Dos rodajes iguales con distinto reparto de esas
//     dos fases dan medias distintas.
//   · Filtrar sesiones por banda de FC y comparar el cociente CONDICIONA SOBRE LA
//     VARIABLE RESULTADO: si solo miras sesiones a 145-155 ppm, la mejora "a FC
//     dada" desaparece por construcción.
//
// Lo que sí funciona es leer la FC PREDICHA a un esfuerzo FIJO (regresión con
// efecto de periodo, en `aerobicForm.js`). Para eso hace falta, de cada sesión, un
// par (esfuerzo, FC) medido en tramos ESTABLES, no la media de la sesión.
//
// QUÉ SE CACHEA Y POR QUÉ ASÍ: no la ventana ya resuelta, sino un perfil por
// bloques de 5 minutos. Guardar una sola media obligaría a re-descargar los
// streams de todo el histórico cada vez que se toca una decisión de la ventana
// (15-45 min, umbral de estabilidad, modelo de deriva…); con los bloques, esas
// decisiones se toman en la capa de agregación y son gratis. Un rodaje de una hora
// son doce bloques de media docena de números: cabe de sobra en el blob de la
// actividad, que es justo lo que impide cachear los streams enteros.
//
// El esfuerzo se mide en DOS ejes y se guardan los dos:
//   · `gap` — velocidad equivalente en llano (m/s), aplicando `gapFactor` a la
//     pendiente instantánea. Es el mismo modelo que `streamGap.js`: si "llano"
//     significa una cosa en los PBs, significa lo mismo aquí.
//   · `w` — la potencia de Garmin/Strava, cuando la actividad la trae. OJO: es un
//     MODELO de velocidad + pendiente, no un potenciómetro, así que es otra forma
//     del mismo "ritmo corregido por terreno" y NO mide economía de carrera.
// Se guardan los dos porque no son intercambiables: la potencia falta en buena
// parte del histórico y su modelo es opaco, pero es la que el atleta ve en el
// reloj y la que hace comparables estas cifras con las suyas.
//
// Sale de la MISMA descarga de streams que `flat_efforts` y `stream_gap`: añade
// `heartrate` y `watts` a las claves pedidas y no cuesta ni una petición extra.

import { MAX_GAP_M, gradeSeries, streamLength } from './streamProfile.js';
import { gapFactor } from './gap.js';

// Versión del algoritmo, dentro del propio `hr_effort` como `_v`. Súbela SIEMPRE
// que cambie el cálculo, para que los valores cacheados se recalculen.
export const HR_EFFORT_VERSION = 2;

// Los mismos límites de continuidad que usa `streamGap`: por encima de esto no es
// carrera continua sino una pausa o un hueco de grabación.
const MAX_STEP_S = 30;
const MIN_SPEED_MS = 0.5;
const MAX_SPEED_MS = 10;

// Tamaño del bloque (s). Cinco minutos es el compromiso: suficiente para que la
// media de FC no sea ruido y bastante fino para recortar ventanas de 15-45 min sin
// partir bloques por la mitad.
export const BIN_S = 300;

// Un bloque con menos de esto de tiempo útil no se publica: sería la media de
// cuatro muestras sueltas con la misma apariencia que una de cinco minutos. Minuto y
// medio de esfuerzo limpio ya promedia el ruido, y como el peso del bloque es SU
// tiempo, uno corto pesa poco allá donde se use.
const MIN_BIN_S = 90;

// Tras una parada la FC cae y tarda en recuperar el nivel del esfuerzo: los
// segundos siguientes tienen FC baja para el esfuerzo que se está haciendo y
// sesgarían la relación a la baja.
const BLANK_AFTER_PAUSE_S = 120;

// Un pico de esfuerzo (progresivo, cambio de rasante, sprint hasta un semáforo)
// deja la FC elevada cuando el esfuerzo ya ha vuelto a la normalidad: es el sesgo
// contrario. Se tira el pico y lo que viene detrás.
const SPIKE_PCT = 0.15;
const BLANK_AFTER_SPIKE_S = 90;

// Semi-ventana (s) del suavizado del esfuerzo. NO es cosmética: la velocidad
// instantánea de un stream a 1 Hz oscila ±20-30 % por el ruido de GPS y la propia
// zancada, así que medir "picos" y "estabilidad" sobre la muestra cruda daba por
// pico CASI TODA la sesión —el 15 % se supera constantemente— y, con el cegado de
// 90 s por delante, la actividad entera acababa descartada con
// `sin-bloques-estables`. Ese fue exactamente el fallo que se vio en producción:
// 27 de 30 sesiones ya enriquecidas sin un solo bloque publicable.
//
// Media móvil CENTRADA de ±15 s, que además es lo fisiológicamente correcto: la FC
// responde al esfuerzo sostenido de esa escala, no a la muestra suelta. Un surge de
// verdad —30-60 s— sobrevive al suavizado y se sigue detectando; el ruido no.
const SMOOTH_HALF_S = 15;

const round = (v, d = 0) => {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * ¿Hay que (re)calcular el perfil FC-esfuerzo de esta actividad?
 * true si nunca se calculó o si se cacheó con una versión anterior.
 */
export const needsHrEffort = (activity) =>
  !activity?.hr_effort || activity.hr_effort._v !== HR_EFFORT_VERSION;

/** ¿El `hr_effort` cacheado trae bloques utilizables (y no solo el sello de versión)? */
export const hasHrEffort = (he) => Array.isArray(he?.bins) && he.bins.length > 0;

// Acumulador de medias y desviaciones PONDERADAS POR TIEMPO. El muestreo de Strava
// no es uniforme (la resolución baja en las actividades largas), así que una media
// aritmética de muestras daría más peso a los tramos mejor muestreados.
const acc = () => ({
  s: 0, drop: 0, hr: 0, hr2: 0, gap: 0, gap2: 0, spd: 0, w: 0, w2: 0, wS: 0, grade: 0,
});

// El esfuerzo entra SUAVIZADO (`sgap`/`sw`) y la FC y la velocidad crudas: lo que
// se quiere del esfuerzo es su NIVEL, y la media móvil lo conserva mientras quita
// la oscilación que no significa nada.
const addTo = (b, iv) => {
  b.s += iv.dt;
  b.hr += iv.hr * iv.dt; b.hr2 += iv.hr * iv.hr * iv.dt;
  b.gap += iv.sgap * iv.dt; b.gap2 += iv.sgap * iv.sgap * iv.dt;
  b.spd += iv.spd * iv.dt;
  b.grade += Math.abs(iv.grade) * iv.dt;
  if (iv.sw != null) { b.w += iv.sw * iv.dt; b.w2 += iv.sw * iv.sw * iv.dt; b.wS += iv.dt; }
};

// Coeficiente de variación ponderado. Es lo que distingue un rodaje continuo de
// unas cuestas o unas series: con el esfuerzo inestable la FC va por detrás del
// esfuerzo y el par (esfuerzo, FC) del bloque deja de significar nada.
const cv = (sum, sum2, weight, mean) => {
  if (!(weight > 0) || !(mean > 0)) return null;
  const varr = sum2 / weight - mean * mean;
  return varr > 0 ? Math.sqrt(varr) / mean : 0;
};

/**
 * Escribe en cada intervalo el esfuerzo suavizado (`sgap`, y `sw` si hay potencia)
 * con una media móvil CENTRADA de ±SMOOTH_HALF_S, ponderada por tiempo. O(n) con
 * dos punteros: los streams largos son decenas de miles de muestras.
 *
 * La potencia se promedia sobre los intervalos que LA TIENEN, no sobre la ventana
 * entera: si no, un hueco de potencia en medio hundiría la media de sus vecinos.
 */
const smoothEffort = (ivs) => {
  const n = ivs.length;
  let lo = 0, hi = 0;
  let gSum = 0, tSum = 0, wSum = 0, wT = 0;
  for (let i = 0; i < n; i++) {
    const t = ivs[i].t;
    while (hi < n && ivs[hi].t <= t + SMOOTH_HALF_S) {
      const v = ivs[hi];
      gSum += v.gap * v.dt; tSum += v.dt;
      if (v.w != null) { wSum += v.w * v.dt; wT += v.dt; }
      hi++;
    }
    while (lo < hi && ivs[lo].t < t - SMOOTH_HALF_S) {
      const v = ivs[lo];
      gSum -= v.gap * v.dt; tSum -= v.dt;
      if (v.w != null) { wSum -= v.w * v.dt; wT -= v.dt; }
      lo++;
    }
    ivs[i].sgap = tSum > 0 ? gSum / tSum : ivs[i].gap;
    ivs[i].sw = ivs[i].w == null ? null : (wT > 0 ? wSum / wT : ivs[i].w);
  }
};

/**
 * Perfil FC-esfuerzo por bloques de 5 min.
 *
 * streams: { time, distance, altitude, grade_smooth?, heartrate, watts? } con
 * `key_by_type` (los mismos que piden `computeFlatEfforts` y `computeStreamGap`,
 * más heartrate y watts).
 *
 * Devuelve SIEMPRE un objeto versionado —también cuando no se puede calcular, con
 * `reason`— para que el llamante lo cachee tal cual y no vuelva a pedir esos
 * streams hasta que cambie la versión:
 *   { _v, reason?, grade_source?, has_power?, bins?: [{
 *       t0, s, drop_s, hr, hr_cv, gap, gap_cv, spd, w?, w_cv?, grade_abs }] }
 * `t0` es el segundo de inicio del bloque desde el arranque de la actividad.
 */
export const computeHrEffort = (streams) => {
  const result = { _v: HR_EFFORT_VERSION };
  const n = streamLength(streams);
  if (!n) return { ...result, reason: 'sin-streams' };

  const hrRaw = streams?.heartrate?.data;
  if (!Array.isArray(hrRaw) || hrRaw.length < n) return { ...result, reason: 'sin-fc' };
  const wRaw = Array.isArray(streams?.watts?.data) && streams.watts.data.length >= n
    ? streams.watts.data
    : null;

  const dist = streams.distance.data;
  const alt = streams.altitude.data;
  const time = streams.time.data;
  const { grade, source } = gradeSeries(streams, dist, alt, n);
  result.grade_source = source;

  // ── Pasada 1: intervalos válidos y momentos de ruptura ─────────────────────
  // Un intervalo descartado por pausa o hueco no solo se tira: marca el instante a
  // partir del cual los BLANK_AFTER_PAUSE_S segundos siguientes tampoco valen.
  const ivs = [];
  const breaks = [];
  for (let i = 1; i < n; i++) {
    const dd = dist[i] - dist[i - 1];
    const dt = time[i] - time[i - 1];
    const t = time[i];
    if (!(dt > 0)) continue;
    if (!(dd > 0) || dd > MAX_GAP_M || dt > MAX_STEP_S) { breaks.push(t); continue; }
    const spd = dd / dt;
    if (spd < MIN_SPEED_MS || spd > MAX_SPEED_MS) { breaks.push(t); continue; }
    const hr = hrRaw[i];
    if (typeof hr !== 'number' || !Number.isFinite(hr) || hr <= 0) continue;
    const w = wRaw ? wRaw[i] : null;
    ivs.push({
      t,
      dt,
      spd,
      hr,
      gap: spd * gapFactor(grade[i]),
      w: typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : null,
      grade: grade[i],
    });
  }
  if (!ivs.length) return { ...result, reason: 'sin-tramos-validos' };

  // ── Pasada 2: suavizado del esfuerzo y picos sobre la mediana de la sesión ──
  // El umbral es relativo a la propia sesión, no absoluto: lo que es un pico en un
  // rodaje suave es el ritmo de crucero en un tempo.
  smoothEffort(ivs);
  const medGap = median(ivs.map((v) => v.sgap));
  const medW = median(ivs.filter((v) => v.sw != null).map((v) => v.sw));
  const isSpike = (v) => {
    if (medGap > 0 && Math.abs(v.sgap - medGap) / medGap > SPIKE_PCT) return true;
    return v.sw != null && medW > 0 && Math.abs(v.sw - medW) / medW > SPIKE_PCT;
  };

  // ── Pasada 3: cegado hacia delante y reparto en bloques ────────────────────
  // El cegado es SOLO hacia delante: lo que contamina la relación FC-esfuerzo es el
  // retraso de la FC, que va por detrás del evento y nunca por delante.
  const bins = new Map();
  const binAt = (t) => {
    const t0 = Math.floor(t / BIN_S) * BIN_S;
    let b = bins.get(t0);
    if (!b) { b = acc(); bins.set(t0, b); }
    return b;
  };
  let lastBreak = -Infinity;
  let lastSpike = -Infinity;
  let bi = 0;
  for (const v of ivs) {
    while (bi < breaks.length && breaks[bi] <= v.t) lastBreak = breaks[bi++];
    const spike = isSpike(v);
    if (spike) lastSpike = v.t;
    const b = binAt(v.t);
    if (spike || v.t - lastBreak <= BLANK_AFTER_PAUSE_S || v.t - lastSpike <= BLANK_AFTER_SPIKE_S) {
      b.drop += v.dt;
      continue;
    }
    addTo(b, v);
  }

  const out = [];
  for (const [t0, b] of [...bins.entries()].sort((x, y) => x[0] - y[0])) {
    if (b.s < MIN_BIN_S) continue;
    const hr = b.hr / b.s;
    const gap = b.gap / b.s;
    const row = {
      t0,
      s: round(b.s),
      drop_s: round(b.drop),
      hr: round(hr, 1),
      hr_cv: round(cv(b.hr, b.hr2, b.s, hr), 4),
      gap: round(gap, 3),
      gap_cv: round(cv(b.gap, b.gap2, b.s, gap), 4),
      spd: round(b.spd / b.s, 3),
      grade_abs: round(b.grade / b.s, 4),
    };
    // La potencia solo se publica si cubre casi todo el bloque: una media de W
    // sobre el 30 % del tiempo no es la potencia de esos cinco minutos.
    if (b.wS >= b.s * 0.9 && b.wS > 0) {
      const w = b.w / b.wS;
      row.w = round(w, 1);
      row.w_cv = round(cv(b.w, b.w2, b.wS, w), 4);
    }
    out.push(row);
  }
  if (!out.length) return { ...result, reason: 'sin-bloques-estables' };

  result.has_power = out.some((r) => r.w != null);
  result.bins = out;
  return result;
};
