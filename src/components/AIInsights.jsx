import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { streamAI, fetchGeminiModels } from '../services/ai';
import {
  SparklesIcon,
  ArrowPathIcon,
  HeartIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  BoltIcon,
  MoonIcon,
  FireIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { buildPrompt } from '../lib/athleteContext';
import { getNextTargetRace, DISTANCES, TARGET_RACES_EVENT } from '../lib/targetRaces';

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

// ── Skeleton loading ─────────────────────────────────────────────────────────
const Pulse = () => (
  <div className="space-y-2 animate-pulse mt-2">
    <div className="h-2.5 bg-slate-100 rounded-full w-3/4" />
    <div className="h-2.5 bg-slate-100 rounded-full w-full" />
    <div className="h-2.5 bg-slate-100 rounded-full w-5/6" />
  </div>
);

// ── Timestamp formatter ──────────────────────────────────────────────────────
const formatTs = (ts) => {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.round((now - d) / 60000);
  if (diffMin < 2) return 'ahora mismo';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

// ── Data-freshness formatter (whole-day granularity) ─────────────────────────
const formatDataDate = (input) => {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d)) return null;
  const day0 = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const days = Math.round((day0(new Date()) - day0(d)) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days}d`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

// ── Available Gemini models ──────────────────────────────────────────────────
const GEMINI_MODELS = [
  { id: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite · menos tokens' },
  { id: 'gemini-3.5-flash', label: '3.5 Flash · mejor calidad' },
  { id: 'gemini-2.5-flash', label: '2.5 Flash · equilibrado' },
];
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

// ── Main component ───────────────────────────────────────────────────────────
const AIInsights = ({ activities, onOpenChat }) => {
  const [cur, setCur] = useState('');
  const [trend, setTrend] = useState('');
  const [nextWork, setNextWork] = useState('');
  const [lastWork, setLastWork] = useState('');
  const [loading, setLoading] = useState(false);
  const [, setLoaded] = useState(false);
  const [garmin, setGarmin] = useState(undefined);
  const [sleep, setSleep] = useState(undefined);
  const [stravaFetch, setStravaFetch] = useState(null);
  const [sci, setSci] = useState(null);
  const [cacheTs, setCacheTs] = useState(null);
  const [restoreWarning, setRestoreWarning] = useState(false);
  const [providerLabel, setProviderLabel] = useState('');
  const [usedProvider, setUsedProvider] = useState('');
  const [isFallback, setIsFallback] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    () => cloudStorage.getItem('ai_insights_model') || DEFAULT_MODEL
  );
  const [weeklyTarget, setWeeklyTarget] = useState(
    () => cloudStorage.getItem('ai_weekly_target') || '2'
  );
  // Popover de ajustes (compacta los dos selectores + objetivo en la cabecera)
  const [cfgOpen, setCfgOpen] = useState(false);
  const cfgRef = useRef(null);
  useEffect(() => {
    if (!cfgOpen) return;
    const onDoc = (e) => { if (cfgRef.current && !cfgRef.current.contains(e.target)) setCfgOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [cfgOpen]);
  // El objetivo de carrera ya no se configura aquí: se deriva de la próxima
  // "carrera objetivo" guardada (sección Carreras Objetivo). Así no duplicamos
  // el selector con la info de Next Target que ya se muestra arriba.
  const [nextRace, setNextRace] = useState(getNextTargetRace);
  useEffect(() => {
    const reload = () => setNextRace(getNextTargetRace());
    window.addEventListener(TARGET_RACES_EVENT, reload);
    return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
  }, []);
  const goal = useMemo(() => {
    if (!nextRace) return undefined;
    const distance = (nextRace.distance || '').toUpperCase(); // '42k' -> '42K'
    let pace;
    const km = DISTANCES[nextRace.distance];
    if (nextRace.goalTimeMin != null && km) {
      const p = nextRace.goalTimeMin / km;
      pace = `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')}`;
    }
    return { distance, pace, date: nextRace.date };
  }, [nextRace]);
  // Model list — starts with the hardcoded fallback, replaced by the live
  // ListModels response when the API key is available.
  const [availableModels, setAvailableModels] = useState(GEMINI_MODELS);

  // Fetch the real list of Gemini models via the server proxy (/api/ai/models).
  useEffect(() => {
    const ctrl = new AbortController();
    fetchGeminiModels(ctrl.signal)
      .then(models => { if (models.length) setAvailableModels(models); })
      .catch(() => { /* keep hardcoded fallback */ });
    return () => ctrl.abort();
  }, []);

  // Ref to always-current state for backup/restore inside run (avoids stale closure)
  const stateRef = useRef({ cur, trend, nextWork, lastWork, cacheTs });
  useEffect(() => { stateRef.current = { cur, trend, nextWork, lastWork, cacheTs }; }, [cur, trend, nextWork, lastWork, cacheTs]);

  // Ref to abort ongoing stream on unmount or new run
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Load Garmin cardiac (HRV/RHR/Body Battery) + weekly sleep data
  const loadGarminData = () => {
    try {
      const s = cloudStorage.getItem('garmin_cardiac_data');
      if (s) { setGarmin(JSON.parse(s)); }
      else {
        fetch('/garmin_data.json')
          .then(r => r.ok ? r.json() : null)
          .then(j => setGarmin(j?.data ?? null))
          .catch(() => setGarmin(null));
      }
    } catch { setGarmin(null); }

    try {
      const sl = cloudStorage.getItem('garmin_sleep_data');
      setSleep(sl ? JSON.parse(sl) : null);
    } catch { setSleep(null); }

    try {
      const sd = cloudStorage.getItem('stravaData');
      setStravaFetch(sd ? (JSON.parse(sd).lastFetchDate ?? null) : null);
    } catch { setStravaFetch(null); }
  };

  useEffect(() => {
    loadGarminData();
    window.addEventListener('garmin_sync_complete', loadGarminData);
    return () => window.removeEventListener('garmin_sync_complete', loadGarminData);
  }, []);

  const run = useCallback(async (force = false) => {
    if (!activities?.length || activities.length < 3) return;
    const built = buildPrompt(activities, garmin, sleep, weeklyTarget, goal);
    if (!built) return;
    const { prompt, sci: builtSci } = built;
    setSci(builtSci);

    // Check cache — key includes model so switching models bypasses cache
    if (!force) {
      try {
        const cached = cloudStorage.getItem('ai_insights_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.prompt === prompt && parsed.model === selectedModel && parsed.cur && parsed.trend) {
            setCur(parsed.cur);
            setTrend(parsed.trend);
            if (parsed.nextWork) setNextWork(parsed.nextWork);
            if (parsed.lastWork) setLastWork(parsed.lastWork);
            setCacheTs(parsed.timestamp);
            setUsedProvider(parsed.provider ?? '');
            setLoaded(true);
            return;
          }
        }
      } catch (e) {
        console.warn('Cache read error', e);
      }
    }

    // Cadena de proveedores: Gemini primero, Groq como fallback. Las API keys
    // viven en el servidor; aquí solo se indica proveedor + modelo.
    const providers = [
      {
        name: GEMINI_MODELS.find(m => m.id === selectedModel)?.label.split(' ·')[0] ?? 'Gemini',
        provider: 'gemini',
        model: selectedModel,
      },
      {
        name: 'Groq Llama',
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
      },
    ];

    // Snapshot current state via ref (avoids stale closure)
    const { cur: prevCur, trend: prevTrend, nextWork: prevNextWork, lastWork: prevLastWork, cacheTs: prevTs } = stateRef.current;
    try {
      cloudStorage.setItem('ai_insights_backup', JSON.stringify({
        cur: prevCur, trend: prevTrend, nextWork: prevNextWork, lastWork: prevLastWork, timestamp: prevTs,
      }));
    } catch { /* ignore */ }

    // Abort any previous in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true); setCur(''); setTrend(''); setNextWork(''); setLastWork(''); setUsedProvider(''); setIsFallback(false);

    let succeeded = false;
    try {
      for (let i = 0; i < providers.length; i++) {
        if (controller.signal.aborted) break;
        const provider = providers[i];
        setIsFallback(i > 0);
        setProviderLabel(i === 0
          ? `Consultando ${provider.name}…`
          : `${providers[i - 1].name} falló · probando ${provider.name}…`
        );
        try {
          const full = await streamAI(
            {
              provider: provider.provider,
              model: provider.model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.4,
              signal: controller.signal,
            },
            (_chunk, acc) => {
              const parts = acc.split('|||');
              if (parts.length >= 1) setCur(parts[0].trim());
              if (parts.length >= 2) setTrend(parts[1].trim());
              if (parts.length >= 3) setNextWork(parts[2].trim());
              if (parts.length >= 4) setLastWork(parts[3].trim());
            }
          );
          setUsedProvider(provider.name);
          const parts = full.split('|||');
          const ts = Date.now();
          setCacheTs(ts);
          cloudStorage.setItem('ai_insights_cache', JSON.stringify({
            prompt,
            model: selectedModel,
            cur: (parts[0] ?? '').trim(),
            trend: (parts[1] ?? '').trim(),
            nextWork: (parts[2] ?? '').trim(),
            lastWork: (parts[3] ?? '').trim(),
            timestamp: ts,
            provider: provider.name,
          }));
          cloudStorage.removeItem('ai_insights_backup');
          succeeded = true;
          break;
        } catch (e) {
          if (controller.signal.aborted) break;
          console.warn(`[AIInsights] ${provider.name} falló:`, e);
          setCur(''); setTrend(''); setNextWork(''); setLastWork('');
        }
      }

      if (!succeeded && !controller.signal.aborted) {
        if (prevCur) {
          setCur(prevCur); setTrend(prevTrend); setNextWork(prevNextWork); setLastWork(prevLastWork); setCacheTs(prevTs);
          setRestoreWarning(true);
          setTimeout(() => setRestoreWarning(false), 6000);
        } else {
          setCur('**Sin respuesta de ningún modelo** · Puede ser rate-limit (429). Cambia de modelo en el selector o añade `VITE_GROQ_API_KEY` para activar el fallback.');
          setTrend(''); setNextWork(''); setLastWork('');
        }
      }
    } finally {
      setProviderLabel('');
      setLoading(false);
      setLoaded(true);
    }
  }, [activities, garmin, sleep, selectedModel, weeklyTarget, goal]);

  useEffect(() => {
    if (activities?.length >= 3 && garmin !== undefined && sleep !== undefined) run(false);
  }, [activities, garmin, sleep, run]);

  if (!activities || activities.length < 3) return null;

  const hasGarmin = garmin?.length > 0;

  // ── Data freshness (last sync of each source) ───────────────────────────────
  const garminDataDate = hasGarmin
    ? [...garmin].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
    : null;
  const stravaFresh = formatDataDate(stravaFetch);
  const garminFresh = formatDataDate(garminDataDate);

  // ── Workout parser for the premium prescription ticket ──────────────────────
  // El BLOQUE 3 ahora emite un primer bullet con plantilla fija:
  //   **{Tipo}** · **{X-Y km}** · **{M:SS-M:SS min/km}** · **Zona {N} · {ppm-ppm ppm}**
  // Parseamos PRIMERO esa línea estructurada (alta confianza). Si no aparece
  // (modelo de fallback que no respeta formato), caemos a heurísticas laxas.
  const parseWorkout = (text) => {
    if (!text) return null;

    const result = { type: null, distance: null, pace: null, hrZone: null };

    // ── 1) Plantilla estructurada: localizar la línea con ≥2 separadores " · "
    //        y al menos una unidad km o ppm → es el bullet de prescripción.
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const ticketLine = lines.find(l => {
      const sepCount = (l.match(/·/g) || []).length;
      return sepCount >= 2 && /km/i.test(l) && /(ppm|zona)/i.test(l);
    });

    const stripBold = (s) => s.replace(/\*\*/g, '').trim();

    if (ticketLine) {
      // Quitar viñeta inicial y partir por " · "
      const clean = ticketLine.replace(/^[-•*▸]\s*/, '');
      const fields = clean.split('·').map(f => stripBold(f));

      const TYPES = /(Regenerativo|Aeróbico base|Aerobico base|Tempo|Intervalos|Series|Rodaje largo|Fartlek|Base)/i;

      for (const f of fields) {
        if (!result.type && TYPES.test(f)) {
          result.type = f.match(TYPES)[1];
          continue;
        }
        if (!result.distance) {
          const dm = f.match(/[0-9]+(?:[.,][0-9]+)?(?:\s*-\s*[0-9]+(?:[.,][0-9]+)?)?\s*k?m\b/i);
          if (dm) { result.distance = dm[0].replace(/\s+/g, ' ').trim(); continue; }
        }
        if (!result.pace) {
          const pm = f.match(/[0-9]+:[0-9]{2}(?:\s*-\s*[0-9]+:[0-9]{2})?\s*(?:min\/km)?/i);
          if (pm && /min\/km|:/.test(f)) { result.pace = pm[0].replace(/\s+/g, ' ').trim(); continue; }
        }
        if (!result.hrZone) {
          const zm = f.match(/Zona\s*\d+(?:\s*·?\s*[0-9]+-[0-9]+\s*ppm)?/i)
            || f.match(/[0-9]+-[0-9]+\s*ppm/i);
          if (zm) { result.hrZone = zm[0].replace(/\s+/g, ' ').trim(); continue; }
        }
      }
      // La zona puede haber quedado en el último campo combinada con ppm:
      if (!result.hrZone) {
        const zAll = clean.match(/Zona\s*\d+(?:\s*·?\s*[0-9]+-[0-9]+\s*ppm)?/i);
        if (zAll) result.hrZone = zAll[0].replace(/\s+/g, ' ').trim();
      }
    }

    // ── 2) Fallback heurístico sobre todo el texto para campos que falten ────
    if (!result.type) {
      const tm = text.match(/\*\*(Regenerativo|Aeróbico base|Tempo|Intervalos|Rodaje largo|Fartlek|Series|Base)\*\*/i)
        || text.match(/(Regenerativo|Aeróbico base|Tempo|Intervalos|Rodaje largo|Fartlek|Series|Base)/i);
      if (tm) result.type = tm[1];
    }
    if (!result.distance) {
      const dm = text.match(/\*\*([0-9]+(?:[.,][0-9]+)?(?:\s*-\s*[0-9]+(?:[.,][0-9]+)?)?\s*k?m)\*\*/i)
        || text.match(/([0-9]+(?:[.,][0-9]+)?(?:\s*-\s*[0-9]+(?:[.,][0-9]+)?)?\s*km)\b/i);
      if (dm) result.distance = dm[1].replace(/\s+/g, ' ').trim();
    }
    if (!result.pace) {
      const pm = text.match(/\*\*([0-9]+:[0-9]{2}(?:\s*-\s*[0-9]+:[0-9]{2})?\s*min\/km)\*\*/i)
        || text.match(/([0-9]+:[0-9]{2}(?:\s*-\s*[0-9]+:[0-9]{2})?\s*min\/km)/i)
        || text.match(/([0-9]+:[0-9]{2}(?:\s*-\s*[0-9]+:[0-9]{2}))/i);
      if (pm) result.pace = pm[1].replace(/\s+/g, ' ').trim();
    }
    if (!result.hrZone) {
      const hm = text.match(/\*\*(Zona \d+(?:\s*·\s*[0-9]+-[0-9]+\s*ppm)?)\*\*/i)
        || text.match(/(Zona \d+\s*·?\s*[0-9]+-[0-9]+\s*ppm)/i)
        || text.match(/(Zona \d+)/i)
        || text.match(/([0-9]+-[0-9]+\s*ppm)/i);
      if (hm) result.hrZone = hm[1].replace(/\s+/g, ' ').trim();
    }

    // Normaliza defaults sólo en el render (mantén null aquí para distinguir).
    return {
      type: result.type || 'Base Aeróbica',
      distance: result.distance,
      pace: result.pace,
      hrZone: result.hrZone,
    };
  };

  // Pasa el análisis actual al chat (RunQA) como contexto para preguntas de seguimiento.
  const openInChat = () => {
    try {
      const seed = {
        ts: Date.now(),
        blocks: { cur, trend, nextWork, lastWork },
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

  // ── Badge de estado derivado del diagnóstico (cur) ──────────────────────────
  const curBadge = (() => {
    if (!cur) return null;
    const text = cur.toLowerCase();
    if (text.includes('fatig') || text.includes('cansad'))
      return { text: 'Fatiga ⚠️', color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-900/50' };
    if (text.includes('recuperad') || text.includes('estable'))
      return { text: 'Recuperado ✅', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50' };
    if (text.includes('sobreentren'))
      return { text: 'Sobreentrenamiento 🚨', color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50' };
    if (text.includes('forma') || text.includes('óptim') || text.includes('fuerte'))
      return { text: 'En Forma ⚡', color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/50' };
    return { text: 'Adaptativo 📈', color: 'bg-slate-50 text-slate-650 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' };
  })();

  // ── Constantes de apoyo (rail bajo el diagnóstico) ──────────────────────────
  const vitalPills = (() => {
    const pills = [];
    const h = sci?.hrv;
    if (h) pills.push({ k: 'VFC', v: `${h.latest} ms`, c: h.latest < h.baseline?.balancedLow ? 'text-rose-500' : 'text-emerald-500' });
    if (sci?.bb?.high != null) pills.push({ k: 'Body Batt.', v: `${sci.bb.high}/100`, c: sci.bb.high >= 70 ? 'text-emerald-500' : 'text-amber-500' });
    if (sci?.sleep?.score != null) pills.push({ k: 'Sueño', v: `${sci.sleep.score}/100`, c: sci.sleep.score >= 75 ? 'text-emerald-500' : 'text-amber-500' });
    if (sci?.pmc) pills.push({ k: 'TSB', v: sci.pmc.tsb > 0 ? `+${sci.pmc.tsb}` : `${sci.pmc.tsb}`, c: sci.pmc.tsb >= 5 ? 'text-emerald-500' : sci.pmc.tsb >= -10 ? 'text-amber-500' : 'text-rose-500' });
    if (sci?.pmc?.acwr != null) pills.push({ k: 'ACWR', v: `${sci.pmc.acwr}`, c: sci.pmc.acwr > 1.5 ? 'text-rose-500' : 'text-slate-600 dark:text-slate-300' });
    if (sci?.lt?.lt1Hr) pills.push({ k: 'LT1', v: `${sci.lt.lt1Hr} ppm`, c: 'text-sky-600 dark:text-sky-400' });
    if (sci?.lt?.lt2Hr) pills.push({ k: 'LT2', v: `${sci.lt.lt2Hr} ppm`, c: 'text-rose-500 dark:text-rose-450' });
    return pills;
  })();

  // ── Configuración compacta (popover reutilizado en la cabecera) ─────────────
  const controls = (
    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
      <button
        onClick={() => { setLoaded(false); run(true); }}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-750 disabled:opacity-40 shadow-sm transition-all"
      >
        <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        <span>{loading ? 'Analizando…' : 'Recalcular'}</span>
      </button>

      {/* Ajustes Popover */}
      <div className="relative" ref={cfgRef}>
        <button
          onClick={() => setCfgOpen(o => !o)}
          disabled={loading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${cfgOpen ? 'text-blue-600 bg-blue-50/50 border-blue-200' : 'text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-750 hover:bg-slate-50'}`}
        >
          <Cog6ToothIcon className={`w-3.5 h-3.5 transition-transform ${cfgOpen ? 'rotate-45' : ''}`} />
          <span>{weeklyTarget}×/sem</span>
          {goal && <span className="text-slate-300">·</span>}
          {goal && <span>🎯 {goal.distance}</span>}
        </button>

        {cfgOpen && (
          <div className="absolute right-0 top-full mt-2 w-60 z-30 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-md p-4 space-y-3">
            <div>
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Correr / semana</label>
              <select
                value={weeklyTarget}
                disabled={loading}
                onChange={e => {
                  const v = e.target.value;
                  cloudStorage.setItem('ai_weekly_target', v);
                  setWeeklyTarget(v);
                  setLoaded(false);
                }}
                className="w-full text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 pr-8 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 transition-colors cursor-pointer appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
              >
                {[2, 3, 4, 5, 6].map(n => (
                  <option key={n} value={String(n)}>{n}×/sem</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Modelo IA</label>
              <select
                value={selectedModel}
                disabled={loading}
                onChange={e => {
                  const m = e.target.value;
                  cloudStorage.setItem('ai_insights_model', m);
                  setSelectedModel(m);
                  setLoaded(false);
                }}
                className="w-full text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 pr-8 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 transition-colors cursor-pointer appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
              >
                {availableModels.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

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
    <div className="space-y-3">

      {/* ═══════════════ HERO · DIAGNÓSTICO IA (protagonista) ═══════════════ */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        <div className="absolute inset-x-0 top-0 h-[3px] kinetic-gradient" />

        {/* Cabecera: identidad + controles */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 shrink-0">
              <SparklesIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-slate-850 dark:text-slate-100 leading-tight">
                Diagnóstico IA
              </h3>
              <p className="text-[10px] text-slate-400 font-semibold mt-0.5 truncate">
                {usedProvider || 'Gemini'}{cacheTs && !loading ? ` · ${formatTs(cacheTs)}` : ''} · Garmin + Strava
              </p>
            </div>
          </div>
          {controls}
        </div>

        {/* Cuerpo: readiness (apoyo) + diagnóstico (foco) */}
        <div className="px-5 pb-5">
          <div className="flex flex-col sm:flex-row gap-5">
            {/* Anillo de readiness — contexto */}
            <div className="flex sm:flex-col items-center gap-3 sm:gap-2 shrink-0 sm:w-[88px]">
              {(() => {
                const r = sci?.readiness;
                const score = r?.score ?? 0;
                const band = r?.band ?? 'good';
                const ringColor = band === 'high' ? 'text-emerald-500' : band === 'good' ? 'text-blue-500' : band === 'mod' ? 'text-amber-500' : 'text-rose-500';
                const ringBg = band === 'high' ? 'stroke-emerald-500' : band === 'good' ? 'stroke-blue-500' : band === 'mod' ? 'stroke-amber-500' : 'stroke-rose-500';
                const R = 32, C = 2 * Math.PI * R, off = C * (1 - score / 100);
                return (
                  <div className="relative w-[76px] h-[76px] shrink-0">
                    <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                      <circle cx="40" cy="40" r={R} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="6" fill="none" />
                      <circle cx="40" cy="40" r={R} className={ringBg} strokeWidth="6" fill="none"
                        strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off}
                        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center -space-y-0.5">
                      <span className={`font-black text-xl tabular-nums leading-none ${ringColor}`}>{score || '—'}</span>
                      <span className="text-[7px] font-bold uppercase tracking-[0.15em] text-slate-400">READY</span>
                    </div>
                  </div>
                );
              })()}
              {sci?.readiness && (() => {
                const { label, band } = sci.readiness;
                const c = band === 'high' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50'
                  : band === 'good' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/50'
                    : band === 'mod' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50';
                return <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border text-center ${c}`}>{label}</span>;
              })()}
            </div>

            {/* Diagnóstico — protagonista */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2.5">
                <HeartIcon className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Estado Fisiológico</span>
                {curBadge && (
                  <span className={`ml-auto px-2 py-0.5 rounded text-[9px] font-bold border ${curBadge.color}`}>
                    {curBadge.text}
                  </span>
                )}
              </div>
              <div className="min-h-[84px]">
                {loading && !cur ? <Pulse /> : <MD text={cur} accent="text-blue-500" lg />}
              </div>
            </div>
          </div>

          {/* Rail de constantes — apoyo */}
          {vitalPills.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-1.5">
              {vitalPills.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/50">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{p.k}</span>
                  <span className={`text-[11px] font-bold tabular-nums ${p.c}`}>{p.v}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

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
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-55 border border-amber-200/50 rounded-xl text-[11px] text-amber-800 font-semibold">
          <span className="shrink-0 text-sm">⚠️</span>
          <span>Falló la actualización — mostrando la recomendación anterior guardada.</span>
          <button
            onClick={() => setRestoreWarning(false)}
            className="ml-auto text-amber-400 hover:text-amber-600 transition-colors font-bold leading-none"
          >✕</button>
        </div>
      )}

      {/* ── Últimas actividades analizadas (tira compacta en una línea) ── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
          <ClockIcon className="w-3.5 h-3.5" />
          Últimas 5 actividades
        </span>
        <div className="flex flex-wrap gap-2">
          {[...activities].sort((a, b) => new Date(b.start_date) - new Date(a.start_date)).slice(0, 5).map(a => {
            const tooltipParts = [];
            if (a.name) tooltipParts.push(a.name);
            tooltipParts.push(new Date(a.start_date).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
            if (a.total_elevation_gain) tooltipParts.push(`Desnivel: +${Math.round(a.total_elevation_gain)}m`);
            if (a.average_heartrate) tooltipParts.push(`FC Media: ${Math.round(a.average_heartrate)} ppm`);
            if (a.suffer_score) tooltipParts.push(`Esfuerzo: ${a.suffer_score}`);

            return (
              <div key={a.id} title={tooltipParts.join('\n')} className="flex items-center gap-1.5 px-2 py-1 bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 rounded-md cursor-help hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <span className="text-[9px] text-slate-400 font-medium border-r border-slate-200 dark:border-slate-700 pr-1.5">
                  {new Date(a.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                  <span>
                    {a.type === 'Ride' || a.type === 'VirtualRide' ? '🚴' :
                      a.type === 'Run' || a.type === 'TrailRun' || a.type === 'VirtualRun' ? '🏃' :
                        a.type === 'Swim' ? '🏊' :
                          a.type === 'Walk' || a.type === 'Hike' ? '🚶' :
                            a.type === 'WeightTraining' ? '🏋️' :
                              a.type === 'Yoga' ? '🧘' : '👟'}
                  </span>
                  {a.distance > 0 ? `${(a.distance / 1000).toFixed(1)}k` : `${Math.round((a.moving_time || 0) / 60)}min`}
                </span>
                {a.moving_time > 0 && a.distance > 0 && ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'].includes(a.type) && (
                  <span className="text-[9px] text-slate-400 font-medium border-l border-slate-200 dark:border-slate-700 pl-1.5">
                    {(() => {
                      const p = (a.moving_time / 60) / (a.distance / 1000);
                      return `${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`;
                    })()}
                  </span>
                )}
                {a.moving_time > 0 && a.distance > 0 && ['Ride', 'VirtualRide'].includes(a.type) && (
                  <span className="text-[9px] text-slate-400 font-medium border-l border-slate-200 dark:border-slate-700 pl-1.5">
                    {((a.distance / 1000) / (a.moving_time / 3600)).toFixed(1)} km/h
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {(stravaFresh || garminFresh) && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {stravaFresh && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400" title="Última actualización de datos de Strava">
                <ArrowPathIcon className="w-3 h-3 text-orange-400" />
                <span className="text-slate-500 dark:text-slate-400">Strava</span>
                <span className="text-slate-400 font-medium">{stravaFresh}</span>
              </span>
            )}
            {garminFresh && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400" title="Datos de Garmin disponibles hasta esta fecha">
                <ArrowPathIcon className="w-3 h-3 text-blue-400" />
                <span className="text-slate-500 dark:text-slate-400">Garmin</span>
                <span className="text-slate-400 font-medium">{garminFresh}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ═══════════ ACCIÓN PRIORITARIA · SIGUIENTE SESIÓN ═══════════ */}
      {(nextWork || (loading && cur)) && (
        <div className="rounded-2xl border border-blue-200/70 dark:border-blue-900/50 bg-gradient-to-br from-blue-50/80 via-white to-white dark:from-blue-950/25 dark:via-slate-900 dark:to-slate-900 shadow-sm overflow-hidden">
          <div className="p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
                <BoltIcon className="w-4.5 h-4.5" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 block">Siguiente Sesión Recomendada</span>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Prescripción para tus próximos 1-2 días</span>
              </div>
            </div>

            {loading && !nextWork ? (
              <Pulse />
            ) : (
              (() => {
                const w = parseWorkout(nextWork);
                const badgeCls = w?.type?.toLowerCase().includes('regen') ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40'
                  : w?.type?.toLowerCase().includes('tempo') ? 'bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40'
                    : w?.type?.toLowerCase().includes('interv') || w?.type?.toLowerCase().includes('seri') ? 'bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/40'
                      : 'bg-blue-50 text-blue-700 border-blue-200/60 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40';
                const metrics = [
                  { k: 'Distancia', v: w?.distance || 'Varía' },
                  { k: 'Ritmo Objetivo', v: w?.pace || 'Aeróbico' },
                  { k: 'Intensidad / FC', v: w?.hrZone || 'Zona 2' },
                ];
                return (
                  <div className="space-y-3">
                    {/* Tira de prescripción compacta */}
                    <div className="flex flex-col md:flex-row md:items-center gap-4 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/60 rounded-xl p-3">
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${badgeCls}`}>
                          {w?.type || 'Sesión Base'}
                        </span>
                      </div>
                      <div className="flex-grow grid grid-cols-3 divide-x divide-slate-100 dark:divide-slate-800">
                        {metrics.map(m => (
                          <div key={m.k} className="px-3 text-center first:pl-0 last:pr-0">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider mb-0.5">{m.k}</span>
                            <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 truncate block leading-normal">{m.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Guías de ejecución a todo el ancho */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/65 dark:border-slate-800/65 rounded-xl p-3">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-2">Instrucciones del Entrenamiento</span>
                      <MD text={nextWork} accent="text-blue-500" />
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}

      {/* ═══════════ ANÁLISIS SECUNDARIO IA · TENDENCIA + ÚLTIMO ═══════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {/* Tendencia de rendimiento */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm border-l-4 border-l-indigo-500 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ArrowTrendingUpIcon className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tendencia de Rendimiento</span>
            </div>

            {trend && (() => {
              const text = trend.toLowerCase();
              let badge = { text: 'Estacional 📅', color: 'bg-slate-50 text-slate-650 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' };
              const negated = /interrump|estanc|meseta|estabil|caíd|caid|pérdida|perdida|insuficien|frena|detien/.test(text);
              if (text.includes('lesi') || text.includes('dolor') || text.includes('riesgo')) {
                badge = { text: 'Riesgo Lesión ⚠️', color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/50' };
              } else if (text.includes('estanc') || text.includes('meseta') || text.includes('estabil') || text.includes('interrump') || text.includes('insuficien')) {
                badge = { text: 'Estable 📊', color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50' };
              } else if ((text.includes('progres') || text.includes('mejor')) && !negated) {
                badge = { text: 'Progresión 📈', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/50' };
              }
              return (
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${badge.color}`}>
                  {badge.text}
                </span>
              );
            })()}
          </div>

          <div className="bg-slate-50/50 dark:bg-slate-800/10 rounded-xl p-3 border border-slate-200/50 dark:border-slate-800/30 min-h-[92px] flex-1 flex flex-col justify-center">
            {loading && !trend ? <Pulse /> : <MD text={trend} accent="text-indigo-500" />}
          </div>
        </div>

        {/* Análisis del último entrenamiento */}
        {(() => {
          const last = [...activities].sort((a, b) => new Date(b.start_date) - new Date(a.start_date))[0];
          const km = last ? last.distance / 1000 : 0;
          const min = last ? (last.moving_time || 0) / 60 : 0;
          const isRun = last && ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'].includes(last.type);
          const meta = [];
          if (km > 0) meta.push(`${km.toFixed(1)} km`);
          if (min > 0) meta.push(`${Math.round(min)} min`);
          if (km > 0 && min > 0 && isRun) {
            const p = min / km;
            meta.push(`${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`);
          } else if (last && km > 0 && min > 0 && ['Ride', 'VirtualRide'].includes(last.type)) {
            meta.push(`${(km / (min / 60)).toFixed(1)} km/h`);
          }
          if (last?.average_heartrate) meta.push(`${Math.round(last.average_heartrate)} ppm`);
          if (last?.total_elevation_gain) meta.push(`+${Math.round(last.total_elevation_gain)} m`);
          const icon = !last ? '👟'
            : last.type === 'Ride' || last.type === 'VirtualRide' ? '🚴'
              : last.type === 'Swim' ? '🏊'
                : last.type === 'Walk' || last.type === 'Hike' ? '🚶'
                  : last.type === 'WeightTraining' ? '🏋️'
                    : last.type === 'Yoga' ? '🧘'
                      : isRun ? '🏃' : '👟';
          return (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm border-l-4 border-l-amber-500 flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <FireIcon className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">Último Entreno</span>
                </div>
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 truncate">
                  {icon} {last?.name || 'Sesión'}
                </span>
              </div>
              {meta.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {meta.map((m, idx) => (
                    <span key={idx} className="px-2 py-0.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-650 dark:text-slate-350 font-bold rounded text-[9px] tabular-nums">
                      {m}
                    </span>
                  ))}
                </div>
              )}
              <div className="bg-slate-50/50 dark:bg-slate-800/10 rounded-xl p-3 border border-slate-200/50 dark:border-slate-800/30 min-h-[92px] flex-1 flex flex-col justify-center">
                {loading && !lastWork ? <Pulse /> : <MD text={lastWork} accent="text-amber-500" />}
              </div>
            </div>
          );
        })()}

      </div>


      {/* ── FOOTER & ACTION PANEL ── */}
      <div className="border-t border-slate-200/60 dark:border-slate-800/60 pt-3 flex flex-col sm:flex-row items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-1.5 min-w-0 self-start sm:self-center">
          <SparklesIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-[10px] text-slate-400 font-semibold truncate">
            Módulo de asistencia inteligente IA · Garmin Connect Sync Activo
          </span>
        </div>
        {onOpenChat && (cur || trend || nextWork) && (
          <button
            onClick={openInChat}
            className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 dark:text-blue-450 bg-blue-50 dark:bg-blue-950/30 border border-blue-100/50 dark:border-blue-900/50 hover:bg-blue-100/80 hover:text-blue-700 transition-all"
          >
            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
            <span>Consultar Coach Virtual</span>
          </button>
        )}
      </div>

    </div>
  );
};

export default AIInsights;
