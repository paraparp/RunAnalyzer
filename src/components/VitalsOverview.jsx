import { useMemo, useState } from "react";
import cloudStorage from '../lib/cloudStorage';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import { motion } from "framer-motion";
import {
  HeartIcon, BoltIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon, ExclamationTriangleIcon, FireIcon,
} from "@heroicons/react/24/outline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MS_DAY = 86400000;
const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const fmtDate = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]}`;
};
const fmtDateFull = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
};

// Bucket a point's timestamp to the start of its day/week/month/year
function bucketStartMs(ms, gran) {
  const d = new Date(ms);
  if (gran === "week") {
    const day = d.getDay() || 7; // Mon=1..Sun=7
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day + 1);
    return d.getTime();
  }
  if (gran === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (gran === "year") return new Date(d.getFullYear(), 0, 1).getTime();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Average raw points [{ms, v}] into buckets → [{ms, smooth, raw:null}]
function aggregate(points, gran, decimals = 1) {
  const buckets = {};
  points.forEach((p) => {
    const key = bucketStartMs(p.ms, gran);
    if (!buckets[key]) buckets[key] = { sum: 0, n: 0 };
    buckets[key].sum += p.v;
    buckets[key].n++;
  });
  return Object.entries(buckets)
    .map(([key, b]) => ({ ms: +key, smooth: +(b.sum / b.n).toFixed(decimals), raw: null }))
    .sort((a, b) => a.ms - b.ms);
}

// Floor a timestamp to local midnight (unifies the day basis across all series)
function dayMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Average points [{ms,v}] that fall on the same local day → sorted [{ms(day), v}]
function mergeByDay(points) {
  const m = {};
  points.forEach((p) => {
    const k = dayMs(p.ms);
    if (!m[k]) m[k] = { s: 0, n: 0 };
    m[k].s += p.v;
    m[k].n++;
  });
  return Object.entries(m)
    .map(([k, x]) => ({ ms: +k, v: x.s / x.n }))
    .sort((a, b) => a.ms - b.ms);
}

// Expand sparse points into a continuous daily grid with a trailing rolling mean.
// Every day gets a point (ms at local midnight) so cross-chart hover sync always matches.
// raw = that day's actual value (or null); smooth = trailing-window mean (or null).
function densifyDaily(points, windowDays, dec = 1) {
  const pts = mergeByDay(points);
  if (!pts.length) return [];
  const rawMap = new Map(pts.map((p) => [p.ms, p.v]));
  const out = [];
  const endMs = pts[pts.length - 1].ms;
  const d = new Date(pts[0].ms);
  for (let cur = pts[0].ms; cur <= endMs; d.setDate(d.getDate() + 1), cur = dayMs(d.getTime())) {
    const from = cur - windowDays * MS_DAY;
    let sum = 0, n = 0;
    for (let i = pts.length - 1; i >= 0 && pts[i].ms >= from; i--) {
      if (pts[i].ms <= cur) { sum += pts[i].v; n++; }
    }
    out.push({
      ms: cur,
      raw: rawMap.has(cur) ? +rawMap.get(cur).toFixed(dec) : null,
      smooth: n ? +(sum / n).toFixed(dec) : null,
    });
  }
  return out;
}

// Contiguous time ranges where a series' smoothed value is >= threshold
function buildBands(data, threshold) {
  if (threshold == null) return [];
  const bands = [];
  let start = null;
  for (let i = 0; i < data.length; i++) {
    const ok = data[i].smooth != null && data[i].smooth >= threshold;
    if (ok && start == null) start = data[i].ms;
    if (!ok && start != null) { bands.push({ x1: start, x2: data[i].ms }); start = null; }
  }
  if (start != null) {
    const end = data[data.length - 1].ms;
    bands.push({ x1: start, x2: end > start ? end : start + 3 * MS_DAY });
  }
  return bands;
}

// Aerobic decoupling (Pa:HR drift) within a run: 2nd-half vs 1st-half HR/pace ratio.
// <5% = buena resistencia aeróbica (TrainingPeaks / Jones 2023). Necesita parciales (splits_metric).
function calcDecoupling(splits) {
  if (!splits || splits.length < 4) return null;
  const valid = splits.filter((s) => s.average_speed > 0 && s.average_heartrate > 0 && s.distance > 500);
  if (valid.length < 4) return null;
  const mid = Math.floor(valid.length / 2);
  const ratio = (arr) =>
    arr.reduce((s, sp) => s + sp.average_heartrate / (1000 / (sp.average_speed * 60)), 0) / arr.length;
  const r1 = ratio(valid.slice(0, mid));
  const r2 = ratio(valid.slice(mid));
  return r1 === 0 ? null : ((r2 - r1) / r1) * 100;
}

// Minetti (2002) energy cost of running vs gradient → flat-equivalent speed factor.
// i = gradient as fraction (gain/distance). factor = C(i)/C(0); >1 uphill (would run faster on flat).
function minettiFactor(i) {
  const g = Math.max(0, Math.min(i, 0.30)); // gain/distance is non-negativo; cap a 30%
  const C0 = 3.6;
  const C = 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
  return C / C0;
}

// Lightweight per-run VO2max estimate (HRR + %HRmax, same formulas as VO2max Tracker)
function oxygenCostLeger(vKmh) {
  return 2.209 + 3.163 * vKmh + 0.000525542 * vKmh * vKmh * vKmh;
}
function vo2FromRun(speedMs, hr, hrRest, hrMax) {
  if (!speedMs || !hr || hr < 90) return null;
  const vo2Running = oxygenCostLeger(speedMs * 3.6); // m/s → km/h
  // HRR (Swain-Leutholtz) when rest HR known, else %HRmax fallback
  if (hrRest && hrMax > hrRest) {
    const pctHRR = (hr - hrRest) / (hrMax - hrRest);
    if (pctHRR >= 0.35 && pctHRR <= 0.95) {
      const v = 3.5 + (vo2Running - 3.5) / pctHRR;
      if (v > 15 && v < 90) return v;
    }
  }
  if (hrMax) {
    const pctHRmax = hr / hrMax;
    if (pctHRmax >= 0.55 && pctHRmax <= 0.98) {
      const pctVO2 = 1.5286 * pctHRmax - 0.5286;
      if (pctVO2 > 0.2) {
        const v = vo2Running / pctVO2;
        if (v > 15 && v < 90) return v;
      }
    }
  }
  return null;
}

// Per-activity training load (same model as FitnessFatigue PMC)
function estimateLoad(a) {
  const mins = (a.moving_time || 0) / 60;
  if (a.average_heartrate) return mins * (a.average_heartrate / 180) * 1.92;
  if (a.distance) return (a.distance / 1000) * 0.8;
  return mins * 0.4;
}

// Daily CTL (chronic / accumulated training load) via 42-day EWMA over full history
function computeCTLSeries(activities) {
  if (!activities?.length) return [];
  const dailySS = {};
  let minDate = Infinity;
  activities.forEach((a) => {
    const dateStr = a.start_date?.split("T")[0];
    if (!dateStr) return;
    const ts = new Date(dateStr).getTime();
    if (ts < minDate) minDate = ts;
    dailySS[dateStr] = (dailySS[dateStr] || 0) + (a.suffer_score || estimateLoad(a));
  });
  if (minDate === Infinity) return [];

  const kCTL = Math.exp(-1 / 42);
  let ctl = 0;
  const out = [];
  for (let ts = minDate; ts <= Date.now(); ts += MS_DAY) {
    const dateStr = new Date(ts).toISOString().split("T")[0];
    const tss = dailySS[dateStr] || 0;
    ctl = ctl * kCTL + tss * (1 - kCTL);
    out.push({ ms: new Date(dateStr).getTime(), ctl: +ctl.toFixed(1), load: tss });
  }
  return out;
}

const PERIODS = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1A", days: 365 },
  { label: "3A", days: 1096 },
  { label: "Todo", days: 99999 },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
const SharedTooltip = ({ active, payload, unit, metric, avgLabel = "Media" }) => {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  if (!pt || pt.ms == null) return null;
  const U = unit ? <span className="text-slate-400 font-medium ml-0.5">{unit}</span> : null;
  return (
    <div className="bg-white/95 backdrop-blur-xl border border-white/40 rounded-xl px-3 py-2 text-xs shadow-lg min-w-[150px]">
      <p className="font-semibold text-slate-500">{fmtDateFull(pt.ms)}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{metric}</p>
      {pt.smooth != null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">{avgLabel}</span>
          <span className="font-bold text-slate-900">{pt.smooth}{U}</span>
        </div>
      )}
      {pt.raw != null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Diario</span>
          <span className="font-semibold text-slate-600">{pt.raw}{U}</span>
        </div>
      )}
    </div>
  );
};

function VitalPanel({ title, subtitle, icon: Icon, accent, data, unit, current, trend, trendInverse, domain, ticks, refValue, decimals = 0, yPad = 2, xFmt = fmtDate, bands = [], avgLabel = "Media", invertY = false }) {
  const A = {
    rose: { stroke: "#f43f5e", fill: "rgba(244,63,94,0.10)", chip: "bg-rose-50 text-rose-600", icon: "bg-rose-50 text-rose-500" },
    emerald: { stroke: "#10b981", fill: "rgba(16,185,129,0.10)", chip: "bg-emerald-50 text-emerald-600", icon: "bg-emerald-50 text-emerald-500" },
    violet: { stroke: "#8b5cf6", fill: "rgba(139,92,246,0.10)", chip: "bg-violet-50 text-violet-600", icon: "bg-violet-50 text-violet-500" },
    amber: { stroke: "#f59e0b", fill: "rgba(245,158,11,0.10)", chip: "bg-amber-50 text-amber-600", icon: "bg-amber-50 text-amber-500" },
    sky: { stroke: "#0ea5e9", fill: "rgba(14,165,233,0.10)", chip: "bg-sky-50 text-sky-600", icon: "bg-sky-50 text-sky-500" },
    indigo: { stroke: "#6366f1", fill: "rgba(99,102,241,0.10)", chip: "bg-indigo-50 text-indigo-600", icon: "bg-indigo-50 text-indigo-500" },
  }[accent];

  const vals = data.map((d) => d.smooth).filter((v) => v != null);
  const maxV = vals.length ? Math.max(...vals) : null;
  const minV = vals.length ? Math.min(...vals) : null;

  let trendBadge = null;
  const trendThreshold = decimals > 0 ? Math.pow(10, -decimals) : 0.1;
  if (trend != null && Math.abs(trend) >= trendThreshold) {
    const up = trend > 0;
    const good = trendInverse ? !up : up;
    trendBadge = (
      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ring-1 ${good ? "text-emerald-600 bg-emerald-50 ring-emerald-500/20" : "text-rose-600 bg-rose-50 ring-rose-500/20"}`}>
        {up ? "↗" : "↘"} {Math.abs(trend).toFixed(decimals)}
      </span>
    );
  }

  const hasData = data.some((d) => d.smooth != null || d.raw != null);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${A.icon}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800 leading-tight truncate">{title}</h3>
            <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-baseline gap-2 shrink-0">
          {current != null && (
            <span className="text-2xl font-extrabold tracking-tight text-slate-900">
              {current}
              {unit && <span className="text-xs font-semibold text-slate-400 ml-0.5">{unit}</span>}
            </span>
          )}
          {trendBadge}
        </div>
      </div>

      <div className="h-[160px] -ml-2">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} syncId="vitals" syncMethod="value">
              <defs>
                <linearGradient id={`grad-${accent}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={A.stroke} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={A.stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              {bands.map((b, i) => (
                <ReferenceArea key={i} x1={b.x1} x2={b.x2} fill="#10b981" fillOpacity={0.12} ifOverflow="hidden" />
              ))}
              <XAxis
                dataKey="ms"
                type="number"
                scale="time"
                domain={domain}
                ticks={ticks}
                allowDataOverflow
                tickFormatter={xFmt}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                minTickGap={20}
              />
              <YAxis
                domain={[`dataMin - ${yPad}`, `dataMax + ${yPad}`]}
                reversed={invertY}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                width={decimals > 0 ? 40 : 34}
                allowDecimals={decimals > 0}
                tickFormatter={(v) => v.toFixed(decimals)}
              />
              <Tooltip
                content={<SharedTooltip unit={unit} metric={title} avgLabel={avgLabel} />}
                cursor={{ stroke: "#64748b", strokeWidth: 1.5, strokeDasharray: "4 4" }}
              />
              {refValue != null && (
                <ReferenceLine y={refValue} stroke={A.stroke} strokeDasharray="4 4" strokeOpacity={0.4} />
              )}
              {maxV != null && (
                <ReferenceLine
                  y={maxV}
                  stroke={A.stroke}
                  strokeDasharray="2 4"
                  strokeOpacity={0.35}
                  label={{ value: `máx ${maxV}`, position: "insideTopRight", fontSize: 9, fill: A.stroke, opacity: 0.8 }}
                />
              )}
              {minV != null && minV !== maxV && (
                <ReferenceLine
                  y={minV}
                  stroke={A.stroke}
                  strokeDasharray="2 4"
                  strokeOpacity={0.35}
                  label={{ value: `mín ${minV}`, position: "insideBottomRight", fontSize: 9, fill: A.stroke, opacity: 0.8 }}
                />
              )}
              <Area
                type="monotone"
                dataKey="smooth"
                stroke={A.stroke}
                strokeWidth={2.5}
                fill={`url(#grad-${accent})`}
                connectNulls
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="raw"
                stroke={A.stroke}
                strokeWidth={0}
                fill="none"
                dot={{ r: 1.5, fill: A.stroke, fillOpacity: 0.25, strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">Sin datos en este período</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function VitalsOverview({ activities = [] }) {
  const [days, setDays] = useState(180);
  const [gran, setGran] = useState("day"); // day | week | month | year
  const [gapAdjust, setGapAdjust] = useState(false); // ajustar eficiencia por desnivel (GAP)

  const garmin = useMemo(() => {
    try { return JSON.parse(cloudStorage.getItem("garmin_cardiac_data") || "null") || []; }
    catch { return []; }
  }, []);

  // CTL runs over full history (EWMA needs the warm-up), filtered to the window below
  const ctlSeries = useMemo(() => computeCTLSeries(activities), [activities]);

  const { hrvData, hrData, vo2Data, loadData, effData, decData, domain, summary, hasGarmin, goodBands, effThreshold, hasDecoupling } = useMemo(() => {
    const now = Date.now();
    const cutoff = now - days * MS_DAY;
    const isDay = gran === "day";

    // Build display series from raw points [{ms,v}]:
    // - Diario: puntos crudos + línea de media móvil
    // - Semanal/Mensual/Anual: media de cada bucket (sin puntos crudos)
    const series = (pts, smoothWindow, dec = 1) =>
      isDay ? densifyDaily(pts, smoothWindow, dec) : aggregate(pts, gran, dec);

    // ── Garmin daily series (HRV / resting HR) ──
    const g = garmin
      .filter((d) => new Date(d.date).getTime() >= cutoff)
      .map((d) => ({ ms: new Date(d.date).getTime(), hrv: d.hrv ?? null, rhr: d.restingHR ?? null }))
      .sort((a, b) => a.ms - b.ms);

    const hrvPts = g.filter((d) => d.hrv != null).map((d) => ({ ms: d.ms, v: d.hrv }));
    const rhrPts = g.filter((d) => d.rhr != null).map((d) => ({ ms: d.ms, v: d.rhr }));
    const hrvData = series(hrvPts, 7);
    const hrData = series(rhrPts, 7);

    // ── VO2max trend (forma física) from Strava runs ──
    const allHr = garmin.filter((d) => d.restingHR).map((d) => d.restingHR);
    const hrRest = allHr.length ? Math.round(allHr.reduce((a, b) => a + b, 0) / allHr.length) : null;
    const maxObserved = activities.reduce((m, a) => Math.max(m, a.max_heartrate || 0), 0);
    const hrMax = maxObserved > 120 ? maxObserved : 190;

    const runs = activities
      .filter((a) => {
        const ms = new Date(a.start_date).getTime();
        return ms >= cutoff && a.average_heartrate >= 90 && a.average_speed >= 1.5 && (a.moving_time || 0) >= 600;
      })
      .map((a) => {
        const v = vo2FromRun(a.average_speed, a.average_heartrate, hrRest, hrMax);
        return v ? { ms: new Date(a.start_date).getTime(), v } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.ms - b.ms);

    const vo2Data = series(runs, 28); // ~4-week rolling fitness en diario

    // ── Carga de entrenamiento acumulada (CTL) — window slice of full series ──
    const ctlPts = ctlSeries.filter((d) => d.ms >= cutoff).map((d) => ({ ms: d.ms, v: d.ctl }));
    // CTL ya es una EWMA; en diario se muestra tal cual (ms a medianoche local para que el sync cuadre)
    const loadData = isDay
      ? ctlPts.map((p) => ({ ms: dayMs(p.ms), smooth: p.v, raw: null }))
      : aggregate(ctlPts, gran, 1);

    // ── Eficiencia aeróbica (metros por latido) ──
    // Normalizado: solo carreras aeróbicas (70-88% FCmax), llanas (<1% desnivel)
    // y de duración media (15-120 min) → descarta series, tempos y deriva de tiradas largas.
    // EF fiable solo en esfuerzo aeróbico sub-umbral (TrainingPeaks / Jones 2023):
    // por encima del umbral la relación pace/FC se rompe. Banda 70-85% FCmax.
    // Suelo de FCmax: la FC máx registrada por Strava infravalora la real si no haces
    // esfuerzos máximos → sin suelo, la zona excluiría rodajes normales a FC 145-155.
    const hrMaxZone = Math.max(maxObserved, 185);
    const zLow = hrMaxZone * 0.70;
    const zHigh = hrMaxZone * 0.85;
    const gradCap = gapAdjust ? 4 : 1; // GAP permite hasta 4% de desnivel medio; llano solo <1%
    const effRunsAll = activities
      .filter((a) => {
        if (!a.average_heartrate || a.average_heartrate < zLow || a.average_heartrate > zHigh) return false;
        if (!a.average_speed || a.average_speed < 1.5) return false;
        if (!a.distance || a.distance < 2000) return false;
        const dur = a.moving_time || 0;
        // 20-75 min: ventana donde la deriva cardíaca se mantiene <~5% (evidencia),
        // así el EF sale limpio sin corrección artificial por duración.
        if (dur < 1200 || dur > 4500) return false;
        const gradient = Math.abs((a.total_elevation_gain || 0) / a.distance) * 100;
        return gradient < gradCap;
      })
      .map((a) => {
        const gradeFrac = (a.total_elevation_gain || 0) / a.distance;
        const speed = gapAdjust ? a.average_speed * minettiFactor(gradeFrac) : a.average_speed;
        // m/latido = velocidad(m/s) · 60 / FC(ppm)
        return { ms: new Date(a.start_date).getTime(), v: +((speed * 60) / a.average_heartrate).toFixed(3) };
      })
      .sort((a, b) => a.ms - b.ms);
    // Compute over full history (true "histórico"), then slice to the visible window
    const effDataAll = series(effRunsAll, 28, 2);
    const effData = effDataAll.filter((d) => d.ms >= cutoff);

    // ── Banda "buena forma": eficiencia ≥ 90% del máximo histórico ──
    const effMax = effDataAll.reduce((m, d) => (d.smooth != null && d.smooth > m ? d.smooth : m), 0);
    const effThreshold = effMax > 0 ? +(effMax * 0.85).toFixed(2) : null;
    const goodBands = buildBands(effData, effThreshold);

    // ── Decoupling aeróbico (Pa:HR) — solo actividades con parciales (splits_metric) ──
    const decRuns = activities
      .filter((a) => {
        const ms = new Date(a.start_date).getTime();
        if (ms < cutoff) return false;
        if (!a.splits_metric || a.splits_metric.length < 4) return false;
        if (!a.average_heartrate || (a.moving_time || 0) < 1800) return false; // ≥30 min, estable
        return true;
      })
      .map((a) => {
        const dc = calcDecoupling(a.splits_metric);
        return dc == null ? null : { ms: new Date(a.start_date).getTime(), v: +dc.toFixed(2) };
      })
      .filter(Boolean)
      .sort((a, b) => a.ms - b.ms);
    const decData = series(decRuns, 28, 1);
    const hasDecoupling = decRuns.length > 0;

    // ── Shared X domain ──
    const allMs = [...hrvData, ...hrData, ...vo2Data, ...loadData, ...effData, ...decData].map((d) => d.ms);
    const domain = allMs.length ? [Math.min(...allMs), Math.max(...allMs)] : [cutoff, now];

    // ── Summary (current value + delta vs first half of period) ──
    const lastOf = (arr) => (arr.length ? arr[arr.length - 1].smooth : null);
    const deltaOf = (arr, dec = 1) => {
      if (arr.length < 4) return null;
      const mid = Math.floor(arr.length / 2);
      const a = arr.slice(0, mid).reduce((s, d) => s + (d.smooth ?? d.raw), 0) / mid;
      const b = arr.slice(mid).reduce((s, d) => s + (d.smooth ?? d.raw), 0) / (arr.length - mid);
      return +(b - a).toFixed(dec);
    };

    return {
      hrvData, hrData, vo2Data, loadData, effData, decData, domain, goodBands, effThreshold, hasDecoupling,
      hasGarmin: garmin.length > 0,
      summary: {
        hrv: { current: lastOf(hrvData), trend: deltaOf(hrvData) },
        rhr: { current: lastOf(hrData), trend: deltaOf(hrData) },
        vo2: { current: lastOf(vo2Data), trend: deltaOf(vo2Data) },
        load: { current: lastOf(loadData), trend: deltaOf(loadData) },
        eff: { current: lastOf(effData), trend: deltaOf(effData, 2) },
        dec: { current: lastOf(decData), trend: deltaOf(decData) },
      },
    };
  }, [garmin, activities, ctlSeries, days, gran, gapAdjust]);

  // X-axis label format depends on granularity
  const xFmt = useMemo(() => {
    if (gran === "year") return (ms) => String(new Date(ms).getFullYear());
    if (gran === "month") {
      return (ms) => { const d = new Date(ms); return `${MONTHS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
    }
    return fmtDate;
  }, [gran]);

  const granLabel = { day: "media móvil diaria", week: "media semanal", month: "media mensual", year: "media anual" }[gran];
  const avgLabel = { day: "Media móvil", week: "Media sem.", month: "Media mes", year: "Media año" }[gran];

  // Shared evenly-spaced ticks so the 5 axes line up exactly
  const xTicks = useMemo(() => {
    if (!domain || domain[0] == null || domain[1] <= domain[0]) return undefined;
    const [a, b] = domain;
    const N = 9;
    return Array.from({ length: N + 1 }, (_, i) => Math.round(a + ((b - a) * i) / N));
  }, [domain]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
            <ArrowTrendingUpIcon className="w-4 h-4 text-blue-500" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">Resumen Vital</h2>
            <p className="text-xs text-slate-400">VFC · FC reposo · Forma física en paralelo</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Granularity selector */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            {[
              { id: "day", label: "Diario" },
              { id: "week", label: "Semanal" },
              { id: "month", label: "Mensual" },
              { id: "year", label: "Anual" },
            ].map((gr) => (
              <button
                key={gr.id}
                onClick={() => setGran(gr.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${gran === gr.id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
              >
                {gr.label}
              </button>
            ))}
          </div>

          {/* Period selector */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${days === p.days ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* GAP toggle (afecta solo a Eficiencia aeróbica) */}
          <label
            title="Ajusta la eficiencia por desnivel (modelo de Minetti) e incluye rodajes de hasta 4% de pendiente. Aproximado: solo usa el desnivel medio."
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-white cursor-pointer select-none hover:border-sky-300 transition-colors"
          >
            <input
              type="checkbox"
              checked={gapAdjust}
              onChange={(e) => setGapAdjust(e.target.checked)}
              className="w-3.5 h-3.5 accent-sky-500"
            />
            <span className="text-xs font-semibold text-slate-600">Ajustar por desnivel</span>
          </label>
        </div>
      </div>

      {!hasGarmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-start gap-2">
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <span>
            No hay datos de Garmin para VFC y FC en reposo. Conéctate en <strong>Monitor Cardíaco</strong> para verlos aquí.
            La gráfica de forma física se calcula a partir de tus carreras de Strava.
          </span>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-4"
      >
        <VitalPanel
          title="VFC (HRV)"
          subtitle={`Variabilidad de frecuencia cardíaca · ${granLabel}`}
          icon={HeartIcon}
          accent="emerald"
          data={hrvData}
          unit="ms"
          current={summary.hrv.current}
          trend={summary.hrv.trend}
          domain={domain}
          ticks={xTicks}
          xFmt={xFmt}
          bands={goodBands}
          avgLabel={avgLabel}
        />
        <VitalPanel
          title="FC en reposo"
          subtitle={`Frecuencia cardíaca en reposo · eje invertido (arriba = mejor) · ${granLabel}`}
          icon={HeartIcon}
          accent="rose"
          data={hrData}
          unit="ppm"
          current={summary.rhr.current}
          trend={summary.rhr.trend}
          trendInverse
          invertY
          domain={domain}
          ticks={xTicks}
          xFmt={xFmt}
          bands={goodBands}
          avgLabel={avgLabel}
        />
        <VitalPanel
          title="Forma física"
          subtitle={`VO₂max estimado · ${granLabel}`}
          icon={BoltIcon}
          accent="violet"
          data={vo2Data}
          unit="ml/kg/min"
          current={summary.vo2.current}
          trend={summary.vo2.trend}
          domain={domain}
          ticks={xTicks}
          xFmt={xFmt}
          bands={goodBands}
          avgLabel={avgLabel}
        />
        <VitalPanel
          title="Carga acumulada"
          subtitle={`CTL · carga crónica de entrenamiento (EWMA 42 días, estándar)${gran === "day" ? "" : " · " + granLabel}`}
          icon={FireIcon}
          accent="amber"
          data={loadData}
          unit=""
          current={summary.load.current}
          trend={summary.load.trend}
          domain={domain}
          ticks={xTicks}
          xFmt={xFmt}
          bands={goodBands}
          avgLabel={avgLabel}
        />
        <VitalPanel
          title="Eficiencia aeróbica"
          subtitle={`m/latido (EF) · ${effData.filter((d) => d.raw != null).length} carreras · zona aeróbica 70-85% FCmax, 20-75 min · ${gapAdjust ? "ajustado por desnivel (GAP), <4%" : "<1% desnivel"} · ${granLabel}`}
          icon={ArrowTrendingUpIcon}
          accent="sky"
          data={effData}
          unit="m/latido"
          current={summary.eff.current}
          trend={summary.eff.trend}
          domain={domain}
          ticks={xTicks}
          xFmt={xFmt}
          bands={goodBands}
          avgLabel={avgLabel}
          decimals={2}
          yPad={0.1}
        />
        {hasDecoupling && (
          <VitalPanel
            title="Decoupling aeróbico"
            subtitle={`Deriva Pa:HR (2ª vs 1ª mitad) · solo carreras con parciales, ≥30 min · ${granLabel}`}
            icon={ArrowTrendingDownIcon}
            accent="indigo"
            data={decData}
            unit="%"
            current={summary.dec.current}
            trend={summary.dec.trend}
            trendInverse
            domain={domain}
            ticks={xTicks}
            xFmt={xFmt}
            bands={goodBands}
            avgLabel={avgLabel}
            decimals={1}
            yPad={1}
            refValue={5}
          />
        )}
      </motion.div>

      <div className="flex flex-col items-center gap-1.5 px-4">
        {effThreshold != null && goodBands.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="inline-block w-4 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/30" />
            <span>
              Franja verde = eficiencia aeróbica ≥ 85 % de tu máximo histórico
              <span className="text-slate-400"> (≥ {effThreshold} m/latido)</span>. Mira cómo están el resto de métricas en esos tramos.
            </span>
          </div>
        )}
        {!hasDecoupling && (
          <p className="text-[11px] text-slate-400 text-center">
            El panel de <strong>decoupling</strong> aparecerá cuando tengas carreras con parciales cargados (expándelas en el listado del Dashboard).
          </p>
        )}
        <p className="text-[11px] text-slate-400 text-center">
          Las líneas punteadas marcan el máx/mín del período. Los ejes temporales están alineados para comparar tendencias. ↗/↘ indica el cambio respecto a la primera mitad.
        </p>
      </div>
    </div>
  );
}
