// ============================================================================
// vitalSeries — series temporales de las métricas vitales (VFC, FC reposo,
// Body Battery, sueño, peso, VO₂max submáximo, eficiencia aeróbica).
//
// Todas comparten la misma rejilla (día a medianoche, o inicio del bucket
// semanal/mensual/anual) para que se puedan apilar o superponer: Resumen Vital
// pinta cuatro en paralelo y el Explorador permite elegir cualquiera y
// compararla con las demás.
//
// Cada serie es [{ ms, raw, smooth }]: `raw` el valor de ese día (solo en
// diario) y `smooth` la media móvil (diario) o la media del bucket.
// ============================================================================

import { vo2FromRun } from './physiology';
import { efficiencyFactorRun } from './efficiencyFactor';
import { COLORS } from './palette';

export const MS_DAY = 86400000;
export const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Color de cada acento de serie (trazo, relleno y clases de chip/icono). */
export const ACCENTS = {
  rose: { stroke: COLORS.risk, fill: "rgba(244,63,94,0.10)", chip: "bg-rose-50 text-rose-600", icon: "bg-rose-50 text-rose-500" },
  emerald: { stroke: COLORS.good, fill: "rgba(16,185,129,0.10)", chip: "bg-emerald-50 text-emerald-600", icon: "bg-emerald-50 text-emerald-500" },
  violet: { stroke: COLORS.seriesViolet, fill: "rgba(139,92,246,0.10)", chip: "bg-violet-50 text-violet-600", icon: "bg-violet-50 text-violet-500" },
  amber: { stroke: COLORS.caution, fill: "rgba(245,158,11,0.10)", chip: "bg-amber-50 text-amber-600", icon: "bg-amber-50 text-amber-500" },
  sky: { stroke: COLORS.seriesSky, fill: "rgba(14,165,233,0.10)", chip: "bg-sky-50 text-sky-600", icon: "bg-sky-50 text-sky-500" },
  indigo: { stroke: COLORS.seriesIndigo, fill: "rgba(99,102,241,0.10)", chip: "bg-indigo-50 text-indigo-600", icon: "bg-indigo-50 text-indigo-500" },
  orange: { stroke: COLORS.elevated, fill: "rgba(249,115,22,0.10)", chip: "bg-orange-50 text-orange-600", icon: "bg-orange-50 text-orange-500" },
  cyan: { stroke: COLORS.seriesCyan, fill: "rgba(8,145,178,0.10)", chip: "bg-cyan-50 text-cyan-600", icon: "bg-cyan-50 text-cyan-500" },
  blue: { stroke: COLORS.signal, fill: "rgba(37,99,235,0.10)", chip: "bg-blue-50 text-blue-600", icon: "bg-blue-50 text-blue-500" },
  fuchsia: { stroke: "#d946ef", fill: "rgba(217,70,239,0.10)", chip: "bg-fuchsia-50 text-fuchsia-600", icon: "bg-fuchsia-50 text-fuchsia-500" },
  lime: { stroke: "#65a30d", fill: "rgba(101,163,13,0.10)", chip: "bg-lime-50 text-lime-700", icon: "bg-lime-50 text-lime-600" },
  teal: { stroke: "#14b8a6", fill: "rgba(20,184,166,0.10)", chip: "bg-teal-50 text-teal-600", icon: "bg-teal-50 text-teal-500" },
  slate: { stroke: COLORS.inkSecondary, fill: "rgba(71,85,105,0.10)", chip: "bg-slate-100 text-slate-600", icon: "bg-slate-100 text-slate-500" },
};

export const fmtDate = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]}`;
};
export const fmtDateFull = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
};

// Bucket a point's timestamp to the start of its day/week/month/year
function bucketStartMs(ms, gran) {
  const d = new Date(ms);
  if (gran === "week") {
    const day = d.getDay() || 7; // Mon=1..Sun=7
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day + 1);
    return d.getTime();
  }
  if (gran === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (gran === "year") return new Date(d.getFullYear(), 0, 1).getTime();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Average raw points [{ms, v}] into buckets → [{ms, smooth, raw:null}]
function aggregate(points, gran, decimals = 1) {
  const buckets = {};
  points.forEach((p) => {
    const key = bucketStartMs(p.ms, gran);
    if (!buckets[key]) buckets[key] = { sum: 0, n: 0 };
    buckets[key].sum += p.v;
    buckets[key].n++;
  });
  return Object.entries(buckets)
    .map(([key, b]) => ({ ms: +key, smooth: +(b.sum / b.n).toFixed(decimals), raw: null }))
    .sort((a, b) => a.ms - b.ms);
}

// Floor a timestamp to local midnight (unifies the day basis across all series)
function dayMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Average points [{ms,v}] that fall on the same local day → sorted [{ms(day), v}]
function mergeByDay(points) {
  const m = {};
  points.forEach((p) => {
    const k = dayMs(p.ms);
    if (!m[k]) m[k] = { s: 0, n: 0 };
    m[k].s += p.v;
    m[k].n++;
  });
  return Object.entries(m)
    .map(([k, x]) => ({ ms: +k, v: x.s / x.n }))
    .sort((a, b) => a.ms - b.ms);
}

// Expand sparse points into a continuous daily grid with a trailing rolling mean.
// Every day gets a point (ms at local midnight) so cross-chart hover sync always matches.
// raw = that day's actual value (or null); smooth = trailing-window mean (or null).
function densifyDaily(points, windowDays, dec = 1) {
  const pts = mergeByDay(points);
  if (!pts.length) return [];
  const rawMap = new Map(pts.map((p) => [p.ms, p.v]));
  const out = [];
  const endMs = pts[pts.length - 1].ms;
  const d = new Date(pts[0].ms);
  let lo = 0, hi = 0, sum = 0, n = 0; // ventana deslizante [cur - windowDays, cur]
  for (let cur = pts[0].ms; cur <= endMs; d.setDate(d.getDate() + 1), cur = dayMs(d.getTime())) {
    const from = cur - windowDays * MS_DAY;
    while (hi < pts.length && pts[hi].ms <= cur) { sum += pts[hi].v; n++; hi++; }
    while (lo < hi && pts[lo].ms < from) { sum -= pts[lo].v; n--; lo++; }
    out.push({
      ms: cur,
      raw: rawMap.has(cur) ? +rawMap.get(cur).toFixed(dec) : null,
      smooth: n ? +(sum / n).toFixed(dec) : null,
    });
  }
  return out;
}

// Contiguous time ranges where a series' smoothed value is >= threshold
export function buildBands(data, threshold) {
  if (threshold == null) return [];
  const bands = [];
  let start = null;
  for (let i = 0; i < data.length; i++) {
    const ok = data[i].smooth != null && data[i].smooth >= threshold;
    if (ok && start == null) start = data[i].ms;
    if (!ok && start != null) { bands.push({ x1: start, x2: data[i].ms }); start = null; }
  }
  if (start != null) {
    const end = data[data.length - 1].ms;
    bands.push({ x1: start, x2: end > start ? end : start + 3 * MS_DAY });
  }
  return bands;
}

// Máximo y mínimo (con su fecha) de la serie suavizada → { max: {v, ms}, min: {v, ms} } | null
export function extremesOf(data) {
  let max = null, min = null;
  for (const d of data) {
    if (d.smooth == null) continue;
    if (!max || d.smooth > max.v) max = { v: d.smooth, ms: d.ms };
    if (!min || d.smooth < min.v) min = { v: d.smooth, ms: d.ms };
  }
  return max ? { max, min } : null;
}

// Ticks equiespaciados para un eje temporal [a, b]
export const evenTicks = (a, b, n = 9) =>
  b > a ? Array.from({ length: n + 1 }, (_, i) => Math.round(a + ((b - a) * i) / n)) : undefined;

// Período mínimo (días) para que cada granularidad produzca ≥2-3 puntos con sentido
export const GRAN_MIN_DAYS = { day: 0, week: 14, month: 90, year: 730 };

export const GRAN_LABEL = { day: "media móvil diaria", week: "media semanal", month: "media mensual", year: "media anual" };
export const AVG_LABEL = { day: "Media móvil", week: "Media sem.", month: "Media mes", year: "Media año" };

/** Formato del eje X según la granularidad. */
export function xFormatter(gran) {
  if (gran === "year") return (ms) => String(new Date(ms).getFullYear());
  if (gran === "month") {
    return (ms) => { const d = new Date(ms); return `${MONTHS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
  }
  return fmtDate;
}

/** Último valor suavizado no nulo (las series densificadas pueden acabar en hueco). */
export function lastOf(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].smooth != null) return arr[i].smooth;
  return null;
}

/** Delta 2ª mitad vs 1ª mitad del período, ignorando días sin datos (no cuentan como 0). */
export function deltaOf(arr, dec = 1) {
  const vals = arr.map((d) => d.smooth ?? d.raw).filter((v) => v != null);
  if (vals.length < 4) return null;
  const mid = Math.floor(vals.length / 2);
  const a = vals.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const b = vals.slice(mid).reduce((s, v) => s + v, 0) / (vals.length - mid);
  return +(b - a).toFixed(dec);
}

/** Dominio X común a las series con datos, o [cutoff, now] si ninguna tiene. */
export function domainOf(metrics, fallback) {
  const all = metrics.flatMap((m) => m.data.map((d) => d.ms));
  return all.length ? [Math.min(...all), Math.max(...all)] : fallback;
}

const tsOf = (iso) => new Date(iso).getTime();

/**
 * Todas las métricas vitales con su serie del período y sus extremos históricos.
 *
 * @param {object} p
 * @param {Array}  p.garmin      filas diarias de Garmin `{ date, hrv, restingHR, bbHigh, bbLow }`
 * @param {Array}  [p.sleep]     semanas de sueño `{ weekStart, score, durationMin }`
 * @param {Array}  [p.weights]   pesadas `{ date, weight_kg }`
 * @param {Array}  [p.pmc]       serie diaria del PMC calibrado `{ date, load, ctl, atl, tsb }`
 * @param {Array}  p.activities  carreras (para VO₂max submáximo y eficiencia)
 * @returns {{ metrics: Array, goodBands: Array, effThreshold: number|null, cutoff: number }}
 *   `metrics` = [{ key, title, accent, unit, decimals, invertY, data, history }]
 */
export function buildVitalMetrics({
  garmin = [], sleep = [], weights = [], pmc = [], activities = [],
  days, gran, gapAdjust = false, hrmax, hrrest, nowMs,
}) {
  const cutoff = nowMs - days * MS_DAY;
  const isDay = gran === "day";
  // - Diario: puntos crudos + línea de media móvil
  // - Semanal/Mensual/Anual: media de cada bucket (sin puntos crudos)
  const series = (pts, smoothWindow, dec = 1) =>
    isDay ? densifyDaily(pts, smoothWindow, dec) : aggregate(pts, gran, dec);

  // Serie del período + extremos del histórico completo (misma granularidad y suavizado).
  // `sparse`: datos de baja frecuencia (sueño semanal) — en diario la media solo
  // se pinta donde hay dato y la línea los une, en vez de escalones de 7 días.
  // `noRaw`: series ya suavizadas (CTL/ATL/TSB) — sin puntos diarios encima.
  const build = (allPts, smoothWindow, dec, { sparse = false, noRaw = false } = {}) => {
    const sorted = [...allPts].sort((a, b) => a.ms - b.ms);
    const make = (pts) => {
      const out = series(pts, smoothWindow, dec);
      if (noRaw) return out.map((d) => ({ ...d, raw: null }));
      return sparse && isDay ? out.map((d) => (d.raw == null ? { ...d, smooth: null } : d)) : out;
    };
    return {
      data: make(sorted.filter((p) => p.ms >= cutoff)),
      history: extremesOf(make(sorted)),
    };
  };
  const garminPts = (field) => garmin
    .filter((d) => d[field] != null)
    .map((d) => ({ ms: tsOf(d.date), v: d[field] }));

  // ── Garmin diario ──
  const hrv = build(garminPts("hrv"), 7, 1);
  const rhr = build(garminPts("restingHR"), 7, 1);
  const bbHigh = build(garminPts("bbHigh"), 7, 0);
  const bbLow = build(garminPts("bbLow"), 7, 0);

  // ── Sueño (Garmin lo da agregado por semanas: un punto por semana) ──
  const sleepScore = build(
    sleep.filter((w) => w.score != null).map((w) => ({ ms: tsOf(w.weekStart), v: w.score })), 21, 0, { sparse: true },
  );
  const sleepHours = build(
    sleep.filter((w) => w.durationMin).map((w) => ({ ms: tsOf(w.weekStart), v: w.durationMin / 60 })), 21, 1, { sparse: true },
  );

  // ── Peso (báscula Garmin) ──
  const weight = build(
    weights.filter((w) => w.weight_kg != null).map((w) => ({ ms: tsOf(w.date), v: w.weight_kg })), 7, 1,
  );

  // ── Carga de entrenamiento (PMC calibrado, el único CTL de la app) ──
  // CTL/ATL/TSB ya son medias exponenciales: ventana 0 = se pintan tal cual.
  // La carga diaria incluye los días de descanso (carga 0) para que su media de
  // 7 días sea la carga media real de la semana.
  const pmcPts = (field) => pmc
    .filter((d) => d[field] != null)
    .map((d) => ({ ms: tsOf(`${d.date}T00:00:00`), v: d[field] }));
  const load = build(pmcPts("load"), 7, 0);
  const ctl = build(pmcPts("ctl"), 0, 1, { noRaw: true });
  const atl = build(pmcPts("atl"), 0, 1, { noRaw: true });
  const tsb = build(pmcPts("tsb"), 0, 1, { noRaw: true });

  // ── VO₂max submáximo (proxy de eficiencia) desde los runs de Strava ──
  // FCmax / FCreposo vienen de useHrParams (detectMaxHR / detectRestHR), no de
  // estimadores propios de esta vista.
  const vo2Pts = activities
    .filter((a) => a.average_heartrate >= 90 && a.average_speed >= 1.5 && (a.moving_time || 0) >= 600)
    .map((a) => {
      const v = vo2FromRun(a.average_speed, a.average_heartrate, hrrest, hrmax);
      return v ? { ms: tsOf(a.start_date), v } : null;
    })
    .filter(Boolean);
  const vo2 = build(vo2Pts, 28, 1); // ~4-week rolling fitness en diario

  // ── Eficiencia aeróbica (metros por latido) ──
  // La definición vive en src/lib/efficiencyFactor.js (m/latido, solo km
  // aeróbicos, ajustada por desnivel): es la compartida por toda la app.
  const effPts = activities
    .map((a) => {
      const v = efficiencyFactorRun(a, { maxObservedHr: hrmax, gapAdjust });
      return v == null ? null : { ms: tsOf(a.start_date), v: +v.toFixed(3) };
    })
    .filter(Boolean)
    .sort((a, b) => a.ms - b.ms);
  const effAll = series(effPts, 28, 2);
  const eff = { data: effAll.filter((d) => d.ms >= cutoff), history: extremesOf(effAll) };

  // ── Banda "buena forma": eficiencia ≥ 85% del máximo histórico ──
  const effMax = effAll.reduce((m, d) => (d.smooth != null && d.smooth > m ? d.smooth : m), 0);
  const effThreshold = effMax > 0 ? +(effMax * 0.85).toFixed(2) : null;
  const goodBands = buildBands(eff.data, effThreshold);

  const metrics = [
    { key: "hrv", title: "VFC", accent: "emerald", unit: "ms", decimals: 0, invertY: false, ...hrv },
    { key: "rhr", title: "FC reposo", accent: "rose", unit: "ppm", decimals: 0, invertY: true, ...rhr },
    { key: "bb", title: "Body Battery máx.", accent: "amber", unit: "/100", decimals: 0, invertY: false, ...bbHigh },
    { key: "bbLow", title: "Body Battery mín.", accent: "orange", unit: "/100", decimals: 0, invertY: false, ...bbLow },
    { key: "sleep", title: "Sueño", accent: "indigo", unit: "/100", decimals: 0, invertY: false, ...sleepScore },
    { key: "sleepHours", title: "Horas de sueño", accent: "cyan", unit: "h", decimals: 1, invertY: false, ...sleepHours },
    { key: "weight", title: "Peso", accent: "slate", unit: "kg", decimals: 1, invertY: false, ...weight },
    { key: "load", title: "Carga diaria", accent: "teal", unit: "TSS", decimals: 0, invertY: false, ...load },
    { key: "ctl", title: "Forma (CTL)", accent: "blue", unit: "", decimals: 1, invertY: false, ...ctl },
    { key: "atl", title: "Fatiga (ATL)", accent: "fuchsia", unit: "", decimals: 1, invertY: false, ...atl },
    { key: "tsb", title: "Frescura (TSB)", accent: "lime", unit: "", decimals: 1, invertY: false, ...tsb },
    { key: "vo2", title: "VO₂max sub.", accent: "violet", unit: "ml/kg/min", decimals: 0, invertY: false, ...vo2 },
    { key: "eff", title: "Eficiencia", accent: "sky", unit: "m/latido", decimals: 2, invertY: false, ...eff },
  ];

  return { metrics, goodBands, effThreshold, cutoff };
}
