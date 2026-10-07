import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { ScaleIcon } from '@heroicons/react/24/outline';
import { fetchWeightHistory } from '../services/garminWorkouts';
import {
  withRollingAverage, changeOver, monthlyWeightVsEfficiency, describeCorrelation,
} from '../lib/weightTrend';
import useHrParams from '../hooks/useHrParams';
import { COLORS, AXIS_TICK } from '../lib/palette';

// ─────────────────────────────────────────────────────────────────────────────
// Salud › Peso. La báscula Garmin ya la leía el MCP (`list_weight`) pero ninguna
// pantalla la enseñaba. Se pide en vivo (no se guarda en el almacén): es un dato
// que cambia poco y el endpoint lo trae en una sola llamada.
// ─────────────────────────────────────────────────────────────────────────────

const RANGES = [
  { days: 90, label: '3 meses' },
  { days: 365, label: '1 año' },
  { days: 1095, label: '3 años' },
];

const fmtKg = (v) => (v == null ? '—' : v.toFixed(1));
const fmtDelta = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);
const shortDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

function Tile({ label, value, unit, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-500 font-semibold tracking-wider uppercase">{label}</span>
      <div className="text-2xl font-extrabold text-slate-800 tabular-nums">
        {value}{unit && <span className="text-sm font-semibold text-slate-500 ml-1">{unit}</span>}
      </div>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

export default function WeightTrend({ activities, onOpenConnections }) {
  const [days, setDays] = useState(365);
  // `days` del último resultado: si no coincide con el rango pedido, está cargando.
  const [state, setState] = useState({ days: null, error: null, weights: [] });
  const { hrmax } = useHrParams(activities);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchWeightHistory({ days, signal: ctrl.signal })
      .then((d) => setState({ days, error: null, weights: d.weights || [] }))
      .catch((e) => {
        if (e.name !== 'AbortError') setState({ days, error: e.message, weights: [] });
      });
    return () => ctrl.abort();
  }, [days]);

  const smoothed = useMemo(() => withRollingAverage(state.weights), [state.weights]);
  const corr = useMemo(
    () => monthlyWeightVsEfficiency(state.weights, activities, { maxObservedHr: hrmax }),
    [state.weights, activities, hrmax],
  );

  const last = smoothed[smoothed.length - 1];
  const lastComp = [...state.weights].reverse().find((w) => w.body_fat_pct != null);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <ScaleIcon className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-bold text-slate-800">Peso y composición</h2>
      </div>
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => setDays(r.days)}
            className={`px-3 py-1 text-xs font-semibold rounded-lg ${days === r.days ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
          >{r.label}</button>
        ))}
      </div>
    </div>
  );

  if (state.days !== days) {
    return <div className="space-y-4">{header}<div className="h-64 rounded-3xl bg-slate-100 animate-pulse" /></div>;
  }

  if (state.error) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-600">
          No se pudo leer la báscula de Garmin: {state.error}
          {onOpenConnections && (
            <button onClick={onOpenConnections} className="ml-2 font-semibold text-blue-600 hover:underline">
              Revisar conexión
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!smoothed.length) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-600">
          No hay pesadas en Garmin Connect en este rango. Hace falta una báscula vinculada
          (Index S2 o similar) o registrar el peso a mano en la app de Garmin.
        </div>
      </div>
    );
  }

  const chartData = smoothed.map((r) => ({ ...r, ts: Date.parse(r.date + 'T12:00:00') }));
  const weightsOnly = smoothed.map((r) => r.weight_kg);
  const yMin = Math.floor(Math.min(...weightsOnly) - 0.5);
  const yMax = Math.ceil(Math.max(...weightsOnly) + 0.5);
  const corrText = describeCorrelation(corr.r);

  return (
    <div className="space-y-5">
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Peso (media 7 d)" value={fmtKg(last.avg7)} unit="kg" sub={`Última pesada ${shortDate(last.date)}: ${fmtKg(last.weight_kg)} kg`} />
        <Tile label="Cambio 30 días" value={fmtDelta(changeOver(smoothed, 30))} unit="kg" />
        <Tile label="Cambio 90 días" value={fmtDelta(changeOver(smoothed, 90))} unit="kg" />
        <Tile
          label="Grasa corporal"
          value={lastComp ? lastComp.body_fat_pct.toFixed(1) : '—'}
          unit={lastComp ? '%' : null}
          sub={lastComp?.muscle_mass_kg != null ? `Masa muscular ${fmtKg(lastComp.muscle_mass_kg)} kg` : 'La báscula no da composición'}
        />
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5">
        <p className="text-xs text-slate-500 mb-3">
          Puntos: cada pesada. Línea: media móvil de 7 días — el peso de un día suelto oscila
          ±1 kg por agua y glucógeno, la tendencia es lo que cuenta.
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.hairline} vertical={false} />
              <XAxis
                dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
                tickFormatter={(ts) => new Date(ts).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })}
                tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={30}
              />
              <YAxis domain={[yMin, yMax]} tick={AXIS_TICK} tickLine={false} axisLine={false} unit=" kg" width={60} />
              <Tooltip
                labelFormatter={(ts) => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                formatter={(v, name) => [`${Number(v).toFixed(1)} kg`, name === 'avg7' ? 'Media 7 d' : 'Pesada']}
              />
              <Scatter dataKey="weight_kg" fill={COLORS.inkFaint} isAnimationActive={false} />
              <Line dataKey="avg7" stroke={COLORS.signal} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-800">Peso y eficiencia aeróbica</h3>
        {corr.months.length < 4 ? (
          <p className="text-sm text-slate-500">
            Hacen falta al menos 4 meses con pesadas y 3 rodajes comparables cada uno para cruzar
            peso y eficiencia ({corr.months.length} de 4). Prueba con un rango más largo.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-700">
              {corrText} <span className="text-slate-500">(r = {corr.r}, {corr.months.length} meses)</span>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-xs text-slate-500 text-left">
                    <th className="py-1 pr-4 font-semibold">Mes</th>
                    <th className="py-1 pr-4 font-semibold">Peso medio</th>
                    <th className="py-1 pr-4 font-semibold">EF (m/latido)</th>
                    <th className="py-1 font-semibold">Rodajes</th>
                  </tr>
                </thead>
                <tbody>
                  {corr.months.slice(-12).reverse().map((m) => (
                    <tr key={m.month} className="border-t border-slate-100">
                      <td className="py-1 pr-4">{m.month}</td>
                      <td className="py-1 pr-4">{fmtKg(m.weight_kg)} kg</td>
                      <td className="py-1 pr-4">{m.ef.toFixed(2)}</td>
                      <td className="py-1">{m.runs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
