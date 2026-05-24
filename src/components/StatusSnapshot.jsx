import { useMemo, useState } from 'react';
import { Card, Text } from '@tremor/react';
import FitnessFatigue from './FitnessFatigue';
import WeeklyProgression from './WeeklyProgression';
import {
  ComposedChart, Area, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
  LineChart, Line
} from 'recharts';
import {
  ArrowTrendingUpIcon, ArrowTrendingDownIcon,
  BoltIcon, FireIcon, HeartIcon,
  ExclamationTriangleIcon, CheckCircleIcon,
  CalendarDaysIcon, ArrowUpIcon, ArrowDownIcon,
  XMarkIcon, ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';

// ─── constants ────────────────────────────────────────────────────────────────
const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const kCTL = Math.exp(-1 / 42);
const kATL = Math.exp(-1 / 7);

// ─── helpers ──────────────────────────────────────────────────────────────────
const isRun = (a) => RUNNING_TYPES.includes(a.type) || RUNNING_TYPES.includes(a.sport_type);

const paceStr = (speedMs) => {
  if (!speedMs || speedMs <= 0) return '—';
  const paceMinKm = 16.6667 / speedMs;
  if (paceMinKm < 2 || paceMinKm > 20) return '—';
  const m = Math.floor(paceMinKm);
  const s = Math.floor((paceMinKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const timeStr = (seconds) => {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const fmt1 = (n) => (n == null ? '—' : Number(n).toFixed(1));
const fmtKm = (m) => (m == null ? '—' : (m / 1000).toFixed(1));

const weekStart = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
};

// ─── main computation ─────────────────────────────────────────────────────────
function computeStats(activities) {
  if (!activities || activities.length === 0) return null;

  const now = new Date();
  const nowMs = now.getTime();
  const todayStr = now.toISOString().split('T')[0];
  const thisYear = now.getFullYear();

  // ── daily stress scores & activities ──
  const dailyActivities = {};
  activities.forEach((a) => {
    const d = a.start_date.split('T')[0];
    const ss = a.suffer_score || (a.moving_time / 60) * 0.5;
    if (!dailyActivities[d]) dailyActivities[d] = { ss: 0, list: [] };
    dailyActivities[d].ss += ss;
    dailyActivities[d].list.push({ 
      id: a.id,
      name: a.name, 
      distance: a.distance, 
      type: a.type,
      sport_type: a.sport_type,
      moving_time: a.moving_time,
      average_speed: a.average_speed,
      average_heartrate: a.average_heartrate,
      suffer_score: ss
    });
  });

  const minDate = activities.reduce((min, a) => {
    const t = new Date(a.start_date).getTime();
    return t < min ? t : min;
  }, Infinity);

  // ── CTL/ATL rolling ──
  let ctl = 0, atl = 0;
  let peakCTL = 0, peakCTLDate = '';
  let peakCTLYear = 0;
  const ctlSeries = [];
  const weeklyLoadMap = {};

  for (let t = minDate; t <= nowMs; t += 86400000) {
    const d = new Date(t);
    const dateStr = d.toISOString().split('T')[0];
    const dayData = dailyActivities[dateStr] || { ss: 0, list: [] };
    const tss = dayData.ss;
    ctl = ctl * kCTL + tss * (1 - kCTL);
    atl = atl * kATL + tss * (1 - kATL);
    const tsb = ctl - atl;

    if (ctl > peakCTL) { peakCTL = ctl; peakCTLDate = dateStr; }
    if (d.getFullYear() === thisYear && ctl > peakCTLYear) peakCTLYear = ctl;

    // weekly load bucket
    const wk = weekStart(d);
    if (!weeklyLoadMap[wk]) weeklyLoadMap[wk] = { load: 0 };
    weeklyLoadMap[wk].load += tss;

    ctlSeries.push({ 
      date: dateStr, 
      ctl: Math.round(ctl * 10) / 10, 
      atl: Math.round(atl * 10) / 10, 
      tsb: Math.round(tsb * 10) / 10, 
      load: tss,
      activities: dayData.list
    });
  }

  const currentCTL = ctl;
  const currentATL = atl;
  const currentTSB = ctl - atl;
  const currentACWR = ctl > 0 ? atl / ctl : 0;

  const ctl7ago = ctlSeries.length > 7 ? ctlSeries[ctlSeries.length - 8].ctl : 0;
  const ctl28ago = ctlSeries.length > 28 ? ctlSeries[ctlSeries.length - 29].ctl : 0;

  // full history available for chart
  const chartDataFull = ctlSeries;

  // ── weekly km (running) ──
  const runActivities = activities.filter(isRun);
  const weeklyKm = {};
  runActivities.forEach((a) => {
    const wk = weekStart(new Date(a.start_date));
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
  const activeDays = new Set(activities.map((a) => a.start_date.split('T')[0]));
  const last28days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(nowMs - i * 86400000);
    return d.toISOString().split('T')[0];
  });
  const activeLast28 = last28days.filter((d) => activeDays.has(d)).length;
  const activeLast7 = last28days.slice(0, 7).filter((d) => activeDays.has(d)).length;

  // streak
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(nowMs - i * 86400000).toISOString().split('T')[0];
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
function computeGarminStats(rawData) {
  if (!rawData || rawData.length === 0) return null;

  const sorted = [...rawData].sort((a, b) => a.date.localeCompare(b.date));
  const now = new Date();
  const thisYear = now.getFullYear();
  const last7  = new Date(now.getTime() -  7 * 86400000).toISOString().split('T')[0];
  const last28 = new Date(now.getTime() - 28 * 86400000).toISOString().split('T')[0];
  const last60 = new Date(now.getTime() - 60 * 86400000).toISOString().split('T')[0];

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

// ─── sub-components ───────────────────────────────────────────────────────────

function PhaseBanner({ tsb, acwr, garmin }) {
  let phase, color, borderColor, bg, Icon, description;

  if (tsb > 5) {
    phase = 'En forma'; color = 'text-emerald-700'; borderColor = 'border-emerald-500';
    bg = 'bg-emerald-50'; Icon = CheckCircleIcon;
    description = 'Forma positiva — listo para competir o atacar una sesión clave';
  } else if (tsb >= 0) {
    phase = 'Acumulando'; color = 'text-amber-700'; borderColor = 'border-amber-400';
    bg = 'bg-amber-50'; Icon = ArrowTrendingUpIcon;
    description = 'Cargando trabajo, ligera fatiga acumulada';
  } else if (tsb >= -10) {
    phase = 'Cargando'; color = 'text-orange-700'; borderColor = 'border-orange-500';
    bg = 'bg-orange-50'; Icon = FireIcon;
    description = 'Bloque de carga activo — monitorizar recuperación';
  } else {
    phase = 'Fatiga alta'; color = 'text-rose-700'; borderColor = 'border-rose-500';
    bg = 'bg-rose-50'; Icon = ExclamationTriangleIcon;
    description = 'Fatiga elevada — considerar recuperación activa o descanso';
  }

  return (
    <div className={`rounded-xl border-l-4 ${borderColor} ${bg} p-4 flex items-center justify-between gap-4 flex-wrap`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${color} shrink-0`} />
        <div>
          <span className={`font-black text-lg ${color}`}>{phase}</span>
          <span className="text-slate-500 text-sm ml-2">{description}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs flex-wrap">
        <div className="text-center">
          <div className="text-slate-400 uppercase font-bold tracking-wide">TSB</div>
          <div className={`text-xl font-black ${color}`}>{fmt1(tsb)}</div>
        </div>
        <div className="text-center">
          <div className="text-slate-400 uppercase font-bold tracking-wide">ACWR</div>
          <div className={`text-xl font-black ${acwr > 1.5 ? 'text-rose-600' : acwr > 1.3 ? 'text-amber-600' : 'text-slate-700'}`}>
            {acwr.toFixed(2)}
          </div>
        </div>
        {garmin?.currentRHR != null && (
          <div className="text-center">
            <div className="text-slate-400 uppercase font-bold tracking-wide">FC Reposo</div>
            <div className={`text-xl font-black ${
              garmin.rhrAllTimeMin && garmin.currentRHR <= garmin.rhrAllTimeMin + 3 ? 'text-emerald-600'
              : garmin.currentRHR > (garmin.rhr28avg || garmin.currentRHR) + 5 ? 'text-rose-600'
              : 'text-slate-700'
            }`}>
              {garmin.currentRHR} <span className="text-xs font-normal">bpm</span>
            </div>
          </div>
        )}
        {garmin?.currentRec != null && (
          <div className="text-center">
            <div className="text-slate-400 uppercase font-bold tracking-wide">
              {garmin.hasHRV ? 'VFC (RMSSD)' : 'Body Battery'}
            </div>
            {garmin.hasHRV ? (
              <>
                <div className={`text-xl font-black ${
                  garmin.hrvDeviation > 5  ? 'text-emerald-600'
                  : garmin.hrvDeviation < -10 ? 'text-rose-600'
                  : 'text-amber-600'
                }`}>
                  {Math.round(garmin.currentRec)}<span className="text-xs font-normal"> ms</span>
                </div>
                {garmin.hrvDeviation != null && (
                  <div className={`text-xs font-bold ${garmin.hrvDeviation >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {garmin.hrvDeviation >= 0 ? '+' : ''}{garmin.hrvDeviation}% vs baseline
                  </div>
                )}
              </>
            ) : (
              <div className={`text-xl font-black ${
                garmin.currentRec >= 80 ? 'text-emerald-600'
                : garmin.currentRec >= 50 ? 'text-amber-600'
                : 'text-rose-600'
              }`}>
                {garmin.currentRec}<span className="text-xs font-normal">/100</span>
              </div>
            )}
          </div>
        )}
        {(acwr > 1.5 || (garmin?.currentRHR != null && garmin.rhr28avg && garmin.currentRHR > garmin.rhr28avg + 5)) && (
          <div className="flex items-center gap-1 bg-rose-100 text-rose-700 px-2 py-1 rounded-lg font-semibold text-xs">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            {acwr > 1.5 ? 'Riesgo lesión' : 'FC elevada'}
          </div>
        )}
        {garmin?.hasHRV && garmin.hrvDeviation != null && garmin.hrvDeviation < -10 && (
          <div className="flex items-center gap-1 bg-rose-100 text-rose-700 px-2 py-1 rounded-lg font-semibold text-xs">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            VFC suprimida
          </div>
        )}
        {!garmin?.hasHRV && garmin?.currentRec != null && garmin.currentRec < 30 && (
          <div className="flex items-center gap-1 bg-amber-100 text-amber-700 px-2 py-1 rounded-lg font-semibold text-xs">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            Recuperación baja
          </div>
        )}
      </div>
    </div>
  );
}

function HeroCard({ label, value, unit, subRows, trendDelta, icon: Icon, color = 'blue' }) {
  const colorMap = {
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    icon: 'text-blue-500' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-500' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   icon: 'text-amber-500' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    icon: 'text-rose-500' },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Text className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</Text>
        {Icon && <div className={`p-1.5 rounded-lg ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>}
      </div>
      <div className="flex items-end gap-2">
        <span className={`text-4xl font-black leading-none ${c.text}`}>{value}</span>
        {unit && <span className="text-sm font-semibold text-slate-400 pb-0.5">{unit}</span>}
        {trendDelta != null && (
          <span className={`ml-1 pb-0.5 text-xs font-bold flex items-center gap-0.5 ${trendDelta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {trendDelta >= 0 ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />}
            {Math.abs(trendDelta).toFixed(1)}
          </span>
        )}
      </div>
      <div className="space-y-1 border-t border-slate-100 pt-3">
        {subRows.map((row, i) => (
          <div key={i} className="flex justify-between items-center text-xs">
            <span className="text-slate-400">{row.label}</span>
            <span className="font-semibold text-slate-600">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function pctPill(now, best, lowerIsBetter = false) {
  if (!best || !now) return <span className="text-slate-300 text-xs">—</span>;
  const pct = lowerIsBetter ? (best / now) * 100 : (now / best) * 100;
  const clamped = Math.min(pct, 100);
  const color = clamped >= 80 ? 'bg-emerald-100 text-emerald-700' : clamped >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700';
  return <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${color}`}>{Math.round(clamped)}%</span>;
}

function MiniSparkline({ data, color = '#3b82f6' }) {
  if (!data || data.length < 2) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <ResponsiveContainer width={64} height={24}>
      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RangeSelector({ value, onChange, options }) {
  return (
    <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0">
      {options.map(opt => (
        <button
          key={opt.v}
          onClick={() => onChange(opt.v)}
          className={`px-3 py-1.5 transition-colors font-medium ${
            value === opt.v
              ? 'bg-slate-800 text-white'
              : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────
export default function StatusSnapshot({ activities }) {
  const stats = useMemo(() => computeStats(activities), [activities]);

  // Load Garmin data from localStorage (same source as GarminCardiac component)
  const garmin = useMemo(() => {
    try {
      const raw = localStorage.getItem('garmin_cardiac_data');
      if (raw) return computeGarminStats(JSON.parse(raw));
    } catch {}
    return null;
  }, []);

  const [tab, setTab] = useState('estado');

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        No hay datos suficientes para mostrar el estado actual.
      </div>
    );
  }

  const {
    currentCTL, currentATL, currentTSB, currentACWR,
    peakCTL, peakCTLYear, ctl7ago,
    last7daysKm, avgWeekKmYear, peakWeekKm, peakWeekKmYear,
    bestPace10kRecent, bestPace10kYear, bestPace10kAll,
    bestPace5kRecent, bestPace5kYear, bestPace5kAll,
    hrEffRecent, hrEffYear, hrEffAll,
    activeLast7, activeLast28, streak,
    elevLast28, avgMonthlyElevYear, peakMonthlyElev,
    chartDataFull, sparkData,
  } = stats;

  const ctlTrend = currentCTL - ctl7ago;
  const ctlPctPeak = peakCTL > 0 ? Math.round((currentCTL / peakCTL) * 100) : 0;

  // hero card color by TSB
  const fitnessColor = ctlPctPeak >= 80 ? 'emerald' : ctlPctPeak >= 50 ? 'blue' : 'amber';
  const formColor = currentTSB > 5 ? 'emerald' : currentTSB > -5 ? 'amber' : 'rose';

  // sparkline datasets (last 8 weeks)
  const ctlSparkData  = sparkData.map((d) => ({ v: d.ctl }));
  const atlSparkData  = sparkData.map((d) => ({ v: d.atl }));
  const volSparkData  = (() => {
    // sample weekly km from chartDataFull last 8 weeks
    const weeksData = [];
    for (let i = 7; i >= 0; i--) {
      const slice = chartDataFull.slice(-(i + 1) * 7, i > 0 ? -i * 7 : undefined);
      const km = slice.reduce((s, d) => s + d.load, 0) * (1 / 0.5) / 1000 * 0.5; // rough km proxy
      weeksData.push({ v: Math.round(km) });
    }
    return weeksData;
  })();

  // comparison table rows
  const tableRows = [
    {
      label: 'Fitness (CTL)',
      now: fmt1(currentCTL),
      nowRaw: currentCTL,
      bestYear: fmt1(peakCTLYear),
      bestYearRaw: peakCTLYear,
      bestAll: fmt1(peakCTL),
      bestAllRaw: peakCTL,
      spark: ctlSparkData,
      sparkColor: '#3b82f6',
      lowerIsBetter: false,
    },
    {
      label: 'Fatiga (ATL)',
      now: fmt1(currentATL),
      nowRaw: currentATL,
      bestYear: '—', bestYearRaw: null,
      bestAll: '—', bestAllRaw: null,
      spark: atlSparkData,
      sparkColor: '#f97316',
      lowerIsBetter: false,
      noCompare: true,
    },
    {
      label: 'Forma (TSB)',
      now: fmt1(currentTSB),
      nowRaw: null,
      bestYear: '—', bestYearRaw: null,
      bestAll: '—', bestAllRaw: null,
      spark: ctlSparkData.map((d, i) => ({ v: sparkData[i]?.tsb ?? 0 })),
      sparkColor: '#8b5cf6',
      noCompare: true,
    },
    {
      label: 'Km (última semana)',
      now: `${last7daysKm.toFixed(1)} km`,
      nowRaw: last7daysKm,
      bestYear: `${peakWeekKmYear.toFixed(1)} km`,
      bestYearRaw: peakWeekKmYear,
      bestAll: `${peakWeekKm.toFixed(1)} km`,
      bestAllRaw: peakWeekKm,
      spark: volSparkData,
      sparkColor: '#10b981',
      lowerIsBetter: false,
    },
    {
      label: 'Desnivel mensual',
      now: `${Math.round(elevLast28)} m`,
      nowRaw: elevLast28,
      bestYear: `${Math.round(avgMonthlyElevYear)} m`,
      bestYearRaw: avgMonthlyElevYear,
      bestAll: `${Math.round(peakMonthlyElev)} m`,
      bestAllRaw: peakMonthlyElev,
      spark: null,
      sparkColor: '#64748b',
      lowerIsBetter: false,
    },
    {
      label: 'Consistencia (28d)',
      now: `${activeLast28} días`,
      nowRaw: activeLast28,
      bestYear: '28 días',
      bestYearRaw: 28,
      bestAll: '28 días',
      bestAllRaw: 28,
      spark: null,
      lowerIsBetter: false,
    },
    {
      label: 'Mejor ritmo 10k',
      now: paceStr(bestPace10kRecent),
      nowRaw: bestPace10kRecent,
      bestYear: paceStr(bestPace10kYear),
      bestYearRaw: bestPace10kYear,
      bestAll: paceStr(bestPace10kAll),
      bestAllRaw: bestPace10kAll,
      spark: null,
      lowerIsBetter: true, // lower pace = better
      unit: '/km',
    },
    {
      label: 'Eficiencia aeróbica',
      now: hrEffRecent ? hrEffRecent.toFixed(2) : '—',
      nowRaw: hrEffRecent,
      bestYear: hrEffYear ? hrEffYear.toFixed(2) : '—',
      bestYearRaw: hrEffYear,
      bestAll: hrEffAll ? hrEffAll.toFixed(2) : '—',
      bestAllRaw: hrEffAll,
      spark: null,
      lowerIsBetter: true, // lower HR/speed = better efficiency
    },
    // ── Garmin rows (only if data available) ──
    ...(garmin ? [
      {
        label: 'FC Reposo',
        now: garmin.currentRHR ? `${garmin.currentRHR} bpm` : '—',
        nowRaw: garmin.currentRHR,
        bestYear: garmin.rhrYearMin ? `${garmin.rhrYearMin} bpm` : '—',
        bestYearRaw: garmin.rhrYearMin,
        bestAll: garmin.rhrAllTimeMin ? `${garmin.rhrAllTimeMin} bpm` : '—',
        bestAllRaw: garmin.rhrAllTimeMin,
        spark: garmin.rhrSparkData,
        sparkColor: '#ef4444',
        lowerIsBetter: true, // lower RHR = better
      },
      {
        label: 'Body Battery (máx)',
        now: garmin.currentBB ? `${garmin.currentBB}/100` : '—',
        nowRaw: garmin.currentBB,
        bestYear: garmin.bbYearAvg ? `${Math.round(garmin.bbYearAvg)}/100` : '—',
        bestYearRaw: garmin.bbYearAvg,
        bestAll: garmin.bbAllTimeMax ? `${garmin.bbAllTimeMax}/100` : '—',
        bestAllRaw: garmin.bbAllTimeMax,
        spark: garmin.bbSparkData,
        sparkColor: '#8b5cf6',
        lowerIsBetter: false,
      },
    ] : []),
  ];

  const [timeRange, setTimeRange] = useState('90d'); // '90d' | '6m' | '1y' | 'all'
  const [selectedDay, setSelectedDay] = useState(null);
  const [showGarminHR, setShowGarminHR] = useState(true);
  const [showGarminRec, setShowGarminRec] = useState(true);
  const [garminGranularity, setGarminGranularity] = useState('day'); // 'day', 'week', 'month'

  const rangeMs = { '90d': 90*86400000, '6m': 183*86400000, '1y': 365*86400000, 'all': Infinity };

  const nowMs2 = Date.now();

  const sampledChart = chartDataFull
    .filter(d => rangeMs[timeRange] === Infinity || new Date(d.date).getTime() >= nowMs2 - rangeMs[timeRange]);

  const peakCTLVal = Math.round(peakCTL * 10) / 10;

  return (
    <div className="space-y-4">

      {/* ── Tab bar ── */}
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1">
        {[
          { id: 'estado', label: 'Estado' },
          { id: 'pmc',    label: 'PMC / Fitness' },
          { id: 'semanal', label: 'Semanal' },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
              tab === id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'pmc'    && <FitnessFatigue activities={activities} />}
      {tab === 'semanal' && <WeeklyProgression activities={activities} />}
      {tab === 'estado' && <>

      {/* ── Phase Banner ── */}
      <PhaseBanner tsb={currentTSB} acwr={currentACWR} garmin={garmin} />

      {/* ── Hero Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <HeroCard
          label="Fitness (CTL)"
          value={fmt1(currentCTL)}
          trendDelta={ctlTrend}
          icon={ArrowTrendingUpIcon}
          color={fitnessColor}
          subRows={[
            { label: 'Pico histórico',  value: `${fmt1(peakCTL)} (${ctlPctPeak}%)` },
            { label: 'Pico este año',   value: fmt1(peakCTLYear) },
            { label: 'Tendencia 7d',    value: ctlTrend >= 0 ? `+${ctlTrend.toFixed(1)}` : ctlTrend.toFixed(1) },
          ]}
        />
        <HeroCard
          label="Forma (TSB)"
          value={fmt1(currentTSB)}
          icon={BoltIcon}
          color={formColor}
          subRows={[
            { label: 'Fatiga actual (ATL)',  value: fmt1(currentATL) },
            { label: 'ACWR',                value: currentACWR.toFixed(2) },
            { label: 'Días activos (7d)',    value: `${activeLast7} / 7` },
          ]}
        />
        <HeroCard
          label="Volumen semanal"
          value={last7daysKm.toFixed(1)}
          unit="km"
          icon={CalendarDaysIcon}
          color="blue"
          subRows={[
            { label: 'Media semanal año', value: `${avgWeekKmYear.toFixed(1)} km` },
            { label: 'Semana pico año',   value: `${peakWeekKmYear.toFixed(1)} km` },
            { label: 'Semana pico total', value: `${peakWeekKm.toFixed(1)} km` },
          ]}
        />
        <HeroCard
          label="Mejor ritmo reciente"
          value={paceStr(bestPace10kRecent) !== '—' ? paceStr(bestPace10kRecent) : paceStr(bestPace5kRecent)}
          unit={paceStr(bestPace10kRecent) !== '—' ? '/km 10k' : '/km 5k'}
          icon={FireIcon}
          color="amber"
          subRows={[
            { label: 'PB 10k este año',   value: paceStr(bestPace10kYear) },
            { label: 'PB 10k histórico',  value: paceStr(bestPace10kAll) },
            { label: 'Racha actual',       value: `${streak} días` },
          ]}
        />
      </div>

      {/* ── Comparison Table ── */}
      <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white overflow-x-auto">
        <div className="flex items-center gap-2 mb-4">
          <HeartIcon className="w-4 h-4 text-slate-400" />
          <Text className="font-bold text-slate-700 text-sm">Estado actual vs mejor histórico</Text>
        </div>
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 px-2 text-xs font-bold uppercase text-slate-400 w-48">Métrica</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-slate-400">Ahora</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-slate-400">Mejor año</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-slate-400">Pico histórico</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-slate-400">% pico</th>
              <th className="text-center py-2 px-3 text-xs font-bold uppercase text-slate-400">Tendencia 8s</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, i) => (
              <tr key={i} className={`border-b border-slate-50 ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                <td className="py-2.5 px-2 font-semibold text-slate-600 text-xs whitespace-nowrap">{row.label}</td>
                <td className="py-2.5 px-3 text-right font-black text-slate-800 text-sm">{row.now}</td>
                <td className="py-2.5 px-3 text-right text-slate-500 text-xs">{row.bestYear}</td>
                <td className="py-2.5 px-3 text-right text-slate-500 text-xs">{row.bestAll}</td>
                <td className="py-2.5 px-3 text-right">
                  {row.noCompare ? <span className="text-slate-300 text-xs">—</span>
                    : pctPill(row.nowRaw, row.bestAllRaw, row.lowerIsBetter)}
                </td>
                <td className="py-2.5 px-3 flex justify-center items-center">
                  {row.spark
                    ? <MiniSparkline data={row.spark} color={row.sparkColor} />
                    : <span className="text-slate-200 text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ── CTL / ATL Chart ── */}
      <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white">
        <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowTrendingUpIcon className="w-4 h-4 text-slate-400" />
              <Text className="font-bold text-slate-700 text-sm">Fitness y Fatiga</Text>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-blue-500 rounded" /> CTL</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-orange-400 rounded" /> ATL</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-slate-200 rounded-sm" /> Carga</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'rgba(59,130,246,0.15)'}} /> Pico histórico</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'rgba(251,191,36,0.2)'}} /> Pico anual</span>
            </div>
          </div>
          <RangeSelector value={timeRange} onChange={setTimeRange} options={[
            { v: '90d', label: '90d' }, { v: '6m', label: '6m' },
            { v: '1y', label: '1a' }, { v: 'all', label: 'Todo' },
          ]} />
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={sampledChart} syncId="statusCharts" margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorCtl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorAtl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fb923c" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#fb923c" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={(d) => {
                const dt = new Date(d);
                return `${dt.getDate()}/${dt.getMonth() + 1}`;
              }}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={false}
            />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#cbd5e1' }} tickLine={false} axisLine={false} />
            <RechartsTooltip
              wrapperStyle={{ pointerEvents: 'auto' }}
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-3 text-xs shadow-xl min-w-[160px]">
                      <p className="font-bold text-slate-700 mb-2 border-b border-slate-100 pb-1">{new Date(label).toLocaleDateString('es-ES')}</p>
                      <div className="space-y-1 mb-2">
                        {payload.map((p, idx) => (
                          <p key={idx} style={{ color: p.color || p.stroke || p.fill }} className="font-medium flex justify-between gap-4">
                            <span>{p.name}:</span>
                            <span>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
                          </p>
                        ))}
                      </div>
                      {data.activities && data.activities.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                          <p className="text-slate-400 font-semibold mb-1 text-[10px] uppercase tracking-wider">Actividades</p>
                          <ul className="space-y-2 mt-1">
                            {data.activities.map((a, i) => (
                              <li key={i} className="text-slate-600 flex flex-col gap-0.5 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                                <div className="flex justify-between items-start gap-3">
                                  <a 
                                    href={`https://www.strava.com/activities/${a.id}`} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="truncate max-w-[160px] font-semibold text-[11px] hover:text-blue-500 hover:underline transition-colors" 
                                    title={`Ver en Strava: ${a.name}`}
                                  >
                                    {a.name}
                                  </a>
                                  <span className="text-slate-500 font-bold whitespace-nowrap">{(a.distance / 1000).toFixed(1)}k</span>
                                </div>
                                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px] text-slate-400 font-medium">
                                  {a.moving_time > 0 && <span>⏱ {timeStr(a.moving_time)}</span>}
                                  {isRun(a) ? (a.average_speed > 0 && <span>⚡ {paceStr(a.average_speed)}/km</span>) 
                                            : (a.average_speed > 0 && <span>⚡ {(a.average_speed * 3.6).toFixed(1)} km/h</span>)}
                                  {a.average_heartrate > 0 && <span>❤️ {Math.round(a.average_heartrate)} bpm</span>}
                                  {a.suffer_score > 0 && <span>🔥 SS: {Math.round(a.suffer_score)}</span>}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            {/* Zona pico histórico: top 10% del máximo */}
            <ReferenceArea yAxisId="left" y1={peakCTL * 0.9} y2={peakCTL} fill="#3b82f6" fillOpacity={0.08} />
            {/* Zona pico anual (solo si es distinta de la histórica) */}
            {peakCTLYear < peakCTL * 0.98 && (
              <ReferenceArea yAxisId="left" y1={peakCTLYear * 0.9} y2={peakCTLYear} fill="#f59e0b" fillOpacity={0.1} />
            )}
            <Bar yAxisId="right" dataKey="load" radius={[2, 2, 0, 0]} maxBarSize={6} name="Carga" cursor="pointer"
              onClick={(data) => setSelectedDay(prev => prev?.date === data.date ? null : data)}>
              {sampledChart.map((entry, i) => (
                <Cell key={i}
                  fill={selectedDay?.date === entry.date ? '#f97316' : entry.load > 0 ? '#cbd5e1' : 'transparent'}
                />
              ))}
            </Bar>
            <Area yAxisId="left" type="monotone" dataKey="atl" stroke="#fb923c" strokeWidth={1.5} fill="url(#colorAtl)" name="ATL" dot={false} isAnimationActive={false} />
            <Area yAxisId="left" type="monotone" dataKey="ctl" stroke="#3b82f6" strokeWidth={2} fill="url(#colorCtl)" name="CTL" dot={false} isAnimationActive={false} />
            {/* Línea pico histórico */}
            <ReferenceLine yAxisId="left" y={peakCTLVal} stroke="#3b82f6" strokeDasharray="4 3" strokeOpacity={0.6}
              label={{ value: `Pico hist. ${peakCTLVal}`, position: 'insideTopRight', fontSize: 9, fill: '#3b82f6', opacity: 0.8 }} />
            {/* Línea pico anual */}
            {peakCTLYear < peakCTL * 0.98 && (
              <ReferenceLine yAxisId="left" y={Math.round(peakCTLYear * 10) / 10} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.6}
                label={{ value: `Pico año ${Math.round(peakCTLYear * 10) / 10}`, position: 'insideBottomRight', fontSize: 9, fill: '#b45309', opacity: 0.8 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {/* ── Panel actividades del día seleccionado ── */}
        {selectedDay?.activities?.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {new Date(selectedDay.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <button onClick={() => setSelectedDay(null)} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {selectedDay.activities.map((a, i) => (
                <a key={i} href={`https://www.strava.com/activities/${a.id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition-all group"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 text-xs group-hover:text-orange-600 transition-colors truncate">{a.name}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-slate-400">
                      {a.moving_time > 0 && <span>⏱ {timeStr(a.moving_time)}</span>}
                      {isRun(a)
                        ? (a.average_speed > 0 && <span>⚡ {paceStr(a.average_speed)}/km</span>)
                        : (a.average_speed > 0 && <span>⚡ {(a.average_speed * 3.6).toFixed(1)} km/h</span>)}
                      {a.average_heartrate > 0 && <span>❤️ {Math.round(a.average_heartrate)} bpm</span>}
                      {a.suffer_score > 0 && <span>🔥 SS: {Math.round(a.suffer_score)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="font-bold text-slate-700 text-sm">{(a.distance / 1000).toFixed(1)} km</span>
                    <ArrowTopRightOnSquareIcon className="w-4 h-4 text-slate-300 group-hover:text-orange-400 transition-colors" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ── Garmin: FC Reposo + Body Battery cards + chart ── */}
      {garmin && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <HeroCard
              label="FC Reposo"
              value={garmin.currentRHR ?? '—'}
              unit="bpm"
              icon={HeartIcon}
              color={garmin.rhrAllTimeMin && garmin.currentRHR <= garmin.rhrAllTimeMin + 2 ? 'emerald'
                : garmin.rhr28avg && garmin.currentRHR > garmin.rhr28avg + 5 ? 'rose' : 'blue'}
              subRows={[
                { label: 'Media 7 días',       value: garmin.rhr7avg  ? `${garmin.rhr7avg.toFixed(1)} bpm` : '—' },
                { label: 'Media 28 días',      value: garmin.rhr28avg ? `${garmin.rhr28avg.toFixed(1)} bpm` : '—' },
                { label: 'Mínimo histórico',   value: garmin.rhrAllTimeMin ? `${garmin.rhrAllTimeMin} bpm` : '—' },
                { label: 'Mínimo este año',    value: garmin.rhrYearMin    ? `${garmin.rhrYearMin} bpm` : '—' },
              ]}
            />
            <HeroCard
              label={garmin.hasHRV ? 'VFC — RMSSD' : 'Body Battery'}
              value={garmin.currentRec != null ? (garmin.hasHRV ? `${Math.round(garmin.currentRec)}` : garmin.currentRec) : '—'}
              unit={garmin.hasHRV ? 'ms' : '/ 100'}
              icon={BoltIcon}
              color={
                garmin.hasHRV
                  ? (garmin.hrvDeviation > 5 ? 'emerald' : garmin.hrvDeviation < -10 ? 'rose' : 'amber')
                  : (garmin.currentRec >= 80 ? 'emerald' : garmin.currentRec >= 50 ? 'amber' : 'rose')
              }
              subRows={garmin.hasHRV ? [
                { label: 'vs baseline 60d',    value: garmin.hrvDeviation != null ? `${garmin.hrvDeviation >= 0 ? '+' : ''}${garmin.hrvDeviation}%` : '—' },
                { label: 'Media 7 días',       value: garmin.rec7avg   ? `${Math.round(garmin.rec7avg)} ms` : '—' },
                { label: 'Media 28 días',      value: garmin.rec28avg  ? `${Math.round(garmin.rec28avg)} ms` : '—' },
                { label: 'Máximo histórico',   value: garmin.recAllTimeMax ? `${Math.round(garmin.recAllTimeMax)} ms` : '—' },
                { label: 'Máximo este año',    value: garmin.recYearMax    ? `${Math.round(garmin.recYearMax)} ms` : '—' },
              ] : [
                { label: 'Mínimo hoy',         value: garmin.currentBBLow != null ? `${garmin.currentBBLow}/100` : '—' },
                { label: 'Media 7 días',       value: garmin.rec7avg  ? `${garmin.rec7avg.toFixed(0)}/100` : '—' },
                { label: 'Media 28 días',      value: garmin.rec28avg ? `${garmin.rec28avg.toFixed(0)}/100` : '—' },
                { label: 'Máximo histórico',   value: garmin.recAllTimeMax ? `${garmin.recAllTimeMax}/100` : '—' },
              ]}
            />
          </div>

          <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white">
            <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <HeartIcon className="w-4 h-4 text-slate-400" />
                  <Text className="font-bold text-slate-700 text-sm">
                    FC Reposo y {garmin.hasHRV ? 'VFC (RMSSD)' : 'Body Battery'}
                  </Text>
                  <div className="flex items-center gap-1 bg-slate-100 rounded-md p-0.5 ml-2">
                    {[['day', 'Día'], ['week', 'Sem'], ['month', 'Mes']].map(([g, label]) => (
                      <button
                        key={g}
                        onClick={() => setGarminGranularity(g)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                          garminGranularity === g
                            ? 'bg-white text-slate-700 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-400 ml-1">(FC Reposo: eje invertido — arriba = mejor)</span>
                </div>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <button 
                    onClick={() => setShowGarminHR(!showGarminHR)}
                    className={`flex items-center gap-1.5 transition-opacity hover:opacity-80 ${showGarminHR ? 'opacity-100 font-bold text-slate-700' : 'opacity-40 text-slate-500'}`}
                  >
                    <span className="inline-block w-4 h-0.5 bg-red-400 rounded" /> FC Reposo ↑mejor
                  </button>
                  <button 
                    onClick={() => setShowGarminRec(!showGarminRec)}
                    className={`flex items-center gap-1.5 transition-opacity hover:opacity-80 ${showGarminRec ? 'opacity-100 font-bold text-slate-700' : 'opacity-40 text-slate-500'}`}
                  >
                    <span className="inline-block w-4 h-0.5 bg-violet-500 rounded" />
                    {garmin.hasHRV ? 'VFC ms' : 'Body Battery'}
                  </button>
                  {garmin.hasHRV && <span className="flex items-center gap-1 text-slate-400 opacity-70"><span className="inline-block w-3 h-0.5 bg-violet-300 rounded" style={{borderTop:'2px dashed #a78bfa'}} /> Media 7d</span>}
                  <span className="flex items-center gap-1 text-slate-400 opacity-70"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'rgba(34,197,94,0.15)'}} /> Zona mejor hist.</span>
                  <span className="flex items-center gap-1 text-slate-400 opacity-70"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'rgba(134,239,172,0.2)'}} /> Zona mejor año</span>
                </div>
              </div>
              <RangeSelector value={timeRange} onChange={setTimeRange} options={[
                { v: '90d', label: '90d' }, { v: '6m', label: '6m' },
                { v: '1y', label: '1a' }, { v: 'all', label: 'Todo' },
              ]} />
            </div>
            {(() => {
              const cutoff = rangeMs[timeRange] === Infinity ? null
                : new Date(Date.now() - rangeMs[timeRange]).toISOString().split('T')[0];
              const filteredGarminData = cutoff
                ? garmin.chartData.filter(d => d.date >= cutoff)
                : garmin.chartData;

              let finalGarminData = filteredGarminData;
              if (garminGranularity !== 'day') {
                const grouped = {};
                filteredGarminData.forEach(d => {
                  const dateObj = new Date(d.date);
                  let key = d.date;
                  if (garminGranularity === 'week') {
                    const day = dateObj.getDay();
                    const diff = dateObj.getDate() - day + (day === 0 ? -6 : 1);
                    const weekStart = new Date(dateObj.setDate(diff));
                    key = weekStart.toISOString().split('T')[0];
                  } else if (garminGranularity === 'month') {
                    key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-01`;
                  }
                  if (!grouped[key]) grouped[key] = { date: key, rhr: [], rec: [] };
                  if (d.rhr != null) grouped[key].rhr.push(d.rhr);
                  if (d.rec != null) grouped[key].rec.push(d.rec);
                });
                finalGarminData = Object.values(grouped).map(g => ({
                  date: g.date,
                  rhr: g.rhr.length ? +(g.rhr.reduce((a,b)=>a+b,0)/g.rhr.length).toFixed(1) : null,
                  rec: g.rec.length ? +(g.rec.reduce((a,b)=>a+b,0)/g.rec.length).toFixed(1) : null,
                })).sort((a,b) => a.date.localeCompare(b.date));
              }

              // RHR domain: invert so lower values sit visually higher
              const rhrVals = finalGarminData.map(d => d.rhr).filter(Boolean);
              const rhrMin = rhrVals.length ? Math.min(...rhrVals) - 2 : 40;
              const rhrMax = rhrVals.length ? Math.max(...rhrVals) + 2 : 75;
              return (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={finalGarminData} syncId="statusCharts" margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickFormatter={(d) => { const dt = new Date(d); return `${dt.getDate()}/${dt.getMonth() + 1}`; }}
                  interval="preserveStartEnd"
                  tickLine={false} axisLine={false}
                />
                {/* Eje FC Reposo invertido: domain=[max, min] → valores bajos arriba */}
                {showGarminHR && <YAxis yAxisId="rhr" domain={[rhrMax, rhrMin]} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />}
                {showGarminRec && <YAxis yAxisId="rec" orientation="right"
                  domain={garmin.hasHRV ? ['auto', 'auto'] : [0, 100]}
                  tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />}
                <RechartsTooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(val, name) => [val, name]}
                  labelFormatter={(d) => new Date(d).toLocaleDateString('es-ES')}
                />
                {/* ── FC Reposo zones (eje izquierdo) — verde = bueno, rojo = malo ── */}
                {showGarminHR && garmin.rhrAllTimeMin && (
                  <ReferenceArea yAxisId="rhr" y1={garmin.rhrAllTimeMin} y2={garmin.rhrAllTimeMin + 4} fill="#22c55e" fillOpacity={0.12} />
                )}
                {/* Zona mejor anual (solo si es distinta) */}
                {showGarminHR && garmin.rhrYearMin && garmin.rhrAllTimeMin && garmin.rhrYearMin > garmin.rhrAllTimeMin + 2 && (
                  <ReferenceArea yAxisId="rhr" y1={garmin.rhrYearMin} y2={garmin.rhrYearMin + 4} fill="#86efac" fillOpacity={0.15} />
                )}
                {/* Zona FC alta/peor — visualmente abajo con eje invertido */}
                {showGarminHR && garmin.rhrAllTimeMax && (
                  <ReferenceArea yAxisId="rhr" y1={garmin.rhrAllTimeMax - 4} y2={garmin.rhrAllTimeMax} fill="#ef4444" fillOpacity={0.1} />
                )}

                {/* ── Recovery zones (eje derecho) ── */}
                {showGarminRec && (garmin.hasHRV ? (
                  // HRV: zonas relativas al baseline personal (rec60avg)
                  garmin.rec60avg && <>
                    <ReferenceArea yAxisId="rec" y1={garmin.rec60avg * 1.05} y2={garmin.recAllTimeMax * 1.05} fill="#22c55e" fillOpacity={0.06} />
                    <ReferenceArea yAxisId="rec" y1={garmin.rec60avg * 0.9}  y2={garmin.rec60avg * 1.05}      fill="#f59e0b" fillOpacity={0.05} />
                    <ReferenceArea yAxisId="rec" y1={0}                       y2={garmin.rec60avg * 0.9}       fill="#ef4444" fillOpacity={0.05} />
                  </>
                ) : (
                  // Body Battery: zonas fijas 0-100
                  <>
                    <ReferenceArea yAxisId="rec" y1={75}  y2={100} fill="#22c55e" fillOpacity={0.06} />
                    <ReferenceArea yAxisId="rec" y1={40}  y2={75}  fill="#f59e0b" fillOpacity={0.05} />
                    <ReferenceArea yAxisId="rec" y1={0}   y2={40}  fill="#ef4444" fillOpacity={0.05} />
                  </>
                ))}

                {/* ── Reference lines ── */}
                {showGarminHR && garmin.rhrAllTimeMin && (
                  <ReferenceLine yAxisId="rhr" y={garmin.rhrAllTimeMin} stroke="#16a34a" strokeDasharray="3 3" strokeOpacity={0.7}
                    label={{ value: `Mejor hist. ${garmin.rhrAllTimeMin} bpm`, position: 'insideTopLeft', fontSize: 9, fill: '#16a34a', opacity: 0.9 }} />
                )}
                {showGarminHR && garmin.rhrYearMin && garmin.rhrYearMin !== garmin.rhrAllTimeMin && (
                  <ReferenceLine yAxisId="rhr" y={garmin.rhrYearMin} stroke="#4ade80" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: `Mejor año ${garmin.rhrYearMin} bpm`, position: 'insideTopLeft', fontSize: 9, fill: '#15803d', opacity: 0.8 }} />
                )}
                {showGarminHR && garmin.rhrAllTimeMax && (
                  <ReferenceLine yAxisId="rhr" y={garmin.rhrAllTimeMax} stroke="#ef4444" strokeDasharray="2 4" strokeOpacity={0.4}
                    label={{ value: `Peor hist. ${garmin.rhrAllTimeMax} bpm`, position: 'insideBottomLeft', fontSize: 9, fill: '#dc2626', opacity: 0.7 }} />
                )}
                {/* Recovery: máximo histórico y baseline */}
                {showGarminRec && garmin.recAllTimeMax && (
                  <ReferenceLine yAxisId="rec" y={Math.round(garmin.recAllTimeMax)} stroke="#7c3aed" strokeDasharray="3 3" strokeOpacity={0.5}
                    label={{ value: `${garmin.hasHRV ? 'Pico VFC' : 'Max BB'} ${Math.round(garmin.recAllTimeMax)}${garmin.hasHRV ? 'ms' : ''}`, position: 'insideTopRight', fontSize: 9, fill: '#7c3aed', opacity: 0.8 }} />
                )}
                {showGarminRec && garmin.rec60avg && (
                  <ReferenceLine yAxisId="rec" y={Math.round(garmin.rec60avg)} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.6}
                    label={{ value: `Baseline 60d ${Math.round(garmin.rec60avg)}${garmin.hasHRV ? 'ms' : ''}`, position: 'insideBottomRight', fontSize: 9, fill: '#7c3aed', opacity: 0.8 }} />
                )}
                {showGarminRec && garmin.recYearMax && garmin.recYearMax !== garmin.recAllTimeMax && (
                  <ReferenceLine yAxisId="rec" y={Math.round(garmin.recYearMax)} stroke="#c4b5fd" strokeDasharray="3 3" strokeOpacity={0.5}
                    label={{ value: `Pico año ${Math.round(garmin.recYearMax)}${garmin.hasHRV ? 'ms' : ''}`, position: 'insideTopRight', fontSize: 9, fill: '#6d28d9', opacity: 0.7 }} />
                )}

                {showGarminRec && <Area yAxisId="rec" type="monotone" dataKey="rec" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#colorRec)"
                  name={garmin.hasHRV ? 'VFC (ms)' : 'Body Battery'} dot={false} isAnimationActive={false} connectNulls />}
                {/* Media móvil 7d solo para HRV (reduce ruido diario) si la vista es diaria */}
                {garminGranularity === 'day' && showGarminRec && garmin.hasHRV && (
                  <Line yAxisId="rec" type="monotone" dataKey="recRolling7" stroke="#a78bfa" strokeWidth={2} strokeDasharray="4 2"
                    name="Media 7d" dot={false} isAnimationActive={false} connectNulls />
                )}
                {showGarminHR && <Line yAxisId="rhr" type="monotone" dataKey="rhr" stroke="#ef4444" strokeWidth={2}
                  name="FC Reposo" dot={false} isAnimationActive={false} connectNulls />}
              </ComposedChart>
            </ResponsiveContainer>
              );
            })()}
            {garmin.lastDate && (
              <p className="text-xs text-slate-400 mt-2 text-right">Último dato: {new Date(garmin.lastDate).toLocaleDateString('es-ES')}</p>
            )}
          </Card>
        </>
      )}

      </>}
    </div>
  );
}
