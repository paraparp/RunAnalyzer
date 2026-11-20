// ============================================================================
// sessionCompare — dos sesiones lado a lado: qué cifra cambió y hacia dónde.
//
// Cada métrica dice si "más" es mejor (`better`), para que la vista pinte el
// delta en verde o en ámbar sin saber qué significa cada número. Los cálculos
// vienen de lib/sessionAnalysis, los mismos que usa la ficha de sesión.
// ============================================================================
import { sessionGap, sessionEfficiency, sessionDecoupling } from './sessionAnalysis';
import { formatDuration, formatPaceFromSpeed } from './timeFormat';

const movingTime = (a) => a?.moving_time || a?.elapsed_time || 0;
const speedOf = (a) => { const t = movingTime(a); return t > 0 ? a.distance / t : null; };
const spm = (c) => (c > 0 ? Math.round(c < 120 ? c * 2 : c) : null); // Strava da zancadas/min por pierna

/**
 * Filas de la comparativa. `value` es el número crudo (para el delta), `label`
 * cómo se pinta y `better` si es mejor más ('up'), menos ('down') o ninguna (null).
 * Para el ritmo se compara la VELOCIDAD (m/s): así "up" = más rápido.
 */
export function compareRows(a, b) {
  const row = (key, get, fmt, better, unit = '') => {
    const va = get(a);
    const vb = get(b);
    const ok = (v) => v != null && Number.isFinite(v);
    return {
      key,
      a: ok(va) ? va : null,
      b: ok(vb) ? vb : null,
      aLabel: ok(va) ? fmt(va) : '—',
      bLabel: ok(vb) ? fmt(vb) : '—',
      unit,
      better,
      delta: ok(va) && ok(vb) ? vb - va : null,
      deltaPct: ok(va) && ok(vb) && va !== 0 ? Math.round(((vb - va) / Math.abs(va)) * 1000) / 10 : null,
    };
  };
  const km = (v) => (v / 1000).toFixed(2);
  return [
    row('distance', (x) => x.distance, km, null, 'km'),
    row('moving_time', movingTime, (v) => formatDuration(v), null),
    row('pace', speedOf, (v) => formatPaceFromSpeed(v), 'up', '/km'),
    row('gap', (x) => sessionGap(x)?.speed_ms ?? null, (v) => formatPaceFromSpeed(v), 'up', '/km'),
    row('avg_hr', (x) => x.average_heartrate, (v) => String(Math.round(v)), 'down', 'ppm'),
    row('max_hr', (x) => x.max_heartrate, (v) => String(Math.round(v)), null, 'ppm'),
    row('efficiency', (x) => sessionEfficiency(x).whole, (v) => v.toFixed(2), 'up', 'm/lat'),
    row('elevation', (x) => x.total_elevation_gain, (v) => String(Math.round(v)), null, 'm'),
    row('cadence', (x) => spm(x.average_cadence), (v) => String(v), null, 'spm'),
    // Deriva del pulso entre la 1ª y la 2ª mitad: lo que la media esconde.
    row('decoupling', (x) => sessionDecoupling(x).halves?.pct ?? null, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`, 'down', '%'),
  ];
}

/** Tono del delta: 'good' | 'bad' | 'neutral'. Por debajo de 0,5 % es ruido. */
export function deltaTone(row) {
  if (row.delta == null || !row.better || Math.abs(row.deltaPct ?? 0) < 0.5) return 'neutral';
  const improved = row.better === 'up' ? row.delta > 0 : row.delta < 0;
  return improved ? 'good' : 'bad';
}

/**
 * % de coincidencia entre dos sesiones: ¿son de verdad comparables?
 *
 * Tres dimensiones, cada una de 1 (idéntica) a 0 (demasiado distinta), con
 * caída lineal hasta su tolerancia:
 *   distancia   ±30 % relativo  — peso 0,4
 *   ritmo       ±15 % relativo  — peso 0,4
 *   desnivel/km ±15 m/km        — peso 0,2
 * Devuelve `{ pct, parts: { distance, pace, elevation } }` (todo en 0-100), o
 * null si a alguna le falta distancia o tiempo.
 */
export function sessionMatch(a, b) {
  const sA = speedOf(a);
  const sB = speedOf(b);
  if (!(a?.distance > 0) || !(b?.distance > 0) || !(sA > 0) || !(sB > 0)) return null;
  const rel = (x, y) => Math.abs(x - y) / Math.max(x, y);
  const close = (diff, tol) => Math.max(0, 1 - diff / tol);
  const elevKm = (x) => (x.total_elevation_gain || 0) / (x.distance / 1000);
  const parts = {
    distance: close(rel(a.distance, b.distance), 0.30),
    pace: close(rel(sA, sB), 0.15),
    elevation: close(Math.abs(elevKm(a) - elevKm(b)), 15),
  };
  const pct = Math.round((parts.distance * 0.4 + parts.pace * 0.4 + parts.elevation * 0.2) * 100);
  return {
    pct,
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100)])),
  };
}

/**
 * Cambio de FORMA de B frente a A, en %, con todos los datos que haya.
 *
 * Es la eficiencia aeróbica "neta": metros recorridos por cada latido POR
 * ENCIMA del reposo. Dos correcciones sobre el EF simple de la tabla:
 *   - velocidad ajustada por pendiente (GAP) cuando las dos la tienen, para que
 *     un recorrido con cuestas no parezca peor forma;
 *   - FC neta (media − reposo calibrado): el pulso de reposo no hace trabajo, y
 *     restarlo hace el cociente proporcional al esfuerzo real (Karvonen).
 * + = B en mejor forma. null si a alguna le falta velocidad o pulso.
 *
 * `confidence` baja cuando la comparación es menos limpia: distancias muy
 * distintas (la deriva cardiaca de una tirada larga penaliza), intensidades muy
 * distintas (la relación ritmo-pulso no es lineal) o GAP estimado en recorrido
 * con desnivel. `reasons` dice cuáles, para enseñarlo.
 */
export function formChange(a, b, { hrrest = null } = {}) {
  const gA = sessionGap(a);
  const gB = sessionGap(b);
  const useGap = Boolean(gA && gB);
  const speed = (x, g) => (useGap ? g.speed_ms : speedOf(x));
  const sA = speed(a, gA);
  const sB = speed(b, gB);
  const hA = a?.average_heartrate;
  const hB = b?.average_heartrate;
  if (!(sA > 0) || !(sB > 0) || !(hA > 0) || !(hB > 0)) return null;

  // Reposo solo si deja margen razonable: con FC media casi en reposo el
  // cociente se dispara y deja de significar nada.
  const net = hrrest > 0 && hA - hrrest > 20 && hB - hrrest > 20;
  const effA = sA / (net ? hA - hrrest : hA);
  const effB = sB / (net ? hB - hrrest : hB);
  const pct = Math.round((effB / effA - 1) * 1000) / 10;

  const reasons = [];
  const dA = a.distance || 0;
  const dB = b.distance || 0;
  if (Math.max(dA, dB) > 0 && Math.abs(dA - dB) / Math.max(dA, dB) > 0.25) reasons.push('distance');
  if (Math.abs(hA - hB) > 12) reasons.push('intensity');
  const hilly = (x) => x.distance > 0 && (x.total_elevation_gain || 0) / (x.distance / 1000) > 10;
  if ((hilly(a) || hilly(b)) && (!useGap || gA.source !== 'streams' || gB.source !== 'streams')) reasons.push('gap_estimated');

  return {
    pct,
    useGap,
    netHr: net,
    confidence: reasons.length === 0 ? 'high' : reasons.length === 1 ? 'medium' : 'low',
    reasons,
  };
}

/**
 * Veredicto en lenguaje llano: ¿B salió mejor, peor o igual que A?
 *
 * Manda la EFICIENCIA (metros por latido), porque es la que junta ritmo y FC: ir
 * más rápido con más pulsaciones no es necesariamente estar mejor. Si falta la
 * FC, se cae al ritmo. Devuelve `{ outcome, basis, facts }`:
 *   outcome — 'better' | 'worse' | 'same' | 'unknown' (B frente a A)
 *   basis   — 'efficiency' | 'pace' | null: en qué se basa
 *   facts   — frases cortas ya cuantificadas (clave i18n + parámetros), en orden
 *             de importancia, para enseñar debajo del titular.
 */
export function compareVerdict(rows, form = null) {
  const r = Object.fromEntries(rows.map((x) => [x.key, x]));
  const facts = [];
  const pace = r.pace;
  if (pace?.deltaPct != null) {
    const pct = Math.abs(pace.deltaPct);
    facts.push(pct < 0.5
      ? { key: 'same_pace' }
      : { key: pace.deltaPct > 0 ? 'faster' : 'slower', params: { pct } });
  }
  const hr = r.avg_hr;
  if (hr?.delta != null) {
    const d = Math.round(Math.abs(hr.delta));
    facts.push(d < 1 ? { key: 'same_hr' } : { key: hr.delta < 0 ? 'lower_hr' : 'higher_hr', params: { bpm: d } });
  }
  const elev = r.elevation;
  if (elev?.delta != null && Math.abs(elev.delta) >= 20) {
    facts.push({ key: elev.delta > 0 ? 'more_elev' : 'less_elev', params: { m: Math.round(Math.abs(elev.delta)) } });
  }
  const dist = r.distance;
  if (dist?.deltaPct != null && Math.abs(dist.deltaPct) >= 5) {
    facts.push({ key: dist.delta > 0 ? 'longer' : 'shorter', params: { km: (Math.abs(dist.delta) / 1000).toFixed(1) } });
  }

  const pick = (row, basis, threshold) => {
    if (row?.deltaPct == null) return null;
    if (Math.abs(row.deltaPct) < threshold) return { outcome: 'same', basis };
    return { outcome: row.deltaPct > 0 ? 'better' : 'worse', basis };
  };
  // La forma (formChange) manda cuando existe: es la cifra más completa.
  const fromForm = form ? pick({ deltaPct: form.pct }, 'efficiency', 1) : null;
  const v = fromForm ?? pick(r.efficiency, 'efficiency', 1) ?? pick(pace, 'pace', 1) ?? { outcome: 'unknown', basis: null };
  return { ...v, effPct: form?.pct ?? r.efficiency?.deltaPct ?? null, facts };
}

/**
 * Serie km a km de las dos sesiones para el gráfico: `{ km, paceA, paceB, hrA, hrB }`
 * con el ritmo en s/km. Usa splits_metric; los km parciales del final (< 500 m)
 * se descartan porque su ritmo no es comparable.
 */
export function splitSeries(a, b) {
  const splits = (x) => (x?.splits_metric || [])
    .filter((s) => s.distance >= 500 && s.moving_time > 0)
    .map((s) => {
      const pace = s.moving_time / (s.distance / 1000);
      const hr = s.average_heartrate ?? null;
      // m/latido de ese km: la misma eficiencia de la tabla, km a km.
      return { pace, hr, eff: hr > 0 ? Math.round(((1000 / pace) * 60 / hr) * 100) / 100 : null };
    });
  const sa = splits(a);
  const sb = splits(b);
  const n = Math.max(sa.length, sb.length);
  return Array.from({ length: n }, (_, i) => ({
    km: i + 1,
    paceA: sa[i]?.pace ?? null,
    paceB: sb[i]?.pace ?? null,
    hrA: sa[i]?.hr ?? null,
    hrB: sb[i]?.hr ?? null,
    effA: sa[i]?.eff ?? null,
    effB: sb[i]?.eff ?? null,
  }));
}

/**
 * Métricas del gráfico km a km. `lowerIsBetter` decide quién "gana" cada km y
 * `tie` es el margen por debajo del cual se considera empate.
 */
export const KM_METRICS = {
  hr: { a: 'hrA', b: 'hrB', lowerIsBetter: true, tie: 1 },
  eff: { a: 'effA', b: 'effB', lowerIsBetter: false, tie: 0.01 },
  pace: { a: 'paceA', b: 'paceB', lowerIsBetter: true, tie: 1 },
};

/** Ganador de un km para una métrica: 'A' | 'B' | null (empate o sin dato). */
export function kmWinner(point, metric) {
  const m = KM_METRICS[metric];
  const va = point[m.a];
  const vb = point[m.b];
  if (va == null || vb == null || Math.abs(va - vb) <= m.tie) return null;
  return (vb < va) === m.lowerIsBetter ? 'B' : 'A';
}

const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const isRun = (x) => RUN_TYPES.includes(x?.type) || RUN_TYPES.includes(x?.sport_type);

/**
 * Candidatas para comparar con `ref`: carreras de los últimos `months` meses
 * con al menos `minMatch` % de coincidencia (sessionMatch), de la más parecida a
 * la menos. Cada una lleva su `match` para enseñarlo en la lista.
 */
export function compareCandidates(ref, all, { months = 6, minMatch = 70, limit = 30, now = Date.now() } = {}) {
  if (!ref || !Array.isArray(all)) return [];
  const since = now - months * 30.44 * 86400000;
  return all
    .filter((x) => x.id !== ref.id && isRun(x) && Date.parse(x.start_date) >= since)
    .map((x) => ({ activity: x, match: sessionMatch(ref, x) }))
    .filter((c) => c.match && c.match.pct >= minMatch)
    .sort((p, q) => q.match.pct - p.match.pct || String(q.activity.start_date).localeCompare(String(p.activity.start_date)))
    .slice(0, limit);
}

/**
 * Evolución de la forma en las sesiones equivalentes: cada una con su % frente
 * a `ref` (la misma fórmula del titular, formChange) y la recta de tendencia por
 * mínimos cuadrados. `ref` entra con 0 %.
 *
 * Devuelve `{ points: [{ id, t, pct, isRef }], trend: { perMonth, from, to } | null }`
 * con `t` en ms y los puntos ordenados por fecha. Sin tendencia con menos de 3.
 */
export function formEvolution(ref, sessions, { hrrest = null } = {}) {
  if (!ref) return { points: [], trend: null };
  const points = [{ id: ref.id, t: Date.parse(ref.start_date), pct: 0, isRef: true }];
  for (const x of sessions || []) {
    const f = formChange(ref, x, { hrrest });
    if (f) points.push({ id: x.id, t: Date.parse(x.start_date), pct: f.pct, isRef: false });
  }
  points.sort((p, q) => p.t - q.t);
  if (points.length < 3) return { points, trend: null };

  const n = points.length;
  const mx = points.reduce((s, p) => s + p.t, 0) / n;
  const my = points.reduce((s, p) => s + p.pct, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.t - mx) ** 2, 0);
  if (sxx === 0) return { points, trend: null };
  const slope = points.reduce((s, p) => s + (p.t - mx) * (p.pct - my), 0) / sxx; // % por ms
  const at = (t) => Math.round((my + slope * (t - mx)) * 10) / 10;
  const t0 = points[0].t;
  const t1 = points[n - 1].t;
  return {
    points,
    trend: {
      perMonth: Math.round(slope * 30.44 * 86400000 * 10) / 10,
      from: { t: t0, pct: at(t0) },
      to: { t: t1, pct: at(t1) },
    },
  };
}

/** Texto plano de la comparativa, para dárselo al chat como contexto. */
export function compareToText(a, b, rows, labels) {
  const head = (x) => `${x.name} (${String(x.start_date_local || x.start_date).slice(0, 10)})`;
  const lines = rows
    .filter((r) => r.a != null || r.b != null)
    .map((r) => `- ${labels[r.key] ?? r.key}: A ${r.aLabel} · B ${r.bLabel}${r.unit ? ` ${r.unit}` : ''}${r.deltaPct != null ? ` (${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%)` : ''}`);
  return `A = ${head(a)}\nB = ${head(b)}\n${lines.join('\n')}`;
}
