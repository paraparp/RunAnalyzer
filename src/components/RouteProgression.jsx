import { useMemo, useState } from 'react';
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { MapContainer, TileLayer, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, MinusIcon } from '@heroicons/react/24/outline';
import { repeatedRoutes, describeTrend } from '../lib/routeProgression';
import { formatPaceFromSpeed, formatDuration } from '../lib/timeFormat';
import { getLightMapTileUrl, getMapAttribution } from '../lib/mapTiles';
import useHrParams from '../hooks/useHrParams';
import { COLORS, AXIS_TICK } from '../lib/palette';

// Sesiones › Recorridos: el mismo circuito a lo largo del tiempo, comparado por
// GAP y metros por latido en vez de por crono (lib/routeProgression).

const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' });

function TrendBadge({ pct }) {
  if (pct == null) return <span className="text-xs text-slate-400">—</span>;
  const up = pct >= 1, down = pct <= -1;
  const Icon = up ? ArrowTrendingUpIcon : down ? ArrowTrendingDownIcon : MinusIcon;
  const cls = up ? 'text-emerald-600' : down ? 'text-rose-600' : 'text-slate-500';
  return <span className={`inline-flex items-center gap-1 text-xs font-bold ${cls}`}><Icon className="w-4 h-4" />{pct > 0 ? '+' : ''}{pct}%/90 d</span>;
}

function RouteMiniMap({ positions }) {
  return (
    <div className="isolate h-56 rounded-xl overflow-hidden border border-slate-100">
      <MapContainer bounds={positions} scrollWheelZoom={false} className="w-full h-full" style={{ background: COLORS.hairlineSoft }}>
        <TileLayer url={getLightMapTileUrl()} attribution={getMapAttribution('light')} />
        <Polyline positions={positions} pathOptions={{ color: COLORS.paper, weight: 6 }} />
        <Polyline positions={positions} pathOptions={{ color: COLORS.signal, weight: 3 }} />
      </MapContainer>
    </div>
  );
}

function RouteDetail({ route, onOpenActivity }) {
  const data = route.sessions.map((s) => ({
    ...s,
    ts: Date.parse(s.date + 'T12:00:00'),
    gapPace: s.gap_ms ? Math.round(1000 / s.gap_ms) : null,
    efAerobic: s.aerobic ? s.ef : null,
    efOther: !s.aerobic ? s.ef : null,
  }));
  const paceTick = (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-sm text-slate-700 mb-3">{describeTrend(route)}</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.hairlineSoft} vertical={false} />
                <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
                  tickFormatter={(ts) => new Date(ts).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })}
                  tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis yAxisId="ef" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} domain={['auto', 'auto']}
                  tickFormatter={(v) => v.toFixed(2)} />
                <YAxis yAxisId="pace" orientation="right" reversed tick={AXIS_TICK} tickLine={false} axisLine={false} width={44}
                  domain={['auto', 'auto']} tickFormatter={paceTick} />
                <Tooltip
                  labelFormatter={(ts) => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                  formatter={(v, name) => (name === 'gapPace' ? [`${paceTick(v)}/km`, 'GAP'] : [`${Number(v).toFixed(2)} m/lat`, name === 'efAerobic' ? 'EF (aeróbica)' : 'EF (otra intensidad)'])}
                />
                <Line yAxisId="pace" dataKey="gapPace" stroke={COLORS.inkFaint} strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} connectNulls />
                <Scatter yAxisId="ef" dataKey="efAerobic" fill={COLORS.signal} isAnimationActive={false} />
                <Scatter yAxisId="ef" dataKey="efOther" fill={COLORS.hairlineStrong} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Puntos azules: eficiencia (m/latido sobre GAP) en salidas aeróbicas, las que cuentan para la tendencia.
            Grises: otras intensidades. Línea: ritmo GAP (eje derecho).
          </p>
        </div>
        <RouteMiniMap positions={route.positions} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2 font-semibold">Fecha</th>
              <th className="px-4 py-2 font-semibold">Tiempo</th>
              <th className="px-4 py-2 font-semibold">Ritmo</th>
              <th className="px-4 py-2 font-semibold">GAP</th>
              <th className="px-4 py-2 font-semibold">FC</th>
              <th className="px-4 py-2 font-semibold">m/latido</th>
            </tr>
          </thead>
          <tbody>
            {[...route.sessions].reverse().map((s) => (
              <tr key={s.id} onClick={() => onOpenActivity?.(s.id)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                <td className="px-4 py-1.5">
                  {fmtDate(s.date)}
                  {route.best?.id === s.id && <span className="ml-2 px-1.5 py-px rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800">Mejor GAP</span>}
                </td>
                <td className="px-4 py-1.5">{s.moving_s ? formatDuration(s.moving_s) : '—'}</td>
                <td className="px-4 py-1.5">{s.speed_ms ? `${formatPaceFromSpeed(s.speed_ms)}/km` : '—'}</td>
                <td className="px-4 py-1.5 font-semibold">{s.gap_ms ? `${formatPaceFromSpeed(s.gap_ms)}/km` : '—'}</td>
                <td className="px-4 py-1.5">{s.hr ? Math.round(s.hr) : '—'}</td>
                <td className={`px-4 py-1.5 ${s.aerobic ? 'text-slate-900' : 'text-slate-400'}`}>{s.ef ? s.ef.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RouteProgression({ activities, onOpenActivity }) {
  const { hrmax } = useHrParams(activities);
  const routes = useMemo(() => repeatedRoutes(activities, { maxObservedHr: hrmax }), [activities, hrmax]);
  const [selectedId, setSelectedId] = useState(null);
  const selected = routes.find((r) => r.id === selectedId) ?? routes[0];

  if (!routes.length) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm">
        Aún no hay recorridos repetidos: hacen falta al menos 3 salidas por el mismo circuito con GPS.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {routes.map((r, i) => (
          <button
            key={r.id} type="button" onClick={() => setSelectedId(r.id)}
            className={`shrink-0 text-left rounded-xl border px-3 py-2 min-w-44 transition-colors ${selected.id === r.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-400'}`}
          >
            <p className="text-sm font-bold text-slate-900 truncate max-w-52">{r.name ?? `Recorrido ${i + 1}`}</p>
            <p className="text-xs text-slate-500">{r.distance_km} km · {r.sessions.length} veces</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600">GAP med. {r.median_gap_ms ? formatPaceFromSpeed(r.median_gap_ms) : '—'}</span>
              <TrendBadge pct={r.ef_trend_pct_per_90d} />
            </div>
          </button>
        ))}
      </div>
      <RouteDetail route={selected} onOpenActivity={onOpenActivity} />
    </div>
  );
}
