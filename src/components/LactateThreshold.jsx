import { useMemo, useState } from 'react';
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

const LT2_TARGET_PCT = 0.87;
const LT2_SIGMA_PCT  = 0.025; // ≈ ±5 bpm at HRmax 180
const LT1_TARGET_PCT = 0.77;
const LT1_SIGMA_PCT  = 0.025;
const EWMA_LAMBDA    = 0.3;   // recency weight; higher = more reactive
const MIN_DURATION_S = 20 * 60; // 20 min minimum

function computeLTMonthly(activities, months, hrmax) {
  const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  const lt2Target = hrmax * LT2_TARGET_PCT;
  const lt2Sigma  = hrmax * LT2_SIGMA_PCT;
  const lt1Target = hrmax * LT1_TARGET_PCT;
  const lt1Sigma  = hrmax * LT1_SIGMA_PCT;

  // 1. Filter valid runs
  const runs = activities.filter(a =>
    (a.type === 'Run' || a.sport_type === 'Run') &&
    a.moving_time >= MIN_DURATION_S &&
    a.average_heartrate > 0 &&
    a.average_speed > 0 &&
    new Date(a.start_date).getTime() >= cutoff
  );

  // 2. Group by month, compute gaussian-weighted median pace for LT2 and LT1
  const byMonth = {};
  for (const a of runs) {
    const month = a.start_date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { lt2pairs: [], lt1pairs: [], hrs: [], count: 0, hillCount: 0 };

    const pace = 1000 / (a.average_speed * 60); // min/km
    const hr   = a.average_heartrate;
    const elevPerKm = a.distance > 0 ? ((a.total_elevation_gain || 0) / a.distance) * 1000 : 0;
    const isHilly = elevPerKm > 10; // > 10 m/km — gradient confounds HR/pace

    const w2 = gaussianWeight(hr, lt2Target, lt2Sigma);
    const w1 = gaussianWeight(hr, lt1Target, lt1Sigma);

    // Include run in LT2 if weight is meaningful (within ~2.5 sigma = ±6% HRmax)
    if (w2 > 0.01) {
      byMonth[month].lt2pairs.push({ value: pace, weight: w2 * (isHilly ? 0.4 : 1) });
    }
    if (w1 > 0.01) {
      byMonth[month].lt1pairs.push({ value: pace, weight: w1 * (isHilly ? 0.4 : 1) });
    }
    byMonth[month].hrs.push(hr);
    byMonth[month].count++;
    if (isHilly) byMonth[month].hillCount++;
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
      const confidence = Math.min(3, d.lt2pairs.length); // 1–3+
      return { month, label, lt2pace, lt1pace, hr: Math.round(avgHR), count: d.count, confidence };
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
        <p className="text-base font-semibold text-slate-600 mb-1">No HR data found</p>
        <p className="text-sm">Heart rate data is required. Make sure your runs are recorded with a HR monitor.</p>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="text-center py-16 text-slate-400">
        <div className="text-5xl mb-4">📊</div>
        <p className="text-base font-semibold text-slate-600 mb-1">Not enough qualifying runs</p>
        <p className="text-sm">Need runs &gt;20 min with HR near {Math.round(hrmax * 0.87)} bpm (87% of your HRmax {hrmax}).</p>
        <p className="text-xs mt-2">Try extending the time window or logging more steady-state aerobic runs.</p>
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
      msg: `LT2 pace improved ${Math.abs(trendDelta)}s/km over this period. Consistent aerobic and threshold work is producing measurable adaptations.` },
    stable:    { color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200',     arrow: '→',
      msg: `LT2 pace is stable (±5s/km). Consider adding structured tempo intervals (20–40 min at LT2 pace) to stimulate further adaptation.` },
    worsening: { color: 'text-red-600',     bg: 'bg-red-50 border-red-200',         arrow: '↓',
      msg: `LT2 pace has slowed ${Math.abs(trendDelta)}s/km. This can reflect accumulated fatigue, reduced training load, or illness. Prioritise recovery and base aerobic volume.` },
  };

  const PaceTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs space-y-0.5">
        <p className="font-bold text-slate-700">{d.label}</p>
        <p className="text-blue-600 font-semibold">LT2: {formatPace(d.lt2pace)}/km</p>
        {d.lt1pace && <p className="text-sky-500">LT1: {formatPace(d.lt1pace)}/km</p>}
        <p className="text-slate-400">{d.count} run{d.count !== 1 ? 's' : ''} · confidence {d.confidence}/3</p>
      </div>
    );
  };

  const lt2HR  = Math.round(hrmax * LT2_TARGET_PCT);
  const lt1HR  = Math.round(hrmax * LT1_TARGET_PCT);

  return (
    <div className="space-y-6">

      {/* ── Stat row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">HRmax (observed)</p>
          <p className="text-2xl font-black text-slate-800 tabular-nums">{hrmax} <span className="text-sm font-semibold text-slate-400">bpm</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">from all your activities</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">LT2 Pace</p>
          <p className="text-2xl font-black text-blue-600 tabular-nums">{formatPace(currentLT2)}<span className="text-sm font-semibold text-slate-400">/km</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">at ~{lt2HR} bpm (87% HRmax)</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">LT1 Pace</p>
          <p className="text-2xl font-black text-sky-500 tabular-nums">{formatPace(currentLT1)}<span className="text-sm font-semibold text-slate-400">/km</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">at ~{lt1HR} bpm (77% HRmax)</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Tendencia</p>
          {trendDelta !== null ? (
            <>
              <p className={`text-2xl font-black tabular-nums ${trendConfig[trendStatus].color}`}>
                {trendConfig[trendStatus].arrow} {Math.abs(trendDelta)}s/km
              </p>
              <p className={`text-[10px] font-semibold mt-0.5 ${trendConfig[trendStatus].color}`}>
                {trendStatus === 'improving' ? 'Mejorando' : trendStatus === 'worsening' ? 'Empeorando' : 'Estable'}
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
          <SelectItem value="3">3 meses</SelectItem>
          <SelectItem value="6">6 meses</SelectItem>
          <SelectItem value="12">12 meses</SelectItem>
          <SelectItem value="24">24 meses</SelectItem>
        </Select>
        <span className="text-xs text-slate-400">{monthlyData.length} mes{monthlyData.length !== 1 ? 'es' : ''} con datos</span>
      </div>

      {/* ── LT2 trend chart ── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">Evolución del Umbral de Lactato (LT2)</Title>
        <Text className="text-slate-500 text-sm mb-1">
          Ritmo estimado al 87% HRmax usando ponderación gaussiana por proximidad al HR objetivo.
          La línea discontinua es el suavizado EWMA (λ=0.3).
        </Text>
        <Text className="text-slate-400 text-xs mb-4">
          Eje Y invertido: valores más arriba = ritmo más rápido.
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
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-blue-300" /> LT2 por carrera</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-blue-600" style={{borderTop:'2px dashed #2563eb',background:'none'}} /> EWMA suavizado</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-sky-400" /> LT1 (umbral aeróbico)</span>
        </div>
      </Card>

      {/* ── Confidence bars ── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">Runs por mes en zona LT</Title>
        <Text className="text-slate-500 text-sm mb-4">
          Más carreras en zona = estimación más fiable. Barras coloreadas por nivel de confianza.
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
                      <p>{d.count} carrera{d.count !== 1 ? 's' : ''} en zona LT</p>
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
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-600" /> Alta confianza (3+)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-300" /> Media (2)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-100" /> Baja (1)</span>
        </div>
      </Card>

      {/* ── Trend interpretation ── */}
      {trendStatus && (
        <div className={`rounded-xl border p-4 ${trendConfig[trendStatus].bg}`}>
          <p className={`text-sm font-bold mb-1 ${trendConfig[trendStatus].color}`}>
            {trendConfig[trendStatus].arrow} {trendStatus === 'improving' ? 'LT2 mejorando' : trendStatus === 'worsening' ? 'LT2 empeorando' : 'LT2 estable'}
          </p>
          <p className="text-sm text-slate-700">{trendConfig[trendStatus].msg}</p>
        </div>
      )}

      {/* ── Zone reference ── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">Zonas de referencia (tu HRmax: {hrmax} bpm)</Title>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { name: 'LT1 — Umbral aeróbico', pct: '74–80%', hr: `${Math.round(hrmax*0.74)}–${Math.round(hrmax*0.80)} bpm`, pace: currentLT1 ? formatPace(currentLT1) : '—', color: 'border-sky-300 bg-sky-50',
              desc: 'Límite superior del entrenamiento aeróbico base. Por debajo hay poco estrés metabólico; encima, empieza la acumulación de lactato.' },
            { name: 'LT2 — Umbral anaeróbico (MLSS)', pct: '85–89%', hr: `${Math.round(hrmax*0.85)}–${Math.round(hrmax*0.89)} bpm`, pace: currentLT2 ? formatPace(currentLT2) : '—', color: 'border-blue-400 bg-blue-50',
              desc: 'Máxima intensidad sostenible en estado estacionario de lactato. El ritmo "tempo" ideal. Mejorarlo es el objetivo principal de la periodización.' },
          ].map(z => (
            <div key={z.name} className={`rounded-xl border-2 p-4 ${z.color}`}>
              <p className="text-xs font-bold text-slate-700 mb-0.5">{z.name}</p>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-lg font-black text-slate-800 tabular-nums">{z.pace}<span className="text-xs font-semibold text-slate-400">/km</span></span>
                <span className="text-xs text-slate-500">{z.hr} · {z.pct} HRmax</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">{z.desc}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Methodology ── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">Metodología</Title>
        <div className="space-y-2 text-sm text-slate-600">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'HRmax observado', desc: 'Máximo de max_heartrate en todas tus actividades. Más preciso que cualquier fórmula de edad (error ±10 bpm en Tanaka 2001 vs. dato real).' },
              { label: 'Ponderación gaussiana', desc: 'Cada carrera contribuye proporcionalmente a lo cerca que está su HR del objetivo (87% HRmax). Rutas con desnivel > 10 m/km se ponderan al 40%.' },
              { label: 'Suavizado EWMA (λ=0.3)', desc: 'Media ponderada exponencial para filtrar ruido mes a mes. Las semanas más recientes tienen más peso. Evita que un outlier distorsione la tendencia.' },
            ].map(z => (
              <div key={z.label} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <p className="text-xs font-semibold text-slate-700 mb-1">{z.label}</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{z.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            <span className="font-semibold">Referencias:</span>{' '}
            Faude et al. (2009) <em>Sports Med</em> 39(6):469–490 ·
            Kindermann et al. (1979) <em>Eur J Appl Physiol</em> ·
            Hofmann & Tschakert (2017) <em>Front Physiol</em> 8:337 ·
            Stegmann & Kindermann (1982) <em>Int J Sports Med</em> 3(2):105–110 ·
            Tanaka et al. (2001) <em>JACC</em> 37(1):153–156.
          </p>
        </div>
      </Card>

    </div>
  );
}
