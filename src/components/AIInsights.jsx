import { useState, useEffect, useCallback } from 'react';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { streamText } from 'ai';
import {
  SparklesIcon,
  ArrowPathIcon,
  HeartIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';

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

// ── Prompt builder ───────────────────────────────────────────────────────────
const buildPrompt = (activities, garminData) => {
  const now = new Date();
  const yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const week4 = new Date(now); week4.setDate(now.getDate() - 28);
  const week8 = new Date(now); week8.setDate(now.getDate() - 56);

  const yearActs = activities.filter(a => new Date(a.start_date) >= yearAgo);
  if (!yearActs.length) return null;

  // Weekly breakdown of recent 4 weeks
  const byWeek = [0, 1, 2, 3].map(w => {
    const wStart = new Date(now); wStart.setDate(now.getDate() - (w + 1) * 7);
    const wEnd   = new Date(now); wEnd.setDate(now.getDate() - w * 7);
    const acts = yearActs.filter(a => {
      const d = new Date(a.start_date);
      return d >= wStart && d < wEnd;
    });
    const km = acts.reduce((s, a) => s + a.distance / 1000, 0);
    const sessions = acts.length;
    return { week: w === 0 ? 'Sem actual' : `Sem -${w}`, km: km.toFixed(0), sessions };
  }).reverse();

  // Monthly volume history
  const byM = {};
  for (const a of yearActs) {
    const k = a.start_date.slice(0, 7);
    if (!byM[k]) byM[k] = { km: 0, n: 0 };
    byM[k].km += a.distance / 1000; byM[k].n++;
  }
  const monthHistory = Object.entries(byM)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, s]) => `${m.slice(5)}:${s.km.toFixed(0)}km/${s.n}s`)
    .join(' ');

  // Acute (4w) vs Chronic (8w) load for ACWR approximation
  const recentActs = yearActs.filter(a => new Date(a.start_date) >= week4);
  const prevActs   = yearActs.filter(a => { const d = new Date(a.start_date); return d >= week8 && d < week4; });
  const recentKm   = recentActs.reduce((s, a) => s + a.distance / 1000, 0);
  const prevKm     = prevActs.reduce((s, a) => s + a.distance / 1000, 0);
  const chronicKm  = (recentKm + prevKm) / 2; // avg 4-week blocks as chronic
  const acwr       = chronicKm > 0 ? (recentKm / chronicKm).toFixed(2) : null;
  const loadDelta  = prevKm > 0 ? ((recentKm - prevKm) / prevKm * 100).toFixed(0) : null;

  const recentMin  = recentActs.reduce((s, a) => s + (a.moving_time || 0) / 60, 0);
  const avgPace    = recentKm > 0
    ? (() => { const p = recentMin / recentKm; return `${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}`; })()
    : null;

  const withHR = recentActs.filter(a => a.average_heartrate);
  const avgHR  = withHR.length ? Math.round(withHR.reduce((s, a) => s + a.average_heartrate, 0) / withHR.length) : null;

  // ── 30-day window ────────────────────────────────────────────────────────────
  const month1 = new Date(now); month1.setDate(now.getDate() - 30);

  // Garmin: day-by-day log last 30d + summary averages
  let hrv14 = null, hrv7 = null, rhr14 = null, rhr7 = null, hrvStatus = null;
  let garminLog = '';
  if (garminData?.length) {
    const sorted = [...garminData].sort((a, b) => b.date.localeCompare(a.date));
    hrvStatus = sorted[0]?.hrvStatus ?? null;

    const w14 = new Date(now); w14.setDate(now.getDate() - 14);
    const w7  = new Date(now); w7.setDate(now.getDate() - 7);
    const rec30 = sorted.filter(d => new Date(d.date) >= month1);
    const rec14 = sorted.filter(d => new Date(d.date) >= w14);
    const rec7  = sorted.filter(d => new Date(d.date) >= w7);

    const avg = (arr, key) => arr.filter(d => d[key]).reduce((s, d) => s + d[key], 0) / (arr.filter(d => d[key]).length || 1);
    hrv14 = rec14.some(d => d.hrv)      ? avg(rec14, 'hrv').toFixed(1)      : null;
    hrv7  = rec7.some(d => d.hrv)       ? avg(rec7,  'hrv').toFixed(1)      : null;
    rhr14 = rec14.some(d => d.restingHR) ? avg(rec14, 'restingHR').toFixed(0) : null;
    rhr7  = rec7.some(d => d.restingHR)  ? avg(rec7,  'restingHR').toFixed(0) : null;

    // Compact day-by-day: date|VFC|RHR|status|sleep|stress
    garminLog = rec30.map(d => {
      const parts = [d.date.slice(5)]; // MM-DD
      if (d.hrv)        parts.push(`VFC=${d.hrv}ms`);
      if (d.restingHR)  parts.push(`RHR=${d.restingHR}ppm`);
      if (d.hrvStatus)  parts.push(`[${d.hrvStatus}]`);
      if (d.sleepHours) parts.push(`sueño=${d.sleepHours}h`);
      if (d.sleepScore) parts.push(`sueñoScore=${d.sleepScore}`);
      if (d.stress)     parts.push(`estrés=${d.stress}`);
      return parts.join(' ');
    }).join('\n');
  }

  // ── Activity log last 30d (individual sessions) ───────────────────────────
  const month1Acts = yearActs.filter(a => new Date(a.start_date) >= month1);
  const actLog = month1Acts
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map(a => {
      const km   = (a.distance / 1000).toFixed(1);
      const min  = (a.moving_time || 0) / 60;
      const pace = km > 0 ? (() => { const p = min / km; return `${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}`; })() : null;
      const parts = [a.start_date.slice(5, 10), `${km}km`];
      if (pace)              parts.push(`@${pace}/km`);
      if (a.average_heartrate) parts.push(`FC=${Math.round(a.average_heartrate)}ppm`);
      if (min > 0)           parts.push(`${Math.round(min)}min`);
      if (a.suffer_score)    parts.push(`sufr=${a.suffer_score}`);
      return parts.join(' ');
    }).join('\n');

  const weekTable = byWeek.map(w => `${w.week}: ${w.km}km (${w.sessions} salidas)`).join(' | ');

  const physioSection = [
    hrv14 ? `VFC 14d=${hrv14}ms` : null,
    hrv7  ? `VFC 7d=${hrv7}ms${hrv14 ? ` (${Number(hrv7) >= Number(hrv14) ? '↑ mejorando' : '↓ bajando'})` : ''}` : null,
    rhr14 ? `FC reposo 14d=${rhr14}ppm` : null,
    rhr7  ? `FC reposo 7d=${rhr7}ppm${rhr14 ? ` (${Number(rhr7) <= Number(rhr14) ? 'estable' : '↑ elevada'})` : ''}` : null,
    hrvStatus ? `Estado Garmin hoy: "${hrvStatus}"` : null,
  ].filter(Boolean).join(', ');

  const trainingSection = [
    `Total 4 sem: ${recentKm.toFixed(0)}km en ${recentActs.length} salidas`,
    avgPace ? `ritmo medio ${avgPace}min/km` : null,
    avgHR ? `FC media carrera ${avgHR}ppm` : null,
    loadDelta !== null ? `Carga vs 4 sem previas: ${loadDelta > 0 ? '+' : ''}${loadDelta}%` : null,
    acwr !== null ? `ACWR aprox: ${acwr} (óptimo 0.8–1.3)` : null,
  ].filter(Boolean).join(', ');

  return `Eres un entrenador de running y fisiólogo deportivo de élite. Tu objetivo es dar un diagnóstico ACCIONABLE, no solo describir los datos.

Devuelve EXACTAMENTE tres bloques separados por "|||", sin ningún texto fuera de ellos:

BLOQUE 1 — DIAGNÓSTICO DE ESTA SEMANA:
Con los datos fisiológicos (VFC/HRV + FC reposo) y la carga reciente, determina el estado real (recuperado, fatigado, sobreentrenado, en forma). Incluye una recomendación semanal concreta. Máx 3 bullets. Usa **negrita** para el diagnóstico clave.

|||

BLOQUE 2 — TENDENCIA Y PATRÓN ANUAL:
Identifica patrones en el historial mensual: progresión, estancamiento, pico-caída, lesión encubierta. Señala el mejor y peor período. Recomendación de objetivo 4-6 semanas. Máx 3 bullets. Usa **negrita** para el patrón detectado.

|||

BLOQUE 3 — PRÓXIMO ENTRENAMIENTO RECOMENDADO:
Basándote en el estado actual y la carga de esta semana, diseña la sesión de running más adecuada para los próximos 1-2 días. Especifica EXACTAMENTE:
- Tipo de sesión (regenerativo, aeróbico base, tempo, intervalos, rodaje largo)
- Distancia en km (valor concreto, ej: 8-10 km)
- Ritmo objetivo en min/km (ej: 5:30-5:45 min/km)
- Zona de FC objetivo (ej: Zona 2 · 130-145 ppm) o esfuerzo percibido
- Una advertencia o condición si aplica (ej: "para si FC>160", "no si llueve")
Máx 4 bullets muy concretos. Sin vaguedades. Usa **negrita** para el tipo de sesión y el dato clave de cada bullet.

DATOS DEL ATLETA:
${physioSection ? `Fisiología Garmin (resumen): ${physioSection}` : 'Sin datos de wearable.'}
${garminLog ? `Garmin día a día (últimos 30d):\n${garminLog}` : ''}
Entrenamiento (resumen 4 sem): ${trainingSection}
${actLog ? `Actividades últimos 30d (más reciente primero):\n${actLog}` : ''}
Desglose semanal: ${weekTable}
Historial mensual (mes:km/sesiones): ${monthHistory}

REGLAS ESTRICTAS: Sin introducción. Sin "el atleta". Habla directamente en segunda persona. Cada bullet empieza con el concepto en **negrita**. Máx 16 palabras por bullet. No repitas datos sin interpretarlos.`;
};

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

// ── Available Gemini models ──────────────────────────────────────────────────
const GEMINI_MODELS = [
  { id: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite · menos tokens' },
  { id: 'gemini-3.5-flash',      label: '3.5 Flash · mejor calidad'     },
  { id: 'gemini-2.5-flash',      label: '2.5 Flash · equilibrado'       },
];
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

// ── Main component ───────────────────────────────────────────────────────────
const AIInsights = ({ activities }) => {
  const [cur, setCur]           = useState('');
  const [trend, setTrend]       = useState('');
  const [nextWork, setNextWork] = useState('');
  const [loading, setLoading]       = useState(false);
  const [loaded, setLoaded]         = useState(false);
  const [garmin, setGarmin]         = useState(undefined);
  const [cacheTs, setCacheTs]       = useState(null);
  const [restoreWarning, setRestoreWarning] = useState(false);
  const [providerLabel, setProviderLabel]   = useState('');
  const [usedProvider, setUsedProvider]     = useState('');
  const [isFallback, setIsFallback]         = useState(false);
  const [selectedModel, setSelectedModel]   = useState(
    () => localStorage.getItem('ai_insights_model') || DEFAULT_MODEL
  );

  // Load Garmin data
  useEffect(() => {
    try {
      const s = localStorage.getItem('garmin_cardiac_data');
      if (s) { setGarmin(JSON.parse(s)); return; }
    } catch {}
    fetch('/garmin_data.json')
      .then(r => r.ok ? r.json() : null)
      .then(j => setGarmin(j?.data ?? null))
      .catch(() => setGarmin(null));
  }, []);

  const run = useCallback(async (force = false) => {
    if (!activities?.length || activities.length < 3) return;
    const prompt = buildPrompt(activities, garmin);
    if (!prompt) return;

    // Check cache
    if (!force) {
      try {
        const cached = localStorage.getItem('ai_insights_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.prompt === prompt && parsed.cur && parsed.trend) {
            setCur(parsed.cur);
            setTrend(parsed.trend);
            if (parsed.nextWork) setNextWork(parsed.nextWork);
            setCacheTs(parsed.timestamp);
            setLoaded(true);
            return;
          }
        }
      } catch (e) {
        console.warn('Cache read error', e);
      }
    }

    // Build provider chain from available keys
    const providers = [
      {
        name: GEMINI_MODELS.find(m => m.id === selectedModel)?.label.split(' ·')[0] ?? 'Gemini',
        key: import.meta.env.VITE_GEMINI_API_KEY,
        getModel: (k) => createGoogleGenerativeAI({ apiKey: k })(selectedModel),
      },
      {
        name: 'Groq Llama',
        key: import.meta.env.VITE_GROQ_API_KEY,
        getModel: (k) => createGroq({ apiKey: k })('llama-3.3-70b-versatile'),
      },
    ].filter(p => p.key);

    if (!providers.length) {
      setCur('**Sin API Key configurada** · Añade `VITE_GEMINI_API_KEY`, `VITE_OPENAI_API_KEY` o `VITE_ANTHROPIC_API_KEY` en tu `.env`.');
      setTrend('');
      return;
    }

    // Save backup before wiping
    const prevCur = cur; const prevTrend = trend; const prevNextWork = nextWork; const prevTs = cacheTs;
    try {
      localStorage.setItem('ai_insights_backup', JSON.stringify({
        cur: prevCur, trend: prevTrend, nextWork: prevNextWork, timestamp: prevTs,
      }));
    } catch {}

    setLoading(true); setCur(''); setTrend(''); setNextWork(''); setUsedProvider(''); setIsFallback(false);

    let succeeded = false;
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      setIsFallback(i > 0);
      setProviderLabel(i === 0 ? `Consultando ${provider.name}…` : `${providers[i-1].name} falló · probando ${provider.name}…`);
      try {
        const res = streamText({
          model: provider.getModel(provider.key),
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          maxRetries: 0,
        });
        let full = '';
        for await (const chunk of res.textStream) {
          full += chunk;
          const parts = full.split('|||');
          if (parts.length >= 1) setCur(parts[0].trim());
          if (parts.length >= 2) setTrend(parts[1].trim());
          if (parts.length >= 3) setNextWork(parts[2].trim());
        }
        setLoaded(true);
        setUsedProvider(provider.name);
        const parts = full.split('|||');
        const ts = Date.now();
        setCacheTs(ts);
        localStorage.setItem('ai_insights_cache', JSON.stringify({
          prompt,
          cur: (parts[0] ?? '').trim(),
          trend: (parts[1] ?? '').trim(),
          nextWork: (parts[2] ?? '').trim(),
          timestamp: ts,
          provider: provider.name,
        }));
        localStorage.removeItem('ai_insights_backup');
        succeeded = true;
        break;
      } catch (e) {
        console.warn(`[AIInsights] ${provider.name} falló:`, e);
        setCur(''); setTrend(''); setNextWork('');
      }
    }

    if (!succeeded) {
      if (prevCur) {
        setCur(prevCur); setTrend(prevTrend); setNextWork(prevNextWork); setCacheTs(prevTs);
        setRestoreWarning(true);
        setTimeout(() => setRestoreWarning(false), 6000);
      } else {
        setCur('**Sin respuesta de ningún modelo** · El modelo puede estar saturado (429). Cambia de modelo en el selector o añade `VITE_XAI_API_KEY` para activar Grok como fallback.');
        setTrend(''); setNextWork('');
      }
    }
    setProviderLabel('');
    setLoading(false);
  }, [activities, garmin, selectedModel]);

  useEffect(() => {
    if (!loaded && activities?.length >= 3 && garmin !== undefined) run(false);
  }, [activities, garmin, loaded, run]);

  if (!activities || activities.length < 3) return null;

  const hasGarmin = garmin?.length > 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-blue-50">
            <SparklesIcon className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 leading-tight">Diagnóstico IA</h3>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
              {hasGarmin ? 'VFC · FC reposo · Carga de entrenamiento' : 'Basado en actividad Strava'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {cacheTs && !loading && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-slate-400">
              <ClockIcon className="w-3 h-3" />
              {formatTs(cacheTs)}
            </span>
          )}
          <select
            value={selectedModel}
            disabled={loading}
            onChange={e => {
              const m = e.target.value;
              localStorage.setItem('ai_insights_model', m);
              setSelectedModel(m);
              setLoaded(false);
            }}
            className="text-[11px] text-slate-500 bg-transparent border border-slate-200 rounded-lg px-2 py-1.5 pr-6 font-medium hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
          >
            {GEMINI_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button
            onClick={() => { setLoaded(false); run(true); }}
            disabled={loading}
            title="Recalcular diagnóstico"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-30 transition-all"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Analizando…' : 'Recalcular'}</span>
          </button>
        </div>
      </div>

      {/* ── Loading status banner ── */}
      {loading && providerLabel && (
        <div className={`flex items-center gap-2 px-5 py-2 border-b text-[11px] font-medium ${
          isFallback
            ? 'bg-amber-50 border-amber-100 text-amber-700'
            : 'bg-blue-50 border-blue-100 text-blue-600'
        }`}>
          <ArrowPathIcon className="w-3 h-3 animate-spin shrink-0" />
          {providerLabel}
        </div>
      )}

      {/* ── Restore warning banner ── */}
      {restoreWarning && (
        <div className="flex items-center gap-2 px-5 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700 font-medium">
          <span className="shrink-0">⚠</span>
          Falló la actualización — mostrando la recomendación anterior guardada.
          <button
            onClick={() => setRestoreWarning(false)}
            className="ml-auto text-amber-400 hover:text-amber-600 transition-colors font-bold leading-none"
          >✕</button>
        </div>
      )}

      {/* ── Content grid: Diagnosis + Trend ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">

        {/* Block 1: Current state */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <HeartIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Estado actual</span>
            <span className="text-[10px] text-slate-400 font-medium">· últimas 4 semanas</span>
          </div>
          {loading && !cur ? <Pulse /> : <MD text={cur} accent="text-blue-500" />}
        </div>

        {/* Block 2: Annual trend */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <ArrowTrendingUpIcon className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Tendencia anual</span>
            <span className="text-[10px] text-slate-400 font-medium">· 12 meses</span>
          </div>
          {loading && !trend ? <Pulse /> : <MD text={trend} accent="text-indigo-500" />}
        </div>
      </div>

      {/* ── Block 3: Next workout ── */}
      {(nextWork || (loading && !nextWork)) && (
        <div className="border-t border-slate-100 bg-blue-50/30 px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1 rounded-md bg-blue-100">
              <BoltIcon className="w-3 h-3 text-blue-600" />
            </div>
            <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">Próximo entrenamiento</span>
            <span className="text-[10px] text-slate-400 font-medium">· recomendación personalizada</span>
          </div>
          {loading && !nextWork
            ? <Pulse />
            : <MD text={nextWork} accent="text-blue-600" />
          }
        </div>
      )}

      {/* ── Footer badge ── */}
      <div className="px-5 py-2 bg-slate-50/60 border-t border-slate-100 flex items-center gap-1.5">
        <SparklesIcon className="w-3 h-3 text-slate-300" />
        <span className="text-[10px] text-slate-400 font-medium">{usedProvider || 'IA'} · Los datos se cachean hasta que registres nueva actividad</span>
      </div>
    </div>
  );
};

export default AIInsights;
