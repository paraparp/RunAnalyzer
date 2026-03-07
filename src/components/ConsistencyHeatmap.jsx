import { useMemo, useState } from 'react';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DAY_LABELS = ['Lun', '', 'Mié', '', 'Vie', '', 'Dom'];

function getColorForValue(value, max, metric) {
  if (!value || value === 0) return 'bg-slate-100';
  const intensity = Math.min(value / max, 1);
  if (metric === 'load') {
    if (intensity < 0.25) return 'bg-rose-100';
    if (intensity < 0.5) return 'bg-rose-200';
    if (intensity < 0.75) return 'bg-rose-400';
    return 'bg-rose-600';
  }
  if (intensity < 0.25) return 'bg-emerald-100';
  if (intensity < 0.5) return 'bg-emerald-300';
  if (intensity < 0.75) return 'bg-emerald-500';
  return 'bg-emerald-700';
}

export default function ConsistencyHeatmap({ activities }) {
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [metric, setMetric] = useState('distance');

  const availableYears = useMemo(() => {
    if (!activities || activities.length === 0) return [new Date().getFullYear()];
    const years = new Set(activities.map(a => new Date(a.start_date).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [activities]);

  // Build daily data for selected year
  const { dailyData, maxValue } = useMemo(() => {
    if (!activities) return { dailyData: {}, maxValue: 1 };

    const data = {};
    let max = 0;

    activities.forEach(a => {
      const date = new Date(a.start_date);
      if (date.getFullYear() !== selectedYear) return;
      const key = date.toISOString().split('T')[0];

      if (!data[key]) data[key] = { distance: 0, time: 0, load: 0, count: 0 };
      data[key].distance += (a.distance || 0) / 1000;
      data[key].time += (a.moving_time || 0) / 60;
      data[key].load += a.suffer_score || 0;
      data[key].count += 1;

      const val = metric === 'distance' ? data[key].distance
        : metric === 'time' ? data[key].time
        : data[key].load;
      if (val > max) max = val;
    });

    return { dailyData: data, maxValue: max || 1 };
  }, [activities, selectedYear, metric]);

  // Build weeks grid for the year
  const weeksGrid = useMemo(() => {
    const jan1 = new Date(selectedYear, 0, 1);
    const dec31 = new Date(selectedYear, 11, 31);

    // Adjust start to Monday
    const startDay = jan1.getDay();
    const start = new Date(jan1);
    start.setDate(start.getDate() - ((startDay + 6) % 7)); // Go back to Monday

    const weeks = [];
    let current = new Date(start);

    while (current <= dec31 || weeks.length < 53) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = current.toISOString().split('T')[0];
        const inYear = current.getFullYear() === selectedYear;
        const value = dailyData[dateStr] || null;
        const metricValue = value
          ? (metric === 'distance' ? value.distance
            : metric === 'time' ? value.time
            : value.load)
          : 0;

        week.push({
          date: dateStr,
          inYear,
          value,
          metricValue,
          month: current.getMonth(),
          day: current.getDate(),
        });
        current.setDate(current.getDate() + 1);
      }
      weeks.push(week);
      if (current.getFullYear() > selectedYear && current.getDay() === 1) break;
    }

    return weeks;
  }, [selectedYear, dailyData, metric]);

  // Month labels positions
  const monthPositions = useMemo(() => {
    const positions = [];
    let lastMonth = -1;
    weeksGrid.forEach((week, wi) => {
      const firstInYear = week.find(d => d.inYear);
      if (firstInYear && firstInYear.month !== lastMonth) {
        positions.push({ month: firstInYear.month, weekIndex: wi });
        lastMonth = firstInYear.month;
      }
    });
    return positions;
  }, [weeksGrid]);

  // Consistency stats
  const consistencyStats = useMemo(() => {
    if (!activities || activities.length === 0) return { currentStreak: 0, longestStreak: 0, totalDays: 0, weeksWith3: 0, totalWeeks: 0 };

    const yearActivities = activities.filter(a => new Date(a.start_date).getFullYear() === selectedYear);
    const activeDays = new Set(yearActivities.map(a => a.start_date.split('T')[0]));
    const totalDays = activeDays.size;

    // Streaks: consecutive days with activity
    const sortedDays = Array.from(activeDays).sort();
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    for (let i = 0; i < sortedDays.length; i++) {
      if (i === 0) {
        tempStreak = 1;
      } else {
        const prev = new Date(sortedDays[i - 1]);
        const curr = new Date(sortedDays[i]);
        const diffDays = (curr - prev) / 86400000;
        tempStreak = diffDays === 1 ? tempStreak + 1 : 1;
      }
      if (tempStreak > longestStreak) longestStreak = tempStreak;
    }

    // Check if current streak is alive (includes today or yesterday)
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (sortedDays.length > 0) {
      const lastDay = sortedDays[sortedDays.length - 1];
      if (lastDay === today || lastDay === yesterday) {
        let streak = 1;
        for (let i = sortedDays.length - 2; i >= 0; i--) {
          const prev = new Date(sortedDays[i]);
          const curr = new Date(sortedDays[i + 1]);
          if ((curr - prev) / 86400000 === 1) {
            streak++;
          } else break;
        }
        currentStreak = streak;
      }
    }

    // Weeks with >= 3 sessions
    const weekCounts = {};
    yearActivities.forEach(a => {
      const d = new Date(a.start_date);
      const dayOfWeek = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
      const weekKey = monday.toISOString().split('T')[0];
      weekCounts[weekKey] = (weekCounts[weekKey] || 0) + 1;
    });

    const totalWeeks = Object.keys(weekCounts).length;
    const weeksWith3 = Object.values(weekCounts).filter(c => c >= 3).length;

    return { currentStreak, longestStreak, totalDays, weeksWith3, totalWeeks };
  }, [activities, selectedYear]);

  const metricUnit = metric === 'distance' ? 'km' : metric === 'time' ? 'min' : 'pts';

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Días activos</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{consistencyStats.totalDays}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">en {selectedYear}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Racha actual</p>
          <p className="text-2xl font-bold text-emerald-600 tabular-nums">{consistencyStats.currentStreak}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">días seguidos</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Mejor racha</p>
          <p className="text-2xl font-bold text-indigo-600 tabular-nums">{consistencyStats.longestStreak}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">días seguidos</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Semanas ≥3 sesiones</p>
          <p className="text-2xl font-bold text-amber-600 tabular-nums">{consistencyStats.weeksWith3}<span className="text-sm font-medium text-slate-400">/{consistencyStats.totalWeeks}</span></p>
          <p className="text-[10px] text-slate-400 mt-0.5">{consistencyStats.totalWeeks > 0 ? Math.round((consistencyStats.weeksWith3 / consistencyStats.totalWeeks) * 100) : 0}% consistente</p>
        </div>
      </div>

      {/* Heatmap */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <Title className="text-slate-800 font-bold mb-1">Calendario de Actividad</Title>
            <Text className="text-slate-500 text-sm">Tu consistencia día a día a lo largo del año</Text>
          </div>
          <div className="flex items-center gap-3">
            <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(parseInt(v))} enableClear={false} className="w-24">
              {availableYears.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </Select>
            <Select value={metric} onValueChange={setMetric} enableClear={false} className="w-32">
              <SelectItem value="distance">Distancia</SelectItem>
              <SelectItem value="time">Tiempo</SelectItem>
              <SelectItem value="load">Carga</SelectItem>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto -mx-2 px-2">
          <div className="inline-block min-w-[700px]">
            {/* Month labels */}
            <div className="flex ml-8 mb-1">
              {monthPositions.map(({ month, weekIndex }) => (
                <span
                  key={month}
                  className="text-[10px] text-slate-400 font-medium absolute"
                  style={{ position: 'relative', left: `${weekIndex * 15}px` }}
                >
                  {MONTH_LABELS[month]}
                </span>
              ))}
            </div>
            <div className="flex ml-8 mb-1 relative h-4">
              {monthPositions.map(({ month, weekIndex }) => (
                <span
                  key={month}
                  className="text-[10px] text-slate-400 font-medium"
                  style={{ position: 'absolute', left: `${weekIndex * 15}px` }}
                >
                  {MONTH_LABELS[month]}
                </span>
              ))}
            </div>

            {/* Grid */}
            <div className="flex gap-[3px]">
              {/* Day labels */}
              <div className="flex flex-col gap-[3px] mr-1">
                {DAY_LABELS.map((label, i) => (
                  <div key={i} className="h-[12px] flex items-center">
                    <span className="text-[9px] text-slate-400 w-6 text-right">{label}</span>
                  </div>
                ))}
              </div>

              {/* Weeks */}
              {weeksGrid.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((day, di) => {
                    if (!day.inYear) {
                      return <div key={di} className="w-[12px] h-[12px]" />;
                    }
                    const colorClass = getColorForValue(day.metricValue, maxValue, metric);
                    const tooltipText = day.value
                      ? `${day.date}: ${day.metricValue.toFixed(1)} ${metricUnit} (${day.value.count} actividad${day.value.count > 1 ? 'es' : ''})`
                      : `${day.date}: Sin actividad`;

                    return (
                      <div
                        key={di}
                        className={`w-[12px] h-[12px] rounded-sm ${colorClass} transition-colors cursor-pointer hover:ring-2 hover:ring-slate-400 hover:ring-offset-1`}
                        title={tooltipText}
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-2 mt-4 ml-8">
              <span className="text-[10px] text-slate-400">Menos</span>
              <div className="w-[12px] h-[12px] rounded-sm bg-slate-100" />
              <div className={`w-[12px] h-[12px] rounded-sm ${metric === 'load' ? 'bg-rose-100' : 'bg-emerald-100'}`} />
              <div className={`w-[12px] h-[12px] rounded-sm ${metric === 'load' ? 'bg-rose-200' : 'bg-emerald-300'}`} />
              <div className={`w-[12px] h-[12px] rounded-sm ${metric === 'load' ? 'bg-rose-400' : 'bg-emerald-500'}`} />
              <div className={`w-[12px] h-[12px] rounded-sm ${metric === 'load' ? 'bg-rose-600' : 'bg-emerald-700'}`} />
              <span className="text-[10px] text-slate-400">Más</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
