import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectItem } from "@tremor/react";
import {
    FlagIcon, PencilSquareIcon, TrashIcon, CalendarDaysIcon, ClockIcon,
    DocumentTextIcon, ChevronDownIcon, PlusIcon, XMarkIcon,
    ArrowsPointingOutIcon, ClipboardDocumentIcon, CheckIcon, ListBulletIcon, StarIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";
import {
    getTargetRaces, saveTargetRace, deleteTargetRace, setPrimaryTargetRace, getPrimaryTargetRace,
    parseTimeToMinutes, formatMinutes, daysUntil, TARGET_RACES_EVENT,
} from '../lib/targetRaces';
import { detectPlanFormat, isRenderable } from '../lib/planFormat';
import MarkdownText from './MarkdownText';
import HtmlDocument from './HtmlDocument';

const EMPTY_FORM = { name: '', date: '', distance: '21k', time: '', plan: '' };

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
const PlanBody = ({ plan, format, raw, frameHeight = '26rem' }) => {
    if (raw) {
        return (
            <pre className="text-[11px] leading-relaxed text-slate-600 font-mono whitespace-pre-wrap break-words">{plan}</pre>
        );
    }
    return format === 'html'
        ? <HtmlDocument html={plan} height={frameHeight} />
        : <MarkdownText content={plan} />;
};

const CopyButton = ({ text, t }) => {
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
            {copied ? <CheckIcon className="w-3 h-3" /> : <ClipboardDocumentIcon className="w-3 h-3" />}
            {copied ? t('targets.copied') : t('targets.copy')}
        </button>
    );
};

/** Lectura del plan a pantalla completa (planes largos). Cierra con Esc o clic fuera. */
const PlanModal = ({ race, format, raw, onRaw, onClose, t }) => {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-slate-900/50 backdrop-blur-sm fade-in"
            onClick={onClose}
        >
            <div
                className="bg-white w-full max-w-4xl max-h-[88vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
                    <div className="min-w-0">
                        <h3 className="text-lg font-black text-slate-900 tracking-tight truncate">{race.name}</h3>
                        <div className="flex items-center gap-2 mt-1.5">
                            <Chip className="bg-slate-50 text-slate-500 ring-slate-100">{t(`targets.fmt_${format}`)}</Chip>
                            {race.date && (
                                <span className="text-xs font-bold text-slate-400">
                                    {new Date(race.date + 'T00:00:00').toLocaleDateString()}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {isRenderable(format) && <ViewToggle raw={raw} onChange={onRaw} t={t} />}
                        <CopyButton text={race.plan} t={t} />
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
                <div className="px-6 py-5 overflow-y-auto flex-1">
                    <PlanBody plan={race.plan} format={format} raw={raw} frameHeight="calc(88vh - 9rem)" />
                </div>
            </div>
        </div>
    );
};

// ── Tarjeta de carrera ──────────────────────────────────────────────────────

const RaceCard = ({ race, isPrimary, open, raw, onToggle, onRaw, onExpand, onEdit, onDelete, onPrimary, t }) => {
    const days = daysUntil(race.date);
    const isPast = days != null && days < 0;
    const hasPlan = !!race.plan?.trim();
    const format = useMemo(() => detectPlanFormat(race.plan), [race.plan]);
    const showRaw = raw || !isRenderable(format);

    return (
        <div className={`bg-white rounded-2xl border shadow-sm transition-all ${isPrimary ? 'border-amber-200 ring-1 ring-amber-100' : open ? 'border-blue-200 shadow-md' : 'border-slate-100 hover:shadow-md hover:border-slate-200'} ${isPast ? 'opacity-70' : ''}`}>
            <div className="p-5 sm:p-6">
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
                            {days != null && !isPast && (
                                <Chip className="bg-emerald-50 text-emerald-600 ring-emerald-100">
                                    {days === 0 ? t('targets.today') : t('targets.days_left', { count: days })}
                                </Chip>
                            )}
                            {isPast && <Chip className="bg-slate-100 text-slate-400 ring-slate-200">{t('targets.past')}</Chip>}
                            {hasPlan && (
                                <Chip className="bg-blue-50 text-blue-600 ring-blue-100">
                                    {t(`targets.fmt_${format}`)}
                                </Chip>
                            )}
                        </div>
                        <h3 className="text-lg font-black text-slate-900 tracking-tight truncate">{race.name}</h3>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs font-bold text-slate-500">
                            {race.date && (
                                <span className="inline-flex items-center gap-1.5">
                                    <CalendarDaysIcon className="w-3.5 h-3.5 text-slate-400" />
                                    {new Date(race.date + 'T00:00:00').toLocaleDateString()}
                                </span>
                            )}
                            {race.goalTimeMin != null && (
                                <span className="inline-flex items-center gap-1.5">
                                    <ClockIcon className="w-3.5 h-3.5 text-slate-400" />
                                    {formatMinutes(race.goalTimeMin)}
                                </span>
                            )}
                            {!hasPlan && (
                                <span className="inline-flex items-center gap-1.5 text-slate-300">
                                    <DocumentTextIcon className="w-3.5 h-3.5" />
                                    {t('targets.no_plan')}
                                </span>
                            )}
                        </div>
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

const TargetRaces = () => {
    const { t } = useTranslation();
    const [races, setRaces] = useState(getTargetRaces);
    const [tab, setTab] = useState('list');          // 'list' | 'form'
    const [form, setForm] = useState(EMPTY_FORM);
    const [editingId, setEditingId] = useState(null);
    const [error, setError] = useState('');
    const [openPlans, setOpenPlans] = useState(() => new Set());   // planes desplegados
    const [rawPlans, setRawPlans] = useState(() => new Set());     // vistos en crudo
    const [expandedId, setExpandedId] = useState(null);            // plan a pantalla completa
    const [showPast, setShowPast] = useState(false);
    const [previewForm, setPreviewForm] = useState(false);

    useEffect(() => {
        const reload = () => setRaces(getTargetRaces());
        window.addEventListener(TARGET_RACES_EVENT, reload);
        return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
    }, []);

    const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setError(''); setPreviewForm(false); };

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
            distance: r.distance,
            time: r.goalTimeMin != null ? formatMinutes(r.goalTimeMin) : '',
            plan: r.plan || '',
        });
        setError('');
        setPreviewForm(false);
        setTab('form');
    };

    const handleDelete = (id) => {
        setRaces(deleteTargetRace(id));
        if (editingId === id) { resetForm(); setTab('list'); }
        if (expandedId === id) setExpandedId(null);
    };

    const startNew = () => { resetForm(); setTab('form'); };

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
            open={openPlans.has(r.id)}
            raw={rawPlans.has(r.id)}
            onToggle={togglePlan}
            onRaw={setRaw}
            onExpand={setExpandedId}
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
                )
            )}

            {expandedRace?.plan && (
                <PlanModal
                    race={expandedRace}
                    format={expandedFormat}
                    raw={rawPlans.has(expandedRace.id) || !isRenderable(expandedFormat)}
                    onRaw={(v) => setRaw(expandedRace.id, v)}
                    onClose={() => setExpandedId(null)}
                    t={t}
                />
            )}
        </div>
    );
};

export default TargetRaces;
