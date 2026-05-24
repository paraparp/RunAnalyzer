import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ComposedChart, BarChart, Bar, Line, Area, ScatterChart, Scatter, ZAxis, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea
} from 'recharts';
import {
  ArrowTrendingUpIcon, FireIcon, SparklesIcon, BoltIcon,
  AdjustmentsHorizontalIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Helpers ────────────────────────────────────────────────────────────────────
function estimateLoad(a) {
  const mins = (a.moving_time || 0) / 60;
  if (a.average_heartrate) return mins * (a.average_heartrate / 180) * 1.92;
  if (a.distance) return (a.distance / 1000) * 0.8;
  return mins * 0.4;
}

function fmtDur(secs) {
  if (!secs) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtPace(speed) {
  if (!speed || speed <= 0) return null;
  const p = 16.6667 / speed;
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FitnessFatigue({ activities }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language.startsWith('es');
  const [timeRange, setTimeRange] = useState('12');
  const [offsetMonths, setOffsetMonths] = useState(0);

  // ── 1. Aggregate per-day data ────────────────────────────────────────────────
  const { chartData, maxLoad, current, weeklyLoad, rampRate, topEfforts } = useMemo(() => {
    if (!activities?.length) return { chartData: [], maxLoad: 0, current: null, weeklyLoad: [], rampRate: null, topEfforts: [] };

    const dailySS   = {};
    const dailyActs = {};
    let minDate = Infinity;

    activities.forEach(a => {
      const dateStr = a.start_date?.split('T')[0];
      if (!dateStr) return;
      const ts = new Date(dateStr).getTime();
      if (ts < minDate) minDate = ts;

      const ss = a.suffer_score || estimateLoad(a);
      dailySS[dateStr] = (dailySS[dateStr] || 0) + ss;

      if (!dailyActs[dateStr]) dailyActs[dateStr] = [];
      dailyActs[dateStr].push({
        id: a.id,
        name: a.name,
        distance: a.distance,
        moving_time: a.moving_time,
        average_speed: a.average_speed,
        average_heartrate: a.average_heartrate,
        suffer_score: a.suffer_score,
      });
    });

    if (minDate === Infinity) return { chartData: [], maxLoad: 0, current: null, weeklyLoad: [], rampRate: null, topEfforts: [] };

    // ── 2. PMC day loop ─────────────────────────────────────────────────────────
    const kCTL = Math.exp(-1 / 42);
    const kATL = Math.exp(-1 / 7);
    let ctl = 0, atl = 0;
    let peakCTL = 0, peakCTLDate = '';
    let lowestTSB = Infinity;
    let globalMaxLoad = 0;
    const weeklyBuckets = {};
    const data = [];

    for (let ts = minDate; ts <= Date.now(); ts += 86400000) {
      const d       = new Date(ts);
      const dateStr = d.toISOString().split('T')[0];
      const tss     = dailySS[dateStr] || 0;

      ctl = ctl * kCTL + tss * (1 - kCTL);
      atl = atl * kATL + tss * (1 - kATL);
      const tsb = ctl - atl;

      if (ctl > peakCTL)      { peakCTL = ctl; peakCTLDate = dateStr; }
      if (tsb < lowestTSB)    lowestTSB = tsb;
      if (tss > globalMaxLoad) globalMaxLoad = tss;

      data.push({
        date:    dateStr,
        Fitness: Math.round(ctl  * 10) / 10,
        Fatiga:  Math.round(atl  * 10) / 10,
        Forma:   Math.round(tsb  * 10) / 10,
        load:    tss,
        acts:    dailyActs[dateStr] || [],
      });

      // Weekly buckets
      const dow    = d.getDay();
      const mon    = new Date(d);
      mon.setDate(d.getDate() - ((dow + 6) % 7));
      const weekKey = mon.toISOString().split('T')[0];
      if (!weeklyBuckets[weekKey]) weeklyBuckets[weekKey] = { key: weekKey, load: 0, count: 0, sort: mon.getTime() };
      weeklyBuckets[weekKey].load += tss;
      if (tss > 0) weeklyBuckets[weekKey].count++;
    }

    // ── 3. Derived stats ────────────────────────────────────────────────────────
    const ctlNow   = ctl;
    const ctl7ago  = data.length > 7  ? data[data.length - 8].Fitness  : 0;
    const ctl28ago = data.length > 28 ? data[data.length - 29].Fitness : 0;
    const rampPerWeek = data.length > 28 ? (ctlNow - ctl28ago) / 4 : (ctlNow - ctl7ago);

    const wl = Object.values(weeklyBuckets)
      .sort((a, b) => a.sort - b.sort)
      .slice(-16)
      .map(w => {
        const d = new Date(w.key);
        return { name: `${d.getDate()}/${d.getMonth() + 1}`, Carga: Math.round(w.load), Sesiones: w.count };
      });

    // Scatter: flat runs ≥ 3 km
    const efforts = [];
    activities.forEach(a => {
      if (a.distance >= 3000 && a.average_speed > 0) {
        const dateStr = a.start_date?.split('T')[0];
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
      maxLoad:    globalMaxLoad,
      current: {
        fitness:        Math.round(ctl),
        fatigue:        Math.round(atl),
        form:           Math.round(ctl - atl),
        acwr:           ctl > 0 ? Math.round((atl / ctl) * 100) / 100 : 0,
        peakFitness:    Math.round(peakCTL),
        peakFitnessDate: peakCTLDate,
        lowestTSB:      Math.round(lowestTSB),
        ctlTrend7:      Math.round(ctlNow - ctl7ago),
        ctlTrend28:     Math.round(ctlNow - ctl28ago),
        fitnessPercent: peakCTL > 0 ? Math.round((ctl / peakCTL) * 100) : 0,
      },
      weeklyLoad: wl,
      rampRate:   Math.round(rampPerWeek * 10) / 10,
      topEfforts: efforts,
    };
  }, [activities]);

  // ── 4. Filter visible range ──────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    if (timeRange === 'all') return chartData;
    const months = parseInt(timeRange);
    const end    = new Date();
    end.setMonth(end.getMonth() - offsetMonths);
    const start  = new Date(end);
    start.setMonth(start.getMonth() - months);
    return chartData.filter(d => d.date >= start.toISOString().split('T')[0] && d.date <= end.toISOString().split('T')[0]);
  }, [chartData, timeRange, offsetMonths]);

  const canGoBack = useMemo(() => {
    if (timeRange === 'all' || !chartData.length) return false;
    const months = parseInt(timeRange);
    const end    = new Date();
    end.setMonth(end.getMonth() - offsetMonths - months);
    return chartData[0]?.date < end.toISOString().split('T')[0];
  }, [timeRange, offsetMonths, chartData]);

  // ── 5. Status helpers ────────────────────────────────────────────────────────
  const formStatus = useMemo(() => {
    if (!current) return null;
    const f = current.form;
    if (f > 15)  return { label: t('fitness.status.transition'), desc: t('fitness.status.transition_desc'), color: 'sky' };
    if (f > 5)   return { label: t('fitness.status.fresh'),      desc: t('fitness.status.fresh_desc'),      color: 'emerald' };
    if (f > -10) return { label: t('fitness.status.optimal'),    desc: t('fitness.status.optimal_desc'),    color: 'blue' };
    if (f > -20) return { label: t('fitness.status.loaded'),     desc: t('fitness.status.loaded_desc'),     color: 'amber' };
    return         { label: t('fitness.status.overloaded'),  desc: t('fitness.status.overloaded_desc'),  color: 'rose' };
  }, [current, t]);

  const acwrStatus = useMemo(() => {
    if (!current) return null;
    const r = current.acwr;
    if (r < 0.8)  return { label: t('fitness.acwr_status.underload'), desc: t('fitness.acwr_status.underload_desc'), color: 'sky',     risk: t('fitness.risk.low') };
    if (r <= 1.3) return { label: t('fitness.acwr_status.optimal'),   desc: t('fitness.acwr_status.optimal_desc'),   color: 'emerald', risk: t('fitness.risk.low') };
    if (r <= 1.5) return { label: t('fitness.acwr_status.caution'),   desc: t('fitness.acwr_status.caution_desc'),   color: 'amber',   risk: t('fitness.risk.moderate') };
    return          { label: t('fitness.acwr_status.danger'),    desc: t('fitness.acwr_status.danger_desc'),    color: 'rose',    risk: t('fitness.risk.high') };
  }, [current, t]);

  // ── 6. Tooltips ──────────────────────────────────────────────────────────────
  const PMCTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const day  = payload[0]?.payload;
    const acts = day?.acts || [];
    const date = new Date(label);
    const dateFmt = !isNaN(date) ? date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) : label;

    // Only show ATL and CTL lines (skip load bar entry)
    const lines = payload.filter(e => e.dataKey === 'Fatiga' || e.dataKey === 'Fitness');

    return (
      <div className="bg-white border border-slate-200 shadow-2xl rounded-2xl overflow-hidden min-w-[240px] max-w-[290px]">
        <div className="px-4 pt-3 pb-2 bg-slate-50 border-b border-slate-100">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{dateFmt}</p>
        </div>
        <div className="px-4 py-2.5 space-y-1.5">
          {day?.load > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-400 font-medium">{es ? 'Carga' : 'Load'}</span>
              <span className="text-[12px] font-bold text-slate-600 tabular-nums">{Math.round(day.load)}</span>
            </div>
          )}
          {lines.map((e, i) => (
            <div key={i} className="flex justify-between items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: e.stroke }} />
                <span className="text-[12px] font-semibold text-slate-600">{e.name}</span>
              </div>
              <span className="text-[13px] font-black tabular-nums" style={{ color: e.stroke }}>{e.value}</span>
            </div>
          ))}
          {day?.Forma != null && (
            <div className="flex justify-between items-center gap-4 pt-1 border-t border-slate-100 mt-1">
              <span className="text-[11px] font-semibold text-slate-500">TSB / {es ? 'Forma' : 'Form'}</span>
              <span className={`text-[13px] font-black tabular-nums ${day.Forma > 5 ? 'text-emerald-600' : day.Forma < -10 ? 'text-rose-600' : 'text-slate-700'}`}>
                {day.Forma > 0 ? '+' : ''}{day.Forma}
              </span>
            </div>
          )}
        </div>
        {acts.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-2.5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">{es ? 'Actividades' : 'Activities'}</p>
            <div className="space-y-2.5">
              {acts.map((a, i) => (
                <div key={i}>
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="text-[12px] font-bold text-slate-800 truncate">{a.name}</span>
                    <span className="text-[11px] text-slate-400 shrink-0">{(a.distance / 1000).toFixed(1)} km</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {fmtDur(a.moving_time)    && <span className="text-[10px] text-slate-400">⏱ {fmtDur(a.moving_time)}</span>}
                    {fmtPace(a.average_speed) && <span className="text-[10px] text-slate-400">⚡ {fmtPace(a.average_speed)}/km</span>}
                    {a.average_heartrate      && <span className="text-[10px] text-slate-400">❤️ {Math.round(a.average_heartrate)} bpm</span>}
                    {a.suffer_score           && <span className="text-[10px] text-slate-400">🔥 SS: {a.suffer_score}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const WeeklyTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl">
        <p className="text-[11px] font-semibold text-slate-500 mb-1">{es ? 'Semana' : 'Week'} {label}</p>
        <p className="text-sm font-bold text-slate-900">{es ? 'Carga' : 'Load'}: {d?.Carga}</p>
        <p className="text-xs text-slate-500">{d?.Sesiones} {t('vo2.sessions')}</p>
      </div>
    );
  };

  const ScatterTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const m = Math.floor(d.pace), s = Math.round((d.pace - m) * 60);
    return (
      <div className="bg-white/95 p-4 border border-slate-200 shadow-xl rounded-xl min-w-[200px]">
        <p className="font-bold text-slate-800 text-sm mb-2">{d.name}</p>
        <div className="space-y-1">
          <p className="text-xs text-slate-500">{es ? 'Fecha' : 'Date'}: <span className="font-bold text-slate-900">{d.dateStrFmt}</span></p>
          <p className="text-xs text-slate-500">CTL: <span className="font-bold text-slate-900">{d.Fitness}</span></p>
          <p className="text-xs text-slate-500">TSB: <span className={`font-bold ${d.Forma > 5 ? 'text-emerald-600' : d.Forma < -10 ? 'text-rose-600' : 'text-slate-900'}`}>{d.Forma > 0 ? '+' : ''}{d.Forma}</span></p>
          <p className="text-xs text-slate-500">{es ? 'Ritmo' : 'Pace'}: <span className="font-bold text-blue-600">{m}:{s.toString().padStart(2,'0')} /km</span></p>
          <p className="text-xs text-slate-500">{es ? 'Distancia' : 'Distance'}: <span className="font-bold text-slate-900">{d.distance} km</span></p>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">{es ? '(Clic para abrir en Strava)' : '(Click to open in Strava)'}</p>
      </div>
    );
  };

  // ── No data ──────────────────────────────────────────────────────────────────
  if (!current) {
    return (
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold">{t('fitness.title')}</Title>
        <Text className="text-slate-500 mt-2">{t('fitness.no_data')}</Text>
      </Card>
    );
  }

  const xTickFormatter = v => {
    const d = new Date(v);
    return `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  };
  const xInterval = Math.max(Math.floor(filteredData.length / 12), 1);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Status cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: t('fitness.ctl'),  value: current.fitness, trend: current.ctlTrend7,
            sub: `${current.fitnessPercent}% ${t('fitness.peak_fitness')}`, progress: current.fitnessPercent,
            color: 'text-blue-600', icon: ArrowTrendingUpIcon },
          { label: t('fitness.atl'),  value: current.fatigue,
            sub: t('fitness.avg_7_days'), progress: Math.min((current.fatigue / Math.max(current.peakFitness, 1)) * 100, 100),
            color: 'text-rose-600', icon: FireIcon },
          { label: t('fitness.tsb'),  value: (current.form > 0 ? '+' : '') + current.form,
            sub: formStatus?.label, color: current.form > 5 ? 'text-emerald-600' : current.form > -10 ? 'text-blue-600' : 'text-rose-600',
            icon: SparklesIcon },
          { label: t('fitness.acwr'), value: current.acwr.toFixed(2),
            sub: `${es ? 'Riesgo' : 'Risk'} ${acwrStatus?.risk}`,
            color: acwrStatus?.color === 'emerald' ? 'text-emerald-600' : 'text-rose-600',
            icon: BoltIcon, acwr: true },
          { label: t('fitness.ramp'), value: (rampRate > 0 ? '+' : '') + rampRate,
            sub: rampRate > 5 ? t('fitness.ramp_labels.high') : t('fitness.ramp_labels.safe'),
            color: rampRate > 5 ? 'text-rose-600' : 'text-emerald-600', icon: AdjustmentsHorizontalIcon },
        ].map((card, i) => (
          <div key={i} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-slate-50 rounded-xl text-slate-400 group-hover:text-slate-600 transition-colors">
                <card.icon className="w-5 h-5" />
              </div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">{card.label}</div>
            </div>
            <div className="flex items-baseline gap-2">
              <p className={`text-3xl font-black tabular-nums ${card.color}`}>{card.value}</p>
              {card.trend !== undefined && (
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-lg ${card.trend > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                  {card.trend > 0 ? '+' : ''}{card.trend}
                </span>
              )}
            </div>
            <div className="mt-4 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-tighter text-slate-400">{card.sub}</div>
              {card.progress !== undefined && (
                <div className="h-1.5 bg-slate-50 rounded-full overflow-hidden border border-slate-100/50">
                  <div className={`h-full rounded-full transition-all duration-700 ${card.color.replace('text-', 'bg-')}`} style={{ width: `${card.progress}%` }} />
                </div>
              )}
              {card.acwr && (
                <div className="relative h-2 flex gap-0.5 mt-1">
                  <div className="h-full flex-[0.8] bg-sky-200 rounded-l-md" />
                  <div className="h-full flex-[0.5] bg-emerald-400" />
                  <div className="h-full flex-[0.2] bg-amber-400" />
                  <div className="h-full flex-[0.5] bg-rose-400 rounded-r-md" />
                  <div className="absolute top-0 w-1.5 h-1.5 bg-slate-900 rounded-full shadow-md border border-white"
                    style={{ left: `${Math.min(Math.max((current.acwr / 2) * 100, 2), 98)}%`, transform: 'translateX(-50%)' }} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── PMC chart ─────────────────────────────────────────────────────────── */}
      <Card className="shadow-lg border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <div>
            <Title className="text-slate-800 font-bold mb-0.5">{t('fitness.pmc.title')}</Title>
            <Text className="text-slate-400 text-xs">{t('fitness.pmc.desc')}</Text>
          </div>
          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={v => { setTimeRange(v); setOffsetMonths(0); }} enableClear={false} className="w-36">
              <SelectItem value="all">{t('hr_analysis.filters.all')}</SelectItem>
              <SelectItem value="3">{es ? '3 meses' : '3 months'}</SelectItem>
              <SelectItem value="6">{es ? '6 meses' : '6 months'}</SelectItem>
              <SelectItem value="12">{es ? '12 meses' : '12 months'}</SelectItem>
              <SelectItem value="24">{es ? '2 años' : '2 years'}</SelectItem>
              <SelectItem value="36">{es ? '3 años' : '3 years'}</SelectItem>
            </Select>
            {timeRange !== 'all' && (
              <div className="flex gap-1">
                <button onClick={() => setOffsetMonths(p => p + parseInt(timeRange))} disabled={!canGoBack}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                  </svg>
                </button>
                <button onClick={() => setOffsetMonths(p => Math.max(p - parseInt(timeRange), 0))} disabled={offsetMonths === 0}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-[3px] rounded-full bg-blue-600" />
            <span className="text-[11px] text-slate-600 font-semibold">CTL — {es ? 'Fitness' : 'Fitness'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-[2px]" style={{ background: 'repeating-linear-gradient(90deg,#f43f5e 0 5px,transparent 5px 9px)' }} />
            <span className="text-[11px] text-slate-500 font-semibold">ATL — {es ? 'Fatiga' : 'Fatigue'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-blue-300 opacity-70" />
            <span className="text-[11px] text-slate-400 font-medium">{t('fitness.pmc.daily_load')}</span>
          </div>
        </div>

        {/* Panel 1 — CTL + ATL lines (sin barras) */}
        <div className="h-[240px] w-full rounded-t-xl overflow-hidden bg-slate-50/60 border border-slate-100 border-b-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart syncId="pmc" data={filteredData} margin={{ top: 16, right: 16, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="gradCTL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#2563eb" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 8" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} width={36}
                domain={[0, d => Math.round(d * 1.15)]} tickCount={5} />
              <RechartsTooltip content={<PMCTooltip />} />
              <Line type="monotone" dataKey="Fatiga" name={t('fitness.atl')}
                stroke="#f43f5e" strokeWidth={2} strokeDasharray="6 3"
                dot={false} isAnimationActive={false}
                activeDot={{ r: 4, fill: '#f43f5e', stroke: '#fff', strokeWidth: 2 }} />
              <Area type="monotone" dataKey="Fitness" name={t('fitness.ctl')}
                stroke="#2563eb" strokeWidth={3} fill="url(#gradCTL)"
                dot={false} isAnimationActive={false}
                activeDot={{ r: 6, fill: '#2563eb', stroke: '#fff', strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Panel 2 — Carga diaria (eje Y propio, siempre proporcional) */}
        <div className="h-[72px] w-full bg-white border border-slate-100 border-t-slate-200">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart syncId="pmc" data={filteredData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={[0, 'dataMax']} width={36} />
              <RechartsTooltip content={<PMCTooltip />} />
              <Bar dataKey="load" barSize={3} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {filteredData.map((entry, i) => {
                  const maxV = Math.max(...filteredData.map(d => d.load));
                  const r = maxV > 0 ? entry.load / maxV : 0;
                  return (
                    <Cell key={i}
                      fill={r > 0.75 ? '#1d4ed8' : r > 0.45 ? '#60a5fa' : r > 0 ? '#bfdbfe' : 'transparent'}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-3">
          <div className="h-px flex-1 bg-slate-100" />
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            TSB — {es ? 'Forma del Día' : 'Daily Form'}
          </span>
          <div className="flex items-center gap-1">
            {[
              { label: es ? 'Trans.' : 'Trans.', bg: '#dbeafe', fg: '#1d4ed8' },
              { label: es ? 'Fresco' : 'Fresh',  bg: '#d1fae5', fg: '#065f46' },
              { label: es ? 'Óptimo' : 'Optimal', bg: '#fef9c3', fg: '#92400e' },
              { label: es ? 'Cargado' : 'Loaded', bg: '#ffedd5', fg: '#9a3412' },
              { label: es ? 'Sobrecar.' : 'Over.', bg: '#fee2e2', fg: '#991b1b' },
            ].map(z => (
              <span key={z.label} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: z.bg, color: z.fg }}>{z.label}</span>
            ))}
          </div>
          <div className="h-px flex-1 bg-slate-100" />
        </div>

        {/* Panel 3 — TSB zones */}
        <div className="h-[170px] w-full rounded-b-xl overflow-hidden border border-slate-100">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart syncId="pmc" data={filteredData} margin={{ top: 0, right: 16, bottom: 20, left: 8 }}>
              <ReferenceArea y1={25}  y2={80}  fill="#dbeafe" fillOpacity={0.85} ifOverflow="hidden" />
              <ReferenceArea y1={5}   y2={25}  fill="#d1fae5" fillOpacity={0.85} ifOverflow="hidden" />
              <ReferenceArea y1={-10} y2={5}   fill="#fef9c3" fillOpacity={0.85} ifOverflow="hidden" />
              <ReferenceArea y1={-30} y2={-10} fill="#ffedd5" fillOpacity={0.85} ifOverflow="hidden" />
              <ReferenceArea y1={-80} y2={-30} fill="#fee2e2" fillOpacity={0.85} ifOverflow="hidden" />
              <CartesianGrid strokeDasharray="2 8" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false}
                axisLine={{ stroke: '#e2e8f0' }} tickFormatter={xTickFormatter} interval={xInterval} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false}
                width={36} domain={[-80, 80]} tickCount={5} />
              <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
              <RechartsTooltip content={<PMCTooltip />} />
              <Line type="monotone" dataKey="Forma" name={t('fitness.tsb')}
                stroke="#0f172a" strokeWidth={2.5} dot={false} isAnimationActive={false}
                activeDot={{ r: 5, fill: '#0f172a', stroke: '#fff', strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Weekly load ───────────────────────────────────────────────────────── */}
      {weeklyLoad.length > 0 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">{t('fitness.weekly_load')}</Title>
          <Text className="text-slate-500 text-sm mb-4">{t('consistency.subtitle')}</Text>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyLoad} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} width={35} />
                <RechartsTooltip content={<WeeklyTooltip />} />
                <Bar dataKey="Carga" radius={[4, 4, 0, 0]}>
                  {weeklyLoad.map((entry, i) => {
                    const avg = weeklyLoad.reduce((s, w) => s + w.Carga, 0) / weeklyLoad.length;
                    return <Cell key={i} fill={entry.Carga > avg * 1.3 ? '#f43f5e' : entry.Carga < avg * 0.5 ? '#94a3b8' : '#2563eb'} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Scatter: TSB vs performance ──────────────────────────────────────── */}
      {topEfforts.length > 0 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">{t('fitness.performance_vs_fitness')}</Title>
          <Text className="text-slate-500 text-sm mb-4">{t('fitness.pmc.desc')}</Text>
          <div className="h-80 w-full bg-slate-50/50 rounded-xl p-4 border border-slate-100">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" dataKey="Fitness" name="Fitness (CTL)" domain={['dataMin - 2', 'dataMax + 2']}
                  label={{ value: 'Fitness (CTL)', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 12 }}
                  tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis type="number" dataKey="pace" name={es ? 'Ritmo' : 'Pace'} domain={['auto', 'auto']} reversed
                  tickFormatter={v => { const m = Math.floor(v); const s = Math.round((v - m) * 60); return `${m}:${s.toString().padStart(2, '0')}`; }}
                  label={{ value: es ? 'Ritmo (min/km)' : 'Pace (min/km)', angle: -90, position: 'insideLeft', offset: -5, fill: '#64748b', fontSize: 12 }}
                  tick={{ fill: '#64748b', fontSize: 12 }} />
                <ZAxis type="number" dataKey="distance" range={[40, 400]} />
                <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} content={<ScatterTooltip />} />
                <Scatter data={topEfforts} onClick={e => window.open(`https://www.strava.com/activities/${e.id}`, '_blank')} className="cursor-pointer">
                  {topEfforts.map((e, i) => (
                    <Cell key={i} fill={e.Forma > 5 ? '#10b981' : e.Forma < -10 ? '#f43f5e' : '#2563eb'} fillOpacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-4 mt-4 px-2">
            {[
              { color: 'bg-emerald-500', label: es ? 'Marcas estando fresco (TSB > 5)' : 'Fresh PRs (TSB > 5)' },
              { color: 'bg-blue-500',    label: es ? 'Estado neutro/óptimo' : 'Neutral/optimal state' },
              { color: 'bg-rose-500',    label: es ? 'Con fatiga (TSB < −10)' : 'With fatigue (TSB < −10)' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded-full ${l.color} opacity-70`} />
                <span className="text-[11px] text-slate-500 font-medium">{l.label}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Interpretation ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[
          { status: formStatus, label: es ? 'Estado de Forma' : 'Form Status', icon: SparklesIcon },
          { status: acwrStatus, label: 'ACWR', icon: BoltIcon },
        ].map((item, i) => (
          <div key={i} className={`bg-white rounded-2xl border-l-8 p-6 shadow-xl shadow-slate-200/50 border border-slate-100
            ${item.status?.color === 'emerald' ? 'border-l-emerald-500' : item.status?.color === 'rose' ? 'border-l-rose-500' : 'border-l-blue-500'}`}>
            <div className="flex gap-5 items-start">
              <div className={`p-4 rounded-2xl shrink-0 ${item.status?.color === 'emerald' ? 'bg-emerald-50 text-emerald-600' : item.status?.color === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                <item.icon className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-slate-900 font-black text-sm uppercase tracking-tight mb-2">
                  {item.label}: <span className={item.status?.color === 'emerald' ? 'text-emerald-600' : 'text-blue-600'}>{item.status?.label}</span>
                </h4>
                <p className="text-slate-500 text-sm font-medium leading-relaxed">{item.status?.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rampRate > 5 && (
        <div className="bg-white border-l-8 border-rose-500 rounded-2xl p-6 flex gap-5 items-start shadow-xl shadow-rose-100/20 border border-slate-100">
          <div className="bg-rose-100 text-rose-600 p-3 rounded-2xl shrink-0">
            <ExclamationTriangleIcon className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-slate-900 font-black text-sm uppercase tracking-tight mb-1">
              {es ? 'Alerta: Rampa de Carga' : 'Alert: Load Ramp'}
            </h4>
            <p className="text-slate-500 text-sm font-medium leading-relaxed">
              {es
                ? `Tu CTL está aumentando a +${rampRate}/semana. Un aumento superior a +5 es un indicador de riesgo de sobreentrenamiento o lesión.`
                : `Your CTL is increasing at +${rampRate}/week. An increase higher than +5 signals overtraining or injury risk.`}
            </p>
          </div>
        </div>
      )}

      {/* ── Legend ────────────────────────────────────────────────────────────── */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">{t('fitness.how_to_read')}</Title>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {[
            { color: 'bg-blue-500', title: 'CTL (Fitness)', desc: es ? 'Media exponencial 42 días. Crece con entrenamiento consistente.' : '42-day exponential average. Grows with consistent training.' },
            { color: 'bg-rose-500', title: 'ATL (Fatiga)', desc: es ? 'Media exponencial 7 días. Refleja la fatiga reciente.' : '7-day exponential average. Reflects recent fatigue.' },
            { color: 'bg-emerald-500', title: 'TSB (Forma)', desc: es ? 'CTL − ATL. Positivo = fresco. Negativo = fatiga acumulada.' : 'CTL − ATL. Positive = fresh. Negative = accumulated fatigue.' },
            { title: 'ACWR', desc: es ? 'ATL / CTL. Zona segura: 0.8–1.3. Encima de 1.5 = riesgo alto de lesión.' : 'ATL / CTL. Safe zone: 0.8–1.3. Above 1.5 = high injury risk.' },
            { title: es ? 'Rampa Semanal' : 'Weekly Ramp', desc: es ? 'Incremento de CTL/semana. No debería superar +5.' : 'CTL increase per week. Should not exceed +5.' },
            { title: es ? 'Carga Semanal' : 'Weekly Load', desc: es ? 'Suma de esfuerzo por semana. Rojo = semana muy alta. Gris = muy baja.' : 'Total effort per week. Red = very high. Grey = very low.' },
          ].map((item, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center gap-2">
                {item.color && <div className={`w-3 h-3 rounded-full ${item.color}`} />}
                <p className="font-semibold text-slate-700 text-sm">{item.title}</p>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
