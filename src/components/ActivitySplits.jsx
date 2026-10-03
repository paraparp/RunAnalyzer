import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon, TrophyIcon, ArrowTrendingUpIcon } from '@heroicons/react/24/outline';
import { karvonenBounds, classifyHR } from '../lib/hrZones';
import { formatDuration, formatPaceFromSpeed, formatPaceFromSecPerKm } from '../lib/timeFormat';
import { gapSpeed, gapSpeedFromGain } from '../lib/gap';
import { ZONES } from '../lib/zoneColors';

// ─── helpers ────────────────────────────────────────────────────────────────

// GAP del parcial con el modelo único de lib/gap (Minetti amortiguado).
// `elevation_difference` es desnivel NETO con signo, que es la entrada natural del
// modelo; si el parcial no lo trae se cae a `total_elevation_gain` (acumulado), que
// exige la hipótesis de perfil ondulado.
const calculateGAP = (speed, distance, elevation_diff, elevation_gain) => {
    if (!speed || speed === 0 || !(distance > 0)) return '--:--';
    const v = typeof elevation_diff === 'number'
        ? gapSpeed(speed, elevation_diff / distance)
        : gapSpeedFromGain(speed, distance, elevation_gain || 0);
    return v > 0 ? formatPaceFromSpeed(v) : '--:--';
};

// Zone for a lap, on the SAME calibrated Karvonen bounds the zones tab uses
// (useHrParams → manual override → auto-detection). Returns a 1-based zone id to
// index ZONES; 0 when there is no HR to classify.
//
// Caveat: this classifies the lap AVERAGE. A kilometre with surges averages out,
// so this is a per-km summary, not true time-in-zone.
const getZone = (hr, bounds) => classifyHR(hr, bounds) + 1;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const signedSec = (s) => `${s > 0 ? '+' : s < 0 ? '−' : '±'}${Math.abs(Math.round(s))} s`;

// Cada barra lleva el color de la zona de FC del parcial: la altura dice el ritmo
// y el color, a qué intensidad salió. Sin FC calibrada se cae a azul por ritmo
// (intenso = más rápido que la media, claro = más lento).
const BAR_FAST = '#2563eb';
const BAR_SLOW = '#93c5fd';
const HR_LINE = '#334155';
const barColor = (r) => (r.hrZone > 0 ? ZONES[r.hrZone].color : r.isFaster ? BAR_FAST : BAR_SLOW);

/**
 * Escala vertical común al gráfico y a las barras de la tabla: arriba el ritmo más
 * rápido. Los parciales cortos (< 950 m) no fijan el dominio: un resto de 20 m con
 * un ritmo raro aplastaría al resto de barras.
 */
function paceScale(rows) {
    const ref = rows.filter(r => !r.isPartial);
    const paces = (ref.length ? ref : rows).map(r => r.paceS);
    const min = Math.min(...paces), max = Math.max(...paces);
    const pad = Math.max(5, (max - min) * 0.2);
    const lo = min - pad, hi = max + pad;
    return { lo, hi, frac: (paceS) => clamp01((hi - paceS) / (hi - lo)) };
}

// ─── Gráfico: ritmo (barras, ancho = distancia) y FC (línea) ──────────────────

const PaceChart = ({ rows, avgPaceS, scale, hover, setHover }) => {
    const { t } = useTranslation();
    if (rows.length === 0) return null;

    const totalDist = rows.reduce((s, r) => s + (r.distance || 0), 0) || 1;
    const cols = rows.reduce((acc, r) => {
        const prev = acc[acc.length - 1];
        acc.push({ x: prev ? prev.x + prev.w : 0, w: (100 * (r.distance || 0)) / totalDist });
        return acc;
    }, []);

    const hrs = rows.map(r => r.average_heartrate).filter(Boolean);
    const hrLo = hrs.length ? Math.min(...hrs) - 4 : 0;
    const hrHi = hrs.length ? Math.max(...hrs) + 4 : 1;
    // La FC ocupa la franja alta para no tapar el arranque de las barras.
    const hrY = (hr) => 8 + 52 * (1 - (hr - hrLo) / (hrHi - hrLo || 1));
    const hrPts = rows.map((r, i) => (r.average_heartrate ? { x: cols[i].x + cols[i].w / 2, y: hrY(r.average_heartrate), i } : null)).filter(Boolean);
    const avgY = 100 * (1 - scale.frac(avgPaceS));
    const h = hover != null ? rows[hover] : null;
    const hc = hover != null ? cols[hover] : null;
    const zonesUsed = [...new Set(rows.map(r => r.hrZone).filter(z => z > 0))].sort();

    return (
        <div className="mb-4">
            <div className="flex items-center justify-end gap-4 mb-2 text-[11px] text-slate-500">
                {zonesUsed.length > 0 ? zonesUsed.map(z => (
                    <span key={z} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ZONES[z].color }} />{ZONES[z].label}</span>
                )) : (
                    <>
                        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: BAR_FAST }} />{t('splits.legend_faster')}</span>
                        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: BAR_SLOW }} />{t('splits.legend_slower')}</span>
                    </>
                )}
                {hrPts.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: HR_LINE }} />{t('splits.legend_hr')}</span>}
            </div>
            <div className="flex">
                {/* Eje de ritmo */}
                <div className="relative w-10 shrink-0 h-40 text-[10px] tabular-nums text-slate-400">
                    <span className="absolute right-2 top-0 -translate-y-1/2">{formatPaceFromSecPerKm(scale.lo)}</span>
                    <span className="absolute right-2 top-1/2 -translate-y-1/2">{formatPaceFromSecPerKm((scale.lo + scale.hi) / 2)}</span>
                    <span className="absolute right-2 bottom-0 translate-y-1/2">{formatPaceFromSecPerKm(scale.hi)}</span>
                </div>

                <div className="relative flex-1 min-w-0 h-40 border-b border-slate-200" onMouseLeave={() => setHover(null)}>
                    {[0, 50].map(y => <div key={y} className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ top: `${y}%` }} />)}
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
                        {rows.map((r, i) => {
                            const top = 100 * (1 - scale.frac(r.paceS));
                            const gap = Math.min(0.4, cols[i].w * 0.12);
                            return (
                                <rect key={i}
                                    x={cols[i].x + gap} width={Math.max(cols[i].w - gap * 2, 0.15)}
                                    y={top} height={100 - top}
                                    fill={barColor(r)}
                                    opacity={r.isPartial ? 0.45 : hover != null && hover !== i ? 0.45 : 0.9}
                                />
                            );
                        })}
                        <line x1="0" x2="100" y1={avgY} y2={avgY} stroke="#0f172a" strokeOpacity="0.45" strokeDasharray="4 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        {hrPts.length > 1 && (
                            <polyline points={hrPts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={HR_LINE} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                        )}
                    </svg>
                    {/* Puntos de FC en HTML: dentro del SVG estirado saldrían elípticos */}
                    {hrPts.map(p => (
                        <span key={p.i} className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full border-2 border-white pointer-events-none"
                            style={{ left: `${p.x}%`, top: `${p.y}%`, background: HR_LINE, transform: hover === p.i ? 'scale(1.5)' : undefined }} />
                    ))}
                    <span className="absolute right-0 -translate-y-full text-[10px] font-semibold tabular-nums text-slate-500 bg-white/80 px-1 rounded" style={{ top: `${avgY}%` }}>
                        {t('splits.avg')} {formatPaceFromSecPerKm(avgPaceS)}
                    </span>
                    {/* Zonas de hover, una por parcial */}
                    <div className="absolute inset-0 flex">
                        {rows.map((r, i) => (
                            <div key={i} className="h-full cursor-crosshair" style={{ width: `${cols[i].w}%` }} onMouseEnter={() => setHover(i)} />
                        ))}
                    </div>
                    {h && (
                        <div className="absolute top-1 z-10 pointer-events-none -translate-x-1/2 rounded-lg bg-slate-900/95 text-white px-3 py-2 text-[11px] shadow-lg whitespace-nowrap"
                            style={{ left: `${Math.min(85, Math.max(15, hc.x + hc.w / 2))}%` }}>
                            <div className="font-semibold text-slate-300 mb-0.5">{t('splits.split_n', { n: h.lap_index })} · {h.distKm} km</div>
                            <div className="tabular-nums"><span className="text-sm font-bold">{h.pace}</span>/km <span className="text-slate-400">· GAP {h.gap}</span></div>
                            <div className="tabular-nums text-slate-300">
                                {h.average_heartrate ? `${Math.round(h.average_heartrate)} ppm${h.hrZone > 0 ? ` (${ZONES[h.hrZone].label})` : ''} · ` : ''}{h.timeStr}
                                {Math.abs(h.elevation) > 2 ? ` · ${h.elevation > 0 ? '▲' : '▼'}${Math.abs(Math.round(h.elevation))} m` : ''}
                            </div>
                        </div>
                    )}
                </div>

                {/* Eje de FC */}
                <div className="relative w-9 shrink-0 h-40 text-[10px] tabular-nums" style={{ color: HR_LINE }}>
                    {hrPts.length > 0 && (
                        <>
                            <span className="absolute left-2 -translate-y-1/2" style={{ top: '8%' }}>{Math.round(hrHi)}</span>
                            <span className="absolute left-2 -translate-y-1/2" style={{ top: '60%' }}>{Math.round(hrLo)}</span>
                        </>
                    )}
                </div>
            </div>
            {/* Número de parcial bajo cada barra, si cabe */}
            <div className="flex ml-10 mr-9 mt-1">
                {rows.map((r, i) => (
                    <div key={i} className={`text-center text-[10px] tabular-nums truncate ${hover === i ? 'font-bold text-slate-700' : 'text-slate-400'}`} style={{ width: `${cols[i].w}%` }}>
                        {cols[i].w > 3.5 ? r.lap_index : ''}
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Tabla ───────────────────────────────────────────────────────────────────

const SplitsTable = ({ rows, avgPaceS, scale, hover, setHover }) => {
    const { t } = useTranslation();
    const th = 'py-2 px-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 whitespace-nowrap';
    return (
        <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[13px] tabular-nums" onMouseLeave={() => setHover(null)}>
                <thead>
                    <tr className="border-b border-slate-200">
                        <th className={`${th} text-left w-8`}>#</th>
                        <th className={`${th} text-right`}>{t('splits.dist')}</th>
                        <th className={`${th} text-right`}>{t('splits.pace')}</th>
                        <th className={`${th} hidden md:table-cell w-[28%]`} />
                        <th className={`${th} text-right`}>{t('splits.gap')}</th>
                        <th className={`${th} text-right`}>{t('splits.time')}</th>
                        <th className={`${th} text-right`}>{t('splits.elev')}</th>
                        <th className={`${th} text-right`}>{t('splits.hr')}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => {
                        const zone = ZONES[row.hrZone];
                        const delta = row.paceS - avgPaceS;
                        return (
                            <tr key={row.idx}
                                onMouseEnter={() => setHover(i)}
                                className={`border-b border-slate-100 last:border-0 transition-colors ${hover === i ? 'bg-blue-50/70' : ''} ${row.isPartial ? 'text-slate-400' : 'text-slate-700'}`}>
                                <td className="py-2 px-2 text-left">
                                    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${row.isBest ? 'text-amber-500' : 'text-slate-400'}`}>
                                        {row.isBest && <span className="text-[10px]">★</span>}{row.lap_index}
                                    </span>
                                </td>
                                <td className="py-2 px-2 text-right">{row.distKm}<span className="text-slate-400 text-[11px]"> km</span></td>
                                <td className="py-2 px-2 text-right whitespace-nowrap">
                                    <span className={`font-bold ${row.isPartial ? '' : row.isFaster ? 'text-blue-700' : 'text-slate-900'}`}>{row.pace}</span>
                                    {!row.isPartial && (
                                        <span className={`ml-1.5 text-[10px] font-semibold ${delta < -1 ? 'text-emerald-600' : delta > 1 ? 'text-slate-400' : 'text-slate-300'}`}>{signedSec(delta)}</span>
                                    )}
                                </td>
                                <td className="py-2 px-2 hidden md:table-cell">
                                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                        <div className="h-full rounded-full" style={{
                                            width: `${Math.max(3, scale.frac(row.paceS) * 100)}%`,
                                            background: barColor(row),
                                            opacity: row.isPartial ? 0.45 : 1,
                                        }} />
                                    </div>
                                </td>
                                <td className="py-2 px-2 text-right text-slate-500">{row.gap}</td>
                                <td className="py-2 px-2 text-right text-slate-500">{row.timeStr}</td>
                                <td className={`py-2 px-2 text-right text-xs font-semibold ${row.elevation > 2 ? 'text-rose-500' : row.elevation < -2 ? 'text-emerald-600' : 'text-slate-300'}`}>
                                    {row.elevation > 2 ? `▲${Math.round(row.elevation)}` : row.elevation < -2 ? `▼${Math.abs(Math.round(row.elevation))}` : '—'}
                                </td>
                                <td className="py-2 px-2 text-right whitespace-nowrap">
                                    {row.average_heartrate ? (
                                        <span className="inline-flex items-center justify-end gap-1.5">
                                            {zone && row.hrZone > 0 && (
                                                <span className="text-[9px] font-black px-1 py-px rounded" style={{ background: zone.bg, color: zone.text }}>{zone.label}</span>
                                            )}
                                            <span className="font-semibold text-slate-700">{Math.round(row.average_heartrate)}</span>
                                        </span>
                                    ) : <span className="text-slate-300">—</span>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

// ─── Similar Activities Banner ────────────────────────────────────────────────

const SimilarActivitiesBanner = ({ similar }) => {
    const { t } = useTranslation();
    if (!similar) return null;

    const { pr_rank, effort_count, trend, average_speed } = similar;
    const isPR = pr_rank === 1;
    const isImproving = trend?.direction === 1;

    if (!isPR && !isImproving) return null;

    const speeds = trend?.speeds || [];
    let diffLabel = null;
    if (speeds.length >= 2) {
        const prevPaceS = 1000 / speeds[speeds.length - 2];
        const currPaceS = 1000 / speeds[speeds.length - 1];
        const diffS = Math.round(prevPaceS - currPaceS); // positive = now faster
        if (Math.abs(diffS) >= 2) {
            diffLabel = diffS > 0
                ? `${diffS}s/km ${t('splits.faster_than_prev', 'más rápido que anterior')}`
                : `${Math.abs(diffS)}s/km ${t('splits.slower_than_prev', 'más lento que anterior')}`;
        }
    }

    const avgPaceStr = average_speed > 0 ? formatPaceFromSecPerKm(1000 / average_speed) : null;
    const Icon = isPR ? TrophyIcon : ArrowTrendingUpIcon;
    const tone = isPR ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600';
    const label = isPR
        ? t('splits.route_pr', 'Récord en esta ruta')
        : t('splits.route_improving', 'Mejorando en esta ruta');

    return (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md shrink-0 ${tone}`}><Icon className="w-4 h-4" /></span>
            <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-800">{label}</div>
                <div className="text-[11px] text-slate-400 truncate">
                    {effort_count} {t('splits.similar_runs', 'carreras similares')}
                    {avgPaceStr && <> · {t('splits.avg', 'media')} {avgPaceStr}/km</>}
                    {diffLabel && <> · {diffLabel}</>}
                </div>
            </div>
        </div>
    );
};

// ─── Best Efforts Section ─────────────────────────────────────────────────────

const PR_RANK_LABELS = { 1: 'PR', 2: '2º', 3: '3º' };

const BestEffortsSection = ({ efforts }) => {
    const { t } = useTranslation();
    if (!efforts?.length) return null;

    return (
        <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-2">
                {t('splits.best_efforts', 'Mejores Esfuerzos')} <span className="normal-case tracking-normal font-medium">· /km</span>
            </p>
            {/* Una línea por distancia: nombre y ritmo; el tiempo queda en el title. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-px rounded-lg overflow-hidden border border-slate-100 bg-slate-100">
                {efforts.map((effort) => {
                    const isPR = effort.pr_rank === 1;
                    const prLabel = PR_RANK_LABELS[effort.pr_rank];
                    // El 1K es la referencia de ritmo de la sesión: va destacado.
                    const isKm = Math.abs((effort.distance || 0) - 1000) < 1;
                    const paceStr = effort.distance > 0
                        ? formatPaceFromSecPerKm((effort.elapsed_time / effort.distance) * 1000)
                        : '—';

                    return (
                        <div key={effort.id} title={formatDuration(effort.elapsed_time)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 ${isPR ? 'bg-amber-50' : isKm ? 'bg-blue-50' : 'bg-white'} ${isKm ? 'ring-1 ring-inset ring-blue-300' : ''}`}>
                            <span className={`text-[11px] truncate ${isKm ? 'font-bold text-blue-700' : 'text-slate-500'}`}>{effort.name}</span>
                            {prLabel && (
                                <span className={`text-[8px] font-black px-1 rounded ${isPR ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-500'}`}>{prLabel}</span>
                            )}
                            <span className={`ml-auto font-bold tabular-nums ${isKm ? 'text-sm' : 'text-xs'} ${isPR ? 'text-amber-700' : isKm ? 'text-blue-700' : 'text-slate-800'}`}>{paceStr}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ─── Main Component ──────────────────────────────────────────────────────────

const ActivitySplits = ({ splits, hrParams, bestEfforts, similarActivities, splitsMetric, defaultOpen = false }) => {
    const { t } = useTranslation();
    // El gráfico ya resume la sesión; la tabla, vuelta a vuelta, se despliega a demanda.
    const [open, setOpen] = useState(defaultOpen);
    // Parcial señalado: compartido por gráfico y tabla para leer uno contra otro.
    const [hover, setHover] = useState(null);

    const { hrmax, hrrest } = hrParams ?? {};

    const { rows, avgPaceS } = useMemo(() => {
        if (!splits || splits.length === 0) return { rows: [], avgPaceS: 0 };
        const full = splits.filter(s => s.distance >= 950 && s.average_speed > 0);
        const ref = full.length ? full : splits.filter(s => s.average_speed > 0);
        const avgSpeed = ref.reduce((s, a) => s + a.average_speed, 0) / ref.length;
        const avgPaceS = avgSpeed > 0 ? 1000 / avgSpeed : 300;
        const bounds = hrmax && hrrest ? karvonenBounds({ hrmax, hrrest }) : null;
        const fastestSpeed = Math.max(...(full.length ? full : splits).filter(s => s.average_speed > 0).map(s => s.average_speed));

        // Build a map of Strava's official GAP speed by split index
        const stravaGapMap = splitsMetric?.length
            ? Object.fromEntries(splitsMetric.map(s => [s.split, s.average_grade_adjusted_speed]))
            : {};

        const rows = splits.map((split, idx) => {
            const paceS = split.average_speed > 0 ? 1000 / split.average_speed : avgPaceS;
            const deviationPct = ((paceS - avgPaceS) / avgPaceS) * 100;
            const elevation = typeof split.elevation_difference === 'number' ? split.elevation_difference : (split.total_elevation_gain || 0);
            const isPartial = split.distance < 950;
            const isBest = !isPartial && fastestSpeed > 0 && split.average_speed === fastestSpeed;
            const hrZone = bounds ? getZone(split.average_heartrate, bounds) : 0;
            const isFaster = deviationPct < 0;

            // Use Strava's official GAP if available, otherwise fall back to local calculation
            const stravaGapSpeed = stravaGapMap[split.split];
            const gap = stravaGapSpeed
                ? formatPaceFromSpeed(stravaGapSpeed)
                : calculateGAP(split.average_speed, split.distance, split.elevation_difference, split.total_elevation_gain);

            return {
                ...split,
                idx, paceS, deviationPct, elevation, isPartial, isBest, hrZone, isFaster,
                pace: formatPaceFromSpeed(split.average_speed),
                gap,
                timeStr: formatDuration(split.moving_time),
                distKm: (split.distance / 1000).toFixed(2),
            };
        });

        return { rows, avgPaceS };
    }, [splits, hrmax, hrrest, splitsMetric]);

    const scale = useMemo(() => (rows.length ? paceScale(rows) : null), [rows]);

    if (!splits || splits.length === 0) {
        return <p className="py-4 text-center text-sm italic text-slate-400">{t('splits.no_splits', 'No hay parciales.')}</p>;
    }

    return (
        <div>
            <SimilarActivitiesBanner similar={similarActivities} />
            <PaceChart rows={rows} avgPaceS={avgPaceS} scale={scale} hover={hover} setHover={setHover} />
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors"
            >
                {open ? t('splits.hide_table') : t('splits.show_table', { count: rows.length })}
                <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="mt-3">
                    <SplitsTable rows={rows} avgPaceS={avgPaceS} scale={scale} hover={hover} setHover={setHover} />
                </div>
            )}

            <BestEffortsSection efforts={bestEfforts} />
        </div>
    );
};

export default ActivitySplits;
