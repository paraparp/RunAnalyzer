import React, { useMemo } from 'react';
import { BarChart } from '@tremor/react';

const MonthlyChart = ({ activities, selectedMetric = 'distance' }) => {
    const chartData = useMemo(() => {
        if (!activities || activities.length === 0) return [];

        // 1. Group by Month (YYYY-MM)
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
                    count: 0
                };
            }

            acc[monthKey].distance += activity.distance;
            acc[monthKey].time += activity.moving_time;
            acc[monthKey].elevation += activity.total_elevation_gain;
            acc[monthKey].count += 1;
            return acc;
        }, {});

        // 2. Convert to array and sort chronologically
        const sortedData = Object.values(grouped).sort((a, b) => a.date - b.date);

        // 3. Take last 12 months
        return sortedData.slice(-12).map(item => ({
            name: item.monthLabel,
            distance: Math.round(item.distance / 1000),
            time: Number((item.time / 3600).toFixed(1)), // Hours with 1 decimal
            elevation: Math.round(item.elevation),
            count: item.count
        }));
    }, [activities]);

    const metricsConfig = {
        distance: { label: "Distancia", color: "indigo", unit: "km" },
        time: { label: "Tiempo", color: "cyan", unit: "h" },
        elevation: { label: "Desnivel", color: "emerald", unit: "m" }
    };

    const currentMetric = metricsConfig[selectedMetric] || metricsConfig.distance;

    const dataFormatter = (number) => {
        return `${Intl.NumberFormat("es-ES").format(number)} ${currentMetric.unit}`;
    };

    if (!chartData || chartData.length === 0) return null;

    return (
        <BarChart
            className="mt-4 h-72"
            data={chartData}
            index="name"
            categories={[selectedMetric]}
            colors={[currentMetric.color]}
            valueFormatter={dataFormatter}
            yAxisWidth={48}
            showLegend={false}
            showAnimation={true}
            autoMinValue={true}
        />
    );
};

export default MonthlyChart;
