import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const MonthlyChart = ({ activities, selectedMetric = 'distance', groupBy = 'month' }) => {
  const { i18n } = useTranslation();

  const chartData = useMemo(() => {
    if (!activities || activities.length === 0) return [];

    if (groupBy === 'year') {
      const grouped = activities.reduce((acc, activity) => {
        const year = String(new Date(activity.start_date).getFullYear());
        if (!acc[year]) acc[year] = { year, distance: 0, time: 0, elevation: 0, load: 0 };
        acc[year].distance  += activity.distance || 0;
        acc[year].time      += activity.elapsed_time || activity.moving_time || 0;
        acc[year].elevation += activity.total_elevation_gain || 0;
        acc[year].load      += activity.suffer_score || 0;
        return acc;
      }, {});

      return Object.values(grouped)
        .sort((a, b) => a.year - b.year)
        .map(d => ({
          name: d.year,
          distance:  Math.round(d.distance / 1000),
          time:      Number((d.time / 3600).toFixed(1)),
          elevation: Math.round(d.elevation),
          load:      Math.round(d.load),
        }));
    }

    // Group by month
    const grouped = activities.reduce((acc, activity) => {
      const date = new Date(activity.start_date);
      const key  = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!acc[key]) acc[key] = { date, distance: 0, time: 0, elevation: 0, load: 0 };
      acc[key].distance  += activity.distance || 0;
      acc[key].time      += activity.elapsed_time || activity.moving_time || 0;
      acc[key].elevation += activity.total_elevation_gain || 0;
      acc[key].load      += activity.suffer_score || 0;
      return acc;
    }, {});

    const locale = i18n.language.startsWith('es') ? 'es-ES' : 'en-US';

    return Object.values(grouped)
      .sort((a, b) => a.date - b.date)
      .slice(-13)                          // last 13 months = ~1 year of context
      .map(d => ({
        name:      d.date.toLocaleDateString(locale, { month: 'short', year: '2-digit' }),
        shortName: d.date.toLocaleDateString(locale, { month: 'short' }).toUpperCase().slice(0, 3),
        distance:  Math.round(d.distance / 1000),
        time:      Number((d.time / 3600).toFixed(1)),
        elevation: Math.round(d.elevation),
        load:      Math.round(d.load),
      }));
  }, [activities, groupBy, i18n.language]);

  const METRIC_COLORS = {
    distance:  { bar: '#2563eb', bg: '#dbeafe', label: 'km' },
    time:      { bar: '#0891b2', bg: '#cffafe', label: 'h'  },
    elevation: { bar: '#059669', bg: '#d1fae5', label: 'm'  },
    load:      { bar: '#e11d48', bg: '#ffe4e6', label: ''   },
  };

  const cfg     = METRIC_COLORS[selectedMetric] || METRIC_COLORS.distance;
  const maxVal  = Math.max(...chartData.map(d => d[selectedMetric]), 1);

  if (!chartData.length) return null;

  return (
    <div className="flex items-end gap-[3px] h-48 pt-3">
      {chartData.map((item, i) => {
        const pct = Math.max((item[selectedMetric] / maxVal) * 100, 3);
        const val = item[selectedMetric];
        const fmt = selectedMetric === 'time'
          ? `${val}h`
          : selectedMetric === 'load'
            ? String(val)
            : `${val} ${cfg.label}`;

        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group h-full">
            {/* Tooltip */}
            <div className="opacity-0 group-hover:opacity-100 absolute -translate-y-full -mt-1 bg-slate-800 text-white text-[10px] font-semibold px-2 py-1 rounded-lg shadow-lg whitespace-nowrap pointer-events-none transition-opacity z-10">
              {item.name}: {fmt}
            </div>
            {/* Bar track */}
            <div className="w-full flex-1 flex items-end relative">
              <div className="w-full rounded-[3px]" style={{ background: cfg.bg, height: '100%', position: 'absolute', bottom: 0 }} />
              <div
                className="w-full rounded-[3px] transition-all duration-300 cursor-default relative"
                style={{ height: `${pct}%`, background: cfg.bar }}
              />
            </div>
            {/* Label */}
            <span className="text-[9px] font-semibold text-slate-400 leading-none">{item.shortName}</span>
          </div>
        );
      })}
    </div>
  );
};

export default MonthlyChart;
