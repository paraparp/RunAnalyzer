import { Card, Title, Text, Callout, Select, SelectItem } from '@tremor/react';
import { useMemo, useState } from 'react';
import {
  ComposedChart, Area, BarChart, Bar, Line, ScatterChart, Scatter, ZAxis, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Brush
} from 'recharts';

const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const STATUS_STYLES = {
  sky: 'bg-sky-50 border-sky-100',
  emerald: 'bg-emerald-50 border-emerald-100',
  indigo: 'bg-indigo-50 border-indigo-100',
  amber: 'bg-amber-50 border-amber-100',
  rose: 'bg-rose-50 border-rose-100',
};

export default function FitnessFatigue({ activities }) {
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
    if (timeRange === 'all') return 'Todo el historial';
    const months = parseInt(timeRange);
    const end = new Date();
    end.setMonth(end.getMonth() - offsetMonths);
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);
    const fmt = (d) => d.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
    return `${fmt(start)} — ${fmt(end)}`;
  }, [timeRange, offsetMonths]);

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
    if (f > 15) return { label: 'Transición', desc: 'Estás muy fresco pero podrías estar desentrenándote. Considera aumentar la carga progresivamente.', color: 'sky' };
    if (f > 5) return { label: 'Fresco', desc: 'Buen momento para competir o hacer un test de rendimiento. Tu cuerpo está recuperado y en forma.', color: 'emerald' };
    if (f > -10) return { label: 'Óptimo', desc: 'Equilibrio ideal entre carga y recuperación. Sigue con el plan de entrenamiento actual.', color: 'indigo' };
    if (f > -20) return { label: 'Cargado', desc: 'Fatiga acumulada, pero las adaptaciones están ocurriendo. Prioriza el sueño y la nutrición.', color: 'amber' };
    return { label: 'Sobrecargado', desc: 'Riesgo de sobreentrenamiento o lesión. Reduce volumen e intensidad esta semana.', color: 'rose' };
  }, [current]);

  // ACWR risk level
  const acwrStatus = useMemo(() => {
    if (!current) return null;
    const r = current.acwr;
    if (r < 0.8) return { label: 'Infracarga', desc: 'Estás entrenando menos de lo que tu cuerpo está acostumbrado. Podrías perder fitness.', color: 'sky', risk: 'Bajo' };
    if (r <= 1.3) return { label: 'Zona óptima', desc: 'Tu ratio agudo:crónico está en la zona ideal (0.8-1.3). Buen balance para progresar sin riesgo.', color: 'emerald', risk: 'Bajo' };
    if (r <= 1.5) return { label: 'Precaución', desc: 'Tu carga aguda supera significativamente la crónica. Riesgo moderado de lesión. No aumentes más esta semana.', color: 'amber', risk: 'Moderado' };
    return { label: 'Peligro', desc: 'Ratio agudo:crónico muy alto (>1.5). Alto riesgo de lesión. Reduce la carga inmediatamente.', color: 'rose', risk: 'Alto' };
  }, [current]);

  const PMCTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = new Date(label);
      const formattedDate = !isNaN(d) ? d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : label;

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
          <p className="text-[11px] font-semibold text-slate-500 mb-1">Semana del {label}</p>
          <p className="text-sm font-bold text-slate-900">Carga: {d?.Carga}</p>
          <p className="text-xs text-slate-500">{d?.Sesiones} sesiones</p>
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
             <p className="text-slate-600 text-xs font-medium">Ritmo: <span className="text-indigo-600 font-bold ml-1">{paceFmt}</span></p>
             <p className="text-slate-600 text-xs font-medium">Distancia: <span className="text-slate-900 font-bold ml-1">{d.distance} km</span></p>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 font-medium">
            (Clic para abrir en Strava)
          </div>
        </div>
      );
    }
    return null;
  };

  if (!current) {
    return (
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold">Fitness & Fatiga</Title>
        <Text className="text-slate-500 mt-2">No hay actividades con datos de carga disponibles.</Text>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Cards Row 1: Core Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Fitness CTL */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Fitness (CTL)</p>
            <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${current.ctlTrend7 > 0 ? 'bg-emerald-50 text-emerald-600' : current.ctlTrend7 < 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500'}`}>
              {current.ctlTrend7 > 0 ? '↑' : current.ctlTrend7 < 0 ? '↓' : '→'} {Math.abs(current.ctlTrend7)}
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{current.fitness}</p>
          {/* Fitness gauge */}
          <div className="mt-2">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] text-slate-400">0</span>
              <span className="text-[9px] text-slate-400">Pico: {current.peakFitness}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-700" style={{ width: `${current.fitnessPercent}%` }} />
            </div>
            <p className="text-[9px] text-indigo-500 font-semibold mt-0.5 text-right">{current.fitnessPercent}% del pico</p>
          </div>
        </div>

        {/* Fatigue ATL */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-rose-500 uppercase tracking-wider mb-2">Fatiga (ATL)</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{current.fatigue}</p>
          <p className="text-[10px] text-slate-400 mt-1">Carga media 7 días</p>
          <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-rose-400 rounded-full transition-all duration-700" style={{ width: `${Math.min((current.fatigue / Math.max(current.peakFitness, 1)) * 100, 100)}%` }} />
          </div>
        </div>

        {/* Form TSB */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-2">Forma (TSB)</p>
          <p className={`text-2xl font-bold tabular-nums ${current.form > 5 ? 'text-emerald-600' : current.form > -10 ? 'text-indigo-600' : current.form > -20 ? 'text-amber-600' : 'text-rose-600'}`}>
            {current.form > 0 ? '+' : ''}{current.form}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">{formStatus?.label}</p>
          <p className="text-[9px] text-slate-400 mt-0.5">Peor: {current.lowestTSB}</p>
        </div>

        {/* ACWR */}
        <div className={`rounded-xl border p-4 ${STATUS_STYLES[acwrStatus?.color] || 'bg-white border-slate-200'}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ACWR</p>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
              acwrStatus?.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' :
              acwrStatus?.color === 'amber' ? 'bg-amber-100 text-amber-700' :
              acwrStatus?.color === 'rose' ? 'bg-rose-100 text-rose-700' :
              'bg-sky-100 text-sky-700'
            }`}>
              Riesgo {acwrStatus?.risk}
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{current.acwr.toFixed(2)}</p>
          <p className="text-[10px] text-slate-500 mt-1">{acwrStatus?.label}</p>
          {/* ACWR visual scale */}
          <div className="mt-1.5 flex h-2 rounded-full overflow-hidden">
            <div className="bg-sky-300 flex-[0.8]" />
            <div className="bg-emerald-400 flex-[0.5]" />
            <div className="bg-amber-400 flex-[0.2]" />
            <div className="bg-rose-400 flex-[0.5]" />
          </div>
          <div className="relative mt-0.5 h-2">
            <div className="absolute top-0 w-0 h-0 border-l-[4px] border-r-[4px] border-b-[5px] border-l-transparent border-r-transparent border-b-slate-800 transition-all duration-500"
              style={{ left: `${Math.min(Math.max((current.acwr / 2) * 100, 2), 98)}%`, transform: 'translateX(-50%)' }} />
          </div>
        </div>

        {/* Ramp Rate */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Rampa Semanal</p>
          <p className={`text-2xl font-bold tabular-nums ${
            rampRate > 7 ? 'text-rose-600' : rampRate > 5 ? 'text-amber-600' : rampRate > 0 ? 'text-emerald-600' : 'text-sky-600'
          }`}>
            {rampRate > 0 ? '+' : ''}{rampRate}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">CTL/semana (últ. 28d)</p>
          <p className={`text-[9px] font-semibold mt-0.5 ${rampRate > 7 ? 'text-rose-500' : rampRate > 5 ? 'text-amber-500' : 'text-emerald-500'}`}>
            {rampRate > 7 ? 'Aumento agresivo' : rampRate > 5 ? 'Aumento moderado' : rampRate > 0 ? 'Progresión segura' : 'Reducción'}
          </p>
          <p className="text-[9px] text-slate-400 mt-0.5">Recomendado: ≤5/sem</p>
        </div>
      </div>

      {/* PMC Chart */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <div>
            <Title className="text-slate-800 font-bold mb-1">Performance Management Chart</Title>
            <Text className="text-slate-500 text-sm">Visualiza la interacción entre fitness, fatiga y forma a lo largo del tiempo</Text>
          </div>
          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={(v) => { setTimeRange(v); setOffsetMonths(0); }} enableClear={false} className="w-36">
              <SelectItem value="all">Todo</SelectItem>
              <SelectItem value="3">3 meses</SelectItem>
              <SelectItem value="6">6 meses</SelectItem>
              <SelectItem value="12">12 meses</SelectItem>
              <SelectItem value="24">2 años</SelectItem>
              <SelectItem value="36">3 años</SelectItem>
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
          <p className="text-[11px] text-slate-400 font-medium mb-3 tabular-nums">{dateRangeLabel}</p>
        )}

        {/* Unified PMC: CTL + ATL + TSB bars + daily load */}
        <div className="h-[500px] w-full mt-2 relative">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={filteredChartData} margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
              <defs>
                <linearGradient id="gradFitness" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              
              <XAxis
                dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }}
                tickFormatter={v => { const d = new Date(v); return `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; }}
                interval={Math.max(Math.floor(filteredChartData.length / 10), 1)}
              />
              {/* Left axis: CTL / ATL / Load */}
              <YAxis
                yAxisId="load" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} width={32}
                domain={[0, dataMax => Math.round(dataMax * 1.1)]}
              />
              {/* Right axis: TSB */}
              <YAxis
                yAxisId="form" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} width={32}
                domain={[-80, 80]}
              />
              <YAxis yAxisId="pace" orientation="left" hide={true} domain={['auto', 'auto']} reversed={true} />
              
              <ReferenceLine yAxisId="form" y={0} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
              <RechartsTooltip content={<PMCTooltip />} />
              
              {/* Daily load as subtle thin bars */}
              <Bar yAxisId="load" dataKey="load" name="Carga Diaria" fill="#e2e8f0" barSize={2} isAnimationActive={false} />
              
              {/* TSB (Form) as colored bars */}
              <Bar yAxisId="form" dataKey="Forma" name="TSB (Forma)" barSize={3} isAnimationActive={false} radius={[2,2,2,2]}>
                {filteredChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.Forma >= 0 ? '#10b981' : '#f43f5e'} fillOpacity={0.5} />
                ))}
              </Bar>

              {/* CTL (Fitness) Area */}
              <Area yAxisId="load" type="monotone" dataKey="Fitness" name="CTL (Fitness)" stroke="#3b82f6" strokeWidth={3} fill="url(#gradFitness)" dot={false} isAnimationActive={false} activeDot={{ r: 5, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }} className="drop-shadow-md" />
              
              {/* ATL (Fatigue) Line */}
              <Line yAxisId="load" type="monotone" dataKey="Fatiga" name="ATL (Fatiga)" stroke="#ec4899" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, fill: '#ec4899', stroke: '#fff', strokeWidth: 2 }} className="drop-shadow-sm" />
              
              {/* 10k best paces as scattered yellow dots */}
              <Line yAxisId="pace" type="monotone" dataKey="Pace10k" name="Ritmo 10k" stroke="none" isAnimationActive={false} dot={{ r: 5, fill: '#eab308', stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 7, fill: '#eab308', stroke: '#fff', strokeWidth: 2 }} connectNulls={false} />

              <Brush dataKey="date" height={25} stroke="#cbd5e1" fill="#f8fafc" tickFormatter={() => ''} travellerWidth={8} className="mt-8" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* Inline legend */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-[3px] rounded-full bg-[#3b82f6]" />
            <span className="text-[10px] text-slate-500 font-medium">CTL (Fitness)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-[2px] rounded-full bg-[#ec4899]" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #ec4899 0 4px, transparent 4px 7px)' }} />
            <span className="text-[10px] text-slate-500 font-medium">ATL (Fatiga)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-emerald-400/50" />
            <span className="text-[10px] text-slate-500 font-medium">TSB +</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-rose-400/50" />
            <span className="text-[10px] text-slate-500 font-medium">TSB −</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-slate-200" />
            <span className="text-[10px] text-slate-500 font-medium">Carga diaria</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500 border border-white" />
            <span className="text-[10px] text-slate-500 font-medium">Ritmo 10k</span>
          </div>
        </div>
      </Card>

      {/* Weekly Load */}
      {weeklyLoad.length > 0 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">Carga Semanal</Title>
          <Text className="text-slate-500 text-sm mb-4">Distribución de la carga de entrenamiento por semana (últimas 16 semanas)</Text>
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
                    const isHigh = entry.Carga > avg * 1.3;
                    const isLow = entry.Carga < avg * 0.5;
                    return (
                      <rect key={i} fill={isHigh ? '#f43f5e' : isLow ? '#94a3b8' : '#6366f1'} />
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
          <Title className="text-slate-800 font-bold mb-1">Rendimiento vs Fitness Físico (CTL)</Title>
          <Text className="text-slate-500 text-sm mb-4">Descubre cómo tu acumulación de estado físico (CTL) se traduce en ritmos más rápidos corriendo en llano (≤ 1.5% desnivel).</Text>
          <div className="h-80 w-full mt-2 bg-slate-50/50 rounded-xl p-4 border border-slate-100 relative">
            <ResponsiveContainer width="100%" height="100%">
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
                     <Cell key={`cell-${index}`} fill={entry.Forma > 5 ? '#10b981' : entry.Forma < -10 ? '#f43f5e' : '#6366f1'} fillOpacity={0.7} className="hover:opacity-100 transition-opacity drop-shadow-sm" />
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
              <div className="w-3 h-3 rounded-full bg-indigo-500 opacity-70" />
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {formStatus && (
          <Callout
            title={`Estado de Forma: ${formStatus.label}`}
            color={formStatus.color}
          >
            {formStatus.desc}
          </Callout>
        )}
        {acwrStatus && (
          <Callout
            title={`ACWR ${current.acwr.toFixed(2)}: ${acwrStatus.label}`}
            color={acwrStatus.color}
          >
            {acwrStatus.desc}
          </Callout>
        )}
      </div>

      {/* Ramp rate warning */}
      {rampRate > 5 && (
        <Callout title="Alerta de Rampa" color={rampRate > 7 ? 'rose' : 'amber'}>
          Tu CTL está aumentando a +{rampRate}/semana. Se recomienda no superar +5 unidades/semana para evitar lesiones.
          {rampRate > 7 && ' Considera una semana de descarga pronto.'}
        </Callout>
      )}

      {/* Legend / How to read */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">Cómo interpretar estos datos</Title>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-indigo-500" />
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
