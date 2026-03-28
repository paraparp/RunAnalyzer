import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrophyIcon } from "@heroicons/react/24/solid";

const PersonalBests = ({ activities }) => {
    const { t } = useTranslation();
    const bests = useMemo(() => {
        if (!activities || activities.length === 0) return null;

        const ranges = [
            { id: '5k', name: t('dashboard.records.5k'), min: 4900, max: 5200 },
            { id: '10k', name: t('dashboard.records.10k'), min: 9900, max: 10500 },
            { id: 'hm', name: t('dashboard.records.hm'), min: 21000, max: 21500 },
            { id: 'fm', name: t('dashboard.records.fm'), min: 42000, max: 43000 },
        ];

        const records = {};

        ranges.forEach(range => {
            const matches = activities.filter(a => a.distance >= range.min && a.distance <= range.max);
            if (matches.length === 0) return;
            matches.sort((a, b) => a.moving_time - b.moving_time);
            records[range.id] = {
                id: range.id,
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
        <div className="space-y-6">
            {Object.values(bests).map((record) => (
                <div key={record.name} className={`relative pl-4 border-l-2 ${record.id === 'hm' || record.id === 'fm' ? 'border-blue-600' : 'border-blue-200'}`}>
                    <div className="flex justify-between items-start">
                        <div>
                            <div 
                                className="uppercase text-[10px] tracking-widest font-black text-slate-400 hover:text-blue-600 cursor-pointer transition-colors"
                                onClick={() => window.open(`https://www.strava.com/activities/${record.activity.id}`, '_blank')}
                                title="View Activity on Strava"
                            >
                                {record.name}
                            </div>
                            <div className="text-2xl font-black text-slate-900 leading-tight">
                                {formatTime(record.activity.moving_time)}
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-xs font-bold text-slate-900">
                                {new Date(record.activity.start_date).getFullYear()}
                            </div>
                            <div className="text-[10px] font-medium text-slate-400">
                                {calculatePace(record.activity.average_speed)}/km
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default PersonalBests;
