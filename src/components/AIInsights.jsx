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
} from '@heroicons/react/24/outline';
import { buildPrompt } from '../lib/athleteContext';
import { formatPace } from '../lib/lactateThreshold';
import { getNextTargetRace, DISTANCES, TARGET_RACES_EVENT } from '../lib/targetRaces';

// ── Inline markdown renderer (bold + bullet lists) ──────────────────────────
const MD = ({ text, accent }) => {
  if (!text) return null;
  const inline = (str) => {
    const parts = []; let rem = str, k = 0;
    while (rem) {
      const m = rem.match(/\*\*(.+?)\*\*/);
      if (m?.index !== undefined) {
        if (m.index > 0) parts.push(<span key={k++}>{rem.slice(0, m.index)}</span>);
        parts.push(<strong key={k++} className="font-semibold text-slate-800">{m[1]}</strong>);
        rem = rem.slice(m.index + m[0].length); continue;
      }
      parts.push(<span key={k++}>{rem}</span>); break;
    }
    return parts;
  };
  return (
    <ul className="space-y-1.5">
      {text.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => (
        <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-slate-600">
          <span className={`shrink-0 mt-[3px] font-bold text-[10px] ${accent}`}>▸</span>
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

  return (
    <div className="bg-white/70 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-100 rounded-3xl overflow-hidden transition-all duration-300 relative">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100/60 bg-white/40">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-50/80 text-blue-600 shadow-sm">
            <SparklesIcon className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 leading-tight">Diagnóstico IA</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
              {hasGarmin ? 'Wearable VFC & Pulso · Carga de Entrenamiento' : 'Carga & Ritmos de Actividad Strava'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {cacheTs && !loading && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-slate-400 font-semibold">
              <ClockIcon className="w-3.5 h-3.5" />
              {formatTs(cacheTs)}
            </span>
          )}
          <select
            value={weeklyTarget}
            disabled={loading}
            title="Sesiones de carrera por semana que quieres hacer"
            onChange={e => {
              const v = e.target.value;
              cloudStorage.setItem('ai_weekly_target', v);
              setWeeklyTarget(v);
              setLoaded(false);
            }}
            className="text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 pr-7 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none shadow-sm"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {[2, 3, 4, 5, 6].map(n => (
              <option key={n} value={String(n)}>{n}×/sem</option>
            ))}
          </select>
          {goal && (
            <span
              title="Objetivo derivado de tu próxima carrera objetivo"
              className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 font-bold shadow-sm"
            >
              🎯 {goal.distance}{goal.pace ? ` · ${goal.pace}` : ''}
            </span>
          )}
          <select
            value={selectedModel}
            disabled={loading}
            onChange={e => {
              const m = e.target.value;
              cloudStorage.setItem('ai_insights_model', m);
              setSelectedModel(m);
              setLoaded(false);
            }}
            className="text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 pr-7 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none shadow-sm"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {availableModels.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button
            onClick={() => { setLoaded(false); run(true); }}
            disabled={loading}
            title="Recalcular diagnóstico"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 disabled:opacity-30 transition-all border border-transparent hover:border-blue-100"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Analizando…' : 'Recalcular'}</span>
          </button>
        </div>
      </div>

      {/* ── Scientific readiness panel ── */}
      {sci?.readiness && (() => {
        const { score, label, band } = sci.readiness;
        const ring = band === 'high' ? 'text-emerald-600' : band === 'good' ? 'text-blue-600' : band === 'mod' ? 'text-amber-600' : 'text-rose-600';
        const ringBg = band === 'high' ? 'stroke-emerald-500' : band === 'good' ? 'stroke-blue-500' : band === 'mod' ? 'stroke-amber-500' : 'stroke-rose-500';
        const chips = [];
        const h = sci.hrv;
        if (h) {
          const inBase = h.baseline?.balancedLow != null
            ? (h.latest < h.baseline.balancedLow ? 'bajo baseline' : h.latest > h.baseline.balancedUpper ? 'sobre baseline' : 'en rango')
            : (h.status || '');
          chips.push({ k: 'VFC', v: `${h.latest}ms`, s: inBase });
        }
        if (sci.bb?.high != null) chips.push({ k: 'Body Battery', v: `${sci.bb.high}/100`, s: sci.bb.high >= 70 ? 'recuperado' : sci.bb.high >= 40 ? 'parcial' : 'bajo' });
        if (sci.sleep?.score != null) chips.push({ k: 'Sueño', v: `${sci.sleep.score}/100`, s: sci.sleep.durationMin ? `${(sci.sleep.durationMin / 60).toFixed(1)}h` : '' });
        if (sci.pmc) chips.push({ k: 'Forma TSB', v: `${sci.pmc.tsb > 0 ? '+' : ''}${sci.pmc.tsb}`, s: `ACWR ${sci.pmc.acwr ?? '—'}` });
        const R = 22, C = 2 * Math.PI * R, off = C * (1 - score / 100);
        return (
          <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-100/60 bg-gradient-to-r from-slate-50/40 to-white/20">
            <div className="relative shrink-0 w-[58px] h-[58px]">
              <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
                <circle cx="28" cy="28" r={R} className="stroke-slate-100" strokeWidth="5" fill="none" />
                <circle cx="28" cy="28" r={R} className={ringBg} strokeWidth="5" fill="none"
                  strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off}
                  style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
              </svg>
              <div className={`absolute inset-0 flex items-center justify-center font-black text-base tabular-nums ${ring}`}>{score}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">Readiness</span>
                <span className={`text-[10px] font-bold ${ring}`}>{label}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {chips.map(c => (
                  <span key={c.k} className="text-[10px] text-slate-400 font-medium">
                    {c.k} <span className="font-bold text-slate-600 tabular-nums">{c.v}</span>{c.s ? ` · ${c.s}` : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Umbrales LT1 / LT2 (modelo centralizado de lactato) ── */}
      {sci?.lt && (sci.lt.lt1Hr || sci.lt.lt2Hr) && (() => {
        const { lt1Hr, lt2Hr, lt1Pace, lt2Pace, csValid, trend, lthrIsEstimate } = sci.lt;
        const trendCfg = trend === 'mejorando'
          ? { c: 'text-emerald-600', a: '↑' }
          : trend === 'empeorando'
            ? { c: 'text-rose-600', a: '↓' }
            : { c: 'text-amber-600', a: '→' };
        const Cell = ({ tag, color, hr, pace, hint }) => (
          <div className="flex-1 bg-white/70 rounded-2xl p-3 border border-slate-100/60">
            <div className="flex items-baseline justify-between mb-0.5">
              <span className={`text-[10px] font-black uppercase tracking-wider ${color}`}>{tag}</span>
              {hint && <span className="text-[9px] text-slate-400 font-semibold">{hint}</span>}
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-black text-slate-800 tabular-nums">{hr}<span className="text-[10px] font-semibold text-slate-400"> ppm</span></span>
              {pace && pace > 0 && (
                <span className="text-[11px] font-bold text-slate-400 tabular-nums">· {formatPace(pace)}/km</span>
              )}
            </div>
          </div>
        );
        return (
          <div className="px-5 py-3 border-b border-slate-100/60 bg-gradient-to-r from-sky-50/30 to-blue-50/10">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">Umbrales</span>
              <span className="text-[10px] text-slate-400 font-semibold">· FC de entrenamiento (LT1 / LT2)</span>
              {trend && (
                <span className={`ml-auto text-[10px] font-bold ${trendCfg.c}`} title="Tendencia del LT2 (Critical Speed / cross-check FC)">
                  {trendCfg.a} LT2 {trend}
                </span>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <Cell tag="LT1 · Aeróbico" color="text-sky-600" hr={lt1Hr} pace={lt1Pace}
                hint="techo del fácil" />
              <Cell tag="LT2 · Umbral" color="text-blue-600" hr={lt2Hr} pace={lt2Pace}
                hint={csValid ? 'Critical Speed' : lthrIsEstimate ? 'estimado' : 'campo'} />
            </div>
            <p className="text-[10px] text-slate-400 font-medium mt-2 leading-relaxed">
              💡 Corre el <strong className="text-slate-500">80% del volumen por debajo de LT1 ({lt1Hr} ppm)</strong>; reserva LT2 ({lt2Hr} ppm) para tempo/series.
            </p>
          </div>
        );
      })()}

      {/* ── Loading status banner ── */}
      {loading && providerLabel && (
        <div className={`flex items-center gap-2 px-5 py-2.5 border-b text-[11px] font-bold ${isFallback
          ? 'bg-amber-50/70 border-amber-100 text-amber-700'
          : 'bg-blue-50/70 border-blue-100 text-blue-600'
          }`}>
          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin shrink-0" />
          {providerLabel}
        </div>
      )}

      {/* ── Restore warning banner ── */}
      {restoreWarning && (
        <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-50/70 border-b border-amber-100 text-[11px] text-amber-700 font-bold">
          <span className="shrink-0">⚠</span>
          Falló la actualización — mostrando la recomendación anterior guardada.
          <button
            onClick={() => setRestoreWarning(false)}
            className="ml-auto text-amber-400 hover:text-amber-600 transition-colors font-bold leading-none"
          >✕</button>
        </div>
      )}

      {/* ── Últimas actividades analizadas ── */}
      <div className="px-5 py-2.5 border-b border-slate-100/60 bg-slate-50/30 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
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
              <div key={a.id} title={tooltipParts.join('\n')} className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200/80 rounded-md shadow-[0_1px_2px_rgba(0,0,0,0.02)] cursor-help hover:bg-slate-50 transition-colors">
                <span className="text-[9px] text-slate-400 font-medium border-r border-slate-100 pr-1.5">
                  {new Date(a.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-[10px] font-bold text-slate-700 flex items-center gap-1">
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
                  <span className="text-[9px] text-slate-400 font-medium border-l border-slate-100 pl-1.5">
                    {(() => {
                      const p = (a.moving_time / 60) / (a.distance / 1000);
                      return `${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`;
                    })()}
                  </span>
                )}
                {a.moving_time > 0 && a.distance > 0 && ['Ride', 'VirtualRide'].includes(a.type) && (
                  <span className="text-[9px] text-slate-400 font-medium border-l border-slate-100 pl-1.5">
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
                <span className="text-slate-500">Strava</span>
                <span className="text-slate-400 font-medium">{stravaFresh}</span>
              </span>
            )}
            {garminFresh && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400" title="Datos de Garmin disponibles hasta esta fecha">
                <ArrowPathIcon className="w-3 h-3 text-blue-400" />
                <span className="text-slate-500">Garmin</span>
                <span className="text-slate-400 font-medium">{garminFresh}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Análisis del último entrenamiento ── */}
      {(lastWork || (loading && cur)) && (() => {
        const last = [...activities].sort((a, b) => new Date(b.start_date) - new Date(a.start_date))[0];
        if (!last) return null;
        const km = last.distance / 1000;
        const min = (last.moving_time || 0) / 60;
        const isRun = ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'].includes(last.type);
        const meta = [];
        if (km > 0) meta.push(`${km.toFixed(1)} km`);
        if (min > 0) meta.push(`${Math.round(min)} min`);
        if (km > 0 && min > 0 && isRun) {
          const p = min / km;
          meta.push(`${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`);
        } else if (km > 0 && min > 0 && ['Ride', 'VirtualRide'].includes(last.type)) {
          meta.push(`${(km / (min / 60)).toFixed(1)} km/h`);
        }
        if (last.average_heartrate) meta.push(`${Math.round(last.average_heartrate)} ppm`);
        if (last.total_elevation_gain) meta.push(`+${Math.round(last.total_elevation_gain)} m`);
        const icon = last.type === 'Ride' || last.type === 'VirtualRide' ? '🚴'
          : last.type === 'Swim' ? '🏊'
            : last.type === 'Walk' || last.type === 'Hike' ? '🚶'
              : last.type === 'WeightTraining' ? '🏋️'
                : last.type === 'Yoga' ? '🧘'
                  : isRun ? '🏃' : '👟';
        return (
          <div className="border-b border-slate-100/60 bg-gradient-to-r from-amber-50/20 to-rose-50/10 px-5 py-4">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="p-1.5 rounded-xl bg-amber-50 text-amber-600 shadow-sm border border-amber-100/40">
                <FireIcon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">Análisis del último entrenamiento</span>
                <span className="text-[10px] text-slate-400 font-semibold truncate block">
                  {icon} {last.name ? `${last.name} · ` : ''}{new Date(last.start_date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}
                  {meta.length ? ` · ${meta.join(' · ')}` : ''}
                </span>
              </div>
            </div>
            <div className="bg-white/60 rounded-2xl p-4 border border-slate-100/60">
              {loading && !lastWork ? <Pulse /> : <MD text={lastWork} accent="text-amber-500" />}
            </div>
          </div>
        );
      })()}

      {/* ── Content grid: Diagnosis + Trend ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100/60">

        {/* Block 1: Current state */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HeartIcon className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Estado actual</span>
              <span className="text-[10px] text-slate-400 font-medium">· últimas 4 semanas</span>
            </div>
            {cur && (() => {
              const text = cur.toLowerCase();
              let badge = { text: 'Adaptativo 📈', color: 'bg-slate-50 text-slate-600 border-slate-200' };
              if (text.includes('fatig') || text.includes('cansad')) {
                badge = { text: 'Fatiga acumulada ⚠️', color: 'bg-orange-50 text-orange-700 border-orange-200' };
              } else if (text.includes('recuperad') || text.includes('estable')) {
                badge = { text: 'Recuperado ✅', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
              } else if (text.includes('sobreentren')) {
                badge = { text: 'Sobreentrenamiento 🚨', color: 'bg-rose-50 text-rose-700 border-rose-200' };
              } else if (text.includes('forma') || text.includes('óptim') || text.includes('fuerte')) {
                badge = { text: 'En forma ⚡', color: 'bg-blue-50 text-blue-700 border-blue-200' };
              }
              return (
                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${badge.color}`}>
                  {badge.text}
                </span>
              );
            })()}
          </div>

          <div className="bg-slate-50/40 rounded-2xl p-4 border border-slate-100/50 hover:bg-slate-50/70 transition-colors duration-300">
            {loading && !cur ? <Pulse /> : <MD text={cur} accent="text-blue-500" />}
          </div>
        </div>

        {/* Block 2: Annual trend */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowTrendingUpIcon className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Tendencia y patrón</span>
              <span className="text-[10px] text-slate-400 font-medium">· últimos 2 meses</span>
            </div>
            {trend && (() => {
              const text = trend.toLowerCase();
              let badge = { text: 'Estacional 📅', color: 'bg-slate-50 text-slate-600 border-slate-200' };
              // Prioridad: riesgo > meseta/interrumpida > progresión. Evita que
              // "progresión interrumpida/estancada" se etiquete como progresión real.
              const negated = /interrump|estanc|meseta|estabil|caíd|caid|pérdida|perdida|insuficien|frena|detien/.test(text);
              if (text.includes('lesi') || text.includes('dolor') || text.includes('riesgo')) {
                badge = { text: 'Riesgo de lesión ⚠️', color: 'bg-rose-50 text-rose-700 border-rose-200' };
              } else if (text.includes('estanc') || text.includes('meseta') || text.includes('estabil') || text.includes('interrump') || text.includes('insuficien')) {
                badge = { text: 'Meseta / Estable 📊', color: 'bg-amber-50 text-amber-700 border-amber-200' };
              } else if ((text.includes('progres') || text.includes('mejor')) && !negated) {
                badge = { text: 'Progresión constante 📈', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
              }
              return (
                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${badge.color}`}>
                  {badge.text}
                </span>
              );
            })()}
          </div>

          <div className="bg-slate-50/40 rounded-2xl p-4 border border-slate-100/50 hover:bg-slate-50/70 transition-colors duration-300">
            {loading && !trend ? <Pulse /> : <MD text={trend} accent="text-indigo-500" />}
          </div>
        </div>
      </div>

      {/* ── Block 3: Next workout ── */}
      {(nextWork || (loading && cur && trend && !nextWork)) && (
        <div className="border-t border-slate-100/60 bg-gradient-to-r from-blue-50/10 to-indigo-50/10 p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="p-1.5 rounded-xl bg-blue-50 text-blue-600 shadow-sm border border-blue-100/40">
              <BoltIcon className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">Sesión Recomendada</span>
              <span className="text-[10px] text-slate-400 font-semibold">Prescripción de running sugerida para tus próximos 1-2 días</span>
            </div>
          </div>

          {loading && !nextWork ? (
            <Pulse />
          ) : (
            <div className="flex flex-col lg:flex-row gap-5 items-stretch">
              {/* Prescription Ticket Badge */}
              {(() => {
                const w = parseWorkout(nextWork);
                return (
                  <>
                    <div className="flex-1 bg-white border border-slate-100/70 rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col justify-between relative overflow-hidden">
                      <div className="absolute right-0 top-0 w-24 h-24 rounded-full bg-blue-500/5 blur-2xl pointer-events-none" />

                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Prescripción IA</span>
                          <span className={`inline-flex items-center px-3 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${w?.type?.toLowerCase().includes('regen') ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/60' :
                            w?.type?.toLowerCase().includes('tempo') ? 'bg-amber-50 text-amber-700 border border-amber-100/60' :
                              w?.type?.toLowerCase().includes('interv') || w?.type?.toLowerCase().includes('seri') ? 'bg-rose-50 text-rose-700 border border-rose-100/60' :
                                'bg-blue-50 text-blue-700 border border-blue-100/60'
                            }`}>
                            {w?.type || 'Sesión Base'}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100/30 text-center">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider mb-1">Distancia</span>
                            <span className="text-xs font-black text-slate-800 truncate block">
                              {w?.distance || 'Varía'}
                            </span>
                          </div>
                          <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100/30 text-center">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider mb-1">Ritmo Objetivo</span>
                            <span className="text-xs font-black text-slate-800 truncate block">
                              {w?.pace || 'Aeróbico'}
                            </span>
                          </div>
                          <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100/30 text-center">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider mb-1">Intensidad</span>
                            <span className="text-xs font-black text-slate-800 truncate block">
                              {w?.hrZone || 'Zona 2'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100/60 flex items-center gap-2 text-[10px] text-slate-400 font-semibold">
                        <span className="text-xs">💡</span>
                        <span>Sigue las pautas de ritmo y mantente hidratado.</span>
                      </div>
                    </div>

                    {/* Full guidelines list */}
                    <div className="flex-1 bg-white/40 border border-slate-100/70 rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col justify-center">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-3">Guías de Ejecución</span>
                      <MD text={nextWork} accent="text-blue-600" />
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── Footer badge ── */}
      <div className="px-5 py-2.5 bg-slate-50/60 border-t border-slate-100/60 flex items-center justify-between gap-2 bg-white/40">
        <div className="flex items-center gap-1.5 min-w-0">
          <SparklesIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-[10px] text-slate-400 font-semibold truncate">
            {usedProvider || 'IA'} · Recomendación inteligente · Basada en tu carga de entrenamiento
          </span>
        </div>
        {onOpenChat && (cur || trend || nextWork) && (
          <button
            onClick={openInChat}
            title="Abrir el chat con este análisis como contexto"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 transition-colors"
          >
            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
            Seguir preguntando en el chat
          </button>
        )}
      </div>
    </div>
  );
};

export default AIInsights;