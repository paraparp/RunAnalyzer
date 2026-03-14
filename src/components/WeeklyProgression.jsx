import { useMemo, useState } from 'react';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';

function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return {
    year: d.getFullYear(),
    week: 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7),
  };
}

function getWeekStart(year, week) {
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7;
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - dayOfWeek);
  const weekStart = new Date(firstMonday);
  weekStart.setDate(firstMonday.getDate() + (week - 1) * 7);
  return weekStart;
}

const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export default function WeeklyProgression({ activities }) {
  const [monthsToShow, setMonthsToShow] = useState('6');

  const { weeklyData, stats } = useMemo(() => {
    if (!activities || activities.length === 0) return { weeklyData: [], stats: null };

    const weeksMap = {};

    activities.forEach(a => {
      const { year, week } = getISOWeek(a.start_date);
      const key = `${year}-W${String(week).padStart(2, '0')}`;
      if (!weeksMap[key]) {
        weeksMap[key] = { key, year, week, km: 0, time: 0, sessions: 0, elevation: 0 };
      }
      weeksMap[key].km += (a.distance || 0) / 1000;
      weeksMap[key].time += (a.moving_time || 0) / 3600;
      weeksMap[key].sessions += 1;
      weeksMap[key].elevation += a.total_elevation_gain || 0;
    });

    const sorted = Object.values(weeksMap).sort((a, b) => a.key.localeCompare(b.key));

    // Fill gaps between weeks
    const filled = [];
    if (sorted.length > 0) {
      const firstWeekStart = getWeekStart(sorted[0].year, sorted[0].week);
      const lastWeekStart = getWeekStart(sorted[sorted.length - 1].year, sorted[sorted.length - 1].week);
      const cursor = new Date(firstWeekStart);

      while (cursor <= lastWeekStart) {
        const { year, week } = getISOWeek(cursor);
        const key = `${year}-W${String(week).padStart(2, '0')}`;
        const existing = weeksMap[key];
        filled.push(existing || { key, year, week, km: 0, time: 0, sessions: 0, elevation: 0 });
        cursor.setDate(cursor.getDate() + 7);
      }
    }

    // Calculate change % and moving average
    const withMetrics = filled.map((w, i) => {
      const prev = i > 0 ? filled[i - 1] : null;
      const change = prev && prev.km > 0 ? ((w.km - prev.km) / prev.km) * 100 : 0;
      const exceeds10 = prev && prev.km > 2 && change > 10;

      // 4-week moving average
      const start = Math.max(0, i - 3);
      const window = filled.slice(start, i + 1);
      const avg4w = window.reduce((s, x) => s + x.km, 0) / window.length;

      const weekStart = getWeekStart(w.year, w.week);
      const label = `${weekStart.getDate()} ${MONTH_SHORT[weekStart.getMonth()]}`;

      return {
        ...w,
        change: Math.round(change),
        exceeds10,
        avg4w: Math.round(avg4w * 10) / 10,
        label,
        dateMs: weekStart.getTime(),
      };
    });

    // Filter by time range
    const months = parseInt(monthsToShow);
    const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
    const filtered = withMetrics.filter(w => w.dateMs >= cutoff);

    // Stats
    const recent4 = filtered.slice(-4);
    const avg4 = recent4.length > 0 ? recent4.reduce((s, w) => s + w.km, 0) / recent4.length : 0;
    const currentWeek = filtered.length > 0 ? filtered[filtered.length - 1] : null;
    const exceedCount = filtered.filter(w => w.exceeds10).length;

    // Streak of consecutive weeks with activity
    let streak = 0;
    for (let i = filtered.length - 1; i >= 0; i--) {
      if (filtered[i].km > 0) streak++;
      else break;
    }

    const maxWeek = filtered.reduce((max, w) => w.km > max.km ? w : max, { km: 0 });

    return {
      weeklyData: filtered,
      stats: {
        currentKm: currentWeek ? currentWeek.km : 0,
        currentChange: currentWeek ? currentWeek.change : 0,
        avg4weeks: avg4,
        streak,
        exceedCount,
        totalWeeks: filtered.length,
        maxWeek: maxWeek.km,
        maxWeekLabel: maxWeek.label,
      },
    };
  }, [activities, monthsToShow]);

  if (!weeklyData.length || !stats) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-sm">No hay datos suficientes para mostrar la progresión semanal.</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
        <p className="font-bold text-slate-700 mb-1">{d.label} (S{d.week})</p>
        <p className="text-indigo-600">Distancia: <span className="font-bold">{d.km.toFixed(1)} km</span></p>
        <p className="text-slate-500">Sesiones: {d.sessions} | Desnivel: {Math.round(d.elevation)}m</p>
        <p className="text-slate-500">Media 4 sem: {d.avg4w} km</p>
        {d.change !== 0 && (
          <p className={d.exceeds10 ? 'text-rose-600 font-bold' : 'text-slate-500'}>
            Cambio: {d.change > 0 ? '+' : ''}{d.change}%
            {d.exceeds10 && ' ⚠️ >10%'}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Semana actual</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{stats.currentKm.toFixed(1)}</p>
          <p className={`text-[10px] mt-0.5 font-semibold ${stats.currentChange > 10 ? 'text-rose-500' : stats.currentChange > 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
            {stats.currentChange > 0 ? '+' : ''}{stats.currentChange}% vs anterior
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Media 4 semanas</p>
          <p className="text-2xl font-bold text-indigo-600 tabular-nums">{stats.avg4weeks.toFixed(1)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">km/semana</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Racha activa</p>
          <p className="text-2xl font-bold text-emerald-600 tabular-nums">{stats.streak}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">semanas consecutivas</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Semana pico</p>
          <p className="text-2xl font-bold text-amber-600 tabular-nums">{stats.maxWeek.toFixed(1)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{stats.maxWeekLabel}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Alertas +10%</p>
          <p className={`text-2xl font-bold tabular-nums ${stats.exceedCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{stats.exceedCount}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">de {stats.totalWeeks} semanas</p>
        </div>
      </div>

      {/* Main chart */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex items-center justify-between mb-1">
          <div>
            <Title className="text-slate-800 font-bold">Progresión de Volumen Semanal</Title>
            <Text className="text-slate-500 text-sm">km por semana con media móvil de 4 semanas y regla del 10%</Text>
          </div>
          <Select value={monthsToShow} onValueChange={setMonthsToShow} className="w-32">
            <SelectItem value="3">3 meses</SelectItem>
            <SelectItem value="6">6 meses</SelectItem>
            <SelectItem value="12">12 meses</SelectItem>
            <SelectItem value="24">24 meses</SelectItem>
          </Select>
        </div>

        <div className="h-[360px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={weeklyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                interval={Math.max(0, Math.floor(weeklyData.length / 12))}
              />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <RechartsTooltip content={<CustomTooltip />} />
              <Bar dataKey="km" radius={[4, 4, 0, 0]} maxBarSize={24}>
                {weeklyData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={entry.exceeds10 ? '#f43f5e' : entry.km === 0 ? '#e2e8f0' : '#818cf8'}
                    fillOpacity={entry.exceeds10 ? 0.85 : 0.7}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="avg4w"
                stroke="#4f46e5"
                strokeWidth={2}
                dot={false}
                strokeDasharray="5 3"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Legend */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">Regla del 10%</Title>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-600">
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 rounded-sm bg-indigo-400 mt-0.5 shrink-0" />
            <p>Las barras muestran el volumen semanal en km. La línea punteada es la media móvil de 4 semanas.</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 rounded-sm bg-rose-500 mt-0.5 shrink-0" />
            <p>Las barras rojas indican semanas donde el volumen aumentó más del 10% respecto a la semana anterior, incrementando el riesgo de lesión.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
