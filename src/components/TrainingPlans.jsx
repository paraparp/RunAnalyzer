import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CalendarDaysIcon, PlusIcon, TrashIcon, PencilSquareIcon, XMarkIcon,
    ChevronDownIcon, ClockIcon, CheckCircleIcon, ChatBubbleLeftRightIcon, FlagIcon,
} from "@heroicons/react/24/outline";
import {
    getTrainingPlans, saveTrainingPlan, deleteTrainingPlan,
    saveWorkout, deleteWorkout, TRAINING_PLANS_EVENT, WORKOUT_STATUSES,
} from '../lib/trainingPlans';
import { getTargetRaces, daysUntil } from '../lib/targetRaces';
import { toISODate } from '../lib/planSchedule';

const EMPTY_WORKOUT = {
    date: '', type: '', summary: '', status: 'planned',
    distance_km: '', duration_min: '', coach_note: '',
};

/** Normaliza un entreno guardado (campos opcionales pueden faltar) a valores de formulario. */
const toFormWorkout = (w) => ({
    ...EMPTY_WORKOUT,
    ...w,
    summary: w.summary || '',
    coach_note: w.coach_note || '',
    distance_km: w.distance_km != null ? String(w.distance_km) : '',
    duration_min: w.duration_min != null ? String(w.duration_min) : '',
});

const STATUS_STYLE = {
    planned: 'bg-blue-50 text-blue-600 ring-blue-100',
    done: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    skipped: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const Chip = ({ className = '', children }) => (
    <span className={`px-2 py-0.5 rounded-full text-label font-bold uppercase ring-1 ring-inset ${className}`}>
        {children}
    </span>
);

const inputClass = "w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all placeholder:text-slate-400";

/** Pasos del entreno estructurado, si los trae (mismo formato que el planificador IA). */
const StructuredSteps = ({ steps }) => (
    <div className="mt-3 space-y-1.5">
        {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-black text-slate-900 shrink-0">{step.phase}</span>
                <span className="font-bold tabular-nums shrink-0">
                    {step.reps > 1 ? `${step.reps} × ${step.duration_min}′` : `${step.duration_min}′`}
                </span>
                {step.pace && <span className="shrink-0 text-slate-500">{step.pace}</span>}
                {step.hr && <span className="shrink-0 text-slate-500">{step.hr} ppm</span>}
                <span className="truncate text-slate-500">{step.description}</span>
            </div>
        ))}
    </div>
);

const WorkoutForm = ({ initial, onSave, onCancel, t }) => {
    const [form, setForm] = useState(initial);
    const [error, setError] = useState('');

    const submit = (e) => {
        e.preventDefault();
        if (!form.date) { setError(t('trainingplans.err_date')); return; }
        if (!form.type.trim()) { setError(t('trainingplans.err_type')); return; }
        onSave({
            ...form,
            type: form.type.trim(),
            summary: form.summary.trim(),
            coach_note: form.coach_note.trim(),
            distance_km: form.distance_km === '' ? undefined : Number(form.distance_km),
            duration_min: form.duration_min === '' ? undefined : Number(form.duration_min),
        });
    };

    return (
        <form onSubmit={submit} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                    <label className="block text-label font-bold text-slate-500 uppercase mb-1.5">{t('trainingplans.date')}</label>
                    <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
                </div>
                <div>
                    <label className="block text-label font-bold text-slate-500 uppercase mb-1.5">{t('trainingplans.type')}</label>
                    <input type="text" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} placeholder={t('trainingplans.type_ph')} className={inputClass} />
                </div>
                <div>
                    <label className="block text-label font-bold text-slate-500 uppercase mb-1.5">{t('trainingplans.status')}</label>
                    <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={inputClass}>
                        {WORKOUT_STATUSES.map((s) => <option key={s} value={s}>{t(`trainingplans.status_${s}`)}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-label font-bold text-slate-500 uppercase mb-1.5">{t('trainingplans.distance')}</label>
                    <input type="number" step="0.1" min="0" value={form.distance_km} onChange={(e) => setForm((f) => ({ ...f, distance_km: e.target.value }))} placeholder={t('trainingplans.distance_ph')} className={inputClass} />
                </div>
                <div>
                    <label className="block text-label font-bold text-slate-500 uppercase mb-1.5">{t('trainingplans.duration')}</label>
                    <input type="number" step="1" min="0" value={form.duration_min} onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))} placeholder={t('trainingplans.duration_ph')} className={inputClass} />
                </div>
            </div>
            <div>
                <label className="block text-label font-bold text-slate-500 uppercase mb-1.5">{t('trainingplans.summary')}</label>
                <textarea value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} placeholder={t('trainingplans.summary_ph')} rows={3} className={`${inputClass} resize-y`} />
            </div>
            <div>
                <label className="block text-label font-bold text-slate-500 uppercase mb-1.5">{t('trainingplans.coach_note')}</label>
                <textarea value={form.coach_note} onChange={(e) => setForm((f) => ({ ...f, coach_note: e.target.value }))} placeholder={t('trainingplans.coach_note_ph')} rows={2} className={`${inputClass} resize-y`} />
            </div>
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            <div className="flex items-center gap-2">
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all">
                    {t('trainingplans.save')}
                </button>
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-slate-300 transition-all">
                    {t('trainingplans.cancel')}
                </button>
            </div>
        </form>
    );
};

const WorkoutRow = ({ workout, onEdit, onDelete, onToggleDone, t }) => {
    const [expanded, setExpanded] = useState(false);
    const date = workout.date ? new Date(`${workout.date}T00:00:00`) : null;
    const hasSteps = Array.isArray(workout.structured_workout) && workout.structured_workout.length > 0;
    const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;

    return (
        <div className={`bg-white rounded-xl border border-slate-100 p-4 ${workout.status === 'skipped' ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-3">
                <div className="shrink-0 w-14 text-center">
                    <p className="text-xs font-black text-slate-900 tabular-nums leading-none">
                        {date ? date.toLocaleDateString(locale, { day: '2-digit', month: 'short' }) : '—'}
                    </p>
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-black text-slate-900">{workout.type}</span>
                        <Chip className={STATUS_STYLE[workout.status] || STATUS_STYLE.planned}>
                            {t(`trainingplans.status_${workout.status || 'planned'}`)}
                        </Chip>
                        {workout.distance_km != null && (
                            <span className="text-xs font-bold text-slate-500 tabular-nums">{workout.distance_km} km</span>
                        )}
                        {workout.duration_min != null && (
                            <span className="text-xs font-bold text-slate-500 tabular-nums">{workout.duration_min} min</span>
                        )}
                    </div>
                    {workout.summary && <p className="text-sm text-slate-600 leading-relaxed">{workout.summary}</p>}
                    {workout.coach_note && (
                        <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800 font-medium leading-relaxed">{workout.coach_note}</p>
                        </div>
                    )}
                    {hasSteps && (
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            className="mt-2 inline-flex items-center gap-1 text-label font-bold uppercase text-slate-500 hover:text-blue-600 transition-colors"
                        >
                            <ClockIcon className="w-3.5 h-3.5" />
                            {t('trainingplans.steps', { n: workout.structured_workout.length })}
                            <ChevronDownIcon className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                    )}
                    {hasSteps && expanded && <StructuredSteps steps={workout.structured_workout} />}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={() => onToggleDone(workout)}
                        className={`p-1.5 rounded-lg transition-colors ${workout.status === 'done' ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50'}`}
                        title={workout.status === 'done' ? t('trainingplans.mark_planned') : t('trainingplans.mark_done')}
                    >
                        <CheckCircleIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => onEdit(workout)} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors" title={t('trainingplans.edit')}>
                        <PencilSquareIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(workout.id)} className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors" title={t('trainingplans.delete')}>
                        <TrashIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

const TrainingPlans = () => {
    const { t } = useTranslation();
    const [plans, setPlans] = useState(getTrainingPlans);
    const [selectedPlanId, setSelectedPlanId] = useState(() => getTrainingPlans()[0]?.id || null);
    const [showPast, setShowPast] = useState(false);
    const [editingWorkout, setEditingWorkout] = useState(null); // 'new' | workout | null
    const [newPlanName, setNewPlanName] = useState('');
    const [addingPlan, setAddingPlan] = useState(false);

    useEffect(() => {
        const reload = () => {
            const list = getTrainingPlans();
            setPlans(list);
            setSelectedPlanId((prev) => (list.some((p) => p.id === prev) ? prev : (list[0]?.id || null)));
        };
        window.addEventListener(TRAINING_PLANS_EVENT, reload);
        return () => window.removeEventListener(TRAINING_PLANS_EVENT, reload);
    }, []);

    const selectedPlan = plans.find((p) => p.id === selectedPlanId) || null;
    const targetRaces = getTargetRaces();
    const linkedRace = selectedPlan?.raceId ? targetRaces.find((r) => r.id === selectedPlan.raceId) : null;

    const { upcoming, past } = useMemo(() => {
        const todayISO = toISODate(new Date());
        const workouts = selectedPlan?.workouts || [];
        const up = [], pa = [];
        for (const w of workouts) ((w.date || '') < todayISO ? pa : up).push(w);
        pa.reverse();
        return { upcoming: up, past: pa };
    }, [selectedPlan]);

    const createPlan = (e) => {
        e.preventDefault();
        if (!newPlanName.trim()) return;
        const list = saveTrainingPlan({ name: newPlanName.trim() });
        setNewPlanName('');
        setAddingPlan(false);
        setSelectedPlanId(list[list.length - 1].id);
    };

    const renamePlan = (plan) => {
        const name = window.prompt(t('trainingplans.rename_prompt'), plan.name || '');
        if (name == null || !name.trim()) return;
        saveTrainingPlan({ id: plan.id, name: name.trim() });
    };

    const removePlan = (plan) => {
        if (!window.confirm(t('trainingplans.confirm_delete_plan', { name: plan.name }))) return;
        deleteTrainingPlan(plan.id);
    };

    const handleSaveWorkout = useCallback((workout) => {
        if (!selectedPlan) return;
        saveWorkout(selectedPlan.id, workout);
        setEditingWorkout(null);
    }, [selectedPlan]);

    const handleDeleteWorkout = useCallback((workoutId) => {
        if (!selectedPlan) return;
        deleteWorkout(selectedPlan.id, workoutId);
    }, [selectedPlan]);

    const handleToggleDone = useCallback((workout) => {
        if (!selectedPlan) return;
        saveWorkout(selectedPlan.id, { id: workout.id, status: workout.status === 'done' ? 'planned' : 'done' });
    }, [selectedPlan]);

    return (
        <div className="space-y-6 max-w-5xl mx-auto fade-in">
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-100 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl">
                            <CalendarDaysIcon className="w-8 h-8" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-1.5 uppercase">{t('trainingplans.title')}</h2>
                            <p className="text-slate-500 text-sm font-medium">{t('trainingplans.subtitle')}</p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-6">
                    {plans.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => setSelectedPlanId(p.id)}
                            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${selectedPlanId === p.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                        >
                            {p.name || t('trainingplans.untitled')}
                            <span className="ml-1.5 opacity-70">{(p.workouts || []).length}</span>
                        </button>
                    ))}
                    {!addingPlan ? (
                        <button
                            onClick={() => setAddingPlan(true)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-white border-2 border-dashed border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600 transition-all"
                        >
                            <PlusIcon className="w-3.5 h-3.5" />
                            {t('trainingplans.new_plan')}
                        </button>
                    ) : (
                        <form onSubmit={createPlan} className="inline-flex items-center gap-2">
                            <input
                                autoFocus
                                type="text"
                                value={newPlanName}
                                onChange={(e) => setNewPlanName(e.target.value)}
                                placeholder={t('trainingplans.new_plan_ph')}
                                className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                            <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-blue-700">
                                {t('trainingplans.add')}
                            </button>
                            <button type="button" onClick={() => { setAddingPlan(false); setNewPlanName(''); }} className="p-2 text-slate-400 hover:text-slate-600">
                                <XMarkIcon className="w-4 h-4" />
                            </button>
                        </form>
                    )}
                </div>
            </div>

            {!selectedPlan ? (
                <div className="bg-white rounded-2xl p-16 border border-slate-100 shadow-sm text-center">
                    <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CalendarDaysIcon className="w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-2">{t('trainingplans.empty_title')}</h3>
                    <p className="text-slate-500 font-medium max-w-sm mx-auto">{t('trainingplans.empty_desc')}</p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-100 shadow-sm space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-black text-slate-900">{selectedPlan.name || t('trainingplans.untitled')}</h3>
                            <button onClick={() => renamePlan(selectedPlan)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title={t('trainingplans.rename')}>
                                <PencilSquareIcon className="w-4 h-4" />
                            </button>
                            <button onClick={() => removePlan(selectedPlan)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title={t('trainingplans.delete_plan')}>
                                <TrashIcon className="w-4 h-4" />
                            </button>
                            <div className="inline-flex items-center gap-1.5 ml-1">
                                <FlagIcon className="w-3.5 h-3.5 text-slate-400" />
                                <select
                                    value={linkedRace ? linkedRace.id : ''}
                                    onChange={(e) => saveTrainingPlan({ id: selectedPlan.id, raceId: e.target.value || null })}
                                    className="px-2 py-1 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    title={t('trainingplans.link_race')}
                                >
                                    <option value="">{t('trainingplans.no_race')}</option>
                                    {targetRaces.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                            </div>
                        </div>
                        {editingWorkout === null && (
                            <button
                                onClick={() => setEditingWorkout('new')}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all"
                            >
                                <PlusIcon className="w-4 h-4" />
                                {t('trainingplans.add_workout')}
                            </button>
                        )}
                    </div>

                    {linkedRace && (
                        <p className="text-xs font-semibold text-slate-500 -mt-3">
                            {t('trainingplans.towards_race', { name: linkedRace.name })}
                            {linkedRace.date && (() => {
                                const d = daysUntil(linkedRace.date);
                                return d != null ? ` · ${t('trainingplans.days_to_race', { n: d })}` : '';
                            })()}
                        </p>
                    )}

                    {editingWorkout === 'new' && (
                        <WorkoutForm initial={EMPTY_WORKOUT} onSave={handleSaveWorkout} onCancel={() => setEditingWorkout(null)} t={t} />
                    )}
                    {editingWorkout && editingWorkout !== 'new' && (
                        <WorkoutForm key={editingWorkout.id} initial={toFormWorkout(editingWorkout)} onSave={handleSaveWorkout} onCancel={() => setEditingWorkout(null)} t={t} />
                    )}

                    {upcoming.length === 0 && past.length === 0 ? (
                        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl">
                            <CheckCircleIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                            <p className="text-slate-500 text-sm font-medium">{t('trainingplans.no_workouts')}</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {upcoming.length > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-label font-bold text-slate-500 uppercase px-1">{t('trainingplans.upcoming')} · {upcoming.length}</h4>
                                    <div className="space-y-3">
                                        {upcoming.map((w) => (
                                            <WorkoutRow key={w.id} workout={w} onEdit={setEditingWorkout} onDelete={handleDeleteWorkout} onToggleDone={handleToggleDone} t={t} />
                                        ))}
                                    </div>
                                </div>
                            )}
                            {past.length > 0 && (
                                <div className="space-y-3">
                                    <button
                                        onClick={() => setShowPast((v) => !v)}
                                        className="inline-flex items-center gap-1.5 text-label font-bold text-slate-500 uppercase px-1 hover:text-slate-600 transition-colors"
                                    >
                                        {t('trainingplans.past')} · {past.length}
                                        <ChevronDownIcon className={`w-3 h-3 transition-transform ${showPast ? 'rotate-180' : ''}`} />
                                    </button>
                                    {showPast && (
                                        <div className="space-y-3">
                                            {past.map((w) => (
                                                <WorkoutRow key={w.id} workout={w} onEdit={setEditingWorkout} onDelete={handleDeleteWorkout} onToggleDone={handleToggleDone} t={t} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default TrainingPlans;
