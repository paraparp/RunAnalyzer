import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

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
        // If you want all history, remove .slice(-12)
        return sortedData.slice(-12).map(item => ({
            name: item.monthLabel,
            distance: Math.round(item.distance / 1000), // Convert to km
            count: item.count
        }));
    }, [activities]);

    if (chartData.length === 0) return null;

    return (
        <div className="chart-container" style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
                <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                    <XAxis
                        dataKey="name"
                        stroke="#94a3b8"
                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        stroke="#94a3b8"
                        tick={{ fill: '#94a3b8', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        unit=" km"
                    />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                        itemStyle={{ color: '#f8fafc' }}
                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    />
                    <Bar dataKey="distance" name="Distancia" radius={[4, 4, 0, 0]}>
                        {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.distance > 0 ? '#3b82f6' : '#1e293b'} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

export default MonthlyChart;
