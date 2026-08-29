import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectItem } from '@tremor/react';
import { BoltIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
    Tooltip as RechartsTooltip, Scatter, ComposedChart, ReferenceLine,
} from 'recharts';
import {
    buildMeanMaxCurve, fitCriticalSpeed, predictTime, speedForDuration,
    CANON_EFFORTS, fmtTime, fmtPace, FIT_MIN_S, FIT_MAX_S,
} from '../lib/criticalSpeed';

// Distancias sobre las que se enseña la predicción del modelo.
const TARGETS = [
    { id: '5k', m: 5000, label: '5K' },
    { id: '10k', m: 10000, label: '10K' },
    { id: 'half-marathon', m: 21097, label: '21K' },
    { id: 'marathon', m: 42195, label: '42K' },
];

const WINDOWS = [
    { id: '180', months: 6 },
    { id: '365', months: 12 },
    { id: 'all', months: null },
];

const isoMonthsAgo = (months) => {
    if (months == null) return null;
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
};

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
    const [windowId, setWindowId] = useState('365');

    const months = WINDOWS.find((w) => w.id === windowId)?.months ?? null;

    // Curva del periodo elegido y la del periodo ANTERIOR de igual duración, para
    // ver si la curva se ha movido y por dónde.
    const { curve, previous, fit } = useMemo(() => {
        const from = isoMonthsAgo(months);
        const cur = buildMeanMaxCurve(activities, { from });
        const prev = months
            ? buildMeanMaxCurve(activities, { from: isoMonthsAgo(months * 2), to: from })
            : [];
        return { curve: cur, previous: prev, fit: fitCriticalSpeed(cur) };
    }, [activities, months]);

    // Serie del modelo: velocidad sostenible para cada duración (escala log).
    const modelSeries = useMemo(() => {
        if (!fit) return [];
        const out = [];
        for (let s = 90; s <= 14400; s *= 1.12) {
            const v = speedForDuration(fit, s);
            out.push({ t: Math.round(s), modelPace: (1000 / v) / 60 });
        }
        return out;
    }, [fit]);

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

    const predictions = useMemo(() => TARGETS.map((d) => {
        const model = predictTime(fit, d.m);
        const real = curve.find((p) => p.id === d.id);
        return {
            ...d,
            model,
            real,
            delta_s: model && real ? real.time_s - model.time_s : null,
        };
    }), [fit, curve]);

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
                <div className="w-44">
                    <Select value={windowId} onValueChange={setWindowId} enableClear={false}>
                        {WINDOWS.map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                                {w.months ? t('cs.last_months', { count: w.months }) : t('cs.all_time')}
                            </SelectItem>
                        ))}
                    </Select>
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                            <Scatter dataKey="prevPace" fill="#cbd5e1" shape="circle" isAnimationActive={false} />
                            <Scatter dataKey="pointPace" fill="#7c3aed" shape="circle" isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Predicciones */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 sm:px-6 py-4 border-b border-slate-100">
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">{t('cs.predictions_title')}</h3>
                    <p className="text-[11px] font-medium text-slate-400 mt-1">{t('cs.predictions_desc')}</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                {['distance', 'model', 'model_pace', 'best', 'delta'].map((k) => (
                                    <th key={k} className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">
                                        {t(`cs.col_${k}`)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {predictions.map((p) => (
                                <tr key={p.id} className="border-t border-slate-100">
                                    <td className="px-4 py-3 font-black text-slate-900">{p.label}</td>
                                    <td className="px-4 py-3 font-bold tabular-nums text-slate-700">
                                        {p.model ? fmtTime(p.model.time_s) : '—'}
                                        {p.model?.optimistic && (
                                            <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-amber-600">
                                                <InformationCircleIcon className="w-3 h-3" />
                                                {t('cs.optimistic')}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 font-bold tabular-nums text-slate-500">
                                        {p.model ? `${fmtPace(p.model.pace_min_km)}/km` : '—'}
                                    </td>
                                    <td className="px-4 py-3 font-bold tabular-nums text-slate-700">
                                        {p.real ? fmtTime(p.real.time_s) : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className={`px-4 py-3 font-black tabular-nums ${p.delta_s == null ? 'text-slate-300' : p.delta_s <= 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                                        {p.delta_s == null ? '—' : `${p.delta_s <= 0 ? '−' : '+'}${fmtTime(Math.abs(p.delta_s))}`}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="px-5 sm:px-6 py-3 text-[11px] font-medium text-slate-400 border-t border-slate-100">
                    {t('cs.model_caveat')}
                </p>
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
