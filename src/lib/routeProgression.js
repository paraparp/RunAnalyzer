// ============================================================================
// routeProgression — "este circuito, 14 veces": evolución sobre el mismo recorrido.
//
// El equivalente a los segmentos de Strava, pero sin comparar tiempo bruto: el
// mismo circuito en agosto a 30 °C y en enero no dice nada por el crono. Se
// compara con dos medidas que sí aguantan la comparación:
//   · GAP (ritmo ajustado por desnivel, `activityGapSpeed`, la misma fuente que
//     el resto de la app: streams si están, si no el D+ de la cabecera).
//   · Eficiencia en m/latido (`efficiencyMPerBeat` sobre el GAP): cuánto avanzas
//     por latido. Solo se usa para la tendencia en las salidas de esfuerzo
//     AERÓBICO (FC media dentro de la banda de `efHrBand`); una carrera o unas
//     series en el mismo circuito no son la misma prueba.
//
// Agrupación: primero por zona de salida (rejilla de ~1 km sobre el primer
// punto), luego `groupRoutes` dentro de cada zona — necesita un origen común de
// rejilla y comparar trazas de ciudades distintas no tiene sentido.
// ============================================================================
import polyline from '@mapbox/polyline';
import { groupRoutes } from './routeSimilarity.js';
import { activityGapSpeed } from './streamGap.js';
import { efficiencyMPerBeat, efHrBand } from './efficiencyFactor.js';
import { activityDayKey } from './trainingLoad.js';

const START_CELL_DEG = 0.01; // ~1,1 km en latitud
const DAY_MS = 86400000;

const startCell = ([lat, lng]) => `${Math.round(lat / START_CELL_DEG)},${Math.round(lng / START_CELL_DEG)}`;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Pendiente por mínimos cuadrados de y frente a x; null con < 3 puntos. */
export function slope(points) {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  return den ? num / den : null;
}

/** Nombre más repetido entre las salidas del recorrido (el que pone el atleta). */
function commonName(acts) {
  const counts = new Map();
  for (const a of acts) {
    const n = (a.name || '').trim();
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  }
  const [name, c] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return c >= 2 ? name : null;
}

/** Una salida del recorrido con sus medidas comparables. */
function sessionRow(a, band) {
  const gap = activityGapSpeed(a);
  const hr = a.average_heartrate || null;
  const aerobic = !!hr && hr >= band.lo && hr <= band.hi;
  return {
    id: a.id,
    name: a.name,
    date: activityDayKey(a),
    distance_m: a.distance,
    moving_s: a.moving_time,
    speed_ms: a.moving_time ? a.distance / a.moving_time : null,
    gap_ms: gap || null,
    hr,
    ef: gap && hr ? efficiencyMPerBeat(gap, hr) : null,
    aerobic,
    elevation_m: a.total_elevation_gain ?? null,
  };
}

/**
 * Recorridos repetidos al menos `minRuns` veces, del más repetido al menos.
 * Cada uno: `{ id, name, distance_km, positions, sessions[], best, latest,
 * median_gap_ms, ef_trend_pct_per_90d, gap_trend_s_per_90d, comparable }`.
 */
export function repeatedRoutes(activities, { minRuns = 3, maxObservedHr } = {}) {
  const band = efHrBand(maxObservedHr);
  const runs = (activities || []).filter((a) => /run/i.test(a.sport_type || a.type || '') && a.map?.summary_polyline && a.distance > 1000);

  const byStart = new Map();
  for (const a of runs) {
    let positions;
    try { positions = polyline.decode(a.map.summary_polyline); } catch { continue; }
    if (positions.length < 2) continue;
    const k = startCell(positions[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push({ id: a.id, positions, activity: a });
  }

  const out = [];
  for (const items of byStart.values()) {
    if (items.length < minRuns) continue;
    const byId = new Map(items.map((r) => [r.id, r]));
    for (const g of groupRoutes(items)) {
      if (g.size < minRuns) continue;
      const members = g.memberIds.map((id) => byId.get(id));
      const acts = members.map((m) => m.activity);
      const sessions = acts.map((a) => sessionRow(a, band)).sort((a, b) => a.date.localeCompare(b.date));

      const withGap = sessions.filter((s) => s.gap_ms);
      const best = withGap.reduce((b, s) => (!b || s.gap_ms > b.gap_ms ? s : b), null);
      const comparable = sessions.filter((s) => s.aerobic && s.ef);
      const t0 = comparable.length ? Date.parse(comparable[0].date) : 0;
      const efSlope = slope(comparable.map((s) => ({ x: (Date.parse(s.date) - t0) / DAY_MS, y: s.ef })));
      const efMedian = median(comparable.map((s) => s.ef));
      const gapSlope = slope(withGap.map((s) => ({ x: (Date.parse(s.date) - t0) / DAY_MS, y: 1000 / s.gap_ms })));

      out.push({
        id: g.id,
        name: commonName(acts),
        distance_km: Math.round(median(acts.map((a) => a.distance)) / 100) / 10,
        positions: byId.get(g.id).positions,
        sessions,
        best,
        latest: sessions[sessions.length - 1],
        median_gap_ms: median(withGap.map((s) => s.gap_ms)),
        comparable: comparable.length,
        // Cambio de EF en 90 días, en % de la mediana (positivo = más eficiente).
        ef_trend_pct_per_90d: efSlope != null && efMedian ? Math.round((efSlope * 90 / efMedian) * 1000) / 10 : null,
        // Cambio de ritmo GAP en 90 días, en s/km (negativo = más rápido).
        gap_trend_s_per_90d: gapSlope != null ? Math.round(gapSlope * 90) : null,
      });
    }
  }
  return out.sort((a, b) => b.sessions.length - a.sessions.length);
}

/** Lectura en una frase de la tendencia de eficiencia del recorrido. */
export function describeTrend(route) {
  const t = route.ef_trend_pct_per_90d;
  if (t == null) return `Hacen falta 3 salidas aeróbicas comparables para ver la tendencia (hay ${route.comparable}).`;
  if (Math.abs(t) < 1) return 'Eficiencia estable en este recorrido.';
  return t > 0
    ? `Cada vez más eficiente: +${t}% de metros por latido cada 90 días.`
    : `Eficiencia a la baja: ${t}% de metros por latido cada 90 días. Mira fatiga, calor o sueño.`;
}
