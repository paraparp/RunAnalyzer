import { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot,
} from "recharts";
import { COLORS, AXIS_TICK } from '../lib/palette';
import { ACCENTS, extremesOf, evenTicks, fmtDate, fmtDateFull, GRAN_MIN_DAYS } from '../lib/vitalSeries';

// Gráfico de exploración de métricas vitales, compartido por Resumen Vital y el
// Explorador de Salud. Las series vienen de `buildVitalMetrics` (lib/vitalSeries).

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

/**
 * Gráfico de exploración de una métrica: eje Y ajustado, máx/mín del rango en su
 * punto exacto, referencias del histórico, selección de rango arrastrando y
 * comparación con el resto de métricas (apiladas o superpuestas).
 *
 * Con `onMetricChange` muestra además el selector de la métrica principal.
 */
export default function MetricChart({ metricKey, onMetricChange, metrics, periodControls, domain, xFmt, bands = [], avgLabel }) {
  const [zoom, setZoom] = useState(null);         // [msA, msB] | null
  const [drag, setDrag] = useState(null);         // { a, b } mientras se arrastra
  const [scale, setScale] = useState("fit");      // 'fit' | 'hist'
  const [fitRaw, setFitRaw] = useState(false);    // incluir puntos diarios en la escala
  const [compare, setCompare] = useState([]);     // keys de métricas comparadas
  const [layout, setLayout] = useState("overlay");  // 'stack' | 'overlay'

  const hasData = (m) => m.data.some((d) => d.smooth != null);
  const zoomFits = zoom && zoom[0] >= domain[0] && zoom[1] <= domain[1];
  const xDomain = zoomFits ? zoom : domain;
  const opts = { fitRaw, histScale: scale === "hist" };
  const primary = seriesView(metrics.find((m) => m.key === metricKey), xDomain, opts);
  const others = metrics.filter((m) => m.key !== metricKey);
  const compared = compare
    .map((k) => others.find((m) => m.key === k))
    .filter((m) => m && hasData(m))
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
  const pickPrimary = (k) => {
    setCompare((c) => c.filter((x) => x !== k));
    setZoom(null);
    onMetricChange(k);
  };

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
      {onMetricChange && (
        <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label="Métrica">
          {metrics.map((m) => {
            const on = m.key === metricKey;
            const empty = !hasData(m);
            const c = ACCENTS[m.accent].stroke;
            return (
              <button
                key={m.key}
                role="radio"
                aria-checked={on}
                onClick={() => pickPrimary(m.key)}
                disabled={empty && !on}
                title={empty ? "Sin datos en este período" : undefined}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${on ? "text-white shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                style={on ? { background: c, borderColor: c } : undefined}
              >
                {!on && <span className="w-2 h-2 rounded-full" style={{ background: c }} />}
                {m.title}
              </button>
            );
          })}
        </div>
      )}
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
            const empty = !hasData(m);
            const c = ACCENTS[m.accent].stroke;
            return (
              <button
                key={m.key}
                onClick={() => toggleCompare(m.key)}
                disabled={empty}
                aria-pressed={on}
                title={empty ? "Sin datos en este período" : undefined}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border transition-all ${on ? "bg-white shadow-sm" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
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

const GRANS = [
  { id: "day", label: "Diario" },
  { id: "week", label: "Semanal" },
  { id: "month", label: "Mensual" },
  { id: "year", label: "Anual" },
];

/** Selector de granularidad; desactiva las que el período no llena. */
export function GranSelector({ gran, onChange, days }) {
  return (
    <div className="flex bg-slate-100 p-1 rounded-xl">
      {GRANS.map((gr) => {
        const enabled = days >= GRAN_MIN_DAYS[gr.id];
        return (
          <button
            key={gr.id}
            onClick={() => onChange(gr.id)}
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
}
