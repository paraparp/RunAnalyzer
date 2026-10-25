import { Card, Title, Text } from '@tremor/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ComposedChart, BarChart, Bar, Line, Area, ScatterChart, Scatter, ZAxis, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot
} from 'recharts';
import {
  ArrowTrendingUpIcon, SparklesIcon, BoltIcon,
  ExclamationTriangleIcon,
  XMarkIcon, ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import { activityDayKey } from '../lib/trainingLoad';
import useCalibratedPMC from '../hooks/useCalibratedPMC';
import useTimeScope from '../hooks/useTimeScope';
import { scopeMonths } from '../lib/timeScope';
import { formatPaceFromMinPerKm } from '../lib/timeFormat';
import { monthShort } from '../lib/monthLabels';
import { isRun, paceStr, timeStr, acwrZone, rampLevel, formZone } from '../lib/statusStats';
import { COLORS, AXIS_TICK } from '../lib/palette';



// ── PMC ────────────────────────────────────────────────────────────────────────
// Al estilo de Fitness & Freshness de Strava: no hay tooltip flotante; el cursor
// vertical recorre los tres paneles y la cabecera muestra los valores del día
// señalado (o de hoy). Va en su propio componente para que el estado del hover
// solo repinte la gráfica, no la pestaña entera.
// Paleta propia del PMC: más viva que la de estado, al estilo Strava.
const PMC = {
  fitness: COLORS.seriesIndigo, fitnessTo: COLORS.seriesSky, fatigue: COLORS.seriesPink, load: COLORS.seriesViolet,
  positive: COLORS.seriesTeal, negative: COLORS.elevated,
  transition: COLORS.seriesSky, fresh: COLORS.seriesTeal, loaded: COLORS.caution, overloaded: COLORS.risk,
};
const NoTooltip = () => null;
const AXIS_W = 34;
const CURSOR = { stroke: COLORS.inkFaint, strokeWidth: 1, strokeDasharray: '3 3' };

// Mismos cortes que lib/statusStats › formZone.
const FORM_ZONES = [
  { key: 'transition', y1: 25,   y2: 999, color: PMC.transition },
  { key: 'fresh',      y1: 5,    y2: 25,  color: PMC.fresh },
  { key: 'optimal',    y1: -10,  y2: 5,   color: PMC.fitness },
  { key: 'loaded',     y1: -30,  y2: -10, color: PMC.loaded },
  { key: 'overloaded', y1: -999, y2: -30, color: PMC.overloaded },
];
const zoneColor = (tsb) => FORM_ZONES.find(z => z.key === (formZone(tsb) ?? 'optimal')).color;

function PMCChart({ data, months, offsetMonths, canGoBack, setOffsetMonths, peakCTL, peakCTLYear }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language.startsWith('es');
  const [hoverDate, setHoverDate] = useState(null);
  // Día fijado al pinchar en la carga diaria: deja las sesiones ancladas y
  // enlazadas a Strava.
  const [selectedDay, setSelectedDay] = useState(null);

  const byDate = useMemo(() => new Map(data.map(d => [d.date, d])), [data]);
  const maxLoad = useMemo(() => data.reduce((m, d) => Math.max(m, d.load || 0), 0), [data]);

  // Dominio del TSB ajustado a los datos y punto de corte del degradado
  // verde/rojo. El relleno incluye la base 0 en su caja; el trazo, no.
  const { tsbDomain, fillSplit, strokeSplit } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const d of data) {
      const v = d.Forma ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!isFinite(lo)) { lo = 0; hi = 0; }
    const clamp = (x) => Math.min(Math.max(x, 0), 1);
    const fLo = Math.min(lo, 0), fHi = Math.max(hi, 0);
    return {
      tsbDomain: [Math.min(-40, Math.floor((lo - 5) / 10) * 10), Math.max(30, Math.ceil((hi + 5) / 10) * 10)],
      fillSplit: fHi - fLo > 0 ? clamp(fHi / (fHi - fLo)) : 0.5,
      strokeSplit: hi - lo > 0 ? clamp(hi / (hi - lo)) : (hi >= 0 ? 1 : 0),
    };
  }, [data]);

  if (!data.length) return null;

  const first = data[0];
  const last = data[data.length - 1];
  const shown = (hoverDate && byDate.get(hoverDate)) || last;
  const isLatest = shown === last;
  const isToday = isLatest && offsetMonths === 0;

  const onMove = (s) => {
    const idx = s?.activeTooltipIndex ?? s?.activeIndex;
    const date = s?.activeLabel ?? data[Number(idx)]?.date;
    if (date && date !== hoverDate) setHoverDate(date);
  };
  const onLeave = () => setHoverDate(null);
  const chartEvents = { onMouseMove: onMove, onMouseLeave: onLeave };

  const MONTH_SHORT = monthShort(i18n.language);
  const xTickFormatter = v => {
    const d = new Date(v);
    return `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  };
  const xInterval = Math.max(Math.floor(data.length / 8), 1);

  const fmtSigned = (v) => (v > 0 ? '+' : '') + v;
  const ctlDelta = Math.round((shown.Fitness - first.Fitness) * 10) / 10;
  const formKey = formZone(shown.Forma) ?? 'optimal';
  const formColor = zoneColor(shown.Forma);
  const dateLabel = isToday
    ? (es ? 'Hoy' : 'Today')
    : new Date(shown.date).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const acts = shown.acts || [];

  const metrics = [
    { label: es ? 'Fitness' : 'Fitness', abbr: 'CTL', value: Math.round(shown.Fitness), color: PMC.fitness,
      sub: <span className={ctlDelta >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}>
        {fmtSigned(ctlDelta)} <span className="text-slate-500 dark:text-white/55 font-medium">{es ? 'en el periodo' : 'this period'}</span>
      </span> },
    { label: es ? 'Fatiga' : 'Fatigue', abbr: 'ATL', value: Math.round(shown.Fatiga), color: PMC.fatigue,
      sub: <span className="text-slate-500 dark:text-white/55 font-medium">
        {shown.load > 0 ? `${es ? 'Carga del día' : 'Day load'} ${Math.round(shown.load)}` : (es ? 'Descanso' : 'Rest day')}
      </span> },
    { label: es ? 'Forma' : 'Form', abbr: 'TSB', value: fmtSigned(Math.round(shown.Forma)), color: formColor,
      sub: <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-bold"
        style={{ background: `${formColor}1a`, color: formColor }}>{t(`fitness.status.${formKey}`)}</span> },
  ];

  const navBtn = 'p-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/55 hover:bg-slate-50 dark:hover:bg-white/[0.05] hover:text-slate-700 dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed';
  const zonesInView = FORM_ZONES
    .map(z => ({ ...z, y1: Math.max(z.y1, tsbDomain[0]), y2: Math.min(z.y2, tsbDomain[1]) }))
    .filter(z => z.y2 > z.y1);

  return (
    <Card className="shadow-lg border-slate-200 dark:border-white/10 overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-start gap-3 mb-5">
        <div>
          <Title className="text-slate-800 dark:text-white font-bold mb-0.5">{t('fitness.pmc.title')}</Title>
          <Text className="text-slate-500 dark:text-white/55 text-xs">{t('fitness.pmc.desc')}</Text>
        </div>
        {months != null && (
          <div className="flex gap-1 shrink-0">
            <button onClick={() => setOffsetMonths(p => p + months)} disabled={!canGoBack} className={navBtn}
              aria-label={es ? 'Periodo anterior' : 'Previous period'}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
              </svg>
            </button>
            <button onClick={() => setOffsetMonths(p => Math.max(p - months, 0))} disabled={offsetMonths === 0} className={navBtn}
              aria-label={es ? 'Periodo siguiente' : 'Next period'}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Lectura en vivo: sigue al cursor, vuelve a hoy al salir */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-2 min-h-[20px]">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-white/75">{dateLabel}</span>
        {acts.length > 0 ? (
          <span className="text-xs text-slate-500 dark:text-white/55 truncate max-w-full">
            · {acts[0].name} · {(acts[0].distance / 1000).toFixed(1)} km
            {acts.length > 1 && ` +${acts.length - 1}`}
          </span>
        ) : (
          <span className="text-xs text-slate-500 dark:text-white/55">· {es ? 'Sin actividad' : 'No activity'}</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
        {metrics.map((m) => (
          <div key={m.abbr} className="rounded-2xl px-3 py-3 sm:px-4 border transition-colors"
            style={{ background: `linear-gradient(135deg, ${m.color}14, ${m.color}05)`, borderColor: `${m.color}2e` }}>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
              <span className="text-label font-bold uppercase text-slate-500 dark:text-white/55">
                {m.label} <span className="hidden sm:inline text-slate-500 dark:text-white/55">· {m.abbr}</span>
              </span>
            </div>
            <p className="text-2xl sm:text-4xl font-black tabular-nums leading-tight mt-1 transition-colors" style={{ color: m.color }}>
              {m.value}
            </p>
            <div className="text-xs font-bold tabular-nums mt-0.5 truncate">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Panel 1 — Fitness (área) y fatiga (línea) */}
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart syncId="pmc" data={data} margin={{ top: 12, right: 4, bottom: 0, left: 0 }} {...chartEvents}>
            <defs>
              <linearGradient id="gradCTL" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={PMC.fitness} stopOpacity={0.38} />
                <stop offset="100%" stopColor={PMC.fitnessTo} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradCTLStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor={PMC.fitnessTo} />
                <stop offset="100%" stopColor={PMC.fitness} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={COLORS.hairlineSoft} vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={AXIS_W}
              domain={[0, d => Math.max(10, Math.ceil((d * 1.12) / 10) * 10)]} tickCount={5} />
            <RechartsTooltip content={NoTooltip} cursor={CURSOR} isAnimationActive={false} />
            {peakCTL > 0 && (
              <ReferenceLine y={peakCTL} stroke={PMC.fitness} strokeDasharray="2 4" strokeOpacity={0.7}
                label={{ value: `${t('fitness.peak_all')} ${peakCTL}`, position: 'insideTopLeft', fontSize: 10, fontWeight: 700, fill: PMC.fitness }} />
            )}
            {peakCTLYear > 0 && Math.abs(peakCTLYear - peakCTL) > 0.5 && (
              <ReferenceLine y={peakCTLYear} stroke={COLORS.caution} strokeDasharray="2 4" strokeOpacity={0.7}
                label={{ value: `${t('fitness.peak_year')} ${peakCTLYear}`, position: 'insideBottomLeft', fontSize: 10, fontWeight: 700, fill: COLORS.cautionDeep }} />
            )}
            <Area type="monotone" dataKey="Fitness" name={t('fitness.ctl')}
              stroke="url(#gradCTLStroke)" strokeWidth={3} fill="url(#gradCTL)"
              dot={false} isAnimationActive={false}
              activeDot={{ r: 5, fill: PMC.fitness, stroke: COLORS.paper, strokeWidth: 2 }} />
            <Line type="monotone" dataKey="Fatiga" name={t('fitness.atl')}
              stroke={PMC.fatigue} strokeWidth={1.75} strokeOpacity={0.9}
              dot={false} isAnimationActive={false}
              activeDot={{ r: 4, fill: PMC.fatigue, stroke: COLORS.paper, strokeWidth: 2 }} />
            {/* Punto final: dónde estás ahora */}
            {!hoverDate && (
              <ReferenceDot x={last.date} y={last.Fitness} r={5} fill={PMC.fitness} stroke={COLORS.paper} strokeWidth={2} />
            )}
            {!hoverDate && (
              <ReferenceDot x={last.date} y={last.Fatiga} r={3.5} fill={PMC.fatigue} stroke={COLORS.paper} strokeWidth={2} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Panel 2 — Carga diaria */}
      <div className="relative h-[56px] w-full border-t border-slate-100 dark:border-white/10">
        <span className="absolute left-0 top-1 text-label font-bold uppercase text-slate-500 dark:text-white/55 pointer-events-none z-10">
          {t('fitness.pmc.daily_load')}
        </span>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart syncId="pmc" data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap={1} {...chartEvents}>
            <XAxis dataKey="date" hide />
            <YAxis orientation="right" tick={false} tickLine={false} axisLine={false} width={AXIS_W} domain={[0, 'dataMax']} />
            <RechartsTooltip content={NoTooltip} cursor={false} isAnimationActive={false} />
            <Bar dataKey="load" maxBarSize={6} radius={[2, 2, 0, 0]} isAnimationActive={false}
              className="cursor-pointer"
              onClick={(d) => setSelectedDay(prev => (prev?.date === d.date ? null : d))}>
              {data.map((entry) => {
                const r = maxLoad > 0 ? (entry.load || 0) / maxLoad : 0;
                const fill = selectedDay?.date === entry.date ? PMC.negative
                  : entry.date === hoverDate ? PMC.fitness : PMC.load;
                const opacity = selectedDay?.date === entry.date || entry.date === hoverDate ? 1 : 0.25 + 0.55 * r;
                return <Cell key={entry.date} fill={fill} fillOpacity={opacity} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Panel 3 — Forma (TSB): verde por encima de 0, rojo por debajo */}
      <div className="relative h-[170px] w-full border-t border-slate-100 dark:border-white/10">
        <span className="absolute left-0 top-1 text-label font-bold uppercase text-slate-500 dark:text-white/55 pointer-events-none z-10">
          {es ? 'Forma · TSB' : 'Form · TSB'}
        </span>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart syncId="pmc" data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} {...chartEvents}>
            <defs>
              <linearGradient id="gradTSBFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset={0}         stopColor={PMC.positive} stopOpacity={0.4} />
                <stop offset={fillSplit} stopColor={PMC.positive} stopOpacity={0.05} />
                <stop offset={fillSplit} stopColor={PMC.negative} stopOpacity={0.05} />
                <stop offset={1}         stopColor={PMC.negative} stopOpacity={0.4} />
              </linearGradient>
              <linearGradient id="gradTSBStroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset={strokeSplit} stopColor={PMC.positive} />
                <stop offset={strokeSplit} stopColor={PMC.negative} />
              </linearGradient>
            </defs>
            {zonesInView.map(z => (
              <ReferenceArea key={z.key} y1={z.y1} y2={z.y2} fill={z.color} fillOpacity={0.07} strokeOpacity={0}
                label={{ value: t(`fitness.status.${z.key}`), position: 'insideRight', fontSize: 9, fontWeight: 700, fill: z.color, opacity: 0.8 }} />
            ))}
            <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false}
              axisLine={{ stroke: COLORS.hairline }} tickFormatter={xTickFormatter} interval={xInterval} minTickGap={24} />
            <YAxis orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false}
              width={AXIS_W} domain={tsbDomain} tickCount={5} />
            <ReferenceLine y={0} stroke={COLORS.inkFaint} strokeWidth={1} />
            <RechartsTooltip content={NoTooltip} cursor={CURSOR} isAnimationActive={false} />
            <Area type="monotone" dataKey="Forma" name={t('fitness.tsb')} baseValue={0}
              stroke="url(#gradTSBStroke)" strokeWidth={2} fill="url(#gradTSBFill)"
              dot={false} isAnimationActive={false}
              activeDot={{ r: 4.5, fill: formColor, stroke: COLORS.paper, strokeWidth: 2 }} />
            {!hoverDate && (
              <ReferenceDot x={last.date} y={last.Forma} r={4} fill={zoneColor(last.Forma)} stroke={COLORS.paper} strokeWidth={2} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Panel actividades del día seleccionado ── */}
      {selectedDay?.acts?.length > 0 && (
        <div className="mt-4 border-t border-slate-100 dark:border-white/10 pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-500 dark:text-white/55 uppercase tracking-wider">
              {new Date(selectedDay.date).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => setSelectedDay(null)} className="p-1 rounded-md text-slate-500 dark:text-white/55 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors">
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {selectedDay.acts.map((a, i) => (
              <a key={i} href={`https://www.strava.com/activities/${a.id}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-white/[0.04] hover:bg-orange-50 border border-transparent hover:border-orange-200 transition-all group"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-white text-xs group-hover:text-orange-600 transition-colors truncate">{a.name}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-500 dark:text-white/55">
                    {a.moving_time > 0 && <span>⏱ {timeStr(a.moving_time)}</span>}
                    {isRun(a)
                      ? (a.average_speed > 0 && <span>⚡ {paceStr(a.average_speed)}/km</span>)
                      : (a.average_speed > 0 && <span>⚡ {(a.average_speed * 3.6).toFixed(1)} km/h</span>)}
                    {a.average_heartrate > 0 && <span>❤️ {Math.round(a.average_heartrate)} bpm</span>}
                    {a.suffer_score > 0 && <span>🔥 SS: {Math.round(a.suffer_score)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="font-bold text-slate-700 dark:text-white/75 text-sm">{(a.distance / 1000).toFixed(1)} km</span>
                  <ArrowTopRightOnSquareIcon className="w-4 h-4 text-slate-300 dark:text-white/40 group-hover:text-orange-400 transition-colors" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
      {!selectedDay && (
        <p className="mt-3 text-xs text-slate-500 dark:text-white/55">
          {es ? 'Pulsa una barra de carga para ver las sesiones de ese día.' : 'Click a load bar to see that day’s sessions.'}
        </p>
      )}
    </Card>
  );
}

// ── Tooltips ─────────────────────────────────────────────────────────────────
// Definidos fuera del componente: declarados dentro del render serían un tipo nuevo
// en cada render y Recharts remontaría el subárbol del tooltip entero.

function ScatterTooltip({ active, payload }) {
  const { i18n } = useTranslation();
  const es = i18n.language.startsWith('es');
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const paceFmt = formatPaceFromMinPerKm(d.pace);
  return (
    <div className="bg-white/95 dark:bg-[#0c0e12]/95 p-4 border border-slate-200 dark:border-white/10 shadow-xl rounded-xl min-w-[200px]">
      <p className="font-bold text-slate-800 dark:text-white text-sm mb-2">{d.name}</p>
      <div className="space-y-1">
        <p className="text-xs text-slate-500 dark:text-white/55">{es ? 'Fecha' : 'Date'}: <span className="font-bold text-slate-900 dark:text-white">{d.dateStrFmt}</span></p>
        <p className="text-xs text-slate-500 dark:text-white/55">CTL: <span className="font-bold text-slate-900 dark:text-white">{d.Fitness}</span></p>
        <p className="text-xs text-slate-500 dark:text-white/55">TSB: <span className={`font-bold ${d.Forma > 5 ? 'text-emerald-600 dark:text-emerald-300' : d.Forma < -10 ? 'text-rose-600 dark:text-rose-300' : 'text-slate-900 dark:text-white'}`}>{d.Forma > 0 ? '+' : ''}{d.Forma}</span></p>
        <p className="text-xs text-slate-500 dark:text-white/55">{es ? 'Ritmo' : 'Pace'}: <span className="font-bold text-teal-700 dark:text-teal-300">{paceFmt} /km</span></p>
        <p className="text-xs text-slate-500 dark:text-white/55">{es ? 'Distancia' : 'Distance'}: <span className="font-bold text-slate-900 dark:text-white">{d.distance} km</span></p>
      </div>
      <p className="text-xs text-slate-500 dark:text-white/55 mt-2">{es ? '(Clic para abrir en Strava)' : '(Click to open in Strava)'}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FitnessFatigue({ activities }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language.startsWith('es');
  // Período compartido (lib/timeScope): el control vive en la barra superior. Las
  // flechas pasean ESE período hacia atrás; el desplazamiento va atado al período
  // en el que se fijó, así que al cambiarlo vuelve solo al presente.
  const [scope] = useTimeScope();
  const months = scopeMonths(scope);
  const [offset, setOffset] = useState({ scope, months: 0 });
  const offsetMonths = offset.scope === scope ? offset.months : 0;
  const setOffsetMonths = (fn) => setOffset({ scope, months: fn(offsetMonths) });
  // Se desestructura aquí y no dentro del useMemo: el compilador de React lee
  // `pmc.current` como el `.current` de una ref y se salta la optimización del
  // componente entero si `pmc` entra como dependencia en bloque.
  const { pmc } = useCalibratedPMC(activities);
  const pmcSeries = pmc?.series ?? null;
  const pmcCurrent = pmc?.current ?? null;

  // ── 1. Aggregate per-day data ────────────────────────────────────────────────
  const { chartData, current, rampRate, topEfforts } = useMemo(() => {
    if (!activities?.length) return { chartData: [], current: null, rampRate: null, topEfforts: [] };

    // El PMC llega ya calibrado desde useCalibratedPMC (fuente única compartida
    // con statusStats, InjuryRisk, VitalsOverview, el coach IA y el MCP).
    if (!pmcSeries || !pmcCurrent) return { chartData: [], current: null, rampRate: null, topEfforts: [] };

    const data = pmcSeries.map((p) => {
      return {
        date:    p.date,
        Fitness: p.ctl,
        Fatiga:  p.atl,
        Forma:   p.tsb,
        load:    p.load,
        acts:    p.activities.map((a) => ({
          id: a.id,
          name: a.name,
          distance: a.distance,
          moving_time: a.moving_time,
          average_speed: a.average_speed,
          average_heartrate: a.average_heartrate,
          suffer_score: a.suffer_score,
        })),
      };
    });

    const { ctl, atl, peak: peakCTL, peakDate: peakCTLDate, lowestTsb: lowestTSB,
            ramp: rampPerWeek,
            ctlTrend7, ctlTrend28, pctPeak } = pmcCurrent;

    // ── 3. Derived stats ────────────────────────────────────────────────────────
    // Scatter: flat runs ≥ 3 km
    const efforts = [];
    activities.forEach(a => {
      if (a.distance >= 3000 && a.average_speed > 0) {
        // La serie va indexada por día LOCAL: buscar por el UTC desalinearía
        // las actividades nocturnas.
        const dateStr = activityDayKey(a);
        const stat    = data.find(d => d.date === dateStr);
        if (!stat) return;
        const p        = 16.6667 / a.average_speed;
        const gradient = a.distance > 0 ? (a.total_elevation_gain / a.distance) * 100 : 99;
        if (p > 2.5 && p < 10 && Math.abs(gradient) <= 2.0) {
          efforts.push({
            id: a.id, name: a.name, date: dateStr,
            dateStrFmt: new Date(dateStr).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }),
            distance: +(a.distance / 1000).toFixed(2),
            pace: p, Forma: stat.Forma, Fitness: stat.Fitness,
          });
        }
      }
    });

    return {
      chartData:  data,
      current: {
        fitness:        Math.round(ctl),
        fatigue:        Math.round(atl),
        form:           Math.round(ctl - atl),
        // ACWR por EWMA 7:28 (Williams 2017), no ATL/CTL(42).
        acwr:           pmcCurrent.acwr != null ? Math.round(pmcCurrent.acwr * 100) / 100 : 0,
        peakFitness:    Math.round(peakCTL),
        peakFitnessDate: peakCTLDate,
        lowestTSB:      Math.round(lowestTSB),
        ctlTrend7:      Math.round(ctlTrend7),
        ctlTrend28:     Math.round(ctlTrend28),
        fitnessPercent: pctPeak,
      },
      rampRate:   Math.round(rampPerWeek * 10) / 10,
      topEfforts: efforts,
    };
  }, [activities, pmcSeries, pmcCurrent]);

  // ── 3b. Picos de CTL ─────────────────────────────────────────────────────────
  // "52 de fitness" no dice nada sin saber que tu máximo fueron 68. Se calcula
  // sobre la serie COMPLETA, no sobre el rango visible: el pico histórico no
  // puede cambiar porque estés mirando los últimos 3 meses.
  const { peakCTL, peakCTLYear } = useMemo(() => {
    if (!chartData.length) return { peakCTL: 0, peakCTLYear: 0 };
    const thisYear = String(new Date().getFullYear());
    let all = 0, year = 0;
    for (const d of chartData) {
      if (d.Fitness > all) all = d.Fitness;
      if (d.date.startsWith(thisYear) && d.Fitness > year) year = d.Fitness;
    }
    return { peakCTL: Math.round(all * 10) / 10, peakCTLYear: Math.round(year * 10) / 10 };
  }, [chartData]);

  // ── 4. Filter visible range ──────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    if (months == null) return chartData;
    const end    = new Date();
    end.setMonth(end.getMonth() - offsetMonths);
    const start  = new Date(end);
    start.setMonth(start.getMonth() - months);
    return chartData.filter(d => d.date >= start.toISOString().split('T')[0] && d.date <= end.toISOString().split('T')[0]);
  }, [chartData, months, offsetMonths]);

  const canGoBack = useMemo(() => {
    if (months == null || !chartData.length) return false;
    const end    = new Date();
    end.setMonth(end.getMonth() - offsetMonths - months);
    return chartData[0]?.date < end.toISOString().split('T')[0];
  }, [months, offsetMonths, chartData]);

  // ── 5. Status helpers ────────────────────────────────────────────────────────
  const formStatus = useMemo(() => {
    if (!current) return null;
    // Cortes compartidos con el veredicto del área (lib/statusStats › formZone).
    const zone = formZone(current.form) ?? 'optimal';
    const color = { transition: 'sky', fresh: 'emerald', optimal: 'blue', loaded: 'amber', overloaded: 'rose' }[zone];
    return { label: t(`fitness.status.${zone}`), desc: t(`fitness.status.${zone}_desc`), color };
  }, [current, t]);

  const acwrStatus = useMemo(() => {
    if (!current) return null;
    // Cortes compartidos con el veredicto del área (lib/statusStats › acwrZone).
    const zone = acwrZone(current.acwr) ?? 'optimal';
    const style = {
      underload: { color: 'sky',     risk: 'low' },
      optimal:   { color: 'emerald', risk: 'low' },
      caution:   { color: 'amber',   risk: 'moderate' },
      danger:    { color: 'rose',    risk: 'high' },
    }[zone];
    return {
      label: t(`fitness.acwr_status.${zone}`), desc: t(`fitness.acwr_status.${zone}_desc`),
      color: style.color, risk: t(`fitness.risk.${style.risk}`),
    };
  }, [current, t]);


  // ── No data ──────────────────────────────────────────────────────────────────
  if (!current) {
    return (
      <Card className="shadow-lg border-slate-200 dark:border-white/10">
        <Title className="text-slate-800 dark:text-white font-bold">{t('fitness.title')}</Title>
        <Text className="text-slate-500 dark:text-white/55 mt-2">{t('fitness.no_data')}</Text>
      </Card>
    );
  }

  // Diagnóstico en una sola franja. Antes había cinco tarjetas de estado, dos de
  // interpretación y una leyenda que repetían lo que ya dice la gráfica.
  const tone = { sky: PMC.transition, emerald: PMC.fresh, blue: PMC.fitness, amber: PMC.loaded, rose: PMC.overloaded };
  const rampKey = rampLevel(rampRate) ?? 'safe';
  const insights = [
    { icon: SparklesIcon, color: tone[formStatus?.color] ?? PMC.fitness,
      title: es ? 'Forma' : 'Form', value: formStatus?.label, desc: formStatus?.desc },
    { icon: BoltIcon, color: tone[acwrStatus?.color] ?? PMC.fitness,
      title: 'ACWR', value: `${current.acwr.toFixed(2)} · ${acwrStatus?.label}`, desc: acwrStatus?.desc },
    { icon: rampRate > 5 ? ExclamationTriangleIcon : ArrowTrendingUpIcon,
      color: rampKey === 'high' ? PMC.overloaded : PMC.fresh,
      title: es ? 'Rampa' : 'Ramp',
      value: `${rampRate > 0 ? '+' : ''}${rampRate} / ${es ? 'sem' : 'wk'} · ${t(`fitness.ramp_labels.${rampKey}`)}`,
      desc: rampRate > 5
        ? (es ? 'El fitness sube más de +5 por semana: riesgo de lesión o sobreentrenamiento.' : 'Fitness is rising faster than +5/week: injury or overtraining risk.')
        : (es ? 'Subida de fitness por semana. Por debajo de +5 es sostenible.' : 'Weekly fitness gain. Below +5 is sustainable.') },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PMCChart data={filteredData} months={months} offsetMonths={offsetMonths}
        canGoBack={canGoBack} setOffsetMonths={setOffsetMonths}
        peakCTL={peakCTL} peakCTLYear={peakCTLYear} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {insights.map(it => (
          <div key={it.title} className="rounded-2xl p-4 border"
            style={{ background: `${it.color}0d`, borderColor: `${it.color}33` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="p-1.5 rounded-lg" style={{ background: `${it.color}1f`, color: it.color }}>
                <it.icon className="w-4 h-4" />
              </span>
              <span className="text-label font-bold uppercase text-slate-500 dark:text-white/55">{it.title}</span>
            </div>
            <p className="text-sm font-black tabular-nums" style={{ color: it.color }}>{it.value}</p>
            <p className="text-xs text-slate-600 dark:text-white/75 leading-relaxed mt-1">{it.desc}</p>
          </div>
        ))}
      </div>

      {/* ── Scatter: forma vs rendimiento ────────────────────────────────────── */}
      {topEfforts.length > 0 && (
        <Card className="shadow-lg border-slate-200 dark:border-white/10">
          <Title className="text-slate-800 dark:text-white font-bold mb-1">{t('fitness.performance_vs_fitness')}</Title>
          <Text className="text-slate-500 dark:text-white/55 text-xs mb-4">
            {es ? 'Rodajes llanos de 3 km o más: ritmo frente a fitness, coloreados por la forma de ese día.'
                : 'Flat runs of 3 km or more: pace against fitness, coloured by that day\u2019s form.'}
          </Text>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, bottom: 20, left: 4 }}>
                <CartesianGrid stroke={COLORS.hairlineSoft} />
                <XAxis type="number" dataKey="Fitness" name="Fitness (CTL)" domain={['dataMin - 2', 'dataMax + 2']}
                  label={{ value: 'Fitness (CTL)', position: 'insideBottom', offset: -10, fill: COLORS.inkMuted, fontSize: 11 }}
                  tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: COLORS.hairline }} />
                <YAxis type="number" dataKey="pace" name={es ? 'Ritmo' : 'Pace'} domain={['auto', 'auto']} reversed
                  tickFormatter={v => formatPaceFromMinPerKm(v)} tick={AXIS_TICK} tickLine={false} axisLine={false}
                  label={{ value: es ? 'Ritmo (min/km)' : 'Pace (min/km)', angle: -90, position: 'insideLeft', offset: 10, fill: COLORS.inkMuted, fontSize: 11 }} />
                <ZAxis type="number" dataKey="distance" range={[40, 400]} />
                <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} content={<ScatterTooltip />} />
                <Scatter data={topEfforts} onClick={e => window.open(`https://www.strava.com/activities/${e.id}`, '_blank')} className="cursor-pointer">
                  {topEfforts.map((e, i) => (
                    <Cell key={i} fill={e.Forma > 5 ? PMC.fresh : e.Forma < -10 ? PMC.overloaded : PMC.fitness}
                      fillOpacity={0.65} stroke={COLORS.paper} strokeWidth={1} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-4 mt-3">
            {[
              { color: PMC.fresh,      label: es ? 'Fresco (TSB > 5)' : 'Fresh (TSB > 5)' },
              { color: PMC.fitness,    label: es ? 'Neutro' : 'Neutral' },
              { color: PMC.overloaded, label: es ? 'Con fatiga (TSB < −10)' : 'Fatigued (TSB < −10)' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                <span className="text-xs text-slate-500 dark:text-white/55 font-medium">{l.label}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
