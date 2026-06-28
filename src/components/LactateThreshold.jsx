import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Cell,
  ComposedChart, Scatter,
} from 'recharts';

// ─── helpers ────────────────────────────────────────────────────────────────

function formatPace(minPerKm) {
  if (!minPerKm || minPerKm <= 0 || minPerKm > 20) return '--:--';
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const paceFromSpeed = (mps) => 1000 / (mps * 60); // m/s → min/km

function gaussianWeight(hr, target, sigma) {
  const diff = hr - target;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

function weightedMedian(pairs) {
  if (!pairs || pairs.length === 0) return null;
  const sorted = [...pairs].sort((a, b) => a.value - b.value);
  const totalW = sorted.reduce((s, p) => s + p.weight, 0);
  let cumW = 0;
  for (const p of sorted) {
    cumW += p.weight;
    if (cumW >= totalW / 2) return p.value;
  }
  return sorted[sorted.length - 1].value;
}

// ─── methodology ──────────────────────────────────────────────────────────────
//
// PRIMARY — Critical Speed (CS) model, the modern field-valid threshold estimate:
//   Fit  distance = CS·t + D'  over a runner's best efforts (≈3–40 min).
//   CS (the slope) ≈ Maximal Lactate Steady State / LT2, validated against MLSS.
//   D' (intercept) = finite anaerobic distance capacity.
//   Refs: Monod & Scherrer (1965); Jones et al. (2010) Med Sci Sports Exerc 42(10);
//         Galán-Rioja et al. (2020) Sports Med — CS vs MLSS agreement.
//   This is performance-anchored, so it does NOT assume a fixed %HRmax.
//
// SECONDARY (cross-check) — HR-anchored estimate at a target %HRmax band.
//   NOTE: %HRmax at LT2 varies ~80–92% between individuals (Faude et al. 2009),
//   so this is only a cross-check / trend tracker, never the source of truth.
//
// FCmax — robust high percentile of observed max HR (drops sensor-spike artifacts),
//   instead of the absolute max which a single bad reading can inflate by 10+ bpm.
//
// Gold standard not computable here: DFA-α1 from beat-to-beat R-R intervals
//   (Rogers et al. 2021) — requires raw HRV streams Strava summaries don't expose.
//
// ─────────────────────────────────────────────────────────────────────────────

const LT2_TARGET_PCT  = 0.87;
const LT2_SIGMA_PCT   = 0.025;
const LT1_TARGET_PCT  = 0.77;
const LT1_SIGMA_PCT   = 0.025;
const EWMA_LAMBDA     = 0.3;
const MIN_DURATION_S  = 20 * 60;
const MIN_LAP_TIME_S  = 4 * 60;
const MIN_LAP_DIST_M  = 400;

// Critical Speed fit window: maximal efforts roughly 3–40 min (valid CS domain).
const CS_BANDS = [
  [180, 360],   // 3–6 min
  [360, 600],   // 6–10 min
  [600, 900],   // 10–15 min
  [900, 1500],  // 15–25 min
  [1500, 2400], // 25–40 min
];

/**
 * Robust HRmax. HRmax is a ceiling, not a central tendency, so we work only
 * with the upper tail: drop the top ~1% of readings (sensor spikes / cadence-
 * lock artifacts), then AVERAGE the next few highest genuine readings. Averaging
 * the top cluster cuts single-session noise without biasing the ceiling down —
 * averaging *all* runs would massively underestimate it.
 */
function robustHRmax(activities) {
  const maxes = activities
    .filter(a => a.max_heartrate > 120 && a.max_heartrate < 230)
    .map(a => a.max_heartrate)
    .sort((a, b) => b - a);
  if (maxes.length === 0) return null;
  const raw = maxes[0];
  if (maxes.length < 8) return { hrmax: raw, raw, trimmed: false, nAvg: 1 };
  const drop = Math.min(3, Math.max(1, Math.round(maxes.length * 0.01)));
  const cluster = maxes.slice(drop, drop + 3); // average the next 3 highest
  const hrmax = Math.round(cluster.reduce((s, v) => s + v, 0) / cluster.length);
  return { hrmax, raw, trimmed: raw - hrmax >= 3, nAvg: cluster.length };
}

/**
 * Critical Speed via the 2-parameter linear model d = CS·t + D'.
 * Builds the performance envelope: the single fastest (flat) run in each
 * duration band, then linear-regresses distance on time.
 */
function computeCriticalSpeed(activities, months) {
  const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  const runs = activities.filter(a =>
    (a.type === 'Run' || a.sport_type === 'Run') &&
    a.moving_time > 0 && a.distance > 0 &&
    new Date(a.start_date).getTime() >= cutoff
  );

  const best = CS_BANDS.map(([lo, hi]) => {
    let pick = null;
    for (const a of runs) {
      const t = a.moving_time, d = a.distance;
      if (t < lo || t >= hi) continue;
      const elevPerKm = d > 0 ? ((a.total_elevation_gain || 0) / d) * 1000 : 0;
      if (elevPerKm > 15) continue; // gradient makes pace non-comparable
      const speed = d / t;
      if (!pick || speed > pick.speed) pick = { t, d, speed, band: [lo, hi], date: a.start_date };
    }
    return pick;
  }).filter(Boolean);

  // Monotonic envelope: a maximal power-duration curve must have speed strictly
  // DECREASING with duration. Walking from shortest to longest, drop any shorter
  // effort that a longer one beats — it clearly wasn't maximal. This filters out
  // easy runs masquerading as "best efforts" and prevents a fake threshold.
  const ordered = [...best].sort((a, b) => a.t - b.t);
  const envelope = [];
  for (const e of ordered) {
    while (envelope.length && e.speed >= envelope[envelope.length - 1].speed) envelope.pop();
    envelope.push(e);
  }

  const totalEfforts = best.length;
  if (envelope.length < 3) {
    return { valid: false, nEfforts: envelope.length, totalEfforts, nonMaximal: totalEfforts >= 3, efforts: envelope.map(e => ({ ...e, durMin: e.t / 60, pace: paceFromSpeed(e.speed) })) };
  }

  const n = envelope.length;
  const sx = envelope.reduce((s, e) => s + e.t, 0);
  const sy = envelope.reduce((s, e) => s + e.d, 0);
  const sxx = envelope.reduce((s, e) => s + e.t * e.t, 0);
  const sxy = envelope.reduce((s, e) => s + e.t * e.d, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { valid: false, nEfforts: n, totalEfforts, efforts: envelope };

  const cs = (n * sxy - sx * sy) / denom;       // m/s
  const dPrime = (sy - cs * sx) / n;             // m
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (const e of envelope) {
    const pred = cs * e.t + dPrime;
    ssRes += (e.d - pred) ** 2;
    ssTot += (e.d - meanY) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const valid = cs > 1.4 && cs < 6.5 && dPrime > 0;

  const efforts = envelope.map(e => ({ ...e, durMin: e.t / 60, pace: paceFromSpeed(e.speed) }));
  return { valid, cs, dPrime: Math.max(0, dPrime), r2, csPace: paceFromSpeed(cs), nEfforts: n, totalEfforts, efforts };
}

/**
 * Training paces derived from Critical Speed. Each zone is a fraction of CS
 * velocity; this is the actionable output for prescribing sessions.
 */
function trainingPaces(cs) {
  const p = frac => paceFromSpeed(cs * frac);
  return [
    { key: 'recovery',  lo: 0.70, hi: 0.78, hr: '<70%' },
    { key: 'easy',      lo: 0.78, hi: 0.85, hr: '70–80%' },
    { key: 'marathon',  lo: 0.85, hi: 0.92, hr: '80–87%' },
    { key: 'threshold', lo: 0.94, hi: 1.00, hr: '87–92%' },
    { key: 'interval',  lo: 1.00, hi: 1.06, hr: '92–97%' },
    { key: 'reps',      lo: 1.06, hi: 1.15, hr: '>97%' },
  ].map(z => ({ ...z, slow: p(z.lo), fast: p(z.hi) }));
}

// ─── HR cross-check (monthly trend) ──────────────────────────────────────────

function extractSamples(a) {
  const samples = [];
  const validLap = l =>
    l.average_heartrate > 80 &&
    l.average_speed > 0 &&
    (l.moving_time || l.elapsed_time || 0) >= MIN_LAP_TIME_S &&
    (l.distance || 0) >= MIN_LAP_DIST_M;

  if (a.laps && a.laps.length >= 2 && a.laps.some(validLap)) {
    for (const l of a.laps) {
      if (!validLap(l)) continue;
      const pace = 1000 / (l.average_speed * 60);
      const elevPerKm = l.distance > 0 ? ((l.total_elevation_gain || 0) / l.distance) * 1000 : 0;
      samples.push({ hr: l.average_heartrate, pace, isHilly: elevPerKm > 10, isLap: true });
    }
  } else if (a.average_heartrate > 0 && a.average_speed > 0) {
    const pace = 1000 / (a.average_speed * 60);
    const elevPerKm = a.distance > 0 ? ((a.total_elevation_gain || 0) / a.distance) * 1000 : 0;
    samples.push({ hr: a.average_heartrate, pace, isHilly: elevPerKm > 10, isLap: false });
  }
  return samples;
}

function computeLTMonthly(activities, months, hrmax) {
  const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  const lt2Target = hrmax * LT2_TARGET_PCT;
  const lt2Sigma  = hrmax * LT2_SIGMA_PCT;
  const lt1Target = hrmax * LT1_TARGET_PCT;
  const lt1Sigma  = hrmax * LT1_SIGMA_PCT;

  const runs = activities.filter(a =>
    (a.type === 'Run' || a.sport_type === 'Run') &&
    a.moving_time >= MIN_DURATION_S &&
    new Date(a.start_date).getTime() >= cutoff
  );

  const byMonth = {};
  for (const a of runs) {
    const month = a.start_date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { lt2pairs: [], lt1pairs: [], hrs: [], count: 0, lapCount: 0 };
    const samples = extractSamples(a);
    if (samples.length === 0) continue;
    byMonth[month].count++;
    let usedLaps = false;
    for (const s of samples) {
      if (s.isHilly) continue;
      const w2 = gaussianWeight(s.hr, lt2Target, lt2Sigma);
      const w1 = gaussianWeight(s.hr, lt1Target, lt1Sigma);
      if (w2 > 0.01) byMonth[month].lt2pairs.push({ value: s.pace, weight: w2 });
      if (w1 > 0.01) byMonth[month].lt1pairs.push({ value: s.pace, weight: w1 });
      byMonth[month].hrs.push(s.hr);
      if (s.isLap) usedLaps = true;
    }
    if (usedLaps) byMonth[month].lapCount++;
  }

  const monthly = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => {
      const [y, m] = month.split('-');
      const label = `${m}/${y.slice(2)}`;
      const lt2pace = weightedMedian(d.lt2pairs);
      const lt1pace = weightedMedian(d.lt1pairs);
      const avgHR   = d.hrs.length ? d.hrs.reduce((s, h) => s + h, 0) / d.hrs.length : 0;
      const rawConf = d.lt2pairs.length;
      const confidence = d.lapCount > 0 ? Math.min(3, rawConf) : Math.min(2, rawConf);
      return { month, label, lt2pace, lt1pace, hr: Math.round(avgHR), count: d.count, lapCount: d.lapCount, confidence };
    })
    .filter(d => d.lt2pace !== null);

  let ewma = null;
  return monthly.map(d => {
    ewma = ewma === null ? d.lt2pace : EWMA_LAMBDA * d.lt2pace + (1 - EWMA_LAMBDA) * ewma;
    return { ...d, lt2smooth: Math.round(ewma * 1000) / 1000 };
  });
}

// ─── component ──────────────────────────────────────────────────────────────

export default function LactateThreshold({ activities }) {
  const { t } = useTranslation();
  const [monthsToShow, setMonthsToShow] = useState('12');

  const hrInfo = useMemo(() => {
    if (!activities || activities.length === 0) return null;
    return robustHRmax(activities);
  }, [activities]);
  const hrmax = hrInfo?.hrmax ?? null;

  const model = useMemo(() => {
    if (!activities || activities.length === 0 || !hrmax) {
      return { monthlyData: [], hr: null, cs: null, hasData: false };
    }
    const months = parseInt(monthsToShow);
    const monthly = computeLTMonthly(activities, months, hrmax);
    const cs = computeCriticalSpeed(activities, months);

    let hr = null;
    if (monthly.length > 0) {
      const latest = monthly[monthly.length - 1];
      let trendDelta = null;
      if (monthly.length >= 3) {
        trendDelta = Math.round((monthly[0].lt2smooth - latest.lt2smooth) * 60);
      }
      hr = { lt2: latest.lt2pace, lt1: latest.lt1pace, trendDelta };
    }
    return { monthlyData: monthly, hr, cs, hasData: monthly.length > 0 || (cs && cs.valid) };
  }, [activities, monthsToShow, hrmax]);

  const { monthlyData, hr, cs, hasData } = model;

  if (!hrmax) {
    return (
      <div className="text-center py-16 text-slate-400">
        <div className="text-5xl mb-4">💓</div>
        <p className="text-base font-semibold text-slate-600 mb-1">{t('lactate.no_hr')}</p>
        <p className="text-sm">{t('lactate.no_hr_hint')}</p>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="text-center py-16 text-slate-400">
        <div className="text-5xl mb-4">📊</div>
        <p className="text-base font-semibold text-slate-600 mb-1">{t('lactate.not_enough')}</p>
        <p className="text-sm">{t('lactate.not_enough_hint', { bpm: Math.round(hrmax * 0.87), hrmax })}</p>
        <p className="text-xs mt-2">{t('lactate.extend_hint')}</p>
      </div>
    );
  }

  // Source of truth: Critical Speed if valid, else HR cross-check.
  const csValid = cs && cs.valid;
  const headlineLT2 = csValid ? cs.csPace : hr?.lt2 ?? null;
  const paces = csValid ? trainingPaces(cs.cs) : null;
  const easyPace = paces?.find(z => z.key === 'easy');
  const tempoPace = paces?.find(z => z.key === 'threshold');

  // Reconciliation between methods (sec/km)
  let disagreeSec = null;
  if (csValid && hr?.lt2) disagreeSec = Math.round((hr.lt2 - cs.csPace) * 60);

  const trendDelta = hr?.trendDelta ?? null;
  const trendStatus = trendDelta === null ? null : trendDelta > 5 ? 'improving' : trendDelta < -5 ? 'worsening' : 'stable';
  const trendConfig = {
    improving: { color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', arrow: '↑', msg: t('lactate.trend_improving_msg', { sec: Math.abs(trendDelta) }) },
    stable:    { color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200',     arrow: '→', msg: t('lactate.trend_stable_msg') },
    worsening: { color: 'text-red-600',     bg: 'bg-red-50 border-red-200',         arrow: '↓', msg: t('lactate.trend_worsening_msg', { sec: Math.abs(trendDelta) }) },
  };

  // CS chart data: model curve + scatter of best efforts
  const csChartData = (() => {
    if (!csValid) return [];
    const curve = [];
    for (let m = 3; m <= 50; m += 1) {
      const tt = m * 60;
      const sp = cs.cs + cs.dPrime / tt;
      curve.push({ durMin: m, modelPace: paceFromSpeed(sp) });
    }
    const pts = cs.efforts.map(e => ({ durMin: Math.round(e.durMin * 10) / 10, effortPace: e.pace }));
    return [...curve, ...pts].sort((a, b) => a.durMin - b.durMin);
  })();

  const csYDomain = (() => {
    if (!csValid) return ['auto', 'auto'];
    const ps = cs.efforts.map(e => e.pace);
    return [Math.min(...ps, cs.csPace) - 0.3, Math.max(...ps) + 0.3];
  })();

  const paceYDomain = (() => {
    const list = monthlyData.map(d => d.lt2pace).filter(Boolean);
    if (list.length === 0) return ['auto', 'auto'];
    return [Math.min(...list) - 0.25, Math.max(...list) + 0.25];
  })();

  const zoneColors = {
    recovery: 'border-slate-200 bg-slate-50',
    easy: 'border-sky-300 bg-sky-50',
    marathon: 'border-teal-300 bg-teal-50',
    threshold: 'border-blue-400 bg-blue-50',
    interval: 'border-orange-300 bg-orange-50',
    reps: 'border-red-300 bg-red-50',
  };

  const renderPaceTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs space-y-0.5">
        <p className="font-bold text-slate-700">{d.label}</p>
        <p className="text-blue-600 font-semibold">LT2: {formatPace(d.lt2pace)}/km</p>
        {d.lt1pace && <p className="text-sky-500">LT1: {formatPace(d.lt1pace)}/km</p>}
        <p className="text-slate-400">{t('lactate.runs_count', { n: d.count, c: d.confidence })}</p>
      </div>
    );
  };

  const renderCsTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const eff = payload.find(p => p.dataKey === 'effortPace' && p.value != null);
    const mod = payload.find(p => p.dataKey === 'modelPace' && p.value != null);
    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs space-y-0.5">
        <p className="font-bold text-slate-700">{Math.round(label)} min</p>
        {eff && <p className="text-blue-600 font-semibold">{t('lactate.cs_legend_efforts')}: {formatPace(eff.value)}/km</p>}
        {mod && <p className="text-sky-500">{t('lactate.cs_legend_model')}: {formatPace(mod.value)}/km</p>}
      </div>
    );
  };

  return (
    <div className="space-y-6">

      {/* ── Stat row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('lactate.threshold_label')}</p>
          <p className="text-2xl font-black text-blue-600 tabular-nums">{formatPace(headlineLT2)}<span className="text-sm font-semibold text-slate-400">/km</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">{csValid ? t('lactate.threshold_hint_cs') : t('lactate.threshold_hint_hr')}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('lactate.easy_label')}</p>
          <p className="text-2xl font-black text-sky-500 tabular-nums">{easyPace ? `${formatPace(easyPace.slow)}` : (hr?.lt1 ? formatPace(hr.lt1) : '—')}<span className="text-sm font-semibold text-slate-400">/km</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t('lactate.easy_hint')}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('lactate.hrmax_label')}</p>
          <p className="text-2xl font-black text-slate-800 tabular-nums">{hrmax} <span className="text-sm font-semibold text-slate-400">bpm</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">{hrInfo?.trimmed ? t('lactate.hrmax_trimmed', { raw: hrInfo.raw }) : t('lactate.hrmax_hint')}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('lactate.trend_label')}</p>
          {trendDelta !== null ? (
            <>
              <p className={`text-2xl font-black tabular-nums ${trendConfig[trendStatus].color}`}>
                {trendConfig[trendStatus].arrow} {Math.abs(trendDelta)}s/km
              </p>
              <p className={`text-[10px] font-semibold mt-0.5 ${trendConfig[trendStatus].color}`}>
                {trendStatus === 'improving' ? t('lactate.improving') : trendStatus === 'worsening' ? t('lactate.worsening') : t('lactate.stable')}
              </p>
            </>
          ) : (
            <p className="text-2xl font-black text-slate-400">—</p>
          )}
        </div>
      </div>

      {/* ── Actionable recommendation ── */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-bold text-blue-700 mb-1">🎯 {t('lactate.reco_title')}</p>
        {csValid && easyPace && tempoPace ? (
          <p className="text-sm text-slate-700">
            {t('lactate.reco_body', { lt2: formatPace(cs.csPace), easy: formatPace(easyPace.slow), tempo: `${formatPace(tempoPace.slow)}–${formatPace(tempoPace.fast)}` })}
          </p>
        ) : (
          <p className="text-sm text-slate-700">{cs?.nonMaximal ? t('lactate.reco_nonmaximal') : t('lactate.reco_need_efforts')}</p>
        )}
        {disagreeSec !== null && Math.abs(disagreeSec) > 15 && (
          <p className="text-xs text-slate-500 mt-2">
            {t('lactate.reco_disagree', { hr: formatPace(hr.lt2), cs: formatPace(cs.csPace), sec: Math.abs(disagreeSec) })}
          </p>
        )}
      </div>

      {/* ── Time window ── */}
      <div className="flex items-center gap-3">
        <Select value={monthsToShow} onValueChange={setMonthsToShow} className="w-36">
          <SelectItem value="3">{t('lactate.months_3')}</SelectItem>
          <SelectItem value="6">{t('lactate.months_6')}</SelectItem>
          <SelectItem value="12">{t('lactate.months_12')}</SelectItem>
          <SelectItem value="24">{t('lactate.months_24')}</SelectItem>
        </Select>
        <span className="text-xs text-slate-400">{t('lactate.months_with_data', { n: monthlyData.length })}</span>
      </div>

      {/* ── Critical Speed model ── */}
      {csValid && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">{t('lactate.cs_title')}</Title>
          <Text className="text-slate-500 text-sm mb-4">{t('lactate.cs_subtitle')}</Text>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t('lactate.cs_cs_value')}</p>
              <p className="text-lg font-black text-blue-600 tabular-nums">{formatPace(cs.csPace)}<span className="text-xs text-slate-400">/km</span></p>
              <p className="text-[10px] text-slate-400">{cs.cs.toFixed(2)} m/s</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t('lactate.cs_dprime')}</p>
              <p className="text-lg font-black text-slate-700 tabular-nums">{Math.round(cs.dPrime)} <span className="text-xs text-slate-400">m</span></p>
              <p className="text-[10px] text-slate-400">{t('lactate.cs_efforts', { n: cs.nEfforts })}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t('lactate.cs_r2')}</p>
              <p className="text-lg font-black text-slate-700 tabular-nums">{(cs.r2 * 100).toFixed(1)}%</p>
              <p className="text-[10px] text-slate-400">{cs.r2 >= 0.97 ? '✓' : '⚠'} {t('lactate.cs_r2')}</p>
            </div>
          </div>
          <Text className="text-slate-400 text-xs mb-2">{t('lactate.cs_yaxis')}</Text>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={csChartData} margin={{ top: 10, right: 20, left: 10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="durMin" type="number" domain={[0, 50]}
                  tickFormatter={v => `${v}m`} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis domain={csYDomain} reversed tickFormatter={v => formatPace(v)}
                  tick={{ fontSize: 10, fill: '#94a3b8' }} width={42} />
                <RechartsTooltip content={renderCsTooltip} />
                <ReferenceLine y={cs.csPace} stroke="#2563eb" strokeDasharray="4 2"
                  label={{ value: formatPace(cs.csPace), fontSize: 9, fill: '#2563eb', position: 'insideTopRight' }} />
                <Line type="monotone" dataKey="modelPace" stroke="#93c5fd" strokeWidth={2} dot={false} connectNulls name="modelPace" />
                <Scatter dataKey="effortPace" fill="#2563eb" name="effortPace" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-5 mt-3 text-[10px] text-slate-500 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-blue-300" /> {t('lactate.cs_legend_model')}</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full bg-blue-600" /> {t('lactate.cs_legend_efforts')}</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5" style={{ borderTop: '2px dashed #2563eb' }} /> {t('lactate.cs_legend_asymptote')}</span>
          </div>
          {(cs.nEfforts < 4 || cs.r2 < 0.97) && (
            <p className="text-[11px] text-amber-600 mt-2">⚠ {t('lactate.cs_low_conf')}</p>
          )}
        </Card>
      )}

      {/* ── Training paces (decisions) ── */}
      {csValid && paces && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">{t('lactate.paces_title')}</Title>
          <Text className="text-slate-500 text-sm mb-4">{t('lactate.paces_subtitle')}</Text>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {paces.map(z => (
              <div key={z.key} className={`rounded-xl border-2 p-3 ${zoneColors[z.key]}`}>
                <div className="flex items-baseline justify-between mb-1">
                  <p className="text-xs font-bold text-slate-700">{t(`lactate.zone_${z.key}`)}</p>
                  <span className="text-[10px] text-slate-400">≈ {z.hr} FCmax</span>
                </div>
                <p className="text-lg font-black text-slate-800 tabular-nums">{formatPace(z.slow)}–{formatPace(z.fast)}<span className="text-xs font-semibold text-slate-400">/km</span></p>
                <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5">{t(`lactate.zone_${z.key}_desc`)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── HR cross-check: monthly LT2 trend ── */}
      {monthlyData.length > 0 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">{t('lactate.chart_title')}</Title>
          <Text className="text-slate-500 text-sm mb-1">{t('lactate.chart_subtitle')} {t('lactate.chart_ewma')}</Text>
          <Text className="text-slate-400 text-xs mb-4">{t('lactate.chart_yaxis')}</Text>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis dataKey="lt2pace" domain={paceYDomain} reversed tickFormatter={v => formatPace(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} width={42} />
                <RechartsTooltip content={renderPaceTooltip} />
                {hr?.lt2 && (
                  <ReferenceLine y={hr.lt2} stroke="#2563eb" strokeDasharray="4 2"
                    label={{ value: formatPace(hr.lt2), fontSize: 9, fill: '#2563eb', position: 'insideTopRight' }} />
                )}
                <Line type="monotone" dataKey="lt2pace" stroke="#93c5fd" strokeWidth={1.5} dot={{ r: 3, fill: '#93c5fd', strokeWidth: 0 }} activeDot={{ r: 5 }} name="LT2 (raw)" connectNulls />
                <Line type="monotone" dataKey="lt2smooth" stroke="#2563eb" strokeWidth={2.5} dot={false} strokeDasharray="6 2" name="LT2 (EWMA)" connectNulls />
                {monthlyData.some(d => d.lt1pace) && (
                  <Line type="monotone" dataKey="lt1pace" stroke="#0ea5e9" strokeWidth={1.5} dot={{ r: 2.5, fill: '#0ea5e9', strokeWidth: 0 }} activeDot={{ r: 4 }} name="LT1" connectNulls strokeDasharray="3 3" />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-5 mt-3 text-[10px] text-slate-500 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-blue-300" /> {t('lactate.legend_lt2_raw')}</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5" style={{ borderTop: '2px dashed #2563eb' }} /> {t('lactate.legend_lt2_ewma')}</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-sky-400" /> {t('lactate.legend_lt1')}</span>
          </div>
        </Card>
      )}

      {/* ── Confidence bars ── */}
      {monthlyData.length > 0 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">{t('lactate.confidence_bars_title')}</Title>
          <Text className="text-slate-500 text-sm mb-4">{t('lactate.confidence_bars_subtitle')}</Text>
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} width={24} />
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border border-slate-200 rounded-lg shadow p-2 text-xs">
                        <p className="font-bold text-slate-700">{d.label}</p>
                        <p>{t('lactate.runs_count', { n: d.count, c: d.confidence })}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {monthlyData.map((d, i) => (
                    <Cell key={i} fill={d.confidence >= 3 ? '#2563eb' : d.confidence === 2 ? '#93c5fd' : '#dbeafe'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-600" /> {t('lactate.high_conf')}</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-300" /> {t('lactate.medium_conf')}</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-100" /> {t('lactate.low_conf')}</span>
          </div>
        </Card>
      )}

      {/* ── Trend interpretation ── */}
      {trendStatus && (
        <div className={`rounded-xl border p-4 ${trendConfig[trendStatus].bg}`}>
          <p className={`text-sm font-bold mb-1 ${trendConfig[trendStatus].color}`}>
            {trendConfig[trendStatus].arrow} {trendStatus === 'improving' ? t('lactate.lt2_improving') : trendStatus === 'worsening' ? t('lactate.lt2_worsening') : t('lactate.lt2_stable')}
          </p>
          <p className="text-sm text-slate-700">{trendConfig[trendStatus].msg}</p>
        </div>
      )}

      {/* ── Methodology ── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">{t('lactate.methodology_title')}</Title>
        <div className="space-y-2 text-sm text-slate-600">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { labelKey: 'lactate.method_cs', descKey: 'lactate.method_cs_desc' },
              { labelKey: 'lactate.method_robust_hrmax', descKey: 'lactate.method_robust_hrmax_desc' },
              { labelKey: 'lactate.method_hr_crosscheck', descKey: 'lactate.method_hr_crosscheck_desc' },
            ].map(z => (
              <div key={z.labelKey} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <p className="text-xs font-semibold text-slate-700 mb-1">{t(z.labelKey)}</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{t(z.descKey)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            <span className="font-semibold">{t('lactate.references')}:</span>{' '}
            Jones et al. (2010) <em>Med Sci Sports Exerc</em> 42(10):1876–1890 ·
            Galán-Rioja et al. (2020) <em>Sports Med</em> 50:1771–1783 ·
            Monod &amp; Scherrer (1965) <em>Ergonomics</em> 8:329–338 ·
            Rogers et al. (2021) <em>Front Physiol</em> 12:642489 (DFA-α1) ·
            Faude et al. (2009) <em>Sports Med</em> 39(6):469–490 ·
            Tanaka et al. (2001) <em>JACC</em> 37(1):153–156.
          </p>
        </div>
      </Card>

    </div>
  );
}
