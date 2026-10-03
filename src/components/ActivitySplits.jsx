import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon, TrophyIcon, ArrowTrendingUpIcon } from '@heroicons/react/24/outline';
import { karvonenBounds, classifyHR } from '../lib/hrZones';
import { formatDuration, formatPaceFromSpeed, formatPaceFromSecPerKm } from '../lib/timeFormat';
import { gapSpeed, gapSpeedFromGain } from '../lib/gap';
import { ZONES } from '../lib/zoneColors';

// Parciales de una sesión en dos lecturas, una por sección de la ficha:
//   mode="pace" → ritmo por parcial, tabla desplegable y mejores esfuerzos.
//   mode="hr"   → FC media por parcial sobre las bandas de zona del atleta.

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

// Ritmo: azul intenso = más rápido que la media; claro = más lento.
const BAR_FAST = '#2563eb';
const BAR_SLOW = '#93c5fd';
const paceColor = (r) => (r.isFaster ? BAR_FAST : BAR_SLOW);
const zoneColor = (r) => (r.hrZone > 0 ? ZONES[r.hrZone].color : '#94a3b8');

/**
 * Escala vertical del ritmo, común al gráfico y a las barras de la tabla: arriba el
 * más rápido. Los parciales cortos (< 950 m) no fijan el dominio: un resto de 20 m
 * con un ritmo raro aplastaría al resto de barras.
 */
function paceScale(rows) {
    const ref = rows.filter(r => !r.isPartial);
    const paces = (ref.length ? ref : rows).map(r => r.paceS);
    const min = Math.min(...paces), max = Math.max(...paces);
    const pad = Math.max(5, (max - min) * 0.2);
    const lo = min - pad, hi = max + pad;
    return { lo, hi, frac: (paceS) => clamp01((hi - paceS) / (hi - lo)) };
}

// ─── Gráfico de barras por parcial (ancho = distancia) ───────────────────────

/**
 * Lienzo común a ritmo y FC. `frac(row)` da la altura 0–1 (null = sin barra);
 * `bands` pinta franjas horizontales de fondo; `refLine` es la media de la sesión.
 */
function SplitBars({ rows, frac, color, axis, bands = [], refLine, tooltip, hover, setHover }) {
    const totalDist = rows.reduce((s, r) => s + (r.distance || 0), 0) || 1;
    const cols = rows.reduce((acc, r) => {
        const prev = acc[acc.length - 1];
        acc.push({ x: prev ? prev.x + prev.w : 0, w: (100 * (r.distance || 0)) / totalDist });
        return acc;
    }, []);
    const hc = hover != null ? cols[hover] : null;

    return (
        <div>
            <div className="flex">
                <div className="relative w-10 shrink-0 h-44 text-[10px] tabular-nums text-slate-400">
                    {axis.map(a => (
                        <span key={a.label + a.frac} className="absolute right-2 -translate-y-1/2" style={{ top: `${100 * (1 - a.frac)}%` }}>{a.label}</span>
                    ))}
                </div>
                <div className="relative flex-1 min-w-0 h-44 border-b border-slate-200" onMouseLeave={() => setHover(null)}>
                    {bands.map(b => (
                        <div key={b.label} className="absolute inset-x-0" style={{ bottom: `${100 * b.from}%`, height: `${100 * (b.to - b.from)}%`, background: b.color }}>
                            <span className="absolute right-1 top-0.5 text-[9px] font-bold" style={{ color: b.text }}>{b.label}</span>
                        </div>
                    ))}
                    {!bands.length && [0.5, 1].map(f => (
                        <div key={f} className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ top: `${100 * (1 - f)}%` }} />
                    ))}
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                        {rows.map((r, i) => {
                            const f = frac(r);
                            if (f == null) return null;
                            const top = 100 * (1 - f);
                            const gap = Math.min(0.4, cols[i].w * 0.12);
                            return (
                                <rect key={i}
                                    x={cols[i].x + gap} width={Math.max(cols[i].w - gap * 2, 0.15)}
                                    y={top} height={100 - top}
                                    fill={color(r)}
                                    opacity={r.isPartial ? 0.45 : hover != null && hover !== i ? 0.5 : 0.95}
                                />
                            );
                        })}
                        {refLine && (
                            <line x1="0" x2="100" y1={100 * (1 - refLine.frac)} y2={100 * (1 - refLine.frac)}
                                stroke="#0f172a" strokeOpacity="0.5" strokeDasharray="4 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        )}
                    </svg>
                    {refLine && (
                        <span className="absolute left-1 -translate-y-full text-[10px] font-semibold tabular-nums text-slate-600 bg-white/85 px-1 rounded"
                            style={{ top: `${100 * (1 - refLine.frac)}%` }}>
                            {refLine.label}
                        </span>
                    )}
                    <div className="absolute inset-0 flex">
                        {rows.map((r, i) => (
                            <div key={i} className="h-full cursor-crosshair" style={{ width: `${cols[i].w}%` }} onMouseEnter={() => setHover(i)} />
                        ))}
                    </div>
                    {hover != null && (
                        <div className="absolute top-1 z-10 pointer-events-none -translate-x-1/2 rounded-lg bg-slate-900/95 text-white px-3 py-2 text-[11px] shadow-lg whitespace-nowrap"
                            style={{ left: `${Math.min(85, Math.max(15, hc.x + hc.w / 2))}%` }}>
                            {tooltip(rows[hover])}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex ml-10 mt-1">
                {rows.map((r, i) => (
                    <div key={i} className={`text-center text-[10px] tabular-nums truncate ${hover === i ? 'font-bold text-slate-700' : 'text-slate-400'}`} style={{ width: `${cols[i].w}%` }}>
                        {cols[i].w > 3.5 ? r.lap_index : ''}
                    </div>
                ))}
            </div>
        </div>
    );
}

function Legend({ items }) {
    return (
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 mb-2 text-[11px] text-slate-500">
            {items.map(it => (
                <span key={it.label} className="inline-flex items-center gap-1.5">
                    {it.dashed
                        ? <span className="w-3.5 border-t border-dashed border-slate-500" />
                        : <span className="w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />}
                    {it.label}
                </span>
            ))}
        </div>
    );
}

const PaceChart = ({ rows, avgPaceS, scale, hover, setHover }) => {
    const { t } = useTranslation();
    return (
        <div className="mb-4">
            <Legend items={[
                { color: BAR_FAST, label: t('splits.legend_faster') },
                { color: BAR_SLOW, label: t('splits.legend_slower') },
                { dashed: true, label: t('splits.avg') },
            ]} />
            <SplitBars
                rows={rows} hover={hover} setHover={setHover}
                frac={r => scale.frac(r.paceS)}
                color={paceColor}
                axis={[
                    { frac: 1, label: formatPaceFromSecPerKm(scale.lo) },
                    { frac: 0.5, label: formatPaceFromSecPerKm((scale.lo + scale.hi) / 2) },
                    { frac: 0, label: formatPaceFromSecPerKm(scale.hi) },
                ]}
                refLine={{ frac: scale.frac(avgPaceS), label: `${t('splits.avg')} ${formatPaceFromSecPerKm(avgPaceS)}` }}
                tooltip={h => (
                    <>
                        <div className="font-semibold text-slate-300 mb-0.5">{t('splits.split_n', { n: h.lap_index })} · {h.distKm} km</div>
                        <div className="tabular-nums"><span className="text-sm font-bold">{h.pace}</span>/km <span className="text-slate-400">· GAP {h.gap}</span></div>
                        <div className="tabular-nums text-slate-300">
                            {h.timeStr}
                            {Math.abs(h.elevation) > 2 ? ` · ${h.elevation > 0 ? '▲' : '▼'}${Math.abs(Math.round(h.elevation))} m` : ''}
                        </div>
                    </>
                )}
            />
        </div>
    );
};

const HrChart = ({ rows, bounds, hover, setHover }) => {
    const { t } = useTranslation();
    const hrs = rows.map(r => r.average_heartrate).filter(Boolean);
    if (!hrs.length) return null;
    const lo = Math.floor((Math.min(...hrs) - 8) / 5) * 5;
    const hi = Math.ceil((Math.max(...hrs) + 4) / 5) * 5;
    const f = (hr) => clamp01((hr - lo) / (hi - lo));
    // FC media de la sesión ponderada por tiempo, no media de parciales.
    const timed = rows.filter(r => r.average_heartrate && r.moving_time > 0);
    const totalT = timed.reduce((s, r) => s + r.moving_time, 0);
    const avgHr = totalT ? timed.reduce((s, r) => s + r.average_heartrate * r.moving_time, 0) / totalT : null;

    // Franjas de zona recortadas al dominio visible.
    const bands = bounds ? bounds.map((b, i) => ({
        from: f(Math.max(b.lo, lo)), to: f(Math.min(b.hi + 1, hi)),
        color: ZONES[i + 1].bg, text: ZONES[i + 1].text, label: ZONES[i + 1].label,
    })).filter(b => b.to - b.from > 0.04) : [];
    const used = [...new Set(rows.map(r => r.hrZone).filter(z => z > 0))].sort();
    const mid = Math.round((lo + hi) / 2);

    return (
        <div>
            <Legend items={[
                ...used.map(z => ({ color: ZONES[z].color, label: ZONES[z].label })),
                ...(avgHr ? [{ dashed: true, label: t('splits.avg') }] : []),
            ]} />
            <SplitBars
                rows={rows} hover={hover} setHover={setHover}
                frac={r => (r.average_heartrate ? f(r.average_heartrate) : null)}
                color={zoneColor}
                bands={bands}
                axis={[{ frac: 1, label: hi }, { frac: f(mid), label: mid }, { frac: 0, label: lo }]}
                refLine={avgHr ? { frac: f(avgHr), label: `${t('splits.avg')} ${Math.round(avgHr)} ppm` } : null}
                tooltip={h => (
                    <>
                        <div className="font-semibold text-slate-300 mb-0.5">{t('splits.split_n', { n: h.lap_index })} · {h.distKm} km</div>
                        <div className="tabular-nums">
                            <span className="text-sm font-bold">{h.average_heartrate ? Math.round(h.average_heartrate) : '—'}</span> ppm
                            {h.hrZone > 0 && <span className="ml-1 font-bold" style={{ color: ZONES[h.hrZone].color }}>{ZONES[h.hrZone].label}</span>}
                        </div>
                        <div className="tabular-nums text-slate-300">{h.pace}/km · {h.timeStr}</div>
                    </>
                )}
            />
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
                        <th className={`${th} hidden md:table-cell w-[24%]`} />
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
                                            background: paceColor(row),
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

// ─── Best Efforts ─────────────────────────────────────────────────────────────

const PR_RANK_LABELS = { 1: 'PR', 2: '2º', 3: '3º' };

/** Lista vertical: una línea por distancia con su ritmo; el tiempo, en el title. */
const BestEffortsSection = ({ efforts }) => {
    const { t } = useTranslation();
    if (!efforts?.length) return null;

    return (
        <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-2">
                {t('splits.best_efforts', 'Mejores Esfuerzos')} <span className="normal-case tracking-normal font-medium">· /km</span>
            </p>
            <div className="rounded-lg overflow-hidden border border-slate-100 divide-y divide-slate-100">
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
                            className={`flex items-center gap-1.5 px-3 py-1.5 ${isPR ? 'bg-amber-50' : isKm ? 'bg-blue-50' : 'bg-white'} ${isKm ? 'ring-1 ring-inset ring-blue-300' : ''}`}>
                            <span className={`text-xs truncate ${isKm ? 'font-bold text-blue-700' : 'text-slate-500'}`}>{effort.name}</span>
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

const ActivitySplits = ({ splits, hrParams, bestEfforts, similarActivities, splitsMetric, mode = 'pace', defaultOpen = false }) => {
    const { t } = useTranslation();
    // El gráfico ya resume la sesión; la tabla, vuelta a vuelta, se despliega a demanda.
    const [open, setOpen] = useState(defaultOpen);
    // Parcial señalado: compartido por gráfico y tabla para leer uno contra otro.
    const [hover, setHover] = useState(null);

    const { hrmax, hrrest } = hrParams ?? {};
    const bounds = useMemo(() => (hrmax && hrrest ? karvonenBounds({ hrmax, hrrest }) : null), [hrmax, hrrest]);

    const { rows, avgPaceS } = useMemo(() => {
        if (!splits || splits.length === 0) return { rows: [], avgPaceS: 0 };
        const full = splits.filter(s => s.distance >= 950 && s.average_speed > 0);
        const ref = full.length ? full : splits.filter(s => s.average_speed > 0);
        const avgSpeed = ref.reduce((s, a) => s + a.average_speed, 0) / ref.length;
        const avgPaceS = avgSpeed > 0 ? 1000 / avgSpeed : 300;
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
    }, [splits, bounds, splitsMetric]);

    const scale = useMemo(() => (rows.length ? paceScale(rows) : null), [rows]);

    if (!rows.length) {
        return <p className="py-4 text-center text-sm italic text-slate-400">{t('splits.no_splits', 'No hay parciales.')}</p>;
    }

    if (mode === 'hr') {
        return rows.some(r => r.average_heartrate)
            ? <HrChart rows={rows} bounds={bounds} hover={hover} setHover={setHover} />
            : <p className="text-xs italic text-slate-400">{t('session.no_hr')}</p>;
    }

    const hasEfforts = bestEfforts?.length > 0;
    return (
        <div className={hasEfforts ? 'grid gap-6 lg:grid-cols-3' : ''}>
            <div className={hasEfforts ? 'lg:col-span-2 min-w-0' : ''}>
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
            </div>
            {hasEfforts && <BestEffortsSection efforts={bestEfforts} />}
        </div>
    );
};

export default ActivitySplits;
