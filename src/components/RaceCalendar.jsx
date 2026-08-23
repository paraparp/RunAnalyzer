import React, { useMemo } from 'react';
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid';
import { daysUntil } from '../lib/targetRaces';

// ============================================================================
// RaceCalendar — TODAS las carreras objetivo sobre una línea de tiempo anual.
//
// Frente a la lista, lo que aporta es la escala: dónde se agolpan las carreras,
// cuánto hueco queda entre una y otra y cuánto falta para la principal. Por eso
// no es un calendario mensual (que solo enseña 30 días y obliga a navegar), sino
// una barra por año con los meses marcados y una chincheta por carrera.
//
// Los nombres de mes salen del locale del navegador: siguen el idioma del
// usuario sin pasar por el i18n.
// ============================================================================

const parseDate = (s) => {
    if (!s) return null;
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** Posición del día dentro de su año, en % (0 = 1 de enero, 100 = 31 de dic). */
function yearFraction(date) {
    const year = date.getFullYear();
    const start = new Date(year, 0, 1);
    const length = new Date(year + 1, 0, 1) - start;
    return ((date - start) / length) * 100;
}

function monthInitials(locale) {
    return Array.from({ length: 12 }, (_, m) =>
        new Date(2024, m, 1).toLocaleDateString(locale, { month: 'narrow' }));
}

const RaceCalendar = ({ races, primaryId, selectedId, onSelect, t }) => {
    const locale = typeof navigator !== 'undefined' ? navigator.language : 'es';
    const months = useMemo(() => monthInitials(locale), [locale]);
    const today = useMemo(() => new Date(), []);

    // Un carril por año: los años con carreras más el actual, para que siempre
    // se vea dónde estamos aunque todas las carreras sean futuras.
    const { years, undated } = useMemo(() => {
        const dated = [];
        const sinFecha = [];
        for (const r of races) {
            const d = parseDate(r.date);
            if (d) dated.push({ ...r, _d: d });
            else sinFecha.push(r);
        }
        const set = new Set(dated.map((r) => r._d.getFullYear()));
        set.add(today.getFullYear());
        const rows = [...set].sort((a, b) => a - b).map((year) => ({
            year,
            races: dated
                .filter((r) => r._d.getFullYear() === year)
                .sort((a, b) => a._d - b._d),
        }));
        return { years: rows, undated: sinFecha };
    }, [races, today]);

    const toneOf = (race) => {
        if (race.id === primaryId) return { dot: 'bg-amber-400 ring-amber-100', text: 'text-amber-700' };
        const left = daysUntil(race.date);
        if (left != null && left < 0) return { dot: 'bg-slate-300 ring-slate-100', text: 'text-slate-400' };
        return { dot: 'bg-blue-500 ring-blue-100', text: 'text-blue-700' };
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sm:p-6 space-y-5">
            {years.map(({ year, races: yearRaces }) => {
                const isCurrentYear = year === today.getFullYear();
                return (
                    <div key={year}>
                        <div className="flex items-baseline gap-3 mb-1.5">
                            <span className="text-xs font-black text-slate-900 tabular-nums">{year}</span>
                            {yearRaces.length > 0 && (
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                                    {yearRaces.length}
                                </span>
                            )}
                        </div>

                        {/* Barra del año: 12 meses + chinchetas por carrera */}
                        <div className="relative h-9 rounded-lg bg-slate-50 ring-1 ring-slate-100">
                            <div className="absolute inset-0 grid grid-cols-12">
                                {months.map((m, i) => (
                                    <div key={i} className={`flex items-end justify-center pb-0.5 ${i ? 'border-l border-slate-200/70' : ''}`}>
                                        <span className="text-[8px] font-black uppercase text-slate-300">{m}</span>
                                    </div>
                                ))}
                            </div>

                            {isCurrentYear && (
                                <div
                                    className="absolute top-0 bottom-0 w-px bg-emerald-400"
                                    style={{ left: `${yearFraction(today)}%` }}
                                    title={t('targets.today')}
                                />
                            )}

                            {yearRaces.map((r) => {
                                const tone = toneOf(r);
                                const isSelected = r.id === selectedId;
                                return (
                                    <button
                                        key={r.id}
                                        onClick={() => onSelect(r.id)}
                                        title={`${r.name} · ${r._d.toLocaleDateString(locale)}`}
                                        className="absolute top-1.5 -translate-x-1/2 p-1 group"
                                        style={{ left: `${yearFraction(r._d)}%` }}
                                    >
                                        <span className={`block w-3 h-3 rounded-full ring-2 transition-transform group-hover:scale-125 ${tone.dot} ${isSelected ? 'scale-125 ring-4' : ''}`} />
                                    </button>
                                );
                            })}
                        </div>

                        {/* Todas las carreras del año, legibles y clicables */}
                        {yearRaces.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {yearRaces.map((r) => {
                                    const tone = toneOf(r);
                                    const left = daysUntil(r.date);
                                    return (
                                        <button
                                            key={r.id}
                                            onClick={() => onSelect(r.id)}
                                            className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full ring-1 transition-colors ${r.id === selectedId ? 'bg-slate-100 ring-slate-300' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}
                                        >
                                            <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
                                            {r.id === primaryId && <StarSolidIcon className="w-3 h-3 text-amber-500" />}
                                            <span className="text-[10px] font-black tabular-nums text-slate-400">
                                                {r._d.toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
                                            </span>
                                            <span className={`text-xs font-bold truncate max-w-[11rem] ${tone.text}`}>{r.name}</span>
                                            {left != null && left >= 0 && (
                                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">
                                                    {left === 0 ? t('targets.today') : `${left}d`}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}

            {undated.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-100">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-300 mr-1">{t('targets.no_date')}</span>
                    {undated.map((r) => (
                        <button
                            key={r.id}
                            onClick={() => onSelect(r.id)}
                            className={`px-2.5 py-1 rounded-full ring-1 ring-slate-200 text-xs font-bold text-slate-500 transition-colors ${r.id === selectedId ? 'bg-slate-100' : 'bg-white hover:bg-slate-50'}`}
                        >
                            {r.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default RaceCalendar;
