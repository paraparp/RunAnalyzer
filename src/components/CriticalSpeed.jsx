import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BoltIcon } from '@heroicons/react/24/outline';
import {
    Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
    Tooltip as RechartsTooltip, Scatter, ComposedChart, ReferenceLine,
} from 'recharts';
import {
    buildMeanMaxCurve, fitCriticalSpeed, fitCriticalSpeed3P, speedForDuration,
    CANON_EFFORTS, fmtTime, fmtPace, FIT_MIN_S, FIT_MAX_S, monthsAgoISO,
} from '../lib/criticalSpeed';
import { vdotFromCurve } from '../lib/vdot';
import { scopeMonths } from '../lib/timeScope';
import useTimeScope from '../hooks/useTimeScope';

const labelOf = (id) => CANON_EFFORTS.find((e) => e.id === id)?.label || id;

const Metric = ({ label, value, unit, hint, tone = 'text-slate-900' }) => (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">{label}</p>
        <p className={`text-3xl font-black tabular-nums leading-none ${tone}`}>
            {value}
            {unit && <span className="text-sm font-bold text-slate-400 ml-1">{unit}</span>}
        </p>
        {hint && <p className="text-[11px] font-medium text-slate-400 mt-2">{hint}</p>}
    </div>
);

const CriticalSpeed = ({ activities = [] }) => {
    const { t } = useTranslation();
    // Período compartido (lib/timeScope): el control vive en la barra superior.
    const [scope] = useTimeScope();
    const months = scopeMonths(scope);

    // Curva del periodo elegido y la del periodo ANTERIOR de igual duración, para
    // ver si la curva se ha movido y por dónde.
    const { curve, previous, fit, fit3p } = useMemo(() => {
        const from = monthsAgoISO(months);
        const cur = buildMeanMaxCurve(activities, { from });
        const prev = months
            ? buildMeanMaxCurve(activities, { from: monthsAgoISO(months * 2), to: from })
            : [];
        // El ajuste de tres parámetros es un COMPLEMENTO: solo sale si hay
        // esfuerzos cortos que den curvatura, y no toca la CS ni el D′ que se
        // muestran. Añade el techo de velocidad que al de dos parámetros le falta.
        return { curve: cur, previous: prev, fit: fitCriticalSpeed(cur), fit3p: fitCriticalSpeed3P(cur) };
    }, [activities, months]);

    // Serie del modelo: velocidad sostenible para cada duración (escala log).
    // Si hay ajuste de tres parámetros se pinta encima, en discontinua: es la
    // misma curva salvo por el extremo corto, donde el de dos se dispara.
    const modelSeries = useMemo(() => {
        if (!fit) return [];
        const out = [];
        for (let s = 90; s <= 14400; s *= 1.12) {
            const t = Math.round(s);
            const v = speedForDuration(fit, s);
            const row = { t, modelPace: (1000 / v) / 60 };
            if (fit3p) row.model3pPace = (1000 / speedForDuration(fit3p, s)) / 60;
            out.push(row);
        }
        return out;
    }, [fit, fit3p]);

    const points = useMemo(() => curve.map((p) => ({
        t: p.time_s, pointPace: p.pace_min_km, id: p.id, label: labelOf(p.id), date: p.date,
    })), [curve]);

    const prevPoints = useMemo(() => previous.map((p) => ({
        t: p.time_s, prevPace: p.pace_min_km, id: p.id, label: labelOf(p.id),
    })), [previous]);

    const chartData = useMemo(
        () => [...modelSeries, ...points, ...prevPoints].sort((a, b) => a.t - b.t),
        [modelSeries, points, prevPoints],
    );

    // La MISMA curva leída con la tabla de Daniels. No se vuelve a construir ni
    // se filtra distinto: CS y D′ describen la asíntota y la reserva, el VDOT
    // pone ese mismo esfuerzo en una escala comparable entre corredores. Antes
    // esto se recalculaba en dos vistas más, cada una con su ventana.
    const vdot = useMemo(() => vdotFromCurve(curve), [curve]);

    const header = (
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-100 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-violet-100 text-violet-600 rounded-2xl">
                        <BoltIcon className="w-8 h-8" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-1.5 uppercase">{t('cs.title')}</h2>
                        <p className="text-slate-500 text-sm font-medium">{t('cs.subtitle')}</p>
                    </div>
                </div>
            </div>
        </div>
    );

    if (!fit) {
        return (
            <div className="space-y-6 max-w-6xl mx-auto fade-in">
                {header}
                <div className="bg-white rounded-2xl p-16 border border-slate-100 shadow-sm text-center">
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-2">{t('cs.no_fit_title')}</h3>
                    <p className="text-slate-500 font-medium max-w-md mx-auto">{t('cs.no_fit_desc')}</p>
                    {curve.length > 0 && (
                        <p className="text-xs font-bold text-slate-400 mt-4">
                            {t('cs.no_fit_found', { count: curve.length })}
                        </p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto fade-in">
            {header}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                    label={t('cs.cs')}
                    value={fmtPace(fit.cs_pace_min_km)}
                    unit="/km"
                    hint={t('cs.cs_hint', { speed: fit.cs_m_s.toFixed(2) })}
                    tone="text-violet-600"
                />
                <Metric
                    label={t('cs.d_prime')}
                    value={Math.round(fit.d_prime_m)}
                    unit="m"
                    hint={t('cs.d_prime_hint')}
                />
                <Metric
                    label={t('cs.quality')}
                    value={`${(fit.r2 * 100).toFixed(1)}%`}
                    hint={t('cs.quality_hint', { n: fit.n })}
                    tone={fit.r2 > 0.99 ? 'text-emerald-600' : fit.r2 > 0.97 ? 'text-slate-900' : 'text-amber-600'}
                />
                {vdot && (
                    <Metric
                        label="VDOT"
                        value={vdot.vdot}
                        hint={t('cs.vdot_hint', {
                            effort: labelOf(vdot.anchor.id),
                            time: fmtTime(vdot.anchor.time_s),
                        })}
                        tone="text-blue-600"
                    />
                )}
                {fit3p && (
                    <Metric
                        label={t('cs.v_max')}
                        value={fit3p.v_max_m_s.toFixed(1)}
                        unit="m/s"
                        hint={t('cs.v_max_hint', { pace: fmtPace(fit3p.v_max_pace_min_km) })}
                    />
                )}
            </div>

            {/* Curva */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sm:p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">{t('cs.curve_title')}</h3>
                    <p className="text-[11px] font-medium text-slate-400">{t('cs.curve_legend')}</p>
                </div>
                <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                            <XAxis
                                dataKey="t"
                                type="number"
                                scale="log"
                                domain={[90, 14400]}
                                ticks={[120, 300, 600, 1200, 1800, 3600, 7200, 14400]}
                                tickFormatter={(v) => (v >= 3600 ? `${v / 3600}h` : `${Math.round(v / 60)}′`)}
                                tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }}
                                stroke="#cbd5e1"
                            />
                            <YAxis
                                reversed
                                domain={['auto', 'auto']}
                                tickFormatter={(v) => fmtPace(v)}
                                tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }}
                                stroke="#cbd5e1"
                                width={46}
                            />
                            <RechartsTooltip
                                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                                labelFormatter={(v) => fmtTime(v)}
                                formatter={(value, name, item) => [
                                    `${fmtPace(value)}/km`,
                                    item?.payload?.label
                                        ? `${item.payload.label}${item.payload.date ? ` · ${item.payload.date}` : ''}`
                                        : t('cs.model'),
                                ]}
                            />
                            {/* Ventana en la que el modelo es válido */}
                            <ReferenceLine x={FIT_MIN_S} stroke="#cbd5e1" strokeDasharray="4 4" />
                            <ReferenceLine x={FIT_MAX_S} stroke="#cbd5e1" strokeDasharray="4 4" />
                            <Line
                                type="monotone" dataKey="modelPace" stroke="#7c3aed" strokeWidth={2}
                                dot={false} isAnimationActive={false} connectNulls
                            />
                            {fit3p && (
                                <Line
                                    type="monotone" dataKey="model3pPace" stroke="#7c3aed" strokeWidth={2}
                                    strokeDasharray="5 4" strokeOpacity={0.65}
                                    dot={false} isAnimationActive={false} connectNulls
                                />
                            )}
                            <Scatter dataKey="prevPace" fill="#cbd5e1" shape="circle" isAnimationActive={false} />
                            <Scatter dataKey="pointPace" fill="#7c3aed" shape="circle" isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
                {fit3p && (
                    <p className="text-[11px] font-medium text-slate-400 mt-3">
                        {t('cs.model_3p_note', { n: fit3p.n })}
                    </p>
                )}
            </div>

            {/* Esfuerzos que sostienen el ajuste */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sm:p-6">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-4">{t('cs.efforts_title')}</h3>
                <div className="flex flex-wrap gap-2">
                    {curve.map((p) => {
                        const used = fit.used_ids.includes(p.id);
                        return (
                            <span
                                key={p.id}
                                title={`${p.activity_name || ''} · ${p.date}`}
                                className={`inline-flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full ring-1 ${used ? 'bg-violet-50 ring-violet-200 text-violet-700' : 'bg-white ring-slate-200 text-slate-400'}`}
                            >
                                <span className="text-[10px] font-black uppercase tracking-widest">{labelOf(p.id)}</span>
                                <span className="text-xs font-bold tabular-nums">{fmtTime(p.time_s)}</span>
                                <span className="text-[10px] font-bold tabular-nums opacity-60">{fmtPace(p.pace_min_km)}/km</span>
                            </span>
                        );
                    })}
                </div>
                <p className="text-[11px] font-medium text-slate-400 mt-4">{t('cs.efforts_hint')}</p>
            </div>
        </div>
    );
};

export default CriticalSpeed;
