// ============================================================================
// raceStrategy — el CÓMO de la carrera objetivo (racePrediction da el CUÁNTO).
//
//   1. Recorrido: GPX/TCX → perfil remuestreado cada 50 m con la altitud
//      suavizada (la cruda de un GPS inventa desnivel), escalado a la distancia
//      oficial: un GPX casi nunca mide exactamente 42 195 m.
//   2. Ritmo km a km a ESFUERZO CONSTANTE: cada tramo de 100 m cuesta lo que dice
//      `gapFactor` (Minetti, el mismo modelo que el GAP de toda la app). Se busca
//      el ritmo en llano que cuadra el tiempo objetivo y se reparte por km:
//      se sube más lento y se baja más rápido, con el mismo coste.
//   3. Calor: WBGT y penalización de la tabla de competición (`heatPenaltyPct`).
//   4. Fade: lo que el atleta suele perder en el último tercio de sus tiradas
//      largas (velocidad ajustada por desnivel de los parciales, mediana).
//   5. Avituallamiento: carbohidratos, líquido y sodio por hora según duración y
//      calor (rangos de consenso ACSM / Jeukendrup), con cada gel en su km.
//
// Puro: sin red ni DOM. La previsión meteorológica la pide services/raceWeather.
// ============================================================================
import { gapFactor } from './gap.js';
import { heatPenaltyPct, wbgtFromCelsius } from './weather.js';
import { activityDayKey } from './trainingLoad.js';

const R_EARTH = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

/** Distancia en metros entre dos [lat, lng] (haversine). */
export function haversine(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

// ── 1. Recorrido ─────────────────────────────────────────────────────────────

/**
 * Puntos `[lat, lng, ele|null]` de un GPX (trkpt/rtept) o TCX (Trackpoint).
 * Por expresiones regulares y no DOMParser: funciona igual en tests y en el
 * navegador, y los dos formatos son lo bastante regulares.
 */
export function parseCourseFile(text) {
  const pts = [];
  const gpx = /<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>|<(?:trkpt|rtept)\b([^>]*)\/>/g;
  let m;
  while ((m = gpx.exec(text))) {
    const attrs = m[1] ?? m[3] ?? '';
    const lat = Number(attrs.match(/lat="([^"]+)"/)?.[1]);
    const lng = Number(attrs.match(/lon="([^"]+)"/)?.[1]);
    const ele = m[2] ? Number(m[2].match(/<ele>([^<]+)<\/ele>/)?.[1]) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push([lat, lng, Number.isFinite(ele) ? ele : null]);
  }
  if (pts.length) return pts;
  const tcx = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
  while ((m = tcx.exec(text))) {
    const lat = Number(m[1].match(/<LatitudeDegrees>([^<]+)</)?.[1]);
    const lng = Number(m[1].match(/<LongitudeDegrees>([^<]+)</)?.[1]);
    const ele = Number(m[1].match(/<AltitudeMeters>([^<]+)</)?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push([lat, lng, Number.isFinite(ele) ? ele : null]);
  }
  return pts;
}

/**
 * Perfil del recorrido remuestreado cada `step` metros:
 * `{ distance_m, gain_m, loss_m, points: [{ d, lat, lng, ele }] }`.
 * Altitud suavizada con media móvil de ±`smoothM` metros.
 */
export function buildCourse(raw, { step = 50, smoothM = 100 } = {}) {
  if (!raw || raw.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + haversine(raw[i - 1], raw[i]));
  const total = cum[cum.length - 1];
  if (!(total > 100)) return null;
  const hasEle = raw.some((p) => p[2] != null);

  // Remuestreo lineal.
  const pts = [];
  let j = 0;
  for (let d = 0; d <= total; d += step) {
    while (j < raw.length - 2 && cum[j + 1] < d) j++;
    const span = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[j]) / span));
    const a = raw[j], b = raw[j + 1];
    const ele = hasEle && a[2] != null && b[2] != null ? a[2] + t * (b[2] - a[2]) : (a[2] ?? b[2] ?? 0);
    pts.push({ d, lat: a[0] + t * (b[0] - a[0]), lng: a[1] + t * (b[1] - a[1]), ele });
  }
  const last = raw[raw.length - 1];
  if (pts[pts.length - 1].d < total) pts.push({ d: total, lat: last[0], lng: last[1], ele: last[2] ?? pts[pts.length - 1].ele });

  // Suavizado de la altitud.
  const w = Math.max(1, Math.round(smoothM / step));
  const smooth = pts.map((p, i) => {
    const lo = Math.max(0, i - w), hi = Math.min(pts.length - 1, i + w);
    let s = 0;
    for (let k = lo; k <= hi; k++) s += pts[k].ele;
    return { ...p, ele: s / (hi - lo + 1) };
  });

  let gain = 0, loss = 0;
  for (let i = 1; i < smooth.length; i++) {
    const dz = smooth[i].ele - smooth[i - 1].ele;
    if (dz > 0) gain += dz; else loss -= dz;
  }
  return { distance_m: Math.round(total), gain_m: Math.round(gain), loss_m: Math.round(loss), has_elevation: hasEle, points: smooth };
}

/** Versión compacta para guardar (un punto cada 100 m, 5 decimales). */
export function compactCourse(course) {
  if (!course) return null;
  const keep = course.points.filter((_, i) => i % 2 === 0 || i === course.points.length - 1);
  return {
    ...course,
    points: keep.map((p) => ({ d: Math.round(p.d), lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5), ele: +p.ele.toFixed(1) })),
  };
}

// ── 2. Ritmo por km a esfuerzo constante ─────────────────────────────────────

/**
 * Plan de ritmo por km. `raceM` es la distancia oficial (el recorrido se escala a
 * ella); `goalSec`, el tiempo objetivo. Devuelve
 * `{ flat_pace_s, kms: [{ km, length_m, grade_pct, gain_m, loss_m, pace_s, split_s, cum_s }] }`.
 */
export function pacePlan(course, raceM, goalSec) {
  if (!course?.points?.length || !(raceM > 0) || !(goalSec > 0)) return null;
  const scale = raceM / course.distance_m;
  const pts = course.points.map((p) => ({ ...p, d: p.d * scale }));

  // Tramos elementales con su pendiente y su factor de coste.
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const len = pts[i].d - pts[i - 1].d;
    if (!(len > 0)) continue;
    const dz = pts[i].ele - pts[i - 1].ele;
    segs.push({ from: pts[i - 1].d, to: pts[i].d, len, dz, f: gapFactor(dz / len) });
  }
  // Tiempo de un tramo = len · f / v_llano  →  v_llano = Σ(len·f) / objetivo.
  const vFlat = segs.reduce((s, x) => s + x.len * x.f, 0) / goalSec;

  const kms = [];
  const nKm = Math.ceil(raceM / 1000 - 1e-6);
  let cum = 0;
  for (let k = 0; k < nKm; k++) {
    const a = k * 1000, b = Math.min(raceM, (k + 1) * 1000);
    let t = 0, gain = 0, loss = 0, net = 0;
    for (const s of segs) {
      const lo = Math.max(a, s.from), hi = Math.min(b, s.to);
      if (hi <= lo) continue;
      const part = (hi - lo) / s.len;
      t += (s.len * part * s.f) / vFlat;
      const dz = s.dz * part;
      net += dz;
      if (dz > 0) gain += dz; else loss -= dz;
    }
    const length = b - a;
    cum += t;
    kms.push({
      km: k + 1,
      length_m: Math.round(length),
      grade_pct: Math.round((net / length) * 1000) / 10,
      gain_m: Math.round(gain),
      loss_m: Math.round(loss),
      pace_s: Math.round(t / (length / 1000)),
      split_s: Math.round(t),
      cum_s: Math.round(cum),
    });
  }
  return { flat_pace_s: Math.round(1000 / vFlat), kms };
}

// ── 3. Calor ─────────────────────────────────────────────────────────────────

/**
 * Calor esperado en carrera: `{ temp_c, humidity_pct, wbgt_c, penalty_pct,
 * adjusted_goal_s, source }`. La penalización es la de tabla a ritmo de
 * competición, que es justo lo que se corre.
 */
export function raceHeat({ temp_c, humidity_pct, source }, goalSec) {
  if (temp_c == null || humidity_pct == null) return null;
  const wbgt = wbgtFromCelsius(temp_c, humidity_pct);
  if (wbgt == null) return null;
  const pct = heatPenaltyPct(wbgt) ?? 0;
  return {
    temp_c: Math.round(temp_c * 10) / 10,
    humidity_pct: Math.round(humidity_pct),
    wbgt_c: Math.round(wbgt * 10) / 10,
    penalty_pct: Math.round(pct * 10) / 10,
    adjusted_goal_s: goalSec ? Math.round(goalSec * (1 + pct / 100)) : null,
    source,
  };
}

// ── 4. Fade ──────────────────────────────────────────────────────────────────

/**
 * Pérdida habitual de velocidad en el último tercio de las tiradas largas.
 * Largas = al menos el 75 % de la distancia de la carrera (mín. 12 km, máx.
 * 30 km para un maratón) en los últimos `months` meses, con ≥ 6 parciales.
 * Usa la velocidad ajustada por pendiente de Strava en cada parcial cuando la
 * hay. `{ fade_pct, runs }` (fade positivo = se termina más lento) o null.
 */
export function typicalFade(activities, raceM, { now = Date.now(), months = 12 } = {}) {
  const minM = Math.min(30000, Math.max(12000, raceM * 0.75));
  const since = now - months * 30.4 * 86400000;
  const fades = [];
  for (const a of activities || []) {
    if (!/run/i.test(a.sport_type || a.type || '') || !(a.distance >= minM)) continue;
    const day = activityDayKey(a);
    if (!day || Date.parse(day) < since) continue;
    const sp = (a.splits_metric || [])
      .filter((s) => s.distance >= 900)
      .map((s) => s.average_grade_adjusted_speed || s.average_speed)
      .filter((v) => v > 0);
    if (sp.length < 6) continue;
    const third = Math.floor(sp.length / 3);
    const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const first = mean(sp.slice(0, third));
    const last = mean(sp.slice(-third));
    fades.push((first / last - 1) * 100);
  }
  if (fades.length < 2) return null;
  const s = [...fades].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const med = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return { fade_pct: Math.round(med * 10) / 10, runs: fades.length };
}

/**
 * Tiempo final si el último tercio sale `fadePct` % más lento que lo planeado.
 * Las tiradas largas no se corren a ritmo de carrera, así que esto es una
 * advertencia, no una predicción: es lo que pasa si se repite el patrón.
 */
export function timeWithFade(plan, fadePct) {
  if (!plan?.kms?.length || fadePct == null) return null;
  const n = plan.kms.length;
  const from = Math.floor((n * 2) / 3);
  const extra = plan.kms.slice(from).reduce((s, k) => s + k.split_s * (Math.max(0, fadePct) / 100), 0);
  return Math.round(plan.kms[n - 1].cum_s + extra);
}

// ── 5. Avituallamiento ───────────────────────────────────────────────────────

/**
 * Pauta por hora y tomas concretas. `durationS` el tiempo previsto, `wbgt` el
 * calor esperado (null = templado), `plan` para situar cada gel en su km.
 */
export function fuelPlan(durationS, wbgt, plan, { gelCarbsG = 25 } = {}) {
  const hours = durationS / 3600;
  const hot = wbgt != null && wbgt >= 18;
  const cold = wbgt != null && wbgt < 10;

  let carbs;
  if (hours < 1.25) carbs = { lo: 0, hi: 30, note: 'Por debajo de ~75 min no hace falta comer: basta con enjuagarse la boca con bebida isotónica si apetece.' };
  else if (hours < 2.5) carbs = { lo: 30, hi: 60, note: 'Entre 30 y 60 g de carbohidratos por hora.' };
  else carbs = { lo: 60, hi: 90, note: 'De 60 a 90 g/h, mezclando glucosa y fructosa para absorber más de 60. Entrénalo antes: el intestino también se entrena.' };

  const fluid = hot ? { lo: 600, hi: 800 } : cold ? { lo: 300, hi: 500 } : { lo: 400, hi: 600 };
  const sodium = hot ? { lo: 500, hi: 1000 } : { lo: 300, hi: 600 };

  const gels = [];
  if (carbs.lo > 0) {
    const target = (carbs.lo + carbs.hi) / 2;
    const every = Math.round(((gelCarbsG / target) * 60) / 5) * 5; // minutos, a múltiplos de 5
    const kmAt = (sec) => plan?.kms?.find((k) => k.cum_s >= sec)?.km ?? null;
    for (let t = 35 * 60; t < durationS - 15 * 60; t += every * 60) {
      gels.push({ at_min: Math.round(t / 60), km: kmAt(t) });
    }
  }

  return {
    hours: Math.round(hours * 100) / 100,
    carbs_g_h: carbs,
    fluid_ml_h: fluid,
    sodium_mg_h: sodium,
    gels,
    gel_carbs_g: gelCarbsG,
    notes: [
      carbs.note,
      hot ? 'Calor: bebe a sed pero sin saltarte avituallamientos, y moja nuca y antebrazos.' : null,
      'Desayuno de 1-4 g de carbohidrato por kg 2-4 h antes de la salida, algo que ya hayas probado.',
    ].filter(Boolean),
  };
}
