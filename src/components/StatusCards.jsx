import {
  ArrowTrendingUpIcon, ArrowUpIcon, ArrowDownIcon, FireIcon,
  ExclamationTriangleIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Card, Text } from '@tremor/react';
import { fmt1 } from '../lib/statusStats';

// ─────────────────────────────────────────────────────────────────────────────
// Átomos del estado del atleta, compartidos por el hero de Hoy (`StatusHero`) y
// la comparativa de Carga (`StatusOverview`). Estaban dentro de
// `StatusSnapshot.jsx` junto a los dos cálculos y a cuatro pestañas; viven aquí
// para que las dos vistas que salieron de aquel fichero no acaben con dos
// tarjetas distintas para el mismo número.
// ─────────────────────────────────────────────────────────────────────────────

// ─── sub-components ───────────────────────────────────────────────────────────

export function PhaseBanner({ tsb, acwr, garmin }) {
  let phase, color, borderColor, bg, Icon, description;

  if (tsb > 5) {
    phase = 'En forma'; color = 'text-emerald-700'; borderColor = 'border-emerald-500';
    bg = 'bg-emerald-50'; Icon = CheckCircleIcon;
    description = 'Forma positiva — listo para competir o atacar una sesión clave';
  } else if (tsb >= 0) {
    phase = 'Acumulando'; color = 'text-amber-700'; borderColor = 'border-amber-400';
    bg = 'bg-amber-50'; Icon = ArrowTrendingUpIcon;
    description = 'Cargando trabajo, ligera fatiga acumulada';
  } else if (tsb >= -10) {
    phase = 'Cargando'; color = 'text-orange-700'; borderColor = 'border-orange-500';
    bg = 'bg-orange-50'; Icon = FireIcon;
    description = 'Bloque de carga activo — monitorizar recuperación';
  } else {
    phase = 'Fatiga alta'; color = 'text-rose-700'; borderColor = 'border-rose-500';
    bg = 'bg-rose-50'; Icon = ExclamationTriangleIcon;
    description = 'Fatiga elevada — considerar recuperación activa o descanso';
  }

  return (
    <div className={`rounded-xl border-l-4 ${borderColor} ${bg} p-4 flex items-center justify-between gap-4 flex-wrap`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${color} shrink-0`} />
        <div>
          <span className={`font-black text-lg ${color}`}>{phase}</span>
          <span className="text-slate-500 text-sm ml-2">{description}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs flex-wrap">
        <div className="text-center">
          <div className="text-slate-400 uppercase font-bold tracking-wide">TSB</div>
          <div className={`text-xl font-black ${color}`}>{fmt1(tsb)}</div>
        </div>
        <div className="text-center">
          <div className="text-slate-400 uppercase font-bold tracking-wide">ACWR</div>
          <div className={`text-xl font-black ${acwr > 1.5 ? 'text-rose-600' : acwr > 1.3 ? 'text-amber-600' : 'text-slate-700'}`}>
            {acwr.toFixed(2)}
          </div>
        </div>
        {garmin?.currentRHR != null && (
          <div className="text-center">
            <div className="text-slate-400 uppercase font-bold tracking-wide">FC Reposo</div>
            <div className={`text-xl font-black ${
              garmin.rhrAllTimeMin && garmin.currentRHR <= garmin.rhrAllTimeMin + 3 ? 'text-emerald-600'
              : garmin.currentRHR > (garmin.rhr28avg || garmin.currentRHR) + 5 ? 'text-rose-600'
              : 'text-slate-700'
            }`}>
              {garmin.currentRHR} <span className="text-xs font-normal">bpm</span>
            </div>
          </div>
        )}
        {garmin?.currentRec != null && (
          <div className="text-center">
            <div className="text-slate-400 uppercase font-bold tracking-wide">
              {garmin.hasHRV ? 'VFC (RMSSD)' : 'Body Battery'}
            </div>
            {garmin.hasHRV ? (
              <>
                <div className={`text-xl font-black ${
                  garmin.hrvDeviation > 5  ? 'text-emerald-600'
                  : garmin.hrvDeviation < -10 ? 'text-rose-600'
                  : 'text-amber-600'
                }`}>
                  {Math.round(garmin.currentRec)}<span className="text-xs font-normal"> ms</span>
                </div>
                {garmin.hrvDeviation != null && (
                  <div className={`text-xs font-bold ${garmin.hrvDeviation >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {garmin.hrvDeviation >= 0 ? '+' : ''}{garmin.hrvDeviation}% vs baseline
                  </div>
                )}
              </>
            ) : (
              <div className={`text-xl font-black ${
                garmin.currentRec >= 80 ? 'text-emerald-600'
                : garmin.currentRec >= 50 ? 'text-amber-600'
                : 'text-rose-600'
              }`}>
                {garmin.currentRec}<span className="text-xs font-normal">/100</span>
              </div>
            )}
          </div>
        )}
        {(acwr > 1.5 || (garmin?.currentRHR != null && garmin.rhr28avg && garmin.currentRHR > garmin.rhr28avg + 5)) && (
          <div className="flex items-center gap-1 bg-rose-100 text-rose-700 px-2 py-1 rounded-lg font-semibold text-xs">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            {acwr > 1.5 ? 'Riesgo lesión' : 'FC elevada'}
          </div>
        )}
        {garmin?.hasHRV && garmin.hrvDeviation != null && garmin.hrvDeviation < -10 && (
          <div className="flex items-center gap-1 bg-rose-100 text-rose-700 px-2 py-1 rounded-lg font-semibold text-xs">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            VFC suprimida
          </div>
        )}
        {!garmin?.hasHRV && garmin?.currentRec != null && garmin.currentRec < 30 && (
          <div className="flex items-center gap-1 bg-amber-100 text-amber-700 px-2 py-1 rounded-lg font-semibold text-xs">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            Recuperación baja
          </div>
        )}
      </div>
    </div>
  );
}

export function HeroCard({ label, value, unit, subRows, trendDelta, icon: Icon, color = 'blue' }) {
  const colorMap = {
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    icon: 'text-blue-500' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-500' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   icon: 'text-amber-500' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    icon: 'text-rose-500' },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Text className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</Text>
        {Icon && <div className={`p-1.5 rounded-lg ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>}
      </div>
      <div className="flex items-end gap-2">
        <span className={`text-4xl font-black leading-none ${c.text}`}>{value}</span>
        {unit && <span className="text-sm font-semibold text-slate-400 pb-0.5">{unit}</span>}
        {trendDelta != null && (
          <span className={`ml-1 pb-0.5 text-xs font-bold flex items-center gap-0.5 ${trendDelta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {trendDelta >= 0 ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />}
            {Math.abs(trendDelta).toFixed(1)}
          </span>
        )}
      </div>
      <div className="space-y-1 border-t border-slate-100 pt-3">
        {subRows.map((row, i) => (
          <div key={i} className="flex justify-between items-center text-xs">
            <span className="text-slate-400">{row.label}</span>
            <span className="font-semibold text-slate-600">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Cuánto queda del mejor registro histórico, en porcentaje. Es componente (y no
// una función que devuelve JSX) porque el fichero exporta componentes y mezclar
// ambas cosas rompe el fast-refresh de Vite.
export function PctPill({ now, best, lowerIsBetter = false }) {
  if (!best || !now) return <span className="text-slate-300 text-xs">—</span>;
  const pct = lowerIsBetter ? (best / now) * 100 : (now / best) * 100;
  const clamped = Math.min(pct, 100);
  const color = clamped >= 80 ? 'bg-emerald-100 text-emerald-700' : clamped >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700';
  return <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${color}`}>{Math.round(clamped)}%</span>;
}

export function MiniSparkline({ data, color = '#3b82f6' }) {
  if (!data || data.length < 2) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <ResponsiveContainer width={64} height={24}>
      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RangeSelector({ value, onChange, options }) {
  return (
    <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs shrink-0">
      {options.map(opt => (
        <button
          key={opt.v}
          onClick={() => onChange(opt.v)}
          className={`px-3 py-1.5 transition-colors font-medium ${
            value === opt.v
              ? 'bg-slate-800 text-white'
              : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
