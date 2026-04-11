import { Card, Title, Text, Callout, Select, SelectItem } from '@tremor/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ComposedChart, Area, BarChart, Bar, Line, ScatterChart, Scatter, ZAxis, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Brush
} from 'recharts';
import { 
  ArrowTrendingUpIcon, 
  FireIcon, 
  SparklesIcon, 
  BoltIcon, 
  AdjustmentsHorizontalIcon,
  ExclamationTriangleIcon,
  PlayCircleIcon,
  ChartBarIcon,
  CalendarIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const STATUS_STYLES = {
  sky: 'bg-sky-50 border-sky-100',
  emerald: 'bg-emerald-50 border-emerald-100',
  blue: 'bg-blue-50 border-blue-100',
  amber: 'bg-amber-50 border-amber-100',
  rose: 'bg-rose-50 border-rose-100',
};

export default function FitnessFatigue({ activities }) {
  const { t, i18n } = useTranslation();
  const [timeRange, setTimeRange] = useState('36');
  const [offsetMonths, setOffsetMonths] = useState(0);

  const { chartData, current, weeklyLoad, rampRate, topEfforts } = useMemo(() => {
    if (!activities || activities.length === 0) return { chartData: [], current: null, weeklyLoad: [], rampRate: null, topEfforts: [] };

    const dailySS = {};
    const daily10kPace = {};
    let minDate = Infinity;

    activities.forEach(a => {
      const dateStr = a.start_date.split('T')[0];
      const time = new Date(dateStr).getTime();
      if (time < minDate) minDate = time;

      const ss = a.suffer_score || (a.moving_time / 60) * 0.5;
      dailySS[dateStr] = (dailySS[dateStr] || 0) + ss;

      // Best 10k pace per day
      if (a.distance >= 9500 && a.distance <= 10500 && a.average_speed > 0) {
        const p = 16.6667 / a.average_speed;
        if (p > 2.5 && p < 10) {
          if (!daily10kPace[dateStr] || p < daily10kPace[dateStr].pace) {
            daily10kPace[dateStr] = { pace: p, id: a.id, name: a.name };
          }
        }
      }
    });

    if (minDate === Infinity) return { chartData: [], current: null, weeklyLoad: [], rampRate: null };

    const data = [];
    const now = new Date().getTime();
    let ctl = 0;
    let atl = 0;

    const kCTL = Math.exp(-1 / 42);
    const kATL = Math.exp(-1 / 7);

    let peakCTL = 0;
    let peakCTLDate = '';
    let lowestTSB = Infinity;
    let lowestTSBDate = '';

    // Weekly load tracking
    const weeklyBuckets = {};

    for (let t = minDate; t <= now; t += 86400000) {
      const d = new Date(t);
      const dateStr = d.toISOString().split('T')[0];
      const tss = dailySS[dateStr] || 0;

      ctl = ctl * kCTL + tss * (1 - kCTL);
      atl = atl * kATL + tss * (1 - kATL);
      const tsb = ctl - atl;
      const acwr = ctl > 0 ? atl / ctl : 0;

      if (ctl > peakCTL) { peakCTL = ctl; peakCTLDate = dateStr; }
      if (tsb < lowestTSB) { lowestTSB = tsb; lowestTSBDate = dateStr; }

      const best10k = daily10kPace[dateStr];

      data.push({
        date: dateStr,
        Fitness: Math.round(ctl * 10) / 10,
        Fatiga: Math.round(atl * 10) / 10,
        Forma: Math.round(tsb * 10) / 10,
        ACWR: Math.round(acwr * 100) / 100,
        load: tss,
        Pace10k: best10k ? Math.round(best10k.pace * 100) / 100 : null,
        Pace10kName: best10k ? best10k.name : null,
      });

      // Weekly load
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const weekKey = monday.toISOString().split('T')[0];
      if (!weeklyBuckets[weekKey]) {
        weeklyBuckets[weekKey] = { key: weekKey, load: 0, count: 0, sortDate: monday.getTime() };
      }
      weeklyBuckets[weekKey].load += tss;
      if (tss > 0) weeklyBuckets[weekKey].count++;
    }

    // 7 day and 28 day trends for CTL
    const ctlNow = ctl;
    const ctl7ago = data.length > 7 ? data[data.length - 8].Fitness : 0;
    const ctl28ago = data.length > 28 ? data[data.length - 29].Fitness : 0;
    const ctlTrend7 = Math.round(ctlNow - ctl7ago);
    const ctlTrend28 = Math.round(ctlNow - ctl28ago);

    // Ramp rate (CTL change per week over last 28 days)
    const rampPerWeek = data.length > 28
      ? (ctlNow - data[data.length - 29].Fitness) / 4
      : data.length > 7
        ? ctlNow - data[data.length - 8].Fitness
        : 0;

    // Weekly load array
    const wl = Object.values(weeklyBuckets)
      .sort((a, b) => a.sortDate - b.sortDate)
      .slice(-16)
      .map(w => {
        const d = new Date(w.key);
        return {
          name: `${d.getDate()}/${d.getMonth() + 1}`,
          Carga: Math.round(w.load),
          Sesiones: w.count,
        };
      });

    // Gather top efforts for Form comparison correlation
    const efforts = [];
    activities.forEach(a => {
      // Use runs over 3km
      if (a.distance >= 3000 && a.average_speed > 0) {
        const dateStr = a.start_date.split('T')[0];
        const stat = data.find(d => d.date === dateStr);
        if (stat) {
          const p = 16.6667 / a.average_speed;
          const gradient = (a.total_elevation_gain / a.distance) * 100;
          if (p > 2.5 && p < 10 && gradient <= 1.5 && gradient >= -1.5) { // filter bad outliers & hills
            efforts.push({
              id: a.id,
              name: a.name,
              date: dateStr,
              dateStrFmt: new Date(dateStr).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }),
              distance: Number((a.distance / 1000).toFixed(2)),
              pace: p,
              Forma: stat.Forma,
              Fitness: stat.Fitness
            });
          }
        }
      }
    });

    return {
      chartData: data,
      current: {
        fitness: Math.round(ctl),
        fatigue: Math.round(atl),
        form: Math.round(ctl - atl),
        acwr: ctl > 0 ? Math.round((atl / ctl) * 100) / 100 : 0,
        peakFitness: Math.round(peakCTL),
        peakFitnessDate: peakCTLDate,
        lowestTSB: Math.round(lowestTSB),
        lowestTSBDate: lowestTSBDate,
        ctlTrend7,
        ctlTrend28,
        fitnessPercent: peakCTL > 0 ? Math.round((ctl / peakCTL) * 100) : 0,
      },
      weeklyLoad: wl,
      rampRate: Math.round(rampPerWeek * 10) / 10,
      topEfforts: efforts,
    };
  }, [activities]);

  // Filter chart data by time range + offset
  const filteredChartData = useMemo(() => {
    if (timeRange === 'all') return chartData;
    const months = parseInt(timeRange);
    const end = new Date();
    end.setMonth(end.getMonth() - offsetMonths);
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    return chartData.filter(d => d.date >= startStr && d.date <= endStr);
  }, [chartData, timeRange, offsetMonths]);

  // Date range label for display
  const dateRangeLabel = useMemo(() => {
    if (timeRange === 'all') return t('hr_analysis.filters.all');
    const months = parseInt(timeRange);
    const end = new Date();
    end.setMonth(end.getMonth() - offsetMonths);
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);
    const fmt = (d) => d.toLocaleDateString(i18n.language, { month: 'short', year: 'numeric' });
    return `${fmt(start)} — ${fmt(end)}`;
  }, [timeRange, offsetMonths, i18n.language, t]);

  // Check if we can navigate further back
  const canGoBack = useMemo(() => {
    if (timeRange === 'all' || chartData.length === 0) return false;
    const months = parseInt(timeRange);
    const end = new Date();
    end.setMonth(end.getMonth() - offsetMonths - months);
    const earliest = chartData[0]?.date;
    return earliest && end.toISOString().split('T')[0] > earliest;
  }, [timeRange, offsetMonths, chartData]);

  // Status interpretation
  const formStatus = useMemo(() => {
    if (!current) return null;
    const f = current.form;
    if (f > 15) return { label: t('fitness.status.transition'), desc: t('fitness.status.transition_desc'), color: 'sky' };
    if (f > 5) return { label: t('fitness.status.fresh'), desc: t('fitness.status.fresh_desc'), color: 'emerald' };
    if (f > -10) return { label: t('fitness.status.optimal'), desc: t('fitness.status.optimal_desc'), color: 'blue' };
    if (f > -20) return { label: t('fitness.status.loaded'), desc: t('fitness.status.loaded_desc'), color: 'amber' };
    return { label: t('fitness.status.overloaded'), desc: t('fitness.status.overloaded_desc'), color: 'rose' };
  }, [current, t]);

  // ACWR risk level
  const acwrStatus = useMemo(() => {
    if (!current) return null;
    const r = current.acwr;
    if (r < 0.8) return { label: t('fitness.acwr_status.underload'), desc: t('fitness.acwr_status.underload_desc'), color: 'sky', risk: t('fitness.risk.low') };
    if (r <= 1.3) return { label: t('fitness.acwr_status.optimal'), desc: t('fitness.acwr_status.optimal_desc'), color: 'emerald', risk: t('fitness.risk.low') };
    if (r <= 1.5) return { label: t('fitness.acwr_status.caution'), desc: t('fitness.acwr_status.caution_desc'), color: 'amber', risk: t('fitness.risk.moderate') };
    return { label: t('fitness.acwr_status.danger'), desc: t('fitness.acwr_status.danger_desc'), color: 'rose', risk: t('fitness.risk.high') };
  }, [current, t]);

  const PMCTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = new Date(label);
      const formattedDate = !isNaN(d) ? d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) : label;

      return (
        <div className="bg-white/95 backdrop-blur-md p-4 border border-slate-200 shadow-2xl rounded-2xl min-w-[220px]">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 border-b border-slate-100 pb-2">{formattedDate}</p>
          {payload.map((entry, i) => {
            let val = entry.value;
            if (entry.dataKey === 'Pace10k') {
              const m = Math.floor(entry.value);
              const s = Math.round((entry.value - m) * 60);
              val = `${m}:${s.toString().padStart(2, '0')}`;
            }
            return (
              <div key={i} className="flex items-center justify-between gap-6 mb-2 last:mb-0">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm shadow-sm" style={{ backgroundColor: entry.color || entry.fill || entry.stroke }} />
                  <span className="text-[13px] font-medium text-slate-600">{entry.name}</span>
                </div>
                <span className="text-[13px] font-bold text-slate-900 tabular-nums bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{val}</span>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  const WeeklyTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = payload[0]?.payload;
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl">
          <p className="text-[11px] font-semibold text-slate-500 mb-1">{t('dashboard.weeks_min').split(' ')[0]} {label}</p>
          <p className="text-sm font-bold text-slate-900">{t('fitness.weekly_load').split(' ')[0]}: {d?.Carga}</p>
          <p className="text-xs text-slate-500">{d?.Sesiones} {t('vo2.sessions')}</p>
        </div>
      );
    }
    return null;
  };

  const ScatterTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      const m = Math.floor(d.pace);
      const s = Math.round((d.pace - m) * 60);
      const paceFmt = `${m}:${s.toString().padStart(2, '0')} /km`;
      
      return (
        <div className="bg-white/95 backdrop-blur-md p-4 border border-slate-200 shadow-xl rounded-xl z-50 min-w-[200px]">
          <p className="font-bold text-slate-800 text-sm mb-1">{d.name}</p>
          <div className="flex flex-col gap-1 mt-2">
             <p className="text-slate-600 text-xs font-medium">Fecha: <span className="text-slate-900 font-bold ml-1">{d.dateStrFmt}</span></p>
             <p className="text-slate-600 text-xs font-medium">Fitness (CTL): <span className="text-slate-900 font-bold ml-1">{d.Fitness}</span></p>
             <p className="text-slate-600 text-xs font-medium">Forma (TSB): <span className={`font-bold ml-1 ${d.Forma > 5 ? 'text-emerald-600' : d.Forma < -10 ? 'text-rose-600' : 'text-slate-900'}`}>{d.Forma > 0 ? '+' : ''}{d.Forma}</span></p>
             <p className="text-slate-600 text-xs font-medium">Ritmo: <span className="text-blue-600 font-bold ml-1">{paceFmt}</span></p>
             <p className="text-slate-600 text-xs font-medium">Distancia: <span className="text-slate-900 font-bold ml-1">{d.distance} km</span></p>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 font-medium">
            {i18n.language.startsWith('es') ? '(Clic para abrir en Strava)' : '(Click to open in Strava)'}
          </div>
        </div>
      );
    }
    return null;
  };

  if (!current) {
    return (
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold">{t('fitness.title')}</Title>
        <Text className="text-slate-500 mt-2">{t('fitness.no_data')}</Text>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Cards Row 1: Core Metrics */}
      {/* Status Cards Row 1: Core Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { 
            label: t('fitness.ctl'), 
            value: current.fitness, 
            trend: current.ctlTrend7, 
            sub: `${current.fitnessPercent}% ${t('fitness.peak_fitness')}`,
            progress: current.fitnessPercent,
            color: "text-blue-600",
            icon: ArrowTrendingUpIcon
          },
          { 
            label: t('fitness.atl'), 
            value: current.fatigue, 
            sub: t('fitness.avg_7_days'),
            progress: Math.min((current.fatigue / Math.max(current.peakFitness, 1)) * 100, 100),
            color: "text-rose-600",
            icon: FireIcon
          },
          { 
            label: t('fitness.tsb'), 
            value: (current.form > 0 ? '+' : '') + current.form, 
            sub: formStatus?.label,
            color: current.form > 5 ? 'text-emerald-600' : current.form > -10 ? 'text-blue-600' : 'text-rose-600',
            icon: SparklesIcon
          },
          { 
            label: t('fitness.acwr'), 
            value: current.acwr.toFixed(2), 
            sub: i18n.language.startsWith('en') ? `Risk ${acwrStatus?.risk}` : `Riesgo ${acwrStatus?.risk}`,
            color: acwrStatus?.color === 'emerald' ? 'text-emerald-600' : 'text-rose-600',
            icon: BoltIcon,
            acwr: true
          },
          { 
            label: t('fitness.ramp'), 
            value: (rampRate > 0 ? '+' : '') + rampRate, 
            sub: rampRate > 5 ? t('fitness.ramp_labels.high') : t('fitness.ramp_labels.safe'),
            color: rampRate > 5 ? 'text-rose-600' : 'text-emerald-600',
            icon: AdjustmentsHorizontalIcon
          }
        ].map((card, i) => (
          <div key={i} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm transition-all hover:shadow-md group">
            <div className="flex justify-between items-start mb-4">
              <div className={`p-2 bg-slate-50 rounded-xl text-slate-400 group-hover:text-slate-600 transition-colors`}>
                <card.icon className="w-5 h-5" />
              </div>
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">{card.label}</div>
            </div>
            <div className="flex items-baseline gap-2">
              <p className={`text-3xl font-black tabular-nums transition-transform group-hover:translate-x-1 ${card.color}`}>{card.value}</p>
              {card.trend !== undefined && (
                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-lg ${card.trend > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                  {card.trend > 0 ? '+' : ''}{card.trend}
                </span>
              )}
            </div>
            
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-tighter text-slate-400">
                <span>{card.sub}</span>
              </div>
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
                   <div className="absolute top-0 w-1.5 h-1.5 bg-slate-900 rounded-full shadow-md border border-white transition-all duration-500" 
                        style={{ left: `${Math.min(Math.max((current.acwr / 2) * 100, 2), 98)}%`, transform: 'translateX(-50%)' }} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* PMC Chart — dual-panel layout (TrainingPeaks style) */}
      <Card className="shadow-lg border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2">
          <div>
            <Title className="text-slate-800 font-bold mb-0.5">{t('fitness.pmc.title')}</Title>
            <Text className="text-slate-400 text-xs">{t('fitness.pmc.desc')}</Text>
          </div>
          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={(v) => { setTimeRange(v); setOffsetMonths(0); }} enableClear={false} className="w-36">
              <SelectItem value="all">{t('hr_analysis.filters.all')}</SelectItem>
              <SelectItem value="3">{i18n.language.startsWith('es') ? '3 meses' : '3 months'}</SelectItem>
              <SelectItem value="6">{i18n.language.startsWith('es') ? '6 meses' : '6 months'}</SelectItem>
              <SelectItem value="12">{i18n.language.startsWith('es') ? '12 meses' : '12 months'}</SelectItem>
              <SelectItem value="24">{i18n.language.startsWith('es') ? '2 años' : '2 years'}</SelectItem>
              <SelectItem value="36">{i18n.language.startsWith('es') ? '3 años' : '3 years'}</SelectItem>
            </Select>
            {timeRange !== 'all' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setOffsetMonths(prev => prev + parseInt(timeRange))}
                  disabled={!canGoBack}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Periodo anterior"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  onClick={() => setOffsetMonths(prev => Math.max(prev - parseInt(timeRange), 0))}
                  disabled={offsetMonths === 0}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Periodo siguiente"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
        {timeRange !== 'all' && (
          <p className="text-[11px] text-slate-400 font-medium mb-2 tabular-nums">{dateRangeLabel}</p>
        )}

        {/* ── Legend row ── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-[3px] rounded-full bg-blue-600" />
            <span className="text-[11px] text-slate-600 font-semibold">{t('fitness.ctl')} — Fitness</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-[2px]" style={{ background: 'repeating-linear-gradient(90deg,#f43f5e 0 5px,transparent 5px 9px)' }} />
            <span className="text-[11px] text-slate-500 font-semibold">{t('fitness.atl')} — Fatiga</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-3 rounded-sm bg-blue-200 opacity-80" />
            <span className="text-[11px] text-slate-400 font-medium">{t('fitness.pmc.daily_load')}</span>
          </div>
        </div>

        <defs>
          <linearGradient id="gradCTL2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* ── PANEL 1: CTL + ATL + Load bars ── */}
        <div className="h-[280px] w-full rounded-xl overflow-hidden bg-slate-50/60 border border-slate-100">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <ComposedChart data={filteredChartData} margin={{ top: 16, right: 16, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="gradCTLv3" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#2563eb" stopOpacity={0.40} />
                  <stop offset="55%"  stopColor="#2563eb" stopOpacity={0.10} />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 8" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis
                yAxisId="lines"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={36}
                domain={[0, dataMax => Math.round(dataMax * 1.15)]}
                tickCount={5}
              />
              <YAxis yAxisId="bars" hide domain={[0, dataMax => dataMax * 7]} />
              <RechartsTooltip content={<PMCTooltip />} />

              {/* Load bars — pinned to bottom via inflated axis */}
              <Bar
                yAxisId="bars"
                dataKey="load"
                name={t('fitness.pmc.daily_load')}
                fill="#93c5fd"
                opacity={0.45}
                barSize={2}
                isAnimationActive={false}
              />

              {/* ATL first so CTL renders on top */}
              <Line
                yAxisId="lines"
                type="monotone"
                dataKey="Fatiga"
                name={t('fitness.atl')}
                stroke="#f43f5e"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 4, fill: '#f43f5e', stroke: '#fff', strokeWidth: 2 }}
              />

              {/* CTL — protagonist */}
              <Area
                yAxisId="lines"
                type="monotone"
                dataKey="Fitness"
                name={t('fitness.ctl')}
                stroke="#2563eb"
                strokeWidth={3}
                fill="url(#gradCTLv3)"
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 6, fill: '#2563eb', stroke: '#fff', strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Divider with TSB label */}
        <div className="flex items-center gap-3 my-3">
          <div className="h-px flex-1 bg-slate-100" />
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {t('fitness.tsb')} — {i18n.language.startsWith('es') ? 'Forma del Día' : 'Daily Form'}
          </span>
          <div className="flex items-center gap-1">
            {[
              { label: i18n.language.startsWith('es') ? 'Trans.' : 'Trans.', bg: '#dbeafe', fg: '#1d4ed8' },
              { label: i18n.language.startsWith('es') ? 'Fresco' : 'Fresh',  bg: '#d1fae5', fg: '#065f46' },
              { label: i18n.language.startsWith('es') ? 'Óptimo' : 'Optimal', bg: '#fef9c3', fg: '#92400e' },
              { label: i18n.language.startsWith('es') ? 'Cargado' : 'Loaded', bg: '#ffedd5', fg: '#9a3412' },
              { label: i18n.language.startsWith('es') ? 'Sobrecar.' : 'Over.', bg: '#fee2e2', fg: '#991b1b' },
            ].map(z => (
              <span key={z.label} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: z.bg, color: z.fg }}>
                {z.label}
              </span>
            ))}
          </div>
          <div className="h-px flex-1 bg-slate-100" />
        </div>

        {/* ── PANEL 2: TSB zones ── */}
        <div className="h-[170px] w-full rounded-xl overflow-hidden border border-slate-100">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <ComposedChart data={filteredChartData} margin={{ top: 0, right: 16, bottom: 20, left: 8 }}>
              <CartesianGrid strokeDasharray="2 8" stroke="#f1f5f9" vertical={false} />

              {/* Zone bands */}
              <ReferenceArea y1={25}  y2={80}  fill="#dbeafe" fillOpacity={0.85} ifOverflow="hidden" />
              <ReferenceArea y1={5}   y2={25}  fill="#d1fae5" fillOpacity={0.85} ifOverflow="hidden" />
              <ReferenceArea y1={-10} y2={5}   fill="#fef9c3" fillOpacity={0.85} ifOverflow="hidden" />
              <ReferenceArea y1={-30} y2={-10} fill="#ffedd5" fillOpacity={0.85} ifOverflow="hidden" />
              <ReferenceArea y1={-80} y2={-30} fill="#fee2e2" fillOpacity={0.85} ifOverflow="hidden" />

              <XAxis
                dataKey="date"
                tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                tickLine={false}
                axisLine={{ stroke: '#e2e8f0' }}
                tickFormatter={v => {
                  const d = new Date(v);
                  return `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
                }}
                interval={Math.max(Math.floor(filteredChartData.length / 12), 1)}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={36}
                domain={[-80, 80]}
                tickCount={5}
              />

              <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
              <RechartsTooltip content={<PMCTooltip />} />

              {/* TSB — dark slate so it contrasts all zone colors */}
              <Line
                type="monotone"
                dataKey="Forma"
                name={t('fitness.tsb')}
                stroke="#0f172a"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 5, fill: '#0f172a', stroke: '#fff', strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Weekly Load */}
      {weeklyLoad.length > 0 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">{t('fitness.weekly_load')}</Title>
          <Text className="text-slate-500 text-sm mb-4">{t('consistency.subtitle')}</Text>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={weeklyLoad} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} width={35} />
                <RechartsTooltip content={<WeeklyTooltip />} />
                <Bar dataKey="Carga" radius={[4, 4, 0, 0]}>
                  {weeklyLoad.map((entry, i) => {
                    const avg = weeklyLoad.reduce((s, w) => s + w.Carga, 0) / weeklyLoad.length;
                    const isHigh = entry.Carga > avg * 1.3;
                    const isLow = entry.Carga < avg * 0.5;
                    return (
                      <Cell key={i} fill={isHigh ? '#f43f5e' : isLow ? '#94a3b8' : '#2563eb'} />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* TSB vs Performance Scatter Chart */}
      {topEfforts && topEfforts.length > 0 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">{t('fitness.performance_vs_fitness')}</Title>
          <Text className="text-slate-500 text-sm mb-4">{t('fitness.pmc.desc')}</Text>
          <div className="h-80 w-full mt-2 bg-slate-50/50 rounded-xl p-4 border border-slate-100 relative">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  type="number" 
                  dataKey="Fitness" 
                  name="Fitness (CTL)" 
                  domain={['dataMin - 2', 'dataMax + 2']}
                  label={{ value: 'Fitness (CTL) Acumulado', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                />
                <YAxis 
                  type="number" 
                  dataKey="pace" 
                  name="Ritmo" 
                  domain={['auto', 'auto']}
                  tickFormatter={(val) => {
                    const m = Math.floor(val);
                    const s = Math.round((val - m) * 60);
                    return `${m}:${s.toString().padStart(2, '0')}`;
                  }}
                  reversed={true} // Faster pace (lower value) is higher on Y-axis
                  label={{ value: 'Ritmo (min/km)', angle: -90, position: 'insideLeft', offset: -5, fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                />
                <ZAxis type="number" dataKey="distance" range={[40, 400]} name="Distancia" />
                <RechartsTooltip cursor={{ strokeDasharray: '3 3', stroke: '#cbd5e1' }} content={<ScatterTooltip />} />
                <Scatter 
                  name="Actividades" 
                  data={topEfforts} 
                  onClick={(e) => window.open(`https://www.strava.com/activities/${e.id}`, '_blank')}
                  className="cursor-pointer"
                >
                  {topEfforts.map((entry, index) => (
                     <Cell key={`cell-${index}`} fill={entry.Forma > 5 ? '#10b981' : entry.Forma < -10 ? '#f43f5e' : '#2563eb'} fillOpacity={0.7} className="hover:opacity-100 transition-opacity drop-shadow-sm" />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-4 px-2">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-emerald-500 opacity-70" />
              <span className="text-[11px] text-slate-500 font-medium">Marcas estando fresco (TSB &gt; 5)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-500 opacity-70" />
              <span className="text-[11px] text-slate-500 font-medium">Estado óptimo/neutro</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-rose-500 opacity-70" />
              <span className="text-[11px] text-slate-500 font-medium">Marcas con fatiga (TSB &lt; -10)</span>
            </div>
          </div>
        </Card>
      )}

      {/* Interpretation Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[
          { status: formStatus, label: "Estado de Forma", icon: SparklesIcon },
          { status: acwrStatus, label: "ACWR Agudo:Crónico", icon: BoltIcon }
        ].map((item, i) => (
          <div key={i} className={`bg-white rounded-2xl border-l-[8px] p-6 shadow-xl shadow-slate-200/50 border border-slate-100 ${item.status?.color === 'emerald' ? 'border-l-emerald-500' : item.status?.color === 'rose' ? 'border-l-rose-500' : 'border-l-blue-500'}`}>
             <div className="flex gap-5 items-start">
                <div className={`p-4 rounded-2xl shrink-0 ${item.status?.color === 'emerald' ? 'bg-emerald-50 text-emerald-600' : item.status?.color === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                   <item.icon className="w-8 h-8" />
                </div>
                <div>
                   <h4 className="text-slate-900 font-black text-sm uppercase tracking-tight mb-2">{item.label}: <span className={item.status?.color === 'emerald' ? 'text-emerald-600' : 'text-blue-600'}>{item.status?.label}</span></h4>
                   <p className="text-slate-500 text-sm font-medium leading-relaxed">{item.status?.desc}</p>
                </div>
             </div>
          </div>
        ))}
      </div>

      {rampRate > 5 && (
        <div className="bg-white border-l-8 border-rose-500 rounded-2xl p-6 flex gap-5 items-start shadow-xl shadow-rose-100/20 border border-slate-100 animate-pulse-subtle">
            <div className="bg-rose-100 text-rose-600 p-3 rounded-2xl shrink-0">
                <ExclamationTriangleIcon className="w-6 h-6" />
            </div>
            <div>
                <h4 className="text-slate-900 font-black text-sm uppercase tracking-tight mb-1">{i18n.language.startsWith('es') ? 'Punto de Alerta: Rampa de Carga' : 'Alert: Load Ramp'}</h4>
                <p className="text-slate-500 text-sm font-medium leading-relaxed">
                    {i18n.language.startsWith('es') 
                      ? `Tu CTL está aumentando a +${rampRate}/semana. Un aumento superior a +5 es un pre-vaticinio de sobreentrenamiento o lesión.`
                      : `Your CTL is increasing at +${rampRate}/week. An increase higher than +5 is a harbinger of overtraining or injury.`}
                </p>
            </div>
        </div>
      )}

      {/* Legend / How to read */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">{t('fitness.how_to_read')}</Title>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <p className="font-semibold text-slate-700">CTL (Fitness)</p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">Media exponencial de carga en 42 días. Representa tu nivel de forma general. Crece con entrenamiento consistente.</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500" />
              <p className="font-semibold text-slate-700">ATL (Fatiga)</p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">Media exponencial de carga en 7 días. Refleja la fatiga reciente. Responde rápido a cambios de volumen.</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <p className="font-semibold text-slate-700">TSB (Forma)</p>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">CTL - ATL. Positivo = fresco (ideal para competir). Negativo = fatiga acumulada (adaptaciones en progreso).</p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-slate-700">ACWR (Ratio Agudo:Crónico)</p>
            <p className="text-xs text-slate-500 leading-relaxed">ATL / CTL. La zona segura es 0.8-1.3. Por encima de 1.5 hay alto riesgo de lesión según la evidencia científica.</p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-slate-700">Rampa Semanal</p>
            <p className="text-xs text-slate-500 leading-relaxed">Incremento de CTL por semana. No debería superar +5 unidades/semana. Subidas bruscas indican riesgo.</p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-slate-700">Carga Semanal</p>
            <p className="text-xs text-slate-500 leading-relaxed">Suma total de esfuerzo relativo por semana. Barras rojas = semana excepcionalmente alta. Barras grises = muy baja.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
