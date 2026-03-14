import { useMemo, useState, useCallback } from 'react';
import { Card, Title, Text } from '@tremor/react';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend
} from 'recharts';

const SPLIT_TYPES = {
  negative: { label: 'Negative Split', color: '#10b981', desc: '2ª mitad más rápida' },
  even: { label: 'Even Split', color: '#6366f1', desc: 'Ritmo uniforme (<2%)' },
  positive: { label: 'Positive Split', color: '#f59e0b', desc: '1ª mitad más rápida' },
  collapse: { label: 'Collapse', color: '#ef4444', desc: 'Último tercio >8% más lento' },
};

function classifySplits(splits) {
  if (!splits || splits.length < 2) return null;

  const paces = splits
    .filter(s => s.average_speed > 0 && s.distance > 500)
    .map(s => 1000 / (s.average_speed * 60));

  if (paces.length < 2) return null;

  const mid = Math.floor(paces.length / 2);
  const firstHalf = paces.slice(0, mid);
  const secondHalf = paces.slice(mid);

  const avgFirst = firstHalf.reduce((s, p) => s + p, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, p) => s + p, 0) / secondHalf.length;

  // Collapse check: last third vs first third
  const third = Math.floor(paces.length / 3);
  if (third >= 1) {
    const firstThird = paces.slice(0, third);
    const lastThird = paces.slice(-third);
    const avgFirstThird = firstThird.reduce((s, p) => s + p, 0) / firstThird.length;
    const avgLastThird = lastThird.reduce((s, p) => s + p, 0) / lastThird.length;
    const collapseChange = ((avgLastThird - avgFirstThird) / avgFirstThird) * 100;
    if (collapseChange > 8) return 'collapse';
  }

  const change = ((avgSecond - avgFirst) / avgFirst) * 100;

  if (change < -2) return 'negative';
  if (change > 2) return 'positive';
  return 'even';
}

function formatPace(minPerKm) {
  if (!minPerKm || minPerKm <= 0 || minPerKm > 15) return '--:--';
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function SplitAnalysis({ activities, onEnrichActivity }) {
  const [selectedId, setSelectedId] = useState(null);
  const [loadingId, setLoadingId] = useState(null);

  const handleLoadSplits = useCallback(async (id) => {
    if (onEnrichActivity) {
      setLoadingId(id);
      await onEnrichActivity(id);
      setLoadingId(null);
    }
  }, [onEnrichActivity]);

  const { classified, distribution, trendData } = useMemo(() => {
    if (!activities || activities.length === 0) return { classified: [], distribution: [], trendData: [] };

    const withSplits = activities
      .filter(a => a.splits_metric && a.splits_metric.length >= 2 && a.distance >= 2000)
      .map(a => {
        const type = classifySplits(a.splits_metric);
        const pace = a.average_speed > 0 ? 16.6667 / a.average_speed : 0;
        return {
          id: a.id,
          name: a.name,
          date: a.start_date,
          dateLabel: new Date(a.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
          km: (a.distance / 1000).toFixed(1),
          pace: formatPace(pace),
          type,
          splits: a.splits_metric,
        };
      })
      .filter(a => a.type !== null)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Distribution
    const counts = { negative: 0, even: 0, positive: 0, collapse: 0 };
    withSplits.forEach(a => counts[a.type]++);
    const dist = Object.entries(counts).map(([type, count]) => ({
      name: SPLIT_TYPES[type].label,
      value: count,
      color: SPLIT_TYPES[type].color,
      type,
    }));

    // Trend: monthly ratio of negative splits
    const monthly = {};
    withSplits.forEach(a => {
      const month = a.date.slice(0, 7);
      if (!monthly[month]) monthly[month] = { total: 0, negative: 0, even: 0 };
      monthly[month].total++;
      if (a.type === 'negative') monthly[month].negative++;
      if (a.type === 'even') monthly[month].even++;
    });
    const trend = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, d]) => ({
        month: month.slice(5) + '/' + month.slice(2, 4),
        negativeRate: Math.round((d.negative / d.total) * 100),
        evenRate: Math.round((d.even / d.total) * 100),
        goodRate: Math.round(((d.negative + d.even) / d.total) * 100),
      }));

    return { classified: withSplits, distribution: dist, trendData: trend };
  }, [activities]);

  const selectedActivity = useMemo(() => {
    if (!selectedId) return null;
    return classified.find(a => a.id === selectedId);
  }, [selectedId, classified]);

  const selectedSplitData = useMemo(() => {
    if (!selectedActivity?.splits) return [];
    return selectedActivity.splits
      .filter(s => s.average_speed > 0 && s.distance > 500)
      .map((s, idx) => ({
        km: idx + 1,
        pace: 1000 / (s.average_speed * 60),
        paceLabel: formatPace(1000 / (s.average_speed * 60)),
        hr: s.average_heartrate || 0,
        elev: (s.elevation_difference || 0),
      }));
  }, [selectedActivity]);

  if (!classified.length) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-sm">No hay actividades con datos de parciales disponibles.</p>
        <p className="text-xs mt-2">Los parciales se cargan al acceder a la sección de Análisis FC o al hacer clic en una actividad.</p>
      </div>
    );
  }

  const totalClassified = classified.length;
  const negativeCount = classified.filter(a => a.type === 'negative').length;
  const collapseCount = classified.filter(a => a.type === 'collapse').length;
  const negativeRate = Math.round((negativeCount / totalClassified) * 100);

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Actividades analizadas</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{totalClassified}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">con datos de parciales</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Negative Splits</p>
          <p className="text-2xl font-bold text-emerald-600 tabular-nums">{negativeRate}%</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{negativeCount} de {totalClassified}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Collapse</p>
          <p className={`text-2xl font-bold tabular-nums ${collapseCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{collapseCount}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">sesiones con caída fuerte</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Disciplina</p>
          <p className={`text-2xl font-bold tabular-nums ${negativeRate >= 40 ? 'text-emerald-600' : negativeRate >= 20 ? 'text-amber-600' : 'text-rose-600'}`}>
            {negativeRate >= 40 ? 'Alta' : negativeRate >= 20 ? 'Media' : 'Baja'}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">gestión de ritmo</p>
        </div>
      </div>

      {/* Distribution + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">Distribución de Parciales</Title>
          <Text className="text-slate-500 text-sm mb-4">Clasificación de todas las actividades</Text>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                  labelLine={false}
                >
                  {distribution.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
                <Legend
                  formatter={(value) => <span className="text-xs text-slate-600">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {trendData.length > 1 && (
          <Card className="shadow-lg border-slate-200">
            <Title className="text-slate-800 font-bold mb-1">Tendencia Mensual</Title>
            <Text className="text-slate-500 text-sm mb-4">% de sesiones con buen pacing (negative + even)</Text>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} unit="%" />
                  <RechartsTooltip
                    formatter={(val) => [`${val}%`]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="goodRate" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Buen pacing" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

      {/* Activity list */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">Historial de Parciales</Title>
        <Text className="text-slate-500 text-sm mb-4">Haz clic en una actividad para ver los splits km a km</Text>

        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Fecha</th>
                <th className="text-left py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Actividad</th>
                <th className="text-right py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Dist.</th>
                <th className="text-right py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Pace</th>
                <th className="text-center py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {classified.slice(0, 50).map(a => (
                <tr
                  key={a.id}
                  onClick={() => setSelectedId(selectedId === a.id ? null : a.id)}
                  className={`border-b border-slate-100 cursor-pointer transition-colors ${selectedId === a.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="py-2 px-2 text-slate-500 text-xs">{a.dateLabel}</td>
                  <td className="py-2 px-2 text-slate-700 font-medium truncate max-w-[200px]">{a.name}</td>
                  <td className="py-2 px-2 text-right text-slate-600 tabular-nums">{a.km} km</td>
                  <td className="py-2 px-2 text-right text-slate-600 tabular-nums">{a.pace}</td>
                  <td className="py-2 px-2 text-center">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: SPLIT_TYPES[a.type].color }}
                    >
                      {SPLIT_TYPES[a.type].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Selected activity splits chart */}
      {selectedActivity && selectedSplitData.length > 0 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">
            Splits: {selectedActivity.name}
          </Title>
          <Text className="text-slate-500 text-sm mb-4">
            {selectedActivity.dateLabel} — {selectedActivity.km} km a {selectedActivity.pace}/km
          </Text>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={selectedSplitData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="km" tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'km', position: 'bottom', fontSize: 10 }} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  domain={['auto', 'auto']}
                  reversed
                  tickFormatter={v => formatPace(v)}
                />
                <RechartsTooltip
                  formatter={(val, name) => {
                    if (name === 'pace') return [formatPace(val), 'Ritmo'];
                    if (name === 'hr') return [`${Math.round(val)} bpm`, 'FC'];
                    return [val, name];
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="pace" radius={[4, 4, 0, 0]} maxBarSize={28}>
                  {selectedSplitData.map((entry, idx) => {
                    const avg = selectedSplitData.reduce((s, e) => s + e.pace, 0) / selectedSplitData.length;
                    const faster = entry.pace <= avg;
                    return <Cell key={idx} fill={faster ? '#10b981' : '#f59e0b'} fillOpacity={0.75} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Guide */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">Cómo interpretar</Title>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-600">
          {Object.entries(SPLIT_TYPES).map(([key, val]) => (
            <div key={key} className="flex items-start gap-2">
              <div className="w-3 h-3 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: val.color }} />
              <div>
                <p className="font-semibold text-slate-700">{val.label}</p>
                <p className="text-xs">{val.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Un alto porcentaje de negative splits indica buena gestión del ritmo y madurez como corredor.
          Los collapses suelen indicar salidas demasiado rápidas o falta de resistencia.
        </p>
      </Card>
    </div>
  );
}
