/* eslint-disable react-refresh/only-export-components -- librería: exporta definiciones, no componentes de página */
// Librería de UI generativa del chat (OpenUI Lang). El modelo no responde con
// markdown suelto sino con un programa OpenUI que compone estos bloques; el
// <Renderer> los pinta mientras llega el stream. Si un modelo flojo responde en
// markdown plano, RunQA cae a MarkdownText (ver isOpenUI).
import { createContext, useContext, useState } from 'react';
import { defineComponent, createLibrary, useRenderNode, useIsStreaming, generateSystemPrompt } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import { LineChart, BarChart } from '@tremor/react';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, InformationCircleIcon, ExclamationTriangleIcon, CheckCircleIcon, ShieldExclamationIcon, PlusIcon, CheckIcon } from '@heroicons/react/20/solid';
import MarkdownText from '../components/MarkdownText';
import { paceStr } from './aiInsights';
import { getTrainingPlans, saveWorkout } from './trainingPlans';
import { getPrimaryTargetRace } from './targetRaces';

// Los chips de seguimiento lanzan una pregunta nueva en el chat.
export const ChatAskContext = createContext(() => {});

const TONE = z.enum(['neutral', 'good', 'caution', 'risk']);

const toneText = {
    neutral: 'text-slate-900 dark:text-white',
    good: 'text-emerald-600 dark:text-emerald-400',
    caution: 'text-amber-600 dark:text-amber-400',
    risk: 'text-rose-600 dark:text-rose-400',
};

const SectionTitle = ({ children }) => children
    ? <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500 dark:text-white/55 mb-2">{children}</p>
    : null;

const Text = defineComponent({
    name: 'Text',
    description: 'Párrafo(s) de texto en markdown (negrita, listas). Úsalo para explicar y concluir.',
    props: z.object({
        markdown: z.string().describe('Contenido markdown'),
    }),
    component: ({ props }) => (
        <div className="text-sm text-slate-700 dark:text-white/80 leading-relaxed">
            <MarkdownText content={props.markdown || ''} />
        </div>
    ),
});

// Columnas según el número de cifras (clases estáticas para Tailwind).
const METRIC_COLS = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-4',
};

const Metrics = defineComponent({
    name: 'Metrics',
    description: 'Fila de 2-4 cifras clave (ritmo medio, km semanales, FC...). Solo con valores reales de los datos.',
    props: z.object({
        title: z.string().optional(),
        items: z.array(z.object({
            label: z.string(),
            value: z.string().describe('Valor con unidad, p. ej. "5:12 /km"'),
            change: z.string().optional().describe('Variación, p. ej. "+4%" o "-0:08 /km"'),
            tone: TONE.optional().describe('good = mejora, risk = empeora'),
        })),
    }),
    component: ({ props }) => (
        <div>
            <SectionTitle>{props.title}</SectionTitle>
            <div className={`grid ${METRIC_COLS[Math.min((props.items || []).length, 4)] || METRIC_COLS[4]} gap-px bg-slate-200 dark:bg-white/10 rounded-lg overflow-hidden ring-1 ring-slate-200 dark:ring-white/10`}>
                {(props.items || []).map((m, i) => (
                    <div key={i} className="bg-white dark:bg-[#0c0e12] px-3 py-2.5">
                        <p className="text-xs font-medium text-slate-500 dark:text-white/55 truncate">{m.label}</p>
                        <p className="text-lg font-bold tabular-nums tracking-tight text-slate-900 dark:text-white leading-snug">{m.value}</p>
                        {m.change && (
                            <p className={`flex items-center gap-0.5 text-xs font-semibold tabular-nums ${toneText[m.tone || 'neutral']}`}>
                                {m.tone === 'good' && <ArrowTrendingUpIcon className="w-3.5 h-3.5" />}
                                {m.tone === 'risk' && <ArrowTrendingDownIcon className="w-3.5 h-3.5" />}
                                {m.change}
                            </p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    ),
});

const Table = defineComponent({
    name: 'Table',
    description: 'Tabla para comparar sesiones o semanas. Máximo ~10 filas.',
    props: z.object({
        title: z.string().optional(),
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())).describe('Cada fila: un string por columna'),
    }),
    component: ({ props }) => {
        const rows = props.rows || [];
        // Columna numérica (cifras con unidad: "21.5 km", "5:28 /km", "149 ppm")
        // → a la derecha; texto libre → a la izquierda y pudiendo partir línea.
        const numeric = (props.columns || []).map((_, j) => j > 0 && rows.length > 0 &&
            rows.every(r => r?.[j] == null || /^[\s~≈<>+−-]*\d[\d.,:'″′\s]*(?:[a-zA-Zº%°/]{0,8}\s*\/?\s*[a-zA-Z]{0,4})?\s*$/.test(String(r[j]))));
        return (
            <div>
                <SectionTitle>{props.title}</SectionTitle>
                <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200 dark:ring-white/10">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-white/[0.04]">
                            <tr>
                                {(props.columns || []).map((c, i) => (
                                    <th key={i} className={`px-3 py-2 text-xs font-semibold text-slate-500 dark:text-white/55 whitespace-nowrap ${numeric[i] ? 'text-right' : 'text-left'}`}>{c}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                            {rows.map((r, i) => (
                                <tr key={i}>
                                    {(r || []).map((cell, j) => (
                                        <td key={j} className={`px-3 py-2 align-top ${j === 0
                                            ? 'text-left font-medium text-slate-900 dark:text-white whitespace-nowrap'
                                            : numeric[j]
                                                ? 'text-right tabular-nums whitespace-nowrap text-slate-700 dark:text-white/75'
                                                : 'text-left text-slate-600 dark:text-white/65 min-w-[10rem]'}`}>{cell}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    },
});

const Chart = defineComponent({
    name: 'Chart',
    description: 'Gráfico de evolución (line) o comparación (bar). Valores numéricos; ritmos en minutos decimales (5.2 = 5:12).',
    props: z.object({
        title: z.string().optional(),
        kind: z.enum(['line', 'bar']),
        labels: z.array(z.string()).describe('Eje X: fechas o nombres'),
        series: z.array(z.object({
            name: z.string(),
            values: z.array(z.number()),
        })),
        unit: z.string().optional().describe('Unidad del eje Y, p. ej. "km" o "ppm"'),
    }),
    component: ({ props }) => {
        const series = (props.series || []).filter(s => s?.name);
        const data = (props.labels || []).map((label, i) => {
            const row = { label };
            series.forEach(s => { row[s.name] = s.values?.[i] ?? null; });
            return row;
        });
        // Ritmos: el modelo los manda en decimal (5.47); se muestran como 5:28.
        const isPace = /min\s*\/\s*km|\/km/i.test(props.unit || '') || /ritmo/i.test(props.title || '');
        // Un ritmo en barras desde 0 sale plano y engaña: siempre en línea con
        // el eje ajustado a los datos. Las líneas (VFC, FC...) también se
        // ajustan; las barras de volumen siguen empezando en 0.
        const C = props.kind === 'bar' && !isPace ? BarChart : LineChart;
        // En ritmo, más rápido = número menor: se pinta en negativo para que
        // mejorar suba en el gráfico, y el formateador devuelve el valor real.
        if (isPace) data.forEach(row => series.forEach(s => { if (row[s.name] != null) row[s.name] = -Math.abs(row[s.name]); }));
        const fmt = (v) => {
            if (v == null || Number.isNaN(v) || v === 0 && isPace) return '';
            if (isPace) return paceStr(Math.abs(v));
            return `${Number.isInteger(v) ? v : v.toFixed(1)}${props.unit ? ` ${props.unit}` : ''}`;
        };
        const unitLabel = isPace ? 'min/km' : props.unit;
        return (
            <div className="rounded-lg ring-1 ring-slate-200 dark:ring-white/10 p-3">
                <div className="flex items-baseline justify-between gap-3">
                    <SectionTitle>{props.title}</SectionTitle>
                    {unitLabel && !/\(.*\)/.test(props.title || '') && <span className="text-[11px] text-slate-400 dark:text-white/40 shrink-0">{unitLabel}</span>}
                </div>
                {data.length > 0 && series.length > 0 && (
                    <C
                        className="h-48"
                        autoMinValue={C === LineChart}
                        showDots={C === LineChart && data.length <= 12}
                        connectNulls
                        data={data}
                        index="label"
                        categories={series.map(s => s.name)}
                        colors={['blue', 'teal', 'orange', 'violet']}
                        valueFormatter={fmt}
                        showLegend={series.length > 1}
                        showAnimation={false}
                        yAxisWidth={44}
                    />
                )}
            </div>
        );
    },
});

const calloutStyle = {
    neutral: ['bg-slate-50 dark:bg-white/[0.04] ring-slate-200 dark:ring-white/10', 'text-slate-500', InformationCircleIcon],
    good: ['bg-emerald-50 dark:bg-emerald-400/10 ring-emerald-200 dark:ring-emerald-300/20', 'text-emerald-600 dark:text-emerald-400', CheckCircleIcon],
    caution: ['bg-amber-50 dark:bg-amber-400/10 ring-amber-200 dark:ring-amber-300/20', 'text-amber-600 dark:text-amber-400', ExclamationTriangleIcon],
    risk: ['bg-rose-50 dark:bg-rose-400/10 ring-rose-200 dark:ring-rose-300/20', 'text-rose-600 dark:text-rose-400', ShieldExclamationIcon],
};

const Callout = defineComponent({
    name: 'Callout',
    description: 'Aviso destacado: conclusión clave (good), precaución por carga/fatiga (caution) o riesgo de lesión (risk).',
    props: z.object({
        tone: TONE,
        title: z.string(),
        text: z.string().optional(),
    }),
    component: ({ props }) => {
        const [box, icon, Icon] = calloutStyle[props.tone] || calloutStyle.neutral;
        return (
            <div className={`flex gap-2.5 rounded-lg ring-1 px-3 py-2.5 ${box}`}>
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${icon}`} />
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{props.title}</p>
                    {props.text && <div className="text-sm text-slate-700 dark:text-white/75"><MarkdownText content={props.text} /></div>}
                </div>
            </div>
        );
    },
});

const Workout = defineComponent({
    name: 'Workout',
    description: 'Sesión recomendada con sus bloques (calentamiento, series, vuelta a la calma).',
    props: z.object({
        title: z.string(),
        summary: z.string().optional().describe('Objetivo de la sesión en una frase'),
        steps: z.array(z.object({
            label: z.string().describe('p. ej. "Calentamiento" o "6 × 800 m"'),
            target: z.string().describe('Ritmo o zona, p. ej. "4:05 /km · Z4"'),
        })),
        date: z.string().optional().describe('Fecha propuesta YYYY-MM-DD; permite añadirla al plan'),
        distanceKm: z.number().optional().describe('Distancia total de la sesión en km'),
    }),
    component: function WorkoutView({ props }) {
        return (
            <div className="rounded-lg ring-1 ring-slate-200 dark:ring-white/10 overflow-hidden">
                <div className="px-3 py-2.5 border-l-[3px] border-teal-600 dark:border-teal-300 bg-slate-50 dark:bg-white/[0.04]">
                    <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{props.title}</p>
                        {props.date && <p className="text-xs font-semibold tabular-nums text-slate-500 dark:text-white/55 shrink-0">{formatDay(props.date)}</p>}
                    </div>
                    {props.summary && <p className="text-xs text-slate-500 dark:text-white/55 mt-0.5">{props.summary}</p>}
                </div>
                <ol className="divide-y divide-slate-100 dark:divide-white/5">
                    {(props.steps || []).map((s, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                            <span className="text-slate-700 dark:text-white/80"><span className="tabular-nums text-slate-400 mr-2">{i + 1}</span>{s.label}</span>
                            <span className="font-semibold tabular-nums text-slate-900 dark:text-white text-right">{s.target}</span>
                        </li>
                    ))}
                </ol>
                {isPlannableDate(props.date) && <AddToPlan workout={props} />}
            </div>
        );
    },
});

// Solo se ofrece añadir al plan una fecha válida de hoy en adelante (máx. un
// año): protege de fechas mal generadas por el modelo (p. ej. un año antiguo).
const isPlannableDate = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
    const [y, m, d] = iso.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    if (day.getMonth() !== m - 1) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = (day - today) / 864e5;
    return diff >= 0 && diff <= 366;
};

const formatDay = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
};

// Plan destino: el vinculado a la carrera principal o, si no hay, el primero.
const targetPlan = () => {
    try {
        const plans = getTrainingPlans() || [];
        const primary = getPrimaryTargetRace();
        return plans.find(p => primary && p.raceId === primary.id) || plans[0] || null;
    } catch { return null; }
};

// Añadir la sesión al plan. Escribe en los datos del usuario, así que siempre
// pide confirmación y avisa si ese día ya hay una sesión.
function AddToPlan({ workout }) {
    const streaming = useIsStreaming();
    const [stage, setStage] = useState('idle'); // idle | confirm | done | error
    const plan = targetPlan();
    if (streaming) return null;
    if (!plan) {
        return <p className="px-3 py-2 text-xs text-slate-500 dark:text-white/55 border-t border-slate-100 dark:border-white/5">Crea un plan de entrenamiento para poder añadir sesiones desde el chat.</p>;
    }
    const clash = (plan.workouts || []).find(w => w.date === workout.date && w.status !== 'skipped');

    const add = () => {
        try {
            saveWorkout(plan.id, {
                date: workout.date,
                type: workout.title,
                summary: workout.summary || '',
                distance_km: workout.distanceKm ?? null,
                coach_note: `Añadida desde el chat: ${(workout.steps || []).map(s => `${s.label} (${s.target})`).join(' · ')}`,
            });
            setStage('done');
        } catch { setStage('error'); }
    };

    return (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-white/5 bg-white dark:bg-transparent">
            {stage === 'idle' && (
                <button type="button" onClick={() => setStage('confirm')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-teal-800 dark:text-teal-200 ring-1 ring-teal-600/30 dark:ring-teal-300/30 hover:bg-teal-50 dark:hover:bg-teal-400/10 transition-colors">
                    <PlusIcon className="w-3.5 h-3.5" /> Añadir al plan
                </button>
            )}
            {stage === 'confirm' && (
                <>
                    <p className="text-xs text-slate-700 dark:text-white/75 flex-1 min-w-[12rem]">
                        ¿Añadir el {formatDay(workout.date)} a «{plan.name}»?
                        {clash && <span className="block text-amber-700 dark:text-amber-300">Ese día ya tienes «{clash.type}»; se añadirá además.</span>}
                    </p>
                    <button type="button" onClick={add} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors">Confirmar</button>
                    <button type="button" onClick={() => setStage('idle')} className="px-2.5 py-1 rounded-md text-xs font-semibold text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors">Cancelar</button>
                </>
            )}
            {stage === 'done' && (
                <p className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400"><CheckIcon className="w-3.5 h-3.5" /> Añadida a «{plan.name}» el {formatDay(workout.date)}</p>
            )}
            {stage === 'error' && <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">No se pudo guardar la sesión.</p>}
        </div>
    );
}

const FollowUps = defineComponent({
    name: 'FollowUps',
    description: 'Hasta 3 preguntas de seguimiento breves que el usuario podría hacer a continuación. Siempre al final.',
    props: z.object({
        questions: z.array(z.string()),
    }),
    component: function FollowUpsView({ props }) {
        const ask = useContext(ChatAskContext);
        return (
            <div className="flex flex-wrap gap-1.5 pt-1">
                {(props.questions || []).slice(0, 3).map((q, i) => (
                    <button
                        key={i}
                        type="button"
                        onClick={() => ask(q)}
                        className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-600 dark:text-white/70 ring-1 ring-slate-200 dark:ring-white/10 hover:ring-teal-600/40 hover:text-teal-800 dark:hover:text-teal-200 hover:bg-teal-50/60 dark:hover:bg-teal-400/10 transition-colors text-left"
                    >
                        {q}
                    </button>
                ))}
            </div>
        );
    },
});

// Colores de zona de DESIGN.md (zone-1..5); texto con contraste suficiente.
const ZONE_STYLE = {
    Z1: { bar: '#94a3b8', text: 'text-slate-600 dark:text-slate-300' },
    Z2: { bar: '#38bdf8', text: 'text-sky-700 dark:text-sky-300' },
    Z3: { bar: '#4ade80', text: 'text-green-700 dark:text-green-300' },
    Z4: { bar: '#fb923c', text: 'text-orange-700 dark:text-orange-300' },
    Z5: { bar: '#f87171', text: 'text-red-700 dark:text-red-300' },
};
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}′` : `${Math.round(m)}′`);

const Zones = defineComponent({
    name: 'Zones',
    description: 'Reparto del tiempo en zonas de FC (Z1-Z5). Úsalo con los datos de time_in_zones; minutos por zona.',
    props: z.object({
        title: z.string().optional(),
        zones: z.array(z.object({
            zone: z.enum(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']),
            minutes: z.number(),
        })),
    }),
    component: ({ props }) => {
        const zones = (props.zones || []).filter(zn => ZONE_STYLE[zn?.zone] && zn.minutes >= 0);
        const total = zones.reduce((s, zn) => s + zn.minutes, 0);
        if (!total) return null;
        return (
            <div className="rounded-lg ring-1 ring-slate-200 dark:ring-white/10 p-3">
                <div className="flex items-baseline justify-between gap-3">
                    <SectionTitle>{props.title || 'Tiempo por zonas de FC'}</SectionTitle>
                    <span className="text-[11px] tabular-nums text-slate-400 dark:text-white/40 shrink-0">{fmtMin(total)} en total</span>
                </div>
                <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 dark:bg-white/[0.06]" role="img"
                    aria-label={zones.map(zn => `${zn.zone} ${Math.round(zn.minutes / total * 100)}%`).join(', ')}>
                    {zones.map(zn => (
                        <div key={zn.zone} style={{ width: `${zn.minutes / total * 100}%`, background: ZONE_STYLE[zn.zone].bar }} title={`${zn.zone}: ${fmtMin(zn.minutes)}`} />
                    ))}
                </div>
                <div className="grid grid-cols-5 gap-1 mt-2.5">
                    {zones.map(zn => (
                        <div key={zn.zone} className="min-w-0">
                            <p className={`text-xs font-bold ${ZONE_STYLE[zn.zone].text}`}>{zn.zone}</p>
                            <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{Math.round(zn.minutes / total * 100)}%</p>
                            <p className="text-[11px] tabular-nums text-slate-500 dark:text-white/55 truncate">{fmtMin(zn.minutes)}</p>
                        </div>
                    ))}
                </div>
            </div>
        );
    },
});

const Compare = defineComponent({
    name: 'Compare',
    description: 'Dos sesiones (o periodos) frente a frente, métrica a métrica. `better` marca qué lado es mejor en esa métrica.',
    props: z.object({
        title: z.string().optional(),
        left: z.string().describe('Nombre corto de la sesión A, p. ej. "8 nov · 21,6 km"'),
        right: z.string().describe('Nombre corto de la sesión B'),
        rows: z.array(z.object({
            metric: z.string(),
            left: z.string(),
            right: z.string(),
            better: z.enum(['left', 'right', 'equal']).optional(),
        })),
    }),
    component: ({ props }) => {
        const cell = (side, row) => {
            const win = row.better === side;
            return (
                <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${win ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-white/75'}`}>
                    {win && <CheckIcon className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-label="mejor" />}{row[side]}
                </td>
            );
        };
        return (
            <div>
                <SectionTitle>{props.title}</SectionTitle>
                <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200 dark:ring-white/10">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-white/[0.04]">
                            <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 dark:text-white/55" />
                                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-900 dark:text-white">{props.left}</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-900 dark:text-white">{props.right}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                            {(props.rows || []).map((row, i) => (
                                <tr key={i}>
                                    <td className="px-3 py-2 text-left text-slate-600 dark:text-white/65">{row.metric}</td>
                                    {cell('left', row)}
                                    {cell('right', row)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    },
});

const blocks = [Text, Metrics, Table, Chart, Zones, Compare, Callout, Workout, FollowUps];

const Answer = defineComponent({
    name: 'Answer',
    description: 'Respuesta completa: lista ordenada de bloques.',
    props: z.object({
        blocks: z.array(z.union(blocks.map(b => b.ref))),
    }),
    component: function AnswerView({ props }) {
        const renderNode = useRenderNode();
        return (
            <div className="space-y-3">
                {(props.blocks || []).map((b, i) => <div key={i}>{renderNode(b)}</div>)}
            </div>
        );
    },
});

export const chatLibrary = createLibrary({
    components: [Answer, ...blocks],
    root: 'Answer',
});

const CHAT_RULES = {
    additionalRules: [
        'Responde SIEMPRE en OpenUI Lang con root = Answer([...]). Nada de texto fuera del programa ni bloques ```.',
        'Empieza con un Text breve que responda directamente. Añade Metrics, Table o Chart solo si aportan; no repitas en texto las cifras que ya muestra un bloque.',
        'En Workout incluye date (YYYY-MM-DD) cuando la sesión sea para un día concreto, para que el usuario pueda añadirla a su plan con un botón; no dupliques sesiones que ya estén en el plan ese día.',
        'Para el reparto de intensidad usa Zones (no un Chart). Para comparar exactamente dos sesiones o periodos usa Compare (no una Table).',
        'Usa Workout solo cuando recomiendes una sesión concreta y Callout para la conclusión clave o un aviso de carga/lesión.',
        'Termina con FollowUps (2-3 preguntas cortas en el idioma del usuario).',
        'Todos los números deben salir de los datos proporcionados; nunca los inventes.',
        'Cada Chart muestra UNA sola magnitud y unidad (solo ritmo, o solo FC, o solo km). Nunca mezcles ritmo y FC, o VFC y FC, en el mismo gráfico: usa dos Chart o una Table.',
        'Escribe todo en el idioma del usuario, sin palabras en otro idioma.',
        'Si la pregunta trata de una evolución (VFC, FC en reposo, km por semana, ritmo en el tiempo) y hay 4 o más valores en los datos, incluye un Chart de línea con esa serie, además de las cifras.',
    ],
    examples: [
        `root = Answer([intro, kpis, trend, tip, next])
intro = Text("Tu ritmo en rodaje ha **mejorado 8 s/km** en el último mes con la misma FC.")
kpis = Metrics("Último mes", [{label: "Ritmo medio", value: "5:24 /km", change: "-0:08 /km", tone: "good"}, {label: "Volumen", value: "38 km/sem"}])
trend = Chart("Ritmo por semana", "line", ["S1", "S2", "S3", "S4"], [{name: "Ritmo (min/km)", values: [5.53, 5.45, 5.42, 5.4]}], "min/km")
tip = Callout("good", "Buena adaptación aeróbica", "Mantén el volumen dos semanas antes de subirlo.")
next = FollowUps(["¿Cuándo meto series?", "¿Cómo está mi carga?"])`,
    ],
};

// Prompt local (proveedores normales) y bloque gestionado del OpenUI Gateway:
// con `cloud: true` el gateway monta el prompt y valida/corrige el OpenUI Lang.
export const chatUIPrompt = chatLibrary.prompt(CHAT_RULES);
export const chatCloudPrompt = generateSystemPrompt({ cloud: true, library: chatLibrary.toSpec(), promptOptions: CHAT_RULES });

// Heurística de respaldo: ¿la respuesta es un programa OpenUI o markdown plano?
// El OpenUI Gateway envuelve la salida en marcadores "]]>openui:..." y una valla
// ```openui-lang; se quitan para pintar (también a mitad de stream).
// Con herramientas, el modelo a veces narra antes del programa ("Voy a consultar
// tus datos…", incluso pegado al marcador): todo lo previo a `root =` se descarta.
export const cleanOpenUI = (text) => {
    let t = text || '';
    const marker = t.lastIndexOf(']]>openui:content');
    if (marker >= 0) t = t.slice(t.indexOf('\n', marker) + 1 || t.length);
    t = t
        .replace(/\]\]>openui:[^\n]*\n?/g, '')
        .replace(/^\s*```(?:openui-lang)?[^\n]*\n?/gm, '');
    const root = t.search(/^\s*root\s*=/m);
    return root > 0 ? t.slice(root) : t;
};

export const isOpenUI = (text) => /^\s*root\s*=/.test(text || '') || /\n\s*root\s*=\s*Answer\(/.test(text || '');
