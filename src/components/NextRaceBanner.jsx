import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlagIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { getNextTargetRace, daysUntil, formatMinutes, TARGET_RACES_EVENT } from '../lib/targetRaces';

// Banner compacto con la próxima carrera objetivo y su cuenta atrás.
// Sólo se renderiza si hay alguna carrera futura. `onManage` navega a la sección.
const NextRaceBanner = ({ onManage }) => {
    const { t } = useTranslation();
    const [race, setRace] = useState(getNextTargetRace);

    useEffect(() => {
        const reload = () => setRace(getNextTargetRace());
        window.addEventListener(TARGET_RACES_EVENT, reload);
        return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
    }, []);

    if (!race) return null;
    const days = daysUntil(race.date);

    const Wrapper = onManage ? 'button' : 'div';

    return (
        <Wrapper
            onClick={onManage}
            className={`w-full text-left group bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-5 shadow-sm transition-all flex items-center gap-5 ${onManage ? 'hover:shadow-md cursor-pointer' : ''}`}
        >
            <div className="p-3 bg-white/15 rounded-2xl shrink-0">
                <FlagIcon className="w-7 h-7 text-white" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black text-blue-100 uppercase tracking-widest mb-0.5">{t('targets.next_race')}</p>
                <h3 className="text-lg font-black text-white tracking-tight truncate">{race.name}</h3>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs font-bold text-blue-100">
                    <span>{t(`planner.distances.${race.distance}`)}</span>
                    {race.date && <span>· {new Date(race.date + 'T00:00:00').toLocaleDateString()}</span>}
                    {race.goalTimeMin != null && <span>· {t('targets.goal_time')}: {formatMinutes(race.goalTimeMin)}</span>}
                </div>
            </div>
            <div className="text-right shrink-0">
                {days === 0 ? (
                    <p className="text-2xl font-black text-white leading-none">{t('targets.today')}</p>
                ) : (
                    <>
                        <p className="text-3xl font-black text-white leading-none tabular-nums">{days}</p>
                        <p className="text-[10px] font-black text-blue-100 uppercase tracking-widest mt-1">{t('targets.days_unit')}</p>
                    </>
                )}
            </div>
            {onManage && <ArrowRightIcon className="w-5 h-5 text-blue-200 shrink-0 group-hover:translate-x-0.5 transition-transform" />}
        </Wrapper>
    );
};

export default NextRaceBanner;
