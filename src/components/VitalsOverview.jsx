import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import cloudStorage from '../lib/cloudStorage';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot,
} from "recharts";
import { motion } from "framer-motion";
import {
  HeartIcon, BoltIcon, ArrowTrendingUpIcon, ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { vo2FromRun } from '../lib/physiology';
import { efficiencyFactorRun } from '../lib/efficiencyFactor';
import useHrParams from '../hooks/useHrParams';
import { computeGarminStats } from '../lib/statusStats';
import { HeroCard } from './StatusCards';
import { scopeDays } from '../lib/timeScope';
import useTimeScope from '../hooks/useTimeScope';
import { TimeScopeSelector } from './TimeScope';
import { COLORS, AXIS_TICK } from '../lib/palette';
import ExpandableChart, { ExpandButton } from './ExpandableChart';

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
  let lo = 0, hi = 0, sum = 0, n = 0; // ventana deslizante [cur - windowDays, cur]
  for (let cur = pts[0].ms; cur <= endMs; d.setDate(d.getDate() + 1), cur = dayMs(d.getTime())) {
    const from = cur - windowDays * MS_DAY;
    while (hi < pts.length && pts[hi].ms <= cur) { sum += pts[hi].v; n++; hi++; }
    while (lo < hi && pts[lo].ms < from) { sum -= pts[lo].v; n--; lo++; }
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

// Máximo y mínimo (con su fecha) de la serie suavizada → { max: {v, ms}, min: {v, ms} } | null
function extremesOf(data) {
  let max = null, min = null;
  for (const d of data) {
    if (d.smooth == null) continue;
    if (!max || d.smooth > max.v) max = { v: d.smooth, ms: d.ms };
    if (!min || d.smooth < min.v) min = { v: d.smooth, ms: d.ms };
  }
  return max ? { max, min } : null;
}

// Ticks equiespaciados para un eje temporal [a, b]
const evenTicks = (a, b, n = 9) =>
  b > a ? Array.from({ length: n + 1 }, (_, i) => Math.round(a + ((b - a) * i) / n)) : undefined;

// Período mínimo (días) para que cada granularidad produzca ≥2-3 puntos con sentido
const GRAN_MIN_DAYS = { day: 0, week: 14, month: 90, year: 730 };

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
const SharedTooltip = ({ active, payload, unit, metric, avgLabel = "Media", inverted = false }) => {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  if (!pt || pt.ms == null) return null;
  const U = unit ? <span className="text-slate-500 font-medium ml-0.5">{unit}</span> : null;
  return (
    <div className="bg-white/95 backdrop-blur-xl border border-white/40 rounded-xl px-3 py-2 text-xs shadow-lg min-w-[150px]">
      <p className="font-semibold text-slate-500">{fmtDateFull(pt.ms)}</p>
      <p className="text-label font-bold uppercase text-slate-500 mb-1.5">
        {metric}
        {inverted && <span className="normal-case font-medium text-slate-500"> · eje invertido</span>}
      </p>
      {pt.smooth != null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">{avgLabel}</span>
          <span className="font-bold text-slate-900">{pt.smooth}{U}</span>
        </div>
      )}
      {pt.raw != null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500">Diario</span>
          <span className="font-semibold text-slate-600">{pt.raw}{U}</span>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Vista ampliada de un panel: eje Y ajustado a la media, máx/mín del rango en su
// punto exacto, referencias del histórico, selección de rango arrastrando y
// comparación con las otras métricas (apiladas o superpuestas).
// ---------------------------------------------------------------------------
const ACCENTS = {
  rose: { stroke: COLORS.risk, fill: "rgba(244,63,94,0.10)", chip: "bg-rose-50 text-rose-600", icon: "bg-rose-50 text-rose-500" },
  emerald: { stroke: COLORS.good, fill: "rgba(16,185,129,0.10)", chip: "bg-emerald-50 text-emerald-600", icon: "bg-emerald-50 text-emerald-500" },
  violet: { stroke: COLORS.seriesViolet, fill: "rgba(139,92,246,0.10)", chip: "bg-violet-50 text-violet-600", icon: "bg-violet-50 text-violet-500" },
  amber: { stroke: COLORS.caution, fill: "rgba(245,158,11,0.10)", chip: "bg-amber-50 text-amber-600", icon: "bg-amber-50 text-amber-500" },
  sky: { stroke: COLORS.seriesSky, fill: "rgba(14,165,233,0.10)", chip: "bg-sky-50 text-sky-600", icon: "bg-sky-50 text-sky-500" },
  indigo: { stroke: COLORS.seriesIndigo, fill: "rgba(99,102,241,0.10)", chip: "bg-indigo-50 text-indigo-600", icon: "bg-indigo-50 text-indigo-500" },
};

// Une varias series por timestamp en filas { ms, <key>_smooth, <key>_raw }.
// Todas comparten la misma rejilla (día a medianoche / inicio de bucket), así
// que los puntos de distintas métricas caen en la misma fila.
function mergeRows(series) {
  const m = new Map();
  for (const s of series) {
    for (const d of s.data) {
      let r = m.get(d.ms);
      if (!r) { r = { ms: d.ms }; m.set(d.ms, r); }
      r[`${s.key}_smooth`] = d.smooth;
      r[`${s.key}_raw`] = d.raw;
    }
  }
  return [...m.values()].sort((a, b) => a.ms - b.ms);
}

// Estadísticas y escala Y de una serie dentro del rango visible.
function seriesView(s, xDomain, { fitRaw, histScale }) {
  const visible = s.data.filter((d) => d.ms >= xDomain[0] && d.ms <= xDomain[1]);
  const vals = visible.map((d) => d.smooth).filter((v) => v != null);
  const yVals = [...vals];
  if (fitRaw) visible.forEach((d) => { if (d.raw != null) yVals.push(d.raw); });
  if (histScale && s.history) yVals.push(s.history.max.v, s.history.min.v);
  const lo = yVals.length ? Math.min(...yVals) : 0;
  const hi = yVals.length ? Math.max(...yVals) : 1;
  const pad = Math.max((hi - lo) * 0.08, Math.pow(10, -s.decimals));
  return {
    ...s,
    stroke: ACCENTS[s.accent].stroke,
    range: extremesOf(visible),
    mean: vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null,
    n: vals.length,
    hasRaw: visible.some((d) => d.raw != null),
    yDomain: [lo - pad, hi + pad],
    fmt: (v) => (v == null ? "—" : v.toFixed(s.decimals)),
  };
}

const CompareTooltip = ({ active, payload, series }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row || row.ms == null) return null;
  return (
    <div className="bg-white/95 backdrop-blur-xl border border-slate-200/60 rounded-xl px-3 py-2 text-xs shadow-lg min-w-[180px] space-y-1">
      <p className="font-semibold text-slate-500">{fmtDateFull(row.ms)}</p>
      {series.map((s) => {
        const v = row[`${s.key}_smooth`];
        const r = row[`${s.key}_raw`];
        if (v == null && r == null) return null;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.stroke }} />
              {s.title}
            </span>
            <span className="font-bold text-slate-900 tabular-nums">
              {s.fmt(v)}
              {r != null && <span className="font-normal text-slate-500"> · día {s.fmt(r)}</span>}
              <span className="font-medium text-slate-500 ml-0.5">{s.unit}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
};

// Elementos Recharts de una serie sobre su propio eje Y (yAxisId = key).
function seriesLayer(s, { axis, showHist, gradient, compact, guides = true }) {
  const id = s.key;
  const inY = (v) => v >= s.yDomain[0] && v <= s.yDomain[1];
  const fs = compact ? 10 : 12;
  const els = [
    <YAxis
      key={`${id}-y`} yAxisId={id} domain={s.yDomain} allowDataOverflow reversed={s.invertY}
      hide={axis === "hidden"} orientation={axis === "right" ? "right" : "left"}
      tick={{ ...AXIS_TICK, fill: s.stroke }} axisLine={false} tickLine={false}
      width={s.decimals > 0 ? 44 : 36} tickCount={compact ? 4 : 8}
      allowDecimals={s.decimals > 0} tickFormatter={(v) => v.toFixed(s.decimals)}
    />,
  ];
  if (showHist && s.history && inY(s.history.max.v)) {
    els.push(
      <ReferenceLine key={`${id}-hmax`} yAxisId={id} y={s.history.max.v} stroke={COLORS.inkMuted} strokeDasharray="6 4" strokeOpacity={0.7}
        label={{ value: `máx histórico ${s.fmt(s.history.max.v)} · ${fmtDateFull(s.history.max.ms)}`, position: s.invertY ? "insideBottomLeft" : "insideTopLeft", fontSize: 11, fill: COLORS.inkMuted }} />,
    );
  }
  if (showHist && s.history && s.history.min.v !== s.history.max.v && inY(s.history.min.v)) {
    els.push(
      <ReferenceLine key={`${id}-hmin`} yAxisId={id} y={s.history.min.v} stroke={COLORS.inkMuted} strokeDasharray="6 4" strokeOpacity={0.7}
        label={{ value: `mín histórico ${s.fmt(s.history.min.v)} · ${fmtDateFull(s.history.min.ms)}`, position: s.invertY ? "insideTopLeft" : "insideBottomLeft", fontSize: 11, fill: COLORS.inkMuted }} />,
    );
  }
  if (s.range && guides) {
    els.push(<ReferenceLine key={`${id}-rmax`} yAxisId={id} y={s.range.max.v} stroke={s.stroke} strokeDasharray="2 4" strokeOpacity={0.45} />);
    if (s.range.min.v !== s.range.max.v) {
      els.push(<ReferenceLine key={`${id}-rmin`} yAxisId={id} y={s.range.min.v} stroke={s.stroke} strokeDasharray="2 4" strokeOpacity={0.45} />);
    }
  }
  if (s.mean != null && !compact) {
    els.push(
      <ReferenceLine key={`${id}-mean`} yAxisId={id} y={s.mean} stroke={s.stroke} strokeOpacity={0.25}
        label={{ value: `media ${s.fmt(s.mean)}`, position: "insideRight", fontSize: 11, fill: s.stroke, opacity: 0.8 }} />,
    );
  }
  els.push(
    <Area key={`${id}-smooth`} yAxisId={id} type="monotone" dataKey={`${id}_smooth`} name={s.title}
      stroke={s.stroke} strokeWidth={2.5} fill={gradient ? `url(#grad-x-${id})` : "none"}
      connectNulls dot={false} isAnimationActive={false} />,
    <Area key={`${id}-raw`} yAxisId={id} type="monotone" dataKey={`${id}_raw`} stroke={s.stroke} strokeWidth={0} fill="none"
      dot={{ r: 2, fill: s.stroke, fillOpacity: 0.3, strokeWidth: 0 }} activeDot={false} connectNulls={false} isAnimationActive={false} />,
  );
  if (s.range) {
    els.push(
      <ReferenceDot key={`${id}-dmax`} yAxisId={id} x={s.range.max.ms} y={s.range.max.v} r={compact ? 4 : 5} fill={s.stroke} stroke={COLORS.paper} strokeWidth={2}
        label={{ value: `máx ${s.fmt(s.range.max.v)} · ${fmtDate(s.range.max.ms)}`, position: s.invertY ? "bottom" : "top", fontSize: fs, fontWeight: 700, fill: s.stroke }} />,
    );
    if (s.range.min.ms !== s.range.max.ms) {
      els.push(
        <ReferenceDot key={`${id}-dmin`} yAxisId={id} x={s.range.min.ms} y={s.range.min.v} r={compact ? 4 : 5} fill={COLORS.paper} stroke={s.stroke} strokeWidth={2}
          label={{ value: `mín ${s.fmt(s.range.min.v)} · ${fmtDate(s.range.min.ms)}`, position: s.invertY ? "top" : "bottom", fontSize: fs, fontWeight: 700, fill: s.stroke }} />,
      );
    }
  }
  return els;
}

// Línea compacta de estadísticas de una serie (para las comparadas).
const SeriesStatsLine = ({ s }) => (
  <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs">
    <span className="flex items-center gap-1.5 font-bold text-slate-700">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.stroke }} />
      {s.title}
      {s.invertY && <span className="font-medium text-slate-500">(eje invertido)</span>}
    </span>
    <span className="text-slate-500 tabular-nums">
      máx <b className="text-slate-800">{s.fmt(s.range?.max.v)}</b>{s.range && ` · ${fmtDate(s.range.max.ms)}`}
    </span>
    <span className="text-slate-500 tabular-nums">
      mín <b className="text-slate-800">{s.fmt(s.range?.min.v)}</b>{s.range && ` · ${fmtDate(s.range.min.ms)}`}
    </span>
    <span className="text-slate-500 tabular-nums">media <b className="text-slate-800">{s.fmt(s.mean)}</b> {s.unit}</span>
    {s.history && (
      <span className="text-slate-400 tabular-nums">hist. {s.fmt(s.history.min.v)}–{s.fmt(s.history.max.v)}</span>
    )}
  </div>
);

function VitalExpanded({ metricKey, metrics, periodControls, domain, xFmt, bands, avgLabel }) {
  const [zoom, setZoom] = useState(null);         // [msA, msB] | null
  const [drag, setDrag] = useState(null);         // { a, b } mientras se arrastra
  const [scale, setScale] = useState("fit");      // 'fit' | 'hist'
  const [fitRaw, setFitRaw] = useState(false);    // incluir puntos diarios en la escala
  const [compare, setCompare] = useState([]);     // keys de métricas comparadas
  const [layout, setLayout] = useState("stack");  // 'stack' | 'overlay'

  const zoomFits = zoom && zoom[0] >= domain[0] && zoom[1] <= domain[1];
  const xDomain = zoomFits ? zoom : domain;
  const opts = { fitRaw, histScale: scale === "hist" };
  const primary = seriesView(metrics.find((m) => m.key === metricKey), xDomain, opts);
  const others = metrics.filter((m) => m.key !== metricKey);
  const compared = compare
    .map((k) => others.find((m) => m.key === k))
    .filter((m) => m && m.data.some((d) => d.smooth != null))
    .map((m) => seriesView(m, xDomain, opts));
  const all = [primary, ...compared];
  const rows = mergeRows(all).filter((r) => r.ms >= xDomain[0] && r.ms <= xDomain[1]);
  const overlay = layout === "overlay" && compared.length > 0;

  const msAt = (st) => {
    if (st?.activeLabel != null && !Number.isNaN(Number(st.activeLabel))) return Number(st.activeLabel);
    const i = Number(st?.activeTooltipIndex ?? st?.activeIndex);
    return Number.isInteger(i) ? rows[i]?.ms ?? null : null;
  };
  const endDrag = () => {
    if (drag && drag.a != null && drag.b != null && drag.a !== drag.b) {
      setZoom([Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)]);
    }
    setDrag(null);
  };
  const toggleCompare = (k) => setCompare((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  // Un gráfico con una o varias series (cada una con su eje Y). Todos comparten
  // syncId para que el cursor se mueva a la vez en los apilados.
  const chart = (series, { compact = false, showBands = false } = {}) => (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={rows}
        syncId="vitals-expanded"
        syncMethod="value"
        margin={{ top: compact ? 16 : 24, right: series.length > 1 ? 8 : 16, left: 4, bottom: 4 }}
        onMouseDown={(st) => { const ms = msAt(st); if (ms != null) setDrag({ a: ms, b: ms }); }}
        onMouseMove={(st) => { if (drag) { const ms = msAt(st); if (ms != null) setDrag((d) => d && { ...d, b: ms }); } }}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-x-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.stroke} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid yAxisId={series[0].key} strokeDasharray="3 3" stroke={COLORS.hairlineSoft} vertical={false} />
        <XAxis
          dataKey="ms" type="number" scale="time" domain={xDomain} allowDataOverflow
          ticks={evenTicks(xDomain[0], xDomain[1], compact ? 6 : 10)} tickFormatter={xFmt}
          tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24}
        />
        {showBands && bands.map((b, i) => (
          <ReferenceArea key={`band-${i}`} yAxisId={series[0].key} x1={b.x1} x2={b.x2} fill={COLORS.good} fillOpacity={0.08} ifOverflow="hidden" />
        ))}
        <Tooltip
          content={<CompareTooltip series={all} />}
          cursor={drag ? false : { stroke: COLORS.inkMuted, strokeWidth: 1.5, strokeDasharray: "4 4" }}
        />
        {series.flatMap((s, i) => seriesLayer(s, {
          axis: i === 0 ? "left" : i === 1 ? "right" : "hidden",
          showHist: i === 0,
          gradient: i === 0,
          guides: i === 0,
          compact,
        }))}
        {drag && drag.a !== drag.b && (
          <ReferenceArea yAxisId={series[0].key} x1={Math.min(drag.a, drag.b)} x2={Math.max(drag.a, drag.b)}
            fill={COLORS.inkMuted} fillOpacity={0.12} stroke={COLORS.inkMuted} strokeOpacity={0.4} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );

  const pill = (on) => `px-2 py-0.5 rounded-md text-xs font-semibold transition-all ${on ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`;
  const inPrimaryY = (v) => v >= primary.yDomain[0] && v <= primary.yDomain[1];
  const { range, history, fmt } = primary;
  // Cifra + fecha en una línea: las estadísticas van resumidas para dejar sitio al gráfico.
  const num = (v) => <b className="text-slate-900 tabular-nums">{fmt(v)}</b>;
  const histOff = history && (!inPrimaryY(history.min.v) || !inPrimaryY(history.max.v));

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Barra única: período, escala, comparación y rango */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {periodControls}
        <span className="w-px h-5 bg-slate-200" />
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          <button className={pill(scale === "fit")} onClick={() => setScale("fit")}>Ajustada</button>
          {history && <button className={pill(scale === "hist")} onClick={() => setScale("hist")} title="Incluir el histórico en la escala">Histórico</button>}
        </div>
        {all.some((s) => s.hasRaw) && (
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none" title="Ajustar la escala a los puntos diarios">
            <input type="checkbox" className="w-3.5 h-3.5" style={{ accentColor: primary.stroke }} checked={fitRaw} onChange={(e) => setFitRaw(e.target.checked)} />
            Diarios
          </label>
        )}
        <span className="w-px h-5 bg-slate-200" />
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs font-semibold text-slate-500">Comparar:</span>
          {others.map((m) => {
            const on = compare.includes(m.key);
            const empty = !m.data.some((d) => d.smooth != null);
            const c = ACCENTS[m.accent].stroke;
            return (
              <button
                key={m.key}
                onClick={() => toggleCompare(m.key)}
                disabled={empty}
                aria-pressed={on}
                title={empty ? "Sin datos en este período" : undefined}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border transition-all ${
                  on ? "bg-white shadow-sm" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                style={on ? { borderColor: c, color: c } : undefined}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: on ? c : COLORS.hairline }} />
                {m.title}
              </button>
            );
          })}
        </div>
        {compared.length > 0 && (
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            <button className={pill(layout === "stack")} onClick={() => setLayout("stack")}>Apilados</button>
            <button className={pill(layout === "overlay")} onClick={() => setLayout("overlay")}>Superpuestos</button>
          </div>
        )}
        {zoomFits && (
          <button onClick={() => setZoom(null)} className="px-2 py-0.5 rounded-md text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100">
            Restablecer rango
          </button>
        )}
      </div>

      {/* Estadísticas de la métrica principal en una línea: rango visible vs histórico */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-slate-500 px-1">
        <span className="font-semibold text-slate-600">
          {zoomFits ? "Rango" : "Período"} {fmtDateFull(xDomain[0])} – {fmtDateFull(xDomain[1])}
        </span>
        {range && <span>máx {num(range.max.v)} {primary.unit} · {fmtDate(range.max.ms)}</span>}
        {range && <span>mín {num(range.min.v)} {primary.unit} · {fmtDate(range.min.ms)}</span>}
        <span>{avgLabel.toLowerCase()} {num(primary.mean)} {primary.unit}</span>
        {history && (
          <span
            className="text-slate-400"
            title={`Máx histórico ${fmt(history.max.v)} (${fmtDateFull(history.max.ms)}) · mín histórico ${fmt(history.min.v)} (${fmtDateFull(history.min.ms)})`}
          >
            histórico {fmt(history.min.v)}–{fmt(history.max.v)} {primary.unit}{histOff ? " · fuera de escala" : ""}
          </span>
        )}
        <span className="ml-auto text-slate-400">Arrastra sobre el gráfico para seleccionar un rango</span>
      </div>

      {/* Gráficos */}
      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto select-none cursor-crosshair">
        {overlay ? (
          <>
            <div className="flex flex-col gap-1 px-1">
              {compared.map((s) => <SeriesStatsLine key={s.key} s={s} />)}
            </div>
            <div className="flex-1 min-h-[240px]">{chart(all, { showBands: true })}</div>
          </>
        ) : (
          <>
            <div className={`${compared.length ? "flex-[1.4]" : "flex-1"} min-h-[220px]`}>
              {chart([primary], { showBands: true })}
            </div>
            {compared.map((s) => (
              <div key={s.key} className="flex-1 min-h-[160px] flex flex-col border-t border-slate-100 pt-2">
                <div className="px-1 mb-1"><SeriesStatsLine s={s} /></div>
                <div className="flex-1 min-h-0">{chart([s], { compact: true })}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function VitalPanel({ title, subtitle, icon: Icon, accent, data, unit, current, trend, trendInverse, domain, ticks, refValue, decimals = 0, yPad = 2, xFmt = fmtDate, bands = [], avgLabel = "Media", invertY = false, metricKey, metrics = [], periodControls = null }) {
  const A = ACCENTS[accent];

  const vals = data.map((d) => d.smooth).filter((v) => v != null);
  const maxV = vals.length ? Math.max(...vals) : null;
  const minV = vals.length ? Math.min(...vals) : null;

  let trendBadge = null;
  // Umbral = mínimo cambio visible con esos decimales (con 0 decimales, <0.5 se mostraría como "0")
  const trendThreshold = decimals > 0 ? Math.pow(10, -decimals) : 0.5;
  if (trend != null && Math.abs(trend) >= trendThreshold) {
    const up = trend > 0;
    const good = trendInverse ? !up : up;
    trendBadge = (
      <span className={`text-xs font-bold px-2 py-0.5 rounded-md ring-1 ${good ? "text-emerald-600 bg-emerald-50 ring-emerald-500/20" : "text-rose-600 bg-rose-50 ring-rose-500/20"}`}>
        {up ? "↗" : "↘"} {Math.abs(trend).toFixed(decimals)}
      </span>
    );
  }

  const hasData = data.some((d) => d.smooth != null || d.raw != null);
  // `?focus=<metricKey>` (desde las tarjetas de la portada) abre este panel ya
  // ampliado; al cerrarlo se quita de la URL para que recargar no lo reabra.
  const [searchParams, setSearchParams] = useSearchParams();
  const [expanded, setExpandedState] = useState(() => !!metricKey && searchParams.get('focus') === metricKey);
  const setExpanded = (o) => {
    setExpandedState(o);
    if (!o && searchParams.has('focus')) {
      setSearchParams((sp) => { sp.delete('focus'); return sp; }, { replace: true });
    }
  };

  const currentValue = current != null && (
    <span className="text-2xl font-extrabold tracking-tight text-slate-900">
      {current}
      {unit && <span className="text-xs font-semibold text-slate-500 ml-0.5">{unit}</span>}
    </span>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${A.icon}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-800 leading-tight truncate">{title}</h3>
            <p className="text-xs text-slate-500 truncate">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-baseline gap-2 shrink-0">
          {currentValue}
          {trendBadge}
          {bands.length > 0 && (
            <span
              title="Franja verde: tramos con eficiencia aeróbica ≥ 85 % de tu máximo histórico"
              className="self-center w-3 h-3 rounded bg-emerald-500/20 ring-1 ring-emerald-500/30 shrink-0 cursor-help"
            />
          )}
          {hasData && <ExpandButton onClick={() => setExpanded(true)} className="self-center" />}
        </div>
      </div>

      <ExpandableChart
        className="h-[160px] -ml-2"
        trigger="none"
        open={expanded}
        onOpenChange={setExpanded}
        title={title}
        subtitle={subtitle}
        toolbar={<div className="flex items-baseline gap-2">{currentValue}{trendBadge}</div>}
        expandedContent={hasData && (
          <VitalExpanded metricKey={metricKey} metrics={metrics} periodControls={periodControls} domain={domain} xFmt={xFmt} bands={bands} avgLabel={avgLabel} />
        )}
      >
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} syncId="vitals" syncMethod="value">
              <defs>
                <linearGradient id={`grad-${accent}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={A.stroke} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={A.stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.hairlineSoft} vertical={false} />
              {bands.map((b, i) => (
                <ReferenceArea key={i} x1={b.x1} x2={b.x2} fill={COLORS.good} fillOpacity={0.12} ifOverflow="hidden" />
              ))}
              <XAxis
                dataKey="ms"
                type="number"
                scale="time"
                domain={domain}
                ticks={ticks}
                allowDataOverflow
                tickFormatter={xFmt}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                minTickGap={20}
              />
              <YAxis
                domain={[`dataMin - ${yPad}`, `dataMax + ${yPad}`]}
                reversed={invertY}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={decimals > 0 ? 40 : 34}
                allowDecimals={decimals > 0}
                tickFormatter={(v) => v.toFixed(decimals)}
              />
              <Tooltip
                content={<SharedTooltip unit={unit} metric={title} avgLabel={avgLabel} inverted={invertY} />}
                cursor={{ stroke: COLORS.inkMuted, strokeWidth: 1.5, strokeDasharray: "4 4" }}
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
                  label={{ value: `máx ${maxV}`, position: "insideTopRight", fontSize: 11, fill: A.stroke, opacity: 0.8 }}
                />
              )}
              {minV != null && minV !== maxV && (
                <ReferenceLine
                  y={minV}
                  stroke={A.stroke}
                  strokeDasharray="2 4"
                  strokeOpacity={0.35}
                  label={{ value: `mín ${minV}`, position: "insideBottomRight", fontSize: 11, fill: A.stroke, opacity: 0.8 }}
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
          <div className="h-full flex items-center justify-center text-xs text-slate-500">Sin datos en este período</div>
        )}
      </ExpandableChart>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function VitalsOverview({ activities = [] }) {
  // Período compartido (lib/timeScope): el control vive en la barra superior.
  // "Todo" no tiene días: se usa un tope que cubre cualquier histórico.
  const [scope] = useTimeScope();
  const days = scopeDays(scope) ?? 99999;
  // La granularidad elegida se RESPETA, pero si el período no da para ella se
  // pinta diaria: se deriva en vez de reescribir la elección, así que al volver
  // a un período largo reaparece la que tenías.
  const [granPick, setGran] = useState("day"); // day | week | month | year
  const gran = days >= GRAN_MIN_DAYS[granPick] ? granPick : "day";
  const [gapAdjust, setGapAdjust] = useState(false); // ajustar eficiencia por desnivel (GAP)
  // Extremo derecho de la ventana, estable por montaje: leerlo en cada render
  // movía el corte y hacía entrar y salir puntos según cuántas veces se repintara.
  const [nowMs] = useState(() => Date.now());

  const readGarmin = () => {
    try { return JSON.parse(cloudStorage.getItem("garmin_cardiac_data") || "null") || []; }
    catch { return []; }
  };
  const [garmin, setGarmin] = useState(readGarmin);
  useEffect(() => {
    const onUpdate = () => setGarmin(readGarmin());
    window.addEventListener("garmin-cardiac-updated", onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener("garmin-cardiac-updated", onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  // ── Calibración de FC: la MISMA que el resto de la app (override manual →
  //    detección → fórmula). Antes esta vista derivaba su propia FCmax (máximo
  //    bruto del histórico, sensible a un solo artefacto de banda) y su propia
  //    FCreposo (media de TODO el histórico Garmin, frente a la política de
  //    "medición más reciente"), así que el VO2max de aquí no podía coincidir
  //    con el de la pestaña de VO2max. Ver bloque G1 de la auditoría. ──
  const { hrmax, hrrest } = useHrParams(activities);


  // Medias de 7/28 días y récords históricos de FC reposo y recuperación. Las
  // tarjetas de arriba cuentan la TENDENCIA; esto cuenta contra qué se compara,
  // que es lo único que la vista "Mi Estado" tenía y aquí faltaba (su gráfico era
  // el mismo que estos paneles, con otro color).
  const garminRecords = useMemo(
    () => computeGarminStats(garmin, { now: nowMs }),
    [garmin, nowMs],
  );

  const { hrvData, hrData, vo2Data, effData, domain, summary, hasGarmin, goodBands, effThreshold, history } = useMemo(() => {
    const now = nowMs;
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

    // Histórico completo (misma granularidad y suavizado) para los máx/mín de la vista ampliada
    const gAll = garmin.map((d) => ({ ms: new Date(d.date).getTime(), hrv: d.hrv ?? null, rhr: d.restingHR ?? null }));
    const hrvHist = extremesOf(series(gAll.filter((d) => d.hrv != null).map((d) => ({ ms: d.ms, v: d.hrv })), 7));
    const rhrHist = extremesOf(series(gAll.filter((d) => d.rhr != null).map((d) => ({ ms: d.ms, v: d.rhr })), 7));

    // ── VO2max submáximo (proxy de eficiencia) desde los runs de Strava ──
    // FCmax / FCreposo vienen de useHrParams (detectMaxHR / detectRestHR), no de
    // estimadores propios de esta vista.

    const runsAll = activities
      .filter((a) => a.average_heartrate >= 90 && a.average_speed >= 1.5 && (a.moving_time || 0) >= 600)
      .map((a) => {
        const v = vo2FromRun(a.average_speed, a.average_heartrate, hrrest, hrmax);
        return v ? { ms: new Date(a.start_date).getTime(), v } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.ms - b.ms);
    const runs = runsAll.filter((r) => r.ms >= cutoff);

    const vo2Data = series(runs, 28); // ~4-week rolling fitness en diario
    const vo2Hist = extremesOf(series(runsAll, 28));

    // El CTL no se pinta aquí: su dueño es Carga › PMC.

    // ── Eficiencia aeróbica (metros por latido) ──
    // La definición vive en src/lib/efficiencyFactor.js: era la única de las seis
    // que había en la app que estaba bien (m/latido, solo km aeróbicos, ajustada
    // por desnivel) y ahora es la compartida. Ver la cabecera de ese módulo.
    const effRunsAll = activities
      .map((a) => {
        const v = efficiencyFactorRun(a, { maxObservedHr: hrmax, gapAdjust });
        return v == null ? null : { ms: new Date(a.start_date).getTime(), v: +v.toFixed(3) };
      })
      .filter(Boolean)
      .sort((a, b) => a.ms - b.ms);
    // Compute over full history (true "histórico"), then slice to the visible window
    const effDataAll = series(effRunsAll, 28, 2);
    const effData = effDataAll.filter((d) => d.ms >= cutoff);
    const effHist = extremesOf(effDataAll);

    // ── Banda "buena forma": eficiencia ≥ 90% del máximo histórico ──
    const effMax = effDataAll.reduce((m, d) => (d.smooth != null && d.smooth > m ? d.smooth : m), 0);
    const effThreshold = effMax > 0 ? +(effMax * 0.85).toFixed(2) : null;
    const goodBands = buildBands(effData, effThreshold);

    // El desacople no se pinta aquí: su dueño es Salud › Desacople (§4 del plan).

    // ── Shared X domain ──
    const allMs = [...hrvData, ...hrData, ...vo2Data, ...effData].map((d) => d.ms);
    const domain = allMs.length ? [Math.min(...allMs), Math.max(...allMs)] : [cutoff, now];

    // ── Summary (current value + delta vs first half of period) ──
    // Último valor suavizado no nulo (las series densificadas pueden acabar en hueco)
    const lastOf = (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i].smooth != null) return arr[i].smooth;
      return null;
    };
    // Delta 2ª mitad vs 1ª mitad, ignorando días sin datos (no cuentan como 0)
    const deltaOf = (arr, dec = 1) => {
      const vals = arr.map((d) => d.smooth ?? d.raw).filter((v) => v != null);
      if (vals.length < 4) return null;
      const mid = Math.floor(vals.length / 2);
      const a = vals.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
      const b = vals.slice(mid).reduce((s, v) => s + v, 0) / (vals.length - mid);
      return +(b - a).toFixed(dec);
    };

    return {
      hrvData, hrData, vo2Data, effData, domain, goodBands, effThreshold,
      history: { hrv: hrvHist, rhr: rhrHist, vo2: vo2Hist, eff: effHist },
      hasGarmin: garmin.length > 0,
      summary: {
        hrv: { current: lastOf(hrvData), trend: deltaOf(hrvData) },
        rhr: { current: lastOf(hrData), trend: deltaOf(hrData) },
        vo2: { current: lastOf(vo2Data), trend: deltaOf(vo2Data) },
        eff: { current: lastOf(effData), trend: deltaOf(effData, 2) },
      },
    };
  }, [garmin, activities, days, gran, gapAdjust, hrmax, hrrest, nowMs]);

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

  // Selector de granularidad: en la cabecera y repetido en la vista ampliada.
  const granSelector = (
    <div className="flex bg-slate-100 p-1 rounded-xl">
      {[
        { id: "day", label: "Diario" },
        { id: "week", label: "Semanal" },
        { id: "month", label: "Mensual" },
        { id: "year", label: "Anual" },
      ].map((gr) => {
        const enabled = days >= GRAN_MIN_DAYS[gr.id];
        return (
          <button
            key={gr.id}
            onClick={() => setGran(gr.id)}
            disabled={!enabled}
            title={enabled ? undefined : "Período demasiado corto para esta granularidad"}
            aria-pressed={gran === gr.id}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${gran === gr.id ? "bg-white text-blue-600 shadow-sm"
              : enabled ? "text-slate-500 hover:text-slate-700" : "text-slate-300 cursor-not-allowed"
              }`}
          >
            {gr.label}
          </button>
        );
      })}
    </div>
  );

  // Período (global, el mismo control que el de la cabecera de la app) y
  // granularidad, para cambiarlos sin cerrar la vista ampliada.
  const periodControls = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-label font-bold uppercase text-slate-500">Período</span>
      <TimeScopeSelector />
      {granSelector}
    </div>
  );

  // Las cuatro series, para que la vista ampliada de cada panel pueda
  // superponer o apilar las demás.
  const metrics = [
    { key: "hrv", title: "VFC", accent: "emerald", data: hrvData, history: history.hrv, unit: "ms", decimals: 0, invertY: false },
    { key: "rhr", title: "FC reposo", accent: "rose", data: hrData, history: history.rhr, unit: "ppm", decimals: 0, invertY: true },
    { key: "vo2", title: "VO₂max sub.", accent: "violet", data: vo2Data, history: history.vo2, unit: "ml/kg/min", decimals: 0, invertY: false },
    { key: "eff", title: "Eficiencia", accent: "sky", data: effData, history: history.eff, unit: "m/latido", decimals: 2, invertY: false },
  ];

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
            <p className="text-xs text-slate-500">VFC · FC reposo · VO₂max submáximo en paralelo</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {granSelector}

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
          metricKey="hrv"
          periodControls={periodControls}
          metrics={metrics}
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
          metricKey="rhr"
          periodControls={periodControls}
          metrics={metrics}
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
          title="VO₂max submáximo"
          subtitle={`Proxy de eficiencia aeróbica · no es la forma física · ${granLabel}`}
          icon={BoltIcon}
          accent="violet"
          data={vo2Data}
          metricKey="vo2"
          periodControls={periodControls}
          metrics={metrics}
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
          title="Eficiencia aeróbica"
          subtitle={`m/latido (EF) · ${effData.filter((d) => d.raw != null).length} carreras · km aeróbicos 70-85% FCmax, 1.os 75 min · ${gapAdjust ? "ajustado por desnivel (GAP), <4%" : "<1% desnivel"} · ${granLabel}`}
          icon={ArrowTrendingUpIcon}
          accent="sky"
          data={effData}
          metricKey="eff"
          periodControls={periodControls}
          metrics={metrics}
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
      </motion.div>

      {/* ── Registros de Garmin ──────────────────────────────────────────────
          Los paneles de arriba cuentan la tendencia; esto cuenta contra qué se
          compara: medias de 7 y 28 días y los récords histórico y del año.
          Venía de "Mi Estado", cuya única aportación real eran estos números —
          su gráfico repetía estos mismos paneles con otro color. ───────────── */}
      {garminRecords && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <HeroCard
            label="FC Reposo"
            value={garminRecords.currentRHR ?? '—'}
            unit="bpm"
            icon={HeartIcon}
            color={garminRecords.rhrAllTimeMin && garminRecords.currentRHR <= garminRecords.rhrAllTimeMin + 2 ? 'emerald'
              : garminRecords.rhr28avg && garminRecords.currentRHR > garminRecords.rhr28avg + 5 ? 'rose' : 'blue'}
            subRows={[
              { label: 'Media 7 días', value: garminRecords.rhr7avg ? `${garminRecords.rhr7avg.toFixed(1)} bpm` : '—' },
              { label: 'Media 28 días', value: garminRecords.rhr28avg ? `${garminRecords.rhr28avg.toFixed(1)} bpm` : '—' },
              { label: 'Mínimo histórico', value: garminRecords.rhrAllTimeMin ? `${garminRecords.rhrAllTimeMin} bpm` : '—' },
              { label: 'Mínimo este año', value: garminRecords.rhrYearMin ? `${garminRecords.rhrYearMin} bpm` : '—' },
            ]}
          />
          <HeroCard
            label={garminRecords.hasHRV ? 'VFC — RMSSD' : 'Body Battery'}
            value={garminRecords.currentRec != null ? (garminRecords.hasHRV ? `${Math.round(garminRecords.currentRec)}` : garminRecords.currentRec) : '—'}
            unit={garminRecords.hasHRV ? 'ms' : '/ 100'}
            icon={BoltIcon}
            color={garminRecords.hasHRV
              ? (garminRecords.hrvDeviation > 5 ? 'emerald' : garminRecords.hrvDeviation < -10 ? 'rose' : 'amber')
              : (garminRecords.currentRec >= 80 ? 'emerald' : garminRecords.currentRec >= 50 ? 'amber' : 'rose')}
            subRows={garminRecords.hasHRV ? [
              { label: 'vs baseline 60d', value: garminRecords.hrvDeviation != null ? `${garminRecords.hrvDeviation >= 0 ? '+' : ''}${garminRecords.hrvDeviation}%` : '—' },
              { label: 'Media 7 días', value: garminRecords.rec7avg ? `${Math.round(garminRecords.rec7avg)} ms` : '—' },
              { label: 'Media 28 días', value: garminRecords.rec28avg ? `${Math.round(garminRecords.rec28avg)} ms` : '—' },
              { label: 'Máximo histórico', value: garminRecords.recAllTimeMax ? `${Math.round(garminRecords.recAllTimeMax)} ms` : '—' },
              { label: 'Máximo este año', value: garminRecords.recYearMax ? `${Math.round(garminRecords.recYearMax)} ms` : '—' },
            ] : [
              { label: 'Mínimo hoy', value: garminRecords.currentBBLow != null ? `${garminRecords.currentBBLow}/100` : '—' },
              { label: 'Media 7 días', value: garminRecords.rec7avg ? `${garminRecords.rec7avg.toFixed(0)}/100` : '—' },
              { label: 'Media 28 días', value: garminRecords.rec28avg ? `${garminRecords.rec28avg.toFixed(0)}/100` : '—' },
              { label: 'Máximo histórico', value: garminRecords.recAllTimeMax ? `${garminRecords.recAllTimeMax}/100` : '—' },
            ]}
          />
        </div>
      )}

      <div className="flex flex-col items-center gap-1.5 px-4">
        {effThreshold != null && goodBands.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block w-4 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/30" />
            <span>
              Franja verde = eficiencia aeróbica ≥ 85 % de tu máximo histórico
              <span className="text-slate-500"> (≥ {effThreshold} m/latido)</span>. Mira cómo están el resto de métricas en esos tramos.
            </span>
          </div>
        )}
        <p className="text-xs text-slate-500 text-center">
          Las líneas punteadas marcan el máx/mín del período. Los ejes temporales están alineados para comparar tendencias. ↗/↘ indica el cambio respecto a la primera mitad.
        </p>
      </div>
    </div>
  );
}
