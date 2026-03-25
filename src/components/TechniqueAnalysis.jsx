import { Card, Title, Text } from '@tremor/react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ZAxis, Cell } from 'recharts';
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-2">Cadencia Media</p>
            <p className="text-2xl font-black text-slate-900 tabular-nums">{stats.cadence} <span className="text-sm font-medium text-slate-400">spm</span></p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
            <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-2">Zancada Media</p>
            <p className="text-2xl font-black text-slate-900 tabular-nums">{stats.stride} <span className="text-sm font-medium text-slate-400">m</span></p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
            <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2">Mejor Ritmo Registrado</p>
            <p className="text-2xl font-black text-slate-900 tabular-nums">{stats.bestPace} <span className="text-sm font-medium text-slate-400">/km</span></p>
          </div>
        </div>
      )}

      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
          <Title className="text-slate-800 font-bold">Técnica: Ritmo vs Cadencia</Title>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
              <input 
                type="checkbox" 
                id="flatFilter" 
                checked={flatOnly}
                onChange={(e) => setFlatOnly(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
              />
              <label htmlFor="flatFilter" className="text-sm font-semibold text-slate-700 cursor-pointer select-none">
                Solo llanas (≤ 1.5%)
              </label>
            </div>
          </div>
        </div>
        <Text className="text-slate-500 mb-4 max-w-2xl">
          Descubre cómo varía tu cadencia y longitud de zancada a diferentes ritmos. Analizar los datos sobre terreno llano ofrece la visión más real de tu técnica.
        </Text>

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

        <div className="h-[450px] w-full mt-2 bg-slate-50/50 rounded-xl p-4 border border-slate-100 relative">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
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
                label={{ value: 'Ritmo (min/km) - MÁS RÁPIDO →', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                tick={{ fill: '#64748b', fontSize: 12 }}
                tickCount={8}
              />
              <YAxis 
                type="number" 
                dataKey="Cadencia" 
                name="Cadencia" 
                domain={['dataMin - 5', 'dataMax + 5']}
                label={{ value: 'Cadencia (spm)', angle: -90, position: 'insideLeft', offset: -5, fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                tick={{ fill: '#64748b', fontSize: 12 }}
              />
              <ZAxis type="number" dataKey="Distancia" range={[40, 400]} name="Distancia" />
              <RechartsTooltip cursor={{ strokeDasharray: '3 3', stroke: '#cbd5e1' }} content={<CustomTooltip />} />
              <Scatter 
                name="Actividades" 
                data={chartData} 
                onClick={(e) => window.open(`https://www.strava.com/activities/${e.id}`, '_blank')}
                className="cursor-pointer"
              >
                {chartData.map((entry, index) => {
                  const colorIdx = entry.year % YEAR_COLORS.length;
                  return <Cell key={`cell-${index}`} fill={YEAR_COLORS[colorIdx]} fillOpacity={0.7} className="hover:opacity-100 transition-opacity drop-shadow-sm" />;
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
