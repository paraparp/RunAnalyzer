import { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot,
} from "recharts";
import {
  ArrowDownIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon, ArrowUpIcon, ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { COLORS, AXIS_TICK } from '../lib/palette';
import { ACCENTS, extremesOf, evenTicks, fmtDateFull, deltaOf, lastOf, rawAsLine, GRAN_MIN_DAYS } from '../lib/vitalSeries';

// Gráfico de exploración de métricas vitales del visor de Resumen Vital. Las
// series vienen de `buildVitalMetrics` (lib/vitalSeries).

// Carril de métricas: 16 series se leen mejor por familia que en una tira plana.
const METRIC_GROUPS = [
  { label: "Recuperación", keys: ["hrv", "rhr", "sleepHR", "respiration", "stress", "bb", "bbLow"] },
  { label: "Sueño", keys: ["sleep", "sleepHours"] },
  { label: "Carga", keys: ["load", "ctl", "atl", "tsb"] },
  { label: "Rendimiento", keys: ["vo2", "eff", "weight"] },
];

// Métricas donde subir o bajar no es bueno ni malo por sí mismo: su diferencia va
// en gris. En el resto, `invertY` marca las que mejoran al bajar.
const NO_GOOD_SIDE = new Set(["load", "atl", "weight"]);

const FOCUS_RING ="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500";
const SEG_GROUP = "flex items-center gap-0.5 bg-slate-100 dark:bg-white/[0.06] rounded-lg p-0.5";
const segButton = (on) => `px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${FOCUS_RING} ${on
  ? "bg-white dark:bg-white/[0.12] text-teal-700 dark:text-teal-300 shadow-sm"
  : "text-slate-500 dark:text-white/55 hover:text-slate-800 dark:hover:text-white"}`;

const hasData = (m) => m.data.some((d) => d.smooth != null);

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
      r[`${s.key}_line`] = d.line ?? d.smooth;
    }
  }
  return [...m.values()].sort((a, b) => a.ms - b.ms);
}

// Estadísticas y escala Y de una serie dentro del rango visible.
function seriesView(base, xDomain, { fitRaw, histScale, daily }) {
  // Con valor del día todo (línea y estadísticas) sale de ese valor. El histórico
  // se calcula sobre la media móvil: mezclarlo daría referencias que no comparan.
  // CTL/ATL/TSB no tienen valor crudo: siguen igual.
  const s = daily && base.data.some((d) => d.raw != null)
    ? { ...base, data: rawAsLine(base.data), history: null, daily: true }
    : base;
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
    last: lastOf(visible),
    lastMs: [...visible].reverse().find((d) => d.smooth != null)?.ms ?? null,
    delta: deltaOf(visible, Math.max(s.decimals, 1)),
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
    <div className="bg-white dark:bg-[#0c0e12] border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-xs shadow-lg min-w-[180px] space-y-1">
      <p className="font-semibold text-slate-500 dark:text-white/55">{fmtDateFull(row.ms)}</p>
      {series.map((s) => {
        const v = row[`${s.key}_smooth`];
        const r = row[`${s.key}_raw`];
        if (v == null && r == null) return null;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-white/55">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.stroke }} />
              {s.title}
            </span>
            <span className="font-bold text-slate-900 dark:text-white tabular-nums">
              {s.fmt(v)}
              {r != null && <span className="font-normal text-slate-500 dark:text-white/55"> · día {s.fmt(r)}</span>}
              <span className="font-medium text-slate-500 dark:text-white/55 ml-0.5">{s.unit}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
};

// Elementos Recharts de una serie sobre su propio eje Y (yAxisId = key).
// `annotate`: extremos, media e histórico, solo cuando la serie va sola en su gráfico.
function seriesLayer(s, { axis, annotate, compact, tintAxis }) {
  const id = s.key;
  const inY = (v) => v >= s.yDomain[0] && v <= s.yDomain[1];
  // Si el extremo del período ES el histórico, su punto ya lo cuenta: otra línea
  // con la misma cifra y fecha solo repite la etiqueta.
  const histMaxNew = s.fmt(s.history?.max.v) !== s.fmt(s.range?.max.v);
  const histMinNew = s.fmt(s.history?.min.v) !== s.fmt(s.range?.min.v);
  const fs = compact ? 10 : 12;
  const els = [
    <YAxis
      key={`${id}-y`} yAxisId={id} domain={s.yDomain} allowDataOverflow reversed={s.invertY}
      hide={axis === "hidden"} orientation={axis === "right" ? "right" : "left"}
      tick={tintAxis ? { ...AXIS_TICK, fill: s.stroke } : AXIS_TICK} axisLine={false} tickLine={false}
      width={s.decimals > 0 ? 44 : 36} tickCount={compact ? 4 : 8}
      allowDecimals={s.decimals > 0} tickFormatter={(v) => v.toFixed(s.decimals)}
    />,
  ];
  if (annotate && s.history && histMaxNew && inY(s.history.max.v)) {
    els.push(
      <ReferenceLine key={`${id}-hmax`} yAxisId={id} y={s.history.max.v} stroke={COLORS.inkMuted} strokeDasharray="6 4" strokeOpacity={0.7}
        label={{ value: `máx histórico ${s.fmt(s.history.max.v)} · ${fmtDateFull(s.history.max.ms)}`, position: s.invertY ? "insideBottomLeft" : "insideTopLeft", fontSize: 11, fill: COLORS.inkMuted }} />,
    );
  }
  if (annotate && s.history && histMinNew && s.history.min.v !== s.history.max.v && inY(s.history.min.v)) {
    els.push(
      <ReferenceLine key={`${id}-hmin`} yAxisId={id} y={s.history.min.v} stroke={COLORS.inkMuted} strokeDasharray="6 4" strokeOpacity={0.7}
        label={{ value: `mín histórico ${s.fmt(s.history.min.v)} · ${fmtDateFull(s.history.min.ms)}`, position: s.invertY ? "insideTopLeft" : "insideBottomLeft", fontSize: 11, fill: COLORS.inkMuted }} />,
    );
  }
  if (annotate && s.mean != null && !compact) {
    els.push(
      <ReferenceLine key={`${id}-mean`} yAxisId={id} y={s.mean} stroke={s.stroke} strokeOpacity={0.25}
        label={{ value: `media ${s.fmt(s.mean)}`, position: "insideRight", fontSize: 11, fill: s.stroke, opacity: 0.8 }} />,
    );
  }
  els.push(
    <Area key={`${id}-smooth`} yAxisId={id} type={s.daily ? "linear" : "monotone"} dataKey={`${id}_line`} name={s.title}
      stroke={s.stroke} strokeWidth={s.daily ? 1.5 : 2.5} fill={annotate ? `url(#grad-x-${id})` : "none"}
      connectNulls={false} dot={false} isAnimationActive={false} />,
    <Area key={`${id}-raw`} yAxisId={id} type="monotone" dataKey={`${id}_raw`} stroke={s.stroke} strokeWidth={0} fill="none"
      dot={{ r: 2, fill: s.stroke, fillOpacity: 0.5, strokeWidth: 0 }} activeDot={false} connectNulls={false} isAnimationActive={false} />,
  );
  if (annotate && s.range) {
    els.push(
      <ReferenceDot key={`${id}-dmax`} yAxisId={id} x={s.range.max.ms} y={s.range.max.v} r={compact ? 4 : 5} fill={s.stroke} stroke={COLORS.paper} strokeWidth={2}
        label={{ value: `máx ${s.fmt(s.range.max.v)} · ${fmtDateFull(s.range.max.ms)}`, position: s.invertY ? "bottom" : "top", fontSize: fs, fontWeight: 700, fill: s.stroke }} />,
    );
    if (s.range.min.ms !== s.range.max.ms) {
      els.push(
        <ReferenceDot key={`${id}-dmin`} yAxisId={id} x={s.range.min.ms} y={s.range.min.v} r={compact ? 4 : 5} fill={COLORS.paper} stroke={s.stroke} strokeWidth={2}
          label={{ value: `mín ${s.fmt(s.range.min.v)} · ${fmtDateFull(s.range.min.ms)}`, position: s.invertY ? "top" : "bottom", fontSize: fs, fontWeight: 700, fill: s.stroke }} />,
      );
    }
  }
  return els;
}

// Identifica una serie cuando hay varias: color, nombre y valor actual.
const SeriesLabel = ({ s }) => (
  <span className="inline-flex items-center gap-1.5 text-xs">
    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.stroke }} />
    <span className="font-semibold text-slate-700 dark:text-white/75">{s.title}</span>
    <span className="font-bold tabular-nums text-slate-900 dark:text-white">{s.fmt(s.last)}</span>
    {s.unit && <span className="text-slate-500 dark:text-white/55">{s.unit}</span>}
  </span>
);

// Una referencia de la cabecera: etiqueta, cifra y su fecha o aclaración.
const Stat = ({ label, value, unit, note, title }) => (
  <div className="min-w-0" title={title}>
    <dt className="text-label font-bold uppercase text-slate-500 dark:text-white/55">{label}</dt>
    <dd className="mt-0.5 text-lg font-bold leading-tight tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
      {value}
      {unit && <span className="ml-1 text-xs font-medium text-slate-500 dark:text-white/55">{unit}</span>}
    </dd>
    {note && <dd className="text-xs text-slate-500 dark:text-white/55 whitespace-nowrap">{note}</dd>}
  </div>
);

// Carril de métricas: cada fila activa o desactiva su serie, sin jerarquía entre
// ellas. Siempre queda al menos una. En móvil se pliega tras un botón para no
// robarle la pantalla al gráfico.
// Cada fila da el valor actual y su diferencia con la media de lo que se ve: misma
// granularidad, modo de línea y rango que el gráfico.
function MetricRail({ metrics, selected, onToggle, xDomain, opts, avgName }) {
  const [open, setOpen] = useState(false);
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const only = selected.length === 1 ? byKey.get(selected[0]) : null;
  return (
    <div className="lg:w-[300px] shrink-0 lg:overflow-y-auto lg:border-r lg:border-slate-200 lg:dark:border-white/10 lg:pr-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`lg:hidden w-full flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-200 dark:border-white/10 text-sm font-semibold text-slate-800 dark:text-white ${FOCUS_RING}`}
      >
        {only && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ACCENTS[only.accent].stroke }} />}
        <span className="truncate">{only ? only.title : `${selected.length} métricas`}</span>
        <span className="ml-auto text-xs font-medium text-slate-500 dark:text-white/55">Cambiar</span>
        <ChevronDownIcon className={`w-4 h-4 text-slate-500 dark:text-white/55 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`${open ? "block" : "hidden"} lg:block mt-2 lg:mt-0 space-y-3`}>
        <p className="px-2 text-xs text-slate-500 dark:text-white/55">Marca una o varias métricas.</p>
        {METRIC_GROUPS.map((g) => (
          <section key={g.label}>
            <h3 className="px-2 mb-0.5 text-label font-bold uppercase text-slate-500 dark:text-white/55">{g.label}</h3>
            <ul>
              {g.keys.map((k) => byKey.get(k)).filter(Boolean).map((m) => {
                const on = selected.includes(m.key);
                const empty = !hasData(m);
                const v = seriesView(m, xDomain, opts);
                const dec = Math.max(m.decimals, 1);
                const diff = v.last != null && v.mean != null ? v.last - v.mean : null;
                const flat = diff != null && Math.abs(diff) < Math.pow(10, -dec) / 2;
                return (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => onToggle(m.key)}
                      disabled={empty && !on}
                      aria-pressed={on}
                      title={empty || v.n === 0 ? "Sin datos en este período" : `Diferencia con ${avgName} (${v.fmt(v.mean)}${m.unit ? ` ${m.unit}` : ""})`}
                      className={`w-full flex items-center gap-2 h-10 lg:h-7 px-2 rounded-md text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING} ${on ? "bg-teal-50 dark:bg-teal-400/10" : "hover:bg-slate-100 dark:hover:bg-white/[0.05]"}`}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ACCENTS[m.accent].stroke }} />
                      <span className={`truncate text-sm ${on ? "font-bold text-teal-800 dark:text-teal-200" : "font-medium text-slate-700 dark:text-white/75"}`}>{m.title}</span>
                      <span className={`ml-auto pl-2 text-xs tabular-nums ${on ? "font-bold text-teal-800 dark:text-teal-200" : "font-semibold text-slate-500 dark:text-white/55"}`}>
                        {v.fmt(v.last)}
                      </span>
                      <span className={`w-11 shrink-0 inline-flex items-center justify-end gap-0.5 text-[11px] font-normal tabular-nums ${flat || diff == null || NO_GOOD_SIDE.has(m.key)
                        ? "text-slate-500 dark:text-white/55"
                        : (m.invertY ? diff < 0 : diff > 0) ? "text-emerald-700 dark:text-emerald-300/80" : "text-rose-700 dark:text-rose-300/80"}`}>
                        {diff != null && (flat ? "=" : (
                          <>
                            {diff > 0 ? <ArrowUpIcon className="w-2.5 h-2.5 shrink-0" strokeWidth={2.5} aria-hidden="true" /> : <ArrowDownIcon className="w-2.5 h-2.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
                            <span className="sr-only">{diff > 0 ? "+" : "−"}</span>
                            {Math.abs(diff).toFixed(dec)}
                          </>
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Gráfico de exploración de una métrica: eje Y ajustado, máx/mín del rango en su
 * punto exacto, referencias del histórico, selección de rango arrastrando y
 * comparación con el resto de métricas (apiladas o superpuestas).
 */
export default function MetricChart({ metricKey, onMetricChange, metrics, periodControls, domain, xFmt, bands = [], avgLabel, daily = false, onDailyChange }) {
  const [zoom, setZoom] = useState(null);         // [msA, msB] | null
  const [drag, setDrag] = useState(null);         // { a, b } mientras se arrastra
  const [scale, setScale] = useState("fit");      // 'fit' | 'hist'
  const [fitRaw, setFitRaw] = useState(false);    // incluir puntos diarios en la escala
  const [selected, setSelected] = useState([metricKey]); // métricas visibles, sin jerarquía
  const [layout, setLayout] = useState("overlay");  // 'stack' | 'overlay'

  const zoomFits = zoom && zoom[0] >= domain[0] && zoom[1] <= domain[1];
  const xDomain = zoomFits ? zoom : domain;
  const opts = { fitRaw, histScale: scale === "hist", daily };
  const all = selected
    .map((k) => metrics.find((m) => m.key === k))
    .filter(Boolean)
    .map((m) => seriesView(m, xDomain, opts))
    .filter((s) => s.n > 0);
  const rows = mergeRows(all).filter((r) => r.ms >= xDomain[0] && r.ms <= xDomain[1]);
  const overlay = layout === "overlay" && all.length > 1;
  const single = all.length === 1 ? all[0] : null;
  // Solo hay valor del día en granularidad diaria; semanas y meses son ya medias.
  const canDaily = metrics.some((m) => selected.includes(m.key) && m.data.some((d) => d.raw != null));
  const hasHist = all.some((s) => s.history);

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
  const toggleMetric = (k) => {
    const on = selected.includes(k);
    if (on && selected.length === 1) return; // siempre queda una
    const next = on ? selected.filter((x) => x !== k) : [...selected, k];
    setSelected(next);
    if (next[0] !== selected[0]) onMetricChange(next[0]); // la URL sigue apuntando a una visible
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
          annotate: series.length === 1,
          tintAxis: series.length > 1,
          compact,
        }))}
        {drag && drag.a !== drag.b && (
          <ReferenceArea yAxisId={series[0].key} x1={Math.min(drag.a, drag.b)} x2={Math.max(drag.a, drag.b)}
            fill={COLORS.inkMuted} fillOpacity={0.12} stroke={COLORS.inkMuted} strokeOpacity={0.4} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );

  const histOff = single?.history && [single.history.min.v, single.history.max.v].some((v) => v < single.yDomain[0] || v > single.yDomain[1]);
  const deltaDec = Math.max(single?.decimals ?? 0, 1);
  const showDelta = single?.delta != null && Math.abs(single.delta) >= Math.pow(10, -deltaDec);
  const DeltaIcon = single?.delta > 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;

  return (
    <div className="h-full flex flex-col lg:flex-row gap-3 lg:gap-5 overflow-y-auto lg:overflow-hidden">
      <MetricRail
        metrics={metrics} selected={selected} onToggle={toggleMetric} xDomain={xDomain} opts={opts}
        avgName={daily && canDaily ? "la media del período" : `la ${avgLabel.toLowerCase()} del período`}
      />

      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {/* Una métrica: su valor y sus referencias. Varias: solo qué es cada línea. */}
        {single && (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-4xl font-black tracking-tight leading-none tabular-nums text-slate-900 dark:text-white">
                {single.fmt(single.last)}
                {single.unit && <span className="ml-1.5 text-base font-semibold tracking-normal text-slate-500 dark:text-white/55">{single.unit}</span>}
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-white/55">
                {single.lastMs != null && <span>{single.daily ? "Valor del día" : avgLabel} · {fmtDateFull(single.lastMs)}</span>}
                {showDelta && (
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-white/75 tabular-nums">
                    <DeltaIcon className="w-3.5 h-3.5" />
                    {single.delta > 0 ? "+" : "−"}{Math.abs(single.delta).toFixed(deltaDec)} frente a la 1.ª mitad
                  </span>
                )}
                {single.invertY && <span>Eje invertido</span>}
              </p>
            </div>
            {single.range && (
              <dl className="flex flex-wrap gap-x-6 gap-y-2 lg:ml-auto">
                <Stat label="Máx" value={single.fmt(single.range.max.v)} unit={single.unit} note={fmtDateFull(single.range.max.ms)} />
                <Stat label="Mín" value={single.fmt(single.range.min.v)} unit={single.unit} note={fmtDateFull(single.range.min.ms)} />
                <Stat label={single.daily ? "Media" : avgLabel} value={single.fmt(single.mean)} unit={single.unit} note="del período" />
                {single.history && (
                  <Stat
                    label="Histórico"
                    value={`${single.fmt(single.history.min.v)}–${single.fmt(single.history.max.v)}`}
                    unit={single.unit}
                    note={histOff ? "fuera de escala" : "dentro de escala"}
                    title={`Máx histórico ${single.fmt(single.history.max.v)} (${fmtDateFull(single.history.max.ms)}) · mín histórico ${single.fmt(single.history.min.v)} (${fmtDateFull(single.history.min.ms)})`}
                  />
                )}
              </dl>
            )}
          </div>
        )}
        {overlay && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {all.map((s) => <SeriesLabel key={s.key} s={s} />)}
          </div>
        )}

        {/* Controles del gráfico */}
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${single || overlay ? "pt-3 border-t border-slate-200 dark:border-white/10" : ""}`}>
          {periodControls}
          {canDaily && (
            <div className={SEG_GROUP} role="group" aria-label="Línea">
              <button type="button" className={segButton(!daily)} aria-pressed={!daily} onClick={() => onDailyChange(false)}>Media móvil</button>
              <button type="button" className={segButton(daily)} aria-pressed={daily} onClick={() => onDailyChange(true)}>Valor del día</button>
            </div>
          )}
          <div className={SEG_GROUP} role="group" aria-label="Escala">
            <button type="button" className={segButton(scale === "fit" || !hasHist)} aria-pressed={scale === "fit" || !hasHist} onClick={() => setScale("fit")}>Ajustada</button>
            {hasHist && <button type="button" className={segButton(scale === "hist")} aria-pressed={scale === "hist"} onClick={() => setScale("hist")} title="Incluir el histórico en la escala">Histórico</button>}
          </div>
          {all.some((s) => s.hasRaw) && (
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-white/75 cursor-pointer select-none" title="Ajustar la escala a los puntos diarios">
              <input type="checkbox" className="w-3.5 h-3.5 accent-teal-600" checked={fitRaw} onChange={(e) => setFitRaw(e.target.checked)} />
              Incluir puntos diarios
            </label>
          )}
          {all.length > 1 && (
            <div className={SEG_GROUP} role="group" aria-label="Disposición de los gráficos">
              <button type="button" className={segButton(layout === "stack")} aria-pressed={layout === "stack"} onClick={() => setLayout("stack")}>Apilados</button>
              <button type="button" className={segButton(layout === "overlay")} aria-pressed={layout === "overlay"} onClick={() => setLayout("overlay")}>Superpuestos</button>
            </div>
          )}
          <div className="flex items-center gap-2 sm:ml-auto text-xs font-medium text-slate-500 dark:text-white/55 tabular-nums">
            {zoomFits && (
              <button type="button" onClick={() => setZoom(null)} className={`px-2.5 py-1.5 rounded-md font-semibold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-400/10 hover:bg-teal-100 dark:hover:bg-teal-400/20 transition-colors ${FOCUS_RING}`}>
                Restablecer rango
              </button>
            )}
            <span>{zoomFits ? "Rango" : "Período"} {fmtDateFull(xDomain[0])} – {fmtDateFull(xDomain[1])}</span>
          </div>
        </div>

      {/* Gráficos. Cada contenedor recorta (overflow-hidden) su SVG: si no, el SVG
          aún sin redimensionar desborda, aparece la barra de scroll, el gráfico
          encoge, la barra desaparece y vuelve a crecer, en bucle (vibración). */}
      <div className="flex-1 min-h-[280px] lg:min-h-0 flex flex-col gap-2 overflow-y-auto overflow-x-hidden select-none cursor-crosshair">
        {all.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-500 dark:text-white/55 cursor-default">Sin datos en este período</div>
        ) : overlay ? (
          <div className="flex-1 min-h-[240px] overflow-hidden">{chart(all, { showBands: true })}</div>
        ) : single ? (
          <div className="flex-1 min-h-[220px] overflow-hidden">{chart([single], { showBands: true })}</div>
        ) : (
          all.map((s, i) => (
            <div key={s.key} className={`flex-1 min-h-[160px] flex flex-col ${i > 0 ? "border-t border-slate-200 dark:border-white/10 pt-2" : ""}`}>
              <div className="px-1 mb-1"><SeriesLabel s={s} /></div>
              <div className="flex-1 min-h-0 overflow-hidden">{chart([s], { compact: true, showBands: true })}</div>
            </div>
          ))
        )}
      </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-white/55">
          {bands.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/30 shrink-0" />
              Franja verde: eficiencia aeróbica ≥ 85 % de tu máximo histórico
            </span>
          ) : <span />}
          <span className="hidden sm:inline">Arrastra sobre el gráfico para seleccionar un rango</span>
        </div>
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
    <div className={SEG_GROUP} role="group" aria-label="Granularidad">
      {GRANS.map((gr) => {
        const enabled = days >= GRAN_MIN_DAYS[gr.id];
        return (
          <button
            key={gr.id}
            onClick={() => onChange(gr.id)}
            disabled={!enabled}
            title={enabled ? undefined : "Período demasiado corto para esta granularidad"}
            aria-pressed={gran === gr.id}
            className={enabled ? segButton(gran === gr.id) : "px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-400 dark:text-white/40 cursor-not-allowed"}
          >
            {gr.label}
          </button>
        );
      })}
    </div>
  );
}
