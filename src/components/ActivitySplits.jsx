import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// ─── helpers ────────────────────────────────────────────────────────────────

const calculatePace = (speed) => {
    if (!speed || speed === 0) return '--:--';
    const pace = 16.6667 / speed;
    const m = Math.floor(pace);
    const s = Math.floor((pace - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const calculateGAP = (speed, distance, elevation_diff, elevation_gain) => {
    if (!speed || speed === 0) return '--:--';
    const elevation = typeof elevation_diff === 'number' ? elevation_diff : (elevation_gain || 0);
    const distKm = distance / 1000;
    const paceMinKm = 16.6667 / speed;
    const elevPerKm = distKm > 0 ? elevation / distKm : 0;
    const gapAdjustment = (elevPerKm / 10) * 8 / 60;
    const adjustedPace = Math.max(paceMinKm - gapAdjustment, paceMinKm * 0.8);
    const m = Math.floor(adjustedPace);
    const s = Math.round((adjustedPace - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

// ─── zone config ─────────────────────────────────────────────────────────────

const ZONES = {
    1: { label: 'Z1', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', text: '#64748b' },
    2: { label: 'Z2', color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', text: '#0284c7' },
    3: { label: 'Z3', color: '#4ade80', bg: 'rgba(74,222,128,0.12)', text: '#16a34a' },
    4: { label: 'Z4', color: '#fb923c', bg: 'rgba(251,146,60,0.12)', text: '#ea580c' },
    5: { label: 'Z5', color: '#f87171', bg: 'rgba(248,113,113,0.12)', text: '#dc2626' },
};

const getZone = (hr, maxHR, restingHR) => {
    if (!hr || !maxHR) return 1;

    // Model Karvonen (HRR - Heart Rate Reserve)
    // Formula moderna contrastada (Swain & Leutholtz, 1997)
    // Más precisa que %FCmax porque tiene en cuenta tu pulso basal.
    if (restingHR && restingHR > 35 && restingHR < 100) {
        const hrr = maxHR - restingHR;
        const p = (hr - restingHR) / hrr;
        // Umbrales pro para entrenamiento de resistencia (5 zonas segun Seiler/Friel)
        if (p >= 0.90) return 5; // Anaeróbico / Pico
        if (p >= 0.82) return 4; // Umbral de lactato / Tempo rápido
        if (p >= 0.72) return 3; // Aeróbico Intenso / Ritmo carrera
        if (p >= 0.60) return 2; // Aeróbico Base / Quema grasas
        return 1;              // Recuperación / Regenerativo
    }

    // Fallback: Modelo %FCmax Pro (American College of Sports Medicine - ACSM)
    const p = hr / maxHR;
    if (p >= 0.92) return 5;
    if (p >= 0.85) return 4;
    if (p >= 0.78) return 3;
    if (p >= 0.65) return 2;
    return 1;
};

// ─── SVG overview chart ───────────────────────────────────────────────────────

const fmtPace = (paceS) => {
    const m = Math.floor(paceS / 60);
    const s = Math.round(paceS % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const OverviewChart = ({ rows, avgPaceS }) => {
    const { t } = useTranslation();
    const n = rows.length;
    if (n === 0) return null;

    const H = 90, W = 1000;
    const PAD_T = 8, PAD_B = 8;
    const INNER = H - PAD_T - PAD_B;

    const totalDist = rows.reduce((s, r) => s + (r.distance || 0), 0) || 1;
    let xCursor = 0;
    const barRects = rows.map(r => {
        const w = W * (r.distance || 0) / totalDist;
        const rect = { x: xCursor, w };
        xCursor += w;
        return rect;
    });

    const paces = rows.map(r => r.paceS);
    const minP = Math.min(...paces);
    const maxP = Math.max(...paces);

    const paceBarH = (paceS) => PAD_B + INNER * (1 - (paceS - minP) / (maxP - minP || 1)) * 0.92 + INNER * 0.04;
    const avgLineY = H - paceBarH(avgPaceS);

    const validHRs = rows.map(r => r.average_heartrate).filter(Boolean);
    const minHR = validHRs.length ? Math.min(...validHRs) : 100;
    const maxHRChart = validHRs.length ? Math.max(...validHRs) : 200;
    const hrY = (hr) => PAD_T + INNER * (1 - (hr - minHR) / (maxHRChart - minHR || 1)) * 0.9 + INNER * 0.05;

    const hrPoints = rows.map((r, i) =>
        r.average_heartrate ? { x: barRects[i].x + barRects[i].w / 2, y: hrY(r.average_heartrate) } : null
    );
    const hrPath = hrPoints.reduce((path, p, i) => {
        if (!p) return path;
        const prev = hrPoints.slice(0, i).filter(Boolean).pop();
        if (!prev) return `M ${p.x} ${p.y}`;
        const cx = (prev.x + p.x) / 2;
        return `${path} C ${cx} ${prev.y} ${cx} ${p.y} ${p.x} ${p.y}`;
    }, '');

    return (
        <div className="mb-4 relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 90 }} preserveAspectRatio="none">
                {rows.map((r, i) => {
                    const { x, w } = barRects[i];
                    const bH = paceBarH(r.paceS);
                    const color = r.isFaster ? '#34d399' : '#f87171';
                    return (
                        <rect key={i}
                            x={x + w * 0.06}
                            width={Math.max(w * 0.88, 1)}
                            y={H - bH}
                            height={bH - PAD_B}
                            fill={color}
                            opacity={0.65}
                            rx={2}
                        />
                    );
                })}
                <line x1={0} y1={avgLineY} x2={W} y2={avgLineY} stroke="#6366f1" strokeWidth="1" strokeDasharray="6 4" strokeOpacity="0.6" />
                {hrPath && (
                    <path d={hrPath} fill="none" stroke="#f97316" strokeWidth="1.8" strokeOpacity="0.75" strokeLinecap="round" />
                )}
            </svg>
            <div className="absolute top-0.5 right-1 flex items-center gap-3">
                <div className="flex items-center gap-1">
                    <div className="w-3 h-0.5 rounded bg-orange-400" />
                    <span className="text-[9px] text-slate-400">{t('splits.legend_hr', 'FC')}</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-3 h-2 rounded-sm bg-slate-300/80" style={{ background: 'linear-gradient(#34d399,#f87171)' }} />
                    <span className="text-[9px] text-slate-400">{t('splits.pace', 'RITMO').toLowerCase()}</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-4 h-px" style={{ background: '#6366f1' }} />
                    <span className="text-[9px] text-slate-400 font-mono">{t('splits.avg', 'media')} {fmtPace(avgPaceS)}</span>
                </div>
            </div>
            <div className="absolute left-1 top-0.5 text-[9px] text-slate-400 font-mono">{fmtPace(minP)} ↑</div>
            <div className="absolute left-1 bottom-0.5 text-[9px] text-slate-400 font-mono">{fmtPace(maxP)} ↓</div>
        </div>
    );
};

const PACE_MIN_S = 180; // 3:00/km — referencia más rápido (barra llena/azul intenso)
const PACE_MAX_S = 390; // 6:30/km — referencia más lento (barra casi vacía/blanco)

const paceColor = (paceS) => {
    // t=0 (lento/7:30) → casi blanco | t=1 (rápido/3:00) → azul intenso
    const t = Math.max(0, Math.min(1, (PACE_MAX_S - paceS) / (PACE_MAX_S - PACE_MIN_S)));
    const r = Math.round(241 + (29 - 241) * t);
    const g = Math.round(245 + (78 - 245) * t);
    const b = Math.round(249 + (216 - 249) * t);
    return `rgb(${r},${g},${b})`;
};

const PaceBar = ({ row }) => {
    const paceFill = Math.max(0, Math.min(1, (PACE_MAX_S - row.paceS) / (PACE_MAX_S - PACE_MIN_S)));
    const color = paceColor(row.paceS);
    return (
        <div className="flex flex-col justify-center py-1.5 px-1">
            <div className="relative h-[20px] rounded-sm overflow-hidden bg-slate-100">
                <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${Math.max(paceFill * 100, 2)}%`, background: color }}
                />
            </div>
        </div>
    );
};



// ─── Main Component ──────────────────────────────────────────────────────────

const ActivitySplits = ({ splits, globalMaxHR }) => {
    const { t } = useTranslation();
    if (!splits || splits.length === 0) {
        return <p className="py-4 text-center text-sm italic text-slate-400">{t('splits.no_splits', 'No hay parciales.')}</p>;
    }

    const { rows, avgPaceS, maxHR } = useMemo(() => {
        const full = splits.filter(s => s.distance >= 950 && s.average_speed > 0);
        const ref = full.length ? full : splits.filter(s => s.average_speed > 0);
        const avgSpeed = ref.reduce((s, a) => s + a.average_speed, 0) / ref.length;
        const avgPaceS = avgSpeed > 0 ? 1000 / avgSpeed : 300;
        const sessionMaxHR = Math.max(...splits.map(s => s.average_heartrate || 0));
        const maxHR = globalMaxHR > sessionMaxHR ? globalMaxHR : sessionMaxHR;
        const fastestSpeed = Math.max(...splits.filter(s => s.average_speed > 0).map(s => s.average_speed));

        const restingHR = parseInt(localStorage.getItem('garminRestHR')) || null;

        const rows = splits.map((split, idx) => {
            const paceS = split.average_speed > 0 ? 1000 / split.average_speed : avgPaceS;
            const deviationPct = ((paceS - avgPaceS) / avgPaceS) * 100;
            const elevation = typeof split.elevation_difference === 'number' ? split.elevation_difference : (split.total_elevation_gain || 0);
            const isPartial = split.distance < 950;
            const isBest = fastestSpeed > 0 && split.average_speed === fastestSpeed;
            const hrZone = getZone(split.average_heartrate, maxHR, restingHR);
            const isFaster = deviationPct < 0;

            return {
                ...split,
                idx, paceS, deviationPct, elevation, isPartial, isBest, hrZone, isFaster,
                pace: calculatePace(split.average_speed),
                gap: calculateGAP(split.average_speed, split.distance, split.elevation_difference, split.total_elevation_gain),
                timeStr: `${Math.floor(split.moving_time / 60)}:${(split.moving_time % 60).toString().padStart(2, '0')}`,
                distKm: (split.distance / 1000).toFixed(2),
            };
        });

        return { rows, avgPaceS, maxHR };
    }, [splits, globalMaxHR]);

    const GRID = '3px 2.5rem 4rem 4.2rem 1fr 4rem 4rem 3.5rem 3.5rem 5rem';

    return (
        <div>
            <OverviewChart rows={rows} avgPaceS={avgPaceS} />
            <div className="grid items-center gap-x-2 px-0 pb-2 border-b border-slate-200 mb-0.5" style={{ gridTemplateColumns: GRID }}>
                <div />
                {[t('splits.lap'), t('splits.dist'), t('splits.pace'), '', t('splits.chart'), t('splits.time'), t('splits.gap'), t('splits.elev'), '', t('splits.zone_hr')].map((h, i) => (
                    <span key={i} className={`text-[9px] font-bold uppercase tracking-widest text-slate-400 ${i >= 5 ? 'text-right' : i === 4 ? 'text-center' : ''}`}>
                        {h}
                    </span>
                ))}
            </div>

            <div className="flex flex-col">
                {rows.map((row) => {
                    const zone = ZONES[row.hrZone];
                    const rowBg = row.isPartial ? 'transparent' : row.isFaster ? 'rgba(52,211,153,0.04)' : 'rgba(248,113,113,0.04)';
                    const borderColor = row.isFaster ? '#34d399' : '#f87171';

                    return (
                        <div key={row.idx} className="grid items-center gap-x-2 border-b border-slate-100/80 hover:bg-slate-50/80" style={{ gridTemplateColumns: GRID, background: rowBg, minHeight: 44 }}>
                            <div className="self-stretch rounded-r-full my-1" style={{ background: borderColor, minWidth: 3, opacity: 0.8 }} />
                            <div className="flex items-center">
                                {row.isBest && <span className="text-amber-400 text-[9px] mr-1">★</span>}
                                <span className={`text-[12px] font-black tabular-nums ${row.isBest ? 'text-amber-500' : 'text-slate-400'}`}>{row.lap_index}</span>
                            </div>
                            <span className="text-[11px] tabular-nums text-slate-500 font-mono">{row.distKm} km</span>
                            <div className={`text-[11px] font-bold tabular-nums font-mono text-center px-2 py-0.5 rounded ${row.isFaster ? 'text-emerald-700 bg-emerald-50' : 'text-indigo-600 bg-indigo-50'}`}>{row.pace}</div>
                            <PaceBar row={row} />
                            <span className="text-[11px] tabular-nums font-mono text-slate-600 text-right">{row.timeStr}</span>
                            <span className="text-[11px] tabular-nums font-mono font-bold text-teal-700 text-right">{row.gap}</span>
                            <div className={`text-right text-[11px] tabular-nums font-bold ${row.elevation > 2 ? 'text-rose-500' : row.elevation < -2 ? 'text-emerald-500' : 'text-slate-300'}`}>
                                {row.elevation > 2 ? `▲${Math.round(row.elevation)}m` : row.elevation < -2 ? `▼${Math.abs(Math.round(row.elevation))}m` : '—'}
                            </div>

                            {/* HR Mini-Bar Column (Horizontal) */}
                            <div className="flex items-center px-1">
                                {row.average_heartrate ? (
                                    <div className="w-full h-[3px] bg-slate-100/50 rounded-full relative overflow-hidden">
                                        <div
                                            className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                                            style={{
                                                // Escala relativa: el 0% de la barra es el 50% de la FC máx
                                                width: `${Math.max(((row.average_heartrate - maxHR * 0.5) / (maxHR * 0.5)) * 100, 5)}%`,
                                                background: zone.color,
                                                opacity: 0.9
                                            }}
                                        />
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex items-center justify-end gap-1.5 pr-1">
                                {row.average_heartrate ? (
                                    <>
                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md" style={{ background: zone.bg, color: zone.text, border: `1px solid ${zone.color}40` }}>{zone.label}</span>
                                        <span className="text-[12px] tabular-nums font-mono font-bold" style={{ color: zone.text }}>{Math.round(row.average_heartrate)}</span>
                                    </>
                                ) : <span className="text-slate-300 text-xs">—</span>}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-4 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-x-5 px-1">
                <div className="flex items-center gap-1.5">
                    <div className="w-8 h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg,#f1f5f9,#1d4ed8)' }} />
                    <span className="text-[9px] text-slate-400">{t('splits.legend_pace_range')}</span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-[9px] text-slate-400">{t('nav.zones').toLowerCase()}:</span>
                    {[1, 2, 3, 4, 5].map(z => <span key={z} className="text-[9px] font-black px-1.5 py-0.5 rounded-md" style={{ background: ZONES[z].bg, color: ZONES[z].text }}>{ZONES[z].label}</span>)}
                </div>
            </div>
        </div>
    );
};

export default ActivitySplits;
