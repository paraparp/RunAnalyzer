import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import cloudStorage from '../lib/cloudStorage';
import useGarminWearableData from './useGarminWearableData';
import {
  generateAIObject, fetchModelGroups, buildModelGroups, buildProviderChain,
  parseModelValue, normalizeModelValue, FALLBACK_GEMINI,
} from '../services/ai';
import { buildPrompt } from '../lib/athleteContext';
import { getPrimaryTargetRace, DISTANCES, TARGET_RACES_EVENT } from '../lib/targetRaces';
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
  const { garmin, sleep } = useGarminWearableData();
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
    () => normalizeModelValue(cloudStorage.getItem('ai_insights_model'))
  );
  const [weeklyTarget, setWeeklyTarget] = useState(
    () => cloudStorage.getItem('ai_weekly_target') || '2'
  );

  // El objetivo de carrera se deriva de la próxima "carrera objetivo" guardada.
  const [nextRace, setNextRace] = useState(getPrimaryTargetRace);
  useEffect(() => {
    const reload = () => setNextRace(getPrimaryTargetRace());
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

  // Grupos "empresa → modelos" — arrancan con la reserva Gemini y se reemplazan
  // con la lista viva (Gemini + OpenRouter) cuando el endpoint responde.
  const [modelGroups, setModelGroups] = useState(() => buildModelGroups({ gemini: FALLBACK_GEMINI }));
  useEffect(() => {
    const ctrl = new AbortController();
    fetchModelGroups(ctrl.signal)
      .then(g => { if (g.length) setModelGroups(g); })
      .catch(() => { /* keep shared fallback */ });
    return () => ctrl.abort();
  }, []);

  // Si el valor persistido no está entre las opciones vivas (modelo obsoleto), se
  // corrige al primero disponible — así el <select> nunca queda en blanco ni se
  // envía un modelo inexistente (mismo criterio que ModelSelector).
  const modelValues = useMemo(() => modelGroups.flatMap(g => g.options.map(o => o.value)), [modelGroups]);
  useEffect(() => {
    if (modelValues.length && !modelValues.includes(selectedModel)) {
      const next = modelValues[0];
      setSelectedModel(next);
      cloudStorage.setItem('ai_insights_model', next);
    }
  }, [modelValues, selectedModel]);

  // Ajustes en ref-espejo: `run` los lee de aquí para NO depender de ellos.
  // Así cambiar modelo/frecuencia/objetivo no recrea `run` ni re-dispara el
  // efecto de auto-arranque (= no quema cuota API por tocar un selector);
  // el nuevo ajuste se aplica al pulsar "Recalcular" o al cambiar los datos.
  const settingsRef = useRef({ selectedModel, weeklyTarget, goal });
  useEffect(() => {
    settingsRef.current = { selectedModel, weeklyTarget, goal };
  }, [selectedModel, weeklyTarget, goal]);

  // Ref to always-current state for backup/restore inside run (avoids stale closure)
  const stateRef = useRef({ cur, trend, nextWork, lastWork, meta, cacheTs });
  useEffect(() => {
    stateRef.current = { cur, trend, nextWork, lastWork, meta, cacheTs };
  }, [cur, trend, nextWork, lastWork, meta, cacheTs]);

  // Ref to abort ongoing stream on unmount or new run
  const abortRef = useRef(null);
  // Timer del aviso de restauración (evita setState tras unmount)
  const warnTimerRef = useRef(null);
  useEffect(() => () => {
    abortRef.current?.abort();
    clearTimeout(warnTimerRef.current);
  }, []);

  // Date of the last Strava fetch, refreshed alongside the wearable caches.
  useEffect(() => {
    const loadStravaFetch = () => {
      try {
        const sd = cloudStorage.getItem('stravaData');
        setStravaFetch(sd ? (JSON.parse(sd).lastFetchDate ?? null) : null);
      } catch { setStravaFetch(null); }
    };
    loadStravaFetch();
    window.addEventListener('garmin_sync_complete', loadStravaFetch);
    return () => window.removeEventListener('garmin_sync_complete', loadStravaFetch);
  }, []);

  const run = useCallback(async (force = false) => {
    if (!activities?.length || activities.length < 3) return;
    const { selectedModel: model, weeklyTarget: weekly, goal: raceGoal } = settingsRef.current;
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

    // Cadena de proveedores: el modelo elegido (empresa|modelo) primero, luego el
    // resto de proveedores gratuitos como fallback. Las API keys viven en el
    // servidor; aquí solo se indica proveedor + modelo.
    const providers = buildProviderChain(parseModelValue(model));

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
    modelGroups, goal,
    run,
  };
}
