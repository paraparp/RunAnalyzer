import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { generateAIObject, fetchGeminiModels } from '../services/ai';
import { buildPrompt } from '../lib/athleteContext';
import { getNextTargetRace, DISTANCES, TARGET_RACES_EVENT } from '../lib/targetRaces';
import { FALLBACK_GEMINI, DEFAULT_GEMINI_MODEL } from '../components/ModelSelector';
import { paceStr, coachObjectToBlocks, coachCoherenceWarnings } from '../lib/aiInsights';

// Máquina de estados del análisis IA: caché con validación, backup/restore,
// cadena de proveedores (Gemini → Groq) y carga de datos Garmin/Strava.
// El componente AIInsights queda solo con la capa de presentación.
export default function useAIInsights(activities) {
  const [cur, setCur] = useState('');
  const [trend, setTrend] = useState('');
  const [nextWork, setNextWork] = useState('');
  const [lastWork, setLastWork] = useState('');
  const [meta, setMeta] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [garmin, setGarmin] = useState(undefined);
  const [sleep, setSleep] = useState(undefined);
  const [stravaFetch, setStravaFetch] = useState(null);
  const [sci, setSci] = useState(null);
  // Último prompt construido para la IA (para inspección/copia desde la UI)
  const [lastPrompt, setLastPrompt] = useState('');
  const [cacheTs, setCacheTs] = useState(null);
  const [restoreWarning, setRestoreWarning] = useState(false);
  const [providerLabel, setProviderLabel] = useState('');
  const [usedProvider, setUsedProvider] = useState('');
  const [isFallback, setIsFallback] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    () => cloudStorage.getItem('ai_insights_model') || DEFAULT_GEMINI_MODEL
  );
  const [weeklyTarget, setWeeklyTarget] = useState(
    () => cloudStorage.getItem('ai_weekly_target') || '2'
  );

  // El objetivo de carrera se deriva de la próxima "carrera objetivo" guardada.
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
      pace = paceStr(nextRace.goalTimeMin / km);
    }
    return { distance, pace, date: nextRace.date };
  }, [nextRace]);

  // Model list — starts with the shared fallback, replaced by the live
  // ListModels response when the API key is available.
  const [availableModels, setAvailableModels] = useState(FALLBACK_GEMINI);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchGeminiModels(ctrl.signal)
      .then(models => { if (models.length) setAvailableModels(models); })
      .catch(() => { /* keep shared fallback */ });
    return () => ctrl.abort();
  }, []);

  // Si el modelo persistido no está en la lista viva (id obsoleto), se corrige
  // al primero disponible — así el <select> nunca queda en blanco ni se envía
  // un modelo inexistente (mismo criterio que ModelSelector).
  useEffect(() => {
    if (availableModels.length && !availableModels.some(m => m.id === selectedModel)) {
      const next = availableModels[0].id;
      setSelectedModel(next);
      cloudStorage.setItem('ai_insights_model', next);
    }
  }, [availableModels, selectedModel]);

  // Ajustes en ref-espejo: `run` los lee de aquí para NO depender de ellos.
  // Así cambiar modelo/frecuencia/objetivo no recrea `run` ni re-dispara el
  // efecto de auto-arranque (= no quema cuota API por tocar un selector);
  // el nuevo ajuste se aplica al pulsar "Recalcular" o al cambiar los datos.
  const settingsRef = useRef({ selectedModel, weeklyTarget, goal, availableModels });
  useEffect(() => {
    settingsRef.current = { selectedModel, weeklyTarget, goal, availableModels };
  }, [selectedModel, weeklyTarget, goal, availableModels]);

  // Ref to always-current state for backup/restore inside run (avoids stale closure)
  const stateRef = useRef({ cur, trend, nextWork, lastWork, meta, cacheTs });
  useEffect(() => {
    stateRef.current = { cur, trend, nextWork, lastWork, meta, cacheTs };
  }, [cur, trend, nextWork, lastWork, meta, cacheTs]);

  // Ref to abort ongoing stream on unmount or new run
  const abortRef = useRef(null);
  // Timer del aviso de restauración + flag de montaje (evitan setState tras unmount)
  const warnTimerRef = useRef(null);
  const aliveRef = useRef(true);
  useEffect(() => () => {
    aliveRef.current = false;
    abortRef.current?.abort();
    clearTimeout(warnTimerRef.current);
  }, []);

  // Load Garmin cardiac (HRV/RHR/Body Battery) + weekly sleep data
  useEffect(() => {
    const loadGarminData = () => {
      try {
        const s = cloudStorage.getItem('garmin_cardiac_data');
        if (s) { setGarmin(JSON.parse(s)); }
        else {
          fetch('/garmin_data.json')
            .then(r => r.ok ? r.json() : null)
            .then(j => { if (aliveRef.current) setGarmin(j?.data ?? null); })
            .catch(() => { if (aliveRef.current) setGarmin(null); });
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
    loadGarminData();
    window.addEventListener('garmin_sync_complete', loadGarminData);
    return () => window.removeEventListener('garmin_sync_complete', loadGarminData);
  }, []);

  const run = useCallback(async (force = false) => {
    if (!activities?.length || activities.length < 3) return;
    const { selectedModel: model, weeklyTarget: weekly, goal: raceGoal, availableModels: models } = settingsRef.current;
    const built = buildPrompt(activities, garmin, sleep, weekly, raceGoal);
    if (!built) return;
    const { prompt, sci: builtSci } = built;
    setSci(builtSci);
    setLastPrompt(prompt);

    // Check cache — key includes model so switching models bypasses cache
    if (!force) {
      try {
        const cached = cloudStorage.getItem('ai_insights_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.prompt === prompt && parsed.model === model && parsed.cur && parsed.trend) {
            setCur(parsed.cur);
            setTrend(parsed.trend);
            if (parsed.nextWork) setNextWork(parsed.nextWork);
            if (parsed.lastWork) setLastWork(parsed.lastWork);
            setMeta(parsed.meta ?? null);
            setWarnings(parsed.warnings ?? []);
            setCacheTs(parsed.timestamp);
            setUsedProvider(parsed.provider ?? '');
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
        name: models.find(m => m.id === model)?.label.split(' ·')[0] ?? 'Gemini',
        provider: 'gemini',
        model,
      },
      {
        name: 'Groq Llama',
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
      },
    ];

    // Snapshot current state via ref (avoids stale closure)
    const { cur: prevCur, trend: prevTrend, nextWork: prevNextWork, lastWork: prevLastWork, meta: prevMeta, cacheTs: prevTs } = stateRef.current;
    try {
      cloudStorage.setItem('ai_insights_backup', JSON.stringify({
        cur: prevCur, trend: prevTrend, nextWork: prevNextWork, lastWork: prevLastWork, meta: prevMeta, timestamp: prevTs,
      }));
    } catch { /* ignore */ }

    // Abort any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true); setCur(''); setTrend(''); setNextWork(''); setLastWork(''); setMeta(null); setWarnings([]); setUsedProvider(''); setIsFallback(false);

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
          // Salida estructurada: el esquema coachInsights se valida con Zod en
          // el servidor, así que aquí ya no hay parseo de bloques ni regex.
          // Temperatura baja: prescripción numérica, consistencia entre recálculos.
          const object = await generateAIObject({
            provider: provider.provider,
            model: provider.model,
            prompt,
            temperature: 0.2,
            schema: 'coachInsights',
            signal: controller.signal,
          });

          // Conversión a bloques de texto + metadatos. Si el objeto no trae
          // diagnóstico/tendencia con contenido real (típico del fallback que
          // no respeta el esquema), se trata como fallo y se prueba el siguiente.
          const blocks = coachObjectToBlocks(object);
          if (!blocks) {
            throw new Error('Respuesta estructurada incompleta');
          }
          // Validación de coherencia científica de la prescripción (post-hoc).
          const coherence = coachCoherenceWarnings(object, builtSci);

          // Commit del estado ANTES de tocar storage: un fallo de quota al
          // escribir la caché no debe descartar una respuesta buena ni
          // encadenar otro proveedor.
          const ts = Date.now();
          setCur(blocks.cur); setTrend(blocks.trend);
          setNextWork(blocks.nextWork); setLastWork(blocks.lastWork);
          setMeta(blocks.meta);
          setWarnings(coherence);
          setUsedProvider(provider.name);
          setCacheTs(ts);
          succeeded = true;

          try {
            cloudStorage.setItem('ai_insights_cache', JSON.stringify({
              prompt,
              model,
              cur: blocks.cur,
              trend: blocks.trend,
              nextWork: blocks.nextWork,
              lastWork: blocks.lastWork,
              meta: blocks.meta,
              warnings: coherence,
              timestamp: ts,
              provider: provider.name,
            }));
            cloudStorage.removeItem('ai_insights_backup');
          } catch (e) {
            console.warn('[AIInsights] No se pudo escribir la caché:', e);
          }
          break;
        } catch (e) {
          if (controller.signal.aborted) break;
          console.warn(`[AIInsights] ${provider.name} falló:`, e);
          setCur(''); setTrend(''); setNextWork(''); setLastWork(''); setMeta(null); setWarnings([]);
        }
      }

      if (!succeeded && !controller.signal.aborted) {
        if (prevCur) {
          setCur(prevCur); setTrend(prevTrend); setNextWork(prevNextWork); setLastWork(prevLastWork); setMeta(prevMeta ?? null); setCacheTs(prevTs);
          setRestoreWarning(true);
          clearTimeout(warnTimerRef.current);
          warnTimerRef.current = setTimeout(() => setRestoreWarning(false), 6000);
        } else {
          setCur('**Sin respuesta de ningún modelo** · Puede ser rate-limit (429). Cambia de modelo en el selector o vuelve a intentarlo en unos minutos.');
          setTrend(''); setNextWork(''); setLastWork(''); setMeta(null);
        }
      }
    } finally {
      // Solo el run vigente puede apagar el spinner: un run abortado resuelve
      // su finally DESPUÉS de que el nuevo puso loading=true y lo dejaría a
      // medias (spinner apagado con stream en vuelo).
      if (abortRef.current === controller) {
        setProviderLabel('');
        setLoading(false);
      }
    }
  }, [activities, garmin, sleep]);

  useEffect(() => {
    if (activities?.length >= 3 && garmin !== undefined && sleep !== undefined) run(false);
  }, [activities, garmin, sleep, run]);

  const changeModel = useCallback((m) => {
    cloudStorage.setItem('ai_insights_model', m);
    setSelectedModel(m);
  }, []);

  const changeWeeklyTarget = useCallback((v) => {
    cloudStorage.setItem('ai_weekly_target', v);
    setWeeklyTarget(v);
  }, []);

  const dismissRestoreWarning = useCallback(() => setRestoreWarning(false), []);

  return {
    cur, trend, nextWork, lastWork, meta, sci, warnings, lastPrompt,
    loading, providerLabel, usedProvider, isFallback,
    cacheTs, restoreWarning, dismissRestoreWarning,
    garmin, stravaFetch,
    selectedModel, changeModel,
    weeklyTarget, changeWeeklyTarget,
    availableModels, goal,
    run,
  };
}
