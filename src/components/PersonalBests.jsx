import React, { useMemo } from 'react';
import { Card, Grid, Text, Metric, Badge, Flex } from "@tremor/react";

const PersonalBests = ({ activities }) => {
    const bests = useMemo(() => {
        if (!activities || activities.length === 0) return null;

        const ranges = [
            { id: '5k', name: '5K', min: 4900, max: 5200 },
            { id: '10k', name: '10K', min: 9900, max: 10500 },
            { id: '15k', name: '15K', min: 14900, max: 15200 },
            { id: 'hm', name: 'Media Maratón', min: 21000, max: 21500 },
            { id: 'fm', name: 'Maratón', min: 42000, max: 43000 },
        ];

        const records = {};

        ranges.forEach(range => {
            // Find runs within distance range
            const matches = activities.filter(a => a.distance >= range.min && a.distance <= range.max);
            if (matches.length === 0) return;

            // Sort by moving time (ascending)
            matches.sort((a, b) => a.moving_time - b.moving_time);

            records[range.id] = {
                name: range.name,
                activity: matches[0]
            };
        });

        return records;
    }, [activities]);

    if (!bests || Object.keys(bests).length === 0) return null;

    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const calculatePace = (speed) => {
        if (!speed || speed === 0) return '0:00';
        const pace = 16.6667 / speed; // min/km
        const minutes = Math.floor(pace);
        const seconds = Math.floor((pace - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    return (
        <Grid numItems={2} numItemsSm={3} numItemsLg={5} className="gap-3">
            {Object.values(bests).map((record) => (
                <Card
                    key={record.name}
                    decoration="top"
                    decorationColor="amber"
                    className="cursor-pointer hover:shadow-lg transition-all transform hover:-translate-y-1 p-4 ring-1 ring-slate-200 shadow-sm"
                    onClick={() => window.open(`https://www.strava.com/activities/${record.activity.id}`, '_blank')}
                >
                    <Flex justifyContent="between" alignItems="start">
                        <Text className="truncate font-medium text-slate-500">{record.name}</Text>
                        <Badge color="cyan" size="xs">{new Date(record.activity.start_date).getFullYear()}</Badge>
                    </Flex>
                    <Metric className="mt-2 text-2xl text-slate-900">{formatTime(record.activity.moving_time)}</Metric>
                    <Flex className="mt-2 pt-2 border-t border-slate-100" justifyContent="between">
                        <Text className="text-xs text-slate-400">Ritmo</Text>
                        <Text className="font-mono text-slate-700 font-medium text-sm">
                            {calculatePace(record.activity.average_speed)} /km
                        </Text>
                    </Flex>
                </Card>
            ))}
        </Grid>
    );
};

export default PersonalBests;
