import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import cloudStorage from '../lib/cloudStorage';
import {
  ArrowTrendingUpIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  BoltIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { OVERRIDES_EVENT } from '../lib/hrOverrides';
import useCalibratedPMC from '../hooks/useCalibratedPMC';
import useGarminWearableData from '../hooks/useGarminWearableData';
import { computeStats, computeGarminStats, loadPhase, formZone, isRun, fmt1 } from '../lib/statusStats';
import useTodaySession from '../hooks/useTodaySession';
import { coachSessionFrom } from '../lib/todaySession';
import useAIInsights from '../hooks/useAIInsights';
import { CoachBadge, CoachBanners, CoachDisclosure, CoachMD, CoachSettings, CoachText } from './CoachAI';
import { CUR_BADGES, TREND_BADGES, deriveStatusKey, deriveTrendKey, formatTs } from '../lib/aiInsights';
import TodayPlannedSession from './TodayPlannedSession';
import { computeReadiness } from '../lib/athleteContext';
import { getPrimaryTargetRace, daysUntil, formatMinutes, TARGET_RACES_EVENT } from '../lib/targetRaces';
import { DISTANCE_KM } from '../lib/raceDistances';
import { karvonenBounds, classifyHR, POLARIZED_TARGETS } from '../lib/hrZones';
import { zoneMix, polarizedGroups, polarizationStatus } from '../lib/zoneMix';
import { shoeLifeKm } from '../lib/shoeLife';
import { weeklyVolumeRamp } from '../lib/weeklyVolume';
import { weekStartKey } from '../lib/isoWeek';
import { formatPaceFromSpeed, formatPaceFromSecPerKm, formatMinutesHm } from '../lib/timeFormat';

// ─────────────────────────────────────────────────────────────────────────────
// Hoy. La portada contesta "¿cómo voy y qué hago?", de lo inmediato a lo
// acumulado: carrera objetivo, 01 hoy (readiness + sesión del día), 02 carga y
// volumen, 03 intensidad y tendencia, 04 últimas sesiones. Cada cifra sale UNA
// vez: el TSB y el ACWR viven en la tarjeta de Forma y en ningún otro sitio.
//
// TODO lo que se pinta aquí sale de los mismos módulos de cálculo que usan el
// resto de vistas y el coach IA (`statusStats`, `athleteContext`, `zoneMix`,
// `gap`, `shoeLife`, `weeklyVolume`). Cuando un dato no está, se pinta `—`: un
// número de relleno en la portada es peor que un hueco, porque el atleta no
// puede distinguirlo de una medida real.
// ─────────────────────────────────────────────────────────────────────────────

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const DASH = '—';
const ARC_LEN_READY = 314.15;         // 2πr con r=50

// Zonas de Karvonen con los colores de la vista de Zonas: el mismo reparto no
// puede cambiar de pinta según dónde se mire.
const ZONES = [
  { name: 'Z1', role: 'Recuperación', color: '#94a3b8' },
  { name: 'Z2', role: 'Base',         color: '#38bdf8' },
  { name: 'Z3', role: 'Aeróbico',     color: '#4ade80' },
  { name: 'Z4', role: 'Umbral',       color: '#fb923c' },
  { name: 'Z5', role: 'VO2max',       color: '#f87171' },
];

const VERDICT = {
  ok:   { label: '80/20 CUMPLIDO', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  gray: { label: 'ZONA GRIS',      cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'         },
  low:  { label: 'FALTA CALIDAD',  cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'                 },
  mod:  { label: 'REPARTO MIXTO',  cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'     },
};

const hoursStr = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}′` : `${m}′`;
};

// Path de sparkline a partir de una serie de valores reales (nulls incluidos).
const sparkPath = (values, { w = 100, h = 24, pad = 3 } = {}) => {
  const pts = (values || []).map((v, i) => [i, v]).filter(([, v]) => v != null && Number.isFinite(v));
  if (pts.length < 2) return null;
  const vals = pts.map(([, v]) => v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const n = (values || []).length - 1 || 1;
  return pts
    .map(([i, v], k) => {
      const x = (i / n) * w;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
};

// Color de un bloque del coach según su intensidad (1-5).
const intensityClass = (z) => (z >= 4 ? 'bg-rose-500 text-white'
  : z === 3 ? 'bg-amber-400 text-amber-950'
    : z === 2 ? 'bg-blue-600 text-white'
      : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200');

// ── Átomos de la portada ─────────────────────────────────────────────────────

const TONE = {
  emerald: { icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400', stroke: '#10b981', text: 'text-emerald-600 dark:text-emerald-400', pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  blue:    { icon: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',             stroke: '#2563eb', text: 'text-blue-600 dark:text-blue-400',       pill: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' },
  amber:   { icon: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',         stroke: '#f59e0b', text: 'text-amber-600 dark:text-amber-400',     pill: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  rose:    { icon: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',             stroke: '#f43f5e', text: 'text-rose-600 dark:text-rose-400',       pill: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' },
  slate:   { icon: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',           stroke: '#94a3b8', text: 'text-slate-400',                         pill: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const TYPE_CLS = {
  INT: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  LSD: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  REC: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  RUN: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
};

// Cabecera de sección: número, título, contexto y, si la hay, la vista que la amplía.
function SectionTitle({ n, title, sub, action, onMore }) {
  return (
    <div className="flex items-center gap-2.5 px-0.5">
      <span className="text-[10px] font-black text-slate-300 dark:text-slate-600 tabular-nums">{n}</span>
      <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-slate-200 shrink-0">{title}</h2>
      {sub && <span className="hidden sm:inline text-[11px] text-slate-400 truncate">{sub}</span>}
      <span className="flex-1 h-px bg-slate-200/80 dark:bg-slate-800" />
      {action}
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
        >
          Ver más <ChevronRightIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function Tile({ label, icon: Icon, tone = 'blue', children }) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${(TONE[tone] ?? TONE.blue).icon}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      {children}
    </div>
  );
}

function Rows({ rows }) {
  return (
    <dl className="mt-auto pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-2">
          <dt className="text-[10px] text-slate-400 truncate">{r.label}</dt>
          <dd className={`text-[11px] font-bold tabular-nums shrink-0 ${r.cls ?? 'text-slate-600 dark:text-slate-300'}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Delta({ v, suffix = '' }) {
  if (v == null || !Number.isFinite(v)) return null;
  return (
    <span className={`ml-auto text-[10px] font-bold tabular-nums ${v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
      {v >= 0 ? '+' : ''}{v.toFixed(1)}{suffix}
    </span>
  );
}

function Spark({ data, stroke }) {
  const path = sparkPath((data || []).map(d => d.v));
  if (!path) return null;
  return (
    <svg className="w-full h-8" preserveAspectRatio="none" viewBox="0 0 100 24">
      <path d={path} fill="none" stroke={stroke} strokeLinecap="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Frescura (TSB) en escala divergente: lo que se lee es el signo y la distancia
// al cero, no el número suelto. La escala se abre si el TSB se sale de ±30, para
// que el punto nunca se quede clavado en el extremo.
function TsbGauge({ tsb }) {
  if (tsb == null || !Number.isFinite(tsb)) return null;
  const span = Math.max(30, Math.ceil(Math.abs(tsb) / 10) * 10);
  const left = 50 + (Math.max(-span, Math.min(span, tsb)) / span) * 50;
  return (
    <div className="py-1">
      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 rounded-full overflow-hidden flex">
          <div className="w-[33%] bg-rose-100 dark:bg-rose-950/60" title="Fatiga alta" />
          <div className="w-[17%] bg-orange-100 dark:bg-orange-950/60" title="Bloque de carga" />
          <div className="w-[25%] bg-emerald-100 dark:bg-emerald-950/60" title="Rango productivo" />
          <div className="w-[25%] bg-sky-100 dark:bg-sky-950/60" title="Fresco / afinado" />
        </div>
        <div className="absolute top-0 bottom-0 w-px bg-slate-300 dark:bg-slate-600" style={{ left: '50%' }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white ring-2 ring-slate-700 dark:ring-slate-300 shadow"
          style={{ left: `${left}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-slate-400 mt-1">
        <span>fatiga</span><span>equilibrio</span><span>fresco</span>
      </div>
    </div>
  );
}

// Una señal del readiness: valor, lectura contra su referencia y su tendencia.
function Signal({ label, value, unit, note, tone = 'slate', spark, bar }) {
  const c = TONE[tone] ?? TONE.slate;
  return (
    <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <span className="w-2 h-2 rounded-full" style={{ background: c.stroke }} />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-black text-slate-900 dark:text-slate-50 tabular-nums leading-none">{value}</span>
        <span className="text-[10px] text-slate-400 font-semibold">{unit}</span>
      </div>
      <span className={`text-[10px] font-bold truncate ${c.text}`}>{note}</span>
      {spark ? (
        <svg className="w-full h-4" preserveAspectRatio="none" viewBox="0 0 100 24">
          <path d={spark} fill="none" stroke={c.stroke} strokeLinecap="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : bar != null ? (
        <div className="h-1.5 my-[5px] rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${bar}%`, background: c.stroke }} />
        </div>
      ) : <div className="h-4" />}
    </div>
  );
}

// Reparto por zonas de una ventana de `days` días hasta `nowMs`, con su lectura
// polarizada y el veredicto 80/20.
function zoneWindow(runs, bounds, days, nowMs) {
  if (!bounds) return { hasData: false, bounds: null, pct: [], groups: null, verdictKey: null };
  const mix = zoneMix(runs, bounds, { days, now: nowMs });
  if (!mix.hasData) return { hasData: false, bounds, pct: [], groups: null, verdictKey: null };
  const groups = polarizedGroups(mix.pct);
  return {
    hasData: true,
    bounds,
    pct: mix.pct.map(p => Math.round(p)),
    times: mix.times,
    totalSec: mix.totalSec,
    groups,
    verdictKey: polarizationStatus(groups.low, groups.mod, groups.high),
    avgOnlySessions: mix.avgOnlySessions,
    sessions: mix.sessions,
  };
}

// Reparto de una ventana en una sola barra: las cinco zonas, la marca del
// objetivo de volumen fácil y el veredicto 80/20.
function ZoneBar({ label, mix }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{label}</span>
        {mix.hasData ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] text-slate-400 tabular-nums truncate">
              <span className="font-black text-emerald-600 dark:text-emerald-400">{Math.round(mix.groups.low)}%</span> fácil · {hoursStr(mix.totalSec)}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0 ${VERDICT[mix.verdictKey].cls}`}>
              {VERDICT[mix.verdictKey].label}
            </span>
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">Sin sesiones con FC</span>
        )}
      </div>
      <div className="relative">
        <div className="h-4 w-full rounded-lg overflow-hidden flex bg-slate-100 dark:bg-slate-800">
          {mix.hasData && ZONES.map((z, i) => (
            <div
              key={z.name}
              className="h-full transition-all duration-300"
              style={{ width: `${mix.pct[i]}%`, background: z.color }}
              title={`${z.name} ${z.role} · ${mix.pct[i]}% · ${hoursStr(mix.times[i])}`}
            />
          ))}
        </div>
        <div
          className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-slate-800/70 dark:bg-slate-200/70"
          style={{ left: `${POLARIZED_TARGETS.low}%` }}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, cls, className = '' }) {
  return (
    <div className={className}>
      <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <span className={`block text-xs font-bold tabular-nums ${cls ?? 'text-slate-800 dark:text-slate-200'}`}>{value}</span>
    </div>
  );
}

// "Ampliar en el chat": el mismo gesto que ofrece cada bloque de AIInsights, con
// la misma pinta, para que la portada entera se amplíe igual se mire donde se mire.
function AskChatBtn({ onAsk, focus }) {
  if (!onAsk) return null;
  return (
    <button
      type="button"
      onClick={() => onAsk(focus)}
      title="Ampliar este análisis en el chat de IA"
      className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide text-blue-500 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100/70 dark:hover:bg-blue-900/30 transition-colors cursor-pointer"
    >
      <ChatBubbleLeftRightIcon className="w-3 h-3" />
      <span>Ampliar</span>
    </button>
  );
}

export default function TodayView({ activities, runningActivities, hrParams, onNavigate, onOpenChat, onSync, isSyncing }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || 'es';

  // ── 1. Carreras de running filtradas ──────────────────────────────────────
  const runs = useMemo(
    () => runningActivities ?? activities.filter(a => RUNNING_TYPES.includes(a.sport_type || a.type)),
    [activities, runningActivities],
  );

  // ── 2. Carrera objetivo principal ─────────────────────────────────────────
  const [targetRace, setTargetRace] = useState(getPrimaryTargetRace);
  useEffect(() => {
    const reload = () => setTargetRace(getPrimaryTargetRace());
    window.addEventListener(TARGET_RACES_EVENT, reload);
    return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
  }, []);

  // ── 3. Motor fisiológico: PMC, wearables y telemetría ─────────────────────
  const { pmc } = useCalibratedPMC(activities);
  const { garmin, sleep } = useGarminWearableData();
  // "Ahora" fijo por montaje: las ventanas de 7/28/60 días son el corazón de
  // todo esto y no pueden moverse entre repintados. Solo lo mueve "Recalcular".
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Recalcular. Dos cosas distintas que el botón hace en el orden correcto:
  //   1. Baja datos nuevos — `onSync` es el MISMO `runSync(true)` de la barra
  //      superior (Strava + salud/sueño de Garmin). Sin esto solo se remasticaba
  //      lo que ya había en caché, que es por lo que "no hacía nada".
  //   2. Releer cachés y correr el reloj, que es lo que invalida las ventanas
  //      móviles de 7/28/60 días y fuerza el recálculo de todos los memos.
  const [recalcAt, setRecalcAt] = useState(null);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const busy = recalcBusy || isSyncing;

  // Coach IA: un único análisis para toda la portada (diagnóstico, sesión,
  // tendencia y ejecución). AIInsights, más abajo, recibe este mismo estado.
  const ai = useAIInsights(activities);
  // "Recalcular" también pide un análisis nuevo, pero DESPUÉS de sincronizar:
  // `ai.run` cambia con los datos nuevos, y es esa versión la que hay que forzar.
  const [aiForcePending, setAiForcePending] = useState(false);
  const aiRun = ai.run;
  useEffect(() => {
    if (!aiForcePending || recalcBusy) return;
    setAiForcePending(false);
    aiRun(true);
  }, [aiForcePending, recalcBusy, aiRun]);

  const recalculate = async () => {
    if (busy) return;
    setRecalcBusy(true);
    try {
      if (onSync) await onSync();
    } finally {
      window.dispatchEvent(new Event('garmin_sync_complete'));
      window.dispatchEvent(new Event(OVERRIDES_EVENT));
      setNowMs(Date.now());
      setRecalcAt(Date.now());
      setAiForcePending(true);
      setRecalcBusy(false);
    }
  };

  const stats = useMemo(() => {
    if (!activities?.length || !pmc?.series || !pmc?.current) return null;
    return computeStats(activities, pmc, { now: nowMs });
  }, [activities, pmc, nowMs]);

  const garminStats = useMemo(() => {
    if (!garmin?.length) return null;
    return computeGarminStats(garmin, { now: nowMs });
  }, [garmin, nowMs]);

  // Carga y forma actuales — sin valores de relleno: si no hay PMC, no hay número.
  const currentCTL = pmc?.current?.ctl != null ? Math.round(pmc.current.ctl) : null;
  const currentATL = pmc?.current?.atl != null ? Math.round(pmc.current.atl) : null;
  const currentTSB = pmc?.current?.tsb != null ? Math.round(pmc.current.tsb) : null;
  const currentACWR = pmc?.current?.acwr != null ? +pmc.current.acwr.toFixed(2) : null;
  const phase = currentTSB != null ? loadPhase(currentTSB) : null;

  const pmcCurrent = pmc?.current ?? null;

  const acwrCls = currentACWR == null ? 'text-slate-400'
    : currentACWR > 1.5 ? 'text-rose-600 dark:text-rose-400'
    : currentACWR > 1.3 ? 'text-amber-600 dark:text-amber-400'
    : currentACWR < 0.8 ? 'text-sky-600 dark:text-sky-400'
    : 'text-emerald-600 dark:text-emerald-400';

  // Rampa semanal de CTL: por encima de ~7 puntos/semana es el ritmo de subida
  // que se asocia a sobrecarga.
  const ctlRamp = pmcCurrent?.ramp ?? 0;
  const rampCls = ctlRamp > 7 ? 'text-amber-600 dark:text-amber-400'
    : ctlRamp >= 0 ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-slate-500';

  // ── 4. Wearables: VFC, FC reposo, Body Battery y sueño (valores reales) ───
  const wearables = useMemo(() => {
    const sorted = garmin?.length ? [...garmin].sort((a, b) => b.date.localeCompare(a.date)) : [];
    const latestHrv = sorted.find(d => d.hrv != null);
    const latestBB = sorted.find(d => d.bbHigh != null);
    const sleepSorted = sleep?.length ? [...sleep].sort((a, b) => b.weekStart.localeCompare(a.weekStart)) : [];
    const lastSleep = sleepSorted.find(w => w.score != null) ?? null;

    return {
      hrv: latestHrv
        ? { latest: latestHrv.hrv, status: latestHrv.hrvStatus ?? null, baseline: latestHrv.baseline ?? null }
        : null,
      rhr: garminStats?.rhr7avg != null && garminStats?.rhr28avg != null
        ? { r7: garminStats.rhr7avg, r28: garminStats.rhr28avg }
        : null,
      bb: latestBB ? { high: latestBB.bbHigh, low: latestBB.bbLow ?? null } : null,
      sleep: lastSleep,
      // Sparklines de datos reales, no curvas decorativas.
      hrvSpark: sparkPath((garminStats?.recSparkData || []).map(d => d.v)),
      sleepSpark: sparkPath(sleepSorted.slice(0, 8).reverse().map(w => w.score ?? null)),
    };
  }, [garmin, sleep, garminStats]);

  // Desviación de la VFC frente a su propia baseline de 60 días.
  const hrvDeltaPct = garminStats?.hrvDeviation ?? null;

  // ── 5. Readiness determinista (0-100) — mismo cálculo que el coach IA ─────
  const readiness = useMemo(
    () => computeReadiness({
      hrv: wearables.hrv,
      rhr: wearables.rhr,
      bb: wearables.bb,
      sleep: wearables.sleep,
      pmc: currentTSB != null ? { tsb: currentTSB } : null,
    }),
    [wearables, currentTSB],
  );

  // ── 6. Zonas de FC efectivas (misma calibración que Zonas y el PMC) ───────
  const bounds = useMemo(
    () => (hrParams?.hrmax && hrParams?.hrrest
      ? karvonenBounds({ hrmax: hrParams.hrmax, hrrest: hrParams.hrrest })
      : null),
    [hrParams?.hrmax, hrParams?.hrrest],
  );

  // ── 7. Reparto por zonas: últimos 28 días y semana en curso ──────────────
  const zoneDistribution = useMemo(() => zoneWindow(runs, bounds, 28, nowMs), [runs, bounds, nowMs]);
  // La semana va del lunes a las 00:00 hasta ahora: ventana fraccionaria en días.
  const zoneWeek = useMemo(() => {
    const now = new Date(nowMs);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return zoneWindow(runs, bounds, (nowMs - monday.getTime()) / 86400000, nowMs);
  }, [runs, bounds, nowMs]);

  // ── 8. Rampa semanal real (dos semanas cerradas) ──────────────────────────
  const weeklyRamp = useMemo(() => {
    const byWeek = {};
    runs.forEach(r => {
      if (!r.start_date) return;
      const wk = weekStartKey(new Date(r.start_date));
      byWeek[wk] = (byWeek[wk] || 0) + (r.distance || 0) / 1000;
    });
    const thisWeek = weekStartKey(new Date(nowMs));
    const closed = Object.entries(byWeek)
      .filter(([wk]) => wk < thisWeek)
      .sort((a, b) => b[0].localeCompare(a[0]));
    if (closed.length < 2) return null;
    const ramp = weeklyVolumeRamp(closed[0][1], closed[1][1]);
    return { ...ramp, lastWeekKm: closed[0][1], prevWeekKm: closed[1][1] };
  }, [runs, nowMs]);

  // ── 9. Zapatilla activa — del histórico real, con su vida útil por tipo ──
  const activeShoe = useMemo(() => {
    const shoeNames = {};
    try {
      const athlete = JSON.parse(cloudStorage.getItem('stravaData') || '{}')?.athlete;
      (athlete?.shoes || []).forEach(s => { shoeNames[s.id] = s.name; });
    } catch { /* caché corrupta: seguimos sin nombres */ }

    const byGear = {};
    runs.forEach(r => {
      if (!r.gear_id) return;
      const g = byGear[r.gear_id] || (byGear[r.gear_id] = { id: r.gear_id, distanceM: 0, lastUsed: 0 });
      g.distanceM += r.distance || 0;
      const ts = new Date(r.start_date).getTime();
      if (ts > g.lastUsed) g.lastUsed = ts;
    });

    const list = Object.values(byGear);
    if (!list.length) return null;
    // "Activa" = la usada más recientemente, que es la que el atleta tiene en pie.
    const current = list.sort((a, b) => b.lastUsed - a.lastUsed)[0];
    const name = shoeNames[current.id] || current.id;
    const km = Math.round(current.distanceM / 1000);
    const { km: lifeKm, source } = shoeLifeKm(name, undefined);
    const remainingPct = Math.max(0, Math.min(100, Math.round(100 - (km / lifeKm) * 100)));
    return { name, km, lifeKm, lifeSource: source, remainingPct };
  }, [runs]);

  // ── 10. Sesión sugerida para hoy ──────────────────────────────────────────
  // La PAUTA (calentar / rodar / soltar) es criterio de entrenamiento; los
  // NÚMEROS salen del atleta: su Z2 calibrada, su ritmo fácil real de las
  // últimas 4 semanas y su distancia habitual de rodaje.
  const todayWorkout = useMemo(() => {
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const day = dayNames[new Date(nowMs).getDay()];

    const z1 = bounds?.[0] ?? null;
    const z2 = bounds?.[1] ?? null;

    // Rodajes fáciles reales: últimas 4 semanas con la FC media dentro de Z1-Z2.
    const cutoff = nowMs - 28 * 86400000;
    const easy = runs.filter(r => {
      const ts = new Date(r.start_date).getTime();
      if (!(ts >= cutoff && ts <= nowMs) || !(r.average_speed > 0)) return false;
      if (!bounds || !r.average_heartrate) return true;   // sin FC: cuenta igual
      return classifyHR(r.average_heartrate, bounds) <= 1;
    });
    const sample = easy.length ? easy : runs.slice(0, 10).filter(r => r.average_speed > 0);

    const median = (arr) => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    const easySecPerKm = median(sample.map(r => 1000 / r.average_speed));
    const easyKm = median(sample.map(r => (r.distance || 0) / 1000));
    const easyCadence = median(sample.map(r => {
      const c = r.average_cadence;
      if (!c) return null;
      return c < 120 ? c * 2 : c;                      // Strava da zancadas/pie
    }).filter(v => v != null));
    const easyHr = median(sample.map(r => r.average_heartrate).filter(Boolean));

    // Día de descarga cuando la readiness o la forma lo piden. La forma, con la
    // escala única de TSB (formZone): "sobrecargado" es lo que pide descargar;
    // antes había aquí un corte propio en −15.
    const recovery = (readiness?.score != null && readiness.score < 50)
      || formZone(currentTSB) === 'overloaded';

    const paceShift = recovery ? 35 : 0;               // +35 s/km en regenerativo
    const kmScale = recovery ? 0.55 : 1;
    const targetSec = easySecPerKm != null ? easySecPerKm + paceShift : null;
    const targetKm = easyKm != null ? easyKm * kmScale : null;

    const paceRange = targetSec != null
      ? `${formatPaceFromSecPerKm(targetSec - 10, DASH)} – ${formatPaceFromSecPerKm(targetSec + 10, DASH)}`
      : DASH;
    const distRange = targetKm != null
      ? `${(targetKm * 0.9).toFixed(0)} – ${(targetKm * 1.1).toFixed(0)} km`
      : DASH;
    const hrRange = recovery
      ? (z1 ? `< ${z1.hi} ppm` : DASH)
      : (z2 ? `${z2.lo} – ${z2.hi} ppm` : DASH);

    // Duración a partir de los propios números, no de un total fijo.
    const mainMin = targetSec != null && targetKm != null ? Math.round((targetSec * targetKm) / 60) : null;
    const warmMin = recovery ? 5 : 10;
    const coolMin = recovery ? 5 : 10;
    const totalMin = mainMin != null ? mainMin + warmMin + coolMin : null;

    const mainParts = [
      mainMin != null ? `${mainMin} MIN` : null,
      targetSec != null ? `${formatPaceFromSecPerKm(targetSec, DASH)}/km` : null,
      easyCadence != null ? `Cadencia ${Math.round(easyCadence)} spm` : null,
      easyHr != null ? `FC ${Math.round(easyHr)} ppm` : null,
    ].filter(Boolean);

    const cadenceHint = easyCadence != null
      ? `Mantén la cadencia en torno a ${Math.round(easyCadence)} spm sin acelerar el pulso.`
      : 'Mantén la cadencia estable sin acelerar el pulso.';
    const hrHint = z2
      ? ` Si el calor o el viento te suben de ${z2.hi} ppm, cede ritmo antes que forzar.`
      : '';

    return {
      day,
      recovery,
      cycleLabel: phase ? `Forma: ${phase.label}` : 'Forma sin determinar',
      zonesLabel: recovery ? 'ZONA 1' : 'ZONAS 1 & 2',
      targetDistance: distRange,
      targetPace: paceRange,
      targetHr: hrRange,
      sampleSize: sample.length,
      structure: {
        warmMin,
        coolMin,
        mainMin,
        totalMin,
        warmup: `${warmMin}'`,
        main: mainParts.length ? mainParts.join(' • ') : DASH,
        cool: `${coolMin}'`,
      },
      tacticalQuote: recovery
        ? `Descarga activa: la readiness${readiness?.score != null ? ` (${readiness.score}/100)` : ''} y el TSB${currentTSB != null ? ` (${currentTSB})` : ''} desaconsejan forzar hoy. Pulso de recuperación estricto.`
        : `${cadenceHint}${hrHint} Hoy se construye base aeróbica, no velocidad.`,
    };
  }, [runs, bounds, readiness, currentTSB, phase, nowMs]);

  // ── 10b. Qué toca hoy de verdad: Garmin > plan del Entrenador IA > automática ──
  const todaySession = useTodaySession({ advisesRest: todayWorkout.recovery, nowMs });

  // ── 10c. Sin plan para hoy: la sesión del Coach IA (próximas 48 h) antes que
  // la propuesta automática.
  const coachSession = useMemo(
    () => coachSessionFrom({ nextWork: ai.nextWork, meta: ai.meta, timestamp: ai.cacheTs }, nowMs),
    [ai.nextWork, ai.meta, ai.cacheTs, nowMs],
  );
  const curBadge = ai.cur ? (CUR_BADGES[deriveStatusKey(ai.cur, ai.meta)] ?? null) : null;
  const trendBadge = ai.trend ? (TREND_BADGES[deriveTrendKey(ai.trend, ai.meta)] ?? null) : null;
  const lastActivity = useMemo(
    () => (activities ?? []).reduce((best, a) => (!best || new Date(a.start_date) > new Date(best.start_date) ? a : best), null),
    [activities],
  );

  // Lo que pinta la tarjeta "Sesión sugerida": mismo formato para las dos fuentes.
  const suggested = useMemo(() => {
    if (coachSession) {
      const c = coachSession;
      const ageH = Math.max(0, Math.round((nowMs - c.generatedAt) / 3600000));
      return {
        source: 'coach',
        note: `Recomendada por el Coach IA (${ageH < 1 ? 'hace menos de 1 h' : `hace ${ageH} h`}).`,
        badge: c.zone ? `${c.type ? `${c.type.toUpperCase()} · ` : ''}Z${c.zone}` : (c.type?.toUpperCase() ?? 'COACH IA'),
        distance: c.distance || DASH,
        pace: c.pace || DASH,
        hr: c.hr ? `${c.hr} ppm` : DASH,
        totalMin: c.totalMin || null,
        segments: c.blocks.map((b) => {
          const reps = Number(b.reps) || 1;
          return {
            label: String(b.phase || '').toUpperCase(),
            detail: [
              reps > 1 ? `${reps} × ${b.duration_min}′` : `${b.duration_min}′`,
              b.pace,
              b.hr ? `${b.hr} ppm` : null,
              reps > 1 && b.recovery ? `rec. ${b.recovery}` : null,
            ].filter(Boolean).join(' • '),
            min: b.totalMin,
            cls: intensityClass(Number(b.intensity) || 0),
          };
        }).filter((sg) => sg.min > 0),
        calibration: 'Prescripción del Coach IA',
        emptyMsg: 'El coach no detalló bloques: mira su plan más abajo',
        quote: c.blocks.map((b) => b.description).filter(Boolean).join(' '),
        conflict: todayWorkout.recovery && c.hard,
      };
    }
    const st = todayWorkout.structure;
    return {
      source: 'auto',
      note: `Sin entreno planificado hoy${todaySession.planExpired ? ' (tu plan del Entrenador IA ya caducó)' : ''}: propuesta automática según tu estado.`,
      badge: todayWorkout.zonesLabel,
      distance: todayWorkout.targetDistance,
      pace: todayWorkout.targetPace,
      hr: todayWorkout.targetHr,
      totalMin: st.totalMin,
      segments: st.totalMin != null ? [
        { label: 'WARMUP', detail: st.warmup, min: st.warmMin, cls: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200' },
        { label: todayWorkout.recovery ? 'TROTE REGENERATIVO' : 'RODAJE BASE CONTROLADO', detail: st.main, min: st.mainMin, cls: 'bg-blue-600 text-white' },
        { label: 'COOL', detail: st.cool, min: st.coolMin, cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
      ] : [],
      calibration: todayWorkout.sampleSize > 0 ? `Calibrado con ${todayWorkout.sampleSize} rodajes` : 'Sin rodajes de referencia',
      emptyMsg: 'Sin rodajes recientes para calibrar la sesión',
      quote: todayWorkout.tacticalQuote,
      conflict: false,
    };
  }, [coachSession, todayWorkout, todaySession.planExpired, nowMs]);

  // ── 11. Últimas sesiones sincronizadas ────────────────────────────────────
  const recentActivities = useMemo(() => {
    return runs.slice(0, 5).map(r => {
      const hr = r.average_heartrate ? Math.round(r.average_heartrate) : null;
      const rawCad = r.average_cadence;
      const cadence = rawCad ? Math.round(rawCad < 120 ? rawCad * 2 : rawCad) : null;
      const zoneIdx = hr != null && bounds ? classifyHR(hr, bounds) : -1;

      // Tipo de sesión a partir de la distancia y la zona REAL, no de umbrales sueltos.
      let typeCode = 'RUN';
      if (r.name && /series|interval|tempo|fartlek/i.test(r.name)) typeCode = 'INT';
      else if (zoneIdx >= 3) typeCode = 'INT';
      else if ((r.distance || 0) > 20000) typeCode = 'LSD';
      else if (zoneIdx === 0 && (r.distance || 0) < 9000) typeCode = 'REC';

      const d = new Date(r.start_date);
      const dateLabel = d.toLocaleDateString(lang, { day: 'numeric', month: 'short' }) + ', ' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

      return {
        id: r.id,
        name: r.name,
        dateLabel,
        distKm: ((r.distance || 0) / 1000).toFixed(2),
        pace: formatPaceFromSpeed(r.average_speed, DASH),
        hr,
        hrZone: zoneIdx >= 0 ? `Z${zoneIdx + 1}` : null,
        zoneIdx,
        cadence,
        tss: r.suffer_score ?? null,
        typeCode,
      };
    });
  }, [runs, bounds, lang]);

  // ── 12. Briefing de hoy: series de 8 semanas y comparativa vs histórico ───
  // Es el contenido que vivía en `StatusHero`, con el lenguaje visual de esta
  // portada. Los cálculos son los MISMOS (`computeStats`), no una copia.
  const briefing = useMemo(() => {
    if (!stats) return null;
    const { sparkData, chartDataFull } = stats;

    const ctlSpark = sparkData.map(d => ({ v: d.ctl }));
    const atlSpark = sparkData.map(d => ({ v: d.atl }));
    const tsbSpark = sparkData.map(d => ({ v: d.tsb }));
    // Km REALES por semana (8 últimas): la serie del PMC trae las actividades
    // de cada día, así que no hace falta el proxy de TSS/1000 que daba ceros.
    const volSpark = Array.from({ length: 8 }, (_, k) => {
      const i = 7 - k;
      const slice = chartDataFull.slice(-(i + 1) * 7, i > 0 ? -i * 7 : undefined);
      const km = slice.reduce(
        (s, d) => s + (d.activities ?? []).filter(isRun).reduce((a, act) => a + (act.distance ?? 0), 0),
        0,
      ) / 1000;
      return { v: Math.round(km) };
    });

    return { ctlSpark, atlSpark, tsbSpark, volSpark };
  }, [stats]);

  const activeAiModel = useMemo(() => cloudStorage.getItem('ai_model') || null, []);

  // ── "Ampliar en el chat" desde cualquier bloque de la portada ─────────────
  // Deja en `runqa_seed` el contexto de la sección y la pregunta ya formulada;
  // RunQA la consume al abrirse y la lanza sola. Mismo contrato que AIInsights.
  const askCoach = onOpenChat ? (focus) => {
    try {
      const ASKS = {
        readiness: 'Amplía el diagnóstico de mi estado actual: explica en detalle qué indican mis métricas (readiness, TSB, ACWR, VFC, FC de reposo, sueño), qué riesgos ves y qué debería vigilar los próximos días. Quiero un análisis largo y razonado, con secciones.',
        workout: 'Amplía la sesión que me recomiendas para hoy: desglosa calentamiento, bloque principal con ritmos y FC objetivo, vuelta a la calma, y explica por qué esta sesión y no otra dado mi estado actual. Quiero el detalle completo de ejecución.',
        zones: 'Amplía el análisis de mi reparto por zonas de los últimos 28 días y de mi carga: ¿estoy cumpliendo la polarización 80/20?, ¿qué me sobra y qué me falta?, y cómo debería corregirlo en las próximas semanas. Quiero un análisis largo apoyado en cifras concretas.',
        briefing: 'Amplía el briefing de mi estado: interpreta mi fitness (CTL), forma (TSB), volumen semanal y mejor ritmo reciente frente a mi propio histórico, y dime en qué punto de la temporada estoy. Quiero un análisis largo y razonado.',
      };
      const zoneLine = zoneDistribution.hasData
        ? `Reparto 28d: ${zoneDistribution.pct.map((p, i) => `Z${i + 1} ${p}%`).join(', ')} (fácil ${Math.round(zoneDistribution.groups.low)}%, gris ${zoneDistribution.groups.mod}%, duro ${zoneDistribution.groups.high}%).`
        : 'Sin reparto por zonas disponible.';
      const seed = {
        ts: Date.now(),
        focus,
        ask: ASKS[focus] ?? ASKS.readiness,
        // `blocks` es lo que RunQA exige para consumir la semilla: aquí van las
        // cifras REALES que está viendo el atleta en pantalla.
        blocks: ai.cur ? { cur: ai.cur, trend: ai.trend, nextWork: ai.nextWork, lastWork: ai.lastWork } : {
          cur: [
            readiness ? `Readiness ${readiness.score}/100 — ${readiness.label}.` : 'Sin readiness calculada.',
            currentTSB != null ? `CTL ${currentCTL}, ATL ${currentATL}, TSB ${currentTSB}, ACWR ${currentACWR ?? DASH}. Fase: ${phase?.label ?? DASH}.` : 'Sin PMC.',
            hrvDeltaPct != null ? `VFC 7d ${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct}% vs baseline 60d.` : null,
            wearables.sleep?.score != null ? `Sueño ${wearables.sleep.score}/100.` : null,
            wearables.bb?.high != null ? `Body Battery ${wearables.bb.high}/100.` : null,
            zoneLine,
          ].filter(Boolean).join('\n'),
          nextWork: `Sesión propuesta: ${todayWorkout.targetDistance} a ${todayWorkout.targetPace} con FC ${todayWorkout.targetHr}. Estructura: ${todayWorkout.structure.warmup} + ${todayWorkout.structure.main} + ${todayWorkout.structure.cool}.`,
          trend: stats
            ? `Volumen última semana ${stats.last7daysKm.toFixed(1)} km (media del año ${stats.avgWeekKmYear.toFixed(1)}, pico ${stats.peakWeekKm.toFixed(1)}). CTL ${fmt1(stats.currentCTL)} sobre un pico histórico de ${fmt1(stats.peakCTL)}.`
            : null,
          lastWork: recentActivities[0]
            ? `Última sesión: «${recentActivities[0].name}», ${recentActivities[0].distKm} km a ${recentActivities[0].pace}/km${recentActivities[0].hr ? `, FC ${recentActivities[0].hr} ppm (${recentActivities[0].hrZone})` : ''}.`
            : null,
        },
        sci: {
          readiness: readiness?.score ?? null,
          readinessLabel: readiness?.label ?? null,
          ctl: currentCTL, atl: currentATL, tsb: currentTSB, acwr: currentACWR,
          fcmax: hrParams?.hrmax ?? null, fcRest: hrParams?.hrrest ?? null, lthr: hrParams?.lthr ?? null,
        },
      };
      cloudStorage.setItem('runqa_seed', JSON.stringify(seed));
    } catch { /* cuota o serialización: el chat se abre igual, sin semilla */ }
    onOpenChat();
  } : null;

  // ── 13. Cuenta atrás de la carrera objetivo ───────────────────────────────
  const raceDays = targetRace?.date ? daysUntil(targetRace.date) : null;
  const raceWeeks = raceDays != null ? Math.max(0, Math.ceil(raceDays / 7)) : null;
  const raceDistanceKm = targetRace?.distance ? DISTANCE_KM[targetRace.distance] ?? null : null;
  const raceGoalPace = targetRace?.goalTimeMin && raceDistanceKm
    ? formatPaceFromSpeed((raceDistanceKm * 1000) / (targetRace.goalTimeMin * 60), DASH)
    : DASH;
  const raceGoalTime = targetRace?.goalTimeMin ? formatMinutes(targetRace.goalTimeMin) : DASH;

  // ── 14. Semana en curso: km por día, de lunes a domingo ───────────────────
  const weekStrip = useMemo(() => {
    const now = new Date(nowMs);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      return { key: i, km: 0, runs: 0, isToday: d.toDateString() === now.toDateString(), future: d > now };
    });
    runs.forEach(r => {
      if (!r.start_date) return;
      const d = new Date(r.start_date);
      // Round, no floor: un cambio de hora deja días de 23 o 25 h.
      const idx = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - monday) / 86400000);
      if (idx < 0 || idx > 6) return;
      days[idx].km += (r.distance || 0) / 1000;
      days[idx].runs += 1;
    });
    const totalKm = days.reduce((s, d) => s + d.km, 0);
    return {
      days,
      totalKm,
      maxKm: Math.max(...days.map(d => d.km), 1),
      activeDays: days.filter(d => d.runs > 0).length,
    };
  }, [runs, nowMs]);

  const readinessTone = readiness == null ? 'slate'
    : readiness.score >= 80 ? 'emerald'
    : readiness.score >= 62 ? 'blue'
    : 'amber';

  return (
    <div className="fade-in space-y-8 max-w-[1520px] mx-auto">

      {/* ── CABECERA: la fecha, de dónde salen los datos y las acciones ──────── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
            {new Date(nowMs).toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-slate-50">Hoy</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {/* Qué fuentes hay REALMENTE detrás de la portada, no una frase fija. */}
            {[
              wearables.hrv ? 'VFC' : null,
              wearables.rhr ? 'FC reposo' : null,
              wearables.bb ? 'Body Battery' : null,
              wearables.sleep ? 'sueño' : null,
              currentTSB != null ? 'PMC' : null,
            ].filter(Boolean).join(' · ') || 'Sin telemetría sincronizada'}
            {garminStats?.lastDate ? ` · último dato Garmin ${garminStats.lastDate}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(ai.usedProvider || activeAiModel) && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${ai.loading ? 'animate-pulse' : ''}`} />
              Coach IA • {ai.usedProvider || activeAiModel}
              {ai.cacheTs && !ai.loading ? ` • ${formatTs(ai.cacheTs)}` : ''}
            </span>
          )}
          {recalcAt && !busy && (
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              Actualizado {new Date(recalcAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <CoachSettings ai={ai} />
          {onOpenChat && (
            <button
              type="button"
              onClick={onOpenChat}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 transition-colors cursor-pointer"
            >
              <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
              <span>Preguntar al coach</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('calibration')}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 transition-colors cursor-pointer"
          >
            Calibrar
          </button>
          <button
            type="button"
            onClick={recalculate}
            disabled={busy || ai.loading}
            title="Sincronizar Strava y Garmin, recalcular las métricas y pedir un análisis nuevo al coach"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-white shadow-sm transition-colors cursor-pointer"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${busy || ai.loading ? 'animate-spin' : ''}`} />
            <span>{busy ? 'Recalculando…' : ai.loading ? 'Analizando…' : 'Recalcular'}</span>
          </button>
        </div>
      </div>

      {/* ── CARRERA OBJETIVO: una franja, no un cartel ──────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-indigo-600 to-indigo-800 text-white shadow-lg shadow-indigo-900/10 px-5 py-4 sm:px-6">
        <div className="absolute -right-16 -top-24 w-80 h-80 rounded-full bg-cyan-400/20 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="flex flex-col items-center justify-center w-16 h-16 rounded-2xl bg-white/15 backdrop-blur shrink-0">
              <span className="text-2xl font-black leading-none tabular-nums">
                {raceDays === 0 ? '¡Hoy!' : raceDays ?? DASH}
              </span>
              {raceDays !== 0 && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-blue-200 mt-0.5">{t('targets.days_unit')}</span>
              )}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                {targetRace ? t('targets.next_race') : t('targets.no_target', 'Sin objetivo fijado')}
                {raceWeeks != null && raceDays > 0 ? ` · ${raceWeeks} semanas` : ''}
              </span>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight leading-tight truncate">
                {targetRace ? targetRace.name : 'Fija tu carrera objetivo'}
              </h2>
              <p className="text-xs text-blue-100/90 font-medium truncate">
                {targetRace
                  ? [
                      targetRace.date ? new Date(targetRace.date + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }) : null,
                      targetRace.location,
                      raceDistanceKm != null ? `${raceDistanceKm} km` : null,
                    ].filter(Boolean).join(' • ')
                  : 'Sin carrera objetivo no hay cuenta atrás, ni ritmo meta, ni plan al que apuntar.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {targetRace && (
              <>
                <div className="px-3 py-1.5 rounded-xl bg-white/10">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-blue-200">Ritmo meta</span>
                  <span className="text-sm font-black text-cyan-300 tabular-nums">{raceGoalPace}<span className="text-[10px] font-normal text-blue-100"> /km</span></span>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-white/10">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-blue-200">{t('targets.goal_time')}</span>
                  <span className="text-sm font-black text-emerald-300 tabular-nums">{raceGoalTime}</span>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => targetRace ? onNavigate(`targets/${targetRace.id}`) : onNavigate('targets')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-slate-900 text-xs font-bold shadow-md hover:bg-blue-50 transition-all cursor-pointer"
            >
              <span>{targetRace ? t('targets.open_plan') : t('targets.manage', 'Fijar objetivo')}</span>
              <ArrowRightIcon className="w-3.5 h-3.5 text-indigo-600" />
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════ 01 · HOY: CÓMO ESTÁS Y QUÉ TOCA ═══════════ */}
      <section className="space-y-3">
        <SectionTitle n="01" title="Hoy" sub="cómo llegas y qué toca" />
        <div className="flex flex-col gap-4">

          {/* Readiness: el número, las cuatro señales que lo forman y el diagnóstico */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 p-5 sm:p-6 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="lg:col-span-3 flex lg:flex-col lg:items-start items-center gap-5 lg:gap-3">
              <div className="relative w-28 h-28 shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" fill="transparent" r="50" stroke="rgba(148, 163, 184, 0.18)" strokeWidth="11" />
                  <circle
                    className="transition-all duration-1000"
                    cx="60" cy="60" fill="transparent" r="50"
                    stroke={TONE[readinessTone].stroke}
                    strokeDasharray={ARC_LEN_READY}
                    strokeDashoffset={ARC_LEN_READY * (1 - (readiness?.score ?? 0) / 100)}
                    strokeLinecap="round" strokeWidth="11"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-black text-slate-900 dark:text-slate-50 leading-none tabular-nums">{readiness?.score ?? DASH}</span>
                  <span className="text-[9px] font-bold text-slate-400 tracking-widest uppercase mt-1">ready</span>
                </div>
              </div>
              <div className="min-w-0 flex flex-col gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Readiness</span>
                <span className={`self-start px-2.5 py-0.5 rounded-full text-xs font-bold ${TONE[readinessTone].pill}`}>
                  {readiness?.label ?? 'Sin datos suficientes'}
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  {readiness == null
                    ? 'Sincroniza Garmin o acumula historial para obtener un score.'
                    : phase ? `Forma: ${phase.label}. ${phase.description}` : 'Sin PMC todavía.'}
                </p>
              </div>
            </div>

            {/* Las señales que alimentan el score, cada una contra su propia referencia */}
            <div className="lg:col-span-4 grid grid-cols-2 gap-2.5 content-start">
              <Signal
                label="VFC"
                value={wearables.hrv?.latest != null ? Math.round(wearables.hrv.latest) : DASH}
                unit="ms"
                note={hrvDeltaPct != null ? `${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct}% vs 60 d` : (wearables.hrv?.status ?? 'Sin baseline')}
                tone={hrvDeltaPct == null ? 'slate' : hrvDeltaPct >= -5 ? 'emerald' : hrvDeltaPct >= -12 ? 'amber' : 'rose'}
                spark={wearables.hrvSpark}
              />
              <Signal
                label="FC reposo"
                value={wearables.rhr ? Math.round(wearables.rhr.r7) : DASH}
                unit="ppm"
                note={wearables.rhr ? `${wearables.rhr.r7 - wearables.rhr.r28 >= 0 ? '+' : ''}${fmt1(wearables.rhr.r7 - wearables.rhr.r28)} vs 28 d` : 'Sin datos'}
                // Subir la FC de reposo es la mala noticia: el color va al revés que la VFC.
                tone={!wearables.rhr ? 'slate' : wearables.rhr.r7 - wearables.rhr.r28 <= 1 ? 'emerald' : wearables.rhr.r7 - wearables.rhr.r28 <= 3 ? 'amber' : 'rose'}
              />
              <Signal
                label="Sueño"
                value={wearables.sleep?.score ?? DASH}
                unit="/100"
                note={wearables.sleep?.durationMin
                  ? `${formatMinutesHm(wearables.sleep.durationMin, DASH)}${wearables.sleep.deepMin ? ` · prof. ${formatMinutesHm(wearables.sleep.deepMin, DASH)}` : ''}`
                  : 'Sin registro'}
                tone={wearables.sleep?.score == null ? 'slate' : wearables.sleep.score >= 75 ? 'emerald' : wearables.sleep.score >= 60 ? 'amber' : 'rose'}
                spark={wearables.sleepSpark}
              />
              <Signal
                label="Body Battery"
                value={wearables.bb?.high ?? DASH}
                unit="/100"
                note={wearables.bb?.high != null && wearables.bb?.low != null ? `+${wearables.bb.high - wearables.bb.low} recargado` : 'Sin recarga'}
                tone={wearables.bb?.high == null ? 'slate' : wearables.bb.high >= 70 ? 'emerald' : wearables.bb.high >= 45 ? 'amber' : 'rose'}
                bar={wearables.bb?.high}
              />
            </div>

            <div className="lg:col-span-5 flex flex-col gap-3 pt-3 lg:pt-0 lg:pl-5 border-t lg:border-t-0 lg:border-l border-slate-100 dark:border-slate-800">
              <CoachBanners ai={ai} />
              <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px]">psychology</span>
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  {ai.cur ? 'Diagnóstico del coach' : 'Diagnóstico'}
                </h3>
                {curBadge && <CoachBadge badge={curBadge} />}
                <span className="ml-auto"><AskChatBtn onAsk={askCoach} focus="readiness" /></span>
              </div>
              <CoachText
                ai={ai}
                text={ai.cur}
                accent="text-blue-500"
                fallback={(
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {readiness == null
                      ? 'Sin telemetría de wearable no se puede leer el estado autonómico. Sincroniza Garmin para activar este diagnóstico.'
                      : `${readiness.label}. ${
                          hrvDeltaPct != null
                            ? `La VFC de los últimos 7 días está un ${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct}% respecto a tu baseline de 60 días.`
                            : 'Sin baseline de VFC suficiente para medir desviación.'
                        }${currentTSB != null ? ` El TSB de ${currentTSB} sitúa la forma en fase "${phase?.label ?? DASH}".` : ''}`}
                  </p>
                )}
              />
              </div>
            </div>
          </div>

          {/* Sesión de hoy. Con plan (Garmin o Entrenador IA) manda el plan; sin
              él, la propuesta del coach o la automática, dicha como tal. */}
          {todaySession.source === 'auto' ? (
            <div className="flex flex-col gap-2 px-4 sm:px-5 py-3.5 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap lg:flex-nowrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-2.5 min-w-0 lg:w-72 shrink-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px]">{todayWorkout.recovery ? 'self_improvement' : 'directions_run'}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 shrink-0">Sesión sugerida</h3>
                      <span className="px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300 text-[9px] font-bold truncate">
                        {suggested.badge}
                      </span>
                    </div>
                    <span className="block text-[11px] text-slate-400 truncate" title={suggested.note}>{todayWorkout.day} · {suggested.note}</span>
                  </div>
                </div>

                <div className="flex items-center gap-5 shrink-0">
                  <Metric label="Distancia" value={suggested.distance} />
                  <Metric label="Ritmo" value={suggested.pace} cls="text-blue-600 dark:text-blue-400" />
                  <Metric label="FC" value={suggested.hr} cls="text-rose-600 dark:text-rose-400" />
                </div>

                {/* Barra segmentada: los anchos son la proporción REAL de cada bloque */}
                <div className="flex-1 min-w-[220px] flex items-center gap-2">
                  {suggested.segments.length > 0 ? (() => {
                    const total = suggested.segments.reduce((acc, sg) => acc + sg.min, 0);
                    return (
                      <div className="flex-1 h-8 rounded-lg overflow-hidden flex gap-0.5">
                        {suggested.segments.map((sg, i) => (
                          <div
                            key={i}
                            title={`${sg.label} · ${sg.detail}`}
                            className={`h-full min-w-0 flex items-center justify-center px-1.5 ${sg.cls}`}
                            style={{ width: `${(sg.min / total) * 100}%` }}
                          >
                            <span className="text-[9px] font-bold uppercase tracking-wider truncate">{sg.label}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })() : (
                    <div className="flex-1 h-8 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-[11px] text-slate-400 truncate px-2">
                      {suggested.emptyMsg}
                    </div>
                  )}
                  {suggested.totalMin != null && (
                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 tabular-nums shrink-0">{suggested.totalMin}′</span>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <AskChatBtn onAsk={askCoach} focus="workout" />
                  <button
                    type="button"
                    onClick={() => onNavigate('planner')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                  >
                    Planificador <ArrowRightIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {suggested.conflict && (
                <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  El coach propone calidad, pero tu readiness o tu forma piden descargar hoy: valora cambiarla por un rodaje suave.
                </p>
              )}

              {/* El detalle (bloques, pauta y notas del coach), plegado */}
              {(suggested.quote || suggested.segments.length > 0 || (suggested.source === 'coach' && ai.nextWork)) && (
                <CoachDisclosure label={`Detalle de la sesión · ${suggested.calibration}`}>
                  <div className="flex flex-col gap-2">
                    {suggested.segments.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {suggested.segments.map((sg, i) => (
                          <li key={i} className="text-xs text-slate-600 dark:text-slate-300">
                            <span className="font-bold">{sg.label}</span> · {sg.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                    {suggested.quote && <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{suggested.quote}</p>}
                    {suggested.source === 'coach' && ai.nextWork && <CoachMD text={ai.nextWork} accent="text-blue-500" />}
                  </div>
                </CoachDisclosure>
              )}
            </div>
          ) : (
            <TodayPlannedSession
              session={todaySession}
              day={todayWorkout.day}
              action={<AskChatBtn onAsk={askCoach} focus="workout" />}
            />
          )}
        </div>
      </section>

      {/* ═══════════ 02 · CARGA: DE DÓNDE VIENES ═══════════ */}
      {stats && briefing && (
        <section className="space-y-3">
          <SectionTitle n="02" title="Carga y volumen" sub="PMC Banister · TRIMP por reserva de FC" action={<AskChatBtn onAsk={askCoach} focus="briefing" />} onMore={() => onNavigate('pmc')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

            {/* Fitness: el número, su curva y cuánto queda para el propio techo */}
            <Tile label="Fitness (CTL)" icon={ArrowTrendingUpIcon} tone="blue">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 dark:text-slate-50 tabular-nums">{fmt1(stats.currentCTL)}</span>
                <Delta v={stats.currentCTL - stats.ctl7ago} suffix=" 7d" />
              </div>
              <Spark data={briefing.ctlSpark} stroke={TONE.blue.stroke} />
              <div className="mt-1">
                <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                  <span>{stats.peakCTL > 0 ? Math.round((stats.currentCTL / stats.peakCTL) * 100) : 0}% de tu pico</span>
                  <span className="tabular-nums">{fmt1(stats.peakCTL)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${stats.peakCTL > 0 ? Math.min(100, (stats.currentCTL / stats.peakCTL) * 100) : 0}%` }} />
                </div>
              </div>
              <Rows rows={[
                { label: 'Pico este año', value: fmt1(stats.peakCTLYear) },
                { label: 'Tendencia 28 d', value: `${stats.currentCTL - stats.ctl28ago >= 0 ? '+' : ''}${fmt1(stats.currentCTL - stats.ctl28ago)}` },
              ]} />
            </Tile>

            {/* Forma: el signo del TSB en escala divergente, con fatiga y riesgo debajo */}
            <Tile label="Forma (TSB)" icon={BoltIcon} tone={stats.currentTSB > 5 ? 'emerald' : stats.currentTSB > -10 ? 'amber' : 'rose'}>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 dark:text-slate-50 tabular-nums">
                  {stats.currentTSB >= 0 ? '+' : ''}{fmt1(stats.currentTSB)}
                </span>
                {phase && <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate">{phase.label}</span>}
              </div>
              <TsbGauge tsb={stats.currentTSB} />
              <Rows rows={[
                { label: 'Fatiga (ATL)', value: fmt1(stats.currentATL) },
                { label: 'ACWR', value: currentACWR == null ? DASH : currentACWR.toFixed(2), cls: acwrCls },
                { label: 'Rampa CTL', value: `${ctlRamp >= 0 ? '+' : ''}${fmt1(ctlRamp)} /sem`, cls: rampCls },
              ]} />
            </Tile>

            {/* Semana en curso, día a día: lo que llevas y lo que te queda */}
            <Tile label="Esta semana" icon={CalendarDaysIcon} tone="emerald">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 dark:text-slate-50 tabular-nums">{weekStrip.totalKm.toFixed(1)}</span>
                <span className="text-xs text-slate-400 font-semibold">km</span>
                {stats.avgWeekKmYear > 0 && (
                  <span className="ml-auto text-[10px] font-bold text-slate-400 tabular-nums">
                    {Math.round((weekStrip.totalKm / stats.avgWeekKmYear) * 100)}% de tu media
                  </span>
                )}
              </div>
              <div className="flex items-end gap-1.5 h-16 mt-1">
                {weekStrip.days.map((d, i) => (
                  <div key={d.key} className="flex-1 flex flex-col items-center gap-1 h-full">
                    <div className="flex-1 w-full flex items-end">
                      <div
                        className={`w-full rounded-md ${d.km > 0 ? (d.isToday ? 'bg-emerald-500' : 'bg-emerald-400/80') : d.future ? 'bg-slate-100 dark:bg-slate-800' : 'bg-slate-200 dark:bg-slate-700'}`}
                        style={{ height: d.km > 0 ? `${Math.max(12, (d.km / weekStrip.maxKm) * 100)}%` : '6px' }}
                        title={d.km > 0 ? `${d.km.toFixed(1)} km` : 'Sin carrera'}
                      />
                    </div>
                    <span className={`text-[9px] font-bold ${d.isToday ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>{WEEKDAYS[i]}</span>
                  </div>
                ))}
              </div>
              <Rows rows={[
                { label: 'Días con carrera', value: `${weekStrip.activeDays}` },
                { label: 'Media semanal del año', value: `${stats.avgWeekKmYear.toFixed(1)} km` },
              ]} />
            </Tile>

            {/* Volumen de las 8 últimas semanas: barras, que se comparan mejor que una línea */}
            <Tile label="Volumen · 8 semanas" icon={ChartBarIcon} tone="blue">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-slate-900 dark:text-slate-50 tabular-nums">{stats.last7daysKm.toFixed(1)}</span>
                <span className="text-xs text-slate-400 font-semibold">km · 7 d</span>
                {weeklyRamp && (
                  <span className={`ml-auto text-[10px] font-bold tabular-nums ${weeklyRamp.absDeltaKm >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {weeklyRamp.absDeltaKm >= 0 ? '+' : ''}{weeklyRamp.absDeltaKm.toFixed(1)} km/sem
                  </span>
                )}
              </div>
              {(() => {
                const max = Math.max(...briefing.volSpark.map(w => w.v), 1);
                return (
                  <div className="flex items-end gap-1 h-16 mt-1">
                    {briefing.volSpark.map((w, i) => (
                      <div key={i} className="flex-1 h-full flex items-end" title={`${w.v} km`}>
                        <div
                          className={`w-full rounded-sm ${i === briefing.volSpark.length - 1 ? 'bg-blue-600' : 'bg-blue-300 dark:bg-blue-800'}`}
                          style={{ height: `${Math.max(4, (w.v / max) * 100)}%` }}
                        />
                      </div>
                    ))}
                  </div>
                );
              })()}
              <Rows rows={[
                { label: 'Semana pico del año', value: `${stats.peakWeekKmYear.toFixed(1)} km` },
                { label: 'Semana pico total', value: `${stats.peakWeekKm.toFixed(1)} km` },
              ]} />
            </Tile>
          </div>
        </section>
      )}

      {/* ═══════════ 03 · INTENSIDAD Y TENDENCIA ═══════════ */}
      <section className="space-y-3">
        <SectionTitle
          n="03"
          title="Intensidad"
          sub={`Karvonen${hrParams?.hrmax && hrParams?.hrrest ? ` · ${hrParams.hrrest}–${hrParams.hrmax} ppm` : ''}`}
          action={<AskChatBtn onAsk={askCoach} focus="zones" />}
        />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Resumen: dos barras (semana y mes). El detalle por zona, las horas y
              los cortes de FC viven en la vista de Zonas. */}
          <div className="lg:col-span-7 flex flex-col gap-4 p-5 sm:p-6 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {bounds ? (
              <>
                <ZoneBar label="Esta semana" mix={zoneWeek} />
                <ZoneBar label="Últimos 28 días" mix={zoneDistribution} />
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap pt-3 border-t border-slate-100 dark:border-slate-800">
                  {ZONES.map(z => (
                    <span key={z.name} className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                      <span className="w-2 h-2 rounded-full" style={{ background: z.color }} />{z.name}
                    </span>
                  ))}
                  <span className="text-[10px] text-slate-400">· marca = objetivo {POLARIZED_TARGETS.low}% fácil</span>
                  <button
                    type="button"
                    onClick={() => onNavigate('zones')}
                    className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                  >
                    Detalle por zonas <ChevronRightIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400 py-8 text-center">Calibra FCmax y FC de reposo para ver el reparto por zonas.</p>
            )}
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Tendencia de los últimos 2 meses según el coach */}
            {(ai.trend || ai.loading) && (
              <div className="flex-1 p-5 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-indigo-500 text-[18px]">trending_up</span>
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Tendencia · 2 meses</span>
                  {trendBadge && <CoachBadge badge={trendBadge} className="ml-auto" />}
                </div>
                <CoachText ai={ai} text={ai.trend} accent="text-indigo-500" />
              </div>
            )}

            {/* Zapatilla activa, con su desgaste como barra */}
            <button
              type="button"
              onClick={() => onNavigate('gear')}
              className="text-left p-4 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 hover:border-indigo-300 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[20px]">steps</span>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                    {activeShoe ? activeShoe.name : 'Sin zapatilla asignada'}
                  </span>
                </div>
                {activeShoe && (
                  <span className={`text-[10px] font-bold shrink-0 ${activeShoe.remainingPct >= 40 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {activeShoe.remainingPct >= 40 ? 'En buen estado' : 'Revisar desgaste'}
                  </span>
                )}
              </div>
              {activeShoe ? (
                <>
                  <div className="h-2 mt-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${activeShoe.remainingPct >= 40 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${100 - activeShoe.remainingPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1 tabular-nums">
                    <span>{activeShoe.km.toLocaleString(lang)} km usados</span>
                    <span>vida {activeShoe.lifeKm.toLocaleString(lang)} km · quedan {activeShoe.remainingPct}%</span>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-slate-400 mt-1">Asigna material a tus actividades de Strava para seguir su desgaste.</p>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* ═══════════ 04 · ÚLTIMAS SESIONES ═══════════ */}
      <section className="space-y-3">
        <SectionTitle n="04" title="Últimas sesiones" sub={`${runs.length} carreras en el historial`} onMore={() => onNavigate('log')} />
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {recentActivities.map(a => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(`activity/${a.id}`)}
                  className="w-full text-left flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-[10px] shrink-0 ${TYPE_CLS[a.typeCode]}`}>
                    {a.typeCode}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{a.name}</span>
                    <span className="block text-[11px] text-slate-400">{a.dateLabel}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-0.5 text-right shrink-0">
                    <Metric label="Distancia" value={`${a.distKm} km`} />
                    <Metric label="Ritmo" value={`${a.pace} /km`} cls="text-blue-600 dark:text-blue-400" />
                    <Metric
                      label="FC media"
                      className="hidden sm:block"
                      value={a.hr != null ? (
                        <span className="inline-flex items-center gap-1">
                          {a.zoneIdx >= 0 && <span className="w-2 h-2 rounded-full" style={{ background: ZONES[a.zoneIdx].color }} />}
                          {a.hr}{a.hrZone && <span className="text-[10px] text-slate-400">{a.hrZone}</span>}
                        </span>
                      ) : DASH}
                    />
                    <Metric label="Esfuerzo" className="hidden sm:block" value={a.tss ?? DASH} />
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-slate-300 shrink-0" />
                </button>
              </li>
            ))}
          </ul>

          {(ai.lastWork || ai.loading) && (
            <div className="m-4 sm:m-5 p-3.5 rounded-xl bg-amber-50/40 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/40">
              <div className="flex items-center gap-2 mb-2 min-w-0">
                <span className="material-symbols-outlined text-amber-500 text-[18px] shrink-0">local_fire_department</span>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 shrink-0">Ejecución · Coach IA</span>
                {lastActivity?.name && <span className="text-[11px] text-slate-400 truncate">{lastActivity.name}</span>}
              </div>
              <CoachText ai={ai} text={ai.lastWork} accent="text-amber-500" />
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
