import React, { useMemo } from 'react';
import { BarChart } from '@tremor/react';

const MonthlyChart = ({ activities }) => {
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
                    count: 0
                };
            }

            acc[monthKey].distance += activity.distance;
            acc[monthKey].count += 1;
            return acc;
        }, {});

        // 2. Convert to array and sort chronologically
        const sortedData = Object.values(grouped).sort((a, b) => a.date - b.date);

        // 3. Take last 12 months for better visualization
        return sortedData.slice(-12).map(item => ({
            name: item.monthLabel,
            distance: Math.round(item.distance / 1000), // Convert to km
            count: item.count
        }));
    }, [activities]);

    const dataFormatter = (number) => {
        return `${Intl.NumberFormat("es-ES").format(number)} km`;
    };

    if (!chartData || chartData.length === 0) return null;

    return (
        <BarChart
            className="mt-2 h-72"
            data={chartData}
            index="name"
            categories={["distance"]}
            colors={["indigo"]}
            valueFormatter={dataFormatter}
            yAxisWidth={48}
            showLegend={false}
            showAnimation={true}
        />
    );
};

export default MonthlyChart;
