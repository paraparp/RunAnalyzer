import React, { useMemo } from 'react';

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
        <div className="pbs-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {Object.values(bests).map((record) => (
                <a
                    key={record.name}
                    href={`https://www.strava.com/activities/${record.activity.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pb-card"
                    style={{ flex: '1 1 150px', maxWidth: '220px' }}
                >
                    <div className="pb-card-title">
                        {record.name}
                    </div>
                    <div className="pb-card-time">
                        {formatTime(record.activity.moving_time)}
                    </div>
                    <div className="pb-card-pace">
                        {calculatePace(record.activity.average_speed)} <span>/km</span>
                    </div>
                    <div className="pb-card-date">
                        {new Date(record.activity.start_date).toLocaleDateString()}
                    </div>
                    <div className="pb-card-activity">
                        {record.activity.name}
                    </div>
                </a>
            ))}
        </div>
    );
};

export default PersonalBests;
