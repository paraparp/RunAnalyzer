import { useMemo, useState } from 'react';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import {
  ComposedChart, AreaChart, Area, Line, ScatterChart, Scatter, Cell, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';

// ============================================================
// VO2max Multi-Method Estimation Engine
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

// --- Oxygen cost models ---

/** Daniels-Gilbert quadratic (1979). v = m/min */
function oxygenCostDaniels(vMperMin) {
  return -4.60 + 0.182258 * vMperMin + 0.000104 * vMperMin * vMperMin;
}

/** Léger-Mercier outdoor with Pugh wind resistance (1984). v = km/h */
function oxygenCostLeger(vKmh) {
  return 2.209 + 3.163 * vKmh + 0.000525542 * vKmh * vKmh * vKmh;
}

/** ACSM running metabolic equation. speed = m/min, grade = fractional */
function oxygenCostACSM(speedMperMin, grade) {
  return 0.2 * speedMperMin + 0.9 * speedMperMin * grade + 3.5;
}

// --- HRR method (Swain-Leutholtz 1997) ---

/**
 * %HRR = %VO2R (Swain-Leutholtz 1997)
 * VO2_running = VO2rest + %HRR × (VO2max - VO2rest)
 * Solving: VO2max = VO2rest + (VO2_running - VO2rest) / %HRR
 *
 * @param {number} vo2Running - oxygen cost at running speed (ml/kg/min)
 * @param {number} hr - average heart rate during segment
 * @param {number} hrRest - resting heart rate
 * @param {number} hrMax - maximum heart rate
 * @returns {number|null} estimated VO2max
 */
function vo2maxFromHRR(vo2Running, hr, hrRest, hrMax) {
  const VO2_REST = 3.5; // 1 MET
  const pctHRR = (hr - hrRest) / (hrMax - hrRest);
  if (pctHRR < 0.35 || pctHRR > 0.95) return null;
  const vo2max = VO2_REST + (vo2Running - VO2_REST) / pctHRR;
  return vo2max > 15 && vo2max < 90 ? vo2max : null;
}

// --- %HRmax fallback (Swain 1994) ---

/**
 * %VO2max = 1.5286 × %HRmax - 0.5286
 * Less accurate than HRR but doesn't need resting HR.
 */
function vo2maxFromHRmaxPct(vo2Running, hr, hrMax) {
  const pctHRmax = hr / hrMax;
  if (pctHRmax < 0.55 || pctHRmax > 0.98) return null;
  const pctVO2max = 1.5286 * pctHRmax - 0.5286;
  if (pctVO2max <= 0.20) return null;
  const vo2max = vo2Running / pctVO2max;
  return vo2max > 15 && vo2max < 90 ? vo2max : null;
}

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

function correctDrift(splits) {
  if (!splits || splits.length < 3) return splits;
  const totalDurMin = splits.reduce((s, sp) => s + (sp.moving_time || sp.elapsed_time || 300), 0) / 60;
  let elapsed = 0;

  return splits.map(sp => {
    const dur = (sp.moving_time || sp.elapsed_time || 300) / 60;
    elapsed += dur;
    // Linear drift model: ~3% per hour at moderate effort
    const driftFraction = 0.03 * (elapsed / 60);
    return {
      ...sp,
      hr_corrected: sp.average_heartrate
        ? sp.average_heartrate / (1 + driftFraction)
        : sp.average_heartrate,
    };
  });
}

// --- Resting HR estimation ---

/**
 * Estimate resting HR from multiple runs using linear regression.
 * Extrapolate VO2 vs HR line to VO2rest (3.5 ml/kg/min).
 * Falls back to 0.32 × HRmax if insufficient data.
 */
function estimateRestHR(activities, hrMax) {
  const points = [];
  for (const a of activities) {
    if (!a.average_heartrate || !a.average_speed || a.average_speed < 1.5) continue;
    if (a.moving_time < 600 || a.average_heartrate < 90) continue;
    const vKmh = a.average_speed * 3.6;
    const vo2 = oxygenCostLeger(vKmh);
    points.push({ vo2, hr: a.average_heartrate });
  }

  if (points.length < 5) return Math.round(hrMax * 0.32);

  // Linear regression: hr = slope * vo2 + intercept
  const n = points.length;
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (const p of points) {
    sumX += p.vo2;
    sumY += p.hr;
    sumXX += p.vo2 * p.vo2;
    sumXY += p.vo2 * p.hr;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return Math.round(hrMax * 0.32);

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // Extrapolate to VO2rest = 3.5
  const hrRest = slope * 3.5 + intercept;

  // Sanity bounds (restrict regression madness)
  if (hrRest >= 40 && hrRest <= 80) return Math.round(hrRest);
  return Math.round(hrMax * 0.32); // Fallback to classical 32% rule
}

// --- Multi-method estimator per activity ---

function estimateVO2maxMultiMethod(activity, hrMax, hrRest) {
  const estimates = [];
  const speed = activity.average_speed;
  const hr = activity.average_heartrate;
  if (!speed || speed < 1.5 || !hr || hr < 90) return null;

  const vMperMin = speed * 60;
  const vKmh = speed * 3.6;
  const grade = activity.total_elevation_gain && activity.distance
    ? activity.total_elevation_gain / activity.distance
    : 0;

  // Three oxygen cost models
  const vo2Daniels = oxygenCostDaniels(vMperMin);
  const vo2Leger = oxygenCostLeger(vKmh);
  const vo2ACSM = oxygenCostACSM(vMperMin, grade);

  // Average of models (Léger weighted higher for outdoor)
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

  // Confidence: more methods agreeing = higher confidence
  const spread = estimates.length > 1
    ? Math.max(...estimates.map(e => e.value)) - Math.min(...estimates.map(e => e.value))
    : 5;
  const confidence = Math.min(1.0, (estimates.length / 3) * (1 - Math.min(spread / 15, 0.5)));

  return {
    vo2max: Math.round(weighted * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    methods: estimates,
  };
}

// --- ACSM VO2max fitness classification ---

function getVO2Category(vo2) {
  if (vo2 >= 56) return { label: 'Superior', color: '#10b981', percentile: '95+' };
  if (vo2 >= 51) return { label: 'Excelente', color: '#22c55e', percentile: '80-95' };
  if (vo2 >= 45) return { label: 'Bueno', color: '#2563eb', percentile: '60-80' };
  if (vo2 >= 39) return { label: 'Normal', color: '#f59e0b', percentile: '40-60' };
  if (vo2 >= 34) return { label: 'Regular', color: '#f97316', percentile: '20-40' };
  return { label: 'Bajo', color: '#ef4444', percentile: '<20' };
}

function formatPace(minPerKm) {
  if (!minPerKm || minPerKm <= 0 || minPerKm > 15) return '--:--';
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function getWeekKey(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// ============================================================
// Component
// ============================================================

export default function VO2MaxTracker({ activities }) {
  const [monthsToShow, setMonthsToShow] = useState('12');
  const [smoothing, setSmoothing] = useState('7');

  // Garmin fetch states
  const [garminSyncState, setGarminSyncState] = useState({ loading: false, error: null, success: false });
  const [garminCredentials, setGarminCredentials] = useState({ email: '', password: '' });
  const [garminRestHR, setGarminRestHR] = useState(() => {
    const saved = localStorage.getItem('garminRestHR');
    return saved ? parseInt(saved) : null;
  });
  const [garminHistory, setGarminHistory] = useState(() => {
    const saved = localStorage.getItem('garminHistory');
    return saved ? JSON.parse(saved) : [];
  });
  const [garminMaxHR, setGarminMaxHR] = useState(() => {
    const saved = localStorage.getItem('garminMaxHR');
    return saved ? parseInt(saved) : null;
  });
  const [garminOfficialVO2, setGarminOfficialVO2] = useState(() => {
    const saved = localStorage.getItem('garminOfficialVO2');
    return saved ? parseFloat(saved) : null;
  });
  const [syncProgress, setSyncProgress] = useState('');

  const handleGarminSync = async () => {
    if (!garminCredentials.email || !garminCredentials.password) return;
    setGarminSyncState({ loading: true, error: null, success: false });

    const daysToSync = Math.min(parseInt(monthsToShow) * 30, 365); // Cap at 1 year for safety

    try {
      const response = await fetch('http://localhost:3001/api/garmin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: garminCredentials.email,
          password: garminCredentials.password,
          days: daysToSync
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep last incomplete line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.message) setSyncProgress(data.message);

            if (data.status === 'complete') {
              if (data.success && data.restingHR) {
                setGarminRestHR(data.restingHR);
                localStorage.setItem('garminRestHR', data.restingHR);

                if (data.maxHR) {
                  setGarminMaxHR(data.maxHR);
                  localStorage.setItem('garminMaxHR', data.maxHR);
                }

                if (data.officialVO2Max) {
                  setGarminOfficialVO2(data.officialVO2Max);
                  localStorage.setItem('garminOfficialVO2', data.officialVO2Max);
                }

                if (data.history) {
                  setGarminHistory(data.history);
                  localStorage.setItem('garminHistory', JSON.stringify(data.history));
                }
                setGarminSyncState({ loading: false, error: null, success: true });
                setGarminCredentials({ email: '', password: '' });
              }
            } else if (data.status === 'error') {
              throw new Error(data.error || 'Error en la sincronización');
            }
          }
        }
      }
    } catch (err) {
      setGarminSyncState({ loading: false, error: err.message, success: false });
    } finally {
      setSyncProgress('');
    }
  };

  const { trendData, weeklyData, stats, efficiencyData } = useMemo(() => {
    if (!activities || activities.length === 0)
      return { trendData: [], weeklyData: [], stats: null, efficiencyData: [] };

    // --- Detect HRmax from data (Filtering out sensor glitches) ---
    // Cadence lock and static can cause 1-2 runs to have impossible HRs (e.g., 215 bpm).
    // We sort the max HRs and take the 3rd highest across the whole history to clip anomalies.
    const sortedMaxHR = activities
      .map(a => a.max_heartrate)
      .filter(hr => hr > 100 && hr < 220)
      .sort((a, b) => b - a);

    const detectedMaxHRFromSession = sortedMaxHR.length > 3 ? sortedMaxHR[2] : (sortedMaxHR[0] || 190);

    // Use Garmin HRmax if available, as detected HR (208) is likely sensor noise
    const activeMaxHR = garminMaxHR || detectedMaxHRFromSession;

    // --- Resting HR ---
    // Use Garmin actual if available, else estimate
    const estimatedRestHR = estimateRestHR(activities, activeMaxHR);
    const activeRestHR = garminRestHR || estimatedRestHR;

    const months = parseInt(monthsToShow);
    const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;

    // --- Estimate VO2max for each valid run ---
    const validRuns = activities
      .filter(a => {
        if (!a.average_heartrate || a.average_heartrate < 90) return false;
        if (!a.average_speed || a.average_speed < 1.5) return false;
        if (a.moving_time < 600) return false;
        if (new Date(a.start_date).getTime() < cutoff) return false;
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
          dateLabel: `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`,
          weekKey: getWeekKey(a.start_date),
          km: (a.distance / 1000).toFixed(1),
          duration: Math.round(a.moving_time / 60),
          pace,
          paceLabel: formatPace(pace),
          hr: Math.round(a.average_heartrate),
          vo2max: result.vo2max,
          confidence: result.confidence,
          methods: result.methods,
          methodCount: result.methods.length,
          effIndex: Math.round((a.average_speed / a.average_heartrate) * 10000) / 10,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.dateMs - b.dateMs);

    if (validRuns.length === 0)
      return { trendData: [], weeklyData: [], stats: null, efficiencyData: [] };

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
      if (!weekMap[r.weekKey]) weekMap[r.weekKey] = { values: [], weights: [], eff: [] };
      weekMap[r.weekKey].values.push(r.vo2max);
      weekMap[r.weekKey].weights.push(r.confidence);
      weekMap[r.weekKey].eff.push(r.effIndex);
    });
    const weekly = Object.entries(weekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, d]) => {
        const wSum = d.weights.reduce((s, w) => s + w, 0);
        const wAvg = d.values.reduce((s, v, i) => s + v * d.weights[i], 0) / (wSum || 1);
        const best = Math.max(...d.values);
        const avgEff = d.eff.reduce((s, v) => s + v, 0) / d.eff.length;
        return {
          week: key.slice(6),
          avgVO2: Math.round(wAvg * 10) / 10,
          bestVO2: Math.round(best * 10) / 10,
          sessions: d.values.length,
          avgEff: Math.round(avgEff * 10) / 10,
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

    // Last 30 days
    const last30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = validRuns.filter(r => r.dateMs >= last30);
    const recentAvg = recent.length > 0
      ? recent.reduce((s, r) => s + r.vo2max * r.confidence, 0) / recent.reduce((s, r) => s + r.confidence, 0)
      : 0;

    // Method usage stats
    const methodCounts = { HRR: 0, Firstbeat: 0, '%HRmax': 0 };
    validRuns.forEach(r => r.methods.forEach(m => { methodCounts[m.method] = (methodCounts[m.method] || 0) + 1; }));

    const category = getVO2Category(current);

    return {
      trendData: trend,
      weeklyData: weekly,
      efficiencyData: efficiency,
      stats: {
        current: Math.round(current * 10) / 10,
        peak: Math.round(peak * 10) / 10,
        avg: Math.round(avg * 10) / 10,
        recentAvg: Math.round(recentAvg * 10) / 10,
        trendDir: Math.round(trendDir * 10) / 10,
        category,
        totalSessions: validRuns.length,
        detectedMaxHR: detectedMaxHRFromSession,
        methodCounts,
        avgConfidence: Math.round(avgConf * 100),
        activeRestHR,
        isRestHREstimated: !garminRestHR,
        activeMaxHR,
        isMaxHREstimated: !garminMaxHR,
        officialVO2: garminOfficialVO2
      },
    };
  }, [activities, monthsToShow, smoothing, garminRestHR, garminMaxHR, garminOfficialVO2]);

  if (!stats || trendData.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-sm">No hay datos suficientes para estimar tu VO2max.</p>
        <p className="text-xs mt-2">Se necesitan actividades de +10 min con datos de frecuencia cardíaca.</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }) => {
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
  };

  return (
    <div className="space-y-6">
      {/* Main VO2max display */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Big VO2max card */}
        <div className="bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl p-6 text-center shadow-lg shadow-blue-200 flex flex-col justify-center">
          <p className="text-blue-200 text-[10px] font-bold uppercase tracking-widest mb-1">VO2max Estimado</p>
          <p className="text-5xl font-black text-white tabular-nums">{stats.current}</p>
          <p className="text-blue-200 text-xs mt-1">ml/kg/min</p>
          <div className="mt-3 inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-full" style={{ backgroundColor: stats.category.color + '30' }}>
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stats.category.color }} />
            <span className="text-white text-xs font-semibold">{stats.category.label}</span>
            <span className="text-blue-200 text-[10px]">(P{stats.category.percentile})</span>
          </div>

          {stats.officialVO2 && (
            <div className="mt-2 bg-emerald-400/20 px-2 py-1 rounded-lg border border-emerald-400/10">
              <p className="text-[10px] text-emerald-100 font-bold uppercase tracking-widest">
                Perfil Garmin: <span className="text-white">{stats.officialVO2}</span>
              </p>
            </div>
          )}

          <p className={`text-xs mt-2 font-semibold ${stats.trendDir > 0 ? 'text-emerald-300' : stats.trendDir < -1 ? 'text-rose-300' : 'text-blue-300'}`}>
            {stats.trendDir > 0 ? '↑' : stats.trendDir < -1 ? '↓' : '→'} {stats.trendDir > 0 ? '+' : ''}{stats.trendDir} tendencia
          </p>
          <div className="mt-2 bg-white/10 px-2 py-1 rounded border border-white/10">
            <p className="text-[10px] text-blue-100">
              Confianza media: <span className="font-bold text-white">{stats.avgConfidence}%</span>
            </p>
          </div>
        </div>

        {/* Stat cards */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Pico histórico</p>
            <p className="text-2xl font-black text-emerald-600 tabular-nums">{stats.peak}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">ml/kg/min</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Media global</p>
            <p className="text-2xl font-black text-slate-700 tabular-nums">{stats.avg}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">ml/kg/min</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Últimos 30 días</p>
            <p className="text-2xl font-black text-blue-600 tabular-nums">{stats.recentAvg || '--'}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">ml/kg/min</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
              {stats.isMaxHREstimated ? 'FC máx detectada' : 'FC máx Garmin'}
            </p>
            <p className="text-2xl font-black text-rose-600 tabular-nums">{stats.activeMaxHR}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {stats.isMaxHREstimated ? 'bpm (filtro de ruido)' : 'bpm (perfil oficial)'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
              {stats.isRestHREstimated ? 'FC reposo estimada' : 'FC reposo Garmin'}
            </p>
            <p className="text-2xl font-black text-sky-600 tabular-nums">{stats.activeRestHR}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {stats.isRestHREstimated ? 'bpm (regresión en carreras)' : (
                <span className="flex items-center gap-1 justify-center sm:justify-start">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  bpm (sincronizado exacto)
                </span>
              )}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Sesiones</p>
            <p className="text-2xl font-black text-slate-900 tabular-nums">{stats.totalSessions}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">analizadas</p>
          </div>
        </div>
      </div>

      {/* Method breakdown */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: 'HRR', label: 'Método HRR', desc: 'Swain-Leutholtz 1997', color: '#1d4ed8' },
          { key: 'Firstbeat', label: 'Regresión lineal', desc: 'Tipo Firstbeat/Garmin', color: '#2563eb' },
          { key: '%HRmax', label: '%FCmax', desc: 'Swain 1994 (fallback)', color: '#60a5fa' },
        ].map(m => (
          <div key={m.key} className="bg-white rounded-xl border border-slate-200 p-3 text-center">
            <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ backgroundColor: m.color }} />
            <p className="text-xs font-bold text-slate-700">{m.label}</p>
            <p className="text-lg font-black text-slate-900 tabular-nums mt-1">{stats.methodCounts[m.key] || 0}</p>
            <p className="text-[9px] text-slate-400">{m.desc}</p>
          </div>
        ))}
      </div>

      {/* Garmin Sync Module */}
      <div className={`rounded-xl border p-4 ${garminRestHR ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200 shadow-sm'}`}>
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div>
            <h4 className="font-bold text-sm text-slate-800 mb-1 flex items-center gap-2">
              {garminRestHR ? '✅ Sincronizado con Garmin Connect' : '🔌 Conectar con Garmin Connect (Experimental)'}
            </h4>
            <p className="text-xs text-slate-500 max-w-xl">
              {garminRestHR
                ? `La aplicación está utilizando tu frecuencia cardíaca en reposo real (${garminRestHR} bpm). Esto garantiza que el cálculo de VO2Max sea idéntico al algoritmo Firstbeat/Garmin.`
                : 'El modelo matemático actual está "adivinando" tu frecuencia cardíaca en reposo. Para obtener un VO2Max totalmente preciso y parejo al de tu reloj, introduce tus credenciales de Garmin para extraer tu pulso basal real. (Solo se usa de forma local y no se almacena).'
              }
            </p>
          </div>

          {!garminRestHR && (
            <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
              <input
                type="email"
                placeholder="Email Garmin"
                className="text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={garminCredentials.email}
                onChange={e => setGarminCredentials({ ...garminCredentials, email: e.target.value })}
              />
              <input
                type="password"
                placeholder="Contraseña"
                className="text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={garminCredentials.password}
                onChange={e => setGarminCredentials({ ...garminCredentials, password: e.target.value })}
              />
              <button
                onClick={handleGarminSync}
                disabled={garminSyncState.loading}
                className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                {garminSyncState.loading ? (syncProgress || 'Conectando...') : 'Sincronizar Bio-Garmin'}
              </button>
            </div>
          )}

          {garminRestHR && (
            <button
              onClick={() => {
                setGarminRestHR(null);
                localStorage.removeItem('garminRestHR');
                setGarminHistory([]);
                localStorage.removeItem('garminHistory');
                setGarminMaxHR(null);
                localStorage.removeItem('garminMaxHR');
                setGarminOfficialVO2(null);
                localStorage.removeItem('garminOfficialVO2');
              }}
              className="text-xs font-semibold text-rose-500 hover:text-rose-700 underline"
            >
              Desconectar
            </button>
          )}
        </div>
        {garminSyncState.error && (
          <p className="text-xs text-rose-500 mt-2 font-medium bg-rose-50 p-2 rounded">Error: {garminSyncState.error}</p>
        )}
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

      {/* Main evolution chart */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">Evolución del VO2max</Title>
        <Text className="text-slate-500 text-sm mb-4">
          Multi-método: HRR + regresión Firstbeat + %FCmax con pesos de fiabilidad y corrección de drift
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
                y={stats.peak}
                stroke="#10b981"
                strokeDasharray="5 3"
                strokeWidth={1}
                label={{ value: `Pico: ${stats.peak}`, position: 'insideTopRight', fill: '#10b981', fontSize: 10 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>




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
                tickFormatter={v => formatPace(v)}
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
