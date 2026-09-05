import { useMemo, useState, useEffect } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { useTranslation } from 'react-i18next';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import { isoWeekKey } from '../lib/isoWeek';
import { activityDayKey } from '../lib/trainingLoad';
import { formatDuration, formatPaceFromMinPerKm } from '../lib/timeFormat';
import { buildMeanMaxCurve, monthsAgoISO, daysAgoISO, activityWithinMonths, CANON_EFFORTS } from '../lib/criticalSpeed';
import { vdotFromCurve } from '../lib/vdot';
import { detectMaxHR, detectRestHR, DEFAULT_REST_HR } from '../lib/hrZones';
import { activityGapSpeed } from '../lib/streamGap';
import { driftRatePerHour } from '../lib/decoupling';
import { monthShort } from '../lib/monthLabels';
import {
  oxygenCostDaniels, oxygenCostLeger, oxygenCostACSM, vo2maxFromHRR, vo2maxFromHRmaxPct,
} from '../lib/physiology';
import {
  ComposedChart, AreaChart, Area, Line, ScatterChart, Scatter, Cell, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import {
  HeartIcon,
  FlagIcon,
  ChartBarIcon,
  CalendarIcon,
  ClockIcon,
  PlayCircleIcon,
  CpuChipIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

// ============================================================
// VO2max: cifra de cabecera ANCLADA EN RENDIMIENTO + serie submáxima por FC
//
// La cifra grande sale del VDOT sobre la curva de mejores esfuerzos
// (`lib/vdot.vdotFromCurve`), igual que hacen el sistema Daniels y los modelos
// de Garmin/Firstbeat: un tiempo real sobre una distancia real.
//
// La estimación por FC que había aquí NO mide la forma, mide la intensidad de la
// sesión: con el mismo atleta el mismo día, un rodaje suave salía ~16 % más alto
// que un tempo, así que un bloque de base hacía "subir" la curva y una semana de
// series la hacía "bajar". Se conserva como serie SECUNDARIA —proxy submáximo de
// eficiencia— y acotada ya a la banda 70–88 % HRR, que es donde %HRR ≈ %VO2R
// aguanta (Swain-Leutholtz); fuera de ahí no significa nada.
//
// Multi-method engine de la serie submáxima:
//
// Combines 3 independent approaches with reliability weighting:
//
// A) Swain-Leutholtz HRR method (1997)
//    %VO2R = %HRR → most accurate HR-to-VO2 mapping
//    Uses Heart Rate Reserve instead of %HRmax
//
// B) Firstbeat-style linear regression (patent US20110040193A1)
//    Regresses VO2_theoretical vs HR across splits within a run
//    Extrapolates to HRmax → VO2max
//
// C) Léger-Mercier + %HRmax fallback (1984 + Swain 1994)
//    Outdoor oxygen cost with wind resistance cubic term
//    Uses %HRmax when HRrest is unavailable
//
// Each method produces an estimate with a confidence weight.
// Final VO2max = trimmed weighted average across methods.
//
// Additionally applies:
// - Cardiac drift correction (3%/hour linear model)
// - HR zone reliability filtering (65-95% HRmax)
// - Outlier rejection (trimmed mean, discard top/bottom 10%)
// - EWMA temporal weighting (recent sessions count more)
//
// References:
// - Swain & Leutholtz, Med Sci Sports Exerc 1997
// - Léger & Mercier, Sports Medicine 1984
// - Daniels & Gilbert, Oxygen Power 1979
// - Firstbeat white paper 2017 (MAPE ~5%)
// - ACSM Guidelines for Exercise Testing
// ============================================================

// Los modelos de coste de oxígeno (Daniels-Gilbert, Léger-Mercier, ACSM) y las
// dos vías de FC → VO2max (HRR de Swain-Leutholtz y el fallback %FCmax) viven en
// lib/physiology, compartidos con VDOTEstimator y VitalsOverview. Lo que queda
// aquí es la parte propia de esta vista: deriva cardiaca, filtrado, media
// recortada y ponderación EWMA.

// --- Firstbeat-style regression ---

/**
 * Fit VO2_theoretical vs HR across splits using weighted linear regression.
 * Extrapolate to HRmax for VO2max estimate.
 */
function firstbeatRegression(splits, hrMax, hrRest) {
  const points = [];

  for (const sp of splits) {
    const speed = sp.average_speed;
    const hr = sp.hr_corrected || sp.average_heartrate;
    if (!speed || speed < 1.5 || !hr || hr < 90) continue;
    if (sp.distance < 400) continue;

    const vKmh = speed * 3.6;
    const vo2 = oxygenCostLeger(vKmh);

    const pctHRmax = hr / hrMax;
    if (pctHRmax < 0.60 || pctHRmax > 0.95) continue;

    // Reliability weight based on segment duration
    const dur = sp.moving_time || sp.elapsed_time || 300;
    const weight = dur >= 300 ? 1.0 :
      dur >= 180 ? 0.7 :
        dur >= 120 ? 0.4 : 0.1;

    points.push({ hr, vo2, weight });
  }

  if (points.length < 3) return null;

  // Need some HR range variation for reliable regression
  const hrs = points.map(p => p.hr);
  const hrRange = Math.max(...hrs) - Math.min(...hrs);
  if (hrRange < 5) return null; // Relaxed from 8 to capture more steady runs

  // Weighted linear regression: vo2 = slope * hr + intercept
  let sumW = 0, sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (const p of points) {
    sumW += p.weight;
    sumX += p.hr * p.weight;
    sumY += p.vo2 * p.weight;
    sumXX += p.hr * p.hr * p.weight;
    sumXY += p.hr * p.vo2 * p.weight;
  }
  const denom = sumW * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null;

  const slope = (sumW * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / sumW;

  // Slope should be positive (higher HR → higher VO2)
  if (slope <= 0) return null;

  const vo2max = slope * hrMax + intercept;
  return vo2max > 15 && vo2max < 90 ? vo2max : null;
}

// --- Cardiac drift correction ---
//
// La deriva se MIDE en cada sesión (`decoupling.driftRatePerHour`), no se asume:
// antes aquí había un 3%/h fijo, el mismo para un rodaje suave que para unas
// series en calor, y ese número entraba en una regresión que luego se extrapola
// hasta FCmax. La tasa medida es el aumento de FC A IGUAL VELOCIDAD, que es
// exactamente lo que hay que deshacer para comparar los parciales entre sí.
//
// Sin medida (pocos parciales, o sin FC en las ventanas) no se corrige: la
// regresión trabaja con la FC cruda, que es peor que corregir bien pero mejor que
// corregir con una constante inventada.

// Tope de la tasa medida, en fracción por hora. Por debajo de 0 la "deriva
// negativa" suele ser el calentamiento (FC que aún sube al principio), no una
// mejora real: corregir al alza ahí sería inventar. Por arriba, una sesión que se
// desmorona daría un factor que deforma la regresión entera.
const MAX_DRIFT_RATE_PER_H = 0.10;

function correctDrift(splits) {
  if (!splits || splits.length < 3) return splits;
  const measured = driftRatePerHour(splits);
  if (measured == null) return splits;
  const rate = Math.min(Math.max(measured, 0), MAX_DRIFT_RATE_PER_H);
  if (rate === 0) return splits;

  let elapsed = 0;   // segundos hasta el INICIO del parcial en curso
  return splits.map(sp => {
    const dur = sp.moving_time || sp.elapsed_time || 300;
    const midH = (elapsed + dur / 2) / 3600;   // el parcial se ancla en su centro
    elapsed += dur;
    return {
      ...sp,
      hr_corrected: sp.average_heartrate
        ? sp.average_heartrate / (1 + rate * midH)
        : sp.average_heartrate,
    };
  });
}

// --- Multi-method estimator per activity ---

// De qué depende cada método. Dos métodos de la misma familia comparten entrada,
// así que su acuerdo no aporta confianza (ver el cálculo de `confidence`).
const METHOD_FAMILY = {
  HRR: 'coste-de-velocidad',        // vo2Avg + FC media
  '%HRmax': 'coste-de-velocidad',   // vo2Leger + FC media
  Firstbeat: 'regresion-parciales', // pendiente FC→VO2 dentro de la sesión
};
const FAMILY_COUNT = new Set(Object.values(METHOD_FAMILY)).size;

function estimateVO2maxMultiMethod(activity, hrMax, hrRest) {
  const estimates = [];
  const speed = activity.average_speed;
  const hr = activity.average_heartrate;
  if (!speed || speed < 1.5 || !hr || hr < 90) return null;

  const vMperMin = speed * 60;
  const vKmh = speed * 3.6;

  // ACSM espera PENDIENTE NETA con signo, no D+ acumulado: en un bucle que vuelve
  // al inicio la pendiente neta es 0 y meter ahí el desnivel positivo cobra toda la
  // subida sin acreditar la bajada (el término 0.9·S·G infla el VO2 siempre).
  // El desnivel se paga donde toca: velocidad equivalente en llano (Minetti, gap.js)
  // con grade = 0. La fuente la elige `activityGapSpeed` —medida sobre los streams
  // si la actividad viene enriquecida, perfil ondulado sobre el D+ de cabecera si no—,
  // el mismo punto de entrada que usan la tabla del dashboard y el TSS.
  const vFlatMperMin = activityGapSpeed(activity) * 60;

  // Tres modelos de coste de oxígeno para la misma velocidad.
  const vo2Daniels = oxygenCostDaniels(vMperMin);
  const vo2Leger = oxygenCostLeger(vKmh);
  const vo2ACSM = oxygenCostACSM(vFlatMperMin || vMperMin, 0);

  // Mezcla ponderada. AVISO: los pesos son una calibración de esta app, NO salen de
  // ninguna de las referencias de physiology.js. El criterio es la procedencia de
  // cada ecuación: Léger-Mercier se midió corriendo EN EXTERIOR (y ya incluye la
  // resistencia al viento de Pugh), que es el caso de estos datos, así que manda;
  // Daniels-Gilbert viene de rendimiento en competición y ACSM de tapiz rodante,
  // donde no hay viento ni terreno. Cambiar estos pesos mueve toda la serie
  // histórica, así que si se tocan, se tocan a la vez que la versión del cálculo.
  const vo2Avg = (vo2Daniels * 0.3 + vo2Leger * 0.5 + vo2ACSM * 0.2);

  // METHOD A: HRR (Swain-Leutholtz) — highest accuracy
  const estHRR = vo2maxFromHRR(vo2Avg, hr, hrRest, hrMax);
  if (estHRR) {
    // Reliability peaks at 65-80% HRR
    const pctHRR = (hr - hrRest) / (hrMax - hrRest);
    const hrReliability = 1.0 - 2.5 * Math.pow(Math.abs(pctHRR - 0.72), 2);
    estimates.push({ method: 'HRR', value: estHRR, weight: Math.max(0.3, hrReliability) * 2.0 });
  }

  // METHOD B: Firstbeat regression (if splits available)
  if (activity.splits_metric && activity.splits_metric.length >= 3) {
    const corrected = correctDrift(activity.splits_metric);
    const estFB = firstbeatRegression(corrected, hrMax, hrRest);
    if (estFB) {
      estimates.push({ method: 'Firstbeat', value: estFB, weight: 1.8 });
    }
  }

  // METHOD C: %HRmax fallback (Swain 1994)
  const estHRmax = vo2maxFromHRmaxPct(vo2Leger, hr, hrMax);
  if (estHRmax) {
    estimates.push({ method: '%HRmax', value: estHRmax, weight: 0.8 });
  }

  if (estimates.length === 0) return null;

  // Weighted average
  const totalW = estimates.reduce((s, e) => s + e.weight, 0);
  const weighted = estimates.reduce((s, e) => s + e.value * e.weight, 0) / totalW;

  // Confianza por FAMILIAS, no por número de métodos. HRR y %FCmax parten de lo
  // mismo —el coste de oxígeno de la velocidad media y la FC media de la sesión—,
  // sólo cambia cómo traducen esa FC a fracción del VO2max: que coincidan no es
  // evidencia de nada. La única entrada distinta es la regresión FC→VO2 sobre los
  // parciales. Contar los tres como independientes inflaba la confianza por
  // construcción: dos de cada tres sesiones llegaban al máximo sin merecerlo.
  const families = new Set(estimates.map(e => METHOD_FAMILY[e.method]));
  const spread = estimates.length > 1
    ? Math.max(...estimates.map(e => e.value)) - Math.min(...estimates.map(e => e.value))
    : 5;
  const confidence = Math.min(1.0, (families.size / FAMILY_COUNT) * (1 - Math.min(spread / 15, 0.5)));

  return {
    vo2max: Math.round(weighted * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    methods: estimates,
  };
}

// --- ACSM VO2max fitness classification ---

function getVO2Category(vo2, t) {
  if (vo2 >= 56) return { label: t('vo2.categories.superior'), color: '#10b981', percentile: '95+' };
  if (vo2 >= 51) return { label: t('vo2.categories.excellent'), color: '#22c55e', percentile: '80-95' };
  if (vo2 >= 45) return { label: t('vo2.categories.good'), color: '#2563eb', percentile: '60-80' };
  if (vo2 >= 39) return { label: t('vo2.categories.fair'), color: '#f59e0b', percentile: '40-60' };
  if (vo2 >= 34) return { label: t('vo2.categories.poor'), color: '#f97316', percentile: '20-40' };
  return { label: t('vo2.categories.very_poor'), color: '#ef4444', percentile: '<20' };
}

// Definido fuera del componente: dentro del render sería un tipo nuevo en cada
// render y Recharts remontaría el subárbol del tooltip entero.
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs max-w-[260px]">
      <p className="font-bold text-slate-700 mb-1">{d.name || d.week}</p>
      {d.dateLabel && <p className="text-slate-500">{d.dateLabel} — {d.km} km — {d.duration} min</p>}
      {d.paceLabel && <p className="text-slate-500">Ritmo: {d.paceLabel}/km | FC: {d.hr} bpm</p>}
      {d.vo2max !== undefined && (
        <p className="text-blue-600 font-bold">
          VO2max: {d.vo2max} ml/kg/min
          {d.confidence !== undefined && <span className="text-slate-400 font-normal ml-1">({Math.round(d.confidence * 100)}% conf.)</span>}
        </p>
      )}
      {d.vo2avg !== undefined && <p className="text-blue-500">Media ponderada: {d.vo2avg}</p>}
      {d.methods && d.methods.length > 0 && (
        <div className="mt-1 pt-1 border-t border-slate-100">
          {d.methods.map((m, i) => (
            <p key={i} className="text-slate-400">
              {m.method}: {Math.round(m.value * 10) / 10} <span className="opacity-60">(w={m.weight.toFixed(1)})</span>
            </p>
          ))}
        </div>
      )}
      {d.avgVO2 !== undefined && <p className="text-blue-600 font-bold">Media: {d.avgVO2}</p>}
      {d.bestVO2 !== undefined && <p className="text-emerald-600">Mejor: {d.bestVO2}</p>}
      {d.sessions !== undefined && <p className="text-slate-400">{d.sessions} sesiones</p>}
    </div>
  );
}

export default function VO2MaxTracker({ activities }) {
  const { t, i18n } = useTranslation();
  const MONTH_SHORT = monthShort(i18n.language);

  const [monthsToShow, setMonthsToShow] = useState('12');
  const [smoothing, setSmoothing] = useState('7');

  // ── Datos fisiológicos del sync global de Garmin ──────────────────────────
  // El VO2max NO hace su propio login: reutiliza `garmin_cardiac_data`, que ya
  // genera la sincronización global (App.syncGarminData → restingHR por día).
  const readGarminCardiac = () => {
    try { return JSON.parse(cloudStorage.getItem('garmin_cardiac_data') || 'null'); }
    catch { return null; }
  };

  const [garminCardiac, setGarminCardiac] = useState(readGarminCardiac);

  // Refrescar cuando el sync global termine
  useEffect(() => {
    const refresh = () => setGarminCardiac(readGarminCardiac());
    window.addEventListener('garmin_sync_complete', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('garmin_sync_complete', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // FC reposo basal: vía ÚNICA compartida con el resto de la app (hrZones.detectRestHR).
  // Antes esta pestaña tenía su propia mediana de 14 días + un estimador por regresión,
  // así que daba una FCreposo distinta a la de Zonas/Umbrales sobre los mismos datos.
  const garminRestHR = useMemo(() => {
    const { value, source } = detectRestHR(garminCardiac);
    return source === 'garmin' ? value : null;
  }, [garminCardiac]);

  // Historial de FC reposo para la gráfica, acotado al rango seleccionado
  const garminHistory = useMemo(() => {
    if (!garminCardiac?.length) return [];
    // `r.date` es un día ya local (YYYY-MM-DD): se compara como texto contra la
    // misma frontera de calendario que usa el resto de la pestaña.
    const fromISO = monthsToShow === '60' ? null : monthsAgoISO(parseInt(monthsToShow));
    return garminCardiac
      .filter(r => r.restingHR > 20 && (!fromISO || String(r.date).slice(0, 10) >= fromISO))
      .map(r => ({ date: r.date, rhr: r.restingHR }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [garminCardiac, monthsToShow]);

  const { trendData, weeklyData, stats, efficiencyData } = useMemo(() => {
    if (!activities || activities.length === 0)
      return { trendData: [], weeklyData: [], stats: null, efficiencyData: [] };

    // --- FCmax: fuente única del proyecto (mediana del 5% superior, filtro 140-215) ---
    const { value: activeMaxHR } = detectMaxHR(activities);

    // --- FC reposo: Garmin si hay, si no el valor por defecto honesto. Sin heurísticas. ---
    const activeRestHR = garminRestHR || DEFAULT_REST_HR;

    const months = parseInt(monthsToShow);
    // Misma ventana que el ancla de rendimiento de abajo: meses de calendario
    // sobre el día local, no bloques de 30 días cortados en un instante UTC.
    const inWindow = activityWithinMonths(months);

    // --- ANCLA DE RENDIMIENTO: VDOT sobre la curva de mejores esfuerzos ---
    // Es la cifra de cabecera. Solo un esfuerzo mejor que los anteriores la sube;
    // un rodaje suave no puede moverla, al revés que la estimación por FC.
    const fromISO = monthsAgoISO(months);
    const anchor = vdotFromCurve(buildMeanMaxCurve(activities, { from: fromISO }));

    // Tendencia del ancla: mejor VDOT de la segunda mitad de la ventana contra el
    // de la primera. Se comparan rendimientos, no puntos de trabajo.
    const midISO = monthsAgoISO(Math.max(1, Math.round(months / 2)));
    const anchorPrev = vdotFromCurve(buildMeanMaxCurve(activities, { from: fromISO, to: midISO }));
    const anchorRecent = vdotFromCurve(buildMeanMaxCurve(activities, { from: midISO }));
    const anchorTrend = (anchorPrev && anchorRecent)
      ? Math.round((anchorRecent.vdot - anchorPrev.vdot) * 10) / 10
      : null;

    // La forma ACTUAL es el mejor rendimiento de la mitad reciente de la ventana;
    // el pico es el mejor de toda ella. Si la mitad reciente no tiene ningún
    // esfuerzo utilizable, la cabecera cae al ancla global (y se dice de cuándo es).
    const headlineAnchor = anchorRecent || anchor;

    const describe = (fit) => fit ? {
      vdot: fit.vdot,
      n: fit.n,
      label: CANON_EFFORTS.find(e => e.id === fit.anchor.id)?.label || fit.anchor.id,
      date: fit.anchor.date,
      timeLabel: formatDuration(fit.anchor.time_s),
      paceLabel: formatPaceFromMinPerKm(fit.anchor.pace_min_km),
      activityName: fit.anchor.activity_name,
    } : null;

    const anchorInfo = describe(headlineAnchor);
    const anchorPeak = anchor ? anchor.vdot : null;

    // --- Estimate VO2max for each valid run ---
    const validRuns = activities
      .filter(a => {
        if (!a.average_heartrate || a.average_heartrate < 90) return false;
        if (!a.average_speed || a.average_speed < 1.5) return false;
        if (a.moving_time < 600) return false;
        if (!inWindow(a)) return false;
        return true;
      })
      .map(a => {
        const result = estimateVO2maxMultiMethod(a, activeMaxHR, activeRestHR);
        if (!result) return null;

        const pace = 16.6667 / a.average_speed;
        const date = new Date(a.start_date);

        return {
          id: a.id,
          name: a.name,
          date: a.start_date,
          dateMs: date.getTime(),
          day: activityDayKey(a),
          dateLabel: `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`,
          weekKey: isoWeekKey(activityDayKey(a)),
          km: (a.distance / 1000).toFixed(1),
          duration: Math.round(a.moving_time / 60),
          pace,
          paceLabel: formatPaceFromMinPerKm(pace),
          hr: Math.round(a.average_heartrate),
          vo2max: result.vo2max,
          confidence: result.confidence,
          methods: result.methods,
          methodCount: result.methods.length,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.dateMs - b.dateMs);

    // Con la banda de HRR ya acotada a 70–88 % es normal que no haya sesiones
    // válidas (un bloque entero de rodaje suave queda fuera). El ancla de
    // rendimiento no depende de la FC, así que la cabecera se sigue pintando.
    if (validRuns.length === 0) {
      if (!anchorInfo) return { trendData: [], weeklyData: [], stats: null, efficiencyData: [] };
      return {
        trendData: [], weeklyData: [], efficiencyData: [],
        stats: {
          current: anchorInfo.vdot,
          currentSource: 'vdot',
          anchor: anchorInfo,
          submaxCurrent: null,
          peak: anchorPeak,
          avg: anchorInfo.vdot,
          recentAvg: anchorInfo.vdot,
          trendDir: anchorTrend ?? 0,
          trendSource: anchorTrend != null ? 'vdot' : 'none',
          category: getVO2Category(anchorInfo.vdot, t),
          totalSessions: 0,
          detectedMaxHR: activeMaxHR,
          methodCounts: { HRR: 0, Firstbeat: 0, '%HRmax': 0 },
          avgConfidence: 0,
          activeRestHR,
          isRestHREstimated: !garminRestHR,
          activeMaxHR,
          isMaxHREstimated: true,
        },
      };
    }

    // --- Trimmed mean: discard top/bottom 10% of estimates ---
    const sortedByVO2 = [...validRuns].sort((a, b) => a.vo2max - b.vo2max);
    const trimN = Math.max(1, Math.floor(sortedByVO2.length * 0.10));
    const trimmedSet = new Set(
      [
        ...sortedByVO2.slice(0, trimN).map(r => r.id),
        ...sortedByVO2.slice(-trimN).map(r => r.id),
      ]
    );

    // --- Rolling average with EWMA + confidence weighting ---
    const windowSize = parseInt(smoothing);
    const trend = validRuns.map((r, i) => {
      const start = Math.max(0, i - windowSize + 1);
      const windowSlice = validRuns.slice(start, i + 1);

      // Weighted average: confidence × recency
      let totalW = 0, sumW = 0;
      windowSlice.forEach((w, j) => {
        const recencyW = 0.5 + 0.5 * (j / Math.max(1, windowSlice.length - 1));
        const confW = w.confidence;
        const trimW = trimmedSet.has(w.id) ? 0.3 : 1.0; // reduce outlier influence
        const weight = recencyW * confW * trimW;
        totalW += weight;
        sumW += w.vo2max * weight;
      });

      const avgVO2 = totalW > 0 ? sumW / totalW : r.vo2max;

      return {
        ...r,
        vo2avg: Math.round(avgVO2 * 10) / 10,
        isTrimmed: trimmedSet.has(r.id),
      };
    });

    // --- Weekly aggregation ---
    const weekMap = {};
    validRuns.forEach(r => {
      if (!weekMap[r.weekKey]) weekMap[r.weekKey] = { values: [], weights: [] };
      weekMap[r.weekKey].values.push(r.vo2max);
      weekMap[r.weekKey].weights.push(r.confidence);
    });
    const weekly = Object.entries(weekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, d]) => {
        const wSum = d.weights.reduce((s, w) => s + w, 0);
        const wAvg = d.values.reduce((s, v, i) => s + v * d.weights[i], 0) / (wSum || 1);
        const best = Math.max(...d.values);
        return {
          week: key.slice(6),
          avgVO2: Math.round(wAvg * 10) / 10,
          bestVO2: Math.round(best * 10) / 10,
          sessions: d.values.length,
        };
      });

    // --- Efficiency scatter ---
    const efficiency = validRuns.map(r => ({ ...r, paceNum: r.pace }));

    // --- Stats ---
    const current = trend.length > 0 ? trend[trend.length - 1].vo2avg : 0;
    const allVO2 = validRuns.map(r => r.vo2max);
    const peak = Math.max(...allVO2);
    const avg = allVO2.reduce((s, v) => s + v, 0) / allVO2.length;

    // Trend direction
    const mid = Math.floor(validRuns.length / 2);
    const firstHalfAvg = mid > 0 ? validRuns.slice(0, mid).reduce((s, r) => s + r.vo2max, 0) / mid : 0;
    const secondHalfAvg = validRuns.length - mid > 0
      ? validRuns.slice(mid).reduce((s, r) => s + r.vo2max, 0) / (validRuns.length - mid) : 0;
    const trendDir = secondHalfAvg - firstHalfAvg;

    // Average confidence
    const avgConf = validRuns.reduce((s, r) => s + r.confidence, 0) / validRuns.length;

    // Últimos 30 días, en días LOCALES: el corte por instante UTC metía o sacaba
    // la sesión de primera hora del día frontera según el huso del atleta.
    const last30 = daysAgoISO(30);
    const recent = validRuns.filter(r => r.day && r.day >= last30);
    const recentAvg = recent.length > 0
      ? recent.reduce((s, r) => s + r.vo2max * r.confidence, 0) / recent.reduce((s, r) => s + r.confidence, 0)
      : 0;

    // Method usage stats
    const methodCounts = { HRR: 0, Firstbeat: 0, '%HRmax': 0 };
    validRuns.forEach(r => r.methods.forEach(m => { methodCounts[m.method] = (methodCounts[m.method] || 0) + 1; }));

    // La cabecera es el ancla de rendimiento; la serie por FC solo la sustituye
    // si todavía no hay ningún esfuerzo dentro de la ventana de validez del VDOT.
    const submaxCurrent = Math.round(current * 10) / 10;
    const headline = anchorInfo ? anchorInfo.vdot : submaxCurrent;
    const headlineTrend = anchorInfo
      ? (anchorTrend ?? 0)
      : Math.round(trendDir * 10) / 10;
    const category = getVO2Category(headline, t);

    return {
      trendData: trend,
      weeklyData: weekly,
      efficiencyData: efficiency,
      stats: {
        current: headline,
        currentSource: anchorInfo ? 'vdot' : 'hr',
        anchor: anchorInfo,
        submaxCurrent,
        peak: anchorInfo ? anchorPeak : Math.round(peak * 10) / 10,
        submaxPeak: Math.round(peak * 10) / 10,
        avg: Math.round(avg * 10) / 10,
        recentAvg: Math.round(recentAvg * 10) / 10,
        trendDir: headlineTrend,
        trendSource: anchorInfo ? (anchorTrend != null ? 'vdot' : 'none') : 'hr',
        category,
        totalSessions: validRuns.length,
        detectedMaxHR: activeMaxHR,
        methodCounts,
        avgConfidence: Math.round(avgConf * 100),
        activeRestHR,
        isRestHREstimated: !garminRestHR,
        activeMaxHR,
        isMaxHREstimated: true,
      },
    };
  }, [activities, monthsToShow, smoothing, garminRestHR, t, MONTH_SHORT]);

  if (!stats) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-sm">{t('vo2.no_data', 'No hay datos suficientes para estimar tu VO2max.')}</p>
        <p className="text-xs mt-2">{t('vo2.no_data_desc', 'Se necesitan actividades de +10 min con datos de frecuencia cardíaca.')}</p>
      </div>
    );
  }


  return (
    <div className="space-y-6">
      {/* Main VO2max display */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Big VO2max card */}
        <div className="bg-slate-900 rounded-3xl p-8 text-center shadow-2xl shadow-blue-100/50 flex flex-col justify-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 transition-transform group-hover:scale-125">
            <SparklesIcon className="w-24 h-24 text-white" />
          </div>
          <p className="text-blue-400 text-[10px] font-black uppercase tracking-[0.2em] mb-3 relative z-10">
            {stats.currentSource === 'vdot' ? t('vo2.anchored') : t('vo2.estimated')}
          </p>
          <div className="relative z-10">
            <p className="text-7xl font-black text-white tabular-nums tracking-tighter leading-none">{stats.current}</p>
            <p className="text-blue-300 text-xs font-bold mt-2 uppercase tracking-widest">{t('vo2.ml_kg_min')}</p>
          </div>

          {/* Procedencia: qué rendimiento sostiene la cifra, o por qué no hay ancla */}
          <p className="text-blue-300/70 text-[10px] font-bold mt-3 relative z-10 px-4 leading-snug">
            {stats.anchor
              ? `${t('vo2.anchor_from')} ${stats.anchor.label} ${stats.anchor.timeLabel} · ${stats.anchor.paceLabel}/km · ${stats.anchor.date}`
              : t('vo2.anchor_missing')}
          </p>

          <div className="mt-8 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm relative z-10">
            <div className="w-2.5 h-2.5 rounded-full animate-pulse shadow-[0_0_10px_rgba(255,255,255,0.5)]" style={{ backgroundColor: stats.category.color }} />
            <span className="text-white text-xs font-black uppercase tracking-wider">{t(`vo2.categories.${stats.category.label}`, stats.category.label)}</span>
            <span className="text-blue-300 text-[10px] font-bold">(P{stats.category.percentile})</span>
          </div>

          <div className="mt-6 flex flex-col gap-2 relative z-10">
            <div className="flex items-center justify-between px-2 pt-4 border-t border-white/5">
              <p className={`text-[11px] font-black uppercase tracking-widest ${stats.trendDir > 0 ? 'text-emerald-400' : stats.trendDir < -1 ? 'text-rose-400' : 'text-blue-400'}`}>
                {stats.trendDir > 0 ? t('vo2.tendency') : stats.trendDir < -1 ? t('vo2.drop') : t('vo2.stable')}
              </p>
              <p className="text-white font-black text-xs">
                {stats.trendDir > 0 ? '+' : ''}{stats.trendDir}
              </p>
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            {
              label: t('vo2.peak'),
              value: stats.peak ?? '--',
              unit: t('vo2.ml_kg_min'),
              color: "text-emerald-600",
              icon: FlagIcon,
              sub: stats.currentSource === 'vdot' ? t('vo2.peak_window') : null,
            },
            {
              label: stats.currentSource === 'vdot' ? t('vo2.submax') : t('vo2.global_avg'),
              value: (stats.currentSource === 'vdot' ? stats.submaxCurrent : stats.avg) ?? '--',
              unit: t('vo2.ml_kg_min'),
              color: "text-slate-600",
              icon: ChartBarIcon,
              sub: stats.currentSource === 'vdot' ? t('vo2.submax_sub') : null,
            },
            { label: t('vo2.last_30'), value: stats.recentAvg || '--', unit: t('vo2.ml_kg_min'), color: "text-blue-600", icon: CalendarIcon },
            {
              label: stats.isMaxHREstimated ? t('vo2.garmin_sync.max_hr') + " " + t('vo2.garmin_sync.estimated_suffix') : t('vo2.garmin_sync.max_hr') + " (Garmin)",
              value: stats.activeMaxHR,
              unit: "bpm",
              color: "text-rose-600",
              icon: HeartIcon,
              sub: stats.isMaxHREstimated ? t('hr_analysis.diagnosis.noise_filter', 'Filtro de ruido') : t('vo2.garmin_sync.official')
            },
            {
              label: stats.isRestHREstimated ? t('vo2.garmin_sync.resting_hr') + " " + t('vo2.garmin_sync.estimated_suffix') : t('vo2.garmin_sync.resting_hr') + " (Garmin)",
              value: stats.activeRestHR,
              unit: "bpm",
              color: "text-sky-600",
              icon: ClockIcon,
              sub: stats.isRestHREstimated ? t('fitness.how_to_read', 'Regresión lineal') : t('vo2.garmin_sync.connected').split(' ')[0]
            },
            { label: t('vo2.sessions'), value: stats.totalSessions, unit: t('vo2.analyzed'), color: "text-slate-900", icon: PlayCircleIcon },
          ].map((card, idx) => (
            <div key={idx} className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm transition-all hover:shadow-md group">
              <div className="flex justify-between items-start mb-3">
                <div className="p-2 bg-slate-50 rounded-xl text-slate-400 group-hover:text-slate-600 transition-colors">
                  {card.icon && <card.icon className="w-5 h-5" />}
                </div>
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">{card.label}</div>
              </div>
              <div className="flex items-baseline gap-1.5">
                <p className={`text-2xl font-black tabular-nums transition-transform group-hover:translate-x-1 ${card.color}`}>{card.value}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{card.unit}</p>
              </div>
              {card.sub && (
                <div className="mt-2 text-[9px] font-bold text-slate-400 flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-slate-200" />
                  {card.sub}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Method breakdown — los tres métodos son de la serie SUBMÁXIMA por FC */}
      {trendData.length > 0 && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { key: 'HRR', label: 'Estrategia HRR', desc: 'Basado en Reserva (Swain 1997)', color: 'bg-blue-600' },
          { key: 'Firstbeat', label: 'Regresión Lineal', desc: 'Patrón Firstbeat Analytics', color: 'bg-slate-900' },
          { key: '%HRmax', label: 'Swain Fallback', desc: 'Basado en %FCmax 1994', color: 'bg-slate-400' },
        ].map(m => (
          <div key={m.key} className="bg-white rounded-2xl border border-slate-100 p-5 flex items-center gap-4 shadow-sm hover:shadow-md transition-all">
            <div className={`w-12 h-12 ${m.color} rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-slate-200`}>
              <span className="font-black text-lg leading-none">{stats.methodCounts[m.key] || 0}</span>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-0.5">{m.label}</p>
              <p className="text-xs font-bold text-slate-600">{m.desc}</p>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Estado de datos fisiológicos (proviene del sync global de Garmin) */}
      <div className={`rounded-2xl border-l-[12px] p-8 transition-all bg-white border border-slate-100 ${garminRestHR ? 'border-l-emerald-500 shadow-xl shadow-emerald-100/20' : 'border-l-slate-300 shadow-sm'}`}>
        <div className="flex flex-col xl:flex-row gap-6 items-start xl:items-center justify-between">
          <div className="flex-1">
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full mb-4 ${garminRestHR ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
              <CpuChipIcon className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">{garminRestHR ? 'Bio-Sincronización Activa' : 'Sin datos fisiológicos'}</span>
            </div>
            <h4 className="font-black text-2xl text-slate-900 tracking-tight mb-2">
              {garminRestHR ? 'Usando tus datos reales de Garmin' : 'Sincroniza Garmin para mayor precisión'}
            </h4>
            <p className="text-sm text-slate-500 max-w-2xl leading-relaxed font-medium">
              {garminRestHR
                ? `Frecuencia cardíaca en reposo basal de ${garminRestHR} bpm (última medición) tomada de tu sincronización de Garmin. No hace falta volver a iniciar sesión aquí.`
                : 'Este apartado reutiliza los datos de tu sincronización global de Garmin. Conéctate desde el botón de sincronización principal y la FC en reposo real se aplicará aquí automáticamente. Mientras tanto se usan estimaciones.'
              }
            </p>
          </div>

          {garminRestHR && (
            <div className="flex items-center gap-3 px-5 py-3 bg-emerald-50 rounded-2xl border border-emerald-100">
              <span className="text-3xl font-black text-emerald-600 tabular-nums">{garminRestHR}</span>
              <div className="text-[10px] font-black uppercase tracking-widest text-emerald-500 leading-tight">FC Reposo<br />Garmin</div>
            </div>
          )}
        </div>
      </div>

      {/* Garmin Resting HR History Chart - MOVED UP for visibility */}
      {garminHistory && garminHistory.length > 0 && (
        <Card className="shadow-lg border-sky-100 bg-sky-50/20">
          <div className="flex justify-between items-center mb-4">
            <div>
              <Title className="text-slate-800 font-bold mb-1">📈 Historial de FC Reposo (Garmin)</Title>
              <Text className="text-slate-500 text-sm">Tus latidos basales detectados al dormir en el rango seleccionado ({monthsToShow === '60' ? 'histórico' : `${monthsToShow} meses`}).</Text>
            </div>
            <div className="bg-sky-100 px-3 py-1 rounded-full border border-sky-200">
              <p className="text-sky-700 text-xs font-bold">Media: {Math.round(garminHistory.reduce((s, i) => s + i.rhr, 0) / garminHistory.length)} bpm</p>
            </div>
          </div>
          <div className="h-[200px] w-full min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%" minHeight={200}>
              <AreaChart data={garminHistory}>
                <defs>
                  <linearGradient id="colorRHR" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: '#64748b' }}
                  tickFormatter={(str) => {
                    const d = new Date(str);
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  }}
                />
                <YAxis
                  hide={false}
                  domain={['dataMin - 5', 'dataMax + 5']}
                  tick={{ fontSize: 9, fill: '#64748b' }}
                />
                <RechartsTooltip
                  contentStyle={{ fontSize: '10px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelFormatter={(str) => new Date(str).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
                />
                <Area
                  type="monotone"
                  dataKey="rhr"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorRHR)"
                  name="Pulsaciones (bpm)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Controls */}
      <div className="flex gap-3">
        <Select value={monthsToShow} onValueChange={setMonthsToShow} className="w-32">
          <SelectItem value="3">3 meses</SelectItem>
          <SelectItem value="6">6 meses</SelectItem>
          <SelectItem value="12">12 meses</SelectItem>
          <SelectItem value="24">24 meses</SelectItem>
          <SelectItem value="60">Todo</SelectItem>
        </Select>
        <Select value={smoothing} onValueChange={setSmoothing} className="w-40">
          <SelectItem value="3">Media 3 sesiones</SelectItem>
          <SelectItem value="7">Media 7 sesiones</SelectItem>
          <SelectItem value="14">Media 14 sesiones</SelectItem>
          <SelectItem value="21">Media 21 sesiones</SelectItem>
        </Select>
      </div>

      {/* Main evolution chart — serie SUBMÁXIMA, no la cifra de cabecera */}
      {trendData.length > 0 && (
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">VO2max submáximo (proxy de eficiencia)</Title>
        <Text className="text-slate-500 text-sm mb-4">
          Multi-método por FC: HRR (70–88 % HRR) + regresión Firstbeat + %FCmax. Mide el punto de
          trabajo de cada sesión, no la forma: la cifra de cabecera sale del VDOT sobre tus mejores
          esfuerzos.
        </Text>
        <div className="h-[360px] w-full min-h-[360px]">
          <ResponsiveContainer width="100%" height="100%" minHeight={360}>
            <ComposedChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                interval={Math.max(0, Math.floor(trendData.length / 14))}
              />
              <YAxis
                domain={['dataMin - 3', 'dataMax + 3']}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                label={{ value: 'ml/kg/min', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 10 }}
              />
              <RechartsTooltip content={<CustomTooltip />} />

              <Scatter dataKey="vo2max" fill="#60a5fa" fillOpacity={0.35} r={3} name="VO2max sesión" />

              <Line
                type="monotone"
                dataKey="vo2avg"
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={false}
                name="Media ponderada"
              />

              <ReferenceLine
                y={stats.submaxPeak}
                stroke="#10b981"
                strokeDasharray="5 3"
                strokeWidth={1}
                label={{ value: `Pico: ${stats.submaxPeak}`, position: 'insideTopRight', fill: '#10b981', fontSize: 10 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
      )}




      {/* Weekly breakdown */}
      {weeklyData.length > 2 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">VO2max Semanal</Title>
          <Text className="text-slate-500 text-sm mb-4">Media ponderada por confianza y mejor estimación por semana</Text>
          <div className="h-[280px] w-full min-h-[280px]">
            <ResponsiveContainer width="100%" height="100%" minHeight={280}>
              <ComposedChart data={weeklyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis
                  domain={['dataMin - 2', 'dataMax + 2']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                />
                <RechartsTooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="bestVO2"
                  fill="#93c5fd"
                  fillOpacity={0.3}
                  stroke="#3b82f6"
                  strokeWidth={1}
                  name="Mejor"
                />
                <Line
                  type="monotone"
                  dataKey="avgVO2"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#2563eb' }}
                  name="Media"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Efficiency scatter */}
      {efficiencyData.length > 0 && (
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">Eficiencia Aeróbica</Title>
        <Text className="text-slate-500 text-sm mb-4">
          Ritmo vs FC — puntos más abajo y a la izquierda = más eficiente
        </Text>
        <div className="h-[320px] w-full min-h-[320px]">
          <ResponsiveContainer width="100%" height="100%" minHeight={320}>
            <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="hr"
                type="number"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                domain={['dataMin - 5', 'dataMax + 5']}
                name="FC media"
                unit=" bpm"
              />
              <YAxis
                dataKey="paceNum"
                type="number"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                reversed
                tickFormatter={v => formatPaceFromMinPerKm(v)}
                domain={['dataMin - 0.3', 'dataMax + 0.3']}
                name="Ritmo"
              />
              <ZAxis dataKey="confidence" range={[20, 120]} name="Confianza" />
              <RechartsTooltip content={<CustomTooltip />} />
              <Scatter data={efficiencyData} name="Sesiones">
                {efficiencyData.map((entry, idx) => {
                  const recencyRatio = idx / Math.max(1, efficiencyData.length - 1);
                  const alpha = 0.25 + recencyRatio * 0.65;
                  return (
                    <Cell key={idx} fill={`rgba(37, 99, 235, ${alpha})`} />
                  );
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">
          Puntos más oscuros = sesiones más recientes. Tamaño = confianza de la estimación.
        </p>
      </Card>
      )}

      {/* VO2max classification */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">Clasificación VO2max (ACSM)</Title>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: 'Superior', range: '56+', color: '#10b981' },
            { label: 'Excelente', range: '51-55', color: '#22c55e' },
            { label: 'Bueno', range: '45-50', color: '#2563eb' },
            { label: 'Normal', range: '39-44', color: '#f59e0b' },
            { label: 'Regular', range: '34-38', color: '#f97316' },
            { label: 'Bajo', range: '<34', color: '#ef4444' },
          ].map(tier => {
            const isActive = tier.label === stats.category.label;
            return (
              <div
                key={tier.label}
                className={`text-center p-3 rounded-xl border-2 transition-all ${isActive ? 'scale-105 shadow-md' : 'opacity-60'}`}
                style={{
                  borderColor: isActive ? tier.color : '#e2e8f0',
                  backgroundColor: isActive ? tier.color + '15' : 'white',
                }}
              >
                <p className="text-xs font-bold" style={{ color: tier.color }}>{tier.label}</p>
                <p className="text-lg font-black text-slate-800 tabular-nums mt-1">{tier.range}</p>
                <p className="text-[9px] text-slate-400">ml/kg/min</p>
                {isActive && <p className="text-[9px] font-bold mt-1" style={{ color: tier.color }}>Tu nivel</p>}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Methodology */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">Motor de Estimación (3 métodos)</Title>
        <div className="space-y-4 text-sm text-slate-600">
          <div>
            <p className="font-bold text-slate-700 mb-1">A) Método HRR — Swain & Leutholtz (1997)</p>
            <p className="text-xs">El más preciso. Usa la Reserva de FC (no el %FCmax) que tiene relación 1:1 con la Reserva de VO2.</p>
            <div className="bg-slate-50 rounded-lg p-2 mt-1 text-[11px] font-mono text-slate-500">
              %HRR = (FC - FC_reposo) / (FC_max - FC_reposo)<br />
              VO2max = 3.5 + (VO2_ritmo - 3.5) / %HRR
            </div>
          </div>
          <div>
            <p className="font-bold text-slate-700 mb-1">B) Regresión lineal tipo Firstbeat/Garmin</p>
            <p className="text-xs">Regresiona VO2 teórico vs FC a través de los splits de cada sesión. Extrapola a FC_max para estimar VO2max. Requiere variación de ritmo dentro de la sesión.</p>
            <div className="bg-slate-50 rounded-lg p-2 mt-1 text-[11px] font-mono text-slate-500">
              VO2 = slope × FC + intercept (regresión ponderada)<br />
              VO2max = slope × FC_max + intercept
            </div>
          </div>
          <div>
            <p className="font-bold text-slate-700 mb-1">C) %FCmax — Swain (1994) (fallback)</p>
            <p className="text-xs">Menos preciso pero siempre disponible. Relación lineal entre %FCmax y %VO2max.</p>
            <div className="bg-slate-50 rounded-lg p-2 mt-1 text-[11px] font-mono text-slate-500">
              %VO2max = 1.5286 × %FCmax − 0.5286
            </div>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <p className="font-bold text-slate-700 mb-1">Coste de O2 (3 modelos promediados)</p>
            <div className="bg-slate-50 rounded-lg p-2 text-[11px] font-mono text-slate-500 space-y-0.5">
              <p>Daniels-Gilbert (30%): −4.60 + 0.182v + 0.000104v²</p>
              <p>Léger-Mercier outdoor (50%): 2.209 + 3.163v + 0.000526v³</p>
              <p>ACSM con pendiente (20%): 0.2S + 0.9SG + 3.5</p>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <p className="font-bold text-slate-700 mb-1">Correcciones aplicadas</p>
            <ul className="text-xs space-y-0.5 list-disc list-inside text-slate-500">
              <li><span className="font-semibold text-slate-600">Drift cardíaco:</span> corrección lineal −3%/hora en FC de cada split</li>
              <li><span className="font-semibold text-slate-600">FC reposo:</span> estimada por regresión VO2-FC multi-sesión (tu estimación: {stats.estimatedRestHR} bpm)</li>
              <li><span className="font-semibold text-slate-600">Filtro de zona:</span> solo segmentos al 60-95% FCmax</li>
              <li><span className="font-semibold text-slate-600">Outlier rejection:</span> trimmed mean (descarta 10% extremos)</li>
              <li><span className="font-semibold text-slate-600">EWMA temporal:</span> sesiones recientes pesan más en la media móvil</li>
            </ul>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            Validación Firstbeat (2017): MAPE ~5% vs lab VO2max en 2690 sesiones de 79 corredores.
            La precisión depende de un sensor de FC fiable y una FCmax bien calibrada.
          </p>
        </div>
      </Card>
    </div>
  );
}
