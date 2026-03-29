import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarDaysIcon,
  FireIcon,
  TrophyIcon,
  CheckBadgeIcon,
  SparklesIcon,
  CalendarIcon
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

function getColorForValue(value, max, metric) {
  if (!value || value === 0) return 'bg-slate-100/60';
  const intensity = Math.min(value / max, 1);
  if (metric === 'load') {
    if (intensity < 0.2) return 'bg-rose-100';
    if (intensity < 0.4) return 'bg-rose-200';
    if (intensity < 0.6) return 'bg-rose-300';
    if (intensity < 0.8) return 'bg-rose-500';
    return 'bg-rose-700';
  }
  if (intensity < 0.2) return 'bg-emerald-100';
  if (intensity < 0.4) return 'bg-emerald-200';
  if (intensity < 0.6) return 'bg-emerald-300';
  if (intensity < 0.8) return 'bg-emerald-500';
  return 'bg-emerald-700';
}

export default function ConsistencyHeatmap({ activities }) {
  const { t } = useTranslation();
  const MONTH_LABELS = t('consistency.months', { returnObjects: true });
  const DAY_LABELS = t('consistency.days', { returnObjects: true });
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
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: t('consistency.stats.active_days'), value: consistencyStats.totalDays, unit: `${t('dashboard.in', 'en')} ${selectedYear}`, color: "text-slate-900", icon: CalendarDaysIcon },
          { label: t('consistency.stats.current_streak'), value: consistencyStats.currentStreak, unit: t('dashboard.days', 'días'), color: "text-emerald-600", icon: FireIcon },
          { label: t('consistency.stats.best_streak'), value: consistencyStats.longestStreak, unit: t('dashboard.days', 'días'), color: "text-blue-600", icon: TrophyIcon },
          { label: t('consistency.stats.consistency'), value: `${consistencyStats.weeksWith3}/${consistencyStats.totalWeeks}`, unit: t('dashboard.weeks_min', 'semanas ≥3'), color: "text-amber-600", icon: CheckBadgeIcon }
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

      {/* Heatmap */}
      <div className="bg-white rounded-3xl border border-slate-100 p-8 shadow-xl shadow-slate-200/50">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="bg-emerald-600 text-white p-1 rounded-lg">
                <SparklesIcon className="w-4 h-4" />
              </div>
              <h3 className="text-slate-900 font-black text-xl uppercase tracking-tight">{t('consistency.title')}</h3>
            </div>
            <p className="text-slate-500 text-sm font-medium leading-relaxed max-w-2xl">
              {t('consistency.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
              {availableYears.map(y => (
                <button
                  key={y}
                  onClick={() => setSelectedYear(y)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${selectedYear === y ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {y}
                </button>
              ))}
            </div>

            <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
              {[
                { id: 'distance', label: t('consistency.metrics.distance') },
                { id: 'time', label: t('consistency.metrics.time') },
                { id: 'load', label: t('consistency.metrics.load') }
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setMetric(m.id)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${metric === m.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto -mx-4 px-4 pb-4 scrollbar-hide">
          <div className="inline-block min-w-[800px] bg-slate-50/30 p-8 rounded-2xl border border-slate-100">
            {/* Month labels */}
            <div className="flex ml-10 mb-2 relative h-5">
              {monthPositions.map(({ month, weekIndex }) => (
                <span
                  key={month}
                  className="text-[10px] text-slate-400 font-black uppercase tracking-tighter"
                  style={{ position: 'absolute', left: `${weekIndex * 15}px` }}
                >
                  {MONTH_LABELS[month]}
                </span>
              ))}
            </div>

            <div className="flex gap-[4px]">
              {/* Day labels */}
              <div className="flex flex-col gap-[4px] mr-2">
                {DAY_LABELS.map((label, i) => (
                  <div key={i} className="h-[12px] flex items-center">
                    <span className="text-[9px] text-slate-400 font-black uppercase tracking-tighter w-6 text-right leading-none">{label}</span>
                  </div>
                ))}
              </div>

              {/* Weeks */}
              {weeksGrid.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[4px]">
                  {week.map((day, di) => {
                    if (!day.inYear) {
                      return <div key={di} className="w-[12px] h-[12px]" />;
                    }
                    const colorClass = getColorForValue(day.metricValue, maxValue, metric);
                    const tooltipText = day.value
                      ? `${day.date}: ${day.metricValue.toFixed(1)} ${metricUnit} (${day.value.count} ${t('dashboard.activities').toLowerCase()})`
                      : `${day.date}: ${t('dashboard.no_activity', 'Sin actividad')}`;

                    return (
                      <motion.div
                        key={di}
                        whileHover={{ scale: 1.3, zIndex: 10 }}
                        className={`w-[12px] h-[12px] rounded-[2px] ${colorClass} transition-colors cursor-pointer shadow-sm`}
                        title={tooltipText}
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 mt-8 ml-10">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('dashboard.less', 'Menos')}</span>
              <div className="flex gap-1.5 p-1 bg-white rounded-lg border border-slate-100 shadow-sm">
                <div className="w-[12px] h-[12px] rounded-sm bg-slate-100/60" />
                <div className={`w-[12px] h-[12px] rounded-sm ${metric === 'load' ? 'bg-rose-100' : 'bg-emerald-100'}`} />
                <div className={`w-[12px] h-[12px] rounded-sm ${metric === 'load' ? 'bg-rose-200' : 'bg-emerald-200'}`} />
                <div className={`w-[12px] h-[12px] rounded-sm ${metric === 'load' ? 'bg-rose-300' : 'bg-emerald-300'}`} />
                <div className={`w-[12px] h-[12px] rounded-sm ${metric === 'load' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                <div className={`w-[12px] h-[12px] rounded-sm ${metric === 'load' ? 'bg-rose-700' : 'bg-emerald-700'}`} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('dashboard.more', 'Más')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
