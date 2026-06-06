import { useState, useEffect, useCallback, useRef } from 'react';
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
  MoonIcon,
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
  const yearAgo  = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const twoMonthsAgo = new Date(now); twoMonthsAgo.setMonth(now.getMonth() - 2);
  const week4  = new Date(now); week4.setDate(now.getDate() - 28);
  const week8  = new Date(now); week8.setDate(now.getDate() - 56);
  const month1 = new Date(now); month1.setDate(now.getDate() - 30);

  const yearActs   = activities.filter(a => new Date(a.start_date) >= yearAgo);
  if (!yearActs.length) return null;

  const isRunning  = (a) => ['Run', 'TrailRun', 'VirtualRun'].includes(a.type);
  const isCycling  = (a) => ['Ride', 'VirtualRide'].includes(a.type);
  const isSwimming = (a) => ['Swim'].includes(a.type);

  const runningYearActs = yearActs.filter(isRunning);

  // ── Weekly breakdown (4 weeks) ────────────────────────────────────────────
  const byWeek = [0, 1, 2, 3].map(w => {
    const wStart = new Date(now); wStart.setDate(now.getDate() - (w + 1) * 7);
    const wEnd   = new Date(now); wEnd.setDate(now.getDate() - w * 7);
    const runs = runningYearActs.filter(a => { const d = new Date(a.start_date); return d >= wStart && d < wEnd; });
    return {
      week: w === 0 ? 'Sem actual' : `Sem -${w}`,
      km: runs.reduce((s, a) => s + a.distance / 1000, 0).toFixed(0),
      sessions: runs.length,
    };
  }).reverse();

  // ── Monthly volume (last 2 months for current fitness) ────────────────────
  const twoMonthActs = runningYearActs.filter(a => new Date(a.start_date) >= twoMonthsAgo);
  const byM = {};
  for (const a of twoMonthActs) {
    const k = a.start_date.slice(0, 7);
    if (!byM[k]) byM[k] = { km: 0, n: 0 };
    byM[k].km += a.distance / 1000; byM[k].n++;
  }
  const monthHistory = Object.entries(byM)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, s]) => `${m.slice(5)}:${s.km.toFixed(0)}km/${s.n}s`)
    .join(' ');

  // ── ACWR (4w acute / 8w chronic) ─────────────────────────────────────────
  const recentRuns = runningYearActs.filter(a => new Date(a.start_date) >= week4);
  const prevRuns   = runningYearActs.filter(a => { const d = new Date(a.start_date); return d >= week8 && d < week4; });
  const recentKm   = recentRuns.reduce((s, a) => s + a.distance / 1000, 0);
  const prevKm     = prevRuns.reduce((s, a) => s + a.distance / 1000, 0);
  const chronicKm  = (recentKm + prevKm) / 2;
  const acwr       = chronicKm > 0 ? (recentKm / chronicKm).toFixed(2) : null;
  const loadDelta  = prevKm > 0 ? ((recentKm - prevKm) / prevKm * 100).toFixed(0) : null;

  const recentMin = recentRuns.reduce((s, a) => s + (a.moving_time || 0) / 60, 0);
  const avgPace   = recentKm > 0
    ? (() => { const p = recentMin / recentKm; return `${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}`; })()
    : null;
  const withHR = recentRuns.filter(a => a.average_heartrate);
  const avgHR  = withHR.length ? Math.round(withHR.reduce((s, a) => s + a.average_heartrate, 0) / withHR.length) : null;

  // ── Robust FCmax detection (all-time, median of top 5%) ───────────────────
  // Using all activities (not just recent) since FCmax is a stable physiological trait.
  // We filter <140 and >215 to eliminate sensor glitches, then take the median of the
  // top 5% of peaks to resist cadence-lock false spikes from optical sensors.
  const allMaxHRs = activities
    .filter(a => a.max_heartrate > 140 && a.max_heartrate < 215)
    .map(a => a.max_heartrate)
    .sort((a, b) => b - a);
  let fcmax = 185;
  if (allMaxHRs.length > 0) {
    const sampleSize = Math.min(allMaxHRs.length, Math.max(5, Math.floor(allMaxHRs.length * 0.05)));
    const peaks = allMaxHRs.slice(0, sampleSize);
    fcmax = Math.round(peaks[Math.floor(peaks.length / 2)]);
  }

  // ── Resting HR: prefer latest Garmin reading, fallback to activity estimate ─
  let fcRest = 60;
  if (garminData?.length) {
    const sortedG = [...garminData].sort((a, b) => b.date.localeCompare(a.date));
    const recentRHR = sortedG.find(d => d.restingHR);
    if (recentRHR) fcRest = recentRHR.restingHR;
  } else {
    const easyRunHRs = runningYearActs
      .filter(a => a.average_heartrate && a.moving_time > 2400)
      .map(a => a.average_heartrate)
      .sort((a, b) => a - b);
    if (easyRunHRs.length) {
      const easy = easyRunHRs[Math.floor(easyRunHRs.length * 0.15)];
      fcRest = Math.max(38, Math.min(78, Math.round(easy * 0.56)));
    }
  }

  // ── LTHR detection (last 2 months for current fitness state) ─────────────
  // Strategy 1: sustained hard efforts 18-70min where avg HR > 82% FCmax and
  //   avg/max ratio > 0.92 (to confirm effort was sustained, not a spike).
  //   → median of qualifying runs' avg HR = LTHR estimate
  // Strategy 2: fall back to Friel's approximation: LTHR ≈ 87.5% FCmax
  let lthr = Math.round(fcmax * 0.875);
  let lthrMethod = 'Friel approx (87.5% FCmax)';
  const thresholdRuns2m = twoMonthActs.filter(a => {
    if (!a.average_heartrate || !a.max_heartrate || !a.moving_time) return false;
    const mins    = a.moving_time / 60;
    const avgPct  = a.average_heartrate / fcmax;
    const sustain = a.average_heartrate / a.max_heartrate;
    return mins >= 18 && mins <= 70 && avgPct >= 0.82 && avgPct < 0.97 && sustain >= 0.92;
  });
  if (thresholdRuns2m.length >= 2) {
    const hrs = thresholdRuns2m.map(a => a.average_heartrate).sort((a, b) => a - b);
    lthr = Math.round(hrs[Math.floor(hrs.length / 2)]);
    lthrMethod = `campo (${thresholdRuns2m.length} esfuerzos umbral detectados)`;
  }

  // ── HR zones (Seiler polarized, based on LTHR) ────────────────────────────
  const z1hi  = Math.round(lthr * 0.925) - 1;
  const z2lo  = Math.round(lthr * 0.925);
  const z2hi  = lthr - 1;
  const z3lo  = lthr;
  // Karvonen supplementary (for the recommended session prescription)
  const hrr   = fcmax - fcRest;
  const kZ2lo = Math.round(fcRest + 0.50 * hrr);
  const kZ2hi = Math.round(fcRest + 0.60 * hrr);
  const kZ3lo = Math.round(fcRest + 0.60 * hrr);
  const kZ3hi = Math.round(fcRest + 0.70 * hrr);
  const kZ4lo = Math.round(fcRest + 0.70 * hrr);
  const kZ4hi = Math.round(fcRest + 0.85 * hrr);

  const hrZonesSummary = [
    `FCmax=${fcmax}ppm (mediana top 5% histórico)`,
    `FC reposo=${fcRest}ppm (Garmin más reciente)`,
    `LTHR=${lthr}ppm [método: ${lthrMethod}]`,
    `Z1 aeróbica base: <${z1hi+1}ppm`,
    `Z2 zona umbral (gris): ${z2lo}-${z2hi}ppm`,
    `Z3 alta intensidad: ≥${z3lo}ppm`,
    `Karvonen Z2 (base): ${kZ2lo}-${kZ2hi}ppm | Z3 (aeróbico intenso): ${kZ3lo}-${kZ3hi}ppm | Z4 (umbral/tempo): ${kZ4lo}-${kZ4hi}ppm`,
  ].join('\n');

  // ── Garmin: day-by-day (30d) + summary averages ───────────────────────────
  let hrv14n = null, hrv7n = null, rhr14n = null, rhr7n = null, rhrLatest = null, hrvStatus = null;
  let garminLog = '';
  if (garminData?.length) {
    const sorted = [...garminData].sort((a, b) => b.date.localeCompare(a.date));
    hrvStatus  = sorted[0]?.hrvStatus ?? null;
    rhrLatest  = sorted.find(d => d.restingHR)?.restingHR ?? null;

    const w14   = new Date(now); w14.setDate(now.getDate() - 14);
    const w7    = new Date(now); w7.setDate(now.getDate() - 7);
    const rec30 = sorted.filter(d => new Date(d.date) >= month1);
    const rec14 = sorted.filter(d => new Date(d.date) >= w14);
    const rec7  = sorted.filter(d => new Date(d.date) >= w7);

    const avg = (arr, key) => {
      const valid = arr.filter(d => d[key]);
      return valid.length ? valid.reduce((s, d) => s + d[key], 0) / valid.length : null;
    };
    hrv14n = avg(rec14, 'hrv');
    hrv7n  = avg(rec7,  'hrv');
    rhr14n = avg(rec14, 'restingHR');
    rhr7n  = avg(rec7,  'restingHR');

    garminLog = rec30.map(d => {
      const parts = [d.date.slice(5)];
      if (d.hrv)        parts.push(`VFC=${d.hrv}ms`);
      if (d.restingHR)  parts.push(`RHR=${d.restingHR}ppm`);
      if (d.hrvStatus)  parts.push(`[${d.hrvStatus}]`);
      if (d.sleepHours) parts.push(`sueño=${d.sleepHours}h`);
      if (d.sleepScore) parts.push(`sueñoScore=${d.sleepScore}`);
      if (d.stress)     parts.push(`estrés=${d.stress}`);
      return parts.join(' ');
    }).join('\n');
  }

  // ── Activity log (30d individual) ────────────────────────────────────────
  const actLog = yearActs
    .filter(a => new Date(a.start_date) >= month1)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map(a => {
      const kmNum = a.distance / 1000;
      const km    = kmNum.toFixed(1);
      const min   = (a.moving_time || 0) / 60;

      let typeLabel = '[Otro]';
      let performance = '';

      if (isRunning(a)) {
        typeLabel = '[Carrera]';
        if (kmNum > 0 && min > 0) {
          const p = min / kmNum;
          performance = `@${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`;
        }
      } else if (isCycling(a)) {
        typeLabel = '[Ciclismo]';
        if (kmNum > 0 && min > 0) {
          const speed = kmNum / (min / 60);
          performance = `@${speed.toFixed(1)}km/h`;
        }
      } else if (isSwimming(a)) {
        typeLabel = '[Natación]';
        if (kmNum > 0 && min > 0) {
          const pace100m = min / (a.distance / 100);
          const paceMin = Math.floor(pace100m);
          const paceSec = Math.round((pace100m % 1) * 60).toString().padStart(2, '0');
          performance = `@${paceMin}:${paceSec}/100m`;
        }
      } else if (a.type === 'Walk' || a.type === 'Hike') {
        typeLabel = `[Caminata]`;
        if (kmNum > 0 && min > 0) {
          const p = min / kmNum;
          performance = `@${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`;
        }
      } else if (a.type === 'WeightTraining') {
        typeLabel = '[Fuerza]';
      } else if (a.type === 'Yoga') {
        typeLabel = '[Yoga]';
      } else {
        typeLabel = `[${a.type || 'Actividad'}]`;
      }

      const parts = [a.start_date.slice(5, 10), typeLabel];
      if (a.distance > 0) parts.push(`${km}km`);
      if (performance)    parts.push(performance);
      if (a.average_heartrate) parts.push(`FC=${Math.round(a.average_heartrate)}ppm`);
      if (min > 0)        parts.push(`${Math.round(min)}min`);
      if (a.suffer_score) parts.push(`sufr=${a.suffer_score}`);
      return parts.join(' ');
    }).join('\n');

  // ── Sections ─────────────────────────────────────────────────────────────
  const weekTable = byWeek.map(w => `${w.week}: ${w.km}km (${w.sessions} carreras)`).join(' | ');

  const physioSection = [
    rhrLatest != null ? `FC reposo HOY=${rhrLatest}ppm (dato Garmin más reciente)` : null,
    hrv14n != null ? `VFC 14d=${hrv14n.toFixed(1)}ms` : null,
    hrv7n  != null ? `VFC 7d=${hrv7n.toFixed(1)}ms${hrv14n != null ? ` (${hrv7n >= hrv14n ? '↑ mejorando' : '↓ bajando'})` : ''}` : null,
    rhr14n != null ? `FC reposo 14d=${rhr14n.toFixed(0)}ppm` : null,
    rhr7n  != null ? `FC reposo 7d=${rhr7n.toFixed(0)}ppm${rhr14n != null ? ` (${rhr7n <= rhr14n ? 'estable' : '↑ elevada'})` : ''}` : null,
    hrvStatus ? `Estado Garmin hoy: "${hrvStatus}"` : null,
  ].filter(Boolean).join(', ');

  const trainingSection = [
    `Total 4 sem (carrera): ${recentKm.toFixed(0)}km en ${recentRuns.length} sesiones`,
    avgPace   ? `ritmo medio ${avgPace}min/km` : null,
    avgHR     ? `FC media carrera ${avgHR}ppm (=${avgHR ? Math.round(avgHR/fcmax*100) : '?'}% FCmax)` : null,
    loadDelta != null ? `Carga vs 4 sem previas: ${loadDelta > 0 ? '+' : ''}${loadDelta}%` : null,
    acwr      != null ? `ACWR aprox: ${acwr} (óptimo 0.8–1.3)` : null,
  ].filter(Boolean).join(', ');

  return `Eres un entrenador de running y fisiólogo deportivo de élite. Tu objetivo es dar un diagnóstico ACCIONABLE, no solo describir los datos. El atleta realiza entrenamiento cruzado (como ciclismo, natación, fuerza o caminata) además de correr. Considera la carga cardiovascular y fatiga que generan estas otras disciplinas al evaluar su estado general, pero prescribe el próximo entrenamiento enfocado EXCLUSIVAMENTE en carrera a pie (running).

Devuelve EXACTAMENTE tres bloques separados por "|||", sin ningún texto fuera de ellos:

BLOQUE 1 — DIAGNÓSTICO DE ESTA SEMANA:
Con los datos fisiológicos (VFC/HRV + FC reposo) y la carga reciente, determina el estado real (recuperado, fatigado, sobreentrenado, en forma). Incluye una recomendación semanal concreta. Máx 3 bullets. Usa **negrita** para el diagnóstico clave.

|||

BLOQUE 2 — TENDENCIA Y PATRÓN (ÚLTIMOS 2 MESES):
Identifica patrones en el historial mensual: progresión, estancamiento, pico-caída, lesión encubierta. Señala el mejor y peor período. Recomendación de objetivo 4-6 semanas. Máx 3 bullets. Usa **negrita** para el patrón detectado.

|||

BLOQUE 3 — PRÓXIMO ENTRENAMIENTO RECOMENDADO:
Basándote en el estado actual y la carga de esta semana, diseña la sesión de running más adecuada para los próximos 1-2 días. USA LAS ZONAS DE FC CALCULADAS (abajo) para dar rangos concretos en ppm. Especifica EXACTAMENTE:
- Tipo de sesión (regenerativo, aeróbico base, tempo, intervalos, rodaje largo)
- Distancia en km (valor concreto, ej: 8-10 km)
- Ritmo objetivo en min/km (ej: 5:30-5:45 min/km)
- Zona de FC objetivo con los ppm exactos calculados (ej: "Zona 2 aeróbica · 128-142 ppm")
- Una advertencia o condición si aplica (ej: "para si FC>165ppm", "reduce si VFC baja mañana")
Refleja la fatiga del entrenamiento cruzado reciente si es elevada. Máx 4 bullets muy concretos. Sin vaguedades. Usa **negrita** para el tipo de sesión y el dato clave de cada bullet.

DATOS DEL ATLETA:
ZONAS DE FC CALCULADAS (usa estas referencias exactas en el bloque 3):
${hrZonesSummary}

${physioSection ? `Fisiología Garmin (resumen): ${physioSection}` : 'Sin datos de wearable.'}
${garminLog ? `Garmin día a día (últimos 30d):\n${garminLog}` : ''}
Entrenamiento (resumen 4 sem): ${trainingSection}
${actLog ? `Actividades últimos 30d (más reciente primero, con deportes etiquetados):\n${actLog}` : ''}
Desglose semanal (carrera): ${weekTable}
Historial mensual de carrera (últimos 2 meses): ${monthHistory}

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
  const [loading, setLoading]   = useState(false);
  const [loaded, setLoaded]     = useState(false);
  const [garmin, setGarmin]     = useState(undefined);
  const [cacheTs, setCacheTs]   = useState(null);
  const [restoreWarning, setRestoreWarning] = useState(false);
  const [providerLabel, setProviderLabel]   = useState('');
  const [usedProvider, setUsedProvider]     = useState('');
  const [isFallback, setIsFallback]         = useState(false);
  const [selectedModel, setSelectedModel]   = useState(
    () => localStorage.getItem('ai_insights_model') || DEFAULT_MODEL
  );

  // Ref to always-current state for backup/restore inside run (avoids stale closure)
  const stateRef = useRef({ cur, trend, nextWork, cacheTs });
  useEffect(() => { stateRef.current = { cur, trend, nextWork, cacheTs }; }, [cur, trend, nextWork, cacheTs]);

  // Ref to abort ongoing stream on unmount or new run
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Load Garmin data
  const loadGarminData = () => {
    try {
      const s = localStorage.getItem('garmin_cardiac_data');
      if (s) { setGarmin(JSON.parse(s)); return; }
    } catch {}
    fetch('/garmin_data.json')
      .then(r => r.ok ? r.json() : null)
      .then(j => setGarmin(j?.data ?? null))
      .catch(() => setGarmin(null));
  };

  useEffect(() => {
    loadGarminData();
    window.addEventListener('garmin_sync_complete', loadGarminData);
    return () => window.removeEventListener('garmin_sync_complete', loadGarminData);
  }, []);

  const run = useCallback(async (force = false) => {
    if (!activities?.length || activities.length < 3) return;
    const prompt = buildPrompt(activities, garmin);
    if (!prompt) return;

    // Check cache — key includes model so switching models bypasses cache
    if (!force) {
      try {
        const cached = localStorage.getItem('ai_insights_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.prompt === prompt && parsed.model === selectedModel && parsed.cur && parsed.trend) {
            setCur(parsed.cur);
            setTrend(parsed.trend);
            if (parsed.nextWork) setNextWork(parsed.nextWork);
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
      setCur('**Sin API Key configurada** · Añade `VITE_GEMINI_API_KEY` o `VITE_GROQ_API_KEY` en tu `.env`.');
      setTrend('');
      setLoaded(true);
      return;
    }

    // Snapshot current state via ref (avoids stale closure)
    const { cur: prevCur, trend: prevTrend, nextWork: prevNextWork, cacheTs: prevTs } = stateRef.current;
    try {
      localStorage.setItem('ai_insights_backup', JSON.stringify({
        cur: prevCur, trend: prevTrend, nextWork: prevNextWork, timestamp: prevTs,
      }));
    } catch {}

    // Abort any previous in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true); setCur(''); setTrend(''); setNextWork(''); setUsedProvider(''); setIsFallback(false);

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
          const res = streamText({
            model: provider.getModel(provider.key),
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            maxRetries: 0,
            abortSignal: controller.signal,
          });
          let full = '';
          for await (const chunk of res.textStream) {
            full += chunk;
            const parts = full.split('|||');
            if (parts.length >= 1) setCur(parts[0].trim());
            if (parts.length >= 2) setTrend(parts[1].trim());
            if (parts.length >= 3) setNextWork(parts[2].trim());
          }
          setUsedProvider(provider.name);
          const parts = full.split('|||');
          const ts = Date.now();
          setCacheTs(ts);
          localStorage.setItem('ai_insights_cache', JSON.stringify({
            prompt,
            model: selectedModel,
            cur:      (parts[0] ?? '').trim(),
            trend:    (parts[1] ?? '').trim(),
            nextWork: (parts[2] ?? '').trim(),
            timestamp: ts,
            provider: provider.name,
          }));
          localStorage.removeItem('ai_insights_backup');
          succeeded = true;
          break;
        } catch (e) {
          if (controller.signal.aborted) break;
          console.warn(`[AIInsights] ${provider.name} falló:`, e);
          setCur(''); setTrend(''); setNextWork('');
        }
      }

      if (!succeeded && !controller.signal.aborted) {
        if (prevCur) {
          setCur(prevCur); setTrend(prevTrend); setNextWork(prevNextWork); setCacheTs(prevTs);
          setRestoreWarning(true);
          setTimeout(() => setRestoreWarning(false), 6000);
        } else {
          setCur('**Sin respuesta de ningún modelo** · Puede ser rate-limit (429). Cambia de modelo en el selector o añade `VITE_GROQ_API_KEY` para activar el fallback.');
          setTrend(''); setNextWork('');
        }
      }
    } finally {
      setProviderLabel('');
      setLoading(false);
      setLoaded(true);
    }
  }, [activities, garmin, selectedModel]);

  useEffect(() => {
    if (activities?.length >= 3 && garmin !== undefined) run(false);
  }, [activities, garmin, run]);

  if (!activities || activities.length < 3) return null;

  const hasGarmin = garmin?.length > 0;

  // ── Workout parser for the premium prescription ticket ──────────────────────
  const parseWorkout = (text) => {
    if (!text) return null;
    let type = "Base Aeróbica";
    const typeMatch = text.match(/\*\*(Regenerativo|Aeróbico base|Tempo|Intervalos|Rodaje largo|Fartlek|Series|Base)\*\*/i) 
      || text.match(/(Regenerativo|Aeróbico base|Tempo|Intervalos|Rodaje largo|Fartlek|Series|Base)/i);
    if (typeMatch) type = typeMatch[1];

    let distance = null;
    const distMatch = text.match(/\*\*([0-9]+(?:-[0-9]+)?\s*k?m)\*\*/i) 
      || text.match(/([0-9]+(?:-[0-9]+)?\s*k?m)/i);
    if (distMatch) distance = distMatch[1];

    let pace = null;
    const paceMatch = text.match(/\*\*([0-9]+:[0-9]+(?:-[0-9]+:[0-9]+)?\s*min\/km)\*\*/i) 
      || text.match(/([0-9]+:[0-9]+(?:-[0-9]+:[0-9]+)?\s*min\/km)/i)
      || text.match(/([0-9]+:[0-9]+(?:-[0-9]+:[0-9]+)?)/i);
    if (paceMatch) pace = paceMatch[1];

    let hrZone = null;
    const hrMatch = text.match(/\*\*(Zona \d+(?:\s*·\s*\d+-\d+\s*ppm)?)\*\*/i)
      || text.match(/(Zona \d+(?:\s*·\s*\d+-\d+\s*ppm)?)/i)
      || text.match(/(Zona \d+)/i);
    if (hrMatch) hrZone = hrMatch[1];

    return { type, distance, pace, hrZone };
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
            value={selectedModel}
            disabled={loading}
            onChange={e => {
              const m = e.target.value;
              localStorage.setItem('ai_insights_model', m);
              setSelectedModel(m);
              setLoaded(false);
            }}
            className="text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 pr-7 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none shadow-sm"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {GEMINI_MODELS.map(m => (
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

      {/* ── Loading status banner ── */}
      {loading && providerLabel && (
        <div className={`flex items-center gap-2 px-5 py-2.5 border-b text-[11px] font-bold ${
          isFallback
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
      </div>

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
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Tendencia anual</span>
              <span className="text-[10px] text-slate-400 font-medium">· 12 meses</span>
            </div>
            {trend && (() => {
              const text = trend.toLowerCase();
              let badge = { text: 'Estacional 📅', color: 'bg-slate-50 text-slate-600 border-slate-200' };
              if (text.includes('progres') || text.includes('mejor')) {
                badge = { text: 'Progresión constante 📈', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
              } else if (text.includes('estanc') || text.includes('meseta') || text.includes('estabil')) {
                badge = { text: 'Meseta / Estable 📊', color: 'bg-amber-50 text-amber-700 border-amber-200' };
              } else if (text.includes('lesi') || text.includes('dolor') || text.includes('riesgo')) {
                badge = { text: 'Riesgo de lesión ⚠️', color: 'bg-rose-50 text-rose-700 border-rose-200' };
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
                          <span className={`inline-flex items-center px-3 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                            w?.type?.toLowerCase().includes('regen') ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/60' :
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
      <div className="px-5 py-2.5 bg-slate-50/60 border-t border-slate-100/60 flex items-center gap-1.5 bg-white/40">
        <SparklesIcon className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[10px] text-slate-400 font-semibold">
          {usedProvider || 'IA'} · Recomendación inteligente · Basada en tu carga de entrenamiento
        </span>
      </div>
    </div>
  );
};

export default AIInsights;
