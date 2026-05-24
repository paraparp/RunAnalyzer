import { useState, useEffect, useCallback } from 'react';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';
import {
  SparklesIcon,
  ArrowPathIcon,
  HeartIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
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

  // Garmin biometrics — 7d vs 14d delta gives trend direction
  let hrv14 = null, hrv7 = null, rhr14 = null, rhr7 = null, hrvStatus = null;
  if (garminData?.length) {
    const w14 = new Date(now); w14.setDate(now.getDate() - 14);
    const w7  = new Date(now); w7.setDate(now.getDate() - 7);
    const rec14 = garminData.filter(d => new Date(d.date) >= w14);
    const rec7  = garminData.filter(d => new Date(d.date) >= w7);

    const hrv14arr = rec14.filter(d => d.hrv);
    const hrv7arr  = rec7.filter(d => d.hrv);
    const rhr14arr = rec14.filter(d => d.restingHR);
    const rhr7arr  = rec7.filter(d => d.restingHR);

    hrv14 = hrv14arr.length ? (hrv14arr.reduce((s, d) => s + d.hrv, 0) / hrv14arr.length).toFixed(1) : null;
    hrv7  = hrv7arr.length  ? (hrv7arr.reduce((s, d) => s + d.hrv, 0) / hrv7arr.length).toFixed(1) : null;
    rhr14 = rhr14arr.length ? (rhr14arr.reduce((s, d) => s + d.restingHR, 0) / rhr14arr.length).toFixed(0) : null;
    rhr7  = rhr7arr.length  ? (rhr7arr.reduce((s, d) => s + d.restingHR, 0) / rhr7arr.length).toFixed(0) : null;
    hrvStatus = garminData.sort((a, b) => b.date.localeCompare(a.date))[0]?.hrvStatus ?? null;
  }

  const weekTable = byWeek.map(w => `${w.week}: ${w.km}km (${w.sessions} salidas)`).join(' | ');

  const physioSection = [
    hrv14 ? `VFC 14d=${hrv14}ms` : null,
    hrv7  ? `VFC 7d=${hrv7}ms${hrv14 ? ` (${Number(hrv7) >= Number(hrv14) ? '↑ mejorando' : '↓ bajando'})` : ''}` : null,
    rhr14 ? `FC reposo 14d=${rhr14}ppm` : null,
    rhr7  ? `FC reposo 7d=${rhr7}ppm${rhr14 ? ` (${Number(rhr7) <= Number(rhr14) ? 'estable' : '↑ elevada'})` : ''}` : null,
    hrvStatus ? `Estado Garmin: "${hrvStatus}"` : null,
  ].filter(Boolean).join(', ');

  const trainingSection = [
    `Total 4 sem: ${recentKm.toFixed(0)}km en ${recentActs.length} salidas`,
    avgPace ? `ritmo medio ${avgPace}min/km` : null,
    avgHR ? `FC media carrera ${avgHR}ppm` : null,
    loadDelta !== null ? `Carga vs 4 sem previas: ${loadDelta > 0 ? '+' : ''}${loadDelta}%` : null,
    acwr !== null ? `ACWR aprox: ${acwr} (óptimo 0.8–1.3)` : null,
  ].filter(Boolean).join(', ');

  return `Eres un entrenador de running y fisiólogo deportivo de élite. Tu objetivo es dar un diagnóstico ACCIONABLE, no solo describir los datos.

Devuelve EXACTAMENTE dos bloques separados por "|||", sin ningún texto fuera de ellos:

BLOQUE 1 — DIAGNÓSTICO Y RECOMENDACIÓN DE ESTA SEMANA:
Con los datos fisiológicos (VFC/HRV + FC reposo) y la carga reciente, determina el estado real del atleta (recuperado, fatigado, sobreentrenado, en forma). Incluye UNA recomendación concreta de entrenamiento para los próximos 7 días (ej: "reduce intensidad", "añade una sesión de ritmo", "descansa 2 días"). Máx 3 bullets. Usa **negrita** para el diagnóstico y la recomendación clave.

|||

BLOQUE 2 — TENDENCIA Y PATRÓN ANUAL:
Identifica patrones en el historial mensual: ¿hay progresión, estancamiento, lesión encubierta, pico-caída? Señala el mejor período y el más débil. Finaliza con una recomendación de objetivo para las próximas 4-6 semanas basada en la tendencia. Máx 3 bullets. Usa **negrita** para el patrón detectado.

DATOS DEL ATLETA:
${physioSection ? `Fisiología Garmin: ${physioSection}` : 'Sin datos de wearable.'}
Entrenamiento: ${trainingSection}
Desglose semanal reciente: ${weekTable}
Historial mensual (mes:km/sesiones): ${monthHistory}

REGLAS ESTRICTAS: Sin introducción. Sin "el atleta". Habla directamente. Cada bullet empieza con el concepto en **negrita**. Máx 16 palabras por bullet. No repitas datos sin interpretarlos.`;
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

// ── Main component ───────────────────────────────────────────────────────────
const AIInsights = ({ activities }) => {
  const [cur, setCur]       = useState('');
  const [trend, setTrend]   = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);
  const [garmin, setGarmin]   = useState(undefined);
  const [cacheTs, setCacheTs] = useState(null);

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
            setCacheTs(parsed.timestamp);
            setLoaded(true);
            return;
          }
        }
      } catch (e) {
        console.warn('Cache read error', e);
      }
    }

    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) {
      setCur('**API Key no configurada** · Añade `VITE_GEMINI_API_KEY` en tu `.env` para activar el análisis.');
      setTrend('');
      return;
    }

    // Save current recommendation as backup before wiping for new stream
    const prevCur = cur;
    const prevTrend = trend;
    const prevTs = cacheTs;
    try {
      localStorage.setItem('ai_insights_backup', JSON.stringify({
        cur: prevCur, trend: prevTrend, timestamp: prevTs,
      }));
    } catch {}

    setLoading(true); setCur(''); setTrend('');
    try {
      const google = createGoogleGenerativeAI({ apiKey: key });
      const res = streamText({
        model: google('gemini-3.5-flash'),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
      });
      let full = '';
      for await (const chunk of res.textStream) {
        full += chunk;
        const sep = full.indexOf('|||');
        if (sep !== -1) { setCur(full.slice(0, sep).trim()); setTrend(full.slice(sep + 3).trim()); }
        else setCur(full);
      }
      setLoaded(true);
      const sep = full.indexOf('|||');
      const finalCur   = sep !== -1 ? full.slice(0, sep).trim() : full;
      const finalTrend = sep !== -1 ? full.slice(sep + 3).trim() : '';
      const ts = Date.now();
      setCacheTs(ts);
      localStorage.setItem('ai_insights_cache', JSON.stringify({ prompt, cur: finalCur, trend: finalTrend, timestamp: ts }));
      // Remove backup once successful
      localStorage.removeItem('ai_insights_backup');
    } catch (e) {
      console.error(e);
      // Restore previous valid recommendation if available
      if (prevCur) {
        setCur(prevCur);
        setTrend(prevTrend);
        setCacheTs(prevTs);
        setRestoreWarning(true);
        setTimeout(() => setRestoreWarning(false), 6000);
      } else {
        setCur('**Error de conexión** · Verifica tu API Key y tu red.');
        setTrend('');
      }
    } finally {
      setLoading(false);
    }
  }, [activities, garmin]);

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
          <button
            onClick={() => { setLoaded(false); run(true); }}
            disabled={loading}
            title="Recalcular diagnóstico"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-30 transition-all"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{loading ? 'Analizando…' : 'Recalcular'}</span>
          </button>
        </div>
      </div>

      {/* ── Content grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">

        {/* Block 1: Current state */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <HeartIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Estado actual</span>
            <span className="text-[10px] text-slate-400 font-medium">· últimas 4 semanas</span>
          </div>
          {loading && !cur
            ? <Pulse />
            : <MD text={cur} accent="text-blue-500" />
          }
        </div>

        {/* Block 2: Annual trend */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <ArrowTrendingUpIcon className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Tendencia anual</span>
            <span className="text-[10px] text-slate-400 font-medium">· 12 meses</span>
          </div>
          {loading && !trend
            ? <Pulse />
            : <MD text={trend} accent="text-indigo-500" />
          }
        </div>
      </div>

      {/* ── Footer badge ── */}
      <div className="px-5 py-2 bg-slate-50/60 border-t border-slate-100 flex items-center gap-1.5">
        <SparklesIcon className="w-3 h-3 text-slate-300" />
        <span className="text-[10px] text-slate-400 font-medium">Gemini 3.5 Flash · Los datos se cachean hasta que registres nueva actividad</span>
      </div>
    </div>
  );
};

export default AIInsights;
