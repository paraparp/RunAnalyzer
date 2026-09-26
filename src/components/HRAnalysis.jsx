import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatPaceFromSpeed, formatPaceFromMinPerKm } from '../lib/timeFormat';
import useHrParams from '../hooks/useHrParams';
import { efficiencyMPerBeat, toBeatsPerKm } from '../lib/efficiencyFactor';
import { activityGapSpeed } from '../lib/streamGap';
import { activityDayKey } from '../lib/trainingLoad';
import { daysAgoISO, activityWithinMonths } from '../lib/criticalSpeed';
import { decouplingPct, decouplingLevel } from '../lib/decoupling';
import { scopeMonths } from '../lib/timeScope';
import useTimeScope from '../hooks/useTimeScope';
import {
    Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ScatterChart, Scatter, Cell, ReferenceLine,
    ComposedChart, Area
} from "recharts";
import {
    ClockIcon,
    FunnelIcon,
    HeartIcon,
    ExclamationTriangleIcon,
    FireIcon,
    SparklesIcon
} from "@heroicons/react/24/outline";

// Month color palette
const MONTH_COLORS = {
    0: "#6c5ce7",  // Jan - purple
    1: "#ff6b6b",  // Feb - red
    2: "#00b894",  // Mar - green
    3: "#fdcb6e",  // Apr - yellow
    4: "#e17055",  // May - coral
    5: "#74b9ff",  // Jun - blue
    6: "#a29bfe",  // Jul - light purple
    7: "#55efc4",  // Aug - mint
    8: "#ffeaa7",  // Sep - light yellow
    9: "#fab1a0",  // Oct - salmon
    10: "#6c5ce7", // Nov - purple
    11: "#00b894", // Dec - green
};

const getMonthColor = (dateStr) => {
    const month = new Date(dateStr).getMonth();
    return MONTH_COLORS[month] || "#636e72";
};

const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const getMonthLabel = (monthIndex, lang = 'en') =>
    (lang.startsWith('es') ? MONTHS_ES : MONTHS_EN)[monthIndex] || "";

// GAP = Grade Adjusted Pace: removes elevation penalty so trail & flat are comparable.
// Fuente única `activityGapSpeed`: el GAP MEDIDO sobre los streams si la actividad
// viene enriquecida, y la hipótesis de perfil ondulado sobre el D+ de cabecera si no.
const calculateGAP = (activity) => {
    const v = activityGapSpeed(activity);
    if (!(v > 0)) return { gap: "0:00", gapMinKm: 0 };
    return { gap: formatPaceFromSpeed(v), gapMinKm: 1000 / (v * 60) };
};

// Open activity in Strava
const openStrava = (id) => {
    if (id) window.open(`https://www.strava.com/activities/${id}`, '_blank');
};

const CustomTooltipScatter = ({ active, payload }) => {
    if (active && payload?.length) {
        const d = payload[0].payload;
        return (
            <div className="bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-200 text-[13px] shadow-xl">
                <div className="font-bold text-white mb-1">{d.name}</div>
                <div className="text-slate-400">{d.dateFormatted} · {d.km.toFixed(1)}km</div>
                <div className="text-rose-400">FC media: {Math.round(d.hr)} bpm</div>
                <div className="text-emerald-400">GAP: {d.gap}/km</div>
                {d.rawPace && <div className="text-slate-500">Ritmo real: {d.rawPace}/km · {Math.round(d.elev)}m D+</div>}
                <div className="text-blue-400 text-[11px] mt-1.5 opacity-70">🔗 Click para ver en Strava</div>
            </div>
        );
    }
    return null;
};

const CustomTooltipTimeline = ({ active, payload }) => {
    if (active && payload?.[0]) {
        const d = payload[0].payload;
        return (
            <div className="bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-200 text-[13px] shadow-xl">
                <div className="font-bold text-white">{d.name} · {d.dateFormatted}</div>
                <div className="text-slate-400">{d.km.toFixed(1)}km · GAP {d.gap}/km · {Math.round(d.elev)}m D+</div>
                <div className="text-rose-400 font-semibold">FC: {Math.round(d.avgHr)} bpm (max {Math.round(d.maxHr)})</div>
                <div className="text-blue-400 text-[11px] mt-1.5 opacity-70">🔗 Click para ver en Strava</div>
            </div>
        );
    }
    return null;
};


export default function HRAnalysis({ activities }) {
    const { t, i18n } = useTranslation();
    const [activeTab, setActiveTab] = useState("overview");
    // Período compartido (lib/timeScope): el control vive en la barra superior.
    const [scope] = useTimeScope();
    const [lastNRuns, setLastNRuns] = useState(30);
    const [hiddenMonths, setHiddenMonths] = useState(new Set());
    const [effMetric, setEffMetric] = useState("hre"); // "hre" (lat/km) o "ef" (m/latido)

    // FCreposo efectiva (Garmin → override manual → defecto): la necesita el
    // escalado a 150 ppm, que se hace sobre la RESERVA cardiaca, no sobre la FC bruta.
    const { hrrest } = useHrParams(activities);

    const toggleMonth = (monthIndex) => {
        setHiddenMonths(prev => {
            const next = new Set(prev);
            if (next.has(monthIndex)) next.delete(monthIndex);
            else next.add(monthIndex);
            return next;
        });
    };

    // Sesiones del período compartido; de ellas, las N más recientes.
    const filteredActivities = useMemo(() => {
        if (!activities || activities.length === 0) return [];
        const sorted = activities
            .filter(activityWithinMonths(scopeMonths(scope)))
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
        return sorted.slice(0, lastNRuns).reverse(); // reverse back to chronological
    }, [activities, scope, lastNRuns]);

    // Process activities into chart-ready data
    const processedData = useMemo(() => {
        if (!filteredActivities || filteredActivities.length === 0) return null;

        // Filter only runs with HR data
        const withHR = filteredActivities
            .filter(a => a.average_heartrate && a.average_heartrate > 0 && a.distance > 0)
            .map(a => {
                const date = new Date(a.start_date);
                const km = a.distance / 1000;
                const speedMs = a.average_speed || (a.distance / a.moving_time);
                const elev = a.total_elevation_gain || 0;
                const { gap, gapMinKm } = calculateGAP(a);
                return {
                    id: a.id,
                    date: a.start_date,
                    dateFormatted: date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" }),
                    dateShort: `${date.getDate()}/${date.getMonth() + 1}`,
                    name: a.name,
                    km,
                    avgHr: a.average_heartrate,
                    maxHr: a.max_heartrate || a.average_heartrate,
                    speedMs,
                    gapSpeed: gapMinKm > 0 ? 1000 / (gapMinKm * 60) : speedMs, // GAP as m/s for scatter
                    elev,
                    rawPace: formatPaceFromSpeed(speedMs),
                    gap,
                    gapMinKm,
                    pace: gap, // default "pace" is now GAP
                    month: date.getMonth(),
                    monthLabel: getMonthLabel(date.getMonth(), i18n.language),
                    yearMonth: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
                    color: getMonthColor(a.start_date),
                    movingTime: a.moving_time,
                    timestamp: date.getTime(),
                    day: activityDayKey(a),
                    suffer_score: a.suffer_score || 0,
                    splits: a.splits_metric || null,
                    elevPerKm: km > 0 ? elev / km : 0, // m D+ per km
                };
            })
            .sort((a, b) => a.timestamp - b.timestamp);

        if (withHR.length === 0) return null;

        // Get date range
        const months = [...new Set(withHR.map(r => r.yearMonth))].sort();
        const uniqueMonths = months.map(ym => {
            const [y, m] = ym.split("-");
            return { key: ym, label: getMonthLabel(parseInt(m) - 1, i18n.language), year: y, monthIndex: parseInt(m) - 1 };
        });

        // Scatter data: all runs with HR > 3km, using GAP speed for fair comparison
        const scatterData = withHR
            .filter(r => r.km > 3)
            .map(r => ({
                ...r,
                speed: r.gapSpeed, // Use GAP-adjusted speed for scatter X axis
                hr: r.avgHr,
                period: `${r.monthLabel} ${new Date(r.date).getFullYear()}`,
            }));

        // Deriva: la definición ÚNICA de lib/decoupling (Pa:HR, 2.ª mitad vs 1.ª, en %).
        // Aquí había otra —FC del último tercio menos la del primero, en ppm— que no
        // corregía por ritmo y calificaba con sus propios umbrales. La gráfica de
        // deriva de esta pestaña se fue: su dueño es Salud › Desacople.
        const driftPcts = withHR
            .filter(r => r.elevPerKm < 80 && r.km >= 2 && r.gapMinKm > 0 && r.gapMinKm < 10 && r.splits)
            .map(r => decouplingPct(r.splits))
            .filter(v => v != null);

        // Eficiencia cardíaca en carreras llanas (<2.5% pendiente, GAP < 7:00/km).
        // UNA sola cantidad, en las dos unidades con las que se lee:
        //   ef  = m/latido (convención TrainingPeaks / Jones) — MÁS es mejor
        //   hre = latidos/km, su recíproco exacto (1000 / ef)  — MENOS es mejor
        // Antes había aquí tres expresiones distintas, una de ellas invertida
        // respecto al EF de TrainingPeaks, y ninguna comparable con la del
        // resumen vital. La definición vive en src/lib/efficiencyFactor.js.
        const efficiencyData = withHR
            .filter(r => r.elevPerKm < 25 && r.km >= 3.5 && r.gapMinKm > 0 && r.gapMinKm < 7)
            .map(r => {
                const ef = efficiencyMPerBeat(r.gapSpeed || r.speedMs, r.avgHr);
                return { ...r, ef: +ef.toFixed(2), hre: toBeatsPerKm(ef) };
            });

        // Pace at 150 BPM (before km 7, on flat terrain)
        // Helps track aerobic fitness over long runs without cardiac drift
        const pace150Data = withHR
            .filter(r => r.km >= 6 && r.elevPerKm < 25 && r.splits && r.splits.length >= 6)
            .map(r => {
                const validSplits = r.splits.slice(0, 6).filter(s => s.average_speed > 0 && s.average_heartrate > 0);
                if (validSplits.length === 0) return null;
                
                const avgSpeed = validSplits.reduce((acc, s) => acc + s.average_speed, 0) / validSplits.length;
                const avgHr = validSplits.reduce((acc, s) => acc + s.average_heartrate, 0) / validSplits.length;
                
                // Velocidad equivalente a 150 ppm escalando sobre la RESERVA cardiaca.
                // La regla de tres `avgSpeed * (150 / avgHr)` asume que la recta
                // FC-velocidad pasa por el origen (0 ppm ↔ 0 m/s); la ordenada real es
                // la FC de reposo, y el sesgo (~9 s/km) crece cuanto más lejos de 150
                // esté la FC media, así que contaminaba la propia tendencia.
                const hrReserveNum = 150 - hrrest;
                const hrReserveDen = avgHr - hrrest;
                if (!(hrReserveNum > 0) || !(hrReserveDen > 0)) return null;
                const speed150 = avgSpeed * (hrReserveNum / hrReserveDen);
                const paceMinKm = 1000 / (speed150 * 60);
                
                const pace150Str = formatPaceFromMinPerKm(paceMinKm);
                
                return {
                    ...r,
                    avgEarlyHr: avgHr,
                    avgEarlySpeed: avgSpeed,
                    pace150: paceMinKm,
                    pace150Str
                };
            })
            .filter(Boolean);

        // Stats
        const avgHrAll = withHR.reduce((s, r) => s + r.avgHr, 0) / withHR.length;
        const maxHrEver = Math.max(...withHR.map(r => r.maxHr));
        const lowestAvgHr = withHR.reduce((min, r) => r.avgHr < min.avgHr ? r : min, withHR[0]);
        const highestAvgHr = withHR.reduce((max, r) => r.avgHr > max.avgHr ? r : max, withHR[0]);

        // Median HR for reference line
        const sortedHrs = [...withHR.map(r => r.avgHr)].sort((a, b) => a - b);
        const medianHr = sortedHrs[Math.floor(sortedHrs.length / 2)];

        // --- DIAGNOSIS LOGIC ---
        // 1. Compare last month with previous baseline for similar GAP intensity
        const baseRuns = withHR.filter(r => r.km > 5 && r.elevPerKm < 15);
        // Corte en días LOCALES: comparar un instante UTC con la hora UTC de la
        // actividad movía la frontera un día según el huso del atleta.
        const last30Days = daysAgoISO(30);
        const recentBase = baseRuns.filter(r => r.day && r.day >= last30Days);
        const baselineBase = baseRuns.filter(r => !r.day || r.day < last30Days);

        let hrDeviation = 0;
        if (recentBase.length >= 2 && baselineBase.length >= 2) {
            const avgRecent = recentBase.reduce((s, r) => s + r.avgHr, 0) / recentBase.length;
            const avgBaseline = baselineBase.reduce((s, r) => s + r.avgHr, 0) / baselineBase.length;
            hrDeviation = avgRecent - avgBaseline;
        }

        // 2. Detect high drift
        const avgDrift = driftPcts.length > 0 ? driftPcts.reduce((s, v) => s + v, 0) / driftPcts.length : null;
        const driftLevel = decouplingLevel(avgDrift);
        const highDrift = driftLevel === 'high' || driftLevel === 'very_high';

        // 3. Tendencia de eficiencia (primer 25% vs último 25% de los puntos).
        // Sobre `ef` en m/latido, donde MÁS es mejor: con la métrica invertida que
        // había antes, el sentido de la comparación estaba al revés que el de la
        // gráfica del resumen vital.
        let effTrend = "stable";
        if (efficiencyData.length >= 6) {
            const chunk = Math.max(2, Math.floor(efficiencyData.length * 0.25));
            const startEf = efficiencyData.slice(0, chunk).reduce((s, r) => s + r.ef, 0) / chunk;
            const endEf = efficiencyData.slice(-chunk).reduce((s, r) => s + r.ef, 0) / chunk;
            if (endEf > startEf * 1.05) effTrend = "improving";
            else if (endEf < startEf * 0.95) effTrend = "worsening";
        }

        return {
            timeline: withHR,
            scatterData,
            efficiencyData,
            pace150Data,
            uniqueMonths,
            stats: { avgHrAll, maxHrEver, lowestAvgHr, highestAvgHr, medianHr },
            diagnosis: {
                hrDeviation,
                highDrift,
                avgDrift,
                driftLevel,
                driftCount: driftPcts.length,
                effTrend,
                recentCount: recentBase.length
            },
        };
    }, [filteredActivities, hrrest, i18n.language]);

    if (!processedData) {
        return (
            <div className="text-center py-12 text-slate-400">
                <HeartIcon className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-sm">{t('hr_analysis.no_data')}</p>
                <p className="text-xs mt-1">{t('hr_analysis.check_hr')}</p>
            </div>
        );
    }

    const tabs = [
        { id: "overview", label: t('hr_analysis.tabs.overview') },
        { id: "scatter", label: t('hr_analysis.tabs.scatter') },
        { id: "efficiency", label: t('hr_analysis.tabs.efficiency') },
        { id: "diagnosis", label: t('hr_analysis.tabs.diagnosis') },
    ];

    const { timeline, scatterData, efficiencyData, pace150Data, uniqueMonths, stats, diagnosis } = processedData;

    return (
        <div className="space-y-5">
            {/* Banner Diagnóstico Automático */}
            {diagnosis.hrDeviation > 5 && (
                <div className="bg-white border-l-8 border-rose-500 rounded-2xl p-6 flex gap-5 items-start shadow-xl shadow-rose-100/20 border border-slate-100 animate-pulse-subtle">
                    <div className="bg-rose-100 text-rose-600 p-3 rounded-2xl shrink-0">
                        <ExclamationTriangleIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <h4 className="text-slate-900 font-black text-sm uppercase tracking-tight mb-1">{t('hr_analysis.diagnosis.critical_pattern')}</h4>
                        <p className="text-slate-500 text-sm leading-relaxed font-medium">
                            {t('hr_analysis.diagnosis.deviation_msg', { bpm: Math.round(diagnosis.hrDeviation) })}
                        </p>
                    </div>
                </div>
            )}

            {/* Filter + Tabs header */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="flex-1 flex gap-1 bg-slate-50 rounded-2xl p-1.5 border border-slate-100 shrink-0 shadow-sm">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300
                                ${activeTab === t.id
                                    ? "bg-slate-900 text-white shadow-lg shadow-slate-200 scale-105"
                                    : "text-slate-400 hover:text-slate-600 hover:bg-white"
                                }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Tope de sesiones. El PERÍODO es el compartido (barra superior); esto
                    solo limita cuántas se dibujan, porque los gráficos van sesión a sesión. */}
                <div className="flex items-center gap-2 bg-white border border-slate-100 rounded-2xl px-4 h-[48px] shadow-sm">
                    <ClockIcon className="w-4 h-4 text-slate-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('hr_analysis.filters.last')}</span>
                    <input
                        type="number"
                        value={lastNRuns}
                        onChange={(e) => setLastNRuns(Math.max(1, parseInt(e.target.value) || 0))}
                        className="w-10 text-sm font-black text-slate-900 bg-transparent border-0 p-0 focus:ring-0 text-center tabular-nums"
                    />
                    <span className="text-[9px] text-slate-400 font-black uppercase tracking-tighter">{t('hr_analysis.filters.runs')}</span>
                </div>
            </div>

            {/* ===================== OVERVIEW TAB ===================== */}
            {activeTab === "overview" && (
                <div className="space-y-5">
                    {/* Key metric cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[
                            {
                                label: t('hr_analysis.stats.avg_hr'),
                                value: Math.round(stats.avgHrAll),
                                unit: "bpm",
                                sub: t('hr_analysis.stats.sessions', { count: timeline.length }),
                                icon: HeartIcon,
                                color: "text-blue-600",
                                bg: "bg-blue-50",
                                border: "border-blue-100"
                            },
                            {
                                label: t('hr_analysis.stats.max_hr'),
                                value: Math.round(stats.maxHrEver),
                                unit: "bpm",
                                sub: t('hr_analysis.stats.limit'),
                                icon: FireIcon,
                                color: "text-rose-600",
                                bg: "bg-rose-50",
                                border: "border-rose-100"
                            },
                            {
                                label: t('hr_analysis.stats.min_effort'),
                                value: Math.round(stats.lowestAvgHr.avgHr),
                                unit: "bpm",
                                sub: `${stats.lowestAvgHr.dateFormatted}`,
                                icon: SparklesIcon,
                                color: "text-emerald-600",
                                bg: "bg-emerald-50",
                                border: "border-emerald-100"
                            },
                            {
                                label: t('hr_analysis.stats.max_effort'),
                                value: Math.round(stats.highestAvgHr.avgHr),
                                unit: "bpm",
                                sub: `${stats.highestAvgHr.dateFormatted}`,
                                icon: ExclamationTriangleIcon,
                                color: "text-amber-600",
                                bg: "bg-amber-50",
                                border: "border-amber-100"
                            },
                        ].map((card, i) => (
                            <div key={i} className={`bg-white rounded-2xl p-6 border ${card.border} shadow-sm transition-all hover:shadow-md group`}>
                                <div className="flex justify-between items-start mb-4">
                                  <div className={`p-2 rounded-xl ${card.bg} ${card.color} transition-transform group-hover:scale-110`}>
                                      <card.icon className="w-5 h-5" />
                                  </div>
                                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{card.label}</div>
                                </div>
                                <div className="flex items-baseline gap-1.5">
                                    <span className={`text-3xl font-black text-slate-900 tabular-nums leading-none`}>
                                        {card.value}
                                    </span>
                                    <span className="text-xs font-bold text-slate-400 capitalize">{card.unit}</span>
                                </div>
                                <div className="text-[11px] font-bold text-slate-400 mt-3 flex items-center gap-1.5">
                                  <div className="w-1 h-1 rounded-full bg-slate-200" />
                                  {card.sub}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Comparative Cards (Anomalies) */}
                    {diagnosis.recentCount >= 2 && Math.abs(diagnosis.hrDeviation) > 2 && (
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                            <div className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-sm">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">FC Rodaje Base</div>
                                <div className="text-2xl font-extrabold text-slate-700 tabular-nums">
                                    {Math.round(stats.avgHrAll - diagnosis.hrDeviation)} <span className="text-xs font-normal text-slate-400">bpm</span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-1">Nivel histórico de referencia</div>
                            </div>
                            <div className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-sm">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">FC Rodaje Reciente</div>
                                <div className="text-2xl font-extrabold text-rose-600 tabular-nums">
                                    {Math.round(stats.avgHrAll)} <span className="text-xs font-normal text-slate-400">bpm</span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-1">Últimas {diagnosis.recentCount} sesiones (GAP similar)</div>
                            </div>
                            <div className={`rounded-xl p-4 border ${diagnosis.hrDeviation > 5 ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-200'} col-span-2 lg:col-span-1 shadow-sm`}>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Desviación detectada</div>
                                <div className={`text-2xl font-extrabold tabular-nums ${diagnosis.hrDeviation > 5 ? 'text-rose-600' : 'text-slate-700'}`}>
                                    {diagnosis.hrDeviation > 0 ? '+' : ''}{Math.round(diagnosis.hrDeviation)} <span className="text-xs font-normal opacity-70">bpm</span>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-1">
                                    {diagnosis.hrDeviation > 5 ? '⚠️ Variación significativa' : 'Desviación moderada'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Timeline Chart */}
                    <div className="bg-white rounded-xl border border-slate-200/80 p-5">
                        <h3 className="text-sm font-bold text-slate-800 mb-0.5">FC Media por Sesión</h3>
                        <p className="text-[11px] text-slate-400 mb-4">Color = mes · Tamaño proporcional a distancia</p>
                        <ResponsiveContainer width="100%" height={280}>
                            <ComposedChart data={timeline.map((r, i) => ({ ...r, idx: i }))}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                                <XAxis
                                    dataKey="dateShort"
                                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                                    interval={Math.max(0, Math.floor(timeline.length / 10))}
                                />
                                <YAxis
                                    domain={[
                                        (dataMin) => Math.floor(dataMin / 5) * 5 - 5,
                                        (dataMax) => Math.ceil(dataMax / 5) * 5 + 5
                                    ]}
                                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                                />
                                <Tooltip content={<CustomTooltipTimeline />} />
                                <ReferenceLine y={Math.round(stats.medianHr)} stroke="#2563eb" strokeDasharray="5 5" strokeOpacity={0.4} />
                                <Line
                                    type="monotone"
                                    dataKey="avgHr"
                                    stroke="#f87171"
                                    strokeWidth={2}
                                    activeDot={{ onClick: (e, payload) => openStrava(payload?.payload?.id), cursor: 'pointer' }}
                                    dot={(props) => {
                                        const { cx, cy, payload } = props;
                                        if (hiddenMonths.has(payload.month)) return null;
                                        const r = Math.max(3, Math.min(7, payload.km / 4));
                                        return (
                                            <circle
                                                key={payload.id}
                                                cx={cx}
                                                cy={cy}
                                                r={r}
                                                fill={payload.color}
                                                stroke={payload.color}
                                                strokeWidth={1.5}
                                                fillOpacity={0.75}
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => openStrava(payload.id)}
                                            />
                                        );
                                    }}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                        {/* Clickable Legend */}
                        <div className="flex flex-wrap gap-4 justify-center mt-3 text-[11px]">
                            {uniqueMonths.slice(-6).map(m => (
                                <button
                                    key={m.key}
                                    onClick={() => toggleMonth(m.monthIndex)}
                                    className={`flex items-center gap-1.5 transition-opacity ${hiddenMonths.has(m.monthIndex) ? 'opacity-30 line-through' : 'opacity-100'}`}
                                >
                                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: MONTH_COLORS[m.monthIndex] }} />
                                    <span className="text-slate-500">{m.label}</span>
                                </button>
                            ))}
                            <span className="text-blue-400 text-[10px]">--- mediana: {Math.round(stats.medianHr)} bpm</span>
                        </div>
                    </div>

                </div>
            )}

            {/* ===================== SCATTER TAB ===================== */}
            {activeTab === "scatter" && (
                <div className="space-y-5">
                    <div className="bg-white rounded-xl border border-slate-200/80 p-5">
                        <h3 className="text-sm font-bold text-slate-800 mb-0.5">FC Media vs GAP (Ritmo Ajustado)</h3>
                        <p className="text-[11px] text-slate-400 mb-4">Todas las carreras &gt;3km · Velocidad ajustada por desnivel (GAP) · Mismo GAP → ¿FC más alta en ciertos meses?</p>
                        {scatterData.length > 0 ? (
                            <>
                                <ResponsiveContainer width="100%" height={320}>
                                    <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                                        <XAxis
                                            type="number"
                                            dataKey="speed"
                                            name="Velocidad"
                                            unit=" m/s"
                                            domain={["auto", "auto"]}
                                            tick={{ fontSize: 11, fill: "#94a3b8" }}
                                            label={{ value: "GAP Velocidad (m/s) →", position: "bottom", offset: 0, style: { fontSize: 11, fill: "#94a3b8" } }}
                                        />
                                        <YAxis
                                            type="number"
                                            dataKey="hr"
                                            name="FC media"
                                            unit=" bpm"
                                            domain={["auto", "auto"]}
                                            tick={{ fontSize: 11, fill: "#94a3b8" }}
                                            label={{ value: "FC (bpm) →", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#94a3b8" } }}
                                        />
                                        <Tooltip content={<CustomTooltipScatter />} />
                                        <Scatter
                                            data={scatterData.filter(d => !hiddenMonths.has(d.month))}
                                            shape="circle"
                                            onClick={(data) => openStrava(data?.id)}
                                            cursor="pointer"
                                        >
                                            {scatterData.filter(d => !hiddenMonths.has(d.month)).map((entry, i) => (
                                                <Cell
                                                    key={i}
                                                    fill={entry.color}
                                                    fillOpacity={0.8}
                                                    r={5}
                                                    stroke="white"
                                                    strokeWidth={1}
                                                />
                                            ))}
                                        </Scatter>
                                    </ScatterChart>
                                </ResponsiveContainer>
                                {/* Clickable Legend */}
                                <div className="flex flex-wrap gap-4 justify-center mt-3 text-[11px]">
                                    {uniqueMonths.slice(-6).map(m => (
                                        <button
                                            key={m.key}
                                            onClick={() => toggleMonth(m.monthIndex)}
                                            className={`flex items-center gap-1.5 transition-opacity ${hiddenMonths.has(m.monthIndex) ? 'opacity-30 line-through' : 'opacity-100'}`}
                                        >
                                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: MONTH_COLORS[m.monthIndex] }} />
                                            <span className="text-slate-500">{m.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-slate-400 text-center py-8">No hay suficientes carreras llanas con FC para mostrar.</p>
                        )}
                    </div>

                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-[13px] leading-relaxed text-slate-600">
                        <strong className="text-blue-600">💡 Cómo leer:</strong> Si para la misma velocidad tu FC sube con el tiempo, puede indicar fatiga acumulada, deshidratación o cambio de condiciones. Los puntos del mismo color (mes) deberían agruparse.
                    </div>
                </div>
            )}

            {/* ===================== DRIFT TAB ===================== */}
            {/* ===================== EFFICIENCY TAB ===================== */}
            {activeTab === "efficiency" && (
                <div className="space-y-5">
                    <div className="bg-white rounded-xl border border-slate-200/80 p-5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                            <div>
                                <h3 className="text-sm font-bold text-slate-800 mb-0.5">Eficiencia Cardíaca</h3>
                                <p className="text-[11px] text-slate-400">
                                    Carreras llanas (&lt;2.5% pendiente, &gt;3.5km, GAP &lt;7:00/km).
                                    {effMetric === "hre" ? " Menos latidos/km = más eficiente." : " Más metros por latido = más eficiente."}
                                </p>
                            </div>
                            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100/80 shrink-0">
                                <button
                                    onClick={() => setEffMetric("hre")}
                                    className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all duration-150
                                        ${effMetric === "hre"
                                            ? "bg-white text-slate-900 shadow-sm"
                                            : "text-slate-500 hover:text-slate-700"
                                        }`}
                                >
                                    HRE (lat/km)
                                </button>
                                <button
                                    onClick={() => setEffMetric("ef")}
                                    className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all duration-150
                                        ${effMetric === "ef"
                                            ? "bg-white text-slate-900 shadow-sm"
                                            : "text-slate-500 hover:text-slate-700"
                                        }`}
                                >
                                    EF (m/latido)
                                </button>
                            </div>
                        </div>
                        {efficiencyData.length > 0 ? (
                            <>
                                <ResponsiveContainer width="100%" height={280}>
                                    <ComposedChart data={efficiencyData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                                        <XAxis
                                            dataKey="dateShort"
                                            tick={{ fontSize: 10, fill: "#94a3b8" }}
                                            interval={Math.max(0, Math.floor(efficiencyData.length / 10))}
                                        />
                                        <YAxis
                                            domain={["auto", "auto"]}
                                            tick={{ fontSize: 11, fill: "#94a3b8" }}
                                            label={{ value: effMetric === "hre" ? "Latidos/km" : "Metros por latido", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#94a3b8" } }}
                                        />
                                        <Tooltip content={({ active, payload }) => {
                                            if (active && payload?.[0]) {
                                                const d = payload[0].payload;
                                                return (
                                                    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-200 text-[13px] shadow-xl">
                                                        <div className="font-bold text-white">{d.name}</div>
                                                        <div className="text-slate-400">{d.dateFormatted} · {d.km.toFixed(1)}km</div>
                                                        <div className="text-rose-400">FC: {Math.round(d.avgHr)} bpm</div>
                                                        <div className="text-emerald-400">GAP: {d.gap}/km (real: {d.rawPace}/km)</div>
                                                        <div className="text-cyan-400">HRE: {Math.round(d.hre)} lat/km</div>
                                                        <div className="text-blue-400">EF: {d.ef.toFixed(2)} m/latido</div>
                                                        <div className="text-amber-400">Elev: {Math.round(d.elev)}m D+</div>
                                                        <div className="text-blue-400 text-[11px] mt-1.5 opacity-70">🔗 Click para ver en Strava</div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }} />
                                        <Area
                                            type="monotone"
                                            dataKey={effMetric}
                                            stroke={effMetric === "hre" ? "#0891b2" : "#3b82f6"}
                                            fill={effMetric === "hre" ? "#0891b2" : "#3b82f6"}
                                            fillOpacity={0.08}
                                            strokeWidth={0}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey={effMetric}
                                            stroke={effMetric === "hre" ? "#0891b2" : "#3b82f6"}
                                            strokeWidth={2.5}
                                            activeDot={{ onClick: (e, payload) => openStrava(payload?.payload?.id), cursor: 'pointer' }}
                                            dot={(props) => {
                                                const { cx, cy, payload } = props;
                                                return (
                                                    <circle
                                                        key={payload.id}
                                                        cx={cx}
                                                        cy={cy}
                                                        r={4}
                                                        fill={payload.color}
                                                        stroke="white"
                                                        strokeWidth={1.5}
                                                        style={{ cursor: 'pointer' }}
                                                        onClick={() => openStrava(payload.id)}
                                                    />
                                                );
                                            }}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>

                                {/* Efficiency summary cards */}
                                <div className="grid grid-cols-3 gap-3 mt-4">
                                    {(() => {
                                        const key = effMetric;
                                        const vals = efficiencyData.map(e => e[key]);
                                        const bestRun = efficiencyData.reduce((best, r) => r[key] < best[key] ? r : best, efficiencyData[0]);
                                        const worstRun = efficiencyData.reduce((worst, r) => r[key] > worst[key] ? r : worst, efficiencyData[0]);
                                        const avg = vals.reduce((s, r) => s + r, 0) / vals.length;
                                        const unit = key === "hre" ? "lat/km" : "bpm/(m/s)";
                                        const fmt = (v) => key === "hre" ? Math.round(v) : v.toFixed(1);
                                        return [
                                            { label: "Mejor Eficiencia", value: fmt(bestRun[key]), sub: bestRun.dateFormatted, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
                                            { label: "Media", value: fmt(avg), sub: unit, color: key === "hre" ? "text-cyan-600" : "text-blue-600", bg: key === "hre" ? "bg-cyan-50" : "bg-blue-50", border: key === "hre" ? "border-cyan-200" : "border-blue-200" },
                                            { label: "Peor Eficiencia", value: fmt(worstRun[key]), sub: worstRun.dateFormatted, color: "text-rose-600", bg: "bg-rose-50", border: "border-rose-200" },
                                        ];
                                    })().map((card, i) => (
                                        <div key={i} className={`${card.bg} rounded-xl p-3.5 border ${card.border}`}>
                                            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">{card.label}</div>
                                            <div className={`text-xl font-extrabold tabular-nums ${card.color}`}>{card.value}</div>
                                            <div className="text-[11px] text-slate-500 mt-1">{card.sub}</div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-slate-400 text-center py-8">No hay suficientes carreras llanas con FC para calcular eficiencia.</p>
                        )}
                    </div>

                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-[13px] leading-relaxed text-slate-600">
                        {effMetric === "hre" ? (
                            <><strong className="text-cyan-600">🧠 HRE (Heart Rate Efficiency):</strong> Mide cuántos latidos necesita tu corazón para recorrer 1 km (<code className="text-[11px] bg-white/60 px-1 rounded">FC × ritmo GAP</code>). Respaldado por estudios en <em>ResearchGate</em> y <em>arXiv</em>. Un valor <strong>decreciente</strong> indica mejora cardiovascular. Valores típicos: 600-900 lat/km (élite ~550-650).</>
                        ) : (
                            <><strong className="text-blue-600">🧠 EF (Efficiency Factor):</strong> Los metros que recorres por cada latido (<code className="text-[11px] bg-white/60 px-1 rounded">velocidad GAP × 60 / FC</code>), la convención de TrainingPeaks y la misma cifra que verás en el resumen vital. Un EF <strong>creciente</strong> indica que tu corazón es más eficiente. Si baja, puede indicar fatiga, calor, deshidratación o pérdida de forma. Es el recíproco exacto del HRE: 1.000 / EF = latidos por km.</>
                        )}
                    </div>

                    {/* Pace at 150 BPM Chart */}
                    <div className="bg-white rounded-xl border border-slate-200/80 p-5 mt-5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                            <div>
                                <h3 className="text-sm font-bold text-slate-800 mb-0.5">Ritmo a 150 BPM (Fase Base)</h3>
                                <p className="text-[11px] text-slate-400">
                                    En tiradas llanas (&gt;6km). Muestra el rendimiento aeróbico sin deriva cardíaca (km 1-6). Menor tiempo = mejor forma.
                                </p>
                            </div>
                        </div>
                        {pace150Data && pace150Data.length > 0 ? (
                            <>
                                <ResponsiveContainer width="100%" height={280}>
                                    <ComposedChart data={pace150Data}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                                        <XAxis
                                            dataKey="dateShort"
                                            tick={{ fontSize: 10, fill: "#94a3b8" }}
                                            interval={Math.max(0, Math.floor(pace150Data.length / 10))}
                                        />
                                        <YAxis
                                            domain={["auto", "auto"]}
                                            tick={{ fontSize: 11, fill: "#94a3b8" }}
                                            tickFormatter={(val) => formatPaceFromMinPerKm(val)}
                                            reversed={true}
                                            label={{ value: "Ritmo (min/km)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#94a3b8" } }}
                                        />
                                        <Tooltip content={({ active, payload }) => {
                                            if (active && payload?.[0]) {
                                                const d = payload[0].payload;
                                                return (
                                                    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-200 text-[13px] shadow-xl">
                                                        <div className="font-bold text-white">{d.name}</div>
                                                        <div className="text-slate-400">{d.dateFormatted} · {d.km.toFixed(1)}km total</div>
                                                        <div className="text-emerald-400 font-bold mt-1">Ritmo @ 150 bpm: {d.pace150Str}/km</div>
                                                        <div className="text-rose-400">Datos reales (km 1-6): {Math.round(d.avgEarlyHr)} bpm @ {formatPaceFromSpeed(d.avgEarlySpeed)}/km</div>
                                                        <div className="text-blue-400 text-[11px] mt-1.5 opacity-70">🔗 Click para ver en Strava</div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }} />
                                        <Line
                                            type="monotone"
                                            dataKey="pace150"
                                            stroke="#10b981"
                                            strokeWidth={2.5}
                                            activeDot={{ onClick: (e, payload) => openStrava(payload?.payload?.id), cursor: 'pointer' }}
                                            dot={(props) => {
                                                const { cx, cy, payload } = props;
                                                return (
                                                    <circle
                                                        key={payload.id}
                                                        cx={cx}
                                                        cy={cy}
                                                        r={4}
                                                        fill={payload.color || "#10b981"}
                                                        stroke="white"
                                                        strokeWidth={1.5}
                                                        style={{ cursor: 'pointer' }}
                                                        onClick={() => openStrava(payload.id)}
                                                    />
                                                );
                                            }}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
                                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mt-4 text-[13px] leading-relaxed text-slate-600">
                                    <strong className="text-emerald-600">📈 Ritmo a 150 BPM:</strong> Calcula a qué ritmo correrías a 150 pulsaciones exactamente, aislando la deriva cardíaca (fatiga) al medir solo los primeros 6 km. Una línea descendente significa que puedes correr más rápido con el mismo pulso.
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-slate-400 text-center py-8">No hay suficientes tiradas llanas con datos por parciales para calcular el ritmo a 150 BPM.</p>
                        )}
                    </div>
                </div>
            )}
            {/* ===================== DIAGNOSIS TAB ===================== */}
            {activeTab === "diagnosis" && (
                <div className="space-y-5">
                    <div className="bg-white rounded-2xl border border-slate-200/80 p-6">
                        <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                            <FunnelIcon className="w-5 h-5 text-blue-500" />
                            Hallazgos detectados en tus datos
                        </h3>

                        <div className="space-y-6">
                            {/* Insight 1: HR Shift */}
                            <div className="flex gap-4 items-start pb-6 border-bottom border-slate-100 last:border-0">
                                <span className={`text-xl p-2 rounded-xl shrink-0 ${diagnosis.hrDeviation > 8 ? "bg-rose-100" : diagnosis.hrDeviation > 3 ? "bg-amber-100" : "bg-emerald-100"}`}>
                                    {diagnosis.hrDeviation > 5 ? "🔴" : "🟢"}
                                </span>
                                <div>
                                    <h4 className="font-bold text-slate-900 text-[15px] mb-1">Frecuencia Cardíaca de Ejercicio</h4>
                                    <p className="text-slate-500 text-[13px] leading-relaxed">
                                        {diagnosis.hrDeviation > 5
                                            ? `Tus rodajes llanos muestran una subida de ${Math.round(diagnosis.hrDeviation)} bpm para el mismo esfuerzo. Este desplazamiento es una señal clara de que tu cuerpo está trabajando más duro por la misma velocidad.`
                                            : "Mantienes una FC estable en relación a tu velocidad histórica. No se detectan anomalías en el pulso de ejercicio."
                                        }
                                    </p>
                                </div>
                            </div>

                            {/* Insight 2: Drift */}
                            <div className="flex gap-4 items-start pb-6 border-bottom border-slate-100">
                                <span className={`text-xl p-2 rounded-xl shrink-0 ${diagnosis.highDrift ? "bg-orange-100" : "bg-emerald-100"}`}>
                                    {diagnosis.highDrift ? "🟡" : "🟢"}
                                </span>
                                <div>
                                    <h4 className="font-bold text-slate-900 text-[15px] mb-1">Deriva Cardíaca (Intrasalida)</h4>
                                    <p className="text-slate-500 text-[13px] leading-relaxed">
                                        {diagnosis.avgDrift == null
                                            ? "Aún no hay carreras con parciales en el período para medir la deriva."
                                            : diagnosis.highDrift
                                                ? `Deriva media de ${diagnosis.avgDrift.toFixed(1)} % (Pa:HR, ${diagnosis.driftCount} carreras): ${t(`decoupling.levels.${diagnosis.driftLevel}`).toLowerCase()}. Una deriva sostenida por encima del 8 % en salidas suaves suele apuntar a deshidratación, calor, pérdida de volumen plasmático o falta de hierro.`
                                                : `Deriva media de ${diagnosis.avgDrift.toFixed(1)} % (Pa:HR, ${diagnosis.driftCount} carreras): ${t(`decoupling.levels.${diagnosis.driftLevel}`).toLowerCase()}. Tu sistema cardiovascular mantiene bien el acoplamiento ritmo-pulso.`
                                        }
                                    </p>
                                </div>
                            </div>

                            {/* Insight 3: Efficiency */}
                            <div className="flex gap-4 items-start">
                                <span className={`text-xl p-2 rounded-xl shrink-0 ${diagnosis.effTrend === "worsening" ? "bg-rose-100" : diagnosis.effTrend === "improving" ? "bg-emerald-100" : "bg-slate-100"}`}>
                                    {diagnosis.effTrend === "worsening" ? "📉" : diagnosis.effTrend === "improving" ? "📈" : "⚖️"}
                                </span>
                                <div>
                                    <h4 className="font-bold text-slate-900 text-[15px] mb-1">Tendencia de Eficiencia (m/latido)</h4>
                                    <p className="text-slate-500 text-[13px] leading-relaxed">
                                        {diagnosis.effTrend === "worsening"
                                            ? "Tu eficiencia está empeorando: recorres menos metros por latido que hace un mes."
                                            : diagnosis.effTrend === "improving"
                                                ? "¡Felicidades! Tu eficiencia cardiovascular está mejorando. Tu corazón es cada vez más capaz de moverte a la misma velocidad con menos esfuerzo."
                                                : "Tu eficiencia se mantiene estable en el tiempo."
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action Items */}
                    <div className="bg-blue-900 text-white rounded-2xl p-6 shadow-xl shadow-blue-100">
                        <h3 className="text-base font-bold mb-5 flex items-center gap-2">
                            <ClockIcon className="w-5 h-5 text-blue-300" />
                            Próximos pasos recomendados
                        </h3>

                        <div className="space-y-4">
                            {[
                                { id: "1", task: "Analítica de sangre: Pide niveles de Ferritina, Hierro, Hemoglobina y Magnesio.", prio: "Crítico" },
                                { id: "2", task: "Hidratación: Asegúrate de beber al menos 2.5L diarios con electrolitos en días de calor.", prio: "Alta" },
                                { id: "3", task: "Descanso Activo: Si descargas un 20% el volumen semanal, el pulso debería bajar en 7-10 días.", prio: "Media" },
                                { id: "4", task: "Monitoriza FC Reposo: Si la FC al despertar también sube >5 bpm, detén los entrenamientos intensos.", prio: "Alta" }
                            ].map((item, i) => (
                                <div key={i} className="flex items-start gap-4 p-3 rounded-xl bg-white/10 hover:bg-white/15 transition-colors">
                                    <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-xs shrink-0">{item.id}</div>
                                    <div className="flex-1">
                                        <div className="text-[14px] font-medium leading-tight">{item.task}</div>
                                        <div className="text-[10px] uppercase font-bold text-blue-300 mt-1.5 tracking-wider">Prioridad: {item.prio}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <p className="text-[11px] text-slate-400 italic text-center px-4">
                        * Este diagnóstico es orientativo basado en algoritmos de datos Strava y no sustituye el criterio de un profesional médico o de cardiología deportiva.
                    </p>
                </div>
            )}
        </div>
    );
}
