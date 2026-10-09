import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, ReferenceArea,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { getSessionStreams } from '../services/strava';
import { buildChartSeries, segmentStats, SESSION_STREAM_KEYS } from '../lib/streamChart';
import { formatDuration, formatPaceFromSpeed } from '../lib/timeFormat';
import { getLightMapTileUrl, getMapAttribution } from '../lib/mapTiles';
import { COLORS, AXIS_TICK } from '../lib/palette';

// Gráfico de streams de la vista de sesión: una fila por métrica, sincronizadas
// por distancia (`syncId`), con selección de tramo por arrastre y mapa enlazado.
// Los números del tramo los da lib/streamChart sobre la muestra completa; aquí
// solo se presenta.

const METRICS = [
  { key: 'pace', color: COLORS.signal, reversed: true },
  { key: 'hr', color: COLORS.risk },
  { key: 'alt', color: COLORS.inkFaint, area: true },
  { key: 'cad', color: COLORS.seriesViolet },
  { key: 'watts', color: COLORS.caution },
];

const paceLabel = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const fmtValue = (key, v, t) => {
  if (v == null) return '—';
  if (key === 'pace') return `${paceLabel(v)} /km`;
  if (key === 'hr') return `${v} ${t('session.u_bpm')}`;
  if (key === 'alt') return `${Math.round(v)} m`;
  if (key === 'cad') return `${v} spm`;
  return `${v} W`;
};

function FitTo({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds?.length > 1) map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, bounds]);
  return null;
}

function StreamsMap({ track, selection, hover }) {
  if (track.length < 2) return null;
  return (
    <div className="isolate h-64 lg:h-full min-h-[240px] rounded overflow-hidden border border-slate-100">
      <MapContainer bounds={track} scrollWheelZoom={false} className="w-full h-full" style={{ background: COLORS.hairlineSoft }}>
        <TileLayer url={getLightMapTileUrl()} attribution={getMapAttribution('light')} />
        <Polyline positions={track} pathOptions={{ color: COLORS.paper, weight: 6, opacity: 0.9 }} />
        <Polyline positions={track} pathOptions={{ color: COLORS.signalPale, weight: 3 }} />
        {selection?.length > 1 && (
          <>
            <Polyline positions={selection} pathOptions={{ color: COLORS.signalDeep, weight: 5 }} />
            <FitTo bounds={selection} />
          </>
        )}
        {hover && (
          <CircleMarker center={hover} radius={6} pathOptions={{ color: COLORS.paper, weight: 2, fillColor: COLORS.risk, fillOpacity: 1 }} />
        )}
      </MapContainer>
    </div>
  );
}

function SegmentPanel({ stats, t, onZoom, onClear, zoomed }) {
  const items = [
    [t('session.streams_distance'), `${(stats.distance_m / 1000).toFixed(2)} km`],
    [t('session.streams_time'), formatDuration(stats.time_s)],
    [t('session.grp_pace'), `${formatPaceFromSpeed(stats.speed_ms)} /km`],
    ['GAP', stats.gap_speed_ms ? `${formatPaceFromSpeed(stats.gap_speed_ms)} /km` : '—'],
    [t('session.streams_avg_hr'), stats.avg_hr ? `${stats.avg_hr} ${t('session.u_bpm')}` : '—'],
    [t('session.streams_max_hr'), stats.max_hr ? `${stats.max_hr} ${t('session.u_bpm')}` : '—'],
    [t('session.cadence'), stats.avg_cadence ? `${stats.avg_cadence} spm` : '—'],
    ['D+ / D−', stats.gain_m != null ? `${stats.gain_m} / ${stats.loss_m} m` : '—'],
    [t('session.streams_drift'), stats.drift_pct != null ? `${stats.drift_pct > 0 ? '+' : ''}${stats.drift_pct}%` : '—', t('session.streams_drift_hint')],
  ];
  return (
    <div className="rounded bg-blue-50 border border-blue-100 p-3" role="region" aria-label={t('session.streams_segment')}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-label font-bold uppercase text-blue-700">{t('session.streams_segment')}</p>
        <div className="flex gap-1">
          {!zoomed && (
            <button type="button" onClick={onZoom} className="px-2 py-0.5 rounded text-xs font-semibold text-blue-700 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
              {t('session.streams_zoom')}
            </button>
          )}
          <button type="button" onClick={onClear} className="px-2 py-0.5 rounded text-xs font-semibold text-blue-800 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
            {t('session.streams_clear')}
          </button>
        </div>
      </div>
      <dl className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-x-4 gap-y-2">
        {items.map(([label, value, title]) => (
          <div key={label} title={title}>
            <dt className="text-xs text-blue-800">{label}</dt>
            <dd className="text-sm font-bold text-slate-900 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function SessionStreams({ activityId, accessToken, fallback = null }) {
  const { t } = useTranslation();
  // `id` del último resultado: si no coincide con la sesión pedida, está cargando.
  const [state, setState] = useState({ id: null, streams: null, error: null });
  const [enabled, setEnabled] = useState({ pace: true, hr: true, alt: true, cad: false, watts: false });
  const [drag, setDrag] = useState(null);       // { a, b } índices de `series` mientras se arrastra
  const [sel, setSel] = useState(null);         // { a, b } índices de `series` del tramo fijado
  const [zoom, setZoom] = useState(null);       // { a, b } ventana visible
  const [hoverIdx, setHoverIdx] = useState(null);
  const [touchArmed, setTouchArmed] = useState(false); // dedo apoyado, aún sin moverse
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!accessToken || !activityId) return;
    let alive = true;
    getSessionStreams(accessToken, activityId, SESSION_STREAM_KEYS)
      .then((streams) => alive && setState({ id: activityId, streams, error: null }))
      .catch((e) => alive && setState({ id: activityId, streams: null, error: e.message || 'error' }));
    return () => { alive = false; };
  }, [accessToken, activityId, attempt]);

  const retry = () => {
    setState({ id: null, streams: null, error: null });
    setAttempt((n) => n + 1);
  };

  const series = useMemo(() => buildChartSeries(state.streams), [state.streams]);
  const available = useMemo(
    () => METRICS.filter((m) => series.some((p) => p[m.key] != null)),
    [series],
  );
  const track = useMemo(() => series.filter((p) => p.lat != null).map((p) => [p.lat, p.lng]), [series]);

  const view = zoom ? series.slice(zoom.a, zoom.b + 1) : series;
  const offset = zoom ? zoom.a : 0;

  const stats = useMemo(
    () => (sel ? segmentStats(state.streams, series[sel.a].i, series[sel.b].i) : null),
    [sel, series, state.streams],
  );
  const selTrack = useMemo(
    () => (sel ? series.slice(sel.a, sel.b + 1).filter((p) => p.lat != null).map((p) => [p.lat, p.lng]) : null),
    [sel, series],
  );

  if (!accessToken) return null;
  if (state.id !== activityId) {
    return <div role="status" className="h-48 rounded bg-slate-50 motion-safe:animate-pulse flex items-center justify-center text-xs text-slate-500">{t('session.streams_loading')}</div>;
  }
  if (state.error) {
    return (
      <div className="space-y-4">
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900" title={state.error}>{t('session.streams_error')}</p>
          <button type="button" onClick={retry} className="px-3 py-1.5 rounded bg-white border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
            {t('session.streams_retry')}
          </button>
        </div>
        {fallback}
      </div>
    );
  }
  if (series.length < 2 || !available.length) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-500">{t('session.streams_none')}</p>
        {fallback}
      </div>
    );
  }

  // Recharts 3 da el índice activo como string.
  const idxOf = (st) => {
    const n = Number(st?.activeTooltipIndex);
    return Number.isFinite(n) ? n + offset : null;
  };
  const onDown = (st) => { const i = idxOf(st); if (i != null) setDrag({ a: i, b: i }); };
  const onMove = (st) => {
    const i = idxOf(st);
    if (i == null) return;
    setHoverIdx(i);
    if (drag) setDrag((d) => ({ ...d, b: i }));
  };
  const onUp = () => {
    if (drag && Math.abs(drag.b - drag.a) >= 2) setSel({ a: Math.min(drag.a, drag.b), b: Math.max(drag.a, drag.b) });
    setDrag(null);
    setTouchArmed(false);
  };
  const onTouchStart = () => setTouchArmed(true);
  const onTouchMove = (st) => {
    const i = idxOf(st);
    if (i == null) return;
    setHoverIdx(i);
    if (touchArmed && !drag) setDrag({ a: i, b: i });
    else if (drag) setDrag((d) => ({ ...d, b: i }));
  };
  const band = drag ?? sel;
  const hover = hoverIdx != null && series[hoverIdx]?.lat != null ? [series[hoverIdx].lat, series[hoverIdx].lng] : null;
  const shown = available.filter((m) => enabled[m.key]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {available.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={!!enabled[m.key]}
              onClick={() => setEnabled((e) => ({ ...e, [m.key]: !e[m.key] }))}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${enabled[m.key] ? 'border-slate-300 bg-white text-slate-800' : 'border-transparent bg-slate-50 text-slate-500 hover:text-slate-700'}`}
            >
              <span className="w-2 h-2 rounded-[50%]" style={{ background: enabled[m.key] ? m.color : COLORS.hairlineStrong }} aria-hidden="true" />
              {t(`session.streams_metric_${m.key}`)}
            </button>
          ))}
        </div>
        {zoom
          ? <button type="button" onClick={() => setZoom(null)} className="rounded text-xs font-semibold text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">{t('session.streams_reset')}</button>
          : <span className="text-xs text-slate-500">{t('session.streams_hint')}</span>}
      </div>

      {stats && (
        <SegmentPanel
          stats={stats} t={t} zoomed={!!zoom}
          onZoom={() => setZoom(sel)}
          onClear={() => { setSel(null); setZoom(null); }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 min-w-0 select-none touch-pan-y" onMouseLeave={() => { setHoverIdx(null); if (drag) onUp(); }}>
          {shown.map((m, k) => (
            <div key={m.key} className="h-28">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={view} syncId="session-streams" syncMethod="value"
                  margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                  onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
                  onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onUp}
                >
                  <CartesianGrid stroke={COLORS.hairlineSoft} vertical={false} />
                  <XAxis
                    dataKey="km" type="number" domain={['dataMin', 'dataMax']}
                    hide={k !== shown.length - 1}
                    tick={AXIS_TICK} tickLine={false} axisLine={false} unit=" km"
                    tickFormatter={(v) => v.toFixed(1)}
                  />
                  <YAxis
                    dataKey={m.key} reversed={m.reversed} width={52}
                    domain={['auto', 'auto']} tick={AXIS_TICK} tickLine={false} axisLine={false}
                    tickFormatter={(v) => (m.key === 'pace' ? paceLabel(v) : Math.round(v))}
                  />
                  <RechartsTooltip
                    cursor={{ stroke: COLORS.inkFaint, strokeWidth: 1 }}
                    labelFormatter={(v) => `${Number(v).toFixed(2)} km`}
                    formatter={(v) => [fmtValue(m.key, v, t), t(`session.streams_metric_${m.key}`)]}
                    isAnimationActive={false}
                  />
                  {m.area
                    ? <Area dataKey={m.key} stroke={m.color} fill={m.color} fillOpacity={0.25} isAnimationActive={false} connectNulls />
                    : <Line dataKey={m.key} stroke={m.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                  {band && series[band.a] && series[band.b] && (
                    <ReferenceArea
                      x1={series[Math.min(band.a, band.b)].km} x2={series[Math.max(band.a, band.b)].km}
                      fill={COLORS.signal} fillOpacity={0.08} stroke={COLORS.signal} strokeOpacity={0.3}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
        <StreamsMap track={track} selection={selTrack} hover={hover} />
      </div>
    </div>
  );
}
