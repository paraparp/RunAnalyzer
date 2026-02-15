import { Badge } from "@tremor/react";

const ActivitySplits = ({ splits }) => {
    if (!splits || splits.length === 0) {
        return (
            <p className="py-4 text-center text-sm italic text-slate-400">
                No hay datos parciales disponibles para esta actividad.
            </p>
        );
    }

    const calculatePace = (speed) => {
        if (!speed || speed === 0) return '0:00';
        const pace = 16.6667 / speed;
        const minutes = Math.floor(pace);
        const seconds = Math.floor((pace - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    return (
        <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Parciales por Km</p>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b border-slate-200/60">
                            <th className="text-left py-2 px-2 font-semibold text-slate-400 uppercase tracking-wider text-[10px]">Km</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-400 uppercase tracking-wider text-[10px]">Ritmo</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-400 uppercase tracking-wider text-[10px]">Tiempo</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-400 uppercase tracking-wider text-[10px]">Elev.</th>
                            <th className="text-right py-2 px-2 font-semibold text-slate-400 uppercase tracking-wider text-[10px]">FC</th>
                        </tr>
                    </thead>
                    <tbody>
                        {splits.map((split, index) => (
                            <tr key={index} className="border-b border-slate-100/60 last:border-0 hover:bg-white/60 transition-colors">
                                <td className="py-1.5 px-2 font-bold text-slate-600 tabular-nums">
                                    {split.split}
                                </td>
                                <td className="py-1.5 px-2 text-right tabular-nums">
                                    <Badge size="xs" color="indigo">
                                        {calculatePace(split.average_speed)}
                                    </Badge>
                                </td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">
                                    {Math.floor(split.moving_time / 60)}:{(split.moving_time % 60).toString().padStart(2, '0')}
                                </td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">
                                    <span className={split.elevation_difference > 0 ? 'text-rose-500' : split.elevation_difference < 0 ? 'text-emerald-500' : ''}>
                                        {split.elevation_difference > 0 ? '+' : ''}{Math.round(split.elevation_difference)}m
                                    </span>
                                </td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">
                                    {split.average_heartrate ? Math.round(split.average_heartrate) : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ActivitySplits;
