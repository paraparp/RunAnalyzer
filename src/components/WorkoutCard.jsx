// Ficha técnica de un entreno de plan (lib/workoutProtocol): categoría con color,
// título con la dosis, perfil por bloques proporcional al tiempo, línea de tiempo
// con ritmo y FC de cada bloque, y la regla clave al pie. La usan la sección de
// planes y la portada.
import { expandSteps, workoutCategory, NON_RUNNING_KINDS } from '../lib/workoutProtocol';
import { CATEGORY_STYLE } from '../lib/workoutStyle';

// Mismo código de color por intensidad que la portada (TodayPlannedSession).
const INTENSITY_BG = {
    1: 'bg-cyan-200', 2: 'bg-sky-300', 3: 'bg-blue-500', 4: 'bg-orange-500', 5: 'bg-rose-600',
};
const INTENSITY_H = { 1: '35%', 2: '50%', 3: '70%', 4: '85%', 5: '100%' };

const fmtMin = (m) => {
    if (!(m > 0)) return null;
    // Pausas cortas en segundos, como se prescriben: 75″, 90″.
    if (m < 2 && !Number.isInteger(m)) return `${Math.round(m * 60)}″`;
    const r = Math.round(m * 10) / 10;
    if (r < 60) return `${String(r).replace('.', ',')}′`;
    const h = Math.floor(r / 60);
    return `${h}h${String(Math.round(r - h * 60)).padStart(2, '0')}`;
};

/** Perfil: una barra por bloque, ancho ∝ minutos y alto ∝ intensidad. */
function Profile({ rows, totalMin }) {
    const timed = rows.filter((r) => r.min > 0);
    if (!timed.length || !(totalMin > 0)) return null;
    return (
        <div className="px-4 sm:px-5 pb-3">
            <div className="flex items-end gap-0.5 h-12">
                {timed.map((r, i) => {
                    const lvl = r.kind === 'recovery' ? 1 : Math.min(5, Math.max(1, Math.round(Number(r.intensity) || (r.kind === 'work' ? 4 : 2))));
                    return (
                        <div
                            key={i}
                            title={`${r.label || r.phase || 'Pausa'} · ${fmtMin(r.min)}${r.pace ? ` · ${r.pace}` : ''}${r.hr ? ` · ${r.hr} ppm` : ''}`}
                            className={`rounded-t-sm ${r.kind === 'recovery' ? 'bg-slate-200 dark:bg-slate-700' : INTENSITY_BG[lvl]}`}
                            style={{ width: `${(r.min / totalMin) * 100}%`, height: INTENSITY_H[lvl], minWidth: '3px' }}
                        />
                    );
                })}
            </div>
            <div className="flex justify-between mt-1 text-[10px] font-mono text-slate-400 tabular-nums">
                <span>0′</span><span>{fmtMin(totalMin)}</span>
            </div>
        </div>
    );
}

/** Línea de tiempo de bloques: nombre y prescripción a la izquierda; duración y FC a la derecha. */
function Blocks({ rows, accent }) {
    return (
        <ol className="px-4 sm:px-5 pb-3">
            {rows.map((r, i) => {
                const rec = r.kind === 'recovery';
                const work = r.kind === 'work';
                const extra = NON_RUNNING_KINDS.has(r.kind);
                const dist = Number(r.distance_km) > 0 ? `${String(r.distance_km).replace('.', ',')} km` : null;
                return (
                    <li key={i} className={`relative flex justify-between gap-3 pl-6 ${rec ? 'py-1 opacity-70' : 'py-2'}`}>
                        <span className="absolute left-[7px] top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
                        <span
                            className={`absolute top-3 rounded-full border-2 border-white dark:border-slate-900 ${work ? `left-[3px] w-2.5 h-2.5 ${accent.dot}` : 'left-[4px] w-2 h-2 bg-slate-300'}`}
                            aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                            {(r.label || r.phase) && (
                                <p className={`text-xs font-bold ${work ? accent.text : 'text-slate-800 dark:text-slate-200'}`}>{r.label || r.phase}</p>
                            )}
                            {(r.description || r.pace) && (
                                <p className={`text-xs ${rec ? 'text-slate-500' : 'text-slate-600 dark:text-slate-300'}`}>
                                    {r.description || (r.pace ? `a ${r.pace}/km` : '')}
                                    {r.description && r.pace && <span className="font-mono text-slate-500"> · {r.pace}/km</span>}
                                </p>
                            )}
                            {r.note && !rec && (r.rep ?? 1) === 1 && <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{r.note}</p>}
                        </div>
                        {!extra && (
                            <div className="shrink-0 text-right font-mono tabular-nums">
                                <p className={`text-xs ${rec ? 'text-slate-400' : 'text-slate-700 dark:text-slate-200 font-semibold'}`}>{fmtMin(r.min) || dist || '—'}</p>
                                {r.hr && <p className={`text-[11px] whitespace-nowrap ${work ? accent.text : 'text-slate-400'}`}>{r.hr}</p>}
                            </div>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

/**
 * `showHeader` pinta categoría, título y totales; la portada lo omite porque ya
 * tiene su propia cabecera.
 */
export default function WorkoutCard({ workout, kicker, showHeader = true }) {
    const category = workoutCategory(workout);
    const accent = CATEGORY_STYLE[category] || CATEGORY_STYLE.easy;
    const { rows, totalMin } = expandSteps(workout?.structured_workout);
    const total = totalMin || Number(workout?.duration_min) || 0;
    const km = Number.isFinite(workout?.distance_km) ? workout.distance_km : null;

    return (
        <div className="relative rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
            <span className={`absolute inset-x-0 top-0 h-0.5 ${accent.bar}`} aria-hidden />
            {showHeader && (
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 sm:px-5 pt-4 pb-3">
                    <div className="min-w-0">
                        <p className={`text-[11px] font-mono font-semibold uppercase tracking-wider ${accent.text}`}>
                            {accent.label}{kicker ? ` · ${kicker}` : ''}
                        </p>
                        <h4 className="text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight leading-tight mt-1">{workout?.type}</h4>
                        {workout?.summary && <p className="text-xs text-slate-500 mt-0.5">{workout.summary}</p>}
                    </div>
                    {(total > 0 || km != null) && (
                        <div className="text-right font-mono tabular-nums">
                            {total > 0 && <p className="text-base font-bold text-slate-900 dark:text-slate-100">{fmtMin(total)}</p>}
                            {km != null && <p className="text-xs text-slate-500">{String(km).replace('.', ',')} km</p>}
                        </div>
                    )}
                </div>
            )}
            {rows.length > 0 && <Profile rows={rows} totalMin={totalMin} />}
            {rows.length > 0 && <Blocks rows={rows} accent={accent} />}
            {workout?.key_rule && (
                <div className="px-4 sm:px-5 py-2.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-600 dark:bg-slate-800/60 dark:border-slate-800 dark:text-slate-300 leading-relaxed">
                    <span className="font-bold text-slate-800 dark:text-slate-100">Regla clave · </span>{workout.key_rule}
                </div>
            )}
        </div>
    );
}
