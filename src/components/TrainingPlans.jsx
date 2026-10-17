import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CalendarDaysIcon, PlusIcon, TrashIcon, PencilSquareIcon, XMarkIcon,
    ChevronDownIcon, ClockIcon, CheckCircleIcon, ChatBubbleLeftRightIcon, FlagIcon,
    ArrowsRightLeftIcon, PaperAirplaneIcon, DocumentDuplicateIcon, ExclamationTriangleIcon,
    ListBulletIcon, TableCellsIcon, BoltIcon,
} from "@heroicons/react/24/outline";
import {
    getTrainingPlans, saveTrainingPlan, deleteTrainingPlan, duplicateWeek,
    saveWorkout, deleteWorkout, TRAINING_PLANS_EVENT, WORKOUT_STATUSES,
} from '../lib/trainingPlans';
import { runsByDay, workoutActual, weeklyVolume } from '../lib/planActuals';
import { getTargetRaces, daysUntil } from '../lib/targetRaces';
import { formatMinutes } from '../lib/timeFormat';
import { toISODate } from '../lib/planSchedule';
import { pushPlanDays, deleteGarminWorkout } from '../services/garminWorkouts';
import { WORKOUT_CATEGORIES, workoutCategory } from '../lib/workoutProtocol';
import WorkoutCard, { MiniProfile } from './WorkoutCard';
import { CATEGORY_STYLE } from '../lib/workoutStyle';
import {
    PLAN_PHASES, estimateWorkoutLoad, plannedLoad, planWarnings, unplannedRuns, compareToPlan,
    INTENSITY_BANDS, weekIntensityMix,
} from '../lib/planInsights';
import { buildLoadParams, sessionLoad } from '../lib/trainingLoad';

// Color de cada fase del bloque: escala de índigo según la carga, cian para el taper.
const PHASE_STYLE = {
    base: { band: 'bg-indigo-200', text: 'text-indigo-500', wash: 'bg-indigo-50' },
    build: { band: 'bg-indigo-400', text: 'text-indigo-600', wash: 'bg-indigo-50' },
    peak: { band: 'bg-indigo-600', text: 'text-indigo-700', wash: 'bg-indigo-100' },
    taper: { band: 'bg-cyan-500', text: 'text-cyan-700', wash: 'bg-cyan-50' },
    recovery: { band: 'bg-slate-300', text: 'text-slate-500', wash: 'bg-slate-100' },
};

const VIEW_KEY = 'trainingplans_view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'list'; } catch { return 'list'; } };
const writeView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* sin storage */ } };

const EMPTY_WORKOUT = {
    date: '', type: '', summary: '', status: 'planned', category: '', key_rule: '',
    distance_km: '', duration_min: '', coach_note: '',
};

/** Normaliza un entreno guardado (campos opcionales pueden faltar) a valores de formulario. */
const toFormWorkout = (w) => ({
    ...EMPTY_WORKOUT,
    ...w,
    summary: w.summary || '',
    category: w.category || '',
    key_rule: w.key_rule || '',
    coach_note: w.coach_note || '',
    distance_km: w.distance_km != null ? String(w.distance_km) : '',
    duration_min: w.duration_min != null ? String(w.duration_min) : '',
});

const STATUS_STYLE = {
    planned: 'bg-blue-50 text-blue-600 ring-blue-100',
    done: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    skipped: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;
const parseISO = (iso) => new Date(`${iso}T00:00:00`);
const shortDate = (iso) => parseISO(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short' });
const weekdayShort = (iso) => parseISO(iso).toLocaleDateString(locale, { weekday: 'short' }).replace('.', '');
const dayDiff = (a, b) => Math.round((parseISO(a) - parseISO(b)) / 86400000);
/** Lunes de la semana de `iso` (las semanas del plan empiezan en lunes, como weeklyVolume). */
const mondayOf = (iso) => {
    const d = parseISO(iso);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return toISODate(d);
};
const addDaysISO = (iso, n) => {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
};
const isRest =(w) => workoutCategory(w) === 'rest';

const Chip = ({ className = '', children }) => (
    <span className={`px-2 py-0.5 rounded-full text-label font-bold uppercase ring-1 ring-inset ${className}`}>
        {children}
    </span>
);

const inputClass = "w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all placeholder:text-slate-400";
const iconBtn = "p-1.5 rounded-lg text-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

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
            category: form.category || undefined,
            key_rule: form.key_rule.trim() || undefined,
            coach_note: form.coach_note.trim(),
            distance_km: form.distance_km === '' ? undefined : Number(form.distance_km),
            duration_min: form.duration_min === '' ? undefined : Number(form.duration_min),
            // Un estado elegido a mano no lo pisa el marcado automático.
            status_manual: form.status !== initial.status ? true : initial.status_manual,
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
                    <label className="block text-label font-bold text-slate-500 uppercase mb-1.5">{t('trainingplans.category')}</label>
                    <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputClass}>
                        <option value="">{t('trainingplans.category_auto')}</option>
                        {WORKOUT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_STYLE[c].label}</option>)}
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
                <label className="block text-label font-bold text-slate-500 uppercase mb-1.5">{t('trainingplans.key_rule')}</label>
                <input type="text" value={form.key_rule} onChange={(e) => setForm((f) => ({ ...f, key_rule: e.target.value }))} placeholder={t('trainingplans.key_rule_ph')} className={inputClass} />
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

/** Lo corrido ese día frente a lo planificado. Pulsar abre la actividad. */
const ActualLine = ({ actual, workout, onOpen, t }) => {
    const parts = [
        `${actual.distance_km} km`,
        actual.pace_min_km != null ? `${formatMinutes(actual.pace_min_km)}/km` : null,
        `${actual.moving_time_min} min`,
        actual.avg_hr ? `${actual.avg_hr} ppm` : null,
    ].filter(Boolean);
    const delta = Number.isFinite(workout.distance_km) && workout.distance_km > 0
        ? Math.round(((actual.distance_km - workout.distance_km) / workout.distance_km) * 100)
        : null;
    return (
        <button
            type="button"
            onClick={() => actual.activity_id && onOpen?.(actual.activity_id)}
            title={actual.name || t('trainingplans.open_activity')}
            className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-600 hover:border-blue-200 hover:text-blue-700 transition-colors"
        >
            <span className="font-black uppercase text-label text-slate-500">{t('trainingplans.actual')}</span>
            <span className="font-bold tabular-nums">{parts.join(' · ')}</span>
            {delta != null && Math.abs(delta) >= 5 && (
                <span className="font-semibold tabular-nums text-slate-500">({delta > 0 ? '+' : ''}{delta}% {t('trainingplans.vs_plan')})</span>
            )}
        </button>
    );
};

const LEVEL_DOT = { good: 'bg-emerald-500', caution: 'bg-amber-500', risk: 'bg-rose-500' };

/**
 * Plan frente a real en columnas, con semáforo por métrica (≤10% verde, ≤25%
 * ámbar, más rojo). El texto lleva la cifra y el %: el color solo refuerza.
 */
const PlanVsActual = ({ workout, actual, onOpen, t }) => {
    const rows = compareToPlan(workout, actual);
    const fmt = {
        distance: (v) => `${v} km`,
        duration: (v) => `${Math.round(v)} min`,
        pace: (v) => `${formatMinutes(v)}/km`,
    };
    return (
        <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60">
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100">
                {rows.map((r) => (
                    <div key={r.key} className="px-3 py-2.5 min-w-0">
                        <p className="text-label font-bold uppercase text-slate-500">{t(`trainingplans.cmp_${r.key}`)}</p>
                        <p className="text-base font-black text-slate-900 tabular-nums mt-0.5">{r.real != null ? fmt[r.key](r.real) : '—'}</p>
                        <p className="text-xs font-medium text-slate-500 tabular-nums flex items-center gap-1.5">
                            {r.level && <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_DOT[r.level]}`} aria-hidden />}
                            {r.plan != null ? `${t('trainingplans.cmp_plan')} ${fmt[r.key](r.plan)}` : t('trainingplans.cmp_no_plan')}
                            {r.delta != null && ` · ${r.delta > 0 ? '+' : ''}${r.delta}%`}
                        </p>
                    </div>
                ))}
                <div className="px-3 py-2.5 min-w-0">
                    <p className="text-label font-bold uppercase text-slate-500">{t('trainingplans.cmp_hr')}</p>
                    <p className="text-base font-black text-slate-900 tabular-nums mt-0.5">{actual.avg_hr ? `${actual.avg_hr} ppm` : '—'}</p>
                    {actual.activity_id && (
                        <button type="button" onClick={() => onOpen?.(actual.activity_id)} className="text-xs font-bold text-blue-600 hover:text-blue-700">
                            {t('trainingplans.open_activity')} →
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

/** Carrera que no estaba en el plan: una línea en el historial. */
const ExtraRow = ({ run, onOpen, t }) => (
    <button
        type="button"
        onClick={() => run.activity_id && onOpen?.(run.activity_id)}
        className="relative w-full flex items-center gap-4 px-4 py-2.5 pl-5 text-left hover:bg-slate-50/80 transition-colors"
        title={run.name || t('trainingplans.open_activity')}
    >
        <span className="absolute left-0 inset-y-2 border-l-2 border-dashed border-slate-300" aria-hidden />
        <div className="shrink-0 w-10 text-center">
            <p className="text-label font-bold uppercase leading-none text-slate-400">{weekdayShort(run.date)}</p>
            <p className="text-base font-black tabular-nums leading-none mt-1 text-slate-500">{parseISO(run.date).getDate()}</p>
        </div>
        <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2.5">
            <span className="text-sm font-bold text-slate-600 truncate">{run.name || t('trainingplans.extra_run')}</span>
            <span className="px-1.5 py-0.5 rounded text-[11px] font-bold border border-dashed border-slate-300 text-slate-500">{t('trainingplans.extra_label')}</span>
            <span className="text-xs font-bold text-slate-500 tabular-nums">
                {[`${run.distance_km} km`, run.pace_min_km != null ? `${formatMinutes(run.pace_min_km)}/km` : null, run.avg_hr ? `${run.avg_hr} ppm` : null].filter(Boolean).join(' · ')}
            </span>
        </div>
    </button>
);

/**
 * Calendario lunes–domingo: una fila por semana, siete casillas por día. Los
 * entrenos se arrastran de un día a otro (mismo efecto que "Mover a otro día") y
 * al pulsarlos se editan. Las carreras fuera de plan aparecen con borde punteado.
 */
const PlanCalendar = ({ weeks, workouts, extras, phases, todayISO, showAllWeeks, onToggleAll, onMove, onEdit, t }) => {
    const [dragId, setDragId] = useState(null);
    const [overDay, setOverDay] = useState(null);
    const byDate = useMemo(() => {
        const m = new Map();
        for (const w of workouts) if (w.date) { if (!m.has(w.date)) m.set(w.date, []); m.get(w.date).push(w); }
        return m;
    }, [workouts]);
    const extraByDate = useMemo(() => new Map(extras.map((r) => [r.date, r])), [extras]);
    // Lo pasado pesa poco: por defecto solo desde la semana anterior a la actual.
    const cutoff = mondayOf(addDaysISO(todayISO, -7));
    const hidden = weeks.filter((w) => w.week_start < cutoff).length;
    const visible = showAllWeeks ? weeks : weeks.filter((w) => w.week_start >= cutoff);
    const dayLabels = Array.from({ length: 7 }, (_, i) => weekdayShort(toISODate(new Date(2024, 0, 1 + i)))); // 1-ene-2024 fue lunes

    const drop = (date) => {
        const w = workouts.find((x) => x.id === dragId);
        if (w) onMove(w, date);
        setDragId(null);
        setOverDay(null);
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6">
            {hidden > 0 && (
                <button type="button" onClick={onToggleAll} className="mb-3 inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-blue-600">
                    {showAllWeeks ? t('trainingplans.hide_old_weeks') : t('trainingplans.show_old_weeks', { n: hidden })}
                    <ChevronDownIcon className={`w-3 h-3 transition-transform ${showAllWeeks ? 'rotate-180' : ''}`} />
                </button>
            )}
            <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] sm:grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] gap-1 sm:gap-1.5">
                <span />
                {dayLabels.map((d, i) => (
                    <span key={d} className={`text-center text-label font-bold uppercase pb-1 ${i >= 5 ? 'text-slate-500' : 'text-slate-400'}`}>{d}</span>
                ))}
                {visible.map((wk) => {
                    const i = weeks.indexOf(wk);
                    const phase = phases[wk.week_start];
                    return [
                        <div key={`${wk.week_start}-h`} className={`flex flex-col justify-center gap-0.5 pr-1 sm:pl-2 border-l-2 ${wk.is_current ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500'}`}>
                            <span className="text-xs font-black tabular-nums">{t('trainingplans.week_short', { n: i + 1 })}</span>
                            {phase && <span className={`hidden sm:block text-[10px] font-bold uppercase ${PHASE_STYLE[phase].text}`}>{t(`trainingplans.phase_${phase}`)}</span>}
                            <span className="hidden sm:block text-[10px] font-semibold tabular-nums text-slate-400">{wk.planned_km} km</span>
                        </div>,
                        ...Array.from({ length: 7 }, (_, d) => {
                            const date = addDaysISO(wk.week_start, d);
                            const items = byDate.get(date) || [];
                            const extra = extraByDate.get(date);
                            const past = date < todayISO;
                            const isToday = date === todayISO;
                            return (
                                <div
                                    key={date}
                                    onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverDay(date); } }}
                                    onDragLeave={() => setOverDay((o) => (o === date ? null : o))}
                                    onDrop={(e) => { e.preventDefault(); drop(date); }}
                                    className={`min-h-[4.5rem] sm:min-h-[5.5rem] rounded-lg border p-1 sm:p-1.5 flex flex-col gap-1 transition-colors ${
                                        overDay === date ? 'border-blue-400 bg-blue-50 border-dashed'
                                            : isToday ? 'border-blue-300 bg-white ring-2 ring-blue-500/15'
                                                : past ? 'border-transparent bg-slate-50' : 'border-slate-100 bg-white'
                                    }`}
                                >
                                    <span className={`self-start text-[10px] font-bold tabular-nums leading-none ${isToday ? 'px-1.5 py-0.5 rounded-full bg-blue-600 text-white' : 'text-slate-400'}`}>
                                        {parseISO(date).getDate()}
                                    </span>
                                    {items.map((w) => {
                                        const accent = CATEGORY_STYLE[workoutCategory(w)] || CATEGORY_STYLE.easy;
                                        const status = w.status || 'planned';
                                        return (
                                            <button
                                                key={w.id}
                                                type="button"
                                                draggable
                                                onDragStart={(e) => { setDragId(w.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', w.id); }}
                                                onDragEnd={() => { setDragId(null); setOverDay(null); }}
                                                onClick={() => onEdit(w)}
                                                title={`${w.type}${w.distance_km != null ? ` · ${w.distance_km} km` : ''}${w.summary ? `\n${w.summary}` : ''}`}
                                                className={`relative text-left rounded-md ${accent.wash} pl-2 pr-1 py-1 overflow-hidden cursor-grab active:cursor-grabbing hover:shadow-sm hover:-translate-y-px transition ${
                                                    status === 'skipped' ? 'opacity-50 line-through' : ''
                                                } ${past && status !== 'done' ? 'opacity-70' : ''} ${dragId === w.id ? 'opacity-40' : ''}`}
                                            >
                                                <span className={`absolute left-0 inset-y-0 w-1 ${accent.bar}`} aria-hidden />
                                                <span className="flex items-center gap-1">
                                                    {status === 'done' && <CheckCircleIcon className="w-3 h-3 text-emerald-600 shrink-0" />}
                                                    <span className="hidden sm:block text-[11px] font-bold text-slate-800 truncate leading-tight">{w.type}</span>
                                                </span>
                                                {w.distance_km != null && (
                                                    <span className="block text-[10px] font-semibold text-slate-500 tabular-nums leading-tight">{w.distance_km} km</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                    {extra && !items.some((w) => workoutCategory(w) !== 'rest') && (
                                        <span
                                            className="rounded-md border border-dashed border-slate-300 px-1 py-0.5 text-[10px] font-semibold text-slate-500 tabular-nums"
                                            title={`${t('trainingplans.extra_label')} · ${extra.name || ''}`}
                                        >
                                            +{extra.distance_km} km
                                        </span>
                                    )}
                                </div>
                            );
                        }),
                    ];
                })}
            </div>
            <p className="mt-3 text-xs font-medium text-slate-400">{t('trainingplans.calendar_hint')}</p>
        </div>
    );
};

/** "Hoy", "Mañana", "En 3 días"… para la sesión destacada. */
const relativeDay = (iso, todayISO, t) => {
    const d = dayDiff(iso, todayISO);
    if (d === 0) return t('trainingplans.today');
    if (d === 1) return t('trainingplans.tomorrow');
    return t('trainingplans.in_days', { n: d });
};

/**
 * Una sesión del plan. `variant`:
 *   featured — la siguiente sesión: grande y con la ficha desplegada.
 *   default  — próximas: resumen visible, acciones al pasar el ratón.
 *   compact  — historial: una línea, sin resumen ni nota desplegada.
 */
const WorkoutRow = ({ workout, actual, isPast, todayISO, variant = 'default', onEdit, onDelete, onToggleDone, onMove, onSendToWatch, onOpenActivity, t }) => {
    const featured = variant === 'featured';
    const compact = variant === 'compact';
    const [expanded, setExpanded] = useState(featured);
    const [moving, setMoving] = useState(false);
    const [send, setSend] = useState(null); // null | 'sending' | { error }
    const hasSteps = Array.isArray(workout.structured_workout) && workout.structured_workout.length > 0;
    const category = workoutCategory(workout);
    const accent = CATEGORY_STYLE[category] || CATEGORY_STYLE.easy;
    const onWatch = !!workout.garmin_workout_id;
    // Enviado al reloj para otro día: tras moverlo hay que reenviarlo.
    const watchStale = onWatch && workout.garmin_date && workout.garmin_date !== workout.date;
    const isToday = workout.date === todayISO;
    const status = workout.status || 'planned';

    const sendToWatch = async () => {
        setSend('sending');
        try {
            await onSendToWatch(workout);
            setSend(null);
        } catch (e) {
            setSend({ error: e.message });
        }
    };

    const load = estimateWorkoutLoad(workout);
    const metrics = [
        workout.distance_km != null ? `${workout.distance_km} km` : null,
        workout.duration_min != null ? `${workout.duration_min} min` : null,
    ].filter(Boolean);

    return (
        // Fuera de la destacada, las filas viven dentro de la tarjeta de su semana:
        // sin borde propio, separadas por líneas y con el color de categoría en una barra corta.
        <div className={`group relative overflow-hidden transition-colors ${
            featured
                ? 'rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/80 via-white to-white shadow-sm'
                : 'bg-white hover:bg-slate-50/80'
        } ${status === 'skipped' ? 'opacity-60' : ''}`}>
            <div className={`flex items-start gap-4 ${featured ? 'p-5 sm:p-6' : compact ? 'px-4 py-2.5' : 'px-4 py-3.5'}`}>
                {/* Casilla de fecha teñida con el color de la categoría: el ojo agrupa por tipo antes de leer. */}
                {workout.date ? (
                    <div className={`shrink-0 rounded-xl flex flex-col items-center justify-center leading-none ${
                        featured ? 'w-16 h-[4.5rem] shadow-sm' : compact ? 'w-10 h-10' : 'w-12 h-12'
                    } ${featured ? `${accent.bar} text-white` : isToday ? 'bg-blue-600 text-white' : `${accent.wash} ${accent.text}`}`}>
                        <span className={`font-bold uppercase ${compact ? 'text-[9px]' : 'text-[10px]'} opacity-80`}>
                            {weekdayShort(workout.date)}
                        </span>
                        <span className={`font-black tabular-nums mt-0.5 ${featured ? 'text-3xl' : compact ? 'text-sm' : 'text-lg'}`}>
                            {parseISO(workout.date).getDate()}
                        </span>
                        {featured && (
                            <span className="text-[10px] font-bold uppercase opacity-80 mt-0.5">
                                {parseISO(workout.date).toLocaleDateString(locale, { month: 'short' }).replace('.', '')}
                            </span>
                        )}
                    </div>
                ) : (
                    <div className="shrink-0 w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">—</div>
                )}

                <div className="min-w-0 flex-1">
                    {featured && (
                        <p className="text-label font-bold uppercase text-blue-600 mb-1.5">
                            {t('trainingplans.next_up')} · {relativeDay(workout.date, todayISO, t)}
                        </p>
                    )}
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span className={`font-black text-slate-900 ${featured ? 'text-xl tracking-tight' : 'text-sm'}`}>{workout.type}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${accent.wash} ${accent.text}`}>{accent.label}</span>
                        {compact && metrics.length > 0 && (
                            <span className="font-bold text-slate-500 tabular-nums text-xs">{metrics.join(' · ')}</span>
                        )}
                        {load > 0 && !compact && (
                            <span className={`inline-flex items-center gap-0.5 font-bold text-slate-400 tabular-nums ${featured ? 'text-sm' : 'text-xs'}`} title={t('trainingplans.load_hint')}>
                                <BoltIcon className="w-3 h-3" />{load}
                            </span>
                        )}
                        {status !== 'planned' && (
                            <Chip className={STATUS_STYLE[status]}>{t(`trainingplans.status_${status}`)}</Chip>
                        )}
                        {onWatch && !isPast && (
                            <span className={`inline-flex items-center gap-1 text-xs font-bold ${watchStale ? 'text-amber-600' : 'text-emerald-600'}`}>
                                <PaperAirplaneIcon className="w-3 h-3" />
                                {watchStale ? t('trainingplans.watch_stale', { date: shortDate(workout.garmin_date) }) : t('trainingplans.on_watch')}
                            </span>
                        )}
                        {compact && workout.coach_note && (
                            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-amber-500 self-center" title={workout.coach_note} />
                        )}
                    </div>

                    {!compact && workout.summary && (
                        <p className={`text-slate-600 leading-relaxed mt-1 ${featured ? 'text-sm' : 'text-sm line-clamp-2'}`}>{workout.summary}</p>
                    )}
                    {hasSteps && !compact && !featured && (
                        <MiniProfile workout={workout} className="h-5 mt-2 max-w-xs" />
                    )}
                    {actual && featured && <PlanVsActual workout={workout} actual={actual} onOpen={onOpenActivity} t={t} />}
                    {actual && !featured && <ActualLine actual={actual} workout={workout} onOpen={onOpenActivity} t={t} />}
                    {!compact && workout.coach_note && (
                        <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
                            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-800 font-medium leading-relaxed">{workout.coach_note}</p>
                        </div>
                    )}
                    {hasSteps && !compact && (
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            className="mt-2 inline-flex items-center gap-1 text-label font-bold uppercase text-slate-500 hover:text-blue-600 transition-colors"
                        >
                            <ClockIcon className="w-3.5 h-3.5" />
                            {expanded ? t('trainingplans.hide_card') : t('trainingplans.show_card', { n: workout.structured_workout.length })}
                            <ChevronDownIcon className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                    )}
                    {(hasSteps || workout.key_rule) && expanded && !compact && (
                        <div className="mt-3"><WorkoutCard workout={workout} showHeader={false} /></div>
                    )}
                    {!hasSteps && workout.key_rule && !expanded && !compact && (
                        <p className="mt-2 text-xs text-slate-600"><span className="font-bold text-slate-800">{t('trainingplans.key_rule')} · </span>{workout.key_rule}</p>
                    )}
                    {moving && (
                        <div className="mt-2 inline-flex items-center gap-2">
                            <input
                                type="date"
                                autoFocus
                                defaultValue={workout.date}
                                onChange={(e) => { if (e.target.value) { onMove(workout, e.target.value); setMoving(false); } }}
                                className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                            <button type="button" onClick={() => setMoving(false)} className="p-1 text-slate-400 hover:text-slate-600">
                                <XMarkIcon className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}
                    {send?.error && <p className="mt-2 text-xs font-semibold text-rose-600">{send.error}</p>}
                </div>

                {/* La dosis en grande a la derecha: se compara de un vistazo bajando por la lista. */}
                {!compact && (workout.distance_km != null || workout.duration_min != null) && (
                    <div className="shrink-0 text-right leading-none pt-0.5">
                        {workout.distance_km != null ? (
                            <p className={`font-black text-slate-900 tabular-nums tracking-tight ${featured ? 'text-4xl' : 'text-xl'}`}>
                                {workout.distance_km}<span className={`font-bold text-slate-400 ml-0.5 ${featured ? 'text-base' : 'text-xs'}`}>km</span>
                            </p>
                        ) : (
                            <p className={`font-black text-slate-900 tabular-nums tracking-tight ${featured ? 'text-4xl' : 'text-xl'}`}>
                                {workout.duration_min}<span className={`font-bold text-slate-400 ml-0.5 ${featured ? 'text-base' : 'text-xs'}`}>min</span>
                            </p>
                        )}
                        {workout.distance_km != null && workout.duration_min != null && (
                            <p className={`font-semibold text-slate-400 tabular-nums mt-1 ${featured ? 'text-sm' : 'text-[11px]'}`}>{workout.duration_min} min</p>
                        )}
                    </div>
                )}

                {/* Acciones: siempre visibles en táctil; en escritorio aparecen al pasar el ratón o con el foco. */}
                <div className={`flex items-center gap-0.5 shrink-0 transition-opacity ${featured ? '' : 'sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100'}`}>
                    <button
                        onClick={() => onToggleDone(workout)}
                        className={`${iconBtn} ${status === 'done' ? 'text-emerald-600 hover:bg-emerald-50' : 'hover:text-emerald-600 hover:bg-emerald-50'}`}
                        title={status === 'done' ? t('trainingplans.mark_planned') : t('trainingplans.mark_done')}
                    >
                        <CheckCircleIcon className="w-4 h-4" />
                    </button>
                    {hasSteps && !isPast && (
                        <button
                            onClick={sendToWatch}
                            disabled={send === 'sending'}
                            className={`${iconBtn} hover:text-blue-600 hover:bg-blue-50 ${send === 'sending' ? 'animate-pulse' : ''}`}
                            title={send === 'sending' ? t('trainingplans.sending') : onWatch ? t('trainingplans.resend_watch') : t('trainingplans.send_watch')}
                        >
                            <PaperAirplaneIcon className="w-4 h-4" />
                        </button>
                    )}
                    <button onClick={() => setMoving((v) => !v)} className={`${iconBtn} hover:text-blue-600 hover:bg-blue-50`} title={t('trainingplans.move')}>
                        <ArrowsRightLeftIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => onEdit(workout)} className={`${iconBtn} hover:text-blue-600 hover:bg-blue-50`} title={t('trainingplans.edit')}>
                        <PencilSquareIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(workout.id)} className={`${iconBtn} hover:text-rose-600 hover:bg-rose-50`} title={t('trainingplans.delete')}>
                        <TrashIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

// Correr más de esto por encima de lo planificado en una semana se marca en ámbar.
const OVER_PLAN_PCT = 10;
const axisDate = (iso) => parseISO(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' }).replace('.', '');

// Colores de las bandas de intensidad: los de las zonas de FC del sistema
// (Z2 cielo, Z3 verde, Z4 naranja, Z5 rojo), de abajo arriba en la columna.
const BAND_STYLE = {
    aerobic: 'bg-sky-400',
    marathon: 'bg-green-400',
    threshold: 'bg-orange-400',
    race: 'bg-red-400',
};

/**
 * Volumen por semana en columnas apiladas: la altura es lo planificado y los
 * tramos de color su reparto por intensidad (planInsights.intensityMix). Lo
 * corrido es una marca horizontal a su altura, en ámbar si supera lo planificado
 * en más de un OVER_PLAN_PCT. Las semanas ya cerradas van atenuadas: lo que
 * importa es lo que viene. Una cifra por columna; el detalle, en el tooltip.
 */
const WeeklyVolume = ({ weeks, mixes = {}, phases = {}, t }) => {
    const max = Math.max(1, ...weeks.map((w) => Math.max(w.planned_km, w.actual_km ?? 0)));
    if (!weeks.some((w) => w.planned_km > 0 || (w.actual_km ?? 0) > 0)) {
        return <p className="text-xs font-medium text-slate-500">{t('trainingplans.no_volume')}</p>;
    }
    const currentIdx = weeks.findIndex((w) => w.is_current);
    const dense = weeks.length > 8; // en móvil, con muchas semanas, una fecha de cada dos
    const isOver = (w) => w.actual_km != null && w.planned_km > 0 && w.actual_km > w.planned_km * (1 + OVER_PLAN_PCT / 100);
    const anyOver = weeks.some(isOver);
    const usedBands = INTENSITY_BANDS.filter((b) => weeks.some((w) => (mixes[w.week_start]?.[b] || 0) > 0.05));
    const plannedKms = weeks.map((w) => w.planned_km).filter((k) => k > 0);
    const avg = plannedKms.length ? Math.round(plannedKms.reduce((s, k) => s + k, 0) / plannedKms.length) : 0;
    const peak = Math.round(Math.max(0, ...plannedKms));

    return (
        <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-4">
                <p className="text-label font-bold uppercase text-slate-500">{t('trainingplans.weekly_title')}</p>
                {avg > 0 && (
                    <p className="text-xs font-medium text-slate-500 tabular-nums">{t('trainingplans.volume_stats', { avg, peak })}</p>
                )}
            </div>
            {Object.keys(phases).length > 0 && (
                <div className="flex gap-1.5 sm:gap-2 mb-3">
                    {weeks.map((w, i) => {
                        const p = phases[w.week_start];
                        const prev = phases[weeks[i - 1]?.week_start];
                        return (
                            <div key={w.week_start} className="flex-1 min-w-0" title={p ? t(`trainingplans.phase_${p}`) : undefined}>
                                <span className={`block text-[10px] font-bold uppercase truncate h-3.5 leading-none ${p ? PHASE_STYLE[p].text : ''}`}>
                                    {p && p !== prev ? t(`trainingplans.phase_${p}`) : ''}
                                </span>
                                <div className={`h-1 rounded-full ${p ? PHASE_STYLE[p].band : 'bg-slate-100'}`} />
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="flex items-end gap-1.5 sm:gap-2 h-36 border-b border-slate-200">
                {weeks.map((w, i) => {
                    const closed = currentIdx >= 0 ? i < currentIdx : w.actual_km != null && !w.is_current;
                    const started = closed || w.is_current;
                    const actual = w.actual_km != null && w.actual_km > 0 ? w.actual_km : null;
                    const over = isOver(w);
                    const shown = started && actual != null ? actual : w.planned_km;
                    const top = Math.max(w.planned_km, actual ?? 0);
                    const mix = mixes[w.week_start] || {};
                    const mixSum = INTENSITY_BANDS.reduce((s, b) => s + (mix[b] || 0), 0);
                    const tooltip = [
                        `${t('trainingplans.week_label', { n: i + 1 })} · ${shortDate(w.week_start)}`,
                        t('trainingplans.week_tooltip', { done: w.done, total: w.sessions, planned: w.planned_km, actual: w.actual_km ?? '—' }),
                        ...INTENSITY_BANDS.filter((b) => (mix[b] || 0) > 0.05)
                            .map((b) => `${t(`trainingplans.band_${b}`)}: ${Math.round(mix[b] * 10) / 10} km`),
                        over ? t('trainingplans.over_hint', { pct: Math.round((w.actual_km / w.planned_km - 1) * 100) }) : null,
                    ].filter(Boolean).join('\n');
                    return (
                        <div key={w.week_start} className="group flex-1 min-w-0 h-full pt-5" title={tooltip}>
                            <div className="relative h-full flex items-end justify-center">
                                {shown > 0 && (
                                    <span
                                        className={`absolute inset-x-0 text-center text-[11px] leading-none tabular-nums ${dense ? 'hidden sm:block' : ''} ${
                                            over ? 'font-bold text-amber-600'
                                                : w.is_current ? 'font-black text-slate-900'
                                                    : closed ? 'font-medium text-slate-400' : 'font-semibold text-slate-600'
                                        }`}
                                        style={{ bottom: `calc(${(top / max) * 100}% + 4px)` }}
                                    >
                                        {Math.round(shown)}
                                    </span>
                                )}
                                {/* Columna planificada, apilada por intensidad (aeróbico abajo). */}
                                <div
                                    className={`relative w-full max-w-[1.75rem] rounded-t-[3px] overflow-hidden flex flex-col-reverse transition-opacity ${
                                        closed ? 'opacity-45 group-hover:opacity-80' : ''
                                    } ${w.is_current ? 'ring-2 ring-slate-900 ring-offset-1' : ''} ${mixSum > 0 ? '' : 'bg-slate-200'}`}
                                    style={{ height: `${Math.max(1, (w.planned_km / max) * 100)}%` }}
                                >
                                    {mixSum > 0 && INTENSITY_BANDS.map((b) => (mix[b] > 0 ? (
                                        <div key={b} className={BAND_STYLE[b]} style={{ height: `${(mix[b] / mixSum) * 100}%` }} />
                                    ) : null))}
                                </div>
                                {/* Lo corrido: una marca a su altura, un poco más ancha que la columna. */}
                                {actual != null && (
                                    <div
                                        className={`absolute left-1/2 -translate-x-1/2 w-[calc(100%+4px)] max-w-[2rem] h-[3px] rounded-full ${
                                            over ? 'bg-amber-500' : 'bg-slate-900'
                                        } ${closed && !over ? 'opacity-60' : ''}`}
                                        style={{ bottom: `calc(${(actual / max) * 100}% - 1.5px)` }}
                                    />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="flex gap-1.5 sm:gap-2 mt-2">
                {weeks.map((w, i) => (
                    <span
                        key={w.week_start}
                        className={`flex-1 min-w-0 text-center text-[10px] tabular-nums whitespace-nowrap overflow-visible ${
                            w.is_current ? 'font-bold text-slate-900' : 'font-medium text-slate-400'
                        } ${dense && i % 2 ? 'invisible sm:visible' : ''}`}
                    >
                        {axisDate(w.week_start)}
                    </span>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 text-xs text-slate-500">
                {usedBands.map((b) => (
                    <span key={b} className="inline-flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-[2px] ${BAND_STYLE[b]}`} />{t(`trainingplans.band_${b}`)}
                    </span>
                ))}
                {usedBands.length === 0 && (
                    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[2px] bg-slate-200" />{t('trainingplans.legend_planned')}</span>
                )}
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-[3px] rounded-full bg-slate-900" />{t('trainingplans.legend_actual')}</span>
                {anyOver && (
                    <span className="inline-flex items-center gap-1.5"><span className="w-3 h-[3px] rounded-full bg-amber-500" />{t('trainingplans.legend_over', { n: OVER_PLAN_PCT })}</span>
                )}
            </div>
        </div>
    );
};


/** Cabecera de semana en la lista de próximos: número, rango, km y acciones. */
const WeekHeader = ({ index, weekStart, meta, phase, load, sendable, sending, onPhase, onSendWeek, onDuplicate, t }) => {
    const end = addDaysISO(weekStart, 6);
    const progress = meta?.is_current && meta.planned_km > 0 && meta.actual_km != null
        ? Math.min(100, (meta.actual_km / meta.planned_km) * 100)
        : null;
    return (
        <div className={`relative flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 ${meta?.is_current ? 'bg-blue-50/50' : 'bg-slate-50/60'}`}>
            {progress != null && (
                <div className="absolute left-0 bottom-0 h-0.5 bg-blue-600 transition-all" style={{ width: `${progress}%` }} aria-hidden />
            )}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h4 className={`text-sm font-black ${meta?.is_current ? 'text-blue-600' : 'text-slate-900'}`}>
                    {meta?.is_current ? t('trainingplans.this_week') : t('trainingplans.week_label', { n: index })}
                </h4>
                <span className="text-xs font-medium text-slate-400 tabular-nums">{shortDate(weekStart)} – {shortDate(end)}</span>
                <select
                    value={phase || ''}
                    onChange={(e) => onPhase(weekStart, e.target.value || null)}
                    className={`py-0.5 pl-2 pr-6 rounded-full text-[11px] font-bold uppercase border-0 bg-[length:1rem] bg-[right_0.25rem_center] focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer ${phase ? `${PHASE_STYLE[phase].text} ${PHASE_STYLE[phase].wash}` : 'text-slate-400 bg-transparent hover:bg-slate-100'}`}
                    title={t('trainingplans.phase_set')}
                >
                    <option value="">{t('trainingplans.phase_none')}</option>
                    {PLAN_PHASES.map((p) => <option key={p} value={p}>{t(`trainingplans.phase_${p}`)}</option>)}
                </select>
            </div>
            <div className="flex items-center gap-2">
                {meta && meta.planned_km > 0 && (
                    <span className="text-xs font-bold text-slate-600 tabular-nums">
                        {meta.is_current && meta.actual_km != null ? `${meta.actual_km} / ` : ''}{meta.planned_km} km
                    </span>
                )}
                {load?.planned > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-xs font-bold text-slate-500 tabular-nums" title={t('trainingplans.load_hint')}>
                        <BoltIcon className="w-3 h-3" />
                        {meta?.is_current && load.actual != null ? `${load.actual} / ` : ''}{load.planned}
                    </span>
                )}
                {sendable > 0 && (
                    <button
                        type="button"
                        onClick={() => onSendWeek(weekStart)}
                        disabled={sending}
                        className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-xs font-bold text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 ${sending ? 'animate-pulse' : ''}`}
                        title={t('trainingplans.send_week_hint', { n: sendable })}
                    >
                        <PaperAirplaneIcon className="w-3.5 h-3.5" />
                        {sending ? t('trainingplans.sending') : t('trainingplans.send_week', { n: sendable })}
                    </button>
                )}
                {meta?.ramp_warning && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700" title={t('trainingplans.ramp_hint')}>
                        <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                        +{meta.ramp_pct}%
                    </span>
                )}
                <button
                    type="button"
                    onClick={() => onDuplicate(weekStart)}
                    className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title={t('trainingplans.duplicate_week')}
                >
                    <DocumentDuplicateIcon className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
};

/** Anillo de progreso para el hero oscuro: la cifra en el centro, la etiqueta debajo. */
const Ring = ({ pct, color = '#60a5fa', size = 76, children, label, sub }) => {
    const r = (size - 8) / 2;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, pct ?? 0));
    return (
        <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="-rotate-90">
                    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
                    {pct != null && (
                        <circle
                            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
                            strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)}
                            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
                        />
                    )}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-base font-black tabular-nums tracking-tight">{children}</div>
            </div>
            <div className="min-w-0">
                <p className="text-label font-bold uppercase text-white/50">{label}</p>
                {sub && <p className="text-xs font-semibold text-white/80 mt-0.5 truncate">{sub}</p>}
            </div>
        </div>
    );
};

// Fases sobre fondo oscuro: más luminosas que en la gráfica clara para que se lean.
const PHASE_DARK = {
    base: 'bg-indigo-300/70', build: 'bg-indigo-400', peak: 'bg-violet-400', taper: 'bg-cyan-400', recovery: 'bg-slate-400/60',
};

/**
 * Línea del bloque completo: un tramo por semana coloreado por fase, lo ya
 * recorrido opaco y lo que falta atenuado, con un marcador en la semana actual
 * y la bandera de meta al final si hay carrera.
 */
const PlanTimeline = ({ weeks, phases, hasRace, t }) => {
    if (!weeks.length) return null;
    const current = weeks.findIndex((w) => w.is_current);
    return (
        <div>
            <div className="flex items-center gap-1">
                {weeks.map((w, i) => {
                    const p = phases[w.week_start];
                    const prev = phases[weeks[i - 1]?.week_start];
                    const ahead = current >= 0 ? i > current : false;
                    return (
                        <div key={w.week_start} className="relative flex-1 min-w-0" title={`${t('trainingplans.week_label', { n: i + 1 })}${p ? ` · ${t(`trainingplans.phase_${p}`)}` : ''}`}>
                            <span className="block h-4 text-[10px] font-bold uppercase text-white/60 truncate">
                                {p && p !== prev ? t(`trainingplans.phase_${p}`) : ''}
                            </span>
                            <div className={`h-2 rounded-full ${p ? PHASE_DARK[p] : 'bg-white/20'} ${ahead ? 'opacity-40' : ''}`} />
                            {i === current && (
                                <span className="absolute left-1/2 -translate-x-1/2 top-[1.15rem] w-3.5 h-3.5 rounded-full bg-white ring-4 ring-white/20 shadow" aria-hidden />
                            )}
                        </div>
                    );
                })}
                {hasRace && <FlagIcon className="w-4 h-4 text-cyan-300 shrink-0 mt-4 ml-1" />}
            </div>
        </div>
    );
};

/**
 * La semana de un vistazo: siete columnas con una barra por día, alta según los
 * km planificados (escala común a todo el plan) y del color de su categoría.
 * Hecho = barra llena con check; pasado sin hacer = contorno rojo; descanso = punto.
 */
const WeekStrip = ({ weekStart, byDate, maxKm, todayISO, onEdit }) => (
    <div className="grid grid-cols-7 gap-1.5 sm:gap-2 px-4 pt-3 pb-2.5 border-b border-slate-100">
        {Array.from({ length: 7 }, (_, d) => {
            const date = addDaysISO(weekStart, d);
            const items = (byDate.get(date) || []).filter((w) => !isRest(w));
            const main = items[0];
            const km = items.reduce((s, w) => s + (Number(w.distance_km) || 0), 0);
            const accent = main ? (CATEGORY_STYLE[workoutCategory(main)] || CATEGORY_STYLE.easy) : null;
            const done = main && items.every((w) => w.status === 'done');
            const missed = main && !done && date < todayISO && items.some((w) => (w.status || 'planned') === 'planned');
            const isToday = date === todayISO;
            return (
                <button
                    key={date}
                    type="button"
                    disabled={!main}
                    onClick={() => main && onEdit(main)}
                    className="group/day flex flex-col items-center gap-1 min-w-0 disabled:cursor-default"
                    title={main ? `${main.type}${km ? ` · ${km} km` : ''}` : undefined}
                >
                    <div className="relative h-12 w-full flex items-end justify-center">
                        {main ? (
                            <div
                                className={`relative w-full max-w-[2.25rem] rounded-md transition-transform group-hover/day:-translate-y-0.5 ${
                                    missed ? 'border-2 border-rose-300 bg-rose-50' : accent.bar
                                } ${!done && !missed && date >= todayISO ? 'opacity-80' : ''}`}
                                style={{ height: `${Math.max(22, (km / maxKm) * 100)}%` }}
                            >
                                {done && <CheckCircleIcon className="absolute top-0.5 left-1/2 -translate-x-1/2 w-3.5 h-3.5 text-white" />}
                                {km > 0 && (
                                    <span className={`absolute -top-4 inset-x-0 text-center text-[10px] font-bold tabular-nums ${missed ? 'text-rose-500' : 'text-slate-600'}`}>
                                        {Math.round(km)}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-200 mb-1" />
                        )}
                    </div>
                    <span className={`text-[10px] font-bold uppercase leading-none ${
                        isToday ? 'px-1.5 py-0.5 rounded-full bg-blue-600 text-white' : 'text-slate-400'
                    }`}>
                        {weekdayShort(date)}
                    </span>
                </button>
            );
        })}
    </div>
);

const ADHERENCE_DOT = {
    done: 'bg-emerald-500',
    skipped: 'bg-slate-300',
    planned: 'bg-rose-400', // ya pasó y sigue pendiente: no consta que se hiciera
};

const TrainingPlans = ({ activities = [], onOpenActivity }) => {
    const { t } = useTranslation();
    const [plans, setPlans] = useState(getTrainingPlans);
    const [selectedPlanId, setSelectedPlanId] = useState(() => getTrainingPlans()[0]?.id || null);
    const [showPast, setShowPast] = useState(false);
    const [editingWorkout, setEditingWorkout] = useState(null); // 'new' | workout | null
    const [newPlanName, setNewPlanName] = useState('');
    const [addingPlan, setAddingPlan] = useState(false);
    const [toast, setToast] = useState(null); // { msg, tone: 'ok' | 'warn' | 'error' }
    const [view, setView] = useState(readView);
    const [showAllWeeks, setShowAllWeeks] = useState(false);
    const [sendingWeek, setSendingWeek] = useState(null);
    const toastTimer = useRef(null);

    const showToast = useCallback((msg, tone = 'ok') => {
        setToast({ msg, tone });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3500);
    }, []);
    useEffect(() => () => clearTimeout(toastTimer.current), []);

    const changeView = (v) => { setView(v); writeView(v); };

    useEffect(() => {
        const reload = () => {
            const list = getTrainingPlans();
            setPlans(list);
            setSelectedPlanId((prev) => (list.some((p) => p.id === prev) ? prev : (list[0]?.id || null)));
        };
        window.addEventListener(TRAINING_PLANS_EVENT, reload);
        return () => window.removeEventListener(TRAINING_PLANS_EVENT, reload);
    }, []);

    const todayISO = toISODate(new Date());
    const byDay = useMemo(() => runsByDay(activities), [activities]);
    const selectedPlan = plans.find((p) => p.id === selectedPlanId) || null;
    const targetRaces = getTargetRaces();
    const linkedRace = selectedPlan?.raceId ? targetRaces.find((r) => r.id === selectedPlan.raceId) : null;
    const raceDays = linkedRace?.date ? daysUntil(linkedRace.date) : null;
    const finalStretch = raceDays != null && raceDays >= 0 && raceDays <= 21;
    const weeks = useMemo(() => weeklyVolume(selectedPlan, byDay, todayISO), [selectedPlan, byDay, todayISO]);

    const { upcoming, past } = useMemo(() => {
        const workouts = selectedPlan?.workouts || [];
        const up = [], pa = [];
        for (const w of workouts) ((w.date || '') < todayISO ? pa : up).push(w);
        pa.reverse();
        return { upcoming: up, past: pa };
    }, [selectedPlan, todayISO]);

    // La siguiente sesión que no sea descanso se destaca (la de hoy aunque ya esté
    // hecha, para ver el plan frente a lo corrido); el resto se agrupa por semana.
    // Para la tira semanal: entrenos por fecha y el día más largo del plan (escala común).
    const { workoutsByDate, maxDayKm } = useMemo(() => {
        const m = new Map();
        for (const w of selectedPlan?.workouts || []) if (w.date) { if (!m.has(w.date)) m.set(w.date, []); m.get(w.date).push(w); }
        let max = 1;
        for (const list of m.values()) max = Math.max(max, list.reduce((s, w) => s + (Number(w.distance_km) || 0), 0));
        return { workoutsByDate: m, maxDayKm: max };
    }, [selectedPlan]);

    const nextUp = upcoming.find((w) => w.date && !isRest(w) && (w.status !== 'done' || w.date === todayISO)) || null;
    const phases = useMemo(() => selectedPlan?.weekPhases || {}, [selectedPlan]);
    const extras = useMemo(() => unplannedRuns(selectedPlan, byDay, todayISO), [selectedPlan, byDay, todayISO]);
    const warnings = useMemo(
        () => planWarnings(selectedPlan?.workouts || [], weeks, todayISO),
        [selectedPlan, weeks, todayISO],
    );

    // Reparto por intensidad de lo planificado en cada semana (sin descansos ni saltados).
    const weekMixes = useMemo(() => {
        const out = {};
        const workouts = (selectedPlan?.workouts || []).filter((w) => w.date && w.status !== 'skipped');
        for (const wk of weeks) {
            const end = addDaysISO(wk.week_start, 6);
            out[wk.week_start] = weekIntensityMix(workouts.filter((w) => w.date >= wk.week_start && w.date <= end));
        }
        return out;
    }, [selectedPlan, weeks]);

    // Carga por semana: estimada para lo planificado y medida (FC/ritmo) para lo corrido.
    const loadParams = useMemo(() => (activities.length ? buildLoadParams(activities) : null), [activities]);
    const weekLoads = useMemo(() => {
        const out = {};
        const workouts = selectedPlan?.workouts || [];
        for (const wk of weeks) {
            const end = addDaysISO(wk.week_start, 6);
            const planned = plannedLoad(workouts.filter((w) => w.date >= wk.week_start && w.date <= end));
            let actual = null;
            if (loadParams && wk.week_start <= todayISO) {
                actual = 0;
                for (let d = 0; d < 7; d++) {
                    for (const a of byDay.get(addDaysISO(wk.week_start, d)) || []) actual += sessionLoad(a, loadParams).load;
                }
                actual = Math.round(actual);
            }
            out[wk.week_start] = { planned, actual };
        }
        return out;
    }, [selectedPlan, weeks, byDay, loadParams, todayISO]);

    // Sesiones de una semana que se pueden mandar al reloj: con estructura, de hoy en
    // adelante y que no estén ya en el reloj para esa misma fecha.
    const sendableIn = useCallback((weekStart) => {
        const end = addDaysISO(weekStart, 6);
        return (selectedPlan?.workouts || []).filter((w) => w.date >= todayISO && w.date >= weekStart && w.date <= end
            && Array.isArray(w.structured_workout) && w.structured_workout.length > 0
            && w.status !== 'done' && w.status !== 'skipped'
            && !(w.garmin_workout_id && w.garmin_date === w.date));
    }, [selectedPlan, todayISO]);

    // Atajos: N = nuevo entreno, ←/→ = plan anterior/siguiente. No actúan mientras se escribe.
    useEffect(() => {
        const onKey = (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const el = e.target;
            if (el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName)) return;
            if ((e.key === 'n' || e.key === 'N') && selectedPlanId) {
                e.preventDefault();
                setEditingWorkout('new');
            } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && plans.length > 1) {
                const i = plans.findIndex((p) => p.id === selectedPlanId);
                const next = plans[(i + (e.key === 'ArrowRight' ? 1 : -1) + plans.length) % plans.length];
                setSelectedPlanId(next.id);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [plans, selectedPlanId]);
    const upcomingByWeek = useMemo(() => {
        const groups = [];
        for (const w of upcoming) {
            if (w === nextUp) continue;
            const ws = w.date ? mondayOf(w.date) : '';
            let g = groups[groups.length - 1];
            if (!g || g.week_start !== ws) { g = { week_start: ws, items: [] }; groups.push(g); }
            g.items.push(w);
        }
        return groups;
    }, [upcoming, nextUp]);

    const stats = useMemo(() => {
        const pastSessions = past.filter((w) => !isRest(w));
        const done = pastSessions.filter((w) => w.status === 'done').length;
        const toDate = weeks.filter((w) => w.week_start <= todayISO);
        const kmRun = toDate.reduce((s, w) => s + (w.actual_km || 0), 0);
        const kmPlanned = toDate.reduce((s, w) => s + w.planned_km, 0);
        const kmTotal = weeks.reduce((s, w) => s + w.planned_km, 0);
        const currentWeek = weeks.findIndex((w) => w.is_current) + 1;
        return {
            done, pastTotal: pastSessions.length,
            adherence: pastSessions.length ? Math.round((done / pastSessions.length) * 100) : null,
            kmRun: Math.round(kmRun), kmPlanned: Math.round(kmPlanned), kmTotal: Math.round(kmTotal),
            currentWeek, totalWeeks: weeks.length,
            // Historial en orden cronológico para la tira de puntos.
            strip: [...pastSessions].reverse(),
        };
    }, [past, weeks, todayISO]);

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
        saveWorkout(selectedPlan.id, {
            id: workout.id,
            status: workout.status === 'done' ? 'planned' : 'done',
            status_manual: true,
        });
    }, [selectedPlan]);

    const handleMove = useCallback((workout, date) => {
        if (!selectedPlan || date === workout.date) return;
        saveWorkout(selectedPlan.id, { id: workout.id, date });
        // En el reloj sigue en la fecha vieja hasta que se reenvíe.
        showToast(
            workout.garmin_workout_id
                ? t('trainingplans.moved_resend', { date: shortDate(date) })
                : t('trainingplans.moved', { date: shortDate(date) }),
            workout.garmin_workout_id ? 'warn' : 'ok',
        );
    }, [selectedPlan, showToast, t]);

    const handleSetPhase = useCallback((weekStart, phase) => {
        if (!selectedPlan) return;
        const next = { ...(selectedPlan.weekPhases || {}) };
        if (phase) next[weekStart] = phase; else delete next[weekStart];
        saveTrainingPlan({ id: selectedPlan.id, weekPhases: next });
    }, [selectedPlan]);

    // Reenviar = borrar el que había en Garmin y crear el nuevo en su fecha actual:
    // así mover un entreno o editarlo no deja duplicados en el reloj.
    const pushToWatch = useCallback(async (workout) => {
        if (!selectedPlan) return;
        if (workout.garmin_workout_id) {
            try { await deleteGarminWorkout(workout.garmin_workout_id); } catch { /* ya no existía en Garmin */ }
        }
        const { results } = await pushPlanDays([workout]);
        const r = results?.[0];
        if (!r?.ok) {
            saveWorkout(selectedPlan.id, { id: workout.id, garmin_workout_id: undefined, garmin_date: undefined });
            throw new Error(r?.error || t('trainingplans.send_error'));
        }
        saveWorkout(selectedPlan.id, {
            id: workout.id,
            garmin_workout_id: r.workout_id,
            garmin_date: r.scheduled ? r.date : undefined,
        });
    }, [selectedPlan, t]);

    const handleSendToWatch = useCallback(async (workout) => {
        try {
            await pushToWatch(workout);
            showToast(t('trainingplans.sent_ok', { type: workout.type, date: shortDate(workout.date) }));
        } catch (e) {
            showToast(e.message, 'error');
            throw e;
        }
    }, [pushToWatch, showToast, t]);

    // Uno a uno: el reenvío borra antes el anterior y Garmin no agradece ráfagas.
    const handleSendWeek = useCallback(async (weekStart) => {
        const items = sendableIn(weekStart);
        if (!items.length) return;
        setSendingWeek(weekStart);
        let ok = 0;
        for (const w of items) {
            try { await pushToWatch(w); ok++; } catch { /* se cuenta abajo */ }
        }
        setSendingWeek(null);
        showToast(
            ok === items.length ? t('trainingplans.sent_week_ok', { n: ok }) : t('trainingplans.sent_week_partial', { ok, n: items.length }),
            ok === items.length ? 'ok' : 'error',
        );
    }, [sendableIn, pushToWatch, showToast, t]);

    const handleDuplicateWeek = useCallback((weekStart) => {
        if (!selectedPlan) return;
        const n = duplicateWeek(selectedPlan.id, weekStart);
        showToast(n ? t('trainingplans.duplicated', { n }) : t('trainingplans.nothing_to_duplicate'), n ? 'ok' : 'warn');
    }, [selectedPlan, showToast, t]);

    const renderRow = (w, variant) => (
        <WorkoutRow
            key={w.id}
            workout={w}
            variant={variant}
            todayISO={todayISO}
            actual={w.date <= todayISO ? workoutActual(w, byDay) : null}
            isPast={w.date < todayISO}
            onEdit={setEditingWorkout}
            onDelete={handleDeleteWorkout}
            onToggleDone={handleToggleDone}
            onMove={handleMove}
            onSendToWatch={handleSendToWatch}
            onOpenActivity={onOpenActivity}
            t={t}
        />
    );

    const weekIndex = (ws) => weeks.findIndex((w) => w.week_start === ws) + 1;

    // Historial: entrenos pasados y carreras fuera de plan, del más reciente al más antiguo.
    const pastItems = [
        ...past.map((w) => ({ date: w.date || '', workout: w })),
        ...extras.map((r) => ({ date: r.date, run: r, extra: true })),
    ].sort((a, b) => b.date.localeCompare(a.date));

    return (
        <div className="space-y-6 max-w-5xl mx-auto fade-in">
            {/* Cabecera de sección + selector de plan */}
            <div className="flex flex-wrap items-end justify-between gap-4 px-1">
                <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none uppercase">{t('trainingplans.title')}</h2>
                    <p className="text-slate-500 text-sm font-medium mt-1.5">{t('trainingplans.subtitle')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {plans.length > 0 && (
                        <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 gap-0.5" role="tablist">
                            {plans.map((p) => (
                                <button
                                    key={p.id}
                                    role="tab"
                                    aria-selected={selectedPlanId === p.id}
                                    onClick={() => setSelectedPlanId(p.id)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${selectedPlanId === p.id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                                >
                                    {p.name || t('trainingplans.untitled')}
                                    <span className="ml-1.5 opacity-60 tabular-nums">{(p.workouts || []).length}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {!addingPlan ? (
                        <button
                            onClick={() => setAddingPlan(true)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-dashed border-slate-300 text-slate-500 hover:border-blue-300 hover:text-blue-600 transition-all"
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
                                className="px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                            <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700">
                                {t('trainingplans.add')}
                            </button>
                            <button type="button" onClick={() => { setAddingPlan(false); setNewPlanName(''); }} className="p-1.5 text-slate-400 hover:text-slate-600">
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
                <>
                    {/* Hero del plan: nombre, carrera, progreso en anillos y la línea de fases. */}
                    <div className="relative overflow-hidden rounded-3xl bg-slate-900 text-white shadow-lg">
                        <div className="pointer-events-none absolute -top-24 -right-16 w-80 h-80 rounded-full bg-blue-600/30 blur-3xl" aria-hidden />
                        <div className="pointer-events-none absolute -bottom-32 -left-10 w-72 h-72 rounded-full bg-indigo-500/20 blur-3xl" aria-hidden />
                        <div className="relative p-6 sm:p-8 space-y-7">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1">
                                        <h3 className="text-2xl sm:text-3xl font-black tracking-tight truncate">{selectedPlan.name || t('trainingplans.untitled')}</h3>
                                        <button onClick={() => renamePlan(selectedPlan)} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors" title={t('trainingplans.rename')}>
                                            <PencilSquareIcon className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => removePlan(selectedPlan)} className="p-1.5 rounded-lg text-white/40 hover:text-rose-300 hover:bg-white/10 transition-colors" title={t('trainingplans.delete_plan')}>
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="inline-flex items-center gap-1.5 mt-1.5 pl-2.5 rounded-full bg-white/10 hover:bg-white/15 transition-colors">
                                        <FlagIcon className="w-3.5 h-3.5 text-cyan-300" />
                                        <select
                                            value={linkedRace ? linkedRace.id : ''}
                                            onChange={(e) => saveTrainingPlan({ id: selectedPlan.id, raceId: e.target.value || null })}
                                            className="py-1 pr-7 pl-0 text-xs font-semibold bg-transparent border-0 text-white/90 focus:outline-none focus:ring-0 cursor-pointer [&>option]:text-slate-900"
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
                                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-slate-900 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-50 shadow-sm transition-all"
                                        title={t('trainingplans.shortcuts_hint')}
                                    >
                                        <PlusIcon className="w-4 h-4" />
                                        {t('trainingplans.add_workout')}
                                    </button>
                                )}
                            </div>

                            {weeks.length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] gap-6 items-center">
                                    <Ring
                                        pct={stats.currentWeek > 0 ? (stats.currentWeek / stats.totalWeeks) * 100 : 0}
                                        color="#60a5fa"
                                        label={t('trainingplans.kpi_week')}
                                        sub={stats.currentWeek > 0 ? t('trainingplans.kpi_week_sub') : t('trainingplans.kpi_weeks_sub')}
                                    >
                                        {stats.currentWeek > 0 ? <span>{stats.currentWeek}<span className="text-white/40 text-xs">/{stats.totalWeeks}</span></span> : stats.totalWeeks}
                                    </Ring>
                                    <Ring
                                        pct={stats.adherence}
                                        color={stats.adherence == null ? undefined : stats.adherence >= 80 ? '#34d399' : stats.adherence >= 60 ? '#fbbf24' : '#fb7185'}
                                        label={t('trainingplans.kpi_adherence')}
                                        sub={t('trainingplans.kpi_adherence_sub', { done: stats.done, total: stats.pastTotal })}
                                    >
                                        {stats.adherence != null ? `${stats.adherence}%` : '—'}
                                    </Ring>
                                    <Ring
                                        pct={stats.kmTotal > 0 ? (stats.kmRun / stats.kmTotal) * 100 : null}
                                        color="#a78bfa"
                                        label={t('trainingplans.kpi_volume')}
                                        sub={`${stats.kmRun} / ${stats.kmPlanned} km · ${t('trainingplans.kpi_volume_sub', { n: stats.kmTotal })}`}
                                    >
                                        <span>{stats.kmRun}<span className="text-white/40 text-xs">km</span></span>
                                    </Ring>
                                    {/* Cuenta atrás: en la recta final (≤ 21 días) se enciende en cian. */}
                                    <div className={`rounded-2xl px-5 py-4 text-center sm:col-span-2 lg:col-span-1 ${finalStretch ? 'bg-cyan-400 text-slate-900' : 'bg-white/10'}`}>
                                        <p className={`text-label font-bold uppercase ${finalStretch ? 'text-slate-900/70' : 'text-white/50'}`}>
                                            {raceDays === 0 ? t('trainingplans.race_day') : finalStretch ? t('trainingplans.final_stretch') : (linkedRace?.name || t('trainingplans.kpi_race'))}
                                        </p>
                                        <p className="text-4xl font-black tabular-nums tracking-tight leading-none mt-1.5">
                                            {raceDays != null && raceDays >= 0 ? (raceDays === 0 ? t('trainingplans.today') : raceDays) : '—'}
                                        </p>
                                        <p className="text-xs font-semibold mt-1 opacity-70">
                                            {raceDays != null && raceDays > 0
                                                ? t('trainingplans.days_to_go')
                                                : linkedRace ? '' : t('trainingplans.no_race')}
                                            {linkedRace?.date && raceDays > 0 ? ` · ${parseISO(linkedRace.date).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}` : ''}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {weeks.length > 0 && <PlanTimeline weeks={weeks} phases={phases} hasRace={!!linkedRace} t={t} />}
                        </div>
                    </div>

                    {weeks.length > 0 && (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                            <WeeklyVolume weeks={weeks} mixes={weekMixes} t={t} />
                        </div>
                    )}

                    {warnings.length > 0 && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4">
                            <p className="inline-flex items-center gap-1.5 text-label font-bold uppercase text-amber-800">
                                <ExclamationTriangleIcon className="w-4 h-4" />
                                {t('trainingplans.review_title', { n: warnings.length })}
                            </p>
                            <ul className="mt-2 space-y-1">
                                {warnings.map((w) => (
                                    <li key={`${w.type}-${w.week_start || w.dates?.join('-')}`} className="text-sm text-amber-900">
                                        {w.type === 'hard_back_to_back' && t('trainingplans.warn_hard', { a: shortDate(w.dates[0]), b: shortDate(w.dates[1]) })}
                                        {w.type === 'no_long' && t('trainingplans.warn_no_long', { week: weekIndex(w.week_start), date: shortDate(w.week_start) })}
                                        {w.type === 'ramp_streak' && t('trainingplans.warn_ramp', { week: weekIndex(w.week_start) })}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-3 px-1">
                        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist">
                            {[['list', ListBulletIcon], ['calendar', TableCellsIcon]].map(([v, Icon]) => (
                                <button
                                    key={v}
                                    role="tab"
                                    aria-selected={view === v}
                                    onClick={() => changeView(v)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${view === v ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    <Icon className="w-3.5 h-3.5" />
                                    {t(`trainingplans.view_${v}`)}
                                </button>
                            ))}
                        </div>
                        <span className="hidden sm:inline text-xs font-medium text-slate-400">{t('trainingplans.shortcuts_hint')}</span>
                    </div>

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
                    ) : view === 'calendar' ? (
                        <PlanCalendar
                            weeks={weeks}
                            workouts={selectedPlan.workouts || []}
                            extras={extras}
                            phases={phases}
                            todayISO={todayISO}
                            showAllWeeks={showAllWeeks}
                            onToggleAll={() => setShowAllWeeks((v) => !v)}
                            onMove={handleMove}
                            onEdit={setEditingWorkout}
                            t={t}
                        />
                    ) : (
                        <div className="space-y-6">
                            {nextUp && renderRow(nextUp, 'featured')}

                            {upcomingByWeek.map((g) => (
                                <section
                                    key={g.week_start || 'nodate'}
                                    className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
                                        weeks.find((w) => w.week_start === g.week_start)?.is_current ? 'border-blue-200' : 'border-slate-100'
                                    }`}
                                >
                                    {g.week_start && (
                                        <WeekHeader
                                            index={weekIndex(g.week_start)}
                                            weekStart={g.week_start}
                                            meta={weeks.find((w) => w.week_start === g.week_start)}
                                            phase={phases[g.week_start]}
                                            load={weekLoads[g.week_start]}
                                            sendable={sendableIn(g.week_start).length}
                                            sending={sendingWeek === g.week_start}
                                            onPhase={handleSetPhase}
                                            onSendWeek={handleSendWeek}
                                            onDuplicate={handleDuplicateWeek}
                                            t={t}
                                        />
                                    )}
                                    {g.week_start && (
                                        <WeekStrip weekStart={g.week_start} byDate={workoutsByDate} maxKm={maxDayKm} todayISO={todayISO} onEdit={setEditingWorkout} />
                                    )}
                                    <div className="divide-y divide-slate-100">{g.items.map((w) => renderRow(w, 'default'))}</div>
                                </section>
                            ))}

                            {(past.length > 0 || extras.length > 0) && (
                                <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                                    <button
                                        onClick={() => setShowPast((v) => !v)}
                                        className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left"
                                        aria-expanded={showPast}
                                    >
                                        <span className="text-label font-bold uppercase text-slate-500">{t('trainingplans.history')}</span>
                                        <span className="text-xs font-semibold text-slate-600 tabular-nums">
                                            {t('trainingplans.kpi_adherence_sub', { done: stats.done, total: stats.pastTotal })}
                                        </span>
                                        {stats.strip.length > 0 && (
                                            <span className="flex flex-wrap items-center gap-1 flex-1 min-w-0" aria-hidden>
                                                {stats.strip.map((w) => (
                                                    <span
                                                        key={w.id}
                                                        className={`w-2 h-2 rounded-full ${ADHERENCE_DOT[w.status] || ADHERENCE_DOT.planned}`}
                                                        title={`${w.date ? shortDate(w.date) : ''} · ${w.type} · ${t(`trainingplans.status_${w.status || 'planned'}`)}`}
                                                    />
                                                ))}
                                            </span>
                                        )}
                                        {extras.length > 0 && (
                                            <span className="text-xs font-semibold text-slate-500 tabular-nums">
                                                {t('trainingplans.extra_count', { n: extras.length })}
                                            </span>
                                        )}
                                        <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-slate-500">
                                            {showPast ? t('trainingplans.hide_history') : t('trainingplans.show_history', { n: pastItems.length })}
                                            <ChevronDownIcon className={`w-3 h-3 transition-transform ${showPast ? 'rotate-180' : ''}`} />
                                        </span>
                                    </button>
                                    {showPast && (
                                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                                            {pastItems.map((it) => (it.extra
                                                ? <ExtraRow key={`extra-${it.run.date}`} run={it.run} onOpen={onOpenActivity} t={t} />
                                                : renderRow(it.workout, 'compact')))}
                                        </div>
                                    )}
                                </section>
                            )}
                        </div>
                    )}
                </>
            )}

            {toast && (
                <div
                    role="status"
                    className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm z-50 flex items-start gap-2 rounded-lg px-4 py-3 shadow-lg text-sm font-semibold fade-in ${
                        toast.tone === 'error' ? 'bg-rose-600 text-white' : toast.tone === 'warn' ? 'bg-amber-500 text-slate-900' : 'bg-slate-900 text-white'
                    }`}
                >
                    {toast.tone === 'ok' ? <CheckCircleIcon className="w-4 h-4 shrink-0 mt-0.5" /> : <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />}
                    <span className="flex-1">{toast.msg}</span>
                    <button type="button" onClick={() => setToast(null)} className="opacity-70 hover:opacity-100" aria-label={t('trainingplans.cancel')}>
                        <XMarkIcon className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
};

export default TrainingPlans;
