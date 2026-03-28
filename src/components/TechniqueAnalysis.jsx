import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ZAxis, Cell } from 'recharts';
import { 
  SignalIcon, 
  ArrowsPointingOutIcon, 
  StopIcon,
  SparklesIcon,
  AdjustmentsHorizontalIcon
} from '@heroicons/react/24/outline';
import { useMemo, useState, useEffect } from 'react';

export default function TechniqueAnalysis({ activities }) {
  const [flatOnly, setFlatOnly] = useState(false);

  const baseData = useMemo(() => {
    if (!activities) return [];
    
    let filtered = activities.filter(a => a.average_speed > 0 && a.average_cadence > 0);
    
    if (flatOnly) {
      filtered = filtered.filter(a => {
        if (a.distance <= 0) return false;
        const gradient = (a.total_elevation_gain / a.distance) * 100;
        return gradient <= 1.5 && gradient >= -1.5; // Also filter steep downhills
      });
    }

    return filtered
      .map(a => {
        const paceStr = 16.6667 / a.average_speed;
        const spm = a.average_cadence < 120 ? a.average_cadence * 2 : a.average_cadence;
        const strideLength = (a.average_speed * 60) / spm;
        const gradient = a.distance > 0 ? ((a.total_elevation_gain / a.distance) * 100).toFixed(1) : '0.0';

        return {
          id: a.id,
          name: a.name,
          dateStr: new Date(a.start_date).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }),
          year: new Date(a.start_date).getFullYear(),
          ritmoVal: Number(paceStr.toFixed(4)),
          Cadencia: Math.round(spm),
          Zancada: Number(strideLength.toFixed(2)),
          Distancia: Number((a.distance / 1000).toFixed(2)),
          DesnivelPct: Number(gradient)
        };
      })
      .filter(d => d.ritmoVal < 15 && d.ritmoVal > 2); // Exclude outlier paces
  }, [activities, flatOnly]);

  const uniqueYears = useMemo(() => {
    return Array.from(new Set(baseData.map(d => d.year))).sort((a,b) => b - a);
  }, [baseData]);

  const [deselectedYears, setDeselectedYears] = useState(new Set());
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (uniqueYears.length > 0 && !initialized) {
      setDeselectedYears(new Set(uniqueYears.slice(3)));
      setInitialized(true);
    }
  }, [uniqueYears, initialized]);

  const chartData = useMemo(() => {
    return baseData.filter(d => !deselectedYears.has(d.year));
  }, [baseData, deselectedYears]);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const m = Math.floor(data.ritmoVal);
      const s = Math.round((data.ritmoVal - m) * 60);
      const paceFmt = `${m}:${s.toString().padStart(2, '0')} /km`;
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl z-50">
          <p className="font-bold text-slate-800 text-sm mb-1">{data.name}</p>
          <div className="flex flex-col gap-1 mt-2">
             <p className="text-slate-600 text-xs font-medium">Fecha: <span className="text-slate-900 font-bold ml-1">{data.dateStr}</span></p>
             <p className="text-slate-600 text-xs font-medium">Ritmo: <span className="text-slate-900 font-bold ml-1">{paceFmt}</span></p>
             <p className="text-slate-600 text-xs font-medium">Cadencia: <span className="text-blue-600 font-bold ml-1">{data.Cadencia} spm</span></p>
             <p className="text-slate-600 text-xs font-medium">Zancada: <span className="text-emerald-600 font-bold ml-1">{data.Zancada} m</span></p>
             <p className="text-slate-600 text-xs font-medium">Distancia: <span className="text-slate-900 font-bold ml-1">{data.Distancia} km</span></p>
             <p className="text-slate-600 text-xs font-medium">Desnivel: <span className="text-amber-600 font-bold ml-1">{data.DesnivelPct}%</span></p>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 font-medium">
            (Clic para abrir en Strava)
          </div>
        </div>
      );
    }
    return null;
  };

  const YEAR_COLORS = ['#2563eb', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f43f5e', '#3b82f6'];

  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const avgCadence = chartData.reduce((acc, curr) => acc + curr.Cadencia, 0) / chartData.length;
    const avgStride = chartData.reduce((acc, curr) => acc + curr.Zancada, 0) / chartData.length;
    const bestPace = Math.min(...chartData.map(d => d.ritmoVal));
    
    const m = Math.floor(bestPace);
    const s = Math.round((bestPace - m) * 60);

    return {
      cadence: Math.round(avgCadence),
      stride: avgStride.toFixed(2),
      bestPace: `${m}:${s.toString().padStart(2, '0')}`
    };
  }, [chartData]);

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "Cadencia Media", value: stats.cadence, unit: "spm", color: "text-blue-600", icon: SignalIcon },
            { label: "Zancada Media", value: stats.stride, unit: "m", color: "text-emerald-600", icon: ArrowsPointingOutIcon },
            { label: "Ritmo Pico", value: stats.bestPace, unit: "/km", color: "text-amber-600", icon: StopIcon }
          ].map((card, i) => (
            <div key={i} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm transition-all hover:shadow-md group">
               <div className="flex justify-between items-start mb-3">
                  <div className="p-2 bg-slate-50 rounded-xl text-slate-400 group-hover:text-slate-600 transition-colors">
                     <card.icon className="w-5 h-5" />
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">{card.label}</div>
               </div>
               <div className="flex items-baseline gap-1.5">
                  <p className={`text-3xl font-black tabular-nums transition-transform group-hover:translate-x-1 ${card.color}`}>{card.value}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{card.unit}</p>
               </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-3xl border border-slate-100 p-8 shadow-xl shadow-slate-200/50">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
               <div className="bg-blue-600 text-white p-1 rounded-lg">
                  <SparklesIcon className="w-4 h-4" />
               </div>
               <h3 className="text-slate-900 font-black text-xl uppercase tracking-tight">Técnica: Ritmo vs Cadencia</h3>
            </div>
            <p className="text-slate-500 text-sm font-medium leading-relaxed max-w-2xl">
              Analiza la correlación bio-mecánica entre tu frecuencia de paso y la longitud de zancada. El filtrado de terreno llano permite aislar la fatiga de la pendiente.
            </p>
          </div>
          
          <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-2xl border border-slate-100 shrink-0">
             <button 
                onClick={() => setFlatOnly(false)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${!flatOnly ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
             >
                Todo
             </button>
             <button 
                onClick={() => setFlatOnly(true)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${flatOnly ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
             >
                Solo Llanas
             </button>
          </div>
        </div>

        {uniqueYears.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Años:</span>
            {uniqueYears.map(year => {
              const colorIdx = year % YEAR_COLORS.length;
              const isSelected = !deselectedYears.has(year);
              return (
                <button 
                  key={year} 
                  onClick={() => {
                    const next = new Set(deselectedYears);
                    if (isSelected) next.add(year);
                    else next.delete(year);
                    setDeselectedYears(next);
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${isSelected ? 'bg-slate-50 border-slate-200 hover:bg-slate-100' : 'bg-transparent border-dashed border-slate-200 opacity-60 hover:opacity-100'}`}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: isSelected ? YEAR_COLORS[colorIdx] : '#cbd5e1' }}></span>
                  <span className={`text-xs font-medium ${isSelected ? 'text-slate-600' : 'text-slate-400'}`}>{year}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="h-[500px] w-full mt-4 bg-slate-50/20 rounded-2xl p-6 border border-slate-100/50 relative overflow-hidden">
           <div className="absolute inset-0 bg-gradient-to-b from-slate-50/40 to-transparent pointer-events-none" />
           <ResponsiveContainer width="100%" height="100%">
             <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 10 }}>
               <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
               <XAxis 
                 type="number" 
                 dataKey="ritmoVal" 
                 name="Ritmo" 
                 domain={['dataMin', 'dataMax']}
                 tickFormatter={(val) => {
                   const m = Math.floor(val);
                   const s = Math.round((val - m) * 60);
                   return `${m}:${s.toString().padStart(2, '0')}`;
                 }}
                 reversed={true}
                 tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 700 }}
                 axisLine={{ stroke: '#f1f5f9' }}
                 tickLine={false}
               />
               <YAxis 
                 type="number" 
                 dataKey="Cadencia" 
                 name="Cadencia" 
                 domain={['dataMin - 5', 'dataMax + 5']}
                 tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 700 }}
                 axisLine={false}
                 tickLine={false}
               />
               <ZAxis type="number" dataKey="Distancia" range={[60, 600]} name="Distancia" />
               <RechartsTooltip cursor={{ strokeDasharray: '3 3', stroke: '#3b82f6', strokeWidth: 2 }} content={<CustomTooltip />} />
               <Scatter 
                 name="Actividades" 
                 data={chartData} 
                 onClick={(e) => window.open(`https://www.strava.com/activities/${e.id}`, '_blank')}
                 className="cursor-pointer"
               >
                 {chartData.map((entry, index) => {
                   const colorIdx = entry.year % YEAR_COLORS.length;
                   return <Cell key={`cell-${index}`} fill={YEAR_COLORS[colorIdx]} fillOpacity={0.6} className="hover:opacity-100 transition-opacity drop-shadow-lg" strokeWidth={1} stroke="#fff" />;
                 })}
               </Scatter>
             </ScatterChart>
           </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
