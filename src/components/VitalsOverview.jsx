import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import { motion } from "framer-motion";
import {
  HeartIcon, BoltIcon, ArrowTrendingUpIcon, ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { computeGarminStats } from '../lib/statusStats';
import { HeroCard } from './StatusCards';
import { COLORS, AXIS_TICK } from '../lib/palette';
import { ACCENTS, fmtDate, fmtDateFull, lastOf, deltaOf } from '../lib/vitalSeries';
import useVitalMetrics from '../hooks/useVitalMetrics';
import ExpandableChart, { ExpandButton } from './ExpandableChart';
import MetricChart, { GranSelector } from './MetricChart';
import { TimeScopeSelector } from './TimeScope';

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

function VitalPanel({ title, subtitle, icon: Icon, accent, data, unit, current, trend, trendInverse, domain, ticks, refValue, decimals = 0, yPad = 2, xFmt = fmtDate, bands = [], avgLabel = "Media", invertY = false, onExpand }) {
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
          {hasData && <ExpandButton onClick={onExpand} className="self-center" />}
        </div>
      </div>

      <div className="h-[160px] -ml-2" onDoubleClick={hasData ? onExpand : undefined}>
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// Las cuatro métricas con panel propio. Al ampliar cualquiera se abre el visor a
// pantalla completa, donde se elige entre TODAS (también Body Battery, sueño y
// peso) y se comparan. `?m=<métrica>` lo abre directamente (tarjetas de Today).
const PANEL_KEYS = ["hrv", "rhr", "vo2", "eff"];

// `allActivities` (cruzado incluido) alimenta la carga, como en la pestaña PMC.
export default function VitalsOverview({ activities = [], allActivities }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const viewerKey = searchParams.get("m");
  const openViewer = (k) => setSearchParams((sp) => { sp.set("m", k); return sp; });
  // Cerrar quita `m` de la URL: recargar o volver atrás no reabre el visor.
  const closeViewer = () => setSearchParams((sp) => { sp.delete("m"); return sp; }, { replace: true });

  const {
    metrics, goodBands, effThreshold, garmin, hasGarmin, domainFor,
    days, gran, setGran, gapAdjust, setGapAdjust, nowMs, xFmt, granLabel, avgLabel,
  } = useVitalMetrics(activities, { withWeight: viewerKey != null, loadActivities: allActivities });

  // Medias de 7/28 días y récords históricos de FC reposo y recuperación. Las
  // tarjetas de arriba cuentan la TENDENCIA; esto cuenta contra qué se compara.
  const garminRecords = useMemo(
    () => computeGarminStats(garmin, { now: nowMs }),
    [garmin, nowMs],
  );

  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
  const { hrv, rhr, vo2, eff } = byKey;
  const hrvData = hrv.data, hrData = rhr.data, vo2Data = vo2.data, effData = eff.data;
  const domain = domainFor(PANEL_KEYS);
  const summary = {
    hrv: { current: lastOf(hrvData), trend: deltaOf(hrvData) },
    rhr: { current: lastOf(hrData), trend: deltaOf(hrData) },
    vo2: { current: lastOf(vo2Data), trend: deltaOf(vo2Data) },
    eff: { current: lastOf(effData), trend: deltaOf(effData, 2) },
  };
  const granSelector = <GranSelector gran={gran} onChange={setGran} days={days} />;
  const viewerMetric = metrics.find((m) => m.key === viewerKey) ?? null;
  const periodControls = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-label font-bold uppercase text-slate-500">Período</span>
      <TimeScopeSelector />
      {granSelector}
    </div>
  );

  // Shared evenly-spaced ticks so the 5 axes line up exactly
  const xTicks = useMemo(() => {
    if (!domain || domain[0] == null || domain[1] <= domain[0]) return undefined;
    const [a, b] = domain;
    const N = 9;
    return Array.from({ length: N + 1 }, (_, i) => Math.round(a + ((b - a) * i) / N));
  }, [domain]);

  return (
    <>
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
          onExpand={() => openViewer("hrv")}
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
          onExpand={() => openViewer("rhr")}
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
          onExpand={() => openViewer("vo2")}
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
          onExpand={() => openViewer("eff")}
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
      {/* Visor a pantalla completa: una métrica elegible + comparación con el resto */}
      <ExpandableChart
        trigger="none"
        open={viewerMetric != null}
        onOpenChange={(o) => { if (!o) closeViewer(); }}
        title={viewerMetric?.title ?? ""}
        subtitle={granLabel}
        expandedContent={viewerMetric && (
          <MetricChart
            metricKey={viewerMetric.key}
            onMetricChange={(k) => setSearchParams((sp) => { sp.set("m", k); return sp; }, { replace: true })}
            metrics={metrics}
            periodControls={periodControls}
            domain={domainFor(metrics.map((m) => m.key))}
            xFmt={xFmt}
            bands={goodBands}
            avgLabel={avgLabel}
          />
        )}
      />
    </>
  );
}
