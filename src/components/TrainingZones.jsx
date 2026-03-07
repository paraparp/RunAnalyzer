import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { Card, Title, Text, Select, SelectItem, Badge, Callout } from '@tremor/react';

const ZONE_CONFIG = [
  { name: 'Z1', label: 'Recuperación', color: '#94a3b8', range: [0, 0.6] },
  { name: 'Z2', label: 'Aeróbico', color: '#22c55e', range: [0.6, 0.7] },
  { name: 'Z3', label: 'Tempo', color: '#f59e0b', range: [0.7, 0.8] },
  { name: 'Z4', label: 'Umbral', color: '#f97316', range: [0.8, 0.9] },
  { name: 'Z5', label: 'VO2max', color: '#ef4444', range: [0.9, 1.0] },
];

function getZone(hr, maxHR) {
  if (!hr || !maxHR || maxHR === 0) return null;
  const pct = hr / maxHR;
  for (let i = ZONE_CONFIG.length - 1; i >= 0; i--) {
    if (pct >= ZONE_CONFIG[i].range[0]) return i;
  }
  return 0;
}

export default function TrainingZones({ activities }) {
  const [maxHR, setMaxHR] = useState('');
  const [groupBy, setGroupBy] = useState('total');

  const detectedMaxHR = useMemo(() => {
    if (!activities || activities.length === 0) return 190;
    const hrs = activities.filter(a => a.max_heartrate).map(a => a.max_heartrate);
    return hrs.length > 0 ? Math.max(...hrs) : 190;
  }, [activities]);

  const effectiveMaxHR = maxHR ? parseInt(maxHR) : detectedMaxHR;

  // Overall zone distribution
  const zoneDistribution = useMemo(() => {
    if (!activities || activities.length === 0) return [];

    const zoneTimes = [0, 0, 0, 0, 0];
    let totalTime = 0;

    activities.forEach(a => {
      if (!a.average_heartrate || !a.moving_time) return;
      const zone = getZone(a.average_heartrate, effectiveMaxHR);
      if (zone !== null) {
        zoneTimes[zone] += a.moving_time;
        totalTime += a.moving_time;
      }
    });

    if (totalTime === 0) return [];

    return ZONE_CONFIG.map((z, i) => ({
      ...z,
      minutes: Math.round(zoneTimes[i] / 60),
      hours: Number((zoneTimes[i] / 3600).toFixed(1)),
      percentage: Number(((zoneTimes[i] / totalTime) * 100).toFixed(1)),
    }));
  }, [activities, effectiveMaxHR]);

  // Grouped data (weekly or monthly)
  const groupedData = useMemo(() => {
    if (!activities || activities.length === 0 || groupBy === 'total') return [];

    const buckets = {};

    activities.forEach(a => {
      if (!a.average_heartrate || !a.moving_time) return;
      const date = new Date(a.start_date);
      let key;

      if (groupBy === 'week') {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        key = d.toISOString().split('T')[0];
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }

      if (!buckets[key]) {
        buckets[key] = { key, label: '', zones: [0, 0, 0, 0, 0], total: 0 };
        if (groupBy === 'week') {
          const d = new Date(key);
          buckets[key].label = `${d.getDate()}/${d.getMonth() + 1}`;
          buckets[key].sortDate = d.getTime();
        } else {
          const [y, m] = key.split('-');
          const d = new Date(parseInt(y), parseInt(m) - 1);
          buckets[key].label = d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
          buckets[key].sortDate = d.getTime();
        }
      }

      const zone = getZone(a.average_heartrate, effectiveMaxHR);
      if (zone !== null) {
        buckets[key].zones[zone] += a.moving_time;
        buckets[key].total += a.moving_time;
      }
    });

    const sorted = Object.values(buckets).sort((a, b) => a.sortDate - b.sortDate);
    const sliced = groupBy === 'week' ? sorted.slice(-16) : sorted.slice(-12);

    return sliced.map(b => {
      const row = { name: b.label };
      ZONE_CONFIG.forEach((z, i) => {
        row[z.name] = Number((b.zones[i] / 3600).toFixed(1));
      });
      return row;
    });
  }, [activities, effectiveMaxHR, groupBy]);

  // 80/20 analysis
  const polarizationAnalysis = useMemo(() => {
    if (zoneDistribution.length === 0) return null;
    const easyPct = (zoneDistribution[0]?.percentage || 0) + (zoneDistribution[1]?.percentage || 0);
    const hardPct = (zoneDistribution[3]?.percentage || 0) + (zoneDistribution[4]?.percentage || 0);
    const grayZonePct = zoneDistribution[2]?.percentage || 0;

    let status, message, color;
    if (easyPct >= 75 && grayZonePct <= 15) {
      status = 'Polarizado';
      message = `Tu distribución es ${easyPct.toFixed(0)}% fácil / ${hardPct.toFixed(0)}% intenso. Excelente adherencia al modelo 80/20.`;
      color = 'emerald';
    } else if (grayZonePct > 25) {
      status = 'Demasiada Zona Gris';
      message = `Pasas un ${grayZonePct.toFixed(0)}% en Z3 (Tempo). Intenta que tus días fáciles sean más fáciles y los duros más duros.`;
      color = 'amber';
    } else {
      status = 'Moderado';
      message = `Distribución ${easyPct.toFixed(0)}% fácil / ${hardPct.toFixed(0)}% intenso. Podrías beneficiarte de más volumen en Z1-Z2.`;
      color = 'sky';
    }

    return { status, message, color, easyPct, hardPct, grayZonePct };
  }, [zoneDistribution]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-xl rounded-xl">
          <p className="font-bold text-slate-800 text-sm mb-2">{label}</p>
          {payload.reverse().map((entry, i) => (
            <p key={i} className="text-xs text-slate-600">
              <span style={{ color: entry.color }}>{entry.name}</span>: <span className="font-bold">{entry.value}h</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Header with MaxHR config */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <Title className="text-slate-800 font-bold mb-1">Zonas de Entrenamiento</Title>
            <Text className="text-slate-500 text-sm">Distribución de tiempo en zonas de frecuencia cardíaca (Z1-Z5)</Text>
          </div>
          <div className="flex items-center gap-3">
            <div>
              <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">FC Máx</Text>
              <input
                type="number"
                placeholder={String(detectedMaxHR)}
                value={maxHR}
                onChange={e => setMaxHR(e.target.value)}
                className="w-20 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all tabular-nums text-center font-semibold"
              />
            </div>
            <div>
              <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Agrupar</Text>
              <Select value={groupBy} onValueChange={setGroupBy} enableClear={false} className="w-32">
                <SelectItem value="total">Global</SelectItem>
                <SelectItem value="month">Mensual</SelectItem>
                <SelectItem value="week">Semanal</SelectItem>
              </Select>
            </div>
          </div>
        </div>

        {/* Zone ranges reference */}
        <div className="flex flex-wrap gap-2 mb-6">
          {ZONE_CONFIG.map(z => (
            <div key={z.name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-100">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: z.color }} />
              <span className="text-[11px] font-bold text-slate-700">{z.name}</span>
              <span className="text-[10px] text-slate-400">{z.label}</span>
              <span className="text-[10px] text-slate-400 tabular-nums">
                ({Math.round(z.range[0] * effectiveMaxHR)}-{Math.round(z.range[1] * effectiveMaxHR)} bpm)
              </span>
            </div>
          ))}
        </div>

        {groupBy === 'total' ? (
          /* Global distribution bars */
          <div className="space-y-3">
            {zoneDistribution.map(z => (
              <div key={z.name} className="flex items-center gap-3">
                <div className="w-8 text-right">
                  <span className="text-xs font-bold text-slate-700">{z.name}</span>
                </div>
                <div className="flex-1 bg-slate-100 rounded-full h-8 overflow-hidden relative">
                  <div
                    className="h-full rounded-full transition-all duration-500 flex items-center px-3"
                    style={{ width: `${Math.max(z.percentage, 2)}%`, backgroundColor: z.color }}
                  >
                    {z.percentage > 8 && (
                      <span className="text-[11px] font-bold text-white whitespace-nowrap">{z.percentage}%</span>
                    )}
                  </div>
                </div>
                <div className="w-20 text-right">
                  <span className="text-xs font-semibold text-slate-600 tabular-nums">{z.hours}h</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Stacked bar chart by week/month */
          <div className="h-80 w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={groupedData} stackOffset="none">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} label={{ value: 'Horas', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }} />
                <RechartsTooltip content={<CustomTooltip />} />
                {ZONE_CONFIG.map(z => (
                  <Bar key={z.name} dataKey={z.name} stackId="zones" fill={z.color} radius={0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* 80/20 Analysis */}
      {polarizationAnalysis && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-4">Análisis 80/20 (Polarización)</Title>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100 text-center">
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1">Fácil (Z1+Z2)</p>
              <p className="text-2xl font-bold text-emerald-700 tabular-nums">{polarizationAnalysis.easyPct.toFixed(0)}%</p>
              <p className="text-[10px] text-emerald-500 mt-0.5">Objetivo: ≥80%</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 text-center">
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1">Zona Gris (Z3)</p>
              <p className="text-2xl font-bold text-amber-700 tabular-nums">{polarizationAnalysis.grayZonePct.toFixed(0)}%</p>
              <p className="text-[10px] text-amber-500 mt-0.5">Objetivo: ≤10%</p>
            </div>
            <div className="bg-rose-50 rounded-xl p-4 border border-rose-100 text-center">
              <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wider mb-1">Intenso (Z4+Z5)</p>
              <p className="text-2xl font-bold text-rose-700 tabular-nums">{polarizationAnalysis.hardPct.toFixed(0)}%</p>
              <p className="text-[10px] text-rose-500 mt-0.5">Objetivo: ~20%</p>
            </div>
          </div>

          {/* Visual distribution bar */}
          <div className="h-6 rounded-full overflow-hidden flex mb-4">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${polarizationAnalysis.easyPct}%` }} />
            <div className="h-full bg-amber-400 transition-all" style={{ width: `${polarizationAnalysis.grayZonePct}%` }} />
            <div className="h-full bg-rose-400 transition-all" style={{ width: `${polarizationAnalysis.hardPct}%` }} />
          </div>

          <Callout title={polarizationAnalysis.status} color={polarizationAnalysis.color}>
            {polarizationAnalysis.message}
          </Callout>
        </Card>
      )}
    </div>
  );
}
