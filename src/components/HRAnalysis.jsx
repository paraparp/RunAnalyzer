import { useState, useMemo } from "react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ScatterChart, Scatter, Cell, ReferenceLine,
    BarChart, Bar, ComposedChart, Area, AreaChart
} from "recharts";
import {
    CalendarIcon,
    ClockIcon,
    FunnelIcon,
    ChevronDownIcon,
    ArrowPathIcon,
    HeartIcon,
    ExclamationTriangleIcon
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

const getMonthLabel = (monthIndex) => {
    return ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][monthIndex] || "";
};

const formatPaceFromSpeed = (speedMs) => {
    if (!speedMs || speedMs === 0) return "0:00";
    const paceMinKm = 1000 / (speedMs * 60);
    const minutes = Math.floor(paceMinKm);
    const seconds = Math.round((paceMinKm - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

// GAP = Grade Adjusted Pace: removes elevation penalty so trail & flat are comparable
const calculateGAP = (speedMs, distanceKm, elevGain) => {
    if (!speedMs || speedMs === 0 || !distanceKm || distanceKm === 0) return { gap: "0:00", gapMinKm: 0 };
    const rawPaceMinKm = 1000 / (speedMs * 60);
    const elevPerKm = elevGain / distanceKm;
    const adjustmentMin = (elevPerKm / 10) * 8 / 60; // ~8s per 10m D+/km
    const gapMinKm = Math.max(rawPaceMinKm - adjustmentMin, rawPaceMinKm * 0.80);
    const minutes = Math.floor(gapMinKm);
    const seconds = Math.round((gapMinKm - minutes) * 60);
    return { gap: `${minutes}:${seconds.toString().padStart(2, "0")}`, gapMinKm };
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
                <div className="text-indigo-400 text-[11px] mt-1.5 opacity-70">🔗 Click para ver en Strava</div>
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
                <div className="text-indigo-400 text-[11px] mt-1.5 opacity-70">🔗 Click para ver en Strava</div>
            </div>
        );
    }
    return null;
};

const CustomTooltipDrift = ({ active, payload, label }) => {
    if (active && payload?.length) {
        return (
            <div className="bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-200 text-[13px] shadow-xl">
                <div className="font-semibold mb-1">Km {label}</div>
                {payload.map((p, i) => {
                    const isEff = p.name.includes("Eff");
                    const unit = isEff ? "" : "bpm";
                    const val = isEff ? p.value.toFixed(1) : Math.round(p.value);
                    return (
                        <div key={i} style={{ color: p.color }}>
                            {p.name}: {val} {unit}
                        </div>
                    );
                })}
                <div className="text-[10px] text-slate-500 mt-1">🔗 Click punto para Strava</div>
            </div>
        );
    }
    return null;
};

const CustomTooltipVolume = ({ active, payload }) => {
    if (active && payload?.[0]) {
        const d = payload[0].payload;
        return (
            <div className="bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-200 text-[13px] shadow-xl">
                <div className="font-semibold text-white">{d.label}</div>
                <div>{d.km.toFixed(1)} km · {d.runs} salidas</div>
                <div className="text-rose-400">FC media: {d.avgHr ? Math.round(d.avgHr) : "-"} bpm</div>
            </div>
        );
    }
    return null;
};

export default function HRAnalysis({ activities, onEnrichActivity }) {
    const [activeTab, setActiveTab] = useState("overview");
    const [filterMode, setFilterMode] = useState("last"); // "last" or "year"
    const [lastNRuns, setLastNRuns] = useState(30);
    const [selectedYear, setSelectedYear] = useState("All");
    const [hiddenMonths, setHiddenMonths] = useState(new Set());
    const [hiddenDriftRuns, setHiddenDriftRuns] = useState(new Set());
    const [driftView, setDriftView] = useState("hr"); // "hr" or "eff"
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);

    const toggleMonth = (monthIndex) => {
        setHiddenMonths(prev => {
            const next = new Set(prev);
            if (next.has(monthIndex)) next.delete(monthIndex);
            else next.add(monthIndex);
            return next;
        });
    };

    const toggleDriftRun = (runIndex) => {
        setHiddenDriftRuns(prev => {
            const next = new Set(prev);
            if (next.has(runIndex)) next.delete(runIndex);
            else next.add(runIndex);
            return next;
        });
    };

    const handleSyncMissing = async (missingIds) => {
        if (!onEnrichActivity || isSyncing) return;
        setIsSyncing(true);
        setSyncProgress(0);
        try {
            let count = 0;
            for (const id of missingIds) {
                await onEnrichActivity(id);
                count++;
                setSyncProgress(count);
            }
        } finally {
            setIsSyncing(false);
            setSyncProgress(0);
        }
    };

    // Available years from activities
    const availableYears = useMemo(() => {
        if (!activities || activities.length === 0) return [];
        const years = new Set(
            activities
                .filter(a => a.average_heartrate && a.average_heartrate > 0)
                .map(a => new Date(a.start_date).getFullYear())
        );
        return Array.from(years).sort((a, b) => b - a);
    }, [activities]);

    // Filter activities based on mode
    const filteredActivities = useMemo(() => {
        if (!activities || activities.length === 0) return [];
        if (filterMode === "year") {
            if (selectedYear === "All") return activities;
            return activities.filter(a => new Date(a.start_date).getFullYear() === parseInt(selectedYear));
        }
        // "last" mode: take last N runs sorted by date
        const sorted = [...activities].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
        return sorted.slice(0, lastNRuns).reverse(); // reverse back to chronological
    }, [activities, filterMode, selectedYear, lastNRuns]);

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
                const { gap, gapMinKm } = calculateGAP(speedMs, km, elev);
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
                    monthLabel: getMonthLabel(date.getMonth()),
                    yearMonth: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
                    color: getMonthColor(a.start_date),
                    movingTime: a.moving_time,
                    timestamp: date.getTime(),
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
            return { key: ym, label: getMonthLabel(parseInt(m) - 1), year: y, monthIndex: parseInt(m) - 1 };
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

        // Monthly volume
        const monthlyMap = {};
        withHR.forEach(r => {
            if (!monthlyMap[r.yearMonth]) {
                monthlyMap[r.yearMonth] = { km: 0, runs: 0, totalHr: 0, hrCount: 0, totalLoad: 0, label: `${r.monthLabel}`, monthIndex: r.month };
            }
            monthlyMap[r.yearMonth].km += r.km;
            monthlyMap[r.yearMonth].runs += 1;
            monthlyMap[r.yearMonth].totalHr += r.avgHr;
            monthlyMap[r.yearMonth].hrCount += 1;
            monthlyMap[r.yearMonth].totalLoad += r.suffer_score || 0;
        });
        const monthlyVolume = Object.entries(monthlyMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-12)
            .map(([key, val]) => ({
                ...val,
                avgHr: val.hrCount > 0 ? val.totalHr / val.hrCount : 0,
                color: MONTH_COLORS[val.monthIndex],
                key,
            }));

        // Drift analysis: very permissive filter to satisfy "show everything"
        // Criteria: <8% gradient, ≥2km, GAP <10:00, must have splits with HR data
        const driftCandidates = withHR.filter(r =>
            r.elevPerKm < 80 && r.km >= 2 && r.gapMinKm > 0 && r.gapMinKm < 10 && r.splits && r.splits.length >= 3
        );

        // Identify runs that qualify for drift but are missing splits
        const missingDetails = withHR.filter(r =>
            r.elevPerKm < 80 && r.km >= 2 && r.gapMinKm > 0 && r.gapMinKm < 10 && (!r.splits || r.splits.length < 3)
        );

        // Drift data: extract HR per km from splits
        const driftRuns = driftCandidates
            .map((r, i) => {
                // Color scale: newest (high i) = vibrant Indigo, oldest (low i) = light Slate
                const ratio = i / (driftCandidates.length - 1 || 1);
                const hue = 210 + (ratio * 45); // 210 (slate/blue) to 255 (indigo/violet)
                const sat = 30 + (ratio * 55);  // 30% to 85%
                const light = 75 - (ratio * 25); // 75% to 50%
                const color = `hsl(${hue}, ${sat}%, ${light}%)`;

                return {
                    name: `${r.dateShort} ${r.name}`,
                    color: color,
                    isRecent: ratio > 0.85,
                    date: r.dateFormatted,
                    id: r.id,
                    data: r.splits.map((s, idx) => {
                        const speed = s.average_speed || 0;
                        const hr = s.average_heartrate || 0;
                        return {
                            km: idx + 1,
                            hr: hr,
                            pace: speed ? (1000 / (speed * 60)).toFixed(2) : 0,
                            eff: (hr > 0 && speed > 0) ? hr / speed : 0,
                        };
                    }).filter(s => s.hr > 0),
                    drift: 0,
                };
            })
            .filter(r => r.data.length >= 3)
            .map(r => {
                // Compare avg of first third vs last third for robust drift measurement
                const thirdLen = Math.max(1, Math.floor(r.data.length / 3));
                const firstThird = r.data.slice(0, thirdLen);
                const lastThird = r.data.slice(-thirdLen);
                const avgFirst = firstThird.reduce((s, d) => s + d.hr, 0) / firstThird.length;
                const avgLast = lastThird.reduce((s, d) => s + d.hr, 0) / lastThird.length;
                return { ...r, drift: avgLast - avgFirst };
            });

        // Efficiency data: HR/speed ratio for flat runs (<2.5% gradient, GAP < 7:00/km)
        const efficiencyData = withHR
            .filter(r => r.elevPerKm < 25 && r.km >= 3.5 && r.gapMinKm > 0 && r.gapMinKm < 7)
            .map(r => ({
                ...r,
                ratio: r.avgHr / (r.gapSpeed || r.speedMs),
                efficiency: (r.gapSpeed || r.speedMs) / r.avgHr * 1000,
            }));

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
        const last30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const recentBase = baseRuns.filter(r => r.timestamp > last30Days);
        const baselineBase = baseRuns.filter(r => r.timestamp <= last30Days);

        let hrDeviation = 0;
        if (recentBase.length >= 2 && baselineBase.length >= 2) {
            const avgRecent = recentBase.reduce((s, r) => s + r.avgHr, 0) / recentBase.length;
            const avgBaseline = baselineBase.reduce((s, r) => s + r.avgHr, 0) / baselineBase.length;
            hrDeviation = avgRecent - avgBaseline;
        }

        // 2. Detect high drift
        const highDrift = driftRuns.some(r => r.drift > 18);
        const avgDrift = driftRuns.length > 0 ? driftRuns.reduce((s, r) => s + r.drift, 0) / driftRuns.length : 0;

        // 3. Efficiency trend (compare first 20% vs last 20% of efficiency points)
        let effTrend = "stable";
        if (efficiencyData.length >= 6) {
            const chunk = Math.max(2, Math.floor(efficiencyData.length * 0.25));
            const startRatio = efficiencyData.slice(0, chunk).reduce((s, r) => s + r.ratio, 0) / chunk;
            const endRatio = efficiencyData.slice(-chunk).reduce((s, r) => s + r.ratio, 0) / chunk;
            if (endRatio > startRatio * 1.05) effTrend = "worsening";
            else if (endRatio < startRatio * 0.95) effTrend = "improving";
        }

        return {
            timeline: withHR,
            scatterData,
            monthlyVolume,
            driftRuns,
            efficiencyData,
            uniqueMonths,
            stats: { avgHrAll, maxHrEver, lowestAvgHr, highestAvgHr, medianHr },
            diagnosis: {
                hrDeviation,
                highDrift,
                avgDrift,
                effTrend,
                recentCount: recentBase.length
            },
            missingDetails: missingDetails.map(r => r.id)
        };
    }, [filteredActivities]);

    if (!processedData) {
        return (
            <div className="text-center py-12 text-slate-400">
                <HeartIcon className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-sm">No hay datos de frecuencia cardíaca disponibles.</p>
                <p className="text-xs mt-1">Asegúrate de que tus actividades tienen datos de FC.</p>
            </div>
        );
    }

    const tabs = [
        { id: "overview", label: "Resumen" },
        { id: "scatter", label: "FC vs Ritmo" },
        { id: "drift", label: "Deriva Cardíaca" },
        { id: "efficiency", label: "Eficiencia" },
        { id: "diagnosis", label: "Diagnóstico" },
    ];

    const { timeline, scatterData, monthlyVolume, driftRuns, efficiencyData, uniqueMonths, stats, diagnosis } = processedData;

    return (
        <div className="space-y-5">
            {/* Banner Diagnóstico Automático */}
            {diagnosis.hrDeviation > 5 && (
                <div className="bg-gradient-to-r from-rose-50 to-orange-50 border border-rose-200 rounded-2xl p-4 flex gap-4 items-start shadow-sm animate-pulse-subtle">
                    <div className="bg-rose-500 text-white p-1.5 rounded-lg shrink-0">
                        <ExclamationTriangleIcon className="w-5 h-5" />
                    </div>
                    <div>
                        <h4 className="text-rose-900 font-bold text-sm">Patrón detectado: Desviación Cardíaca</h4>
                        <p className="text-rose-700 text-[13px] leading-snug mt-1">
                            Tu FC media en rodajes llanos ha subido <strong className="font-extrabold">~{Math.round(diagnosis.hrDeviation)} bpm</strong> recientemente respecto a tu base histórica. Esto sugiere fatiga acumulada, deshidratación o cambio en la eficiencia cardiovascular.
                        </p>
                    </div>
                </div>
            )}

            {/* Filter + Tabs header */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="flex-1 flex gap-1 bg-slate-100 rounded-xl p-1 shrink-0">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`flex-1 py-2 px-3 rounded-lg text-[13px] font-medium transition-all duration-200
                                ${activeTab === t.id
                                    ? "bg-white text-slate-900 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                                }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Filter controls */}
                <div className="flex items-center gap-0 bg-white border border-slate-200 rounded-xl overflow-hidden h-[42px] shadow-sm">
                    {/* Funnel Icon */}
                    <div className="pl-3 pr-2 border-r border-slate-100 flex items-center justify-center bg-slate-50/30">
                        <FunnelIcon className="w-3.5 h-3.5 text-slate-400" />
                    </div>

                    {/* Mode Toggle */}
                    <div className="flex items-center">
                        <button
                            onClick={() => setFilterMode("last")}
                            className={`flex items-center gap-1.5 px-3 h-[42px] text-[11px] font-bold uppercase tracking-wider transition-colors
                                ${filterMode === "last"
                                    ? "bg-indigo-50 text-indigo-700 border-r border-indigo-100"
                                    : "text-slate-400 hover:bg-slate-50 border-r border-slate-100"}`}
                        >
                            <ClockIcon className="w-3.5 h-3.5" />
                            <span className="hidden xs:inline">Carreras</span>
                        </button>
                        <button
                            onClick={() => setFilterMode("year")}
                            className={`flex items-center gap-1.5 px-3 h-[42px] text-[11px] font-bold uppercase tracking-wider transition-colors
                                ${filterMode === "year"
                                    ? "bg-indigo-50 text-indigo-700 border-r border-indigo-100"
                                    : "text-slate-400 hover:bg-slate-50 border-r border-slate-100"}`}
                        >
                            <CalendarIcon className="w-3.5 h-3.5" />
                            <span className="hidden xs:inline">Año</span>
                        </button>
                    </div>

                    {/* Value Selector */}
                    <div className="flex items-center bg-slate-50/50 px-3 h-[42px]">
                        {filterMode === "last" ? (
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="number"
                                    value={lastNRuns}
                                    onChange={(e) => setLastNRuns(Math.max(1, parseInt(e.target.value) || 0))}
                                    className="w-10 text-[13px] font-bold text-slate-700 bg-transparent border-0 p-0 focus:ring-0 text-center"
                                />
                                <span className="text-[10px] text-slate-400 font-bold uppercase">Últimas</span>
                            </div>
                        ) : (
                            <div className="relative flex items-center">
                                <select
                                    value={selectedYear}
                                    onChange={(e) => setSelectedYear(e.target.value)}
                                    className="appearance-none text-[13px] font-bold text-slate-700 bg-transparent border-0 p-0 pr-6 focus:ring-0 cursor-pointer"
                                >
                                    <option value="All">Todos</option>
                                    {availableYears.map(y => (
                                        <option key={y} value={String(y)}>{y}</option>
                                    ))}
                                </select>
                                <ChevronDownIcon className="w-3 h-3 text-slate-400 absolute right-0 pointer-events-none" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ===================== OVERVIEW TAB ===================== */}
            {activeTab === "overview" && (
                <div className="space-y-5">
                    {/* Key metric cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            {
                                label: "FC Media Global",
                                value: Math.round(stats.avgHrAll),
                                unit: "bpm",
                                sub: `${timeline.length} sesiones con FC`,
                                gradient: "from-indigo-500 to-violet-500",
                                bg: "bg-indigo-50",
                            },
                            {
                                label: "FC Max Registrada",
                                value: Math.round(stats.maxHrEver),
                                unit: "bpm",
                                sub: "Máximo absoluto",
                                gradient: "from-rose-500 to-pink-500",
                                bg: "bg-rose-50",
                            },
                            {
                                label: "Sesión Más Baja",
                                value: Math.round(stats.lowestAvgHr.avgHr),
                                unit: "bpm",
                                sub: `${stats.lowestAvgHr.dateFormatted} · GAP ${stats.lowestAvgHr.gap}/km`,
                                gradient: "from-emerald-500 to-teal-500",
                                bg: "bg-emerald-50",
                            },
                            {
                                label: "Sesión Más Alta",
                                value: Math.round(stats.highestAvgHr.avgHr),
                                unit: "bpm",
                                sub: `${stats.highestAvgHr.dateFormatted} · GAP ${stats.highestAvgHr.gap}/km`,
                                gradient: "from-orange-500 to-red-500",
                                bg: "bg-amber-50",
                            },
                        ].map((card, i) => (
                            <div key={i} className={`${card.bg} rounded-xl p-4 border border-slate-200/60`}>
                                <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-2">{card.label}</div>
                                <div className="flex items-baseline gap-1.5">
                                    <span className={`text-3xl font-extrabold bg-gradient-to-r ${card.gradient} bg-clip-text text-transparent tabular-nums`}>
                                        {card.value}
                                    </span>
                                    <span className="text-xs font-medium text-slate-400">{card.unit}</span>
                                </div>
                                <div className="text-[11px] text-slate-500 mt-1.5">{card.sub}</div>
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
                                <ReferenceLine y={Math.round(stats.medianHr)} stroke="#6366f1" strokeDasharray="5 5" strokeOpacity={0.4} />
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
                            <span className="text-indigo-400 text-[10px]">--- mediana: {Math.round(stats.medianHr)} bpm</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="bg-white rounded-xl border border-slate-200/80 p-5">
                            <h3 className="text-sm font-bold text-slate-800 mb-4 text-center sm:text-left">Volumen Mensual (km)</h3>
                            <ResponsiveContainer width="100%" height={160}>
                                <BarChart data={monthlyVolume}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                                    <Tooltip content={<CustomTooltipVolume />} />
                                    <Bar dataKey="km" radius={[4, 4, 0, 0]}>
                                        {monthlyVolume.map((entry, i) => (
                                            <Cell key={i} fill={entry.color} fillOpacity={0.75} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-200/80 p-5">
                            <h3 className="text-sm font-bold text-slate-800 mb-4 text-center sm:text-left">Carga Acumulada (Relative Effort)</h3>
                            <ResponsiveContainer width="100%" height={160}>
                                <AreaChart data={monthlyVolume}>
                                    <defs>
                                        <linearGradient id="colorLoad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.15} />
                                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.4} />
                                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '8px', color: '#f8fafc', fontSize: '11px' }}
                                        itemStyle={{ color: '#fca5a5' }}
                                        formatter={(val) => [Math.round(val), "Carga"]}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="totalLoad"
                                        stroke="#f43f5e"
                                        strokeWidth={2.5}
                                        fillOpacity={1}
                                        fill="url(#colorLoad)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
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

                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-[13px] leading-relaxed text-slate-600">
                        <strong className="text-indigo-600">💡 Cómo leer:</strong> Si para la misma velocidad tu FC sube con el tiempo, puede indicar fatiga acumulada, deshidratación o cambio de condiciones. Los puntos del mismo color (mes) deberían agruparse.
                    </div>
                </div>
            )}

            {/* ===================== DRIFT TAB ===================== */}
            {activeTab === "drift" && (
                <div className="space-y-5">
                    {processedData.missingDetails.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-4 text-amber-800 text-[13px] leading-relaxed items-center">
                            <span className="text-2xl shrink-0">ℹ️</span>
                            <div className="flex-grow">
                                <p className="font-bold mb-0.5">Hay {processedData.missingDetails.length} carreras llanas sin datos de parciales.</p>
                                <p className="text-amber-700/80">Necesitamos los datos km a km de Strava para calcular la deriva dinámica.</p>
                            </div>
                            <button
                                onClick={() => handleSyncMissing(processedData.missingDetails)}
                                disabled={isSyncing}
                                className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-[11px] uppercase tracking-wide transition-all
                                    ${isSyncing
                                        ? "bg-amber-200 text-amber-500 cursor-not-allowed"
                                        : "bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-300 shadow-sm"}`}
                            >
                                {isSyncing ? (
                                    <>
                                        <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                                        Sincronizando ({syncProgress}/{processedData.missingDetails.length})...
                                    </>
                                ) : (
                                    <>
                                        <ArrowPathIcon className="w-3.5 h-3.5" />
                                        Cargar estas {processedData.missingDetails.length}
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                    {driftRuns.length > 0 ? (
                        <>
                            <div className="bg-white rounded-xl border border-slate-200/80 p-5">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-800 mb-0.5">Dinámica Intra-Sesión ({driftRuns.length} sesiones)</h3>
                                        <p className="text-[11px] text-slate-400">Datos por kilómetro en carreras llanas seleccionadas</p>
                                    </div>
                                    <div className="flex bg-slate-100 rounded-lg p-1 shrink-0">
                                        <button
                                            onClick={() => setDriftView("hr")}
                                            className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all
                                                ${driftView === "hr" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                                        >
                                            Pulso (bpm)
                                        </button>
                                        <button
                                            onClick={() => setDriftView("eff")}
                                            className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all
                                                ${driftView === "eff" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                                        >
                                            Eficiencia (bpm/vel)
                                        </button>
                                    </div>
                                </div>

                                <ResponsiveContainer width="100%" height={320}>
                                    <LineChart>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.5} />
                                        <XAxis
                                            dataKey="km"
                                            type="number"
                                            domain={[1, "auto"]}
                                            tick={{ fontSize: 11, fill: "#94a3b8" }}
                                            label={{ value: "Kilómetro", position: "bottom", offset: -2, style: { fontSize: 11, fill: "#94a3b8" } }}
                                        />
                                        <YAxis
                                            domain={driftView === "hr"
                                                ? [(min) => Math.floor(min / 5) * 5 - 5, (max) => Math.ceil(max / 5) * 5 + 5]
                                                : ["auto", "auto"]}
                                            tick={{ fontSize: 11, fill: "#94a3b8" }}
                                            label={{
                                                value: driftView === "hr" ? "Frecuencia Cardíaca (bpm)" : "Ratio bpm / (m/s)",
                                                angle: -90,
                                                position: "insideLeft",
                                                offset: 10,
                                                style: { fontSize: 11, fill: "#94a3b8" }
                                            }}
                                        />
                                        <Tooltip content={<CustomTooltipDrift />} />
                                        {driftRuns.map((run, i) => (
                                            !hiddenDriftRuns.has(i) && (
                                                <Line
                                                    key={i}
                                                    data={run.data}
                                                    type="monotone"
                                                    dataKey={driftView === "hr" ? "hr" : "eff"}
                                                    name={`${driftView === "hr" ? "FC" : "Eff"} ${run.name}`}
                                                    stroke={run.color}
                                                    trackStyle={{ cursor: 'pointer' }}
                                                    strokeWidth={run.isRecent ? 3.5 : 1.6}
                                                    activeDot={{ r: 6, onClick: () => openStrava(run.id), cursor: 'pointer' }}
                                                    dot={run.isRecent ? { r: 4, fill: run.color, strokeWidth: 2, stroke: '#fff' } : { r: 2.5, fill: run.color, fillOpacity: 0.6 }}
                                                    strokeOpacity={run.isRecent ? 1 : 0.6}
                                                    strokeDasharray={(!run.isRecent && i % 2 === 0) ? "4 4" : undefined}
                                                />
                                            )
                                        ))}
                                    </LineChart>
                                </ResponsiveContainer>
                                {/* Clickable Legend */}
                                <div className="flex flex-wrap gap-3 justify-center mt-3 text-[11px]">
                                    {driftRuns.map((run, i) => (
                                        <button
                                            key={i}
                                            onClick={() => toggleDriftRun(i)}
                                            className={`flex items-center gap-1.5 transition-opacity ${hiddenDriftRuns.has(i) ? 'opacity-30 line-through' : 'opacity-100'}`}
                                        >
                                            <div className="w-5 h-0.5 rounded" style={{ background: run.color }} />
                                            <span className="text-slate-500">{run.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Drift stat cards */}
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                {driftRuns.map((run, i) => {
                                    const isHigh = Math.abs(run.drift) > 20;
                                    const isModerate = Math.abs(run.drift) > 10 && Math.abs(run.drift) <= 20;
                                    return (
                                        <div
                                            key={i}
                                            className={`rounded-xl p-4 border ${isHigh ? "bg-rose-50 border-rose-200" : isModerate ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"
                                                }`}
                                        >
                                            <div className={`text-[10px] uppercase tracking-wider font-bold mb-1.5 ${isHigh ? "text-rose-500" : isModerate ? "text-amber-600" : "text-emerald-600"
                                                }`}>
                                                {run.name}
                                            </div>
                                            <div className={`text-2xl font-extrabold tabular-nums ${isHigh ? "text-rose-600" : isModerate ? "text-amber-600" : "text-emerald-600"
                                                }`}>
                                                {run.drift >= 0 ? "+" : ""}{Math.round(run.drift)}
                                                <span className="text-sm font-normal ml-1">bpm</span>
                                            </div>
                                            <div className="text-[11px] text-slate-500 mt-1">
                                                {run.data[0]?.hr ? Math.round(run.data[0].hr) : "?"} → {run.data[run.data.length - 1]?.hr ? Math.round(run.data[run.data.length - 1].hr) : "?"} · {
                                                    isHigh ? "Elevada" : isModerate ? "Moderada" : "Normal"
                                                }
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-[13px] leading-relaxed text-slate-600">
                                <strong className="text-amber-600">📊 Interpretación:</strong> Una deriva &gt;15bpm en un rodaje fácil puede indicar deshidratación, fatiga acumulada, déficit de hierro o calor excesivo. Compara sesiones similares a lo largo del tiempo para detectar tendencias.
                            </div>
                        </>
                    ) : (
                        <div className="bg-white rounded-xl border border-slate-200/80 p-8 text-center">
                            <p className="text-sm text-slate-400">No hay suficientes carreras con parciales (splits) para analizar la deriva cardíaca.</p>
                            <p className="text-xs text-slate-300 mt-2">Expande actividades en la tabla para cargar los parciales, luego vuelve aquí.</p>
                        </div>
                    )}
                </div>
            )}

            {/* ===================== EFFICIENCY TAB ===================== */}
            {activeTab === "efficiency" && (
                <div className="space-y-5">
                    <div className="bg-white rounded-xl border border-slate-200/80 p-5">
                        <h3 className="text-sm font-bold text-slate-800 mb-0.5">Eficiencia Cardíaca (FC/Velocidad)</h3>
                        <p className="text-[11px] text-slate-400 mb-4">
                            Ratio FC/velocidad en carreras llanas (&lt;2.5% pendiente, &gt;3.5km, GAP &lt;7:00/km). Menor = más eficiente.
                        </p>
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
                                            label={{ value: "FC/Velocidad", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#94a3b8" } }}
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
                                                        <div className="text-violet-400">Ratio: {d.ratio.toFixed(1)} bpm/(m/s)</div>
                                                        <div className="text-amber-400">Elev: {Math.round(d.elev)}m D+</div>
                                                        <div className="text-indigo-400 text-[11px] mt-1.5 opacity-70">🔗 Click para ver en Strava</div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }} />
                                        <Area
                                            type="monotone"
                                            dataKey="ratio"
                                            stroke="#8b5cf6"
                                            fill="#8b5cf6"
                                            fillOpacity={0.08}
                                            strokeWidth={0}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="ratio"
                                            stroke="#8b5cf6"
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
                                        const ratios = efficiencyData.map(e => e.ratio);
                                        const bestRun = efficiencyData.reduce((best, r) => r.ratio < best.ratio ? r : best, efficiencyData[0]);
                                        const worstRun = efficiencyData.reduce((worst, r) => r.ratio > worst.ratio ? r : worst, efficiencyData[0]);
                                        const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
                                        return [
                                            { label: "Mejor Eficiencia", value: bestRun.ratio.toFixed(1), sub: bestRun.dateFormatted, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
                                            { label: "Media", value: avgRatio.toFixed(1), sub: "bpm/(m/s)", color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-200" },
                                            { label: "Peor Eficiencia", value: worstRun.ratio.toFixed(1), sub: worstRun.dateFormatted, color: "text-rose-600", bg: "bg-rose-50", border: "border-rose-200" },
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

                    <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 text-[13px] leading-relaxed text-slate-600">
                        <strong className="text-violet-600">🧠 Cómo interpretar:</strong> El ratio FC/velocidad (bpm por m/s) te dice cuántos latidos "gastas" por unidad de velocidad. Un ratio decreciente indica que tu corazón es más eficiente (mejor forma). Si sube, puede indicar fatiga, calor, deshidratación o pérdida de forma.
                    </div>
                </div>
            )}
            {/* ===================== DIAGNOSIS TAB ===================== */}
            {activeTab === "diagnosis" && (
                <div className="space-y-5">
                    <div className="bg-white rounded-2xl border border-slate-200/80 p-6">
                        <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                            <FunnelIcon className="w-5 h-5 text-indigo-500" />
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
                                        {diagnosis.highDrift
                                            ? `Detectamos una deriva de hasta ${Math.round(diagnosis.avgDrift)} bpm en tus salidas fáciles. Una subida de más de 15 bpm en 10km suele apuntar a deshidratación crónica, pérdida de volumen plasmático o falta de hierro.`
                                            : "Tu deriva cardíaca está dentro de rangos normales (< 12 bpm). Tu sistema cardiovascular mantiene bien el equilibrio térmico e hidrolítico."
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
                                    <h4 className="font-bold text-slate-900 text-[15px] mb-1">Tendencia de Eficiencia (FC/Velocidad)</h4>
                                    <p className="text-slate-500 text-[13px] leading-relaxed">
                                        {diagnosis.effTrend === "worsening"
                                            ? "Tu ratio de eficiencia está empeorando. Cada unidad de velocidad te cuesta más latidos que hace un mes."
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
                    <div className="bg-indigo-900 text-white rounded-2xl p-6 shadow-xl shadow-indigo-100">
                        <h3 className="text-base font-bold mb-5 flex items-center gap-2">
                            <ClockIcon className="w-5 h-5 text-indigo-300" />
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
                                    <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center font-bold text-xs shrink-0">{item.id}</div>
                                    <div className="flex-1">
                                        <div className="text-[14px] font-medium leading-tight">{item.task}</div>
                                        <div className="text-[10px] uppercase font-bold text-indigo-300 mt-1.5 tracking-wider">Prioridad: {item.prio}</div>
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
