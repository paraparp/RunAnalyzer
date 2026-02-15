import { useMemo } from 'react';
import { TrophyIcon } from "@heroicons/react/24/solid";

const PersonalBests = ({ activities }) => {
    const bests = useMemo(() => {
        if (!activities || activities.length === 0) return null;

        const ranges = [
            { id: '5k', name: '5K', min: 4900, max: 5200 },
            { id: '10k', name: '10K', min: 9900, max: 10500 },
            { id: '15k', name: '15K', min: 14900, max: 15200 },
            { id: 'hm', name: 'Media Maraton', min: 21000, max: 21500 },
            { id: 'fm', name: 'Maraton', min: 42000, max: 43000 },
        ];

        const records = {};

        ranges.forEach(range => {
            const matches = activities.filter(a => a.distance >= range.min && a.distance <= range.max);
            if (matches.length === 0) return;
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
        const pace = 16.6667 / speed;
        const minutes = Math.floor(pace);
        const seconds = Math.floor((pace - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Object.values(bests).map((record) => (
                <button
                    key={record.name}
                    onClick={() => window.open(`https://www.strava.com/activities/${record.activity.id}`, '_blank')}
                    className="text-left bg-gradient-to-br from-amber-50/80 to-orange-50/40 rounded-xl border border-amber-200/60 p-4 hover:shadow-md hover:border-amber-300/80 hover:-translate-y-0.5 transition-all duration-200 group"
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600/80">{record.name}</span>
                        <TrophyIcon className="w-4 h-4 text-amber-400 group-hover:text-amber-500 transition-colors" />
                    </div>
                    <p className="text-xl font-bold text-slate-900 tabular-nums leading-tight mb-2">
                        {formatTime(record.activity.moving_time)}
                    </p>
                    <div className="flex items-center justify-between pt-2 border-t border-amber-200/40">
                        <span className="text-[11px] text-slate-400 font-medium">
                            {new Date(record.activity.start_date).getFullYear()}
                        </span>
                        <span className="text-xs font-semibold text-slate-600 tabular-nums">
                            {calculatePace(record.activity.average_speed)} /km
                        </span>
                    </div>
                </button>
            ))}
        </div>
    );
};

export default PersonalBests;
