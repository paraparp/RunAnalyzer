import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Select, SelectItem } from "@tremor/react";
import {
    FlagIcon, PencilSquareIcon, TrashIcon,
    DocumentTextIcon, ChevronDownIcon, PlusIcon, XMarkIcon,
    ArrowsPointingOutIcon, ArrowsPointingInIcon, ClipboardDocumentIcon, CheckIcon, ListBulletIcon, StarIcon, TrophyIcon,
    LinkIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";
import {
    getTargetRaces, saveTargetRace, deleteTargetRace, setPrimaryTargetRace, getPrimaryTargetRace,
    parseTimeToMinutes, formatMinutes, daysUntil, DISTANCES, TARGET_RACES_EVENT, normalizeStartTime,
} from '../lib/targetRaces';
import { detectPlanFormat, isRenderable } from '../lib/planFormat';
import { raceResult } from '../lib/raceResults';
import MarkdownText from './MarkdownText';
import HtmlDocument from './HtmlDocument';
import RaceCalendar from './RaceCalendar';

const EMPTY_FORM = { name: '', date: '', startTime: '', distance: '21k', time: '', pace: '', plan: '' };

// Tiempo total y ritmo medio son la misma información vista de dos maneras: se
// rellena uno y se deriva el otro con la distancia oficial de la prueba, para no
// obligar a hacer la cuenta a mano ("¿a cuánto tengo que ir para bajar de 1h40?").
const paceFromTime = (time, distance) => {
    const min = parseTimeToMinutes(time);
    const km = DISTANCES[distance];
    if (min == null || !km) return '';
    return formatMinutes(min / km);
};

const timeFromPace = (pace, distance) => {
    const min = parseTimeToMinutes(pace);
    const km = DISTANCES[distance];
    if (min == null || !km) return '';
    return formatMinutes(min * km);
};

const DISTANCE_STYLE = {
    '5k': 'bg-sky-50 text-sky-600 ring-sky-100',
    '10k': 'bg-blue-50 text-blue-600 ring-blue-100',
    '21k': 'bg-violet-50 text-violet-600 ring-violet-100',
    '42k': 'bg-rose-50 text-rose-600 ring-rose-100',
};

// ── Piezas compartidas ──────────────────────────────────────────────────────

const Chip = ({ className = '', children }) => (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ring-1 ring-inset ${className}`}>
        {children}
    </span>
);

/** Conmutador formateado / plano. Solo se muestra si el formato es renderizable. */
const ViewToggle = ({ raw, onChange, t }) => (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {[false, true].map((mode) => (
            <button
                key={String(mode)}
                type="button"
                onClick={() => onChange(mode)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-colors ${raw === mode ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                {mode ? t('targets.view_raw') : t('targets.view_rendered')}
            </button>
        ))}
    </div>
);

/** Cuerpo del plan: renderizado según el formato detectado, o en crudo. */
const PlanBody = ({ plan, format, raw, frameHeight = '26rem', autoHeight = true }) => {
    if (raw) {
        return (
            <pre className="text-[11px] leading-relaxed text-slate-600 font-mono whitespace-pre-wrap break-words">{plan}</pre>
        );
    }
    return format === 'html'
        ? <HtmlDocument html={plan} height={frameHeight} autoHeight={autoHeight} />
        : <MarkdownText content={plan} />;
};

/** "Actualizado <fecha>" del plan, o null si nunca se ha sellado (planes antiguos). */
const planUpdatedLabel = (race, t) => {
    const d = race.planUpdatedAt ? new Date(race.planUpdatedAt) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    return t('targets.plan_updated', { when: d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) });
};

const CopyButton = ({ text, t, label, doneLabel, idleIcon }) => {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        }).catch(() => { /* portapapeles no disponible */ });
    };
    return (
        <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
        >
            {copied ? <CheckIcon className="w-3 h-3" /> : (idleIcon || <ClipboardDocumentIcon className="w-3 h-3" />)}
            {copied ? (doneLabel || t('targets.copied')) : (label || t('targets.copy'))}
        </button>
    );
};

/**
 * Lectura del plan ocupando TODA la ventana: un plan es un documento para leer
 * a gusto, no un diálogo. Se cierra con Esc. El botón de pantalla completa va un
 * paso más allá y usa la API del navegador, que además esconde su interfaz.
 */
const PlanModal = ({ race, format, raw, onRaw, onClose, t }) => {
    const shellRef = useRef(null);
    const [isFs, setIsFs] = useState(false);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) onClose(); };
        const onFsChange = () => setIsFs(!!document.fullscreenElement);
        window.addEventListener('keydown', onKey);
        document.addEventListener('fullscreenchange', onFsChange);
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.removeEventListener('fullscreenchange', onFsChange);
            document.body.style.overflow = '';
            if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { /* ignore */ });
        };
    }, [onClose]);

    const toggleFullscreen = () => {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { /* ignore */ });
        else shellRef.current?.requestFullscreen?.().catch(() => { /* el navegador puede negarlo */ });
    };

    return (
        <div ref={shellRef} className="fixed inset-0 z-50 bg-white flex flex-col fade-in">
            <div className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b border-slate-100 shrink-0">
                <div className="min-w-0 flex items-center gap-3">
                    <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight truncate">{race.name}</h3>
                    <Chip className="bg-slate-50 text-slate-500 ring-slate-100 hidden sm:inline-block">{t(`targets.fmt_${format}`)}</Chip>
                    {race.date && (
                        <span className="text-xs font-bold text-slate-400 hidden md:inline shrink-0">
                            {new Date(race.date + 'T00:00:00').toLocaleDateString()}
                            {race.startTime ? ` · ${race.startTime}` : ''}
                        </span>
                    )}
                    {planUpdatedLabel(race, t) && (
                        <span className="text-[11px] font-bold text-slate-400 hidden lg:inline shrink-0">
                            · {planUpdatedLabel(race, t)}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {isRenderable(format) && <ViewToggle raw={raw} onChange={onRaw} t={t} />}
                    <CopyButton
                        text={typeof window !== 'undefined' ? window.location.href : ''}
                        t={t}
                        idleIcon={<LinkIcon className="w-3 h-3" />}
                        label={t('targets.copy_link')}
                        doneLabel={t('targets.link_copied')}
                    />
                    <CopyButton text={race.plan} t={t} />
                    <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        title={isFs ? t('targets.exit_fullscreen') : t('targets.fullscreen')}
                    >
                        {isFs ? <ArrowsPointingInIcon className="w-5 h-5" /> : <ArrowsPointingOutIcon className="w-5 h-5" />}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        title={t('targets.close')}
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>
            <div className={`flex-1 min-h-0 ${format === 'html' && !raw ? '' : 'overflow-y-auto px-4 sm:px-8 py-6 max-w-4xl w-full mx-auto'}`}>
                <PlanBody plan={race.plan} format={format} raw={raw} frameHeight="100%" autoHeight={false} />
            </div>
        </div>
    );
};

// ── Tarjeta de carrera ──────────────────────────────────────────────────────

/** Dato suelto de la tarjeta: etiqueta pequeña arriba, valor grande abajo. */
const Stat = ({ label, value, sub, tone = 'text-slate-900' }) => (
    <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{label}</p>
        <p className={`text-sm font-black tabular-nums truncate ${tone}`}>
            {value}
            {sub && <span className="ml-1 text-[11px] font-bold text-slate-400">{sub}</span>}
        </p>
    </div>
);

const RaceCard = ({ race, isPrimary, isSelected, open, raw, activities, onToggle, onRaw, onExpand, onEdit, onDelete, onPrimary, t }) => {
    const days = daysUntil(race.date);
    const isPast = days != null && days < 0;
    const hasPlan = !!race.plan?.trim();
    const format = useMemo(() => detectPlanFormat(race.plan), [race.plan]);
    const showRaw = raw || !isRenderable(format);
    const km = DISTANCES[race.distance];
    // Resultado real: solo tiene sentido buscarlo una vez pasada la carrera.
    const result = useMemo(
        () => (isPast ? raceResult(race, activities) : null),
        [isPast, race, activities],
    );
    const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;
    const date = race.date ? new Date(race.date + 'T00:00:00') : null;

    // Carril izquierdo: la cuenta atrás es el dato que de verdad se mira.
    const rail = isPast
        ? (result?.achieved === true
            ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
            : result?.achieved === false
                ? 'bg-rose-50 text-rose-500 border-rose-100'
                : 'bg-slate-50 text-slate-400 border-slate-100')
        : isPrimary
            ? 'bg-amber-50 text-amber-600 border-amber-100'
            : 'bg-blue-50 text-blue-600 border-blue-100';

    return (
        <div
            id={`race-${race.id}`}
            className={`bg-white rounded-2xl border shadow-sm transition-all scroll-mt-24 ${isSelected ? 'border-blue-300 ring-2 ring-blue-100 shadow-md' : isPrimary ? 'border-amber-200 ring-1 ring-amber-100' : open ? 'border-blue-200 shadow-md' : 'border-slate-100 hover:shadow-md hover:border-slate-200'} ${isPast ? 'opacity-70' : ''}`}
        >
            <div className="flex flex-col sm:flex-row">
                {/* Cuenta atrás */}
                <div className={`sm:w-32 shrink-0 flex sm:flex-col items-center justify-center gap-2 sm:gap-0 px-5 py-3 sm:py-6 border-b sm:border-b-0 sm:border-r rounded-t-2xl sm:rounded-t-none sm:rounded-l-2xl ${rail}`}>
                    {date ? (
                        <>
                            <span className="text-3xl sm:text-4xl font-black leading-none tabular-nums">
                                {days === 0 ? '¡' : Math.abs(days)}
                            </span>
                            <span className="text-[9px] font-black uppercase tracking-widest opacity-70 sm:mt-1.5 text-center">
                                {days === 0 ? t('targets.today') : isPast ? t('targets.past') : t('targets.days_unit')}
                            </span>
                            <span className="text-[10px] font-black tabular-nums opacity-60 sm:mt-2">
                                {date.toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
                            </span>
                            {race.startTime && (
                                <span className="text-[10px] font-black tabular-nums opacity-60">{race.startTime}</span>
                            )}
                        </>
                    ) : (
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{t('targets.no_date')}</span>
                    )}
                </div>

                <div className="min-w-0 flex-1 p-5 sm:p-6">
                    <div className="flex justify-between items-start gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                {isPrimary && (
                                    <Chip className="bg-amber-50 text-amber-600 ring-amber-200">
                                        <span className="inline-flex items-center gap-1">
                                            <StarSolidIcon className="w-3 h-3" />
                                            {t('targets.primary')}
                                        </span>
                                    </Chip>
                                )}
                                <Chip className={DISTANCE_STYLE[race.distance] || 'bg-slate-50 text-slate-500 ring-slate-100'}>
                                    {t(`planner.distances.${race.distance}`)}
                                </Chip>
                                {hasPlan && (
                                    <Chip className="bg-blue-50 text-blue-600 ring-blue-100">
                                        {t(`targets.fmt_${format}`)}
                                    </Chip>
                                )}
                            </div>
                            <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight truncate">{race.name}</h3>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100">
                                <Stat
                                    label={t('targets.date')}
                                    value={date ? date.toLocaleDateString(locale) : '—'}
                                    sub={race.startTime || ''}
                                />
                                <Stat
                                    label={t('targets.distance')}
                                    value={km ? `${km % 1 === 0 ? km : km.toFixed(3)}` : '—'}
                                    sub={km ? 'km' : ''}
                                />
                                <Stat
                                    label={result ? t('targets.result_time') : t('targets.goal_time')}
                                    value={result
                                        ? formatMinutes(result.time_min)
                                        : race.goalTimeMin != null ? formatMinutes(race.goalTimeMin) : '—'}
                                    tone={result
                                        ? (result.achieved === false ? 'text-rose-600' : 'text-emerald-600')
                                        : race.goalTimeMin != null ? 'text-slate-900' : 'text-slate-300'}
                                />
                                <Stat
                                    label={result ? t('targets.result_pace') : t('targets.goal_pace')}
                                    value={result
                                        ? (result.pace_min_km != null ? formatMinutes(result.pace_min_km) : '—')
                                        : race.goalTimeMin != null && km ? formatMinutes(race.goalTimeMin / km) : '—'}
                                    sub="/km"
                                    tone={result || (race.goalTimeMin != null && km) ? 'text-slate-900' : 'text-slate-300'}
                                />
                            </div>

                            {result && (
                                <div className={`mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 rounded-xl text-xs font-bold ${result.achieved === false ? 'bg-rose-50 text-rose-600' : result.achieved ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-500'}`}>
                                    {result.delta_min != null && (
                                        <span className="inline-flex items-center gap-1.5">
                                            <TrophyIcon className="w-3.5 h-3.5" />
                                            {result.achieved ? t('targets.goal_met') : t('targets.goal_missed')}
                                            <span className="tabular-nums">
                                                {result.delta_min < 0 ? '−' : '+'}{formatMinutes(Math.abs(result.delta_min))}
                                            </span>
                                            <span className="opacity-60 font-semibold">
                                                {t('targets.vs_goal', { goal: formatMinutes(result.goal_time_min) })}
                                            </span>
                                        </span>
                                    )}
                                    <span className="opacity-70 font-semibold tabular-nums">
                                        {(result.distance_m / 1000).toFixed(2)} km
                                        {result.distance_delta_m > 30 && ` (+${result.distance_delta_m} m)`}
                                    </span>
                                    {result.avg_hr && (
                                        <span className="opacity-70 font-semibold tabular-nums">{Math.round(result.avg_hr)} ppm</span>
                                    )}
                                    {result.activity_name && (
                                        <span className="opacity-50 font-semibold truncate">· {result.activity_name}</span>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                        <button
                            onClick={() => onPrimary(isPrimary ? null : race.id)}
                            className={`p-2 rounded-lg transition-colors ${isPrimary ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-300 hover:text-amber-500 hover:bg-amber-50'}`}
                            title={isPrimary ? t('targets.unset_primary') : t('targets.set_primary')}
                        >
                            {isPrimary ? <StarSolidIcon className="w-4 h-4" /> : <StarIcon className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={() => onEdit(race)}
                            className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title={t('targets.edit')}
                        >
                            <PencilSquareIcon className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => onDelete(race.id)}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title={t('targets.delete')}
                        >
                            <TrashIcon className="w-4 h-4" />
                        </button>
                        </div>
                    </div>
                </div>
            </div>

            {hasPlan && (
                <div className="border-t border-slate-100">
                    <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-2.5">
                        <button
                            onClick={() => onToggle(race.id)}
                            className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-blue-600 transition-colors"
                        >
                            <DocumentTextIcon className="w-3.5 h-3.5" />
                            {open ? t('targets.hide_plan') : t('targets.view_plan')}
                            <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
                        </button>
                        {!open && planUpdatedLabel(race, t) && (
                            <span className="text-[10px] font-bold text-slate-400 truncate">{planUpdatedLabel(race, t)}</span>
                        )}
                        {open && (
                            <div className="flex items-center gap-2">
                                {isRenderable(format) && <ViewToggle raw={showRaw} onChange={(v) => onRaw(race.id, v)} t={t} />}
                                <button
                                    onClick={() => onExpand(race.id)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                                    title={t('targets.expand')}
                                >
                                    <ArrowsPointingOutIcon className="w-3 h-3" />
                                    {t('targets.expand')}
                                </button>
                            </div>
                        )}
                    </div>
                    {open && (
                        <div className="px-5 sm:px-6 pb-5">
                            <div className={`bg-slate-50 border border-slate-100 rounded-xl ${format === 'html' && !showRaw ? 'p-2' : 'p-4 max-h-[28rem] overflow-y-auto'}`}>
                                <PlanBody plan={race.plan} format={format} raw={showRaw} />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Pantalla ────────────────────────────────────────────────────────────────

const TargetRaces = ({ activities = [], planRaceId = null }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [races, setRaces] = useState(getTargetRaces);
    const [tab, setTab] = useState('list');          // 'list' | 'form'
    const [form, setForm] = useState(EMPTY_FORM);
    const [editingId, setEditingId] = useState(null);
    const [error, setError] = useState('');
    const [openPlans, setOpenPlans] = useState(() => new Set());   // planes desplegados
    const [rawPlans, setRawPlans] = useState(() => new Set());     // vistos en crudo
    const [showPast, setShowPast] = useState(false);
    const [selectedId, setSelectedId] = useState(null); // carrera elegida en el calendario
    const [previewForm, setPreviewForm] = useState(false);

    // El plan abierto a pantalla completa vive en la URL (/targets/<id>): así el
    // enlace se puede guardar, compartir o abrir desde el banner del dashboard.
    const expandedId = planRaceId || null;
    const openPlan = useCallback((id) => navigate(`/targets/${id}`), [navigate]);
    const closePlan = useCallback(() => navigate('/targets'), [navigate]);

    useEffect(() => {
        const reload = () => setRaces(getTargetRaces());
        window.addEventListener(TARGET_RACES_EVENT, reload);
        return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
    }, []);

    const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setError(''); setPreviewForm(false); };

    const changeTime = (time) => setForm(f => ({ ...f, time, pace: paceFromTime(time, f.distance) }));
    const changePace = (pace) => setForm(f => ({ ...f, pace, time: timeFromPace(pace, f.distance) }));
    // Al cambiar de prueba manda el tiempo objetivo: el ritmo se recalcula sobre
    // la nueva distancia (y si solo había ritmo, se recalcula el tiempo).
    const changeDistance = (distance) => setForm(f => ({
        ...f,
        distance,
        ...(f.time
            ? { pace: paceFromTime(f.time, distance) }
            : { time: timeFromPace(f.pace, distance) }),
    }));

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.name.trim()) { setError(t('targets.err_name')); return; }
        const min = parseTimeToMinutes(form.time);
        if (form.time && min == null) { setError(t('targets.err_time')); return; }
        const startTime = normalizeStartTime(form.startTime);
        if (startTime == null) { setError(t('targets.err_start_time')); return; }
        saveTargetRace({
            id: editingId || undefined,
            name: form.name.trim(),
            date: form.date,
            startTime,
            distance: form.distance,
            goalTimeMin: min,
            plan: form.plan,
        });
        setRaces(getTargetRaces());
        resetForm();
        setTab('list');
    };

    const handleEdit = (r) => {
        setEditingId(r.id);
        setForm({
            name: r.name,
            date: r.date || '',
            startTime: r.startTime || '',
            distance: r.distance,
            time: r.goalTimeMin != null ? formatMinutes(r.goalTimeMin) : '',
            pace: r.goalTimeMin != null ? paceFromTime(formatMinutes(r.goalTimeMin), r.distance) : '',
            plan: r.plan || '',
        });
        setError('');
        setPreviewForm(false);
        setTab('form');
    };

    const handleDelete = (id) => {
        setRaces(deleteTargetRace(id));
        if (editingId === id) { resetForm(); setTab('list'); }
        if (expandedId === id) closePlan();
    };

    const startNew = () => { resetForm(); setTab('form'); };

    const selectFromCalendar = (id) => {
        setSelectedId(id);
        // Si estaba plegada entre las pasadas, se despliega para poder llegar a ella.
        if ((daysUntil(races.find((r) => r.id === id)?.date) ?? 0) < 0) setShowPast(true);
        requestAnimationFrame(() => {
            document.getElementById(`race-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    };

    const handlePrimary = (id) => setRaces(setPrimaryTargetRace(id));

    const togglePlan = useCallback((id) => setOpenPlans((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    }), []);

    const setRaw = useCallback((id, raw) => setRawPlans((prev) => {
        const next = new Set(prev);
        if (raw) next.add(id); else next.delete(id);
        return next;
    }), []);

    // Principal efectiva: la marcada por el usuario o, si no hay ninguna, la próxima futura.
    const primaryId = useMemo(() => { void races; return getPrimaryTargetRace()?.id || null; }, [races]);

    // Próximas en orden cronológico; pasadas aparte, de la más reciente hacia atrás.
    const { upcoming, past } = useMemo(() => {
        const up = [], pa = [];
        for (const r of races) {
            const d = daysUntil(r.date);
            (d != null && d < 0 ? pa : up).push(r);
        }
        pa.reverse();
        const first = (l) => l.sort((a, b) => (b.id === primaryId) - (a.id === primaryId));
        return { upcoming: first(up), past: first(pa) };
    }, [races, primaryId]);

    const expandedRace = expandedId ? races.find((r) => r.id === expandedId) : null;
    const expandedFormat = expandedRace ? detectPlanFormat(expandedRace.plan) : 'empty';
    const formFormat = useMemo(() => detectPlanFormat(form.plan), [form.plan]);
    const inputClass = "w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 focus:bg-white transition-all placeholder:text-slate-400";

    const renderCard = (r) => (
        <RaceCard
            key={r.id}
            race={r}
            isPrimary={r.id === primaryId}
            isSelected={r.id === selectedId}
            activities={activities}
            open={openPlans.has(r.id)}
            raw={rawPlans.has(r.id)}
            onToggle={togglePlan}
            onRaw={setRaw}
            onExpand={openPlan}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onPrimary={handlePrimary}
            t={t}
        />
    );

    const tabClass = (name) => `px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${tab === name ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;

    return (
        <div className="space-y-6 max-w-5xl mx-auto fade-in">
            {/* Cabecera + pestañas */}
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-100 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl">
                            <FlagIcon className="w-8 h-8" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-1.5 uppercase">{t('targets.title')}</h2>
                            <p className="text-slate-500 text-sm font-medium">{t('targets.subtitle')}</p>
                        </div>
                    </div>
                    {tab === 'list' && (
                        <button
                            onClick={startNew}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-sm shadow-blue-200"
                        >
                            <PlusIcon className="w-4 h-4" />
                            {t('targets.add')}
                        </button>
                    )}
                </div>

                <div className="inline-flex mt-6 rounded-2xl bg-slate-100 p-1">
                    <button onClick={() => setTab('list')} className={tabClass('list')}>
                        <span className="inline-flex items-center gap-1.5">
                            <ListBulletIcon className="w-3.5 h-3.5" />
                            {t('targets.tab_races')}
                            <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-slate-200/70 text-slate-600 text-[10px]">{races.length}</span>
                        </span>
                    </button>
                    <button onClick={() => (editingId ? setTab('form') : startNew())} className={tabClass('form')}>
                        <span className="inline-flex items-center gap-1.5">
                            {editingId ? <PencilSquareIcon className="w-3.5 h-3.5" /> : <PlusIcon className="w-3.5 h-3.5" />}
                            {editingId ? t('targets.tab_edit') : t('targets.tab_new')}
                        </span>
                    </button>
                </div>
            </div>

            {/* Pestaña: formulario (los inputs solo se ven aquí) */}
            {tab === 'form' && (
                <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-100 shadow-sm">
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
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('targets.start_time')}</label>
                                <input
                                    type="time"
                                    value={form.startTime}
                                    onChange={(e) => setForm(f => ({ ...f, startTime: e.target.value }))}
                                    className={inputClass}
                                />
                                <p className="mt-1.5 text-[10px] font-medium text-slate-400 leading-snug">{t('targets.start_time_hint')}</p>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('targets.distance')}</label>
                                <Select value={form.distance} onValueChange={changeDistance} enableClear={false}>
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
                                    onChange={(e) => changeTime(e.target.value)}
                                    placeholder={t('targets.goal_time_ph')}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('targets.goal_pace')}</label>
                                <input
                                    type="text"
                                    value={form.pace}
                                    onChange={(e) => changePace(e.target.value)}
                                    placeholder={t('targets.goal_pace_ph')}
                                    className={inputClass}
                                />
                                <p className="mt-2 text-[11px] font-medium text-slate-400">{t('targets.pace_hint')}</p>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('targets.plan')}</label>
                                <div className="flex items-center gap-2">
                                    <Chip className="bg-slate-50 text-slate-500 ring-slate-100">{t(`targets.fmt_${formFormat}`)}</Chip>
                                    {isRenderable(formFormat) && (
                                        <button
                                            type="button"
                                            onClick={() => setPreviewForm(v => !v)}
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                                        >
                                            {previewForm ? t('targets.view_edit') : t('targets.preview')}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {previewForm && isRenderable(formFormat) ? (
                                <div className={`bg-slate-50 border border-slate-200 rounded-lg ${formFormat === 'html' ? 'p-2' : 'p-4 max-h-[28rem] overflow-y-auto'}`}>
                                    <PlanBody plan={form.plan} format={formFormat} raw={false} />
                                </div>
                            ) : (
                                <textarea
                                    value={form.plan}
                                    onChange={(e) => setForm(f => ({ ...f, plan: e.target.value }))}
                                    placeholder={t('targets.plan_ph')}
                                    rows={12}
                                    className={`${inputClass} font-mono text-xs leading-relaxed resize-y`}
                                />
                            )}
                            <p className="mt-2 text-xs font-medium text-slate-400">{t('targets.plan_hint')}</p>
                        </div>

                        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

                        <div className="flex items-center gap-3 pt-5 border-t border-slate-100">
                            <button
                                type="submit"
                                className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-sm shadow-blue-200"
                            >
                                {editingId ? t('targets.save') : t('targets.add')}
                            </button>
                            <button
                                type="button"
                                onClick={() => { resetForm(); setTab('list'); }}
                                className="px-6 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
                            >
                                {t('targets.cancel')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Pestaña: listado */}
            {tab === 'list' && (
                races.length === 0 ? (
                    <div className="bg-white rounded-2xl p-16 border border-slate-100 shadow-sm text-center">
                        <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <FlagIcon className="w-10 h-10" />
                        </div>
                        <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-2">{t('targets.empty_title')}</h3>
                        <p className="text-slate-500 font-medium max-w-sm mx-auto mb-6">{t('targets.empty_desc')}</p>
                        <button
                            onClick={startNew}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-sm shadow-blue-200"
                        >
                            <PlusIcon className="w-4 h-4" />
                            {t('targets.add')}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <RaceCalendar
                            races={races}
                            primaryId={primaryId}
                            selectedId={selectedId}
                            onSelect={selectFromCalendar}
                            t={t}
                        />

                        <div className="space-y-8">
                        {upcoming.length > 0 && (
                            <section className="space-y-3">
                                <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                        {t('targets.upcoming')} · {upcoming.length}
                                    </h3>
                                    <p className="text-[11px] font-medium text-slate-400">{t('targets.primary_hint')}</p>
                                </div>
                                <div className="space-y-4">{upcoming.map(renderCard)}</div>
                            </section>
                        )}

                        {past.length > 0 && (
                            <section className="space-y-3">
                                <button
                                    onClick={() => setShowPast(v => !v)}
                                    className="inline-flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 hover:text-slate-600 transition-colors"
                                >
                                    {t('targets.past_section')} · {past.length}
                                    <ChevronDownIcon className={`w-3 h-3 transition-transform ${showPast ? 'rotate-180' : ''}`} />
                                </button>
                                {showPast && <div className="space-y-4">{past.map(renderCard)}</div>}
                            </section>
                        )}
                        </div>
                    </div>
                )
            )}

            {expandedRace?.plan && (
                <PlanModal
                    race={expandedRace}
                    format={expandedFormat}
                    raw={rawPlans.has(expandedRace.id) || !isRenderable(expandedFormat)}
                    onRaw={(v) => setRaw(expandedRace.id, v)}
                    onClose={closePlan}
                    t={t}
                />
            )}
        </div>
    );
};

export default TargetRaces;
