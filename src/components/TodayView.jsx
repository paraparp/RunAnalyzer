import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import cloudStorage from '../lib/cloudStorage';
import {
  ArrowRightIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { OVERRIDES_EVENT } from '../lib/hrOverrides';
import useCalibratedPMC from '../hooks/useCalibratedPMC';
import useGarminWearableData from '../hooks/useGarminWearableData';
import { computeStats, computeGarminStats, loadPhase, formZone, acwrZone, isRun, fmt1 } from '../lib/statusStats';
import useTodaySession from '../hooks/useTodaySession';
import { coachSessionFrom } from '../lib/todaySession';
import { recoveryVersion, readChoice, writeChoice } from '../lib/adaptivePlan';
import { toISODate } from '../lib/planSchedule';
import { pushPlanDays } from '../services/garminWorkouts';
import useAIInsights from '../hooks/useAIInsights';
import { CoachBadge, CoachBanners, CoachDisclosure, CoachMD, CoachSettings, CoachText } from './CoachAI';
import { CUR_BADGES, TREND_BADGES, deriveStatusKey, deriveTrendKey, formatTs } from '../lib/aiInsights';
import TodayPlannedSession from './TodayPlannedSession';
import { computeReadiness } from '../lib/athleteContext';
import { getPrimaryTargetRace, getTargetRaces, daysUntil, formatMinutes, TARGET_RACES_EVENT } from '../lib/targetRaces';
import { DISTANCE_KM } from '../lib/raceDistances';
import { karvonenBounds, classifyHR, POLARIZED_TARGETS } from '../lib/hrZones';
import { zoneMix, polarizedGroups, polarizationStatus } from '../lib/zoneMix';
import { formatPaceFromSpeed, formatPaceFromSecPerKm, formatMinutesHm, formatDuration } from '../lib/timeFormat';
import { efficiencyMPerBeat } from '../lib/efficiencyFactor';
import { Ring, Scale, WorkoutProfile, RouteShape, DetailLink, Panel, TrendChart } from './TodayVisuals';
import RouteMap from './RouteMap';
import { COLORS } from '../lib/palette';
import { weekStartKey } from '../lib/isoWeek';

// ─────────────────────────────────────────────────────────────────────────────
// Hoy. La portada contesta "¿cómo voy y qué hago?" de un vistazo, de lo
// inmediato a lo acumulado: estado ahora (readiness, señales y objetivo), carga
// (forma, fitness y riesgo en medidores), la sesión de hoy, volumen e
// intensidad, la lectura del coach y las últimas sesiones. Cada bloque resume y
// lleva con un botón a la vista donde vive su detalle (PMC, Salud, Zonas…).
//
// TODO lo que se pinta aquí sale de los mismos módulos de cálculo que usan el
// resto de vistas y el coach IA (`statusStats`, `athleteContext`, `zoneMix`,
// `gap`). Cuando un dato no está, se pinta `—`: un
// número de relleno en la portada es peor que un hueco, porque el atleta no
// puede distinguirlo de una medida real.
// ─────────────────────────────────────────────────────────────────────────────

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const DASH = '—';

// Zonas de Karvonen con los colores de la vista de Zonas: el mismo reparto no
// puede cambiar de pinta según dónde se mire.
const ZONES = [
  { name: 'Z1', role: 'Recuperación', color: COLORS.inkFaint },
  { name: 'Z2', role: 'Base',         color: '#38bdf8' },
  { name: 'Z3', role: 'Aeróbico',     color: '#4ade80' },
  { name: 'Z4', role: 'Umbral',       color: '#fb923c' },
  { name: 'Z5', role: 'VO2max',       color: COLORS.riskLight },
];

const VERDICT = {
  ok:   { label: 'Cumples el 80/20.', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  gray: { label: 'Demasiado tiempo en zona gris.', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'         },
  low:  { label: 'Falta trabajo de calidad.', cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'                 },
  mod:  { label: 'Reparto mixto.', cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'     },
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

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DISPLAY = "font-['Plus_Jakarta_Sans',Inter,sans-serif]";
// Respuesta física de los botones: transición, hundirse al pulsar y foco visible.
const PRESS = 'transition-all duration-200 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

const TONE = {
  emerald: { icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400', stroke: COLORS.good, text: 'text-emerald-600 dark:text-emerald-400', pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  blue:    { icon: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',             stroke: COLORS.signal, text: 'text-blue-600 dark:text-blue-400',       pill: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' },
  amber:   { icon: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',         stroke: COLORS.caution, text: 'text-amber-600 dark:text-amber-400',     pill: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  rose:    { icon: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',             stroke: COLORS.risk, text: 'text-rose-600 dark:text-rose-400',       pill: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' },
  slate:   { icon: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',           stroke: COLORS.inkFaint, text: 'text-slate-500',                         pill: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};


// Tonos de las señales sobre el fondo oscuro de la cabecera.
const HERO_TEXT = {
  emerald: 'text-emerald-300',
  blue:    'text-sky-300',
  amber:   'text-amber-300',
  rose:    'text-rose-300',
  slate:   'text-slate-500',
};

// Una señal del readiness en la cabecera: valor, lectura contra su referencia
// y su tendencia (sparkline real) o su nivel (barra).
// Con `onClick` la tarjeta es un botón que lleva al gráfico de esa señal.
function HeroSignal({ icon, label, value, unit, note, tone = 'slate', spark, bar, onClick }) {
  const stroke = (TONE[tone] ?? TONE.slate).stroke;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick, title: `Ver el gráfico de ${label}` } : {})}
      className={`px-3 py-2 rounded bg-white/[0.06] border border-white/10 flex flex-col gap-0.5 min-w-0 text-left transition-colors duration-200 hover:bg-white/[0.09] hover:border-white/20${onClick ? ' cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[16px] text-white/50">{icon}</span>
        <span className="text-label font-bold uppercase text-white/50 truncate">{label}</span>
        <span className="ml-auto w-2 h-2 rounded-full shrink-0" style={{ background: stroke, boxShadow: `0 0 8px ${stroke}` }} />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-black text-white tabular-nums leading-none">{value}</span>
        <span className="text-xs text-white/40 font-semibold">{unit}</span>
      </div>
      <span className={`text-xs font-bold truncate ${HERO_TEXT[tone] ?? HERO_TEXT.slate}`}>{note}</span>
      {spark ? (
        <svg className="w-full h-3.5 mt-0.5" preserveAspectRatio="none" viewBox="0 0 100 24">
          <path d={spark} fill="none" stroke={stroke} strokeLinecap="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : bar != null ? (
        <div className="h-1.5 my-[4px] rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${bar}%`, background: stroke }} />
        </div>
      ) : <div className="h-3.5 mt-0.5" />}
    </Tag>
  );
}

// ── Escalas de estado ────────────────────────────────────────────────────────
// Cada cifra de estado se pinta sobre SU escala, con los cortes que ya usa la
// app: readiness (athleteContext), TSB (formZone), ACWR (acwrZone) y los de las
// señales del wearable que la portada llevaba en sus tonos.
const C_GOOD = COLORS.good, C_WARN = COLORS.caution, C_BAD = COLORS.risk, C_FRESH = '#38bdf8', C_TRANS = '#a78bfa';

const TSB_BANDS = [
  { key: 'overloaded', to: -20,      color: C_BAD },
  { key: 'loaded',     to: -10,      color: C_WARN },
  { key: 'optimal',    to: 5,        color: C_GOOD },
  { key: 'fresh',      to: 15,       color: C_FRESH },
  { key: 'transition', to: Infinity, color: C_TRANS },
];
const ACWR_BANDS = [
  { key: 'underload', to: 0.8,      color: C_FRESH },
  { key: 'optimal',   to: 1.3,      color: C_GOOD },
  { key: 'caution',   to: 1.5,      color: C_WARN },
  { key: 'danger',    to: Infinity, color: C_BAD },
];
const ACWR_INFO = {
  underload: 'Semana por debajo de tu carga habitual.',
  optimal:   'La carga aguda acompaña a la crónica: progresión sana.',
  caution:   'Estás cargando más rápido de lo habitual.',
  danger:    'Subida brusca frente a tu base: riesgo de lesión.',
};
const bandColor = (bands, v) => (v == null || !Number.isFinite(v) ? COLORS.inkFaint : (bands.find(b => v <= b.to) ?? bands[bands.length - 1]).color);

const fmtSigned = (v, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits).replace('.', ',')}`;
const fmtDec = (v, digits = 1) => (v == null || !Number.isFinite(v) ? DASH : v.toFixed(digits).replace('.', ','));

// Una cifra de carga como tarjeta, con la anatomía de las señales del readiness:
// icono y etiqueta, punto de estado, valor, lectura en color y su gráfico.
// La tarjeta entera lleva al detalle; la explicación va en el title.
function LoadTile({ icon, label, value, unit, note, color, tip, onClick, className = "", children }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      title={tip}
      className={`${className} group px-4 py-3.5 rounded border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-1.5 min-w-0 text-left ${onClick ? 'cursor-pointer' : ''} transition-colors duration-200 hover:border-slate-300 hover:shadow-[0_4px_14px_-6px_rgba(15,23,42,0.18)] dark:border-slate-800 dark:from-slate-800/60 dark:to-slate-900 dark:hover:bg-slate-800/70 dark:hover:border-slate-700 ${PRESS}`}
    >
      <div className="flex items-center gap-1.5 w-full">
        <span className="material-symbols-outlined text-[16px] text-slate-400">{icon}</span>
        <span className="text-label font-bold uppercase text-slate-500 truncate">{label}</span>
        <span className="ml-auto w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>
      {value !== undefined && <TileFigure value={value} unit={unit} note={note} color={color} />}
      <div className={`${value !== undefined ? 'mt-auto pt-3' : 'flex-1'} w-full flex flex-col gap-1.5`}>{children}</div>
    </Tag>
  );
}

// La cifra de una tarjeta: valor con unidad y su lectura en color.
function TileFigure({ value, unit, note, color }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex items-baseline gap-1">
        <span className="text-[26px] font-black text-slate-900 dark:text-white tabular-nums leading-none tracking-tight">{value}</span>
        {unit && <span className="text-xs text-slate-400 font-semibold">{unit}</span>}
      </div>
      <span className="text-xs font-bold truncate w-full" style={{ color }}>{note}</span>
    </div>
  );
}

// Una línea clicable de una tarjeta: la cifra (etiqueta, valor y lectura) al
// inicio y su escala a continuación, alineada con las de las otras líneas.
function TileRow({ label, value, note, color, tip, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tip}
      className="grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-3 w-full [&:not(:first-child)]:pt-2.5 min-w-0 text-left rounded cursor-pointer -mx-1.5 px-1.5 py-1.5 transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[11px] font-semibold text-slate-400 truncate">{label}</span>
        <span className="text-[22px] font-black text-slate-900 dark:text-white tabular-nums leading-none tracking-tight">{value}</span>
        <span className="text-xs font-bold truncate" style={{ color }}>{note}</span>
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">{children}</div>
    </button>
  );
}

// Pie de un gráfico de tarjeta: sus marcas repartidas a lo ancho.
function TileAxis({ children }) {
  return <div className="flex justify-between gap-1.5 text-[11px] leading-none text-slate-400 tabular-nums">{children}</div>;
}

// Reparto de una ventana en una barra fina: las cinco zonas, su lectura y la
// marca del objetivo de volumen fácil.
function ZoneBar({ label, mix }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-slate-500">{label}</span>
        {mix.hasData ? (
          <span className="text-slate-500 tabular-nums">
            <b className="text-slate-900 dark:text-slate-100">{Math.round(mix.groups.low)} %</b> fácil en {hoursStr(mix.totalSec)}
          </span>
        ) : (
          <span className="text-slate-400">Sin sesiones con FC</span>
        )}
      </div>
    <div className="relative">
      <div className="h-2.5 w-full rounded-full overflow-hidden flex gap-[2px] bg-slate-200 dark:bg-slate-700">
        {mix.hasData && ZONES.map((z, i) => mix.pct[i] > 0 && (
          <div
            key={z.name}
            className="h-full"
            style={{ width: `${mix.pct[i]}%`, background: z.color }}
            title={`${z.name} ${z.role}: ${mix.pct[i]} % (${hoursStr(mix.times[i])})`}
          />
        ))}
      </div>
      <div
        className="absolute -top-1 -bottom-1 w-[2px] rounded bg-slate-900 dark:bg-white"
        style={{ left: `${POLARIZED_TARGETS.low}%` }}
      />
    </div>
    </div>
  );
}

// "Preguntar al coach" sobre un bloque: deja la semilla del contexto y abre el chat.
function AskChatBtn({ onAsk, focus, label = 'Preguntar al coach', dark = false }) {
  if (!onAsk) return null;
  return (
    <button
      type="button"
      onClick={() => onAsk(focus)}
      title="Ampliar este análisis en el chat de IA"
      className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold rounded cursor-pointer focus-visible:outline-blue-500 ${PRESS} ${dark
        ? 'text-white/70 hover:text-white'
        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}
    >
      <ChatBubbleLeftRightIcon className="w-4 h-4" />
      {label}
    </button>
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
  const [allRaces, setAllRaces] = useState(getTargetRaces);
  useEffect(() => {
    const reload = () => { setTargetRace(getPrimaryTargetRace()); setAllRaces(getTargetRaces()); };
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

  // Rampa semanal de CTL (puntos de fitness por semana).
  const ctlRamp = pmcCurrent?.ramp ?? 0;

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
      mainMin != null ? `${mainMin} min` : null,
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
      zonesLabel: recovery ? 'Zona 1' : 'Zonas 1 y 2',
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

  // ── 10b'. Plan adaptativo: sesión dura + estado de descarga → versión
  // regenerativa por defecto (lib/adaptivePlan). La elección se guarda por día.
  const todayISO = toISODate(new Date(nowMs));
  const adaptedSession = useMemo(() => {
    if (!todaySession.conflict || todaySession.source === 'auto') return null;
    const base = todaySession.planDay ?? { day: todayWorkout.day, type: todaySession.title };
    return recoveryVersion(base, todayWorkout);
  }, [todaySession, todayWorkout]);
  const [adaptChoice, setAdaptChoice] = useState(() => readChoice(cloudStorage, todayISO));
  const showingAdapted = !!adaptedSession && adaptChoice !== 'original';
  // El Planificador lee esto para replanificar la semana con la sesión aplazada.
  useEffect(() => {
    if (adaptedSession && adaptChoice == null) writeChoice(cloudStorage, todayISO, 'adapted', adaptedSession);
  }, [adaptedSession, adaptChoice, todayISO]);
  const [adaptSend, setAdaptSend] = useState(null);
  const toggleAdapted = () => {
    const next = showingAdapted ? 'original' : 'adapted';
    writeChoice(cloudStorage, todayISO, next, adaptedSession);
    setAdaptChoice(next);
  };
  const sendAdapted = async () => {
    setAdaptSend('sending');
    try {
      const { results } = await pushPlanDays([adaptedSession]);
      setAdaptSend(results?.[0]?.ok ? 'sent' : `error:${results?.[0]?.error || 'No se pudo enviar.'}`);
    } catch (e) {
      setAdaptSend(`error:${e.message}`);
    }
  };

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
        badge: c.zone ? `${c.type ? `${c.type}, ` : ''}Z${c.zone}` : (c.type ?? 'Coach IA'),
        distance: c.distance || DASH,
        pace: c.pace || DASH,
        hr: c.hr ? `${c.hr} ppm` : DASH,
        totalMin: c.totalMin || null,
        segments: c.blocks.map((b) => {
          const reps = Number(b.reps) || 1;
          return {
            label: String(b.phase || ''),
            detail: [
              reps > 1 ? `${reps} × ${b.duration_min}′` : `${b.duration_min}′`,
              b.pace,
              b.hr ? `${b.hr} ppm` : null,
              reps > 1 && b.recovery ? `rec. ${b.recovery}` : null,
            ].filter(Boolean).join(' • '),
            min: b.totalMin,
            z: Number(b.intensity) || 1,
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
        { label: 'Calentamiento', detail: st.warmup, min: st.warmMin, z: 1 },
        { label: todayWorkout.recovery ? 'Trote regenerativo' : 'Rodaje base', detail: st.main, min: st.mainMin, z: todayWorkout.recovery ? 1 : 2 },
        { label: 'Vuelta a la calma', detail: st.cool, min: st.coolMin, z: 1 },
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

  // ── 11b. Última carrera, con sus parciales por km si están enriquecidos ────
  const lastRun = useMemo(() => {
    const r = runs[0];
    if (!r) return null;
    const hr = r.average_heartrate ? Math.round(r.average_heartrate) : null;
    const rawCad = r.average_cadence;
    const splits = (r.splits_metric || [])
      .filter(sp => sp.distance > 500 && sp.average_speed > 0)
      .map(sp => ({
        speed: sp.average_speed,
        hr: sp.average_heartrate ? Math.round(sp.average_heartrate) : null,
        zoneIdx: sp.average_heartrate && bounds ? classifyHR(sp.average_heartrate, bounds) : -1,
      }));
    return {
      id: r.id,
      name: r.name,
      date: new Date(r.start_date),
      distKm: (r.distance || 0) / 1000,
      movingTime: r.moving_time ?? null,
      pace: formatPaceFromSpeed(r.average_speed, DASH),
      hr,
      zoneIdx: hr != null && bounds ? classifyHR(hr, bounds) : -1,
      cadence: rawCad ? Math.round(rawCad < 120 ? rawCad * 2 : rawCad) : null,
      elev: r.total_elevation_gain != null ? Math.round(r.total_elevation_gain) : null,
      // Eficiencia de la sesión entera (m/latido): misma fórmula que `sessionEfficiency.whole`.
      ef: efficiencyMPerBeat(r.average_speed, r.average_heartrate),
      polyline: r.map?.summary_polyline ?? null,
      splits,
    };
  }, [runs, bounds]);

  // ── 12. Briefing de hoy: series de 8 semanas y comparativa vs histórico ───
  // Es el contenido que vivía en `StatusHero`, con el lenguaje visual de esta
  // portada. Los cálculos son los MISMOS (`computeStats`), no una copia.
  const briefing = useMemo(() => {
    if (!stats) return null;
    const { chartDataFull } = stats;

    // Km REALES por semana NATURAL (lunes a domingo, 8 últimas): la última es
    // la semana en curso, la misma que la tira L–D, para que las cifras cuadren.
    const thisMonday = weekStartKey(new Date(nowMs));
    const byWeek = new Map();
    chartDataFull.forEach(d => {
      const wk = weekStartKey(new Date(Number(d.date.slice(0, 4)), Number(d.date.slice(5, 7)) - 1, Number(d.date.slice(8, 10))));
      const km = (d.activities ?? []).filter(isRun).reduce((a, act) => a + (act.distance ?? 0), 0) / 1000;
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + km);
    });
    const volWeeks = Array.from({ length: 8 }, (_, k) => {
      const m = new Date(Number(thisMonday.slice(0, 4)), Number(thisMonday.slice(5, 7)) - 1, Number(thisMonday.slice(8, 10)) - (7 - k) * 7);
      const key = weekStartKey(m);
      return { key, v: Math.round(byWeek.get(key) ?? 0), current: k === 7 };
    });

    // CTL diario de las 6 últimas semanas, para la tendencia de Fitness.
    const ctlTrend = chartDataFull.slice(-42).map(d => d.ctl);

    return { volWeeks, ctlTrend };
  }, [stats, nowMs]);

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

  // ── 13. Carreras objetivo ──────────────────────────────────────────────────
  // Próximas 3 carreras (hoy o futuras), de la más cercana a la más lejana. La
  // principal no puede quedarse fuera: si cae más lejos, ocupa el tercer hueco.
  const upcomingRaces = useMemo(() => {
    const byDate = (a, b) => (a.date || '').localeCompare(b.date || '');
    const future = allRaces
      .filter(r => { const d = daysUntil(r.date); return d != null && d >= 0; })
      .sort(byDate);
    const next = future.slice(0, 3);
    if (targetRace && !next.some(r => r.id === targetRace.id) && future.some(r => r.id === targetRace.id)) {
      return [...future.slice(0, 2), targetRace].sort(byDate);
    }
    return next;
  }, [allRaces, targetRace]);

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

  // ── 15. Lectura visual del estado ─────────────────────────────────────────
  const readinessTone = readiness == null ? 'slate'
    : readiness.score >= 80 ? 'emerald'
    : readiness.score >= 62 ? 'blue'
    : readiness.score >= 45 ? 'amber'
    : 'rose';
  const readinessColor = TONE[readinessTone].stroke;
  const [readinessHead, readinessTail] = (readiness?.label ?? 'Sin datos suficientes').split(' · ');
  const sources = [
    wearables.hrv ? 'VFC' : null,
    wearables.rhr ? 'FC reposo' : null,
    wearables.bb ? 'Body Battery' : null,
    wearables.sleep ? 'sueño' : null,
    currentTSB != null ? 'PMC' : null,
  ].filter(Boolean).join(' · ') || 'Sin telemetría sincronizada';

  const tsbValue = stats?.currentTSB ?? currentTSB;
  const formColor = bandColor(TSB_BANDS, tsbValue);
  const tsbSpan = tsbValue != null ? Math.max(30, Math.ceil(Math.abs(tsbValue) / 10) * 10) : 30;
  const acwrKey = acwrZone(currentACWR);
  const acwrMax = Math.max(2, currentACWR ?? 0);

  // Lectura del coach: tres análisis en pestañas, recortados hasta que se piden enteros.
  const [coachTab, setCoachTab] = useState('cur');
  const [coachExpanded, setCoachExpanded] = useState(false);
  const coachTabs = [
    { id: 'cur',   label: 'Diagnóstico',   text: ai.cur,      badge: curBadge,   accent: 'text-blue-500',   focus: 'readiness' },
    { id: 'trend', label: 'Tendencia',     text: ai.trend,    badge: trendBadge, accent: 'text-indigo-500', focus: 'briefing' },
  ];
  const activeCoachTab = coachTabs.find(tb => tb.id === coachTab) ?? coachTabs[0];
  const coachLong = (activeCoachTab.text?.length ?? 0) > 420;
  const diagFallback = (
    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      {readiness == null
        ? 'Sin telemetría de wearable no se puede leer el estado autonómico. Sincroniza Garmin para activar este diagnóstico.'
        : `${readiness.label}. ${
            hrvDeltaPct != null
              ? `La VFC de los últimos 7 días está un ${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct} % respecto a tu baseline de 60 días.`
              : 'Sin baseline de VFC suficiente para medir desviación.'
          }${currentTSB != null ? ` El TSB de ${currentTSB} sitúa la forma en fase «${phase?.label ?? DASH}».` : ''}`}
    </p>
  );

  const volAvg = stats?.avgWeekKmYear ?? 0;
  const volMax = briefing ? Math.max(...briefing.volWeeks.map(w => w.v), volAvg, 1) : 1;
  const volPct = volAvg > 0 ? weekStrip.totalKm / volAvg : 0;
  const ctlTrend = (briefing?.ctlTrend ?? []).filter(v => Number.isFinite(v));
  const ctlMin = ctlTrend.length ? Math.max(0, Math.floor(Math.min(...ctlTrend) - 4)) : 0;
  const ctlMax = Math.ceil(Math.max(stats?.peakCTL ?? 0, ...ctlTrend, 1) + 2);

  return (
    <div className="today-stagger space-y-4">

      {/* ── Acciones: sincronizar, coach y calibración ──────────────────────── */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {(ai.usedProvider || activeAiModel) && (
          <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${ai.loading ? 'animate-pulse' : ''}`} />
            Coach IA con {ai.usedProvider || activeAiModel}
            {ai.cacheTs && !ai.loading ? `, análisis ${formatTs(ai.cacheTs)}` : ''}
          </span>
        )}
        {recalcAt && !busy && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">
            Actualizado a las {new Date(recalcAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <CoachSettings ai={ai} />
        <button
          type="button"
          onClick={() => onNavigate('calibration')}
          className={`px-3 py-1.5 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer focus-visible:outline-blue-500 ${PRESS}`}
        >
          Calibrar FC
        </button>
        <button
          type="button"
          onClick={recalculate}
          disabled={busy || ai.loading}
          title="Sincronizar Strava y Garmin, recalcular las métricas y pedir un análisis nuevo al coach"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 text-xs font-semibold text-white cursor-pointer focus-visible:outline-blue-500 ${PRESS}`}
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${busy || ai.loading ? 'animate-spin' : ''}`} />
          <span>{busy ? 'Recalculando…' : ai.loading ? 'Analizando…' : 'Recalcular'}</span>
        </button>
      </div>

      {/* ── CARRERA OBJETIVO: una franja fina, una línea por carrera ─────────── */}
      <section aria-label="Carrera objetivo" className="rounded-none bg-blue-700 text-white border border-blue-800/40 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
        {upcomingRaces.length > 0 ? (
          // Las próximas carreras, de la más cercana a la más lejana, separadas
          // por una línea fina (no por hueco). La principal se distingue con el
          // recuadro de días en blanco y la etiqueta.
          <div className={`grid grid-cols-1 divide-y divide-white/10 md:divide-y-0 ${upcomingRaces.length === 2 ? 'md:grid-cols-2 md:divide-x' : upcomingRaces.length >= 3 ? 'md:grid-cols-3 md:divide-x' : ''}`}>
            {upcomingRaces.map((r) => {
              const isMain = r.id === targetRace?.id;
              const d = daysUntil(r.date);
              const km = r.distance ? DISTANCE_KM[r.distance] ?? null : null;
              const pace = r.goalTimeMin && km ? formatPaceFromSpeed((km * 1000) / (r.goalTimeMin * 60), DASH) : null;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onNavigate(`targets/${r.id}`)}
                  title={isMain ? 'Carrera principal: abrir su plan' : 'Abrir el plan de esta carrera'}
                  className={`group text-left flex items-center gap-3 min-w-0 px-3 py-2 rounded-none cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white ${PRESS} ${isMain ? 'bg-white/10 hover:bg-white/15' : 'hover:bg-white/5'}`}
                >
                  {/* Cuenta atrás: número sobre unidad, centrado en las dos líneas */}
                  <span className={`flex flex-col items-center justify-center w-12 h-11 rounded-none shrink-0 tabular-nums border ${d === 0 ? 'bg-emerald-400 text-emerald-950 border-emerald-300' : isMain ? 'bg-white text-blue-800 border-white' : 'bg-white/10 text-white border-white/15'}`}>
                    <span className="text-lg font-black leading-none">{d === 0 ? 'Hoy' : d}</span>
                    {d !== 0 && <span className={`text-label font-bold uppercase leading-none mt-1 ${isMain ? 'text-blue-700/70' : 'text-blue-200'}`}>{t('targets.days_unit')}</span>}
                  </span>
                  {/* Qué carrera: nombre y, debajo, cuándo y cuánto */}
                  <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-extrabold tracking-tight leading-tight truncate">{r.name}</span>
                      {isMain && <span className="shrink-0 px-1.5 py-px rounded-none bg-amber-300 text-amber-950 text-label font-bold leading-snug">Principal</span>}
                    </span>
                    <span className="text-xs text-blue-100/80 tabular-nums leading-tight truncate">
                      {[
                        r.date ? new Date(r.date + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short' }) : null,
                        km != null ? `${km.toLocaleString(lang, { maximumFractionDigits: 1 })} km` : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {/* Objetivo: tiempo y ritmo meta, alineados a la derecha */}
                  {r.goalTimeMin ? (
                    <span className="shrink-0 flex flex-col items-end gap-0.5 tabular-nums border-l border-white/10 pl-3">
                      <span className="flex items-baseline gap-1.5 leading-tight">
                        <span className="text-label font-bold uppercase text-blue-200">Meta</span>
                        <span className="text-sm font-black text-white">{formatMinutes(r.goalTimeMin)}</span>
                      </span>
                      {pace && <span className="text-xs font-semibold leading-tight text-blue-100">{pace}<span className="font-normal text-blue-200">/km</span></span>}
                    </span>
                  ) : null}
                  <ArrowRightIcon className="w-3.5 h-3.5 shrink-0 text-white/30 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                </button>
              );
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate('targets')}
            className={`group w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-white/5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white ${PRESS}`}
          >
            <span className="text-sm font-extrabold">{t('targets.no_target', 'Sin objetivo fijado')}</span>
            <span className="text-xs text-blue-100/90 truncate">Fija una carrera para tener cuenta atrás, ritmo meta y plan.</span>
            <span className="ml-auto flex items-center gap-1 text-xs font-bold shrink-0">
              {t('targets.manage', 'Fijar objetivo')}
              <ArrowRightIcon className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
          </button>
        )}
      </section>

      {/* ═══════════ ESTADO AHORA: readiness y señales ═══════════ */}
      <section aria-label="Estado de hoy" className="relative overflow-hidden rounded bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-white shadow-[0_24px_48px_-24px_rgb(30_27_75_/_0.65)]">
        <div aria-hidden="true" className="absolute -left-24 -top-24 w-96 h-96 rounded-full blur-3xl opacity-25 pointer-events-none" style={{ background: readinessColor }} />
        <div aria-hidden="true" className="absolute -right-24 -bottom-32 w-96 h-96 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />

        <div className="relative grid grid-cols-1 xl:grid-cols-12 gap-3 p-3 sm:px-4">
          {/* Readiness: el número y lo que significa, con sus acciones */}
          <div className="xl:col-span-4 flex items-center gap-3.5">
            <Ring value={readiness?.score} size={76} stroke={8} color={readinessColor} trackClass="text-white/10">
              <span className="text-[26px] font-black tabular-nums leading-none">{readiness?.score ?? DASH}</span>
            </Ring>
            <div className="min-w-0 flex flex-col gap-1">
              <span
                className="text-label font-bold uppercase text-white/50 truncate"
                title={`${sources}${garminStats?.lastDate ? ` · último dato Garmin ${garminStats.lastDate}` : ''}`}
              >
                Readiness · tu estado hoy
              </span>
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-xl font-black tracking-tight leading-none" style={{ color: readinessColor }}>{readinessHead}</h2>
                {readinessTail && <span className="text-sm font-semibold text-white/70 leading-none">{readinessTail}</span>}
              </div>
              <div className="flex items-center gap-1 -ml-2 mt-0.5">
                {askCoach && (
                  <button
                    type="button"
                    onClick={() => askCoach('readiness')}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold text-white/70 hover:text-white hover:bg-white/10 cursor-pointer focus-visible:outline-white ${PRESS}`}
                  >
                    <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" /> Explícamelo
                  </button>
                )}
                <DetailLink dark onClick={() => onNavigate('health')}>Salud</DetailLink>
              </div>
            </div>
          </div>

          {/* Las cuatro señales que forman el score */}
          <div className="xl:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-2 content-center">
            <HeroSignal
              icon="monitor_heart"
              onClick={() => onNavigate('health/resumen?m=hrv')}
              label="VFC"
              value={wearables.hrv?.latest != null ? Math.round(wearables.hrv.latest) : DASH}
              unit="ms"
              note={hrvDeltaPct != null ? `${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct}% vs 60 d` : (wearables.hrv?.status ?? 'Sin baseline')}
              tone={hrvDeltaPct == null ? 'slate' : hrvDeltaPct >= -5 ? 'emerald' : hrvDeltaPct >= -12 ? 'amber' : 'rose'}
              spark={wearables.hrvSpark}
            />
            <HeroSignal
              icon="favorite"
              onClick={() => onNavigate('health/resumen?m=rhr')}
              label="FC reposo"
              value={wearables.rhr ? Math.round(wearables.rhr.r7) : DASH}
              unit="ppm"
              note={wearables.rhr ? `${wearables.rhr.r7 - wearables.rhr.r28 >= 0 ? '+' : ''}${fmt1(wearables.rhr.r7 - wearables.rhr.r28)} vs 28 d` : 'Sin datos'}
              // Subir la FC de reposo es la mala noticia: el color va al revés que la VFC.
              tone={!wearables.rhr ? 'slate' : wearables.rhr.r7 - wearables.rhr.r28 <= 1 ? 'emerald' : wearables.rhr.r7 - wearables.rhr.r28 <= 3 ? 'amber' : 'rose'}
            />
            <HeroSignal
              icon="bedtime"
              onClick={() => onNavigate('health/resumen?m=sleep')}
              label="Sueño"
              value={wearables.sleep?.score ?? DASH}
              unit="/100"
              note={wearables.sleep?.durationMin
                ? `${formatMinutesHm(wearables.sleep.durationMin, DASH)}${wearables.sleep.deepMin ? ` · prof. ${formatMinutesHm(wearables.sleep.deepMin, DASH)}` : ''}`
                : 'Sin registro'}
              tone={wearables.sleep?.score == null ? 'slate' : wearables.sleep.score >= 75 ? 'emerald' : wearables.sleep.score >= 60 ? 'amber' : 'rose'}
              spark={wearables.sleepSpark}
            />
            <HeroSignal
              icon="battery_charging_full"
              onClick={() => onNavigate('health/resumen?m=bb')}
              label="Body Battery"
              value={wearables.bb?.high ?? DASH}
              unit="/100"
              note={wearables.bb?.high != null && wearables.bb?.low != null ? `+${wearables.bb.high - wearables.bb.low} recargado` : 'Sin recarga'}
              tone={wearables.bb?.high == null ? 'slate' : wearables.bb.high >= 70 ? 'emerald' : wearables.bb.high >= 45 ? 'amber' : 'rose'}
              bar={wearables.bb?.high}
            />
          </div>

        </div>

      </section>

      {/* ═══════════ CARGA: forma, riesgo, fitness, intensidad y volumen ═══════════ */}
      <Panel
        title="Carga"
        sub="Modelo de Banister con TRIMP por reserva de FC"
        link={<DetailLink onClick={() => onNavigate('pmc')}>Ver PMC</DetailLink>}
      >
        {stats ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-3">
            <LoadTile
              icon="balance"
              label="Forma y riesgo"
              color={acwrKey === 'caution' || acwrKey === 'danger' ? bandColor(ACWR_BANDS, currentACWR) : formColor}
            >
              <div className="flex flex-col justify-around gap-2 h-full divide-y divide-slate-200/70 dark:divide-slate-800">
                <TileRow
                  label="TSB"
                  value={fmtSigned(tsbValue)}
                  note={phase?.label ?? 'Sin datos'}
                  color={formColor}
                  tip={`Fitness menos fatiga. ${phase?.description ?? ''}`}
                  onClick={() => onNavigate('pmc')}
                >
                  <Scale value={tsbValue} min={-tsbSpan} max={tsbSpan} bands={TSB_BANDS} />
                  <TileAxis><span>Fatiga</span><span>Fresco</span></TileAxis>
                </TileRow>
                <TileRow
                  label="ACWR"
                  value={fmtDec(currentACWR, 2)}
                  note={acwrKey ? { underload: 'Carga baja', optimal: 'Zona segura', caution: 'Precaución', danger: 'Riesgo' }[acwrKey] : 'Sin datos'}
                  color={bandColor(ACWR_BANDS, currentACWR)}
                  tip={acwrKey ? `${ACWR_INFO[acwrKey]} Rampa de fitness: ${fmtSigned(ctlRamp)} por semana.` : 'Sin carga suficiente para calcular el ratio.'}
                  onClick={() => onNavigate('injury')}
                >
                  <Scale value={currentACWR} min={0.4} max={acwrMax} bands={ACWR_BANDS} />
                  <TileAxis><span>0,4</span><span>0,8</span><span>1,3</span><span>{acwrMax.toFixed(1).replace('.', ',')}</span></TileAxis>
                </TileRow>
              </div>
            </LoadTile>

            <LoadTile
              icon="monitoring"
              label="Fitness · CTL"
              value={fmtDec(stats.currentCTL)}
              note={`${fmtSigned(stats.currentCTL - stats.ctl7ago)} en 7 días`}
              color={stats.currentCTL - stats.ctl7ago >= 0 ? C_GOOD : C_WARN}
              tip={`${stats.peakCTL > 0 ? Math.round((stats.currentCTL / stats.peakCTL) * 100) : 0} % de tu pico histórico (${fmtDec(stats.peakCTL)}). Pico de este año: ${fmtDec(stats.peakCTLYear)}.`}
              onClick={() => onNavigate('pmc')}
            >
              <TrendChart className="h-12" values={briefing?.ctlTrend} min={ctlMin} max={ctlMax} color={COLORS.signal} refLine={{ value: stats.peakCTL, label: `Tu pico ${fmtDec(stats.peakCTL)}` }} />
              <TileAxis><span>6 semanas</span><span>Pico del año {fmtDec(stats.peakCTLYear)}</span></TileAxis>
            </LoadTile>

            <LoadTile
              icon="local_fire_department"
              label="Intensidad · 28 días"
              value={zoneDistribution.hasData ? Math.round(zoneDistribution.groups.low) : DASH}
              unit={zoneDistribution.hasData ? '% en fácil' : null}
              note={!bounds ? 'Calibra tu FC' : zoneDistribution.hasData ? VERDICT[zoneDistribution.verdictKey].label : 'Sin sesiones con FC'}
              color={!zoneDistribution.hasData ? COLORS.inkFaint : zoneDistribution.verdictKey === 'ok' ? C_GOOD : C_WARN}
              tip={!bounds ? 'Calibra tu FC máxima y de reposo para ver el reparto por zonas.' : `La marca es el objetivo del ${POLARIZED_TARGETS.low} % en fácil.`}
              onClick={() => onNavigate(bounds ? 'zones' : 'calibration')}
            >
              {bounds && (
                <div className="flex flex-col gap-2.5">
                  <ZoneBar label="28 días" mix={zoneDistribution} />
                  <ZoneBar label="Esta semana" mix={zoneWeek} />
                </div>
              )}
            </LoadTile>

            <LoadTile
              className="sm:col-span-2"
              icon="route"
              label="Volumen · esta semana"
              value={fmtDec(weekStrip.totalKm)}
              unit="km"
              note={`en ${weekStrip.activeDays} ${weekStrip.activeDays === 1 ? 'día' : 'días'}${volAvg > 0 ? `, el ${Math.round(volPct * 100)} % de tu semana media` : ''}`}
              color={volAvg <= 0 ? COLORS.inkFaint : volPct > 1.3 ? C_WARN : volPct < 0.7 ? C_FRESH : C_GOOD}
              tip="Semanas naturales, de lunes a domingo."
              onClick={() => onNavigate('weekly')}
            >
              <div className="grid grid-cols-2 gap-5">
                {/* Semana en curso, día a día */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-end gap-1.5 h-16">
                    {weekStrip.days.map(d => (
                      <div key={d.key} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={d.km > 0 ? `${d.km.toFixed(1)} km` : 'Sin carrera'}>
                        {d.km > 0 && <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums leading-none">{d.km.toFixed(0)}</span>}
                        <div
                          className={`w-full max-w-[14px] rounded-t-[3px] rounded-b-[1px] ${d.km > 0 ? (d.isToday ? 'bg-slate-900 dark:bg-white' : 'bg-blue-500') : d.future ? 'border border-dashed border-slate-300 dark:border-slate-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                          style={{ height: d.km > 0 ? `${Math.max(10, (d.km / weekStrip.maxKm) * 75)}%` : d.future ? '12%' : '3px' }}
                        />
                      </div>
                    ))}
                  </div>
                  <TileAxis>
                    {WEEKDAYS.map((w, i) => (
                      <span key={w} className={`flex-1 text-center ${weekStrip.days[i].isToday ? 'font-bold text-slate-900 dark:text-white' : ''}`}>{w}</span>
                    ))}
                  </TileAxis>
                </div>
                {/* 8 semanas naturales (la última es esta), con la media del año */}
                {briefing && (
                  <div className="flex flex-col gap-1">
                    <div className="relative flex items-end gap-1.5 h-16">
                      {volAvg > 0 && (
                        <div className="absolute inset-x-0 border-t border-dashed border-slate-300 dark:border-slate-600 pointer-events-none" style={{ bottom: `${(volAvg / volMax) * 75}%` }} />
                      )}
                      {briefing.volWeeks.map(w => (
                        <div key={w.key} className="flex-1 h-full flex flex-col items-center justify-end gap-1" title={`Semana del ${w.key.slice(8, 10)}/${w.key.slice(5, 7)}: ${w.v} km`}>
                          <span className={`text-[11px] tabular-nums leading-none ${w.current ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500'}`}>{w.v}</span>
                          <div
                            className={`w-full max-w-[14px] rounded-t-[3px] rounded-b-[1px] ${w.current ? 'bg-slate-900 dark:bg-white' : 'bg-slate-300 dark:bg-slate-600'}`}
                            style={{ height: `${Math.max(3, (w.v / volMax) * 75)}%` }}
                          />
                        </div>
                      ))}
                    </div>
                    <TileAxis><span>8 últimas semanas</span><span>media {volAvg.toFixed(0)} km</span></TileAxis>
                  </div>
                )}
              </div>
            </LoadTile>
          </div>
        ) : (
          <div className="py-6 flex flex-col items-start gap-2 max-w-prose">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Aún no hay historial suficiente para el modelo de carga.</p>
            <p className="text-xs text-slate-500 leading-relaxed">Forma, riesgo y fitness salen de tus últimas semanas de entrenamiento. Sincroniza Strava y Garmin para verlos aquí.</p>
            <button
              type="button"
              onClick={recalculate}
              disabled={busy}
              className={`mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white cursor-pointer focus-visible:outline-blue-500 ${PRESS}`}
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
          </div>
        )}
      </Panel>

      {/* ═══════════ SESIÓN, COACH Y ÚLTIMA CARRERA ═══════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 flex flex-col min-w-0">
          {todaySession.source === 'auto' ? (
            <Panel
              className="flex-1"
              title="Hoy toca"
              sub={todayWorkout.day}
              link={<DetailLink onClick={() => onNavigate('planner')}>Planificador</DetailLink>}
            >
              <p className={`${DISPLAY} text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50`}>
                {todayWorkout.recovery ? 'Trote regenerativo' : suggested.source === 'coach' ? 'Sesión del coach' : 'Rodaje base'}
                <span className="ml-2 align-middle text-xs font-semibold text-slate-500">{suggested.badge}</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">{suggested.note}</p>

              <dl className="grid grid-cols-3 gap-3 mt-3">
                {[
                  { label: 'Distancia', value: suggested.distance },
                  { label: 'Ritmo', value: suggested.pace },
                  { label: 'Pulso', value: suggested.hr },
                ].map(m => (
                  <div key={m.label} className="min-w-0">
                    <dt className="text-xs text-slate-500">{m.label}</dt>
                    <dd className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 truncate">{m.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-3">
                {suggested.segments.length > 0 ? (
                  <WorkoutProfile segments={suggested.segments} />
                ) : (
                  <p className="h-28 rounded border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs text-slate-500 px-3 text-center">
                    {suggested.emptyMsg}
                  </p>
                )}
              </div>

              {suggested.conflict && (
                <p className="mt-4 p-3 rounded bg-amber-50 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  El coach propone calidad, pero tu readiness o tu forma piden descargar hoy: valora cambiarla por un rodaje suave.
                </p>
              )}

              <div className="mt-auto pt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                  {suggested.totalMin != null ? `${suggested.totalMin} min en total. ` : ''}{suggested.calibration}.
                </span>
                <AskChatBtn onAsk={askCoach} focus="workout" />
              </div>
              {(suggested.quote || (suggested.source === 'coach' && ai.nextWork)) && (
                <CoachDisclosure label="Cómo ejecutarla" className="mt-3">
                  <div className="flex flex-col gap-2">
                    {suggested.segments.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {suggested.segments.map((sg, i) => (
                          <li key={i} className="text-xs text-slate-600 dark:text-slate-300">
                            <span className="font-semibold">{sg.label}</span>: {sg.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                    {suggested.quote && <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{suggested.quote}</p>}
                    {suggested.source === 'coach' && ai.nextWork && <CoachMD text={ai.nextWork} accent="text-blue-500" />}
                  </div>
                </CoachDisclosure>
              )}
            </Panel>
          ) : (
            <TodayPlannedSession
              session={todaySession}
              day={todayWorkout.day}
              adapted={adaptedSession}
              showingAdapted={showingAdapted}
              onToggleAdapted={toggleAdapted}
              onSendAdapted={adaptedSession ? sendAdapted : undefined}
              sendState={adaptSend}
              action={<DetailLink onClick={() => onNavigate('planner')}>Planificador</DetailLink>}
            />
          )}
        </div>

        {/* Última carrera: recorrido real, cifras y ritmo por km, al lado de "Hoy toca" */}
        <Panel
          className="lg:col-span-8"
          title="Última carrera"
          sub={`${runs.length} carreras en total`}
          link={lastRun && (
            <span className="flex items-center gap-4">
              <DetailLink onClick={() => onNavigate('log')}>Historial</DetailLink>
              <DetailLink onClick={() => onNavigate(`activity/${lastRun.id}`)}>Ver la sesión</DetailLink>
            </span>
          )}
        >
          {!lastRun ? (
            <div className="py-6 flex flex-col items-start gap-2 max-w-prose">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Aún no hay carreras sincronizadas.</p>
              <p className="text-xs text-slate-500 leading-relaxed">Tu última salida aparecerá aquí con su recorrido, el ritmo por kilómetro y la lectura del coach.</p>
              <button
              type="button"
              onClick={recalculate}
              disabled={busy}
              className={`mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white cursor-pointer focus-visible:outline-blue-500 ${PRESS}`}
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-8 gap-4">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigate(`activity/${lastRun.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(`activity/${lastRun.id}`); } }}
                  className={`sm:col-span-3 cursor-pointer rounded overflow-hidden hover:opacity-90 focus-visible:outline-blue-500 ${PRESS}`}
                  title="Abrir la sesión"
                >
                  <RouteMap encoded={lastRun.polyline} interactive={false} theme="dark" className="relative w-full aspect-square max-h-48" />
                </div>

                <div className="sm:col-span-5 flex flex-col gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className={`${DISPLAY} text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 truncate`}>{lastRun.name}</p>
                    <p className="text-xs text-slate-500 first-letter:uppercase">
                      {lastRun.date.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' })}, {lastRun.date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
                    {[
                      { label: 'Distancia', value: fmtDec(lastRun.distKm, 2), unit: 'km' },
                      { label: 'Tiempo', value: lastRun.movingTime != null ? formatDuration(lastRun.movingTime) : DASH },
                      { label: 'Ritmo', value: lastRun.pace, unit: '/km' },
                      {
                        label: 'FC media',
                        value: lastRun.hr ?? DASH,
                        unit: lastRun.hr != null ? `ppm${lastRun.zoneIdx >= 0 ? `, Z${lastRun.zoneIdx + 1}` : ''}` : null,
                        dot: lastRun.zoneIdx >= 0 ? ZONES[lastRun.zoneIdx].color : null,
                      },
                      { label: 'Desnivel', value: lastRun.elev != null ? `+${lastRun.elev}` : DASH, unit: lastRun.elev != null ? 'm' : null },
                      { label: 'Eficiencia', value: fmtDec(lastRun.ef, 2), unit: lastRun.ef != null ? 'm/lat' : null },
                    ].map(m => (
                      <div key={m.label} className="min-w-0">
                        <dt className="text-xs text-slate-500">{m.label}</dt>
                        <dd className="flex items-baseline gap-1 min-w-0">
                          {m.dot && <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ background: m.dot }} />}
                          <span className={`${DISPLAY} text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-50`}>{m.value}</span>
                          {m.unit && <span className="text-xs text-slate-500 truncate">{m.unit}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {lastRun.splits.length > 1 && (() => {
                    const speeds = lastRun.splits.map(sp => sp.speed);
                    const lo = Math.min(...speeds), hi = Math.max(...speeds), span = hi - lo || 1;
                    return (
                      <div>
                        <p className="text-xs text-slate-500 mb-1.5">Ritmo por kilómetro (más alto, más rápido; color por zona de FC)</p>
                        <div className="flex items-end gap-1 h-16">
                          {lastRun.splits.map((sp, i) => (
                            <div
                              key={i}
                              className="flex-1 min-w-[3px] rounded"
                              style={{ height: `${30 + ((sp.speed - lo) / span) * 70}%`, background: sp.zoneIdx >= 0 ? ZONES[sp.zoneIdx].color : COLORS.signalLight }}
                              title={`Km ${i + 1}: ${formatPaceFromSpeed(sp.speed, DASH)}/km${sp.hr ? `, ${sp.hr} ppm` : ''}`}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="flex flex-col gap-2.5 min-w-0 pt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cómo la ejecutaste</span>
                  <AskChatBtn onAsk={askCoach} focus="briefing" />
                </div>
                {lastActivity && lastActivity.id !== lastRun.id && ai.lastWork && (
                  <p className="text-xs text-slate-500">El análisis del coach es de tu última actividad, «{lastActivity.name}».</p>
                )}
                <CoachText
                  ai={ai}
                  text={ai.lastWork}
                  accent="text-amber-500"
                  fallback={<p className="text-sm text-slate-500">El coach aún no ha analizado esta sesión. Pulsa «Recalcular» para pedirlo.</p>}
                />
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* ═══════════ LECTURA DEL COACH ═══════════ */}
      <Panel
        title="Lectura del coach"
        sub={ai.cacheTs ? `Análisis ${formatTs(ai.cacheTs)}` : undefined}
        link={<AskChatBtn onAsk={askCoach} focus={activeCoachTab.focus} />}
      >
        <CoachBanners ai={ai} />
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-slate-100 dark:border-slate-800">
          {coachTabs.map(tb => (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={coachTab === tb.id}
              onClick={() => { setCoachTab(tb.id); setCoachExpanded(false); }}
              className={`-mb-px px-3 py-2 text-sm font-semibold border-b-2 transition-colors duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${coachTab === tb.id
                ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <div className="max-w-[75ch] pt-4">
          {activeCoachTab.badge && (
          <div className="flex items-center gap-2 mb-2">
            <CoachBadge badge={activeCoachTab.badge} />
          </div>
        )}
        <div className={`relative ${coachLong && !coachExpanded ? 'max-h-44 overflow-hidden' : ''}`}>
            <CoachText
              ai={ai}
              text={activeCoachTab.text}
              accent={activeCoachTab.accent}
              fallback={activeCoachTab.id === 'cur' ? diagFallback : (
                <p className="text-sm text-slate-500">El coach aún no ha hecho este análisis. Pulsa «Recalcular» para pedirlo.</p>
              )}
            />
            {coachLong && !coachExpanded && (
              <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white dark:from-slate-900 pointer-events-none" />
            )}
          </div>
          {coachLong && (
            <button
              type="button"
              onClick={() => setCoachExpanded(v => !v)}
              className="mt-2 text-xs font-semibold rounded text-blue-600 hover:text-blue-800 dark:text-blue-400 transition-colors duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              {coachExpanded ? 'Mostrar menos' : 'Leer completo'}
            </button>
          )}
        </div>
      </Panel>

    </div>
  );
}
