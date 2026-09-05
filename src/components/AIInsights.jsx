import { useState, useEffect, useRef, useMemo } from 'react';
import cloudStorage from '../lib/cloudStorage';
import {
  SparklesIcon,
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  FireIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  ShieldExclamationIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import useAIInsights from '../hooks/useAIInsights';
import HRZonesCard from './HRZonesCard';
import {
  RUN_TYPES, RIDE_TYPES, activityEmoji,
  paceStr, formatTs, formatDataDate,
  parseWorkout, deriveStatusKey, deriveTrendKey,
} from '../lib/aiInsights';

// ── Inline markdown renderer (bold + bullet lists) ──────────────────────────
const MD = ({ text, accent, isDark = false, lg = false }) => {
  if (!text) return null;
  const inline = (str) => {
    const parts = []; let rem = str, k = 0;
    while (rem) {
      const m = rem.match(/\*\*(.+?)\*\*/);
      if (m?.index !== undefined) {
        if (m.index > 0) parts.push(<span key={k++}>{rem.slice(0, m.index)}</span>);
        parts.push(
          <strong key={k++} className={`font-semibold ${isDark ? 'text-white font-extrabold' : 'text-slate-800 dark:text-slate-200'}`}>
            {m[1]}
          </strong>
        );
        rem = rem.slice(m.index + m[0].length); continue;
      }
      parts.push(<span key={k++}>{rem}</span>); break;
    }
    return parts;
  };
  const dot = accent.replace('text-', 'bg-');
  return (
    <ul className={lg ? 'space-y-2.5' : 'space-y-2'}>
      {text.split('\n').map(l => l.trim()).filter(l => l && !/^\**bloque\s*\d+/i.test(l)).map((l, i) => (
        <li key={i} className={`flex gap-2.5 ${lg ? 'text-[13px]' : 'text-[12px]'} leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600 dark:text-slate-400'}`}>
          <span className={`shrink-0 ${lg ? 'mt-[7px]' : 'mt-[6px]'} w-1.5 h-1.5 rounded-full ${dot}`} />
          <span>{inline(l.replace(/^[-•*]\s+/, ''))}</span>
        </li>
      ))}
    </ul>
  );
};

// ── Disclosure: lo que es referencia o detalle largo no compite con el foco ──
const Disclosure = ({ label, children, className = '' }) => (
  <details className={`group rounded-xl border border-slate-200/65 dark:border-slate-800/65 bg-slate-50/50 dark:bg-slate-800/10 ${className}`}>
    <summary className="flex items-center gap-1.5 px-3.5 py-2 cursor-pointer list-none text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
      <span className="transition-transform group-open:rotate-90 text-slate-300 dark:text-slate-600">▸</span>
      {label}
    </summary>
    <div className="px-3.5 pb-3.5">{children}</div>
  </details>
);

// ── Skeleton loading ─────────────────────────────────────────────────────────
const Pulse = () => (
  <div className="space-y-2 animate-pulse mt-2">
    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full w-3/4" />
    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full w-full" />
    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full w-5/6" />
  </div>
);

// ── Cabecera de zona: cada bloque del informe lleva su horizonte temporal ───
// (HOY / PRÓXIMAS 48 H / ÚLTIMOS 2 MESES / ÚLTIMA SESIÓN) — la estructura del
// módulo ES una línea de tiempo del ciclo de entrenamiento.
const ScopePill = ({ children }) => (
  <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0 px-2 py-[3px] rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
    {children}
  </span>
);

const ZoneHeader = ({ num, marker, title, scope, right = null }) => (
  <div className="flex items-center gap-2.5 mb-3 px-0.5">
    <span className={`w-2 h-2 rounded-[3px] shrink-0 ${marker}`} />
    {num && (
      <span className="font-mono text-[10px] font-bold text-slate-300 dark:text-slate-600 tabular-nums shrink-0">{num}</span>
    )}
    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-slate-200 shrink-0">
      {title}
    </span>
    <span className="flex-1 h-px bg-slate-200/80 dark:bg-slate-800" />
    {right ?? (scope && <ScopePill>{scope}</ScopePill>)}
  </div>
);

// ── Medidor de zonas Z1-Z5 (ecualizador de intensidad) ──────────────────────
const ZONE_COLORS = ['bg-sky-400', 'bg-emerald-400', 'bg-amber-400', 'bg-orange-500', 'bg-rose-500'];
const ZONE_HEIGHTS = ['h-[5px]', 'h-[8px]', 'h-[11px]', 'h-[14px]', 'h-[17px]'];
const ZoneMeter = ({ zone }) => {
  if (!zone || zone < 1 || zone > 5) return null;
  return (
    <div className="flex items-end gap-[3px]" title={`Intensidad: Zona ${zone} de 5`}>
      {[1, 2, 3, 4, 5].map(z => (
        <span
          key={z}
          className={`w-[5px] rounded-[1.5px] ${ZONE_HEIGHTS[z - 1]} ${z <= zone ? ZONE_COLORS[zone - 1] : 'bg-slate-200 dark:bg-slate-700'}`}
        />
      ))}
    </div>
  );
};

// ── Badges (la clave viene de lib/aiInsights: metadatos JSON o heurística) ──
const CUR_BADGES = {
  fatiga: { text: 'Fatiga', color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-900/50' },
  recuperado: { text: 'Recuperado', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50' },
  sobreentrenamiento: { text: 'Sobreentrenamiento', color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50' },
  forma: { text: 'En Forma', color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/50' },
  adaptativo: { text: 'Adaptativo', color: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
};

const TREND_BADGES = {
  riesgo: { text: 'Riesgo Lesión', color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50' },
  estable: { text: 'Estable', color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50' },
  progresion: { text: 'Progresión', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50' },
  estacional: { text: 'Estacional', color: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
};

// Badge sobrio: punto de color en lugar de emoji
const Badge = ({ badge, className = '' }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold border ${badge.color} ${className}`}>
    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 shrink-0" />
    {badge.text}
  </span>
);

// El acento del ticket de prescripción codifica la intensidad del tipo de sesión
const WORKOUT_THEMES = [
  {
    match: /regen/i,
    stub: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300',
    sub: 'text-emerald-600/70 dark:text-emerald-400/60', edge: 'border-emerald-200/70 dark:border-emerald-900/50',
  },
  {
    match: /tempo|umbral/i,
    stub: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-300',
    sub: 'text-amber-600/70 dark:text-amber-400/60', edge: 'border-amber-200/70 dark:border-amber-900/50',
  },
  {
    match: /interv|seri|fartlek/i,
    stub: 'bg-rose-50 dark:bg-rose-950/30', text: 'text-rose-700 dark:text-rose-300',
    sub: 'text-rose-600/70 dark:text-rose-400/60', edge: 'border-rose-200/70 dark:border-rose-900/50',
  },
  {
    match: /largo|rodaje/i,
    stub: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-700 dark:text-violet-300',
    sub: 'text-violet-600/70 dark:text-violet-400/60', edge: 'border-violet-200/70 dark:border-violet-900/50',
  },
];
const DEFAULT_THEME = {
  stub: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-300',
  sub: 'text-blue-600/70 dark:text-blue-400/60', edge: 'border-blue-200/70 dark:border-blue-900/50',
};
const workoutTheme = (type) => WORKOUT_THEMES.find(t => t.match.test(type ?? '')) ?? DEFAULT_THEME;

const SELECT_ARROW = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
};

// ── Main component ───────────────────────────────────────────────────────────
const AIInsights = ({ activities, onOpenChat }) => {
  const {
    cur, trend, nextWork, lastWork, meta, sci, warnings, lastPrompt,
    loading, providerLabel, usedProvider, isFallback,
    cacheTs, restoreWarning, dismissRestoreWarning,
    garmin, stravaFetch,
    weeklyTarget, changeWeeklyTarget,
    goal,
    run,
  } = useAIInsights(activities);

  // Copia del prompt enviado a la IA (feedback breve con check)
  const [promptCopied, setPromptCopied] = useState(false);
  const copyPrompt = async () => {
    if (!lastPrompt) return;
    try {
      await navigator.clipboard.writeText(lastPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch { /* clipboard no disponible */ }
  };

  // Popover de ajustes (compacta los dos selectores + objetivo en la cabecera)
  const [cfgOpen, setCfgOpen] = useState(false);
  const cfgRef = useRef(null);
  useEffect(() => {
    if (!cfgOpen) return;
    const onDoc = (e) => { if (cfgRef.current && !cfgRef.current.contains(e.target)) setCfgOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setCfgOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [cfgOpen]);

  // Tick por minuto para que "hace X min" del timestamp no se quede congelado
  const [, setClockTick] = useState(0);
  useEffect(() => {
    if (!cacheTs) return;
    const id = setInterval(() => setClockTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, [cacheTs]);

  // Actividades ordenadas por fecha desc (se usa en la tira y en "Último Entreno")
  const sortedActivities = useMemo(
    () => [...(activities ?? [])].sort((a, b) => new Date(b.start_date) - new Date(a.start_date)),
    [activities]
  );

  if (!activities || activities.length < 3) return null;

  const hasGarmin = garmin?.length > 0;

  // ── Data freshness (last sync of each source) ───────────────────────────────
  const garminDataDate = hasGarmin
    ? [...garmin].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
    : null;
  const stravaFresh = formatDataDate(stravaFetch);
  const garminFresh = formatDataDate(garminDataDate);

  // Pasa el análisis actual al chat (RunQA) como contexto y deja preparada una
  // pregunta que el chat lanza solo al abrirse: la de la sección indicada por
  // `focus`, o la de ampliación general si se llama sin argumento (footer).
  const openInChat = (focus) => {
    try {
      const last = sortedActivities[0];
      const lastDesc = last
        ? `mi última sesión «${last.name}» del ${new Date(last.start_date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}`
        : 'mi última sesión';
      const ASKS = {
        cur: 'Amplía el diagnóstico de mi estado actual: explica en detalle qué indican mis métricas (readiness, TSB, ACWR, VFC, sueño…), qué riesgos ves y qué debería vigilar los próximos días. Quiero un análisis largo y razonado, con secciones.',
        nextWork: 'Amplía la sesión que me recomiendas: desglosa calentamiento, bloques principales con ritmos y FC objetivo, vuelta a la calma, y explica por qué esta sesión y no otra dado mi estado actual. Quiero el detalle completo de ejecución.',
        trend: 'Amplía el análisis de mi tendencia de los últimos 2 meses: evolución de volumen, ritmo y FC, qué patrón ves en mi carga (ACWR, progresión) y qué proyección haces si sigo así. Quiero un análisis largo apoyado en cifras concretas.',
        lastWork: `Analiza en profundidad ${lastDesc}: valora ritmo, FC, desnivel y esfuerzo comparándola con mis sesiones anteriores, dime qué hice bien, qué puedo mejorar y cómo encaja en mi carga actual. Quiero un análisis extendido, no un resumen.`,
        general: 'Amplía todo el análisis del panel de IA: explícame con más detalle mi estado actual y qué indican mis métricas, la tendencia de los últimos 2 meses, cómo fue mi última sesión y por qué me recomiendas la próxima sesión. Quiero un análisis largo y completo, con secciones.',
      };
      const seed = {
        ts: Date.now(),
        blocks: { cur, trend, nextWork, lastWork },
        focus: focus ?? 'general',
        ask: ASKS[focus ?? 'general'] ?? null,
        sci: sci ? {
          readiness: sci.readiness?.score ?? null,
          readinessLabel: sci.readiness?.label ?? null,
          ctl: sci.pmc?.ctl ?? null,
          atl: sci.pmc?.atl ?? null,
          tsb: sci.pmc?.tsb ?? null,
          acwr: sci.pmc?.acwr ?? null,
          fcmax: sci.fcmax ?? null,
          fcRest: sci.fcRest ?? null,
          lthr: sci.lthr ?? null,
        } : null,
      };
      cloudStorage.setItem('runqa_seed', JSON.stringify(seed));
    } catch { /* ignore quota/serialization errors */ }
    onOpenChat?.();
  };

  // Mini-botón por sección: abre el chat con esa sección como foco y una
  // pregunta de ampliación ya lanzada.
  const AskChatBtn = ({ focus }) => onOpenChat ? (
    <button
      onClick={() => openInChat(focus)}
      title="Ampliar este análisis en el chat de IA"
      className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide text-blue-500 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100/70 dark:hover:bg-blue-900/30 transition-colors"
    >
      <ChatBubbleLeftRightIcon className="w-3 h-3" />
      <span>Ampliar</span>
    </button>
  ) : null;

  const curBadge = CUR_BADGES[deriveStatusKey(cur, meta)] ?? null;
  const trendBadge = trend ? (TREND_BADGES[deriveTrendKey(trend, meta)] ?? null) : null;

  // ── Constantes de apoyo (rail bajo el diagnóstico) ──────────────────────────
  const vitalPills = (() => {
    const pills = [];
    const h = sci?.hrv;
    if (h) pills.push({ k: 'VFC', v: `${h.latest} ms`, c: h.latest < h.baseline?.balancedLow ? 'text-rose-500' : 'text-emerald-500' });
    if (sci?.bb?.high != null) pills.push({ k: 'Body Batt.', v: `${sci.bb.high}/100`, c: sci.bb.high >= 70 ? 'text-emerald-500' : 'text-amber-500' });
    if (sci?.sleep?.score != null) pills.push({ k: 'Sueño', v: `${sci.sleep.score}/100`, c: sci.sleep.score >= 75 ? 'text-emerald-500' : 'text-amber-500' });
    if (sci?.pmc) pills.push({ k: 'TSB', v: sci.pmc.tsb > 0 ? `+${sci.pmc.tsb}` : `${sci.pmc.tsb}`, c: sci.pmc.tsb >= 5 ? 'text-emerald-500' : sci.pmc.tsb >= -10 ? 'text-amber-500' : 'text-rose-500' });
    if (sci?.pmc?.acwr != null) pills.push({ k: 'ACWR', v: `${sci.pmc.acwr}`, c: sci.pmc.acwr > 1.5 ? 'text-rose-500' : 'text-slate-600 dark:text-slate-300' });
    // LT1/LT2 viven en la tarjeta de zonas de FC: no se repiten aquí.
    return pills;
  })();

  // ── Configuración compacta (popover reutilizado en la cabecera) ─────────────
  const controls = (
    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
      <button
        onClick={() => run(true)}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 shadow-sm transition-all"
      >
        <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        <span>{loading ? 'Analizando…' : 'Recalcular'}</span>
      </button>

      {lastPrompt && (
        <button
          onClick={copyPrompt}
          title="Copiar el prompt enviado a la IA"
          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors"
        >
          {promptCopied
            ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" />
            : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
        </button>
      )}

      {/* Ajustes Popover */}
      <div className="relative" ref={cfgRef}>
        <button
          onClick={() => setCfgOpen(o => !o)}
          disabled={loading}
          aria-expanded={cfgOpen}
          aria-haspopup="dialog"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${cfgOpen ? 'text-blue-600 bg-blue-50/50 border-blue-200' : 'text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50'}`}
        >
          <Cog6ToothIcon className={`w-3.5 h-3.5 transition-transform ${cfgOpen ? 'rotate-45' : ''}`} />
          <span>{weeklyTarget}×/sem</span>
          {goal && <span className="text-slate-300">·</span>}
          {goal && <span>🎯 {goal.distance}</span>}
        </button>

        {cfgOpen && (
          <div role="dialog" aria-label="Ajustes del análisis IA" className="absolute right-0 top-full mt-2 w-60 z-30 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-md p-4 space-y-3">
            <div>
              <label htmlFor="ai-weekly-target" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Correr / semana</label>
              <select
                id="ai-weekly-target"
                value={weeklyTarget}
                disabled={loading}
                onChange={e => changeWeeklyTarget(e.target.value)}
                className="w-full text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 pr-8 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 transition-colors cursor-pointer appearance-none"
                style={SELECT_ARROW}
              >
                {[2, 3, 4, 5, 6].map(n => (
                  <option key={n} value={String(n)}>{n}×/sem</option>
                ))}
              </select>
            </div>

            <p className="text-[9px] text-slate-400 font-semibold leading-snug">
              Los cambios se aplican al pulsar «Recalcular».
            </p>

            {goal && (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold pt-2 border-t border-slate-100 dark:border-slate-800">
                🎯 Objetivo:&nbsp;<span className="font-bold text-slate-700 dark:text-slate-300">{goal.distance}{goal.pace ? ` · ${goal.pace}` : ''}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">

      {/* ═══════════ 01 · ESTADO FISIOLÓGICO (HOY) ═══════════ */}
      <section>
      <ZoneHeader num="01" marker="kinetic-gradient" title="Estado Fisiológico" scope="Hoy" />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        <div className="absolute inset-x-0 top-0 h-[3px] kinetic-gradient" />

        <div className="px-5 pt-4 pb-5">
          {/* Identidad del coach + controles */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 mb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 shrink-0">
                <SparklesIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-tight truncate">Coach IA · {usedProvider || 'Gemini'}</p>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5 truncate">
                  {cacheTs && !loading ? `${formatTs(cacheTs)} · ` : ''}Garmin + Strava
                </p>
              </div>
            </div>
            {controls}
          </div>

          {/* Cuerpo: readiness (apoyo) + diagnóstico (foco) */}
          <div className="flex flex-col sm:flex-row gap-5">
            {/* Anillo de readiness — contexto */}
            <div className="flex sm:flex-col items-center gap-3 sm:gap-2 shrink-0 sm:w-[104px] sm:pr-4 sm:border-r sm:border-slate-100 dark:sm:border-slate-800">
              {(() => {
                const r = sci?.readiness;
                const score = r?.score ?? 0;
                const band = r?.band ?? 'good';
                const ringColor = band === 'high' ? 'text-emerald-500' : band === 'good' ? 'text-blue-500' : band === 'mod' ? 'text-amber-500' : 'text-rose-500';
                const ringBg = band === 'high' ? 'stroke-emerald-500' : band === 'good' ? 'stroke-blue-500' : band === 'mod' ? 'stroke-amber-500' : 'stroke-rose-500';
                const R = 32, C = 2 * Math.PI * R, off = C * (1 - score / 100);
                return (
                  <div className="relative w-[80px] h-[80px] shrink-0">
                    <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                      <circle cx="40" cy="40" r={R} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="6" fill="none" />
                      <circle cx="40" cy="40" r={R} className={ringBg} strokeWidth="6" fill="none"
                        strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off}
                        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center -space-y-0.5">
                      <span className={`font-mono font-black text-xl tabular-nums leading-none ${ringColor}`}>{score || '—'}</span>
                      <span className="text-[7px] font-bold uppercase tracking-[0.15em] text-slate-400">READY</span>
                    </div>
                  </div>
                );
              })()}
              {sci?.readiness?.label && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 text-center">
                  {sci.readiness.label}
                </span>
              )}
            </div>

            {/* Diagnóstico — protagonista. Un único badge de estado: el de la IA
                si existe; el anillo ya aporta el número y su banda de color. */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2.5">
                {curBadge
                  ? <Badge badge={curBadge} />
                  : <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Diagnóstico IA</span>}
                <span className="ml-auto">{cur && <AskChatBtn focus="cur" />}</span>
              </div>
              <div className="min-h-[84px]">
                {loading && !cur ? <Pulse /> : <MD text={cur} accent="text-blue-500" lg />}
              </div>
            </div>
          </div>

          {/* Panel de constantes — telemetría en celdas, no pildoritas sueltas */}
          {vitalPills.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 overflow-hidden">
              <div className="flex flex-wrap">
                {vitalPills.map((p, i) => (
                  <div key={i} className="flex-1 min-w-[86px] px-2 py-2 text-center border-l border-slate-200/60 dark:border-slate-700/50 first:border-l-0">
                    <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-1">{p.k}</span>
                    <span className={`font-mono text-[13px] font-bold tabular-nums leading-none ${p.c}`}>{p.v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      </section>

      {/* ── BANNERS ── */}
      {loading && providerLabel && (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-[11px] font-semibold ${isFallback
          ? 'bg-amber-50 border-amber-200/50 text-amber-800 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400'
          : 'bg-blue-50 border-blue-200/50 text-blue-800 dark:bg-blue-950/20 dark:border-blue-900/50 dark:text-blue-400'
          }`}>
          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>{providerLabel}</span>
        </div>
      )}

      {restoreWarning && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200/50 rounded-xl text-[11px] text-amber-800 font-semibold dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400">
          <span className="shrink-0 text-sm">⚠️</span>
          <span>Falló la actualización — mostrando la recomendación anterior guardada.</span>
          <button
            onClick={dismissRestoreWarning}
            className="ml-auto text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors font-bold leading-none"
          >✕</button>
        </div>
      )}

      {/* Avisos de coherencia científica: la prescripción de la IA se valida
          post-hoc contra el readiness y las zonas de FC calculadas (sci). */}
      {!loading && warnings?.length > 0 && (
        <div className="rounded-xl border border-amber-200/70 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldExclamationIcon className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
              Revisa la prescripción
            </span>
          </div>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300/90">
                <span className="shrink-0 mt-[5px] w-1 h-1 rounded-full bg-amber-500" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ═══════════ 02 · PLAN (PRÓXIMAS 48 H) — ticket de sesión ═══════════ */}
      {(nextWork || loading) && (
        <section>
        <ZoneHeader
          num="02" marker="bg-blue-500" title="Plan de Entrenamiento" scope="Próximas 48 h"
          right={nextWork ? (
            <span className="flex items-center gap-2">
              <ScopePill>Próximas 48 h</ScopePill>
              <AskChatBtn focus="nextWork" />
            </span>
          ) : null}
        />
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-5">
          <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-blue-500/80" />

          {loading && !nextWork ? (
            <Pulse />
          ) : (
            (() => {
              const w = parseWorkout(nextWork, meta);
              const theme = workoutTheme(w?.type);
              const zoneNum = Number(w?.hrZone?.match(/Zona\s*(\d)/i)?.[1]) || null;
              const hrRange = w?.hrZone?.match(/(\d+\s*-\s*\d+)\s*ppm/i)?.[1] ?? null;
              // FC media objetivo = punto medio del rango prescrito; se contextualiza
              // contra los umbrales del atleta (LT1 techo fácil, LT2 umbral).
              const [hrLo, hrHi] = hrRange ? hrRange.split('-').map(n => parseInt(n, 10)) : [null, null];
              const hrMid = hrLo && hrHi ? Math.round((hrLo + hrHi) / 2) : null;
              const lt1 = sci?.lt?.lt1Hr ?? null;
              const lt2 = sci?.lt?.lt2Hr ?? null;
              // Una sola frase de contexto: dónde cae la FC prescrita respecto a
              // los umbrales del atleta. Sustituye a la fila de referencias.
              const hrRef = hrMid && lt1
                ? (hrMid <= lt1 ? `≈${hrMid} ppm · bajo LT1 (fácil)`
                  : lt2 && hrMid >= lt2 ? `≈${hrMid} ppm · sobre LT2 (calidad)`
                    : `≈${hrMid} ppm · entre umbrales`)
                : null;
              // El desglose por bloques ya describe la sesión: si existe, la
              // prosa del coach pasa a ser detalle plegado, no un tercer relato.
              const hasStructure = Array.isArray(meta?.sesion?.structured_workout)
                && meta.sesion.structured_workout.length > 0;
              return (
                <div className="space-y-3">
                  {/* Ticket: talón de intensidad + campos perforados */}
                  <div className={`relative flex flex-col md:flex-row rounded-xl border overflow-hidden ${theme.edge}`}>
                    {/* Talón — el color codifica la intensidad del tipo de sesión */}
                    <div className={`md:w-52 shrink-0 px-4 py-4 flex flex-col justify-center gap-1.5 ${theme.stub}`}>
                      <span className={`text-[9px] font-black uppercase tracking-[0.18em] ${theme.sub}`}>Sesión recomendada</span>
                      <span className={`text-xl font-black uppercase tracking-tight leading-none ${theme.text}`}>
                        {w?.type || 'Sesión Base'}
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <ZoneMeter zone={zoneNum} />
                        {zoneNum && <span className={`font-mono text-[10px] font-bold ${theme.sub}`}>Z{zoneNum}</span>}
                      </div>
                    </div>

                    {/* Perforación del ticket */}
                    <div aria-hidden className={`relative hidden md:block border-l-2 border-dashed ${theme.edge}`}>
                      <span className={`absolute -top-[9px] -left-[9px] w-4 h-4 rounded-full bg-white dark:bg-slate-900 border ${theme.edge}`} />
                      <span className={`absolute -bottom-[9px] -left-[9px] w-4 h-4 rounded-full bg-white dark:bg-slate-900 border ${theme.edge}`} />
                    </div>
                    <div aria-hidden className={`md:hidden border-t-2 border-dashed ${theme.edge}`} />

                    {/* Campos de la prescripción */}
                    <div className="flex-1 grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-800 items-center bg-white dark:bg-slate-900 px-2 py-4">
                      {[
                        { k: 'Distancia', v: w?.distance || 'Varía' },
                        { k: 'Ritmo objetivo', v: w?.pace?.replace(/\s*min\/km/i, '') || 'Aeróbico', unit: w?.pace ? 'min/km' : null },
                        // La FC objetivo se lee junto a su referencia (LT1/LT2)
                        // en la misma celda: sin fila extra de umbrales.
                        { k: 'Frecuencia cardiaca', v: hrRange || w?.hrZone || 'Zona 2', unit: hrRange ? 'ppm' : null, note: hrRef },
                      ].map(m => (
                        <div key={m.k} className="px-3 text-center min-w-0">
                          <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider mb-1">{m.k}</span>
                          <span className="font-mono text-sm sm:text-base font-bold tabular-nums text-slate-800 dark:text-slate-100 truncate block leading-none">
                            {m.v}
                          </span>
                          {m.unit && <span className="font-mono text-[9px] text-slate-400 block mt-0.5">{m.unit}</span>}
                          {m.note && <span className="text-[9px] text-slate-400 block mt-0.5 leading-tight">{m.note}</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Desglose estructurado de la sesión (bloques / series) */}
                  {hasStructure && (
                    <div className="rounded-xl border border-slate-200/65 dark:border-slate-800/65 bg-slate-50/50 dark:bg-slate-800/10 p-3.5">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-3">Estructura de la Sesión</span>
                      <div className="space-y-2">
                        {meta.sesion.structured_workout.map((step, i) => {
                          const z = Number(step.intensity) || 0;
                          const dot = z >= 4 ? 'bg-rose-500' : z === 3 ? 'bg-amber-500' : 'bg-emerald-500';
                          const reps = Number(step.reps) || 0;
                          return (
                            <div key={i} className="flex items-start gap-3 rounded-lg border border-slate-200/60 dark:border-slate-800/60 bg-white dark:bg-slate-900 px-3 py-2.5">
                              <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${dot}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-black text-slate-800 dark:text-slate-100 tracking-tight">{step.phase}</span>
                                  <span className="font-mono text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                                    {reps > 1 ? `${reps} × ${step.duration_min}′` : `${step.duration_min}′`}
                                  </span>
                                </div>
                                {(step.pace || step.hr || (reps > 1 && step.recovery)) && (
                                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {step.pace && <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{step.pace}</span>}
                                    {step.hr && <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">{step.hr} ppm</span>}
                                    {reps > 1 && step.recovery && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">rec. {step.recovery}</span>}
                                  </div>
                                )}
                                {step.description && <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed mt-1">{step.description}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Guías de ejecución: visibles solo si no hay estructura */}
                  {hasStructure ? (
                    <Disclosure label="Notas del coach">
                      <MD text={nextWork} accent="text-blue-500" />
                    </Disclosure>
                  ) : (
                    <div className="rounded-xl border border-slate-200/65 dark:border-slate-800/65 bg-slate-50/50 dark:bg-slate-800/10 p-3.5">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-2">Instrucciones del Entrenamiento</span>
                      <MD text={nextWork} accent="text-blue-500" />
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
        </section>
      )}

      {/* ═══════════ 03 · ANÁLISIS — tendencia (2 meses) + ejecución (última) ═══════════ */}
      <section>
      <ZoneHeader num="03" marker="bg-indigo-500" title="Análisis de Rendimiento" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Tendencia de rendimiento */}
        <div className="relative overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col">
          <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-indigo-500/80" />
          <ZoneHeader
            marker="bg-indigo-500"
            title="Tendencia"
            scope="Últimos 2 meses"
            right={(trendBadge || trend) ? (
              <span className="flex items-center gap-2">
                {trendBadge && <Badge badge={trendBadge} className="shrink-0" />}
                {trend && <AskChatBtn focus="trend" />}
              </span>
            ) : null}
          />

          <div className="flex items-center gap-2 mb-2">
            <ArrowTrendingUpIcon className="w-4 h-4 text-indigo-500 shrink-0" />
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Patrón de carga y progresión</span>
          </div>

          <div className="min-h-[92px] flex-1 flex flex-col justify-center">
            {loading && !trend ? <Pulse /> : <MD text={trend} accent="text-indigo-500" />}
          </div>
        </div>

        {/* Análisis del último entrenamiento */}
        {(() => {
          const last = sortedActivities[0];
          const km = last ? last.distance / 1000 : 0;
          const min = last ? (last.moving_time || 0) / 60 : 0;
          const isRun = last && RUN_TYPES.includes(last.type);
          const chips = [];
          if (km > 0) chips.push(`${km.toFixed(1)} km`);
          if (min > 0) chips.push(`${Math.round(min)} min`);
          if (km > 0 && min > 0 && isRun) {
            chips.push(`${paceStr(min / km)}/km`);
          } else if (last && km > 0 && min > 0 && RIDE_TYPES.includes(last.type)) {
            chips.push(`${(km / (min / 60)).toFixed(1)} km/h`);
          }
          if (last?.average_heartrate) chips.push(`${Math.round(last.average_heartrate)} ppm`);
          if (last?.total_elevation_gain) chips.push(`+${Math.round(last.total_elevation_gain)} m`);
          const icon = activityEmoji(last?.type);
          return (
            <div className="relative overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col">
              <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-amber-500/80" />
              <ZoneHeader
                marker="bg-amber-500" title="Ejecución" scope="Última sesión"
                right={lastWork ? (
                  <span className="flex items-center gap-2">
                    <ScopePill>Última sesión</ScopePill>
                    <AskChatBtn focus="lastWork" />
                  </span>
                ) : null}
              />

              <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FireIcon className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 truncate">
                    {icon} {last?.name || 'Sesión'}
                  </span>
                </div>
              </div>
              {chips.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {chips.map((m, idx) => (
                    <span key={idx} className="px-2 py-0.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded font-mono text-[9px] tabular-nums">
                      {m}
                    </span>
                  ))}
                </div>
              )}
              <div className="min-h-[92px] flex-1 flex flex-col justify-center">
                {loading && !lastWork ? <Pulse /> : <MD text={lastWork} accent="text-amber-500" />}
              </div>
            </div>
          );
        })()}

      </div>
      </section>

      {/* ── ZONAS DE FC — referencia (plegada): mismos umbrales que usa el coach ── */}
      <HRZonesCard sci={sci} />

      {/* ═══════════ 04 · FUENTES — pie único: qué se analizó, cuándo y con qué ═══════════ */}
      <div className="border-t border-slate-200/60 dark:border-slate-800/60 pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 text-[10px] font-semibold text-slate-400">
          <span className="flex items-center gap-1.5">
            <ClockIcon className="w-3.5 h-3.5 shrink-0" />
            {sortedActivities.length} sesiones analizadas
          </span>
          {stravaFresh && <span className="font-mono">Strava {stravaFresh}</span>}
          {garminFresh && <span className="font-mono">Garmin {garminFresh}</span>}
        </div>
        {onOpenChat && (cur || trend || nextWork) && (
          <button
            onClick={() => openInChat()}
            className="shrink-0 self-start sm:self-center inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-100/50 dark:border-blue-900/50 hover:bg-blue-100/80 hover:text-blue-700 transition-all"
          >
            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
            <span>Consultar Coach Virtual</span>
          </button>
        )}
      </div>

      {/* Detalle de las sesiones que alimentan el análisis (plegado) */}
      <Disclosure label="Sesiones analizadas">
        <div className="flex flex-wrap gap-2">
          {sortedActivities.slice(0, 5).map(a => {
            const tooltipParts = [];
            if (a.name) tooltipParts.push(a.name);
            tooltipParts.push(new Date(a.start_date).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
            if (a.total_elevation_gain) tooltipParts.push(`Desnivel: +${Math.round(a.total_elevation_gain)}m`);
            if (a.average_heartrate) tooltipParts.push(`FC Media: ${Math.round(a.average_heartrate)} ppm`);
            if (a.suffer_score) tooltipParts.push(`Esfuerzo: ${a.suffer_score}`);

            return (
              <div key={a.id} title={tooltipParts.join('\n')} className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 rounded-md cursor-help hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <span className="font-mono text-[9px] text-slate-400 font-medium border-r border-slate-200 dark:border-slate-700 pr-1.5">
                  {new Date(a.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                  <span>{activityEmoji(a.type)}</span>
                  <span className="font-mono tabular-nums">
                    {a.distance > 0 ? `${(a.distance / 1000).toFixed(1)}k` : `${Math.round((a.moving_time || 0) / 60)}min`}
                  </span>
                </span>
                {a.moving_time > 0 && a.distance > 0 && RUN_TYPES.includes(a.type) && (
                  <span className="font-mono text-[9px] text-slate-400 font-medium border-l border-slate-200 dark:border-slate-700 pl-1.5 tabular-nums">
                    {`${paceStr((a.moving_time / 60) / (a.distance / 1000))}/km`}
                  </span>
                )}
                {a.moving_time > 0 && a.distance > 0 && RIDE_TYPES.includes(a.type) && (
                  <span className="font-mono text-[9px] text-slate-400 font-medium border-l border-slate-200 dark:border-slate-700 pl-1.5 tabular-nums">
                    {((a.distance / 1000) / (a.moving_time / 3600)).toFixed(1)} km/h
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Disclosure>

    </div>
  );
};

export default AIInsights;
