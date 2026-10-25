import {
  ArrowTrendingUpIcon, ArrowUpIcon, ArrowDownIcon, FireIcon,
  ExclamationTriangleIcon, CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Card, Text } from '@tremor/react';
import { fmt1, loadPhase } from '../lib/statusStats';
import { COLORS } from '../lib/palette';

// ─────────────────────────────────────────────────────────────────────────────
// Átomos del estado del atleta, compartidos por el hero de Hoy (`StatusHero`) y
// la comparativa de Carga (`StatusOverview`). Estaban dentro de
// `StatusSnapshot.jsx` junto a los dos cálculos y a cuatro pestañas; viven aquí
// para que las dos vistas que salieron de aquel fichero no acaben con dos
// tarjetas distintas para el mismo número.
// ─────────────────────────────────────────────────────────────────────────────

// ─── sub-components ───────────────────────────────────────────────────────────

export function PhaseBanner({ tsb, acwr, garmin }) {
  // Los cortes del TSB viven en lib/statusStats (los comparte con la portada);
  // aquí solo queda cómo se pinta cada fase.
  const { key, label: phase, description } = loadPhase(tsb);
  const STYLE = {
    // Mismos colores que la tarjeta de estado del PMC.
    transition: { color: 'text-sky-700 dark:text-sky-300',     borderColor: 'border-sky-200 dark:border-sky-300/25',     bg: 'bg-sky-50 dark:bg-sky-400/10',     Icon: ArrowTrendingUpIcon },
    fresh:      { color: 'text-emerald-700 dark:text-emerald-300', borderColor: 'border-emerald-200 dark:border-emerald-300/25', bg: 'bg-emerald-50 dark:bg-emerald-400/10', Icon: CheckCircleIcon },
    optimal:    { color: 'text-teal-700 dark:text-teal-300',    borderColor: 'border-teal-200 dark:border-teal-300/25',    bg: 'bg-teal-50 dark:bg-teal-400/10',    Icon: CheckCircleIcon },
    loaded:     { color: 'text-amber-700 dark:text-amber-300',   borderColor: 'border-amber-200 dark:border-amber-300/25',   bg: 'bg-amber-50 dark:bg-amber-400/10',   Icon: FireIcon },
    overloaded: { color: 'text-rose-700 dark:text-rose-300',    borderColor: 'border-rose-200 dark:border-rose-300/25',    bg: 'bg-rose-50 dark:bg-rose-400/10',    Icon: ExclamationTriangleIcon },
  };
  const { color, borderColor, bg, Icon } = STYLE[key];

  return (
    <div className={`rounded-xl border ${borderColor} ${bg} p-4 flex items-center justify-between gap-4 flex-wrap`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${color} shrink-0`} />
        <div>
          <span className={`font-black text-lg ${color}`}>{phase}</span>
          <span className="text-slate-500 dark:text-white/55 text-sm ml-2">{description}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs flex-wrap">
        <div className="text-center">
          <div className="text-slate-500 dark:text-white/55 uppercase font-bold tracking-wide">TSB</div>
          <div className={`text-xl font-black ${color}`}>{fmt1(tsb)}</div>
        </div>
        <div className="text-center">
          <div className="text-slate-500 dark:text-white/55 uppercase font-bold tracking-wide">ACWR</div>
          <div className={`text-xl font-black ${acwr > 1.5 ? 'text-rose-600 dark:text-rose-300' : acwr > 1.3 ? 'text-amber-600 dark:text-amber-300' : 'text-slate-700 dark:text-white/75'}`}>
            {acwr.toFixed(2)}
          </div>
        </div>
        {garmin?.currentRHR != null && (
          <div className="text-center">
            <div className="text-slate-500 dark:text-white/55 uppercase font-bold tracking-wide">FC Reposo</div>
            <div className={`text-xl font-black ${
              garmin.rhrAllTimeMin && garmin.currentRHR <= garmin.rhrAllTimeMin + 3 ? 'text-emerald-600 dark:text-emerald-300'
              : garmin.currentRHR > (garmin.rhr28avg || garmin.currentRHR) + 5 ? 'text-rose-600 dark:text-rose-300'
              : 'text-slate-700 dark:text-white/75'
            }`}>
              {garmin.currentRHR} <span className="text-xs font-normal">bpm</span>
            </div>
          </div>
        )}
        {garmin?.currentRec != null && (
          <div className="text-center">
            <div className="text-slate-500 dark:text-white/55 uppercase font-bold tracking-wide">
              {garmin.hasHRV ? 'VFC (RMSSD)' : 'Body Battery'}
            </div>
            {garmin.hasHRV ? (
              <>
                <div className={`text-xl font-black ${
                  garmin.hrvDeviation > 5  ? 'text-emerald-600 dark:text-emerald-300'
                  : garmin.hrvDeviation < -10 ? 'text-rose-600 dark:text-rose-300'
                  : 'text-amber-600 dark:text-amber-300'
                }`}>
                  {Math.round(garmin.currentRec)}<span className="text-xs font-normal"> ms</span>
                </div>
                {garmin.hrvDeviation != null && (
                  <div className={`text-xs font-bold ${garmin.hrvDeviation >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-500'}`}>
                    {garmin.hrvDeviation >= 0 ? '+' : ''}{garmin.hrvDeviation}% vs baseline
                  </div>
                )}
              </>
            ) : (
              <div className={`text-xl font-black ${
                garmin.currentRec >= 80 ? 'text-emerald-600 dark:text-emerald-300'
                : garmin.currentRec >= 50 ? 'text-amber-600 dark:text-amber-300'
                : 'text-rose-600 dark:text-rose-300'
              }`}>
                {garmin.currentRec}<span className="text-xs font-normal">/100</span>
              </div>
            )}
          </div>
        )}
        {(acwr > 1.5 || (garmin?.currentRHR != null && garmin.rhr28avg && garmin.currentRHR > garmin.rhr28avg + 5)) && (
          <div className="flex items-center gap-1 bg-rose-100 dark:bg-rose-400/10 text-rose-700 dark:text-rose-300 px-2 py-1 rounded-lg font-semibold text-xs">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            {acwr > 1.5 ? 'Riesgo lesión' : 'FC elevada'}
          </div>
        )}
        {garmin?.hasHRV && garmin.hrvDeviation != null && garmin.hrvDeviation < -10 && (
          <div className="flex items-center gap-1 bg-rose-100 dark:bg-rose-400/10 text-rose-700 dark:text-rose-300 px-2 py-1 rounded-lg font-semibold text-xs">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            VFC suprimida
          </div>
        )}
        {!garmin?.hasHRV && garmin?.currentRec != null && garmin.currentRec < 30 && (
          <div className="flex items-center gap-1 bg-amber-100 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300 px-2 py-1 rounded-lg font-semibold text-xs">
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
    blue:    { bg: 'bg-teal-50 dark:bg-teal-400/10',    text: 'text-teal-700 dark:text-teal-300',    icon: 'text-blue-500' },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-400/10', text: 'text-emerald-700 dark:text-emerald-300', icon: 'text-emerald-500' },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-400/10',   text: 'text-amber-700 dark:text-amber-300',   icon: 'text-amber-500' },
    rose:    { bg: 'bg-rose-50 dark:bg-rose-400/10',    text: 'text-rose-700 dark:text-rose-300',    icon: 'text-rose-500' },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <Card className="p-5 ring-1 ring-slate-200 dark:ring-white/10 shadow-sm bg-white dark:bg-white/[0.03] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/55">{label}</Text>
        {Icon && <div className={`p-1.5 rounded-lg ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>}
      </div>
      <div className="flex items-end gap-2">
        <span className={`text-4xl font-black leading-none ${c.text}`}>{value}</span>
        {unit && <span className="text-sm font-semibold text-slate-500 dark:text-white/55 pb-0.5">{unit}</span>}
        {trendDelta != null && (
          <span className={`ml-1 pb-0.5 text-xs font-bold flex items-center gap-0.5 ${trendDelta >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-500'}`}>
            {trendDelta >= 0 ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />}
            {Math.abs(trendDelta).toFixed(1)}
          </span>
        )}
      </div>
      <div className="space-y-1 border-t border-slate-100 dark:border-white/10 pt-3">
        {subRows.map((row, i) => (
          <div key={i} className="flex justify-between items-center text-xs">
            <span className="text-slate-500 dark:text-white/55">{row.label}</span>
            <span className="font-semibold text-slate-600 dark:text-white/75">{row.value}</span>
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
  if (!best || !now) return <span className="text-slate-300 dark:text-white/40 text-xs">—</span>;
  const pct = lowerIsBetter ? (best / now) * 100 : (now / best) * 100;
  const clamped = Math.min(pct, 100);
  const color = clamped >= 80 ? 'bg-emerald-100 dark:bg-emerald-400/10 text-emerald-700 dark:text-emerald-300' : clamped >= 50 ? 'bg-amber-100 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300' : 'bg-rose-100 dark:bg-rose-400/10 text-rose-700 dark:text-rose-300';
  return <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${color}`}>{Math.round(clamped)}%</span>;
}

export function MiniSparkline({ data, color = COLORS.signalBright }) {
  if (!data || data.length < 2) return <span className="text-slate-300 dark:text-white/40 text-xs">—</span>;
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
    <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden text-xs shrink-0">
      {options.map(opt => (
        <button
          key={opt.v}
          onClick={() => onChange(opt.v)}
          className={`px-3 py-1.5 transition-colors font-medium ${
            value === opt.v
              ? 'bg-slate-800 text-white'
              : 'bg-white dark:bg-white/[0.03] text-slate-500 dark:text-white/55 hover:bg-slate-50 dark:hover:bg-white/[0.05]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
