// ============================================================================
// statusStats — la matemática del estado del atleta.
//
// Vivía dentro de `StatusSnapshot.jsx`, un componente de 1256 líneas que era a la
// vez hub de cuatro pestañas y dueño de estos dos cálculos. Al salir gana lo de
// siempre: un solo punto de entrada para los números que ahora pintan tres
// vistas distintas (el hero de Hoy, la comparativa de Carga y el panel de
// Garmin), y tests, que dentro del componente no tenía.
//
// `now` se INYECTA en lugar de leer el reloj: las ventanas de 7/28/365 días son
// el corazón de todo esto, y un cálculo que consulta el reloj por su cuenta no se
// puede fijar en un test ni es estable entre repintados.
// ============================================================================
import { weekStartKey } from './isoWeek';
import { dayKey, activityDayKey } from './trainingLoad';
import { formatPaceFromSpeed, formatDurationHm } from './timeFormat';

export const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

export const isRun = (a) => RUNNING_TYPES.includes(a.type) || RUNNING_TYPES.includes(a.sport_type);

export const paceStr = (speedMs) => formatPaceFromSpeed(speedMs, '—');
export const timeStr = (seconds) => formatDurationHm(seconds, '—');
export const fmt1 = (n) => (n == null ? '—' : Number(n).toFixed(1));

// ─── main computation ─────────────────────────────────────────────────────────
export function computeStats(activities, pmc, { now: nowInput = Date.now() } = {}) {
  if (!activities || activities.length === 0) return null;

  const now = new Date(nowInput);
  const nowMs = now.getTime();
  const thisYear = now.getFullYear();

  // ── PMC: llega ya calibrado desde useCalibratedPMC (fuente única compartida
  // con FitnessFatigue, InjuryRisk, VitalsOverview, el coach IA y el MCP; antes
  // esta vista usaba su propia carga `(min/60)*0.5`, y después una calibración
  // por defecto que ignoraba la FC de reposo real y los overrides manuales).
  if (!pmc) return null;

  let peakCTL = 0, peakCTLDate = '', peakCTLYear = 0;
  const weeklyLoadMap = {};
  const ctlSeries = pmc.series.map((p) => {
    if (p.ctl > peakCTL) { peakCTL = p.ctl; peakCTLDate = p.date; }
    if (Number(p.date.slice(0, 4)) === thisYear && p.ctl > peakCTLYear) peakCTLYear = p.ctl;

    const wk = weekStartKey(new Date(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10))));
    if (!weeklyLoadMap[wk]) weeklyLoadMap[wk] = { load: 0 };
    weeklyLoadMap[wk].load += p.load;

    return {
      date: p.date,
      ctl: p.ctl,
      atl: p.atl,
      tsb: p.tsb,
      load: p.load,
      activities: p.activities.map((a) => ({
        id: a.id,
        name: a.name,
        distance: a.distance,
        type: a.type,
        sport_type: a.sport_type,
        moving_time: a.moving_time,
        average_speed: a.average_speed,
        average_heartrate: a.average_heartrate,
        suffer_score: a.suffer_score,
      })),
    };
  });

  const currentCTL = pmc.current.ctl;
  const currentATL = pmc.current.atl;
  const currentTSB = pmc.current.tsb;
  // ACWR por EWMA 7:28 (Williams 2017), no ATL/CTL(42).
  const currentACWR = pmc.current.acwr ?? 0;

  const ctl7ago = currentCTL - pmc.current.ctlTrend7;
  const ctl28ago = currentCTL - pmc.current.ctlTrend28;

  // full history available for chart
  const chartDataFull = ctlSeries;

  // ── weekly km (running) ──
  const runActivities = activities.filter(isRun);
  const weeklyKm = {};
  runActivities.forEach((a) => {
    const wk = weekStartKey(activityDayKey(a));
    weeklyKm[wk] = (weeklyKm[wk] || 0) + a.distance / 1000;
  });

  const allWeeklyKmVals = Object.entries(weeklyKm);
  const peakWeekKm = allWeeklyKmVals.reduce((max, [, v]) => Math.max(max, v), 0);
  const thisYearWeeks = allWeeklyKmVals.filter(([k]) => k.startsWith(String(thisYear)));
  const peakWeekKmYear = thisYearWeeks.reduce((max, [, v]) => Math.max(max, v), 0);
  const avgWeekKmYear = thisYearWeeks.length > 0 ? thisYearWeeks.reduce((s, [, v]) => s + v, 0) / thisYearWeeks.length : 0;

  const last7daysMs = nowMs - 7 * 86400000;
  const last7daysKm = runActivities
    .filter((a) => new Date(a.start_date).getTime() >= last7daysMs)
    .reduce((s, a) => s + a.distance / 1000, 0);

  // ── best pace efforts ──
  const pace5kAll = [], pace5kYear = [], pace5kRecent = [];
  const pace10kAll = [], pace10kYear = [], pace10kRecent = [];
  const last28Ms = nowMs - 28 * 86400000;

  runActivities.forEach((a) => {
    if (!a.average_speed || a.average_speed <= 0) return;
    const t = new Date(a.start_date).getTime();
    const isThisYear = new Date(a.start_date).getFullYear() === thisYear;
    const isRecent = t >= last28Ms;
    const dist = a.distance;

    if (dist >= 4800 && dist <= 5200) {
      pace5kAll.push(a.average_speed);
      if (isThisYear) pace5kYear.push(a.average_speed);
      if (isRecent) pace5kRecent.push(a.average_speed);
    }
    if (dist >= 9500 && dist <= 10500) {
      pace10kAll.push(a.average_speed);
      if (isThisYear) pace10kYear.push(a.average_speed);
      if (isRecent) pace10kRecent.push(a.average_speed);
    }
  });

  const bestSpeed = (arr) => (arr.length ? Math.max(...arr) : null);

  // ── HR efficiency ──
  const hrEff = (arr) => {
    const valid = arr.filter((a) => a.average_heartrate && a.average_speed > 0 && a.distance > 3000);
    if (!valid.length) return null;
    const avg = valid.reduce((s, a) => {
      const speedKmh = a.average_speed * 3.6;
      return s + a.average_heartrate / speedKmh;
    }, 0) / valid.length;
    return avg;
  };

  const recentRuns = runActivities.filter((a) => new Date(a.start_date).getTime() >= last28Ms);
  const yearRuns = runActivities.filter((a) => new Date(a.start_date).getFullYear() === thisYear);

  const hrEffRecent = hrEff(recentRuns);
  const hrEffYear = hrEff(yearRuns);
  const hrEffAll = hrEff(runActivities);

  // ── consistency ──
  // Días LOCALES a los dos lados de la comparación: con `start_date` en UTC y
  // "hoy" sacado de `toISOString()`, entre las 00:00 y las 02:00 locales la
  // ventana entera se corría un día.
  const activeDays = new Set(activities.map(activityDayKey).filter(Boolean));
  const last28days = Array.from({ length: 28 }, (_, i) => dayKey(new Date(nowMs - i * 86400000)));
  const activeLast28 = last28days.filter((d) => activeDays.has(d)).length;
  const activeLast7 = last28days.slice(0, 7).filter((d) => activeDays.has(d)).length;

  // streak
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = dayKey(new Date(nowMs - i * 86400000));
    if (activeDays.has(d)) streak++;
    else break;
  }

  // ── elevation ──
  const elevLast28 = runActivities
    .filter((a) => new Date(a.start_date).getTime() >= last28Ms)
    .reduce((s, a) => s + (a.total_elevation_gain || 0), 0);

  // monthly elevation this year
  const monthlyElev = {};
  runActivities.forEach((a) => {
    const d = new Date(a.start_date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthlyElev[key] = (monthlyElev[key] || 0) + (a.total_elevation_gain || 0);
  });
  const elevMonthsYear = Object.entries(monthlyElev)
    .filter(([k]) => k.startsWith(String(thisYear)))
    .map(([, v]) => v);
  const avgMonthlyElevYear = elevMonthsYear.length ? elevMonthsYear.reduce((s, v) => s + v, 0) / elevMonthsYear.length : 0;
  const allElevMonths = Object.values(monthlyElev);
  const peakMonthlyElev = allElevMonths.length ? Math.max(...allElevMonths) : 0;

  // ── weekly CTL sparkline data (last 8 weeks, 1 point/week) ──
  const sparklineWeeks = 8;
  const sparkData = Array.from({ length: sparklineWeeks }, (_, i) => {
    const offset = (sparklineWeeks - 1 - i) * 7;
    const idx = ctlSeries.length - 1 - offset;
    if (idx < 0) return null;
    return ctlSeries[idx];
  }).filter(Boolean);

  return {
    currentCTL, currentATL, currentTSB, currentACWR,
    peakCTL, peakCTLDate, peakCTLYear,
    ctl7ago, ctl28ago,
    last7daysKm, avgWeekKmYear, peakWeekKm, peakWeekKmYear,
    bestPace5kRecent: bestSpeed(pace5kRecent),
    bestPace5kYear: bestSpeed(pace5kYear),
    bestPace5kAll: bestSpeed(pace5kAll),
    bestPace10kRecent: bestSpeed(pace10kRecent),
    bestPace10kYear: bestSpeed(pace10kYear),
    bestPace10kAll: bestSpeed(pace10kAll),
    hrEffRecent, hrEffYear, hrEffAll,
    activeLast7, activeLast28, streak,
    elevLast28, avgMonthlyElevYear, peakMonthlyElev,
    chartDataFull,
    sparkData,
  };
}

// ─── garmin stats ─────────────────────────────────────────────────────────────
export function computeGarminStats(rawData, { now: nowInput = Date.now() } = {}) {
  if (!rawData || rawData.length === 0) return null;

  const sorted = [...rawData].sort((a, b) => a.date.localeCompare(b.date));
  const now = new Date(nowInput);
  const thisYear = now.getFullYear();
  // `d.date` de Garmin es un día local: los cortes también, o la ventana se
  // desplaza un día en la franja de madrugada.
  const last7  = dayKey(new Date(now.getTime() -  7 * 86400000));
  const last28 = dayKey(new Date(now.getTime() - 28 * 86400000));
  const last60 = dayKey(new Date(now.getTime() - 60 * 86400000));

  const recent7      = sorted.filter(d => d.date >= last7);
  const recent28     = sorted.filter(d => d.date >= last28);
  const recent60     = sorted.filter(d => d.date >= last60);
  const thisYearData = sorted.filter(d => d.date.startsWith(String(thisYear)));

  const avg = (arr, key) => {
    const vals = arr.map(d => d[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const minVal = (arr, key) => {
    const vals = arr.map(d => d[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? Math.min(...vals) : null;
  };
  const maxVal = (arr, key) => {
    const vals = arr.map(d => d[key]).filter(v => v != null && !isNaN(v));
    return vals.length ? Math.max(...vals) : null;
  };

  // ── Detect if HRV data exists ──
  const hasHRV = sorted.some(d => d.hrv != null && d.hrv > 0);
  const recoveryKey = hasHRV ? 'hrv' : 'bbHigh'; // prefer HRV, fallback to Body Battery

  // Latest values
  const lastWithHR  = [...sorted].reverse().find(d => d.restingHR != null);
  const lastWithRec = [...sorted].reverse().find(d => d[recoveryKey] != null);

  const currentRHR = lastWithHR?.restingHR ?? null;
  const currentRec = lastWithRec?.[recoveryKey] ?? null;  // HRV (ms) or BB (0-100)
  const currentBBLow = hasHRV ? null : lastWithRec?.bbLow ?? null;

  // ── Calculate 15-day rolling averages for min/max peaks ──
  const rolling15 = sorted.map((d, i) => {
    const startIdx = Math.max(0, i - 14);
    const window = sorted.slice(startIdx, i + 1);
    
    const rhrVals = window.map(w => w.restingHR).filter(v => v != null && !isNaN(v));
    const rhrAvg15 = rhrVals.length >= 5 ? +(rhrVals.reduce((a,b)=>a+b,0)/rhrVals.length).toFixed(1) : null;
    
    const recVals = window.map(w => w[recoveryKey]).filter(v => v != null && !isNaN(v));
    const recAvg15 = recVals.length >= 5 ? +(recVals.reduce((a,b)=>a+b,0)/recVals.length).toFixed(1) : null;

    return {
      date: d.date,
      rhrAvg15,
      recAvg15
    };
  });
  const rolling15ThisYear = rolling15.filter(d => d.date.startsWith(String(thisYear)));

  // ── RHR stats ──
  const rhr7avg  = avg(recent7,  'restingHR');
  const rhr28avg = avg(recent28, 'restingHR');
  
  const rhrAllTimeMin = minVal(rolling15, 'rhrAvg15');
  const rhrAllTimeMax = maxVal(rolling15, 'rhrAvg15');
  const rhrYearMin    = minVal(rolling15ThisYear, 'rhrAvg15');
  const rhrYearMax    = maxVal(rolling15ThisYear, 'rhrAvg15');

  // ── Recovery (HRV or BB) stats ──
  const rec7avg      = avg(recent7,      recoveryKey);
  const rec28avg     = avg(recent28,     recoveryKey);
  const rec60avg     = avg(recent60,     recoveryKey); // personal baseline for HRV
  
  const recAllTimeMax = maxVal(rolling15, 'recAvg15');
  const recAllTimeMin = minVal(rolling15, 'recAvg15');
  const recYearAvg    = avg(thisYearData,    recoveryKey);
  const recYearMax    = maxVal(rolling15ThisYear, 'recAvg15');

  // ── HRV deviation from personal baseline (key metric) ──
  // Standard practice: compare current 7d avg vs 60d rolling baseline
  // > +10% above baseline = very recovered, < -10% = suppressed
  const hrvDeviation = (hasHRV && rec7avg && rec60avg)
    ? Math.round(((rec7avg - rec60avg) / rec60avg) * 100)
    : null;

  // ── Sparklines (8 weeks) ──
  const recSparkData = [];
  const rhrSparkData = [];
  for (let i = 7; i >= 0; i--) {
    const wStart = new Date(now.getTime() - (i + 1) * 7 * 86400000).toISOString().split('T')[0];
    const wEnd   = new Date(now.getTime() -  i      * 7 * 86400000).toISOString().split('T')[0];
    const week   = sorted.filter(d => d.date >= wStart && d.date < wEnd);
    const recAvg = avg(week, recoveryKey);
    const rhrAvg = avg(week, 'restingHR');
    recSparkData.push({ v: recAvg != null ? Math.round(recAvg * 10) / 10 : null });
    rhrSparkData.push({ v: rhrAvg != null ? Math.round(rhrAvg * 10) / 10 : null });
  }

  // ── Full chart data (all dates, filtered in component) ──
  const chartData = sorted.map(d => ({
    date:   d.date,
    rhr:    d.restingHR ?? null,
    rec:    d[recoveryKey] ?? null,   // hrv or bb
    bbLow:  d.bbLow ?? null,
    // rolling 7-day avg for HRV baseline band
  }));

  // Attach 7-day rolling avg for the baseline band on chart
  for (let i = 0; i < chartData.length; i++) {
    const window = chartData.slice(Math.max(0, i - 6), i + 1).map(d => d.rec).filter(v => v != null);
    chartData[i].recRolling7 = window.length >= 3 ? Math.round(window.reduce((s, v) => s + v, 0) / window.length * 10) / 10 : null;
  }

  return {
    hasHRV, recoveryKey,
    currentRHR, currentRec, currentBBLow,
    rhr7avg, rhr28avg,
    rhrAllTimeMin, rhrAllTimeMax, rhrYearMin, rhrYearMax,
    rec7avg, rec28avg, rec60avg,
    recAllTimeMax, recAllTimeMin, recYearAvg, recYearMax,
    hrvDeviation,
    recSparkData, rhrSparkData,
    chartData,
    lastDate: lastWithHR?.date ?? lastWithRec?.date ?? null,
  };
}

// ── Fase de entrenamiento a partir del TSB ───────────────────────────────────
// Los cortes estaban escritos dentro de `PhaseBanner`, o sea dentro de un JSX.
// La portada necesita el MISMO veredicto en formato pastilla, y copiarlo habría
// dejado dos escalas para la misma palabra ("Cargando" a -8 en una vista y a -12
// en otra). Devuelve clave + texto; el color lo pone quien pinta.
export const PHASES = {
  fit:    { key: 'fit',    label: 'En forma',    description: 'Forma positiva — listo para competir o atacar una sesión clave' },
  build:  { key: 'build',  label: 'Acumulando',  description: 'Cargando trabajo, ligera fatiga acumulada' },
  load:   { key: 'load',   label: 'Cargando',    description: 'Bloque de carga activo — monitorizar recuperación' },
  redRisk:{ key: 'redRisk',label: 'Fatiga alta', description: 'Fatiga elevada — considerar recuperación activa o descanso' },
};

export function loadPhase(tsb) {
  if (tsb > 5) return PHASES.fit;
  if (tsb >= 0) return PHASES.build;
  if (tsb >= -10) return PHASES.load;
  return PHASES.redRisk;
}
