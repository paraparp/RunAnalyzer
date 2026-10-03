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
import { Ring, Scale, WorkoutProfile, RouteShape, DetailLink, Panel } from './TodayVisuals';

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
  { name: 'Z1', role: 'Recuperación', color: '#94a3b8' },
  { name: 'Z2', role: 'Base',         color: '#38bdf8' },
  { name: 'Z3', role: 'Aeróbico',     color: '#4ade80' },
  { name: 'Z4', role: 'Umbral',       color: '#fb923c' },
  { name: 'Z5', role: 'VO2max',       color: '#f87171' },
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

const DISPLAY = "font-['Plus_Jakarta_Sans',Inter,sans-serif]";
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const TONE = {
  emerald: { icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400', stroke: '#10b981', text: 'text-emerald-600 dark:text-emerald-400', pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' },
  blue:    { icon: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',             stroke: '#2563eb', text: 'text-blue-600 dark:text-blue-400',       pill: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300' },
  amber:   { icon: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',         stroke: '#f59e0b', text: 'text-amber-600 dark:text-amber-400',     pill: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  rose:    { icon: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',             stroke: '#f43f5e', text: 'text-rose-600 dark:text-rose-400',       pill: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' },
  slate:   { icon: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',           stroke: '#94a3b8', text: 'text-slate-400',                         pill: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};


// Tonos de las señales sobre el fondo oscuro de la cabecera.
const HERO_TEXT = {
  emerald: 'text-emerald-300',
  blue:    'text-sky-300',
  amber:   'text-amber-300',
  rose:    'text-rose-300',
  slate:   'text-slate-400',
};

// Una señal del readiness en la cabecera: valor, lectura contra su referencia
// y su tendencia (sparkline real) o su nivel (barra).
function HeroSignal({ icon, label, value, unit, note, tone = 'slate', spark, bar }) {
  const stroke = (TONE[tone] ?? TONE.slate).stroke;
  return (
    <div className="p-3.5 rounded bg-white/[0.06] border border-white/10 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[16px] text-white/50">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-white/50 truncate">{label}</span>
        <span className="ml-auto w-2 h-2 rounded-full shrink-0" style={{ background: stroke, boxShadow: `0 0 8px ${stroke}` }} />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-black text-white tabular-nums leading-none">{value}</span>
        <span className="text-[10px] text-white/40 font-semibold">{unit}</span>
      </div>
      <span className={`text-[11px] font-bold truncate ${HERO_TEXT[tone] ?? HERO_TEXT.slate}`}>{note}</span>
      {spark ? (
        <svg className="w-full h-5" preserveAspectRatio="none" viewBox="0 0 100 24">
          <path d={spark} fill="none" stroke={stroke} strokeLinecap="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : bar != null ? (
        <div className="h-1.5 my-[7px] rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${bar}%`, background: stroke }} />
        </div>
      ) : <div className="h-5" />}
    </div>
  );
}

// ── Escalas de estado ────────────────────────────────────────────────────────
// Cada cifra de estado se pinta sobre SU escala, con los cortes que ya usa la
// app: readiness (athleteContext), TSB (formZone), ACWR (acwrZone) y los de las
// señales del wearable que la portada llevaba en sus tonos.
const C_GOOD = '#10b981', C_WARN = '#f59e0b', C_BAD = '#f43f5e', C_FRESH = '#38bdf8', C_TRANS = '#a78bfa';

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
const bandColor = (bands, v) => (v == null || !Number.isFinite(v) ? '#94a3b8' : (bands.find(b => v <= b.to) ?? bands[bands.length - 1]).color);

const fmtSigned = (v, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits).replace('.', ',')}`;
const fmtDec = (v, digits = 1) => (v == null || !Number.isFinite(v) ? DASH : v.toFixed(digits).replace('.', ','));

// Una cifra de carga (forma, riesgo, fitness) con su escala debajo.
function LoadGauge({ label, value, tag, tagColor, children, note, link }) {
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
        {link}
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className={`${DISPLAY} text-4xl font-extrabold tabular-nums tracking-tight text-slate-900 dark:text-slate-50`}>{value}</span>
        {tag && <span className="text-sm font-semibold" style={{ color: tagColor }}>{tag}</span>}
      </div>
      {children}
      {note && <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{note}</p>}
    </div>
  );
}

// Reparto de una ventana en una barra: las cinco zonas y la marca del objetivo
// de volumen fácil.
function ZoneStack({ label, mix }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
        {mix.hasData ? (
          <span className="text-xs text-slate-400 tabular-nums">
            <b className="text-slate-900 dark:text-slate-100">{Math.round(mix.groups.low)} %</b> fácil en {hoursStr(mix.totalSec)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">Sin sesiones con FC</span>
        )}
      </div>
      <div className="relative">
        <div className="h-3 w-full rounded-full overflow-hidden flex gap-[2px] bg-slate-100 dark:bg-slate-800">
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
          title={`Objetivo: ${POLARIZED_TARGETS.low} % fácil`}
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
      className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold rounded cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${dark
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
      polyline: r.map?.summary_polyline ?? null,
      splits,
    };
  }, [runs, bounds]);

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
  const volMax = briefing ? Math.max(...briefing.volSpark.map(w => w.v), volAvg, 1) : 1;

  return (
    <div className="fade-in space-y-6">

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
          className="px-3 py-1.5 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 transition-colors cursor-pointer"
        >
          Calibrar FC
        </button>
        <button
          type="button"
          onClick={recalculate}
          disabled={busy || ai.loading}
          title="Sincronizar Strava y Garmin, recalcular las métricas y pedir un análisis nuevo al coach"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white transition-colors cursor-pointer"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${busy || ai.loading ? 'animate-spin' : ''}`} />
          <span>{busy ? 'Recalculando…' : ai.loading ? 'Analizando…' : 'Recalcular'}</span>
        </button>
      </div>

      {/* ── CARRERA OBJETIVO: una franja, no un cartel ──────────────────────── */}
      <div className="relative overflow-hidden rounded bg-gradient-to-r from-blue-700 via-indigo-600 to-indigo-800 text-white shadow-lg shadow-indigo-900/10 px-5 py-4 sm:px-6">
        <div className="absolute -right-16 -top-24 w-80 h-80 rounded-full bg-cyan-400/20 blur-3xl pointer-events-none" />
        {upcomingRaces.length > 1 ? (
          // Varias carreras: las próximas, de la más cercana a la más lejana. La
          // principal se distingue con la etiqueta y el recuadro de días en blanco.
          <div className={`relative z-10 grid grid-cols-1 gap-2 ${upcomingRaces.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
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
                  className={`group text-left flex items-center gap-3.5 min-w-0 p-2.5 rounded transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white ${isMain ? 'bg-white/15 ring-1 ring-white/40' : 'hover:bg-white/10'}`}
                >
                  <div className={`flex flex-col items-center justify-center w-16 h-16 rounded shrink-0 ${isMain ? 'bg-white text-indigo-700 shadow-md' : 'bg-white/15 backdrop-blur'}`}>
                    <span className="text-2xl font-black leading-none tabular-nums">{d === 0 ? '¡Hoy!' : d}</span>
                    {d !== 0 && (
                      <span className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 ${isMain ? 'text-indigo-400' : 'text-blue-200'}`}>{t('targets.days_unit')}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                      {isMain && <span className="px-1.5 py-px rounded bg-amber-300 text-amber-950 normal-case tracking-normal">Principal</span>}
                      {d > 0 ? `${Math.ceil(d / 7)} ${Math.ceil(d / 7) === 1 ? 'semana' : 'semanas'}` : 'Hoy'}
                    </span>
                    <h2 className="text-base sm:text-lg font-extrabold tracking-tight leading-tight truncate">{r.name}</h2>
                    <p className="text-xs text-blue-100/90 font-medium truncate">
                      {[
                        r.date ? new Date(r.date + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' }) : null,
                        km != null ? `${km.toLocaleString(lang, { maximumFractionDigits: 1 })} km` : null,
                      ].filter(Boolean).join(' • ')}
                    </p>
                    {r.goalTimeMin ? (
                      <p className="text-xs font-bold tabular-nums truncate">
                        <span className="text-emerald-300">{formatMinutes(r.goalTimeMin)}</span>
                        {pace && <span className="text-cyan-300"> · {pace}<span className="font-normal text-blue-100">/km</span></span>}
                      </p>
                    ) : null}
                  </div>
                  <ArrowRightIcon className="w-4 h-4 shrink-0 text-white/40 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div className="flex flex-col items-center justify-center w-16 h-16 rounded bg-white/15 backdrop-blur shrink-0">
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
                  <div className="px-3 py-1.5 rounded bg-white/10">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-blue-200">Ritmo meta</span>
                    <span className="text-sm font-black text-cyan-300 tabular-nums">{raceGoalPace}<span className="text-[10px] font-normal text-blue-100"> /km</span></span>
                  </div>
                  <div className="px-3 py-1.5 rounded bg-white/10">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-blue-200">{t('targets.goal_time')}</span>
                    <span className="text-sm font-black text-emerald-300 tabular-nums">{raceGoalTime}</span>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={() => targetRace ? onNavigate(`targets/${targetRace.id}`) : onNavigate('targets')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded bg-white text-slate-900 text-xs font-bold shadow-md hover:bg-blue-50 transition-all cursor-pointer"
              >
                <span>{targetRace ? t('targets.open_plan') : t('targets.manage', 'Fijar objetivo')}</span>
                <ArrowRightIcon className="w-3.5 h-3.5 text-indigo-600" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════ ESTADO AHORA: readiness y señales ═══════════ */}
      <section className="relative overflow-hidden rounded bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-white shadow-xl shadow-slate-900/10">
        <div className="absolute -left-24 -top-24 w-96 h-96 rounded-full blur-3xl opacity-25 pointer-events-none" style={{ background: readinessColor }} />
        <div className="absolute -right-24 -bottom-32 w-96 h-96 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />

        <div className="relative grid grid-cols-1 xl:grid-cols-12 gap-6 p-5 sm:p-7">
          {/* Readiness: el número grande y lo que significa */}
          <div className="xl:col-span-5 flex items-center gap-5">
            <Ring value={readiness?.score} size={164} stroke={14} color={readinessColor} trackClass="text-white/10">
              <span className="text-5xl font-black tabular-nums leading-none">{readiness?.score ?? DASH}</span>
              <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-white/50 mt-1.5">readiness</span>
            </Ring>
            <div className="min-w-0 flex flex-col gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Tu estado hoy</span>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight leading-none" style={{ color: readinessColor }}>
                {readinessHead}
              </h2>
              {readinessTail && <p className="text-sm font-semibold text-white/80 leading-snug">{readinessTail}</p>}
              {phase && (
                <span className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 text-[11px] font-bold">
                  <span className="w-2 h-2 rounded-full" style={{ background: formColor }} />
                  Forma: {phase.label}
                </span>
              )}
            </div>
          </div>

          {/* Las cuatro señales que forman el score */}
          <div className="xl:col-span-7 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4 gap-2.5 content-center">
            <HeroSignal
              icon="monitor_heart"
              label="VFC"
              value={wearables.hrv?.latest != null ? Math.round(wearables.hrv.latest) : DASH}
              unit="ms"
              note={hrvDeltaPct != null ? `${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct}% vs 60 d` : (wearables.hrv?.status ?? 'Sin baseline')}
              tone={hrvDeltaPct == null ? 'slate' : hrvDeltaPct >= -5 ? 'emerald' : hrvDeltaPct >= -12 ? 'amber' : 'rose'}
              spark={wearables.hrvSpark}
            />
            <HeroSignal
              icon="favorite"
              label="FC reposo"
              value={wearables.rhr ? Math.round(wearables.rhr.r7) : DASH}
              unit="ppm"
              note={wearables.rhr ? `${wearables.rhr.r7 - wearables.rhr.r28 >= 0 ? '+' : ''}${fmt1(wearables.rhr.r7 - wearables.rhr.r28)} vs 28 d` : 'Sin datos'}
              // Subir la FC de reposo es la mala noticia: el color va al revés que la VFC.
              tone={!wearables.rhr ? 'slate' : wearables.rhr.r7 - wearables.rhr.r28 <= 1 ? 'emerald' : wearables.rhr.r7 - wearables.rhr.r28 <= 3 ? 'amber' : 'rose'}
            />
            <HeroSignal
              icon="bedtime"
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
              label="Body Battery"
              value={wearables.bb?.high ?? DASH}
              unit="/100"
              note={wearables.bb?.high != null && wearables.bb?.low != null ? `+${wearables.bb.high - wearables.bb.low} recargado` : 'Sin recarga'}
              tone={wearables.bb?.high == null ? 'slate' : wearables.bb.high >= 70 ? 'emerald' : wearables.bb.high >= 45 ? 'amber' : 'rose'}
              bar={wearables.bb?.high}
            />
          </div>

        </div>

        <div className="relative flex flex-wrap items-center gap-2 px-5 sm:px-7 py-3.5 border-t border-white/10 bg-black/10">
          <span className="text-[11px] text-white/50 truncate">
            {sources}{garminStats?.lastDate ? ` · último dato Garmin ${garminStats.lastDate}` : ''}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {askCoach && (
              <button
                type="button"
                onClick={() => askCoach('readiness')}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" /> Explícamelo
              </button>
            )}
            <DetailLink dark onClick={() => onNavigate('health')}>Salud y recuperación</DetailLink>
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-8 md:gap-10 2xl:gap-8 pt-1">
            <LoadGauge
              label="Forma (TSB)"
              value={fmtSigned(tsbValue)}
              tag={phase?.label}
              tagColor={formColor}
              note={phase?.description}
            >
              <Scale value={tsbValue} min={-tsbSpan} max={tsbSpan} bands={TSB_BANDS} />
              <div className="flex justify-between text-[11px] text-slate-400 -mt-1">
                <span>Fatiga</span><span>Fresco</span>
              </div>
            </LoadGauge>

            <LoadGauge
              label="Riesgo (ACWR)"
              value={fmtDec(currentACWR, 2)}
              tag={acwrKey ? { underload: 'Carga baja', optimal: 'Zona segura', caution: 'Precaución', danger: 'Riesgo' }[acwrKey] : null}
              tagColor={bandColor(ACWR_BANDS, currentACWR)}
              note={acwrKey ? `${ACWR_INFO[acwrKey]} Rampa de fitness: ${fmtSigned(ctlRamp)} por semana.` : 'Sin carga suficiente para calcular el ratio.'}
              link={<DetailLink onClick={() => onNavigate('injury')}>Ver riesgo</DetailLink>}
            >
              <Scale value={currentACWR} min={0.4} max={acwrMax} bands={ACWR_BANDS} />
              <div className="flex justify-between text-[11px] text-slate-400 -mt-1 tabular-nums">
                <span>0,4</span><span>0,8</span><span>1,3</span><span>{acwrMax.toFixed(1).replace('.', ',')}</span>
              </div>
            </LoadGauge>

            <LoadGauge
              label="Fitness (CTL)"
              value={fmtDec(stats.currentCTL)}
              tag={`${fmtSigned(stats.currentCTL - stats.ctl7ago)} en 7 días`}
              tagColor={stats.currentCTL - stats.ctl7ago >= 0 ? C_GOOD : C_WARN}
              note={`${stats.peakCTL > 0 ? Math.round((stats.currentCTL / stats.peakCTL) * 100) : 0} % de tu pico histórico (${fmtDec(stats.peakCTL)}). Pico de este año: ${fmtDec(stats.peakCTLYear)}.`}
            >
              <Scale value={stats.currentCTL} min={0} max={Math.max(stats.peakCTL, stats.currentCTL, 1)} bands={[{ to: Infinity, color: '#60a5fa' }]} />
              <div className="flex justify-between text-[11px] text-slate-400 -mt-1">
                <span>0</span><span>Tu pico</span>
              </div>
            </LoadGauge>

            {/* Intensidad: el reparto por zonas en dos barras; el detalle, en Zonas. */}
            <LoadGauge
              label="Intensidad (28 días)"
              value={zoneDistribution.hasData ? `${Math.round(zoneDistribution.groups.low)} %` : DASH}
              tag={zoneDistribution.hasData ? 'en fácil' : null}
              tagColor="#64748b"
              note={!bounds
                ? 'Calibra tu FC máxima y de reposo para ver el reparto por zonas.'
                : zoneDistribution.hasData
                  ? `${VERDICT[zoneDistribution.verdictKey].label} La marca es el objetivo del ${POLARIZED_TARGETS.low} % en fácil.`
                  : 'Sin sesiones con FC en los últimos 28 días.'}
              link={<DetailLink onClick={() => onNavigate(bounds ? 'zones' : 'calibration')}>{bounds ? 'Ver zonas' : 'Calibrar FC'}</DetailLink>}
            >
              {bounds && (
                <div className="flex flex-col gap-3">
                  <ZoneStack label="28 días" mix={zoneDistribution} />
                  <ZoneStack label="Esta semana" mix={zoneWeek} />
                </div>
              )}
            </LoadGauge>

            {/* Volumen: la semana día a día y las 8 últimas, lado a lado. */}
            <div className="md:col-span-2 flex flex-col gap-3 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-300">Volumen (esta semana)</span>
                <DetailLink onClick={() => onNavigate('weekly')}>Ver progresión</DetailLink>
              </div>
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <span className={`${DISPLAY} text-4xl font-extrabold tabular-nums tracking-tight text-slate-900 dark:text-slate-50`}>{fmtDec(weekStrip.totalKm)} km</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  en {weekStrip.activeDays} {weekStrip.activeDays === 1 ? 'día' : 'días'}
                  {volAvg > 0 ? `, el ${Math.round((weekStrip.totalKm / volAvg) * 100)} % de tu semana media` : ''}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Semana en curso */}
                <div className="flex items-end gap-1.5 h-24">
                  {weekStrip.days.map((d, i) => (
                    <div key={d.key} className="flex-1 flex flex-col items-center gap-1 h-full">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums h-4">{d.km > 0 ? d.km.toFixed(0) : ''}</span>
                      <div className="flex-1 w-full flex items-end justify-center">
                        <div
                          className={`w-2 rounded-full ${d.km > 0 ? (d.isToday ? 'bg-slate-900 dark:bg-white' : 'bg-blue-500') : d.future ? 'bg-slate-100 dark:bg-slate-800' : 'bg-slate-200 dark:bg-slate-700'}`}
                          style={{ height: d.km > 0 ? `${Math.max(10, (d.km / weekStrip.maxKm) * 100)}%` : '4px' }}
                          title={d.km > 0 ? `${d.km.toFixed(1)} km` : 'Sin carrera'}
                        />
                      </div>
                      <span className={`text-xs ${d.isToday ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-400'}`}>{WEEKDAYS[i]}</span>
                    </div>
                  ))}
                </div>
                {/* Últimas 8 semanas, con la media del año */}
                {briefing && (
                  <div className="flex flex-col">
                    <div className="relative flex items-end gap-1.5 flex-1 min-h-[5rem]">
                      {volAvg > 0 && (
                        <div className="absolute inset-x-0 border-t border-dashed border-slate-400 dark:border-slate-500 pointer-events-none" style={{ bottom: `${(volAvg / volMax) * 80}%` }} />
                      )}
                      {briefing.volSpark.map((w, i) => (
                        <div key={i} className="flex-1 h-full flex flex-col items-center justify-end gap-1" title={`${w.v} km`}>
                          <span className="text-[11px] text-slate-400 tabular-nums">{w.v}</span>
                          <div
                            className={`w-2 rounded-full ${i === briefing.volSpark.length - 1 ? 'bg-slate-900 dark:bg-white' : 'bg-slate-300 dark:bg-slate-700'}`}
                            style={{ height: `${Math.max(3, (w.v / volMax) * 80)}%` }}
                          />
                        </div>
                      ))}
                    </div>
                    <span className="text-xs text-slate-400 mt-1">8 últimas semanas{volAvg > 0 ? `, media del año ${volAvg.toFixed(0)} km` : ''}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="py-6 text-sm text-slate-400">Aún no hay historial suficiente para el modelo de carga.</p>
        )}
      </Panel>

      {/* ═══════════ SESIÓN, COACH Y ÚLTIMA CARRERA ═══════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 flex flex-col min-w-0">
          {todaySession.source === 'auto' ? (
            <Panel
              className="flex-1"
              title="Hoy toca"
              sub={todayWorkout.day}
              link={<DetailLink onClick={() => onNavigate('planner')}>Planificador</DetailLink>}
            >
              <p className={`${DISPLAY} text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50`}>
                {todayWorkout.recovery ? 'Trote regenerativo' : suggested.source === 'coach' ? 'Sesión del coach' : 'Rodaje base'}
                <span className="ml-2 align-middle text-xs font-semibold text-slate-400">{suggested.badge}</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">{suggested.note}</p>

              <dl className="grid grid-cols-3 gap-3 mt-4">
                {[
                  { label: 'Distancia', value: suggested.distance },
                  { label: 'Ritmo', value: suggested.pace },
                  { label: 'Pulso', value: suggested.hr },
                ].map(m => (
                  <div key={m.label} className="min-w-0">
                    <dt className="text-xs text-slate-400">{m.label}</dt>
                    <dd className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 truncate">{m.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5">
                {suggested.segments.length > 0 ? (
                  <WorkoutProfile segments={suggested.segments} />
                ) : (
                  <p className="h-28 rounded border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs text-slate-400 px-3 text-center">
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
                <span className="text-xs text-slate-400">
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
              action={<DetailLink onClick={() => onNavigate('planner')}>Planificador</DetailLink>}
            />
          )}
        </div>

        {/* ═══════════ LECTURA DEL COACH ═══════════ */}
        <Panel
          className="lg:col-span-7"
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
                className={`-mb-px px-3 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${coachTab === tb.id
                  ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
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
          <div className={`relative ${coachLong && !coachExpanded ? 'max-h-52 overflow-hidden' : ''}`}>
              <CoachText
                ai={ai}
                text={activeCoachTab.text}
                accent={activeCoachTab.accent}
                fallback={activeCoachTab.id === 'cur' ? diagFallback : (
                  <p className="text-sm text-slate-400">El coach aún no ha hecho este análisis. Pulsa «Recalcular» para pedirlo.</p>
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
                className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 cursor-pointer"
              >
                {coachExpanded ? 'Mostrar menos' : 'Leer completo'}
              </button>
            )}
          </div>
        </Panel>

        {/* Última carrera: recorrido, cifras, ritmo por km y lectura del coach */}
        <Panel
          className="lg:col-span-12"
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
            <p className="py-6 text-sm text-slate-400">Aún no hay carreras sincronizadas.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <button
                type="button"
                onClick={() => onNavigate(`activity/${lastRun.id}`)}
                className="lg:col-span-3 cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-blue-500"
                title="Abrir la sesión"
              >
                <RouteShape encoded={lastRun.polyline} className="w-full aspect-[4/3] lg:aspect-square max-h-64" />
              </button>

              <div className="lg:col-span-5 flex flex-col gap-4 min-w-0">
                <div className="min-w-0">
                  <p className={`${DISPLAY} text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 truncate`}>{lastRun.name}</p>
                  <p className="text-xs text-slate-400 first-letter:uppercase">
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
                    { label: 'Cadencia', value: lastRun.cadence ?? DASH, unit: lastRun.cadence != null ? 'spm' : null },
                  ].map(m => (
                    <div key={m.label} className="min-w-0">
                      <dt className="text-xs text-slate-400">{m.label}</dt>
                      <dd className="flex items-baseline gap-1 min-w-0">
                        {m.dot && <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ background: m.dot }} />}
                        <span className={`${DISPLAY} text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-50`}>{m.value}</span>
                        {m.unit && <span className="text-xs text-slate-400 truncate">{m.unit}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>

                {lastRun.splits.length > 1 && (() => {
                  const speeds = lastRun.splits.map(sp => sp.speed);
                  const lo = Math.min(...speeds), hi = Math.max(...speeds), span = hi - lo || 1;
                  return (
                    <div>
                      <p className="text-xs text-slate-400 mb-1.5">Ritmo por kilómetro (más alto, más rápido; color por zona de FC)</p>
                      <div className="flex items-end gap-1 h-16">
                        {lastRun.splits.map((sp, i) => (
                          <div
                            key={i}
                            className="flex-1 min-w-[3px] rounded"
                            style={{ height: `${30 + ((sp.speed - lo) / span) * 70}%`, background: sp.zoneIdx >= 0 ? ZONES[sp.zoneIdx].color : '#60a5fa' }}
                            title={`Km ${i + 1}: ${formatPaceFromSpeed(sp.speed, DASH)}/km${sp.hr ? `, ${sp.hr} ppm` : ''}`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="lg:col-span-4 flex flex-col gap-2 min-w-0 pt-4 lg:pt-0 lg:pl-6 border-t lg:border-t-0 lg:border-l border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cómo la ejecutaste</span>
                  <AskChatBtn onAsk={askCoach} focus="briefing" />
                </div>
                {lastActivity && lastActivity.id !== lastRun.id && ai.lastWork && (
                  <p className="text-xs text-slate-400">El análisis del coach es de tu última actividad, «{lastActivity.name}».</p>
                )}
                <div className="max-h-64 overflow-y-auto pr-1">
                  <CoachText
                    ai={ai}
                    text={ai.lastWork}
                    accent="text-amber-500"
                    fallback={<p className="text-sm text-slate-400">El coach aún no ha analizado esta sesión. Pulsa «Recalcular» para pedirlo.</p>}
                  />
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>

    </div>
  );
}
