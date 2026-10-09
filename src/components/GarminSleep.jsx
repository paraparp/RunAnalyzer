import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { MoonIcon } from '@heroicons/react/24/outline';
import { formatMinutesHm } from '../lib/timeFormat';
import { readSleep, SYNC_COMPLETE_EVENT } from '../lib/garminHealthStore';
import { useEffect } from 'react';
import { COLORS, AXIS_TICK } from '../lib/palette';
import { useSearchParams } from 'react-router-dom';
import ExpandableChart from './ExpandableChart';

const StatCard = ({ label, value, unit, sub, accent = "slate", delay = 0 }) => {
  const accentMap = {
    orange: "text-orange-500 bg-orange-500/10",
    red:    "text-rose-500 bg-rose-500/10",
    blue:   "text-blue-500 bg-blue-500/10",
    green:  "text-emerald-500 bg-emerald-500/10",
    slate:  "text-slate-800 bg-slate-800/10",
  };
  const colorMap = {
    orange: "text-orange-600",
    red:    "text-rose-600",
    blue:   "text-blue-600",
    green:  "text-emerald-600",
    slate:  "text-slate-800",
  };
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 flex flex-col gap-2 relative overflow-hidden"
    >
      <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full blur-2xl ${accentMap[accent] || "bg-slate-100"}`} />
      <span className="text-xs text-slate-500 font-semibold tracking-wider uppercase relative z-10">{label}</span>
      <div className={`text-3xl font-extrabold leading-tight tracking-tight relative z-10 ${colorMap[accent] || "text-slate-800"}`}>
        {value}
        {unit && <span className="text-sm font-semibold text-slate-500 ml-1">{unit}</span>}
      </div>
      {sub && <span className="text-xs font-medium text-slate-500 relative z-10">{sub}</span>}
    </motion.div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Salud › Sueño. Vivía al final de `GarminCardiac`, que ya mezclaba integración,
// readiness, tendencias cardíacas y adaptación: el sueño no es una métrica
// cardíaca y no tiene por qué compartir pantalla con ellas. Lee del almacén, como
// el resto de vistas de Garmin desde la fase 2.
// ─────────────────────────────────────────────────────────────────────────────

export default function GarminSleep() {
  const [sleepData, setSleepData] = useState(() => readSleep());

  useEffect(() => {
    const reload = () => setSleepData(readSleep());
    window.addEventListener(SYNC_COMPLETE_EVENT, reload);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, reload);
  }, []);

  if (!sleepData?.length) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
        Todavía no hay datos de sueño de Garmin. Sincroniza en Ajustes › Conexiones.
      </div>
    );
  }

  return <SleepSection sleepData={sleepData} />;
}

// ---------------------------------------------------------------------------
// Sleep section component
// ---------------------------------------------------------------------------
const QUALITY_LABEL = {
  EXCELLENT: 'Excelente',
  GOOD:      'Buena',
  FAIR:      'Regular',
  POOR:      'Pobre',
};

const fmtDur = (min) => formatMinutesHm(min);

function SleepSection({ sleepData }) {
  // `?focus=sleep` (desde la portada) abre el gráfico ya ampliado; al cerrarlo se
  // quita de la URL para que recargar no lo reabra.
  const [searchParams, setSearchParams] = useSearchParams();
  const [expanded, setExpanded] = useState(() => searchParams.get('focus') === 'sleep');
  const onExpandedChange = (o) => {
    setExpanded(o);
    if (!o && searchParams.has('focus')) {
      setSearchParams((sp) => { sp.delete('focus'); return sp; }, { replace: true });
    }
  };
  const [view, setView] = useState('score'); // 'score' | 'stages'

  const recentWeeks = sleepData.slice(-12);

  const avgScore = sleepData.length
    ? Math.round(sleepData.reduce((s, w) => s + (w.score ?? 0), 0) / sleepData.filter(w => w.score).length)
    : null;
  const avgDur = sleepData.filter(w => w.durationMin).length
    ? Math.round(sleepData.reduce((s, w) => s + (w.durationMin ?? 0), 0) / sleepData.filter(w => w.durationMin).length)
    : null;
  const latestWeek = sleepData[sleepData.length - 1];

  const chartData = recentWeeks.map(w => ({
    label: w.weekStart.slice(5), // MM-DD
    score:  w.score,
    deep:   w.deepMin,
    rem:    w.remMin,
    light:  w.lightMin,
    awake:  w.awakeMin,
    dur:    w.durationMin,
  }));

  const viewPills = (
    <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
      {[['score','Puntuación'],['stages','Fases']].map(([v, label]) => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
            view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center">
          <MoonIcon className="w-4 h-4 text-indigo-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900 leading-tight">Sueño · Garmin</h2>
          <p className="text-xs text-slate-500">Estadísticas semanales</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Puntuación media" value={avgScore ?? '—'} unit={avgScore ? '/100' : ''} accent="blue" />
        <StatCard label="Duración media" value={fmtDur(avgDur)} accent="slate" />
        <StatCard
          label="Última semana"
          value={latestWeek?.score ?? '—'}
          unit={latestWeek?.score ? '/100' : ''}
          accent={latestWeek?.score >= 80 ? 'green' : latestWeek?.score >= 60 ? 'blue' : 'orange'}
          sub={latestWeek?.quality ? (QUALITY_LABEL[latestWeek.quality] ?? latestWeek.quality) : undefined}
        />
        <StatCard
          label="Sueño profundo"
          value={latestWeek?.deepMin != null ? fmtDur(latestWeek.deepMin) : '—'}
          accent="blue"
          sub={latestWeek?.remMin != null ? `REM: ${fmtDur(latestWeek.remMin)}` : undefined}
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          {viewPills}
          <span className="ml-auto text-xs text-slate-500">últimas {recentWeeks.length} semanas</span>
        </div>

        <ExpandableChart
          open={expanded}
          onOpenChange={onExpandedChange}
          className="h-[240px]"
          title={view === 'score' ? 'Puntuación de sueño' : 'Fases del sueño'}
          subtitle={`últimas ${recentWeeks.length} semanas`}
          toolbar={viewPills}
        >
        {view === 'score' ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorSleepScore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.seriesIndigo} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={COLORS.seriesIndigo} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.hairline} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.inkMuted, fontWeight: 500 }} tickLine={false} axisLine={false} tickMargin={10} />
              <YAxis domain={[40, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="bg-white/90 backdrop-blur-xl border border-white/40 rounded-2xl p-4 text-xs shadow-xl">
                      <p className="font-bold text-slate-800 mb-2 border-b border-slate-100 pb-1">Sem {label}</p>
                      <p className="text-indigo-600 font-extrabold text-lg">{payload[0]?.value} <span className="text-sm font-semibold text-slate-500">/ 100</span></p>
                      {payload[0]?.payload?.dur && <p className="text-slate-500 font-medium mt-1">{fmtDur(payload[0].payload.dur)}</p>}
                    </motion.div>
                  ) : null
                }
              />
              <ReferenceLine y={80} stroke={COLORS.good} strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: 'Excelente', position: 'insideTopLeft', fontSize: 11, fill: COLORS.good, fontWeight: 600 }} />
              <ReferenceLine y={60} stroke={COLORS.caution} strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: 'Regular', position: 'insideTopLeft', fontSize: 11, fill: COLORS.caution, fontWeight: 600 }} />
              <Area type="monotone" dataKey="score" name="Puntuación" stroke={COLORS.seriesIndigo} fill="url(#colorSleepScore)" strokeWidth={3}
                dot={{ r: 0 }} activeDot={{ r: 6, fill: COLORS.seriesIndigo, stroke: COLORS.paper, strokeWidth: 2, shadow: '0 0 10px rgba(99,102,241,0.5)' }} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.hairline} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.hairline }} />
              <YAxis tickFormatter={v => `${Math.floor(v/60)}h`} tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs shadow-lg space-y-0.5">
                      <p className="font-semibold text-slate-700 mb-1">Sem {label}</p>
                      {payload.map(p => (
                        <div key={p.dataKey} className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: p.fill }} />
                          <span className="text-slate-500">{p.name}:</span>
                          <span className="font-bold text-slate-700">{fmtDur(p.value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="deep"  name="Profundo" stackId="s" fill={COLORS.signalBright} radius={[0,0,0,0]} />
              <Bar dataKey="rem"   name="REM"      stackId="s" fill={COLORS.seriesViolet} />
              <Bar dataKey="light" name="Ligero"   stackId="s" fill={COLORS.signalPale} />
              <Bar dataKey="awake" name="Despierto" stackId="s" fill="#fca5a5" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        </ExpandableChart>
      </div>
    </div>
  );
}

