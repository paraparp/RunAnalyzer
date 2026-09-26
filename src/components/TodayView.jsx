import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import cloudStorage from '../lib/cloudStorage';
import {
  TrophyIcon,
  FireIcon,
  ArrowTrendingUpIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  BoltIcon,
  CalendarDaysIcon,
  HeartIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { OVERRIDES_EVENT } from '../lib/hrOverrides';
import useCalibratedPMC from '../hooks/useCalibratedPMC';
import useGarminWearableData from '../hooks/useGarminWearableData';
import { computeStats, computeGarminStats, loadPhase, isRun, paceStr, fmt1 } from '../lib/statusStats';
import { computeReadiness } from '../lib/athleteContext';
import { getPrimaryTargetRace, daysUntil, formatMinutes, TARGET_RACES_EVENT } from '../lib/targetRaces';
import { DISTANCE_KM } from '../lib/raceDistances';
import { karvonenBounds, classifyHR, POLARIZED_TARGETS } from '../lib/hrZones';
import { zoneMix, polarizedGroups, polarizationStatus } from '../lib/zoneMix';
import { shoeLifeKm } from '../lib/shoeLife';
import { weeklyVolumeRamp } from '../lib/weeklyVolume';
import { weekStartKey } from '../lib/isoWeek';
import { formatPaceFromSpeed, formatPaceFromSecPerKm, formatMinutesHm } from '../lib/timeFormat';
import AIInsights from './AIInsights';
import PersonalBests from './PersonalBests';

// ─────────────────────────────────────────────────────────────────────────────
// Hoy. La portada contesta "¿cómo voy y qué hago?": carrera objetivo, KPIs
// globales, estado fisiológico, la prescripción del día, el reparto por zonas y
// las marcas.
//
// TODO lo que se pinta aquí sale de los mismos módulos de cálculo que usan el
// resto de vistas y el coach IA (`statusStats`, `athleteContext`, `zoneMix`,
// `gap`, `shoeLife`, `weeklyVolume`). Cuando un dato no está, se pinta `—`: un
// número de relleno en la portada es peor que un hueco, porque el atleta no
// puede distinguirlo de una medida real.
// ─────────────────────────────────────────────────────────────────────────────

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const DASH = '—';
const COUNTDOWN_ARC_DAYS = 120;       // el arco de la cuenta atrás se llena a 120 días
const ARC_LEN_HERO = 263.89;          // 2πr con r=42
const ARC_LEN_READY = 314.15;         // 2πr con r=50

const fmtNum = (v, d = 1) => (v == null || !Number.isFinite(v) ? DASH : Number(v).toFixed(d));

// Zonas de Karvonen con los colores de la vista de Zonas: el mismo reparto no
// puede cambiar de pinta según dónde se mire.
const ZONES = [
  { name: 'Z1', role: 'Recuperación', color: '#94a3b8' },
  { name: 'Z2', role: 'Base',         color: '#38bdf8' },
  { name: 'Z3', role: 'Aeróbico',     color: '#4ade80' },
  { name: 'Z4', role: 'Umbral',       color: '#fb923c' },
  { name: 'Z5', role: 'VO2max',       color: '#f87171' },
];

// Lectura polarizada: Z1+Z2 fácil · Z3 gris · Z4+Z5 duro (lib/zoneMix).
const GROUPS = [
  { key: 'low',  label: 'Fácil', sub: 'Z1–Z2', color: '#4ade80', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'mod',  label: 'Gris',  sub: 'Z3',    color: '#fbbf24', text: 'text-amber-600 dark:text-amber-400'     },
  { key: 'high', label: 'Duro',  sub: 'Z4–Z5', color: '#f87171', text: 'text-rose-600 dark:text-rose-400'       },
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

// ── Átomos del briefing (el diseño de la portada, el contenido de StatusHero) ──

const COLOR_CLS = {
  emerald: { icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400', stroke: '#10b981' },
  blue:    { icon: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',             stroke: '#3b82f6' },
  amber:   { icon: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',         stroke: '#f59e0b' },
  rose:    { icon: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',             stroke: '#f43f5e' },
};

function HeroCard({ label, value, unit, icon: Icon, color = 'blue', trendDelta, spark, subRows = [] }) {
  const c = COLOR_CLS[color] ?? COLOR_CLS.blue;
  const path = spark ? sparkPath(spark) : null;
  return (
    <div className="flex flex-col p-4 rounded-xl border border-slate-200/80 bg-white shadow-sm hover:shadow-md transition-shadow dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</span>
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${c.icon}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-black text-slate-900 dark:text-slate-50 tabular-nums">{value}</span>
        {unit && <span className="text-xs text-slate-400 font-semibold">{unit}</span>}
        {trendDelta != null && Number.isFinite(trendDelta) && (
          <span className={`ml-auto text-[10px] font-bold ${trendDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {trendDelta >= 0 ? '+' : ''}{trendDelta.toFixed(1)} 7d
          </span>
        )}
      </div>

      {path && (
        <svg className="w-full h-6 mt-1" preserveAspectRatio="none" viewBox="0 0 100 24">
          <path d={path} fill="none" stroke={c.stroke} strokeLinecap="round" strokeWidth="2" />
        </svg>
      )}

      <dl className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
        {subRows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2">
            <dt className="text-[10px] text-slate-400 truncate">{r.label}</dt>
            <dd className="text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// % respecto al pico histórico. `lowerIsBetter` para ritmos y eficiencia, donde
// el número pequeño es el bueno.
function PctPill({ now, best, lowerIsBetter = false }) {
  if (!best || !now) return <span className="text-slate-300 dark:text-slate-600 text-xs">{DASH}</span>;
  const pct = Math.min(lowerIsBetter ? (best / now) * 100 : (now / best) * 100, 100);
  const cls = pct >= 80 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
    : pct >= 50 ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300';
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{Math.round(pct)}%</span>;
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

function RowSparkline({ data, color = '#3b82f6' }) {
  const path = sparkPath((data || []).map(d => d.v));
  if (!path) return <span className="text-slate-300 dark:text-slate-600 text-xs">{DASH}</span>;
  return (
    <svg className="w-16 h-5" preserveAspectRatio="none" viewBox="0 0 100 24">
      <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeWidth="2.5" />
    </svg>
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

  // Escala COMPARTIDA por fitness y fatiga: el propio techo del atleta. Si la
  // fatiga de hoy lo supera, la escala crece con ella para que la barra no
  // mienta saturándose al 100 %.
  const pmcCurrent = pmc?.current ?? null;
  const loadScale = pmcCurrent ? Math.max(pmcCurrent.peak, pmcCurrent.ctl, pmcCurrent.atl, 1) : 1;

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

  // ── 7. Reparto por zonas de los últimos 28 días ───────────────────────────
  const zoneDistribution = useMemo(() => {
    if (!bounds) return { hasData: false, bounds: null, pct: [], groups: null, verdictKey: null };
    const mix = zoneMix(runs, bounds, { days: 28, now: nowMs });
    if (!mix.hasData) return { hasData: false, bounds, pct: [], groups: null, verdictKey: null };
    const groups = polarizedGroups(mix.pct);
    const verdictKey = polarizationStatus(groups.low, groups.mod, groups.high);
    return {
      hasData: true,
      bounds,
      pct: mix.pct.map(p => Math.round(p)),
      times: mix.times,
      totalSec: mix.totalSec,
      groups,
      verdictKey,
      avgOnlySessions: mix.avgOnlySessions,
      sessions: mix.sessions,
    };
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

    // Día de descarga cuando la readiness o la forma lo piden.
    const recovery = (readiness?.score != null && readiness.score < 50)
      || (currentTSB != null && currentTSB < -15);

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
      cycleLabel: phase ? `Fase: ${phase.label}` : 'Fase sin determinar',
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
        cadence,
        // RPE estimado SOLO cuando hay zona real que lo sostenga.
        rpe: zoneIdx < 0 ? null : zoneIdx >= 3 ? 'RPE 8 / 10' : zoneIdx === 2 ? 'RPE 6 / 10' : 'RPE 4 / 10',
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

  const compareRows = useMemo(() => {
    if (!stats || !briefing) return [];
    const s = stats;
    const g = garminStats;
    return [
      { label: 'Fitness (CTL)', now: fmt1(s.currentCTL), nowRaw: s.currentCTL,
        bestYear: fmt1(s.peakCTLYear), bestAll: fmt1(s.peakCTL), bestAllRaw: s.peakCTL,
        spark: briefing.ctlSpark, sparkColor: '#3b82f6' },
      { label: 'Fatiga (ATL)', now: fmt1(s.currentATL), noCompare: true,
        bestYear: DASH, bestAll: DASH, spark: briefing.atlSpark, sparkColor: '#f97316' },
      { label: 'Forma (TSB)', now: fmt1(s.currentTSB), noCompare: true,
        bestYear: DASH, bestAll: DASH, spark: briefing.tsbSpark, sparkColor: '#8b5cf6' },
      { label: 'Km (última semana)', now: `${s.last7daysKm.toFixed(1)} km`, nowRaw: s.last7daysKm,
        bestYear: `${s.peakWeekKmYear.toFixed(1)} km`, bestAll: `${s.peakWeekKm.toFixed(1)} km`, bestAllRaw: s.peakWeekKm,
        spark: briefing.volSpark, sparkColor: '#10b981' },
      { label: 'Desnivel mensual', now: `${Math.round(s.elevLast28)} m`, nowRaw: s.elevLast28,
        bestYear: `${Math.round(s.avgMonthlyElevYear)} m`, bestAll: `${Math.round(s.peakMonthlyElev)} m`, bestAllRaw: s.peakMonthlyElev },
      { label: 'Consistencia (28d)', now: `${s.activeLast28} días`, nowRaw: s.activeLast28,
        bestYear: '28 días', bestAll: '28 días', bestAllRaw: 28 },
      { label: 'Mejor ritmo 10k', now: paceStr(s.bestPace10kRecent), nowRaw: s.bestPace10kRecent,
        bestYear: paceStr(s.bestPace10kYear), bestAll: paceStr(s.bestPace10kAll), bestAllRaw: s.bestPace10kAll,
        lowerIsBetter: false },
      { label: 'Eficiencia aeróbica', now: s.hrEffRecent ? s.hrEffRecent.toFixed(2) : DASH, nowRaw: s.hrEffRecent,
        bestYear: s.hrEffYear ? s.hrEffYear.toFixed(2) : DASH,
        bestAll: s.hrEffAll ? s.hrEffAll.toFixed(2) : DASH, bestAllRaw: s.hrEffAll,
        lowerIsBetter: true },
      ...(g ? [
        { label: 'FC Reposo', now: g.currentRHR ? `${g.currentRHR} bpm` : DASH, nowRaw: g.currentRHR,
          bestYear: g.rhrYearMin ? `${g.rhrYearMin} bpm` : DASH,
          bestAll: g.rhrAllTimeMin ? `${g.rhrAllTimeMin} bpm` : DASH, bestAllRaw: g.rhrAllTimeMin,
          spark: g.rhrSparkData, sparkColor: '#ef4444', lowerIsBetter: true },
        { label: g.hasHRV ? 'VFC (HRV)' : 'Body Battery',
          now: g.currentRec != null ? `${fmtNum(g.currentRec, 0)}${g.hasHRV ? ' ms' : '/100'}` : DASH, nowRaw: g.currentRec,
          bestYear: g.recYearMax != null ? fmtNum(g.recYearMax, 0) : DASH,
          bestAll: g.recAllTimeMax != null ? fmtNum(g.recAllTimeMax, 0) : DASH, bestAllRaw: g.recAllTimeMax,
          spark: g.recSparkData, sparkColor: '#8b5cf6' },
      ] : []),
    ];
  }, [stats, briefing, garminStats]);

  const [compareOpen, setCompareOpen] = useState(false);

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
        blocks: {
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

  const dashOffset = raceDays != null
    ? ARC_LEN_HERO * (1 - Math.min(Math.max(raceDays, 0), COUNTDOWN_ARC_DAYS) / COUNTDOWN_ARC_DAYS)
    : ARC_LEN_HERO;

  return (
    <div className="fade-in space-y-6 max-w-[1520px] mx-auto">

      {/* ── SECCIÓN SUPERIOR: HERO DE CARRERA OBJETIVO ─────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-indigo-600 to-indigo-800 text-white shadow-xl shadow-indigo-900/10 p-6 sm:p-8">
        {/* Resplandores ambientales y partículas sutiles */}
        <div className="absolute -right-16 -top-24 w-96 h-96 rounded-full bg-cyan-400/20 blur-3xl pointer-events-none" />
        <div className="absolute right-1/3 -bottom-20 w-80 h-80 rounded-full bg-indigo-300/15 blur-2xl pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_60%)] pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Columna Izquierda: Información de Carrera */}
          <div className="flex flex-col gap-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-white text-xs font-bold tracking-wider uppercase flex items-center gap-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse" />
                {targetRace ? t('targets.next_race') : t('targets.no_target', 'Sin objetivo fijado')}
              </span>
              {phase && (
                <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-xs text-blue-100 font-medium">
                  Fase: {phase.label} ({phase.description})
                </span>
              )}
            </div>

            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white leading-tight">
                {targetRace ? targetRace.name : 'Fija tu carrera objetivo'}
              </h1>
              <p className="mt-1 text-sm sm:text-base text-blue-100/90 font-medium">
                {targetRace
                  ? [targetRace.location, targetRace.distance ? t(`planner.distances.${targetRace.distance}`) : null,
                     raceDistanceKm != null ? `${raceDistanceKm} km` : null].filter(Boolean).join(' • ')
                  : 'Sin carrera objetivo no hay cuenta atrás, ni ritmo meta, ni plan al que apuntar.'}
              </p>
            </div>

            {/* Píldoras de detalles de carrera */}
            {targetRace && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2">
                <div className="flex flex-col px-3.5 py-2 rounded-xl bg-white/10 backdrop-blur-sm">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-200">Fecha &amp; Hora</span>
                  <span className="text-xs font-bold text-white mt-0.5">
                    {targetRace.date
                      ? new Date(targetRace.date + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })
                      : DASH}
                    {targetRace.startTime ? ` • ${targetRace.startTime}` : ''}
                  </span>
                </div>
                <div className="flex flex-col px-3.5 py-2 rounded-xl bg-white/10 backdrop-blur-sm">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-200">Ritmo Objetivo</span>
                  <span className="text-xs font-bold text-cyan-300 mt-0.5">
                    {raceGoalPace} <span className="text-[10px] font-normal text-blue-100">/km</span>
                  </span>
                </div>
                <div className="flex flex-col px-3.5 py-2 rounded-xl bg-white/10 backdrop-blur-sm col-span-2 sm:col-span-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-200">{t('targets.goal_time')}</span>
                  <span className="text-xs font-bold text-emerald-300 mt-0.5">{raceGoalTime}</span>
                </div>
              </div>
            )}
          </div>

          {/* Columna Derecha: Cuenta Atrás Radial y Botón Maestro */}
          <div className="flex items-center gap-4 bg-white/10 backdrop-blur-xl p-4 rounded-2xl self-start lg:self-center shadow-lg border border-white/10">
            <div className="relative flex items-center justify-center w-24 h-24 shrink-0">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" fill="transparent" r="42" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="7" />
                <circle
                  className="transition-all duration-1000"
                  cx="50"
                  cy="50"
                  fill="transparent"
                  r="42"
                  stroke="#00e3fd"
                  strokeDasharray={ARC_LEN_HERO}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  strokeWidth="7"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-black leading-none text-white">
                  {raceDays === 0 ? t('targets.today') : raceDays ?? DASH}
                </span>
                {raceDays !== 0 && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-blue-200 mt-0.5">
                    {t('targets.days_unit')}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div>
                <span className="text-xs font-bold text-cyan-300 block">
                  {raceWeeks != null ? `${raceWeeks} SEMANAS RESTANTES` : 'SIN CUENTA ATRÁS'}
                </span>
                <span className="text-xs text-white/90 font-medium">
                  {/* Pico real del histórico, no una fracción inventada del total. */}
                  Semana pico: {stats?.peakWeekKm ? `${Math.round(stats.peakWeekKm)} km` : DASH}
                </span>
              </div>
              <button
                type="button"
                onClick={() => targetRace ? onNavigate(`targets/${targetRace.id}`) : onNavigate('targets')}
                className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white text-slate-900 text-xs font-bold shadow-md hover:bg-blue-50 transition-all cursor-pointer"
              >
                <span>{targetRace ? t('targets.open_plan') : t('targets.manage', 'Fijar objetivo')}</span>
                <ArrowRightIcon className="w-3.5 h-3.5 text-indigo-600" />
              </button>
            </div>
          </div>
        </div>
      </div>


      {/* ── BRIEFING DE HOY: LOS CUATRO NÚMEROS DE "¿CÓMO VOY?" ───────────── */}
      {stats && briefing && (
        <div className="space-y-3">
        <div className="flex items-center gap-2.5 px-0.5">
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-slate-200 shrink-0">
            Briefing de hoy
          </span>
          <span className="flex-1 h-px bg-slate-200/80 dark:bg-slate-800" />
          <AskChatBtn onAsk={askCoach} focus="briefing" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <HeroCard
            label="Fitness (CTL)"
            value={fmt1(stats.currentCTL)}
            icon={ArrowTrendingUpIcon}
            color={stats.peakCTL > 0 && stats.currentCTL / stats.peakCTL >= 0.8 ? 'emerald'
              : stats.peakCTL > 0 && stats.currentCTL / stats.peakCTL >= 0.5 ? 'blue' : 'amber'}
            trendDelta={stats.currentCTL - stats.ctl7ago}
            spark={briefing.ctlSpark}
            subRows={[
              { label: 'Pico histórico', value: `${fmt1(stats.peakCTL)} (${stats.peakCTL > 0 ? Math.round((stats.currentCTL / stats.peakCTL) * 100) : 0}%)` },
              { label: 'Pico este año', value: fmt1(stats.peakCTLYear) },
              { label: 'Tendencia 28d', value: `${stats.currentCTL - stats.ctl28ago >= 0 ? '+' : ''}${fmt1(stats.currentCTL - stats.ctl28ago)}` },
            ]}
          />
          <HeroCard
            label="Forma (TSB)"
            value={fmt1(stats.currentTSB)}
            icon={BoltIcon}
            color={stats.currentTSB > 5 ? 'emerald' : stats.currentTSB > -5 ? 'amber' : 'rose'}
            spark={briefing.tsbSpark}
            subRows={[
              { label: 'Fatiga actual (ATL)', value: fmt1(stats.currentATL) },
              { label: 'ACWR', value: stats.currentACWR != null ? stats.currentACWR.toFixed(2) : DASH },
              { label: 'Días activos (7d)', value: `${stats.activeLast7} / 7` },
            ]}
          />
          <HeroCard
            label="Volumen semanal"
            value={stats.last7daysKm.toFixed(1)}
            unit="km"
            icon={CalendarDaysIcon}
            color="blue"
            spark={briefing.volSpark}
            subRows={[
              { label: 'Media semanal año', value: `${stats.avgWeekKmYear.toFixed(1)} km` },
              { label: 'Semana pico año', value: `${stats.peakWeekKmYear.toFixed(1)} km` },
              { label: 'Semana pico total', value: `${stats.peakWeekKm.toFixed(1)} km` },
            ]}
          />
          <HeroCard
            label="Mejor ritmo reciente"
            value={paceStr(stats.bestPace10kRecent) !== DASH ? paceStr(stats.bestPace10kRecent) : paceStr(stats.bestPace5kRecent)}
            unit={paceStr(stats.bestPace10kRecent) !== DASH ? '/km 10k' : '/km 5k'}
            icon={FireIcon}
            color="amber"
            subRows={[
              { label: 'PB 10k este año', value: paceStr(stats.bestPace10kYear) },
              { label: 'PB 10k histórico', value: paceStr(stats.bestPace10kAll) },
              { label: 'Racha actual', value: `${stats.streak} días` },
            ]}
          />
        </div>
        </div>
      )}

      {/* ── MÓDULO 01: ESTADO FISIOLÓGICO & READINESS HUD ─────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-5">
        {/* Cabecera del Módulo */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <span className="material-symbols-outlined text-[22px]">vital_signs</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
                  Estado Fisiológico &amp; Readiness
                </h2>
                {activeAiModel && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Coach IA • {activeAiModel}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {/* Qué fuentes hay REALMENTE detrás del score, no una frase fija. */}
                {[
                  wearables.hrv ? 'VFC Garmin' : null,
                  wearables.rhr ? 'FC reposo' : null,
                  wearables.bb ? 'Body Battery' : null,
                  wearables.sleep ? 'sueño' : null,
                  currentTSB != null ? 'TSB' : null,
                ].filter(Boolean).join(' · ') || 'Sin telemetría sincronizada'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {recalcAt && !busy && (
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                Actualizado {new Date(recalcAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              type="button"
              onClick={recalculate}
              disabled={busy}
              title="Sincronizar Strava y Garmin y recalcular todas las métricas"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-white shadow-sm transition-colors cursor-pointer"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              <span>{busy ? 'Recalculando…' : 'Recalcular'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('calibration')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
            >
              <span>Calibrar</span>
            </button>
          </div>
        </div>

        {/* Layout: Indicador Radial + Diagnóstico Autonómico */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          {/* Indicador Radial de Readiness (4 cols) */}
          <div className="lg:col-span-4 p-5 rounded-2xl bg-gradient-to-b from-slate-50 to-indigo-50/30 dark:from-slate-800/40 dark:to-indigo-950/20 border border-slate-100 dark:border-slate-800 flex flex-col items-center text-center justify-center gap-2">
            <div className="relative w-44 h-44 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" fill="transparent" r="50" stroke="rgba(148, 163, 184, 0.15)" strokeWidth="10" />
                <circle
                  className="transition-all duration-1000"
                  cx="60"
                  cy="60"
                  fill="transparent"
                  r="50"
                  stroke="#2563eb"
                  strokeDasharray={ARC_LEN_READY}
                  strokeDashoffset={ARC_LEN_READY * (1 - (readiness?.score ?? 0) / 100)}
                  strokeLinecap="round"
                  strokeWidth="10"
                />
                <circle cx="60" cy="60" fill="transparent" r="38" stroke="rgba(0, 227, 253, 0.3)" strokeDasharray="4 4" strokeWidth="2" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black text-slate-900 dark:text-slate-50 leading-none">
                  {readiness?.score ?? DASH}
                </span>
                <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase mt-1">/ 100 READY</span>
              </div>
            </div>

            <div className="flex flex-col items-center gap-1">
              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                readiness == null ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                : readiness.score >= 80 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : readiness.score >= 62 ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
              }`}>
                {readiness?.label ?? 'Sin datos suficientes'}
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[260px] leading-relaxed">
                {readiness == null
                  ? 'Sincroniza Garmin o acumula historial para obtener un score de readiness.'
                  : `Score determinista sobre ${[
                      wearables.hrv && 'VFC', wearables.bb && 'Body Battery', wearables.sleep && 'sueño',
                      wearables.rhr && 'FC reposo', currentTSB != null && 'TSB',
                    ].filter(Boolean).length} señales.`}
              </p>
            </div>
          </div>

          {/* Diagnóstico Autonómico (8 cols) — construido con las cifras reales */}
          <div className="lg:col-span-8 p-5 rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[20px]">psychology</span>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Diagnóstico Autonómico
                </h3>
                <AskChatBtn onAsk={askCoach} focus="readiness" />
              </div>
              <div className="flex items-center gap-2">
                {garminStats?.lastDate && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    Último dato: {garminStats.lastDate}
                  </span>
                )}
                {onOpenChat && (
                  <button
                    type="button"
                    onClick={onOpenChat}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
                  >
                    Preguntar al coach
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {readiness == null
                ? 'Sin telemetría de wearable no se puede leer el estado autonómico. Sincroniza Garmin para activar este diagnóstico.'
                : `${readiness.label}. ${
                    hrvDeltaPct != null
                      ? `La VFC de los últimos 7 días está un ${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct}% respecto a tu baseline de 60 días.`
                      : 'Sin baseline de VFC suficiente para medir desviación.'
                  }${
                    currentTSB != null ? ` El TSB de ${currentTSB} sitúa la forma en fase "${phase?.label ?? DASH}".` : ''
                  }`}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="p-3 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700 flex items-start gap-2.5 shadow-xs">
                <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-[10px] font-black shrink-0">
                  01
                </span>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">VFC Nocturna vs Baseline</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {garminStats?.currentRec != null
                      ? `${fmtNum(garminStats.currentRec, 0)} ${garminStats.hasHRV ? 'ms' : 'pts'} vs media 60d de ${fmtNum(garminStats.rec60avg, 0)}${hrvDeltaPct != null ? ` (${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct}%)` : ''}.`
                      : 'Sin datos de VFC sincronizados.'}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700 flex items-start gap-2.5 shadow-xs">
                <span className="px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300 text-[10px] font-black shrink-0">
                  02
                </span>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Balance de Carga (TSB)</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {currentTSB != null
                      ? `TSB ${currentTSB} pts · CTL ${currentCTL} · ATL ${currentATL}. ${phase?.description ?? ''}`
                      : 'Sin PMC calculado todavía.'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fila de 5 Mini-Tarjetas Biométricas */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-1">
          {/* VFC Card */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">VFC (HRV)</span>
              <span className={`w-2 h-2 rounded-full ${wearables.hrv ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-black text-slate-900 dark:text-slate-50">
                  {wearables.hrv?.latest != null ? Math.round(wearables.hrv.latest) : DASH}
                </span>
                <span className="text-xs text-slate-400 font-semibold">ms</span>
              </div>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                {wearables.hrv?.status
                  ? wearables.hrv.status
                  : hrvDeltaPct != null ? `${hrvDeltaPct >= 0 ? '+' : ''}${hrvDeltaPct}% vs baseline` : 'Sin baseline'}
              </span>
            </div>
            <div className="h-5 w-full pt-1">
              {wearables.hrvSpark && (
                <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 24">
                  <path d={wearables.hrvSpark} fill="none" stroke="#10b981" strokeLinecap="round" strokeWidth="2.5" />
                </svg>
              )}
            </div>
          </div>

          {/* Body Battery Card */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Body Battery</span>
              <span className={`w-2 h-2 rounded-full ${wearables.bb ? 'bg-cyan-500' : 'bg-slate-300'}`} />
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-black text-slate-900 dark:text-slate-50">{wearables.bb?.high ?? DASH}</span>
                <span className="text-xs text-slate-400 font-semibold">/ 100</span>
              </div>
              <span className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400">
                {wearables.bb?.high != null && wearables.bb?.low != null
                  ? `+${wearables.bb.high - wearables.bb.low} recargado`
                  : 'Sin recarga registrada'}
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
              <div className="bg-cyan-500 h-full rounded-full" style={{ width: `${wearables.bb?.high ?? 0}%` }} />
            </div>
          </div>

          {/* Sueño Card */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Calidad Sueño</span>
              <span className={`w-2 h-2 rounded-full ${wearables.sleep ? 'bg-blue-500' : 'bg-slate-300'}`} />
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-black text-slate-900 dark:text-slate-50">{wearables.sleep?.score ?? DASH}</span>
                <span className="text-xs text-slate-400 font-semibold">/ 100</span>
              </div>
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">
                {wearables.sleep?.durationMin
                  ? `${formatMinutesHm(wearables.sleep.durationMin, DASH)}${wearables.sleep.deepMin ? ` • Profundo ${formatMinutesHm(wearables.sleep.deepMin, DASH)}` : ''}`
                  : 'Sin registro de sueño'}
              </span>
            </div>
            <div className="h-5 w-full pt-1">
              {wearables.sleepSpark && (
                <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 24">
                  <path d={wearables.sleepSpark} fill="none" stroke="#3b82f6" strokeLinecap="round" strokeWidth="2.5" />
                </svg>
              )}
            </div>
          </div>

          {/* TSB Card */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">TSB (Estrés Bal.)</span>
              <span className={`w-2 h-2 rounded-full ${currentTSB != null ? 'bg-amber-500' : 'bg-slate-300'}`} />
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-black text-slate-900 dark:text-slate-50 tabular-nums">{currentTSB ?? DASH}</span>
                <span className="text-xs text-slate-400 font-semibold">pts</span>
              </div>
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">{phase?.label ?? 'Sin PMC'}</span>
            </div>
            {/* Barra bipolar: el ancho es |TSB| sobre una escala de ±30 pts. */}
            <div className="relative w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-400 z-10" />
              {currentTSB != null && (
                <div
                  className={`absolute top-0 bottom-0 rounded-full ${currentTSB < 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={currentTSB < 0
                    ? { right: '50%', width: `${Math.min(50, (Math.abs(currentTSB) / 30) * 50)}%` }
                    : { left: '50%', width: `${Math.min(50, (currentTSB / 30) * 50)}%` }}
                />
              )}
            </div>
          </div>

          {/* ACWR Card */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col justify-between gap-2 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ratio ACWR</span>
              <span className={`w-2 h-2 rounded-full ${currentACWR != null ? 'bg-cyan-500' : 'bg-slate-300'}`} />
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-black text-slate-900 dark:text-slate-50 tabular-nums">{currentACWR ?? DASH}</span>
                <span className="text-xs text-slate-400 font-semibold">índice</span>
              </div>
              <span className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400">
                {currentACWR == null ? 'Sin PMC'
                  : currentACWR >= 0.8 && currentACWR <= 1.3 ? 'Sweet Spot (0.8 – 1.3)'
                  : currentACWR > 1.3 ? 'Por encima del sweet spot' : 'Por debajo del sweet spot'}
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
              <div className="bg-cyan-500 h-full rounded-full" style={{ width: `${Math.min(100, Math.round(((currentACWR ?? 0) / 1.6) * 100))}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── REJILLA ASIMÉTRICA: MÓDULO 02 & MÓDULO 03 (7 COLS + 5 COLS) ────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* MÓDULO 02: PRESCRIPCIÓN TÁCTICA PARA HOY (7 cols) */}
        <div className="lg:col-span-7 flex flex-col justify-between gap-4 p-5 sm:p-6 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">fitness_center</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Sesión Sugerida para Hoy
                  </h3>
                  <span className="block text-xs text-slate-400">
                    {todayWorkout.day} • {todayWorkout.cycleLabel}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <AskChatBtn onAsk={askCoach} focus="workout" />
                <span className="px-3 py-1 rounded-full bg-cyan-50 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300 text-xs font-bold">
                  {todayWorkout.zonesLabel}
                </span>
              </div>
            </div>

            {/* Cinta de Objetivos */}
            <div className="grid grid-cols-3 gap-2 mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-center border border-slate-100 dark:border-slate-800">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Distancia</span>
                <span className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">{todayWorkout.targetDistance}</span>
              </div>
              <div className="flex flex-col border-x border-slate-200 dark:border-slate-700">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ritmo Objetivo</span>
                <span className="text-sm sm:text-base font-black text-blue-600 dark:text-blue-400">{todayWorkout.targetPace}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">FC Objetivo</span>
                <span className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">{todayWorkout.targetHr}</span>
              </div>
            </div>

            {/* Cronograma Visual de la Sesión */}
            <div className="flex flex-col gap-2 mt-4">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span>
                  Estructura de la Sesión
                  {todayWorkout.structure.totalMin != null ? ` (${todayWorkout.structure.totalMin} MIN TOTAL)` : ''}
                </span>
                <span className="text-cyan-600 dark:text-cyan-400 font-bold">
                  {todayWorkout.sampleSize > 0
                    ? `Calibrado con ${todayWorkout.sampleSize} rodajes`
                    : 'Sin rodajes de referencia'}
                </span>
              </div>

              {/* Barra segmentada: los anchos son la proporción REAL de cada bloque */}
              {todayWorkout.structure.totalMin != null ? (
                <>
                  <div className="h-12 w-full rounded-xl overflow-hidden flex shadow-inner border border-slate-200/60 dark:border-slate-700">
                    <div
                      className="h-full bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200 flex flex-col items-center justify-center px-2"
                      style={{ width: `${(todayWorkout.structure.warmMin / todayWorkout.structure.totalMin) * 100}%` }}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider leading-none">WARMUP</span>
                      <span className="text-[10px] font-medium opacity-80">{todayWorkout.structure.warmup}</span>
                    </div>
                    <div
                      className="h-full bg-blue-600 text-white flex flex-col items-center justify-center px-3 text-center"
                      style={{ width: `${(todayWorkout.structure.mainMin / todayWorkout.structure.totalMin) * 100}%` }}
                    >
                      <span className="text-xs font-bold leading-none">
                        {todayWorkout.recovery ? 'TROTE REGENERATIVO' : 'RODAJE BASE CONTROLADO'}
                      </span>
                      <span className="text-[10px] font-medium text-blue-100 truncate max-w-full">{todayWorkout.structure.main}</span>
                    </div>
                    <div
                      className="h-full bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 flex flex-col items-center justify-center px-2"
                      style={{ width: `${(todayWorkout.structure.coolMin / todayWorkout.structure.totalMin) * 100}%` }}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider leading-none">COOL</span>
                      <span className="text-[10px] font-medium opacity-80">{todayWorkout.structure.cool}</span>
                    </div>
                  </div>

                  {/* Marcas de tiempo derivadas de la propia estructura */}
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 px-1">
                    <span>00:00</span>
                    <span>{String(todayWorkout.structure.warmMin).padStart(2, '0')}:00</span>
                    <span>{String(todayWorkout.structure.warmMin + todayWorkout.structure.mainMin).padStart(2, '0')}:00</span>
                    <span>{todayWorkout.structure.totalMin}:00 Min</span>
                  </div>
                </>
              ) : (
                <div className="h-12 w-full rounded-xl border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs text-slate-400">
                  Sin rodajes recientes para calibrar la sesión
                </div>
              )}
            </div>

            {/* Nota Táctica */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-start gap-3">
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[20px] shrink-0 mt-0.5">tips_and_updates</span>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Instrucción Táctica de Carrera</span>
                <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed italic">
                  "{todayWorkout.tacticalQuote}"
                </p>
              </div>
            </div>
          </div>

          {/* Acciones de sincronización */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Listo para sincronizar al reloj
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('planner')}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">send_to_mobile</span>
              <span>Abrir en Planificador</span>
            </button>
          </div>
        </div>

        {/* MÓDULO 03: DISTRIBUCIÓN & CARGA (5 cols) */}
        <div className="lg:col-span-5 flex flex-col justify-between gap-4 p-5 sm:p-6 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">equalizer</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Distribución &amp; Carga
                  </h3>
                  <span className="block text-xs text-slate-400">
                    Últimos 28 días · Karvonen (HRR)
                    {hrParams?.hrmax && hrParams?.hrrest ? ` · ${hrParams.hrrest}–${hrParams.hrmax} ppm` : ''}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {zoneDistribution.hasData && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${VERDICT[zoneDistribution.verdictKey].cls}`}>
                    {VERDICT[zoneDistribution.verdictKey].label}
                  </span>
                )}
                <AskChatBtn onAsk={askCoach} focus="zones" />
                <button
                  type="button"
                  onClick={() => onNavigate('zones')}
                  className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                >
                  Zonas <ArrowRightIcon className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Barra de Distribución Polarizada */}
            <div className="flex flex-col gap-2 mt-4">
              {zoneDistribution.hasData ? (
                <>
                  <div className="flex items-end justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black leading-none text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {Math.round(zoneDistribution.groups.low)}%
                      </span>
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">fácil (Z1–Z2)</span>
                    </div>
                    <span className="text-[11px] text-slate-400 pb-0.5">objetivo ≥ {POLARIZED_TARGETS.low}%</span>
                  </div>

                  {/* Dos lecturas del mismo reparto: las cinco zonas y, debajo, su
                      agrupación polarizada. La marca vertical es el objetivo de
                      volumen fácil: el veredicto se VE, no hay que creerse la pastilla. */}
                  <div className="relative">
                    <div className="h-4 w-full rounded-lg overflow-hidden flex bg-slate-100 dark:bg-slate-800">
                      {ZONES.map((z, i) => {
                        const b = zoneDistribution.bounds[i];
                        const range = b.lo <= 0 ? `< ${b.hi + 1}` : b.hi >= 999 ? `≥ ${b.lo}` : `${b.lo}–${b.hi}`;
                        return (
                          <div
                            key={z.name}
                            className="h-full transition-all duration-300"
                            style={{ width: `${zoneDistribution.pct[i]}%`, background: z.color }}
                            title={`${z.name} ${z.role} · ${zoneDistribution.pct[i]}% · ${hoursStr(zoneDistribution.times[i])} · ${range} ppm`}
                          />
                        );
                      })}
                    </div>
                    <div className="h-1.5 mt-1 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800">
                      {GROUPS.map(g => (
                        <div
                          key={g.key}
                          style={{ width: `${zoneDistribution.groups[g.key]}%`, background: g.color }}
                          title={`${g.label} (${g.sub}) · ${zoneDistribution.groups[g.key]}%`}
                        />
                      ))}
                    </div>
                    <div
                      className="absolute -top-1 bottom-0 w-px bg-slate-800/70 dark:bg-slate-300/70"
                      style={{ left: `${POLARIZED_TARGETS.low}%` }}
                      title={`Objetivo: ${POLARIZED_TARGETS.low}% del tiempo en fácil`}
                    />
                  </div>

                  {/* Leyenda: % y HORAS por zona, con los cortes de la calibración real */}
                  <div className="grid grid-cols-5 gap-1.5 pt-1">
                    {ZONES.map((z, i) => {
                      const b = zoneDistribution.bounds[i];
                      const range = i === 0 ? `<${b.hi + 1}` : i === 4 ? `>${b.lo - 1}` : `${b.lo}–${b.hi}`;
                      return (
                        <div key={z.name} className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: z.color }} />
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate">{z.name}</span>
                          </div>
                          <div className="text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums leading-tight">
                            {zoneDistribution.pct[i]}%
                          </div>
                          <div className="text-[10px] text-slate-400 tabular-nums">{hoursStr(zoneDistribution.times[i])}</div>
                          <div className="text-[9px] text-slate-300 dark:text-slate-600 tabular-nums">{range}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-x-4 gap-y-1 flex-wrap pt-3 border-t border-slate-100 dark:border-slate-800">
                    {GROUPS.map(g => (
                      <span key={g.key} className="text-[11px] text-slate-400">
                        {g.label} <span className={`font-black tabular-nums ${g.text}`}>{zoneDistribution.groups[g.key]}%</span>
                      </span>
                    ))}
                    <span className="text-[10px] text-slate-300 dark:text-slate-600 ml-auto">
                      {zoneDistribution.sessions} sesiones · {hoursStr(zoneDistribution.totalSec)} con FC
                      {zoneDistribution.avgOnlySessions > 0 && ` · ${zoneDistribution.avgOnlySessions} sin parciales`}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 py-4 text-center">
                  {bounds
                    ? 'Sin sesiones con FC en los últimos 28 días.'
                    : 'Calibra FCmax y FC de reposo para ver el reparto por zonas.'}
                </p>
              )}
            </div>

            {/* ── Carga contra la propia capacidad ──────────────────────────
                Fitness y fatiga contra la MISMA escala —el techo del atleta—,
                que es lo que hace visible el hueco entre ellas; y ese hueco es
                el TSB. Un "84/100" y un "94/110" con denominadores inventados
                no comparan nada. */}
            <div className="flex flex-col gap-3 mt-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Carga y forma
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-slate-400">PMC Banister · TRIMP por reserva de FC</span>
                  <button
                    type="button"
                    onClick={() => onNavigate('pmc')}
                    className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                  >
                    PMC <ArrowRightIcon className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {pmcCurrent == null ? (
                <p className="text-xs text-slate-400 py-4 text-center">Aún no hay carga suficiente para el modelo.</p>
              ) : (
                <>
                  {/* Barra CTL */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-blue-600" />
                        Forma física (CTL)
                      </span>
                      <span className="text-slate-400">
                        <span className="font-black text-slate-800 dark:text-slate-100 text-sm tabular-nums">{fmt1(pmcCurrent.ctl)}</span>
                        <span className="ml-1.5 text-[11px]">{pmcCurrent.pctPeak}% de tu pico {fmt1(pmcCurrent.peak)}</span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-blue-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, Math.min(100, (pmcCurrent.ctl / loadScale) * 100))}%` }} />
                    </div>
                  </div>

                  {/* Barra ATL — misma escala que CTL, a propósito */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-orange-400" />
                        Fatiga (ATL)
                      </span>
                      <span className="text-slate-400">
                        <span className="font-black text-slate-800 dark:text-slate-100 text-sm tabular-nums">{fmt1(pmcCurrent.atl)}</span>
                        <span className="ml-1.5 text-[11px]">{Math.round((pmcCurrent.atl / loadScale) * 100)}% de la misma escala</span>
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-orange-400 h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, Math.min(100, (pmcCurrent.atl / loadScale) * 100))}%` }} />
                    </div>
                  </div>

                  {/* Frescura (TSB) en escala divergente: lo que se lee es el signo
                      y la distancia al cero, no el número suelto. */}
                  <div className="mt-1">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Frescura (TSB)</span>
                      <span className="text-sm font-black text-slate-800 dark:text-slate-100 tabular-nums">
                        {pmcCurrent.tsb >= 0 ? '+' : ''}{fmt1(pmcCurrent.tsb)}
                      </span>
                    </div>
                    {(() => {
                      // La escala se abre si el TSB se sale de ±30, para que el
                      // punto nunca se quede clavado en el extremo.
                      const span = Math.max(30, Math.ceil(Math.abs(pmcCurrent.tsb) / 10) * 10);
                      const left = 50 + (Math.max(-span, Math.min(span, pmcCurrent.tsb)) / span) * 50;
                      return (
                        <div className="relative h-4">
                          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2.5 rounded-full overflow-hidden flex">
                            <div className="w-[33%] bg-rose-100 dark:bg-rose-950/60" title="Fatiga alta" />
                            <div className="w-[17%] bg-orange-100 dark:bg-orange-950/60" title="Bloque de carga" />
                            <div className="w-[25%] bg-emerald-100 dark:bg-emerald-950/60" title="Rango productivo" />
                            <div className="w-[25%] bg-sky-100 dark:bg-sky-950/60" title="Fresco / afinado" />
                          </div>
                          <div className="absolute top-0 bottom-0 w-px bg-slate-300 dark:bg-slate-600" style={{ left: '50%' }} />
                          <div
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white ring-2 ring-slate-700 dark:ring-slate-300 shadow"
                            style={{ left: `${left}%` }}
                            title={`TSB ${fmt1(pmcCurrent.tsb)}`}
                          />
                        </div>
                      );
                    })()}
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>fatiga</span><span>equilibrio</span><span>fresco</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                    <span className="text-slate-400">
                      ACWR <span className={`font-black tabular-nums ${acwrCls}`}>{currentACWR == null ? DASH : currentACWR.toFixed(2)}</span>
                    </span>
                    <span className="text-slate-400">
                      Rampa <span className={`font-black tabular-nums ${rampCls}`}>{ctlRamp >= 0 ? '+' : ''}{fmt1(ctlRamp)}</span> CTL/sem
                    </span>
                    <span className="text-slate-400">
                      7 d <span className="font-black tabular-nums text-slate-600 dark:text-slate-300">{pmcCurrent.ctlTrend7 >= 0 ? '+' : ''}{fmt1(pmcCurrent.ctlTrend7)}</span>
                    </span>
                    <span className="text-slate-400">
                      {/* Rampa de VOLUMEN entre las dos últimas semanas cerradas */}
                      Volumen <span className="font-black tabular-nums text-slate-600 dark:text-slate-300">
                        {weeklyRamp ? `${weeklyRamp.absDeltaKm >= 0 ? '+' : ''}${weeklyRamp.absDeltaKm.toFixed(1)} km` : DASH}
                      </span>/sem
                    </span>
                    <span className="text-slate-300 dark:text-slate-600 ml-auto hidden xl:inline">{phase?.description}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Estado de Zapatilla Activa */}
          <div
            onClick={() => onNavigate('gear')}
            className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700 cursor-pointer hover:border-indigo-300 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[20px]">directions_run</span>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {activeShoe ? `Zapatilla Activa: ${activeShoe.name}` : 'Sin zapatilla asignada'}
                </span>
                <span className="text-[11px] text-slate-400">
                  {activeShoe
                    ? `${activeShoe.km.toLocaleString()} km de ${activeShoe.lifeKm.toLocaleString()} • Vida restante ${activeShoe.remainingPct}%`
                    : 'Asigna material a tus actividades de Strava para seguir su desgaste'}
                </span>
              </div>
            </div>
            {activeShoe && (
              <span className={`text-[10px] font-bold px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 ${
                activeShoe.remainingPct >= 40 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
              }`}>
                {activeShoe.remainingPct >= 40 ? 'RODAJE OK' : 'REVISAR DESGASTE'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── ÚLTIMAS SESIONES SINCRONIZADAS ──────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
            Últimas Sesiones Sincronizadas
          </h3>
          <button
            type="button"
            onClick={() => onNavigate('log')}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
          >
            <span>Ver historial completo ({runs.length} actividades)</span>
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="py-2.5 px-3">Fecha &amp; Sesión</th>
                <th className="py-2.5 px-3">Distancia</th>
                <th className="py-2.5 px-3">Ritmo Medio</th>
                <th className="py-2.5 px-3">FC Media</th>
                <th className="py-2.5 px-3">Cadencia</th>
                <th className="py-2.5 px-3">Sensación</th>
                <th className="py-2.5 px-3 text-right">Carga (TSS)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-medium">
              {recentActivities.map(a => (
                <tr key={a.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] ${
                        a.typeCode === 'INT' ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
                        : a.typeCode === 'LSD' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        : a.typeCode === 'REC' ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300'
                        : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                      }`}>
                        {a.typeCode}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[200px] sm:max-w-xs">
                          {a.name}
                        </span>
                        <span className="text-[11px] text-slate-400">{a.dateLabel}</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                    {a.distKm} km
                  </td>
                  <td className="py-3 px-3 font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                    {a.pace} /km
                  </td>
                  <td className="py-3 px-3 tabular-nums text-slate-700 dark:text-slate-300">
                    {a.hr != null ? <>{a.hr} ppm {a.hrZone && <span className="text-[10px] font-bold text-slate-400">({a.hrZone})</span>}</> : DASH}
                  </td>
                  <td className="py-3 px-3 tabular-nums text-slate-600 dark:text-slate-400">
                    {a.cadence != null ? `${a.cadence} spm` : DASH}
                  </td>
                  <td className="py-3 px-3">
                    {a.rpe ? (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[10px] font-bold">
                        {a.rpe}
                      </span>
                    ) : <span className="text-slate-400">{DASH}</span>}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                    {a.tss ?? DASH}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── ANÁLISIS DEL COACH IA ───────────────────────────────────────────
          Componente propio: ya habla el mismo lenguaje visual que esta portada
          (rounded-2xl, dark:, kinetic-gradient), así que entra tal cual. */}
      {activities.length > 0 && <AIInsights activities={activities} onOpenChat={onOpenChat} />}

      {/* ── ESTADO ACTUAL VS MEJOR HISTÓRICO (PLEGADO) ──────────────────────
          Va plegado porque la portada ya contesta "¿cómo voy?" con el briefing
          de arriba; esto es para cuando quieres saber respecto a QUÉ. */}
      {compareRows.length > 0 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          <button
            type="button"
            onClick={() => setCompareOpen(o => !o)}
            aria-expanded={compareOpen}
            className="w-full flex items-center justify-between gap-3 px-5 sm:px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 flex items-center justify-center">
                <HeartIcon className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Estado actual vs mejor histórico</h3>
                <span className="block text-xs text-slate-400">{compareRows.length} métricas · tendencia de 8 semanas</span>
              </div>
            </div>
            <ChevronRightIcon className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${compareOpen ? 'rotate-90' : ''}`} />
          </button>

          {compareOpen && (
            <div className="px-5 sm:px-6 pb-5 overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse min-w-[620px]">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="py-2.5 px-3 w-48">Métrica</th>
                    <th className="py-2.5 px-3 text-right">Ahora</th>
                    <th className="py-2.5 px-3 text-right">Mejor año</th>
                    <th className="py-2.5 px-3 text-right">Pico histórico</th>
                    <th className="py-2.5 px-3 text-right">% pico</th>
                    <th className="py-2.5 px-3 text-center">Tendencia 8s</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {compareRows.map(row => (
                    <tr key={row.label} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">{row.label}</td>
                      <td className="py-2.5 px-3 text-right font-black text-slate-800 dark:text-slate-100 tabular-nums">{row.now}</td>
                      <td className="py-2.5 px-3 text-right text-slate-500 dark:text-slate-400 tabular-nums">{row.bestYear}</td>
                      <td className="py-2.5 px-3 text-right text-slate-500 dark:text-slate-400 tabular-nums">{row.bestAll}</td>
                      <td className="py-2.5 px-3 text-right">
                        {row.noCompare
                          ? <span className="text-slate-300 dark:text-slate-600">{DASH}</span>
                          : <PctPill now={row.nowRaw} best={row.bestAllRaw} lowerIsBetter={row.lowerIsBetter} />}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex justify-center items-center">
                          <RowSparkline data={row.spark} color={row.sparkColor} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── SECCIÓN MARCAS PERSONALES (PERSONAL BESTS) ─────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t('dashboard.personal_bests')}</h3>
            <p className="text-[11px] text-slate-400">
              {t('dashboard.records.5k')} · {t('dashboard.records.10k')} · {t('dashboard.records.hm')} · {t('dashboard.records.fm')}
            </p>
          </div>
          <TrophyIcon className="w-5 h-5 text-amber-400 shrink-0" />
        </div>
        <PersonalBests activities={runs} horizontal />
      </div>

    </div>
  );
}
