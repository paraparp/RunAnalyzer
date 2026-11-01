// ============================================================================
// Resumen Vital desde el MCP.
//
// Usa buildVitalMetrics, la misma función que pinta la pantalla, para que las cifras
// coincidan. Todo sale de datos guardados: salud de Garmin, pesadas y, en la clave
// `vitals_derived`, carga, CTL, ATL, TSB, VO₂max submáximo y eficiencia.
//
// Lo derivado depende de una calibración que se re-detecta y CTL/ATL decaen cada día.
// Por eso lleva una huella de sus entradas: si cambian o cambia el día, se recalcula
// y se vuelve a guardar en vez de servir números que ya no cuadran con la app.
// ============================================================================
import { getActivities, readKey, readKeyFresh, writeKey } from './mcp-store.js';
import { getWeightHistory } from './garmin-live.js';
import {
  buildVitalMetrics, deltaOf, runDerivedPoints, MS_DAY,
} from '../../src/lib/vitalSeries.js';
import {
  computeCalibratedPMC, resolveHrCalibration, OVERRIDES_KEY,
} from '../../src/lib/loadCalibration.js';
import { dayKey } from '../../src/lib/trainingLoad.js';
import { WEIGHT_KEY } from '../../src/lib/weightHistory.js';

export const VITAL_KEYS = [
  'hrv', 'rhr', 'bb', 'bbLow', 'sleep', 'sleepHours', 'sleepHR', 'stress', 'respiration',
  'weight', 'load', 'ctl', 'atl', 'tsb', 'vo2', 'eff',
];

const DERIVED_KEY = 'vitals_derived';
const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const GRANULARITY = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
const AUTO_WEEKLY_DAYS = 180;
const DEFAULT_DAYS = 30;
// Ya son medias exponenciales: no tienen un valor diario distinto de su media.
const NO_RAW = new Set(['ctl', 'atl', 'tsb']);

const asArray = (v) => (Array.isArray(v) ? v : []);
const startMs = (iso) => new Date(`${iso}T00:00:00`).getTime();

/**
 * Pesadas guardadas. Si la clave aún no existe (el primer sync no ha pasado), trae
 * el histórico de Garmin una vez. Sin credenciales o con Garmin caído devuelve [].
 */
async function loadWeights(userId) {
  const stored = await readKey(userId, WEIGHT_KEY);
  if (Array.isArray(stored)) return stored;
  try {
    await getWeightHistory(userId, { days: 1825 });
    return asArray(await readKeyFresh(userId, WEIGHT_KEY));
  } catch {
    return [];
  }
}

const isRunActivity = (a) => RUN_TYPES.includes(a.type) || RUN_TYPES.includes(a.sport_type);

// Todo lo que mueve las métricas derivadas. Los splits cuentan porque la eficiencia
// sale de ellos y llegan después que la actividad.
function derivedFingerprint(activities, garminData, overrides) {
  const latest = activities.reduce((m, a) => (a.start_date > m ? a.start_date : m), '');
  const withSplits = activities.filter((a) => a.splits_metric?.length).length;
  const lastGarmin = garminData.reduce((m, r) => (r.date > m ? r.date : m), '');
  return [
    dayKey(new Date()), activities.length, latest, withSplits, lastGarmin, JSON.stringify(overrides),
  ].join('|');
}

// Igual que useVitalMetrics: la carga con todas las actividades (también cruzado)
// y FCmax y FC de reposo calibradas solo con las carreras.
function computeDerived(activities, garminData, overrides) {
  const runs = activities.filter(isRunActivity);
  const { hrmax, hrrest } = resolveHrCalibration(runs, { garminData, overrides });
  const { pmc, calibration } = computeCalibratedPMC(activities, { garminData, overrides });
  return {
    fingerprint: derivedFingerprint(activities, garminData, overrides),
    computed_at: new Date().toISOString(),
    model: { version: calibration?.version ?? null, hrmax, hrrest, lthr: calibration?.lthr ?? null },
    pmc: (pmc?.series ?? []).map(({ date, load, ctl, atl, tsb }) => ({ date, load, ctl, atl, tsb })),
    ...runDerivedPoints(runs, { hrmax, hrrest }),
  };
}

async function readDerivedInputs(userId) {
  const [activities, garmin, rawOverrides] = await Promise.all([
    getActivities(userId),
    readKey(userId, 'garmin_cardiac_data'),
    readKey(userId, OVERRIDES_KEY),
  ]);
  return {
    activities,
    garminData: asArray(garmin),
    overrides: rawOverrides && typeof rawOverrides === 'object' ? rawOverrides : {},
  };
}

/** Recalcula y guarda lo derivado. Lo llama el sync, con las actividades ya al día. */
export async function refreshVitalsDerived(userId) {
  const { activities, garminData, overrides } = await readDerivedInputs(userId);
  const derived = computeDerived(activities, garminData, overrides);
  await writeKey(userId, DERIVED_KEY, derived);
  return { pmc_days: derived.pmc.length, runs_vo2: derived.vo2.length, runs_eff: derived.eff.length };
}

// Lo guardado si sigue al día; si no, se recalcula. Si falla la escritura, la
// respuesta sigue siendo correcta y el siguiente intento vuelve a guardarlo.
async function loadDerived(userId, garminData) {
  const { activities, overrides } = await readDerivedInputs(userId);
  const stored = await readKey(userId, DERIVED_KEY);
  if (stored?.fingerprint === derivedFingerprint(activities, garminData, overrides)) return stored;
  const derived = computeDerived(activities, garminData, overrides);
  try {
    await writeKey(userId, DERIVED_KEY, derived);
  } catch (e) {
    console.warn('[mcp-vitals] no se pudo guardar lo derivado:', e.message);
  }
  return derived;
}

/** Peso y composición corporal desde el histórico guardado. */
export async function getStoredWeights(userId, { from, to } = {}) {
  const all = await loadWeights(userId);
  const end = to || dayKey(new Date());
  const start = from || dayKey(new Date(startMs(end) - 13 * MS_DAY));
  const weights = all
    .filter((w) => w.date >= start && w.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    count: weights.length,
    weights,
    last_weigh_in: all.length ? all[all.length - 1].date : null,
    ...(weights.length ? {} : { note: `Sin pesadas guardadas entre ${start} y ${end}.` }),
  };
}

/** Las métricas de Resumen Vital: un resumen por métrica y una fila por fecha. */
export async function getVitals(userId, { from, to, granularity, metrics: only } = {}) {
  const [garmin, sleep, weights] = await Promise.all([
    readKey(userId, 'garmin_cardiac_data'),
    readKey(userId, 'garmin_sleep_data'),
    loadWeights(userId),
  ]);
  const garminData = asArray(garmin);
  const derived = await loadDerived(userId, garminData);

  const nowMs = Date.now();
  const end = to || dayKey(new Date(nowMs));
  const start = from || dayKey(new Date(startMs(end) - (DEFAULT_DAYS - 1) * MS_DAY));
  const spanDays = Math.round((startMs(end) - startMs(start)) / MS_DAY) + 1;
  const gran = GRANULARITY[granularity] || (spanDays > AUTO_WEEKLY_DAYS ? 'week' : 'day');

  const { metrics } = buildVitalMetrics({
    garmin: garminData,
    sleep: asArray(sleep),
    weights,
    pmc: derived.pmc,
    derived: { vo2: derived.vo2, eff: derived.eff },
    days: Math.ceil((nowMs - startMs(start)) / MS_DAY) + 1,
    gran,
    nowMs,
  });

  // En semanal o superior, el primer periodo puede empezar antes de `from` aunque
  // sus datos ya estén recortados: se conserva en vez de perderlo entero.
  const inRange = (date) => date <= end && (gran !== 'day' || date >= start);
  const selected = metrics.filter((m) => !only?.length || only.includes(m.key));
  const rowsByDate = new Map();
  const dateOf = (ms) => dayKey(new Date(ms));

  const summaries = selected.map((m) => {
    const points = m.data.filter((d) => inRange(dateOf(d.ms)));
    const withData = [];
    for (const d of points) {
      const date = dateOf(d.ms);
      const hasDaily = gran === 'day' && !NO_RAW.has(m.key);
      const value = hasDaily ? d.raw : d.smooth;
      const avg = hasDaily ? d.smooth : null;
      if (value == null && avg == null) continue;
      const row = rowsByDate.get(date) || { date };
      if (value != null) {
        row[m.key] = value;
        withData.push({ date, value });
      }
      if (avg != null) row[`${m.key}_avg`] = avg;
      rowsByDate.set(date, row);
    }
    const last = withData[withData.length - 1] ?? null;
    const extreme = (e) => (e ? { value: e.v, date: dateOf(e.ms) } : null);
    return {
      key: m.key,
      title: m.title,
      unit: m.unit,
      latest: last,
      change: deltaOf(points, m.decimals),
      days_with_data: withData.length,
      first_date: withData[0]?.date ?? null,
      history_max: extreme(m.history?.max),
      history_min: extreme(m.history?.min),
    };
  });

  const empty = summaries.filter((s) => !s.days_with_data).map((s) => s.key);
  return {
    from: start,
    to: end,
    granularity: Object.keys(GRANULARITY).find((k) => GRANULARITY[k] === gran),
    model: derived.model,
    computed_at: derived.computed_at,
    metrics: summaries,
    rows: [...rowsByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    ...(empty.length ? { no_data: empty } : {}),
  };
}
