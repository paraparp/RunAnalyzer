import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectItem } from "@tremor/react";
import { FlagIcon, PencilSquareIcon, TrashIcon, CalendarDaysIcon, ClockIcon, MapPinIcon } from "@heroicons/react/24/outline";
import {
    getTargetRaces, saveTargetRace, deleteTargetRace,
    parseTimeToMinutes, formatMinutes, daysUntil, TARGET_RACES_EVENT,
} from '../lib/targetRaces';

const EMPTY_FORM = { name: '', date: '', distance: '21k', time: '' };

const TargetRaces = () => {
    const { t } = useTranslation();
    const [races, setRaces] = useState(getTargetRaces);
    const [form, setForm] = useState(EMPTY_FORM);
    const [editingId, setEditingId] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        const reload = () => setRaces(getTargetRaces());
        window.addEventListener(TARGET_RACES_EVENT, reload);
        return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
    }, []);

    const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setError(''); };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.name.trim()) { setError(t('targets.err_name')); return; }
        const min = parseTimeToMinutes(form.time);
        if (form.time && min == null) { setError(t('targets.err_time')); return; }
        saveTargetRace({
            id: editingId || undefined,
            name: form.name.trim(),
            date: form.date,
            distance: form.distance,
            goalTimeMin: min,
        });
        setRaces(getTargetRaces());
        resetForm();
    };

    const handleEdit = (r) => {
        setEditingId(r.id);
        setForm({
            name: r.name,
            date: r.date || '',
            distance: r.distance,
            time: r.goalTimeMin != null ? formatMinutes(r.goalTimeMin) : '',
        });
        setError('');
    };

    const handleDelete = (id) => {
        setRaces(deleteTargetRace(id));
        if (editingId === id) resetForm();
    };

    const inputClass = "w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all placeholder:text-slate-400";

    return (
        <div className="space-y-6 max-w-5xl mx-auto fade-in">
            {/* Header */}
            <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl">
                        <FlagIcon className="w-8 h-8" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-1.5 uppercase">{t('targets.title')}</h2>
                        <p className="text-slate-500 text-sm font-medium">{t('targets.subtitle')}</p>
                    </div>
                </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                        <div className="lg:col-span-2">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('targets.name')}</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                                placeholder={t('targets.name_ph')}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('targets.date')}</label>
                            <input
                                type="date"
                                value={form.date}
                                onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('targets.distance')}</label>
                            <Select value={form.distance} onValueChange={(v) => setForm(f => ({ ...f, distance: v }))} enableClear={false}>
                                <SelectItem value="5k">{t('planner.distances.5k')}</SelectItem>
                                <SelectItem value="10k">{t('planner.distances.10k')}</SelectItem>
                                <SelectItem value="21k">{t('planner.distances.21k')}</SelectItem>
                                <SelectItem value="42k">{t('planner.distances.42k')}</SelectItem>
                            </Select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('targets.goal_time')}</label>
                            <input
                                type="text"
                                value={form.time}
                                onChange={(e) => setForm(f => ({ ...f, time: e.target.value }))}
                                placeholder={t('targets.goal_time_ph')}
                                className={inputClass}
                            />
                        </div>
                    </div>

                    {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

                    <div className="flex items-center gap-3">
                        <button
                            type="submit"
                            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-sm shadow-blue-200"
                        >
                            {editingId ? t('targets.save') : t('targets.add')}
                        </button>
                        {editingId && (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="px-6 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
                            >
                                {t('targets.cancel')}
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {/* List */}
            {races.length === 0 ? (
                <div className="bg-white rounded-2xl p-16 border border-slate-100 shadow-sm text-center">
                    <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                        <FlagIcon className="w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-2">{t('targets.empty_title')}</h3>
                    <p className="text-slate-500 font-medium max-w-sm mx-auto">{t('targets.empty_desc')}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {races.map(r => {
                        const days = daysUntil(r.date);
                        const isPast = days != null && days < 0;
                        return (
                            <div key={r.id} className={`bg-white rounded-2xl border border-slate-100 p-6 shadow-sm transition-all hover:shadow-md ${isPast ? 'opacity-60' : ''}`}>
                                <div className="flex justify-between items-start gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-50 text-blue-600">
                                                {t(`planner.distances.${r.distance}`)}
                                            </span>
                                            {days != null && !isPast && (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600">
                                                    {days === 0 ? t('targets.today') : t('targets.days_left', { count: days })}
                                                </span>
                                            )}
                                            {isPast && (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-400">
                                                    {t('targets.past')}
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-black text-slate-900 tracking-tight truncate">{r.name}</h3>
                                        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs font-bold text-slate-500">
                                            {r.date && (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <CalendarDaysIcon className="w-3.5 h-3.5 text-slate-400" />
                                                    {new Date(r.date + 'T00:00:00').toLocaleDateString()}
                                                </span>
                                            )}
                                            {r.goalTimeMin != null && (
                                                <span className="inline-flex items-center gap-1.5">
                                                    <ClockIcon className="w-3.5 h-3.5 text-slate-400" />
                                                    {formatMinutes(r.goalTimeMin)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => handleEdit(r)}
                                            className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                            title={t('targets.edit')}
                                        >
                                            <PencilSquareIcon className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(r.id)}
                                            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                            title={t('targets.delete')}
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TargetRaces;
