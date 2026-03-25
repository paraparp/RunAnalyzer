import React, { useMemo } from 'react';
import { BarChart } from '@tremor/react';

const MonthlyChart = ({ activities, selectedMetric = 'distance', groupBy = 'month' }) => {
    const chartData = useMemo(() => {
        if (!activities || activities.length === 0) return [];

        if (groupBy === 'year') {
            // Group by Year
            const grouped = activities.reduce((acc, activity) => {
                const date = new Date(activity.start_date);
                const yearKey = `${date.getFullYear()}`;

                if (!acc[yearKey]) {
                    acc[yearKey] = {
                        year: date.getFullYear(),
                        distance: 0,
                        time: 0,
                        elevation: 0,
                        load: 0,
                        count: 0
                    };
                }

                acc[yearKey].distance += activity.distance || 0;
                acc[yearKey].time += activity.moving_time || 0;
                acc[yearKey].elevation += activity.total_elevation_gain || 0;
                acc[yearKey].load += activity.suffer_score || 0;
                acc[yearKey].count += 1;
                return acc;
            }, {});

            return Object.values(grouped)
                .sort((a, b) => a.year - b.year)
                .map(item => ({
                    name: String(item.year),
                    distance: Math.round(item.distance / 1000),
                    time: Number((item.time / 3600).toFixed(1)),
                    elevation: Math.round(item.elevation),
                    load: Math.round(item.load),
                    count: item.count
                }));
        }

        // Group by Month (YYYY-MM)
        const grouped = activities.reduce((acc, activity) => {
            const date = new Date(activity.start_date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            if (!acc[monthKey]) {
                acc[monthKey] = {
                    date: date,
                    monthLabel: date.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }),
                    distance: 0,
                    time: 0,
                    elevation: 0,
                    load: 0,
                    count: 0
                };
            }

            acc[monthKey].distance += activity.distance || 0;
            acc[monthKey].time += activity.moving_time || 0;
            acc[monthKey].elevation += activity.total_elevation_gain || 0;
            acc[monthKey].load += activity.suffer_score || 0;
            acc[monthKey].count += 1;
            return acc;
        }, {});

        // Convert to array and sort chronologically
        const sortedData = Object.values(grouped).sort((a, b) => a.date - b.date);

        // Take last 12 months
        return sortedData.slice(-12).map(item => ({
            name: item.monthLabel,
            distance: Math.round(item.distance / 1000),
            time: Number((item.time / 3600).toFixed(1)),
            elevation: Math.round(item.elevation),
            load: Math.round(item.load),
            count: item.count
        }));
    }, [activities, groupBy]);

    const metricsConfig = {
        distance: { label: "Distancia", color: "blue", unit: "km" },
        time: { label: "Tiempo", color: "cyan", unit: "h" },
        elevation: { label: "Desnivel", color: "emerald", unit: "m" },
        load: { label: "Carga", color: "rose", unit: "" }
    };

    const currentMetric = metricsConfig[selectedMetric] || metricsConfig.distance;

    const dataFormatter = (number) => {
        return `${Intl.NumberFormat("es-ES").format(number)} ${currentMetric.unit}`;
    };

    if (!chartData || chartData.length === 0) return null;

    // Find the maximum value to calculate heights relative to it
    const maxValue = Math.max(...chartData.map(d => d[selectedMetric])) || 1;

    return (
        <div className="h-64 flex items-end justify-between space-x-2 px-2 mt-4">
            {chartData.map((item, index) => {
                const heightPercentage = Math.max((item[selectedMetric] / maxValue) * 100, 5); // Add 5% minimum height for visibility
                const formattedName = item.name.split(' ')[0].substring(0, 3).toUpperCase(); // Shorten month labels
                
                return (
                    <div key={index} className="w-full bg-blue-100/40 rounded-t-lg relative group h-full flex items-end">
                        <div
                            className="absolute inset-x-0 bottom-0 rounded-t-lg transition-all"
                            style={{ height: `${heightPercentage}%`, backgroundColor: '#2563eb' }}
                        ></div>
                        {/* Custom hover tooltip */}
                        <div className="opacity-0 group-hover:opacity-100 absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap transition-opacity z-10">
                            {dataFormatter(item[selectedMetric])}
                        </div>
                        <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-bold text-slate-400">
                            {formattedName}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

export default MonthlyChart;
