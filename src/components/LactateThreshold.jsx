import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';

// ─── helpers ────────────────────────────────────────────────────────────────

function formatPace(minPerKm) {
  if (!minPerKm || minPerKm <= 0 || minPerKm > 20) return '--:--';
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Gaussian weight: run contributes more when its avgHR is close to the target HR.
 * sigma = 2.5% of HRmax gives strong weighting within ±5 bpm of target.
 */
function gaussianWeight(hr, target, sigma) {
  const diff = hr - target;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

/**
 * Weighted median — more robust than weighted mean for pace distributions.
 * Falls back to regular median for small samples.
 */
function weightedMedian(pairs) {
  // pairs: [{value, weight}]
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

// ─── core algorithm ─────────────────────────────────────────────────────────
//
// LT2 (Maximal Lactate Steady State / anaerobic threshold):
//   Target HR = 87% HRmax  (range 85–89%)
//   Ref: Faude et al. (2009) Sports Med 39(6):469-490
//        Stegmann & Kindermann (1982) Int J Sports Med
//
// LT1 (Aerobic threshold / VT1):
//   Target HR = 77% HRmax  (range 74–80%)
//   Ref: Hofmann & Tschakert (2017) Front Physiol 8:337
//        Kindermann et al. (1979) Eur J Appl Physiol
//
// HRmax: observed maximum across all activities.
//   Using observed max avoids age-formula errors (Tanaka 2001 shows ±10 bpm SD
//   even with 208-0.7×age; real observed max from data is always more accurate).
//
// Pace: 1000 / (average_speed × 60) min/km
//   Hilly runs (> 10 m/km elevation gain) are flagged with lower confidence
//   since pace-HR coupling is confounded by gradient.
//
// Temporal smoothing: EWMA (λ=0.3) on monthly medians so that a single
//   outlier month doesn't dominate the trend.
//   Ref: Gardner (1985) J Forecast — exponential smoothing for short time series.
//
// ─────────────────────────────────────────────────────────────────────────────

const LT2_TARGET_PCT  = 0.87;
const LT2_SIGMA_PCT   = 0.025; // ≈ ±4-5 bpm at HRmax 180
const LT1_TARGET_PCT  = 0.77;
const LT1_SIGMA_PCT   = 0.025;
const EWMA_LAMBDA     = 0.3;   // recency weight; higher = more reactive
const MIN_DURATION_S  = 20 * 60; // 20 min minimum for full-run fallback
const MIN_LAP_TIME_S  = 4 * 60;  // 4 min minimum per lap (~500m+) for steady-state HR
const MIN_LAP_DIST_M  = 400;     // ignore sub-400 m laps (transition/auto-split artifacts)

/**
 * Extract lap-level or activity-level HR/pace samples for gaussian weighting.
 *
 * Priority:
 *   1. If activity.laps is available and has ≥2 valid laps → use individual laps.
 *      Each lap has its own avgHR and avgSpeed, so a tempo segment within a longer
 *      run correctly contributes at its actual intensity — far more accurate than
 *      using the whole-run average.
 *   2. Fallback to whole-run average_heartrate when laps aren't loaded yet.
 */
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
      samples.push({
        hr: l.average_heartrate,
        pace,
        isHilly: elevPerKm > 10,
        isLap: true,
      });
    }
  } else if (a.average_heartrate > 0 && a.average_speed > 0) {
    // Whole-run fallback
    const pace = 1000 / (a.average_speed * 60);
    const elevPerKm = a.distance > 0 ? ((a.total_elevation_gain || 0) / a.distance) * 1000 : 0;
    samples.push({
      hr: a.average_heartrate,
      pace,
      isHilly: elevPerKm > 10,
      isLap: false,
    });
  }

  return samples;
}

function computeLTMonthly(activities, months, hrmax) {
  const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  const lt2Target = hrmax * LT2_TARGET_PCT;
  const lt2Sigma  = hrmax * LT2_SIGMA_PCT;
  const lt1Target = hrmax * LT1_TARGET_PCT;
  const lt1Sigma  = hrmax * LT1_SIGMA_PCT;

  // 1. Filter valid runs within the time window
  const runs = activities.filter(a =>
    (a.type === 'Run' || a.sport_type === 'Run') &&
    a.moving_time >= MIN_DURATION_S &&
    new Date(a.start_date).getTime() >= cutoff
  );

  // 2. Group by month, accumulating gaussian-weighted pace samples per LT zone
  const byMonth = {};
  for (const a of runs) {
    const month = a.start_date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { lt2pairs: [], lt1pairs: [], hrs: [], count: 0, lapCount: 0 };

    const samples = extractSamples(a);
    if (samples.length === 0) continue;

    byMonth[month].count++;
    let usedLaps = false;

    for (const s of samples) {
      // Exclude hilly laps/runs: gradient decouples HR from pace, making the
      // sample unreliable for LT estimation (same HR = slower pace uphill, faster downhill).
      if (s.isHilly) continue;

      const w2 = gaussianWeight(s.hr, lt2Target, lt2Sigma);
      const w1 = gaussianWeight(s.hr, lt1Target, lt1Sigma);

      // threshold for inclusion: within ~3 sigma of target (~13 bpm at HRmax 180)
      if (w2 > 0.01) byMonth[month].lt2pairs.push({ value: s.pace, weight: w2 });
      if (w1 > 0.01) byMonth[month].lt1pairs.push({ value: s.pace, weight: w1 });
      byMonth[month].hrs.push(s.hr);
      if (s.isLap) usedLaps = true;
    }
    if (usedLaps) byMonth[month].lapCount++;
  }

  // 3. Compute per-month estimates
  const monthly = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => {
      const [y, m] = month.split('-');
      const label = `${m}/${y.slice(2)}`;
      const lt2pace = weightedMedian(d.lt2pairs);
      const lt1pace = weightedMedian(d.lt1pairs);
      const avgHR   = d.hrs.reduce((s, h) => s + h, 0) / d.hrs.length;
      // confidence: lap-level data scores higher than whole-run averages
      const rawConf = d.lt2pairs.length;
      const confidence = d.lapCount > 0
        ? Math.min(3, rawConf)        // lap data: each qualifying lap counts
        : Math.min(2, rawConf);       // fallback: cap at 2 (less precise)
      return { month, label, lt2pace, lt1pace, hr: Math.round(avgHR), count: d.count, lapCount: d.lapCount, confidence };
    })
    .filter(d => d.lt2pace !== null);

  // 4. EWMA smoothing on lt2pace
  let ewma = null;
  const smoothed = monthly.map(d => {
    ewma = ewma === null ? d.lt2pace : EWMA_LAMBDA * d.lt2pace + (1 - EWMA_LAMBDA) * ewma;
    return { ...d, lt2smooth: Math.round(ewma * 1000) / 1000 };
  });

  return smoothed;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function LactateThreshold({ activities }) {
  const { t } = useTranslation();
  const [monthsToShow, setMonthsToShow] = useState('12');

  // Derive HRmax from observed data across ALL activities (not just the window)
  const hrmax = useMemo(() => {
    if (!activities || activities.length === 0) return null;
    const maxes = activities
      .filter(a => a.max_heartrate > 120 && a.max_heartrate < 230)
      .map(a => a.max_heartrate);
    return maxes.length > 0 ? Math.max(...maxes) : null;
  }, [activities]);

  const { monthlyData, currentLT2, currentLT1, currentLTHR, trendDelta, hasData } = useMemo(() => {
    if (!activities || activities.length === 0 || !hrmax) {
      return { monthlyData: [], currentLT2: null, currentLT1: null, currentLTHR: null, trendDelta: null, hasData: false };
    }

    const months = parseInt(monthsToShow);
    const monthly = computeLTMonthly(activities, months, hrmax);

    if (monthly.length === 0) {
      return { monthlyData: [], currentLT2: null, currentLT1: null, currentLTHR: null, trendDelta: null, hasData: false };
    }

    const latest = monthly[monthly.length - 1];
    const currentLT2  = latest.lt2pace;
    const currentLT1  = latest.lt1pace;
    const currentLTHR = Math.round(hrmax * LT2_TARGET_PCT);

    // Trend: EWMA start vs end (improvement = pace decreased = faster)
    let trendDelta = null;
    if (monthly.length >= 3) {
      const first = monthly[0].lt2smooth;
      const last  = latest.lt2smooth;
      trendDelta = Math.round((first - last) * 60); // sec/km, positive = improved
    }

    return { monthlyData: monthly, currentLT2, currentLT1, currentLTHR, trendDelta, hasData: true };
  }, [activities, monthsToShow, hrmax]);

  // ── empty state ──────────────────────────────────────────────────────────
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

  const paceYDomain = (() => {
    const paces = monthlyData.map(d => d.lt2pace).filter(Boolean);
    if (paces.length === 0) return ['auto', 'auto'];
    const pad = 0.25;
    return [Math.min(...paces) - pad, Math.max(...paces) + pad];
  })();

  const trendStatus = trendDelta === null ? null : trendDelta > 5 ? 'improving' : trendDelta < -5 ? 'worsening' : 'stable';

  const trendConfig = {
    improving: { color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', arrow: '↑',
      msg: t('lactate.trend_improving_msg', { sec: Math.abs(trendDelta) }) },
    stable:    { color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200',     arrow: '→',
      msg: t('lactate.trend_stable_msg') },
    worsening: { color: 'text-red-600',     bg: 'bg-red-50 border-red-200',         arrow: '↓',
      msg: t('lactate.trend_worsening_msg', { sec: Math.abs(trendDelta) }) },
  };

  const lt2HR  = Math.round(hrmax * LT2_TARGET_PCT);
  const lt1HR  = Math.round(hrmax * LT1_TARGET_PCT);

  const PaceTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs space-y-0.5">
        <p className="font-bold text-slate-700">{d.label}</p>
        <p className="text-blue-600 font-semibold">LT2: {formatPace(d.lt2pace)}/km</p>
        {d.lt1pace && <p className="text-sky-500">LT1: {formatPace(d.lt1pace)}/km</p>}
        <p className="text-slate-400">{t('lactate.runs_count', { n: d.count, c: d.confidence })}</p>
        <p className="text-slate-300">{d.lapCount > 0 ? t('lactate.with_lap_data', { n: d.lapCount }) : t('lactate.run_average_only')}</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">

      {/* ── Stat row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('lactate.hrmax_label')}</p>
          <p className="text-2xl font-black text-slate-800 tabular-nums">{hrmax} <span className="text-sm font-semibold text-slate-400">bpm</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t('lactate.hrmax_hint')}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('lactate.lt2_label')}</p>
          <p className="text-2xl font-black text-blue-600 tabular-nums">{formatPace(currentLT2)}<span className="text-sm font-semibold text-slate-400">/km</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t('lactate.lt2_hint', { bpm: lt2HR })}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('lactate.lt1_label')}</p>
          <p className="text-2xl font-black text-sky-500 tabular-nums">{formatPace(currentLT1)}<span className="text-sm font-semibold text-slate-400">/km</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t('lactate.lt1_hint', { bpm: lt1HR })}</p>
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

      {/* ── LT2 trend chart ── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">{t('lactate.chart_title')}</Title>
        <Text className="text-slate-500 text-sm mb-1">
          {t('lactate.chart_subtitle')} {t('lactate.chart_ewma')}
        </Text>
        <Text className="text-slate-400 text-xs mb-4">
          {t('lactate.chart_yaxis')}
        </Text>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis
                dataKey="lt2pace"
                domain={paceYDomain}
                reversed
                tickFormatter={v => formatPace(v)}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                width={42}
              />
              <RechartsTooltip content={<PaceTooltip />} />
              {currentLT2 && (
                <ReferenceLine y={currentLT2} stroke="#2563eb" strokeDasharray="4 2"
                  label={{ value: formatPace(currentLT2), fontSize: 9, fill: '#2563eb', position: 'insideTopRight' }} />
              )}
              {/* Raw gaussian-weighted pace */}
              <Line type="monotone" dataKey="lt2pace" stroke="#93c5fd" strokeWidth={1.5}
                dot={{ r: 3, fill: '#93c5fd', strokeWidth: 0 }} activeDot={{ r: 5 }}
                name="LT2 (raw)" connectNulls />
              {/* EWMA smoothed */}
              <Line type="monotone" dataKey="lt2smooth" stroke="#2563eb" strokeWidth={2.5}
                dot={false} strokeDasharray="6 2" name="LT2 (EWMA)" connectNulls />
              {/* LT1 */}
              {monthlyData.some(d => d.lt1pace) && (
                <Line type="monotone" dataKey="lt1pace" stroke="#0ea5e9" strokeWidth={1.5}
                  dot={{ r: 2.5, fill: '#0ea5e9', strokeWidth: 0 }} activeDot={{ r: 4 }}
                  name="LT1" connectNulls strokeDasharray="3 3" />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-5 mt-3 text-[10px] text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-blue-300" /> {t('lactate.legend_lt2_raw')}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-blue-600" style={{borderTop:'2px dashed #2563eb',background:'none'}} /> {t('lactate.legend_lt2_ewma')}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-sky-400" /> {t('lactate.legend_lt1')}</span>
        </div>
      </Card>

      {/* ── Confidence bars ── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">{t('lactate.confidence_bars_title')}</Title>
        <Text className="text-slate-500 text-sm mb-4">
          {t('lactate.confidence_bars_subtitle')}
        </Text>
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

      {/* ── Trend interpretation ── */}
      {trendStatus && (
        <div className={`rounded-xl border p-4 ${trendConfig[trendStatus].bg}`}>
          <p className={`text-sm font-bold mb-1 ${trendConfig[trendStatus].color}`}>
            {trendConfig[trendStatus].arrow} {trendStatus === 'improving' ? t('lactate.lt2_improving') : trendStatus === 'worsening' ? t('lactate.lt2_worsening') : t('lactate.lt2_stable')}
          </p>
          <p className="text-sm text-slate-700">{trendConfig[trendStatus].msg}</p>
        </div>
      )}

      {/* ── Zone reference ── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">{t('lactate.zones_title', { hrmax })}</Title>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { nameKey: 'lactate.lt1_zone_name', descKey: 'lactate.lt1_zone_desc', pct: '74–80%', hr: `${Math.round(hrmax*0.74)}–${Math.round(hrmax*0.80)} bpm`, pace: currentLT1 ? formatPace(currentLT1) : '—', color: 'border-sky-300 bg-sky-50' },
            { nameKey: 'lactate.lt2_zone_name', descKey: 'lactate.lt2_zone_desc', pct: '85–89%', hr: `${Math.round(hrmax*0.85)}–${Math.round(hrmax*0.89)} bpm`, pace: currentLT2 ? formatPace(currentLT2) : '—', color: 'border-blue-400 bg-blue-50' },
          ].map(z => (
            <div key={z.nameKey} className={`rounded-xl border-2 p-4 ${z.color}`}>
              <p className="text-xs font-bold text-slate-700 mb-0.5">{t(z.nameKey)}</p>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-lg font-black text-slate-800 tabular-nums">{z.pace}<span className="text-xs font-semibold text-slate-400">/km</span></span>
                <span className="text-xs text-slate-500">{z.hr} · {z.pct} HRmax</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">{t(z.descKey)}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Methodology ── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">{t('lactate.methodology_title')}</Title>
        <div className="space-y-2 text-sm text-slate-600">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { labelKey: 'lactate.method_hrmax', descKey: 'lactate.method_hrmax_desc' },
              { labelKey: 'lactate.method_laps', descKey: 'lactate.method_laps_desc' },
              { labelKey: 'lactate.method_ewma', descKey: 'lactate.method_ewma_desc' },
            ].map(z => (
              <div key={z.labelKey} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <p className="text-xs font-semibold text-slate-700 mb-1">{t(z.labelKey)}</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{t(z.descKey)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            <span className="font-semibold">{t('lactate.references')}:</span>{' '}
            Faude et al. (2009) <em>Sports Med</em> 39(6):469–490 ·
            Kindermann et al. (1979) <em>Eur J Appl Physiol</em> ·
            Hofmann &amp; Tschakert (2017) <em>Front Physiol</em> 8:337 ·
            Stegmann &amp; Kindermann (1982) <em>Int J Sports Med</em> 3(2):105–110 ·
            Tanaka et al. (2001) <em>JACC</em> 37(1):153–156.
          </p>
        </div>
      </Card>

    </div>
  );
}
