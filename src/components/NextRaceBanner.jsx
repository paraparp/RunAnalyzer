import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlagIcon, ArrowRightIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { getPrimaryTargetRace, daysUntil, formatMinutes, TARGET_RACES_EVENT } from '../lib/targetRaces';

// Banner compacto con la próxima carrera objetivo y su cuenta atrás.
// Sólo se renderiza si hay alguna carrera futura. `onManage` navega a la sección
// y `onOpenPlan` abre directamente el plan a pantalla completa (si lo hay).
const NextRaceBanner = ({ onManage, onOpenPlan }) => {
    const { t } = useTranslation();
    const [race, setRace] = useState(getPrimaryTargetRace);

    useEffect(() => {
        const reload = () => setRace(getPrimaryTargetRace());
        window.addEventListener(TARGET_RACES_EVENT, reload);
        return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
    }, []);

    if (!race) return null;
    const days = daysUntil(race.date);
    const hasPlan = !!race.plan?.trim() && !!onOpenPlan;

    return (
        // El acceso al plan es un botón propio, así que la zona "gestionar" no
        // puede ser el contenedor (un botón dentro de otro no es válido): se
        // resuelve con una capa que cubre la tarjeta por debajo del contenido.
        <div className="relative w-full group bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-5 shadow-sm transition-all flex items-center gap-5">
            {onManage && (
                <button
                    type="button"
                    onClick={onManage}
                    aria-label={t('targets.next_race')}
                    className="absolute inset-0 rounded-2xl cursor-pointer hover:shadow-md transition-all"
                />
            )}
            <div className="relative p-3 bg-white/15 rounded-2xl shrink-0 pointer-events-none">
                <FlagIcon className="w-7 h-7 text-white" />
            </div>
            <div className="relative min-w-0 flex-1 pointer-events-none">
                <p className="text-[10px] font-black text-blue-100 uppercase tracking-widest mb-0.5">{t('targets.next_race')}</p>
                <h3 className="text-lg font-black text-white tracking-tight truncate">{race.name}</h3>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs font-bold text-blue-100">
                    <span>{t(`planner.distances.${race.distance}`)}</span>
                    {race.date && (
                        <span>
                            · {new Date(race.date + 'T00:00:00').toLocaleDateString()}
                            {race.startTime ? ` · ${race.startTime}` : ''}
                        </span>
                    )}
                    {race.goalTimeMin != null && <span>· {t('targets.goal_time')}: {formatMinutes(race.goalTimeMin)}</span>}
                </div>
            </div>
            {hasPlan && (
                <button
                    type="button"
                    onClick={() => onOpenPlan(race.id)}
                    title={t('targets.open_plan')}
                    className="relative shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                    <DocumentTextIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('targets.open_plan')}</span>
                </button>
            )}
            <div className="relative text-right shrink-0 pointer-events-none">
                {days === 0 ? (
                    <p className="text-2xl font-black text-white leading-none">{t('targets.today')}</p>
                ) : (
                    <>
                        <p className="text-3xl font-black text-white leading-none tabular-nums">{days}</p>
                        <p className="text-[10px] font-black text-blue-100 uppercase tracking-widest mt-1">{t('targets.days_unit')}</p>
                    </>
                )}
            </div>
            {onManage && <ArrowRightIcon className="relative w-5 h-5 text-blue-200 shrink-0 group-hover:translate-x-0.5 transition-transform pointer-events-none" />}
        </div>
    );
};

export default NextRaceBanner;
