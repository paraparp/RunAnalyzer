import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const GRID_LINES = 4;

const MonthlyChart = ({ activities, selectedMetric = 'distance', groupBy = 'month' }) => {
  const { i18n } = useTranslation();
  const [hoveredIndex, setHoveredIndex] = useState(null);

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
          shortName: String(d.year),
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
      .slice(-13)
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
    distance:  { bar: '#2563eb', hover: '#1d4ed8', bg: '#eff6ff', label: 'km' },
    time:      { bar: '#0891b2', hover: '#0e7490', bg: '#f0fdff', label: 'h'  },
    elevation: { bar: '#059669', hover: '#047857', bg: '#f0fdf4', label: 'm'  },
    load:      { bar: '#e11d48', hover: '#be123c', bg: '#fff1f2', label: ''   },
  };

  const cfg    = METRIC_COLORS[selectedMetric] || METRIC_COLORS.distance;
  const maxVal = Math.max(...chartData.map(d => d[selectedMetric]), 1);

  if (!chartData.length) return null;

  const formatVal = (val) =>
    selectedMetric === 'time'
      ? `${val}h`
      : selectedMetric === 'load'
        ? String(val)
        : `${val} ${cfg.label}`;

  // Grid line values
  const gridVals = Array.from({ length: GRID_LINES }, (_, i) =>
    Math.round((maxVal / GRID_LINES) * (GRID_LINES - i))
  );

  return (
    <div className="flex flex-col h-full min-h-[12rem] select-none">
      {/* Chart area */}
      <div className="flex flex-1 min-h-0 gap-1 relative pt-2">

        {/* Grid lines (absolute, behind bars) */}
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-6" aria-hidden>
          {gridVals.map((gv, gi) => (
            <div key={gi} className="flex items-center gap-2 w-full">
              <span className="text-[9px] text-slate-300 font-medium w-7 text-right shrink-0 leading-none">
                {gv}
              </span>
              <div className="flex-1 border-t border-dashed border-slate-100" />
            </div>
          ))}
          {/* Zero line */}
          <div className="flex items-center gap-2 w-full">
            <span className="text-[9px] text-slate-300 font-medium w-7 text-right shrink-0 leading-none">0</span>
            <div className="flex-1 border-t border-slate-200" />
          </div>
        </div>

        {/* Bars */}
        <div className="flex items-end gap-[4px] flex-1 pl-9 pb-6">
          {chartData.map((item, i) => {
            const pct     = Math.max((item[selectedMetric] / maxVal) * 100, 1.5);
            const isHover = hoveredIndex === i;
            const val     = item[selectedMetric];

            return (
              <div
                key={i}
                className="flex-1 flex flex-col items-center justify-end h-full relative"
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Tooltip above bar */}
                {isHover && (
                  <div className="absolute bottom-[calc(100%-1.25rem)] mb-1 z-20 pointer-events-none"
                    style={{ bottom: `calc(${pct}% + 1.5rem)` }}>
                    <div className="bg-slate-800 text-white text-[10px] font-semibold px-2 py-1 rounded-lg shadow-lg whitespace-nowrap">
                      {item.name}
                      <span className="ml-1 text-slate-300">{formatVal(val)}</span>
                    </div>
                    {/* Arrow */}
                    <div className="w-2 h-1 mx-auto overflow-hidden">
                      <div className="w-2 h-2 bg-slate-800 rotate-45 -mt-1 mx-auto" />
                    </div>
                  </div>
                )}

                {/* Bar track + bar */}
                <div className="w-full flex-1 flex items-end relative rounded-t-sm overflow-hidden">
                  {/* Track */}
                  <div
                    className="absolute inset-0 transition-colors duration-200"
                    style={{ background: isHover ? cfg.bg : cfg.bg, opacity: isHover ? 1 : 0.6 }}
                  />
                  {/* Bar */}
                  <div
                    className="w-full relative transition-all duration-300"
                    style={{
                      height: `${pct}%`,
                      background: isHover ? cfg.hover : cfg.bar,
                      borderRadius: '3px 3px 0 0',
                    }}
                  />
                </div>

                {/* Month label */}
                <span
                  className="text-[9px] font-semibold leading-none mt-1.5 absolute -bottom-5 transition-colors"
                  style={{ color: isHover ? cfg.bar : '#94a3b8' }}
                >
                  {item.shortName}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MonthlyChart;
