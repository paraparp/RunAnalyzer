import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CalendarDaysIcon, PlusIcon, TrashIcon, PencilSquareIcon, XMarkIcon,
    ChevronDownIcon, ClockIcon, CheckCircleIcon, ChatBubbleLeftRightIcon, FlagIcon,
    ArrowsRightLeftIcon, PaperAirplaneIcon, DocumentDuplicateIcon, ExclamationTriangleIcon,
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
import WorkoutCard from './WorkoutCard';
import { CATEGORY_STYLE } from '../lib/workoutStyle';

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
const isRest = (w) => workoutCategory(w) === 'rest';

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

    const metrics = [
        workout.distance_km != null ? `${workout.distance_km} km` : null,
        workout.duration_min != null ? `${workout.duration_min} min` : null,
    ].filter(Boolean);

    return (
        <div className={`group relative bg-white border overflow-hidden transition-colors ${
            featured ? 'rounded-xl border-blue-200 shadow-sm' : 'rounded-lg border-slate-100 hover:border-slate-200'
        } ${status === 'skipped' ? 'opacity-60' : ''}`}>
            <span className={`absolute left-0 inset-y-0 ${featured ? 'w-1.5' : 'w-1'} ${accent.bar}`} aria-hidden />
            <div className={`flex items-start gap-4 ${featured ? 'p-5 pl-6' : compact ? 'px-4 py-2.5 pl-5' : 'p-4 pl-5'}`}>
                {workout.date ? (
                    <div className={`shrink-0 text-center ${featured ? 'w-14' : 'w-10'}`}>
                        <p className={`text-label font-bold uppercase leading-none ${isToday ? 'text-blue-600' : 'text-slate-400'}`}>
                            {weekdayShort(workout.date)}
                        </p>
                        <p className={`font-black tabular-nums leading-none mt-1 ${featured ? 'text-3xl' : compact ? 'text-base' : 'text-xl'} ${isToday ? 'text-blue-600' : 'text-slate-900'}`}>
                            {parseISO(workout.date).getDate()}
                        </p>
                        {featured && (
                            <p className="text-label font-bold uppercase text-slate-400 mt-1">
                                {parseISO(workout.date).toLocaleDateString(locale, { month: 'short' }).replace('.', '')}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="shrink-0 w-10 text-center text-slate-400">—</div>
                )}

                <div className="min-w-0 flex-1">
                    {featured && (
                        <p className="text-label font-bold uppercase text-blue-600 mb-1.5">
                            {t('trainingplans.next_up')} · {relativeDay(workout.date, todayISO, t)}
                        </p>
                    )}
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <span className={`font-black text-slate-900 ${featured ? 'text-xl tracking-tight' : 'text-sm'}`}>{workout.type}</span>
                        <span className={`text-[11px] font-mono font-semibold uppercase tracking-wider ${accent.text}`}>{accent.label}</span>
                        {metrics.length > 0 && (
                            <span className={`font-bold text-slate-500 tabular-nums ${featured ? 'text-sm' : 'text-xs'}`}>{metrics.join(' · ')}</span>
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
                    {actual && <ActualLine actual={actual} workout={workout} onOpen={onOpenActivity} t={t} />}
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

/** Cifra grande con etiqueta en versales y una línea de contexto. */
const Kpi = ({ label, value, sub, children }) => (
    <div className="min-w-0">
        <p className="text-label font-bold uppercase text-slate-500">{label}</p>
        <p className="text-2xl font-black text-slate-900 tabular-nums tracking-tight leading-tight mt-1">{value}</p>
        {sub && <p className="text-xs font-medium text-slate-500 mt-0.5">{sub}</p>}
        {children}
    </div>
);

/**
 * Volumen por semana en columnas: lo planificado como columna gris y lo corrido
 * como columna azul más estrecha dentro. La semana actual va resaltada; las
 * pasadas, atenuadas. Las cifras exactas van en el tooltip y en la cabecera de
 * cada semana de la lista, y la subida brusca se marca con un icono.
 */
const WeeklyVolume = ({ weeks, t }) => {
    const max = Math.max(1, ...weeks.map((w) => Math.max(w.planned_km, w.actual_km ?? 0)));
    if (!weeks.some((w) => w.planned_km > 0 || (w.actual_km ?? 0) > 0)) {
        return <p className="text-xs font-medium text-slate-500">{t('trainingplans.no_volume')}</p>;
    }
    const currentIdx = weeks.findIndex((w) => w.is_current);
    return (
        <div>
            <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-label font-bold uppercase text-slate-500">{t('trainingplans.weekly_title')}</p>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-200" />{t('trainingplans.legend_planned')}</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600" />{t('trainingplans.legend_actual')}</span>
                </div>
            </div>
            <div className="flex items-end gap-1 sm:gap-1.5 h-28">
                {weeks.map((w, i) => {
                    const past = currentIdx >= 0 ? i < currentIdx : w.actual_km != null && !w.is_current;
                    return (
                        <div
                            key={w.week_start}
                            className={`relative flex-1 min-w-0 h-full flex items-end justify-center rounded-sm ${w.is_current ? 'bg-blue-50' : ''}`}
                            title={`${t('trainingplans.week_label', { n: i + 1 })} · ${shortDate(w.week_start)}\n${t('trainingplans.week_tooltip', { done: w.done, total: w.sessions, planned: w.planned_km, actual: w.actual_km ?? '—' })}`}
                        >
                            {w.ramp_warning && (
                                <ExclamationTriangleIcon
                                    className="absolute w-3 h-3 text-amber-600"
                                    style={{ bottom: `calc(${(w.planned_km / max) * 100}% + 2px)` }}
                                />
                            )}
                            <div
                                className={`relative w-full max-w-[2.25rem] rounded-t-sm ${past ? 'bg-slate-100' : 'bg-slate-200'}`}
                                style={{ height: `${Math.max(2, (w.planned_km / max) * 100)}%` }}
                            />
                            {w.actual_km != null && w.actual_km > 0 && (
                                <div
                                    className={`absolute bottom-0 w-1/2 max-w-[1.125rem] rounded-t-sm ${past ? 'bg-blue-600/60' : 'bg-blue-600'}`}
                                    style={{ height: `${(w.actual_km / max) * 100}%` }}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="flex gap-1 sm:gap-1.5 mt-1.5">
                {weeks.map((w, i) => (
                    <span
                        key={w.week_start}
                        className={`flex-1 min-w-0 text-center text-[10px] font-bold tabular-nums truncate ${w.is_current ? 'text-blue-600' : 'text-slate-400'}`}
                    >
                        {t('trainingplans.week_short', { n: i + 1 })}
                    </span>
                ))}
            </div>
        </div>
    );
};

/** Cabecera de semana en la lista de próximos: número, rango, km y acciones. */
const WeekHeader = ({ index, weekStart, meta, onDuplicate, t }) => {
    const end = toISODate(new Date(parseISO(weekStart).getTime() + 6 * 86400000));
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2">
            <div className="flex items-baseline gap-2">
                <h4 className={`text-sm font-black ${meta?.is_current ? 'text-blue-600' : 'text-slate-900'}`}>
                    {meta?.is_current ? t('trainingplans.this_week') : t('trainingplans.week_label', { n: index })}
                </h4>
                <span className="text-xs font-medium text-slate-400 tabular-nums">{shortDate(weekStart)} – {shortDate(end)}</span>
            </div>
            <div className="flex items-center gap-2">
                {meta && meta.planned_km > 0 && (
                    <span className="text-xs font-bold text-slate-600 tabular-nums">
                        {meta.is_current && meta.actual_km != null ? `${meta.actual_km} / ` : ''}{meta.planned_km} km
                    </span>
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
    const [notice, setNotice] = useState('');

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
    const weeks = useMemo(() => weeklyVolume(selectedPlan, byDay, todayISO), [selectedPlan, byDay, todayISO]);

    const { upcoming, past } = useMemo(() => {
        const workouts = selectedPlan?.workouts || [];
        const up = [], pa = [];
        for (const w of workouts) ((w.date || '') < todayISO ? pa : up).push(w);
        pa.reverse();
        return { upcoming: up, past: pa };
    }, [selectedPlan, todayISO]);

    // La siguiente sesión que no sea descanso se destaca; el resto se agrupa por semana.
    const nextUp = upcoming.find((w) => w.date && !isRest(w) && w.status !== 'done') || null;
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
    }, [selectedPlan]);

    // Reenviar = borrar el que había en Garmin y crear el nuevo en su fecha actual:
    // así mover un entreno o editarlo no deja duplicados en el reloj.
    const handleSendToWatch = useCallback(async (workout) => {
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

    const handleDuplicateWeek = useCallback((weekStart) => {
        if (!selectedPlan) return;
        const n = duplicateWeek(selectedPlan.id, weekStart);
        setNotice(n ? t('trainingplans.duplicated', { n }) : t('trainingplans.nothing_to_duplicate'));
        setTimeout(() => setNotice(''), 2500);
    }, [selectedPlan, t]);

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

    return (
        <div className="space-y-6 max-w-5xl mx-auto fade-in">
            {/* Cabecera de sección + selector de plan */}
            <div className="flex flex-wrap items-end justify-between gap-4 px-1">
                <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none uppercase">{t('trainingplans.title')}</h2>
                    <p className="text-slate-500 text-sm font-medium mt-1.5">{t('trainingplans.subtitle')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {plans.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => setSelectedPlanId(p.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedPlanId === p.id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'}`}
                        >
                            {p.name || t('trainingplans.untitled')}
                            <span className="ml-1.5 opacity-60 tabular-nums">{(p.workouts || []).length}</span>
                        </button>
                    ))}
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
                    {/* Resumen del plan: nombre, carrera, KPIs y volumen */}
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-0">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1">
                                    <h3 className="text-xl font-black text-slate-900 tracking-tight truncate">{selectedPlan.name || t('trainingplans.untitled')}</h3>
                                    <button onClick={() => renamePlan(selectedPlan)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title={t('trainingplans.rename')}>
                                        <PencilSquareIcon className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => removePlan(selectedPlan)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title={t('trainingplans.delete_plan')}>
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="inline-flex items-center gap-1.5 mt-1">
                                    <FlagIcon className="w-3.5 h-3.5 text-slate-400" />
                                    <select
                                        value={linkedRace ? linkedRace.id : ''}
                                        onChange={(e) => saveTrainingPlan({ id: selectedPlan.id, raceId: e.target.value || null })}
                                        className="py-0.5 pr-6 pl-0 text-xs font-semibold bg-transparent border-0 text-slate-500 hover:text-slate-700 focus:outline-none focus:ring-0 cursor-pointer"
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
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                    {t('trainingplans.add_workout')}
                                </button>
                            )}
                        </div>

                        {weeks.length > 0 && (
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5 p-6">
                                <Kpi
                                    label={t('trainingplans.kpi_week')}
                                    value={stats.currentWeek > 0 ? `${stats.currentWeek}/${stats.totalWeeks}` : `${stats.totalWeeks}`}
                                    sub={stats.currentWeek > 0 ? t('trainingplans.kpi_week_sub') : t('trainingplans.kpi_weeks_sub')}
                                >
                                    {stats.currentWeek > 0 && (
                                        <div className="mt-2 h-1 rounded-full bg-slate-100 overflow-hidden">
                                            <div className="h-full bg-blue-600" style={{ width: `${(stats.currentWeek / stats.totalWeeks) * 100}%` }} />
                                        </div>
                                    )}
                                </Kpi>
                                <Kpi
                                    label={t('trainingplans.kpi_adherence')}
                                    value={stats.adherence != null ? `${stats.adherence}%` : '—'}
                                    sub={t('trainingplans.kpi_adherence_sub', { done: stats.done, total: stats.pastTotal })}
                                />
                                <Kpi
                                    label={t('trainingplans.kpi_volume')}
                                    value={<>{stats.kmRun}<span className="text-sm font-bold text-slate-400"> / {stats.kmPlanned} km</span></>}
                                    sub={t('trainingplans.kpi_volume_sub', { n: stats.kmTotal })}
                                />
                                <Kpi
                                    label={linkedRace ? linkedRace.name : t('trainingplans.kpi_race')}
                                    value={raceDays != null && raceDays >= 0 ? t('trainingplans.kpi_days', { n: raceDays }) : '—'}
                                    sub={linkedRace?.date ? parseISO(linkedRace.date).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : t('trainingplans.no_race')}
                                />
                            </div>
                        )}

                        {weeks.length > 0 && (
                            <div className="border-t border-slate-100 p-6">
                                <WeeklyVolume weeks={weeks} t={t} />
                            </div>
                        )}
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
                    ) : (
                        <div className="space-y-6">
                            {nextUp && renderRow(nextUp, 'featured')}

                            {notice && <p className="text-xs font-semibold text-emerald-600 px-1">{notice}</p>}

                            {upcomingByWeek.map((g) => (
                                <section key={g.week_start || 'nodate'} className="space-y-2">
                                    {g.week_start && (
                                        <WeekHeader
                                            index={weekIndex(g.week_start)}
                                            weekStart={g.week_start}
                                            meta={weeks.find((w) => w.week_start === g.week_start)}
                                            onDuplicate={handleDuplicateWeek}
                                            t={t}
                                        />
                                    )}
                                    <div className="space-y-2">{g.items.map((w) => renderRow(w, 'default'))}</div>
                                </section>
                            ))}

                            {past.length > 0 && (
                                <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
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
                                        <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-slate-500">
                                            {showPast ? t('trainingplans.hide_history') : t('trainingplans.show_history', { n: past.length })}
                                            <ChevronDownIcon className={`w-3 h-3 transition-transform ${showPast ? 'rotate-180' : ''}`} />
                                        </span>
                                    </button>
                                    {showPast && (
                                        <div className="space-y-1.5 px-4 pb-4">{past.map((w) => renderRow(w, 'compact'))}</div>
                                    )}
                                </section>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default TrainingPlans;
