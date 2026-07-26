import React, { useState, useEffect, useRef } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { generateAIObjectWithFallback, parseModelValue } from '../services/ai';
import {
    Card,
    Title,
    Text,
    Metric,
    Grid,
    Badge,
    Flex,
    Button,
    Callout
} from "@tremor/react";
import { CalculatorIcon, SparklesIcon, ExclamationTriangleIcon, FlagIcon } from "@heroicons/react/24/solid";
import ModelSelector, { DEFAULT_GEMINI_MODEL } from './ModelSelector';
import AIToolHeader from './AIToolHeader';
import { buildPrompt, buildPlainActivityLog } from '../lib/athleteContext';
import NextRaceBanner from './NextRaceBanner';
import { getNextTargetRace, daysUntil, formatMinutes, TARGET_RACES_EVENT } from '../lib/targetRaces';

// Distancias oficiales por etiqueta canónica.
const RACE_KM = { '5K': 5, '10K': 10, 'Media Maratón': 21.0975, 'Maratón': 42.195 };
const GOAL_KEY_TO_LABEL = { '5k': '5K', '10k': '10K', '21k': 'Media Maratón', '42k': 'Maratón' };
const CONFIDENCE_COLOR = { Alta: 'emerald', Media: 'amber', Baja: 'rose' };

// El esquema del servidor es permisivo (label es string libre, no enum), así que
// el modelo puede devolver "media maraton", "HM", "21k"… Se mapea a la etiqueta
// canónica antes de calcular; lo que no reconozca se descarta.
const normalizeLabel = (raw) => {
    const s = String(raw || '').toLowerCase().replace(/[·\-\s]/g, '');
    if (/(^|[^0-9])5k|^5000m?$/.test(s)) return '5K';
    if (/10k|10000m?/.test(s)) return '10K';
    if (/(media|half|21k|21\.1|halfmarathon)/.test(s)) return 'Media Maratón';
    if (/(marat|42k|42\.2|full)/.test(s)) return 'Maratón';
    return null;
};

const normalizeConfidence = (raw) => {
    const s = String(raw || '').toLowerCase();
    if (s.startsWith('alt') || s.startsWith('hig')) return 'Alta';
    if (s.startsWith('med')) return 'Media';
    return 'Baja';
};

const fmtTime = (totalSec) => {
    const s = Math.round(totalSec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
        : `${m}:${String(sec).padStart(2, '0')}`;
};

const fmtPace = (secPerKm) => {
    let m = Math.floor(secPerKm / 60);
    let s = Math.round(secPerKm % 60);
    if (s === 60) { m += 1; s = 0; }
    return `${m}:${String(s).padStart(2, '0')}`;
};

// Valida y deriva las predicciones del modelo: el ritmo se calcula SIEMPRE en
// cliente (tiempo/distancia), se descartan tiempos implausibles y se detectan
// inversiones de ritmo (una distancia larga "más rápida" que una corta).
const normalizePredictions = (raw) => {
    const seen = new Set();
    const items = (raw || [])
        .map(p => ({ ...p, _label: normalizeLabel(p?.label), _time: Number(p?.time_seconds) }))
        .filter(p => p._label && Number.isFinite(p._time) && p._time > 0)
        .filter(p => !seen.has(p._label) && seen.add(p._label))
        .map(p => {
            const km = RACE_KM[p._label];
            return {
                label: p._label,
                km,
                confidence: normalizeConfidence(p.confidence),
                rationale: p.rationale || '',
                timeSeconds: Math.round(p._time),
                paceSec: p._time / km,
            };
        })
        // 2:30–12:00 min/km: fuera de ahí es una alucinación, no una predicción.
        .filter(p => p.paceSec >= 150 && p.paceSec <= 720)
        .sort((a, b) => a.km - b.km);

    let inconsistent = false;
    for (let i = 1; i < items.length; i++) {
        if (items[i].paceSec < items[i - 1].paceSec - 1) inconsistent = true;
    }
    return { items, inconsistent };
};

const RacePredictor = ({ activities }) => {
    const [selectedModel, setSelectedModel] = useState(
        () => cloudStorage.getItem('racepredictor_model') || DEFAULT_GEMINI_MODEL
    );
    useEffect(() => { try { cloudStorage.setItem('racepredictor_model', selectedModel); } catch { /* ignore */ } }, [selectedModel]);
    // Aborta la petición en curso al desmontar (evita setState sobre desmontado).
    const abortRef = useRef(null);
    useEffect(() => () => abortRef.current?.abort(), []);
    const [loading, setLoading] = useState(false);
    const [predictions, setPredictions] = useState(null);
    const [inconsistent, setInconsistent] = useState(false);
    const [generatedAt, setGeneratedAt] = useState(null);
    const [error, setError] = useState('');
    const [analysis, setAnalysis] = useState('');

    // Próxima carrera objetivo (gestionada en la sección "Carreras objetivo").
    // Si existe, se inyecta en el prompt para evaluar la viabilidad del objetivo.
    const [nextRace, setNextRace] = useState(getNextTargetRace);
    useEffect(() => {
        const reload = () => setNextRace(getNextTargetRace());
        window.addEventListener(TARGET_RACES_EVENT, reload);
        return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
    }, []);

    // Wearable context (HRV / sleep), same sources as the AI suggestion panel.
    const [garmin, setGarmin] = useState(null);
    const [sleep, setSleep] = useState(null);
    useEffect(() => {
        const load = () => {
            try {
                const s = cloudStorage.getItem('garmin_cardiac_data');
                if (s) setGarmin(JSON.parse(s));
                else fetch('/garmin_data.json').then(r => r.ok ? r.json() : null).then(j => setGarmin(j?.data ?? null)).catch(() => setGarmin(null));
            } catch { setGarmin(null); }
            try { const sl = cloudStorage.getItem('garmin_sleep_data'); setSleep(sl ? JSON.parse(sl) : null); } catch { setSleep(null); }
        };
        load();
        window.addEventListener('garmin_sync_complete', load);
        return () => window.removeEventListener('garmin_sync_complete', load);
    }, []);

    // Rich athlete context (PMC, ACWR, HR zones, reference paces, PBs, polarized
    // distribution, wearable) — same science as the AI suggestion. No race goal
    // here: predictions cover all standard distances. Falls back to plain list.
    const buildRaceContext = () => {
        try {
            const { athleteContext } = buildPrompt(activities, garmin, sleep, null, undefined);
            return athleteContext || buildPlainActivityLog(activities) || 'No hay historial.';
        } catch {
            return buildPlainActivityLog(activities) || 'No hay historial.';
        }
    };

    const generateAIPrediction = async () => {
        setLoading(true);
        setError('');
        setPredictions(null);
        setInconsistent(false);

        // Mínimo real de datos: antes se medía la LONGITUD DEL STRING del log
        // (una sola carrera ya pasaba); ahora se cuentan carreras de verdad.
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const recentCount = (activities || []).filter(a => new Date(a.start_date) >= threeMonthsAgo).length;
        if (recentCount < 5) {
            setError(`Solo hay ${recentCount} carrera(s) en los últimos 3 meses; se necesitan al menos 5 para una predicción fiable.`);
            setLoading(false);
            return;
        }

        const richContext = buildRaceContext();

        // Objetivo del corredor (si tiene una carrera futura guardada).
        let goalBlock = '';
        if (nextRace) {
            const d = daysUntil(nextRace.date);
            const goalTimeStr = nextRace.goalTimeMin != null ? formatMinutes(nextRace.goalTimeMin) : null;
            goalBlock = `\n\nOBJETIVO DEL CORREDOR: "${nextRace.name}" — ${GOAL_KEY_TO_LABEL[nextRace.distance] || nextRace.distance}` +
                (goalTimeStr ? ` con tiempo objetivo ${goalTimeStr}` : '') +
                (d != null ? `, dentro de ${d} días` : '') +
                `. En "analysis" indica explícitamente si su forma actual lo pone en camino de lograr ese objetivo y, si no, qué le falta (ritmo, volumen, semanas de trabajo).`;
        }

        try {
            const prompt = `Actúa como un experto fisiólogo deportivo y entrenador de running que aplica ciencia validada (modelo PMC de Banister CTL/ATL/TSB, ratio agudo:crónico de Gabbett, umbral de lactato).
Analiza el siguiente contexto del corredor (datos científicos: carga de entrenamiento, ACWR, zonas de FC, ritmos de referencia, marcas personales, distribución polarizada, wearable):

${richContext}

TAREA:
Devuelve exactamente 4 predicciones (5K, 10K, Media Maratón, Maratón) con el tiempo total en SEGUNDOS en "time_seconds". Son sus marcas potenciales REALISTAS ACTUALES (si compitiera hoy, EN LLANO), no la mejor marca teórica.

MÉTODO (aplícalo en este orden antes de responder):
1. ANCLAJE: identifica la marca personal o el mejor esfuerzo sostenido más reciente y fiable del contexto (distancia, tiempo, ritmo). Corrige por desnivel: ritmos corridos con +m de desnivel equivalen a un ritmo más rápido en llano (GAP).
2. EXTRAPOLACIÓN: proyecta a las demás distancias con Riegel: T2 = T1 × (D2/D1)^1.06.
3. AJUSTE: corrige por forma actual (CTL/TSB), volumen semanal y frecuencia. Si el volumen es insuficiente para la distancia (p. ej. maratón sin tiradas largas), penaliza claramente la predicción y dilo en "rationale".
4. VERIFICACIÓN: el ritmo implícito (time_seconds ÷ km) debe ser estrictamente más lento cuanto mayor la distancia (5K < 10K < Media < Maratón). Si no se cumple, corrígelo antes de responder.

REGLAS DE FIABILIDAD (la fiabilidad importa más que el optimismo):
- Una predicción NO puede ser más rápida que la marca personal de esa distancia salvo mejora clara y reciente del umbral o de la forma; si ocurre, justifícalo en "rationale".
- Confianza "Alta" solo con esfuerzos o marcas recientes cerca de esa distancia; "Media" si extrapolas moderadamente; "Baja" si extrapolas lejos del historial.
- "rationale" (máx 15 palabras): anclaje usado y ajuste aplicado, p. ej. "PB 10K 42:30 reciente + Riegel, penalizado por bajo volumen".${goalBlock}`;

            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            const object = await generateAIObjectWithFallback({
                ...parseModelValue(selectedModel),
                prompt,
                temperature: 0.2, // Predicción numérica: consistencia entre ejecuciones, no creatividad
                schema: 'racePrediction',
                signal: controller.signal,
            });

            const { items, inconsistent: hasInversion } = normalizePredictions(object.predictions);
            if (items.length === 0) {
                throw new Error('la IA devolvió tiempos fuera de rango; vuelve a intentarlo o cambia de modelo');
            }
            setPredictions(items);
            setInconsistent(hasInversion);
            setAnalysis(object.analysis);
            setGeneratedAt(new Date());
            setLoading(false);

        } catch (err) {
            if (err?.name === 'AbortError') return; // desmontado o cancelado
            console.error("Error generando predicción:", err);

            let errorMessage = err.message || "Error desconocido";
            if (errorMessage.includes('404') || errorMessage.includes('401')) {
                errorMessage = "La API Key del servidor no es válida o no tiene permisos.";
            } else if (errorMessage.includes('429')) {
                errorMessage = "Has excedido la cuota (429) en Gemini y Groq. Prueba otro modelo o inténtalo más tarde.";
            } else {
                errorMessage = `Error generando predicción: ${errorMessage}.`;
            }

            setError(errorMessage);
            setLoading(false);
        }
    };

    // Comparación con el objetivo guardado: solo aplica a la tarjeta de esa distancia.
    const goalForPrediction = (pred) => {
        if (!nextRace || nextRace.goalTimeMin == null) return null;
        if (GOAL_KEY_TO_LABEL[nextRace.distance] !== pred.label) return null;
        const goalSec = nextRace.goalTimeMin * 60;
        const delta = pred.timeSeconds - goalSec; // >0: forma actual más lenta que el objetivo
        return { goalSec, delta };
    };

    const maxPace = predictions ? Math.max(...predictions.map(p => p.paceSec)) : 0;

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <AIToolHeader title="Predictor Biométrico AI" subtitle="Predice tus marcas potenciales en carrera">
                <ModelSelector
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    disabled={loading}
                    showLabel={false}
                />
            </AIToolHeader>

            {/* Próxima carrera objetivo */}
            <NextRaceBanner />

            {/* Generate Button */}
            {!predictions && !loading && (
                <Card className="p-8 ring-1 ring-slate-200 dark:ring-slate-800 shadow-sm bg-white dark:bg-slate-900">
                    <div className="text-center py-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        <span className="text-4xl block mb-3">🎯</span>
                        <Text className="text-slate-500 dark:text-slate-400 mb-2">
                            Analiza tu historial con IA para estimar tus marcas actuales en llano (5K a Maratón).
                        </Text>
                        <Text className="text-xs text-slate-400 dark:text-slate-500 mb-6">
                            Anclada a tus marcas personales y umbral, extrapolada con Riegel y ajustada por tu forma (CTL/TSB).
                        </Text>
                        <Button size="xl" onClick={generateAIPrediction} icon={CalculatorIcon} disabled={loading} color="blue">
                            Generar Predicción Inteligente
                        </Button>
                        {error && <Callout title="Error" color="rose" className="mt-6 text-left">{error}</Callout>}
                    </div>
                </Card>
            )}

            {loading && (
                <Card className="p-8 ring-1 ring-slate-200 dark:ring-slate-800 shadow-sm bg-white dark:bg-slate-900">
                    <div className="text-center py-8">
                        <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                        <Text className="text-slate-600 dark:text-slate-300 font-medium">Analizando marcas, umbral y forma actual (CTL/TSB)...</Text>
                        <Grid numItems={2} numItemsSm={4} className="gap-3 mt-8">
                            {['5K', '10K', 'Media', 'Maratón'].map(d => (
                                <div key={d} className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                            ))}
                        </Grid>
                    </div>
                </Card>
            )}

            {/* Results Grid */}
            {predictions && (
                <div className="space-y-6 fade-in">
                    {analysis && (
                        <Callout title="Análisis del Entrenador AI" icon={SparklesIcon} color="blue">
                            {analysis}
                        </Callout>
                    )}

                    {inconsistent && (
                        <Callout title="Predicción poco consistente" icon={ExclamationTriangleIcon} color="amber">
                            Los ritmos entre distancias no siguen la progresión esperada (una distancia larga sale más rápida que una corta). Considera recalcular o cambiar de modelo.
                        </Callout>
                    )}

                    <Grid numItems={1} numItemsSm={2} numItemsLg={4} className="gap-4">
                        {predictions.map((pred) => {
                            const goal = goalForPrediction(pred);
                            return (
                                <Card
                                    key={pred.label}
                                    decoration="top"
                                    decorationColor={CONFIDENCE_COLOR[pred.confidence]}
                                    className="p-4 ring-1 ring-slate-200 dark:ring-slate-800 shadow-sm bg-white dark:bg-slate-900"
                                >
                                    <Flex justifyContent="between" alignItems="start">
                                        <Text className="font-semibold text-slate-700 dark:text-slate-200">{pred.label}</Text>
                                        <Badge color={CONFIDENCE_COLOR[pred.confidence]} size="xs">{pred.confidence}</Badge>
                                    </Flex>
                                    <Metric className="mt-2 text-slate-900 dark:text-slate-50">{fmtTime(pred.timeSeconds)}</Metric>
                                    <Text className="font-mono mt-1 text-slate-500 dark:text-slate-400">{fmtPace(pred.paceSec)} /km</Text>
                                    {pred.rationale && (
                                        <Text className="text-xs text-slate-400 dark:text-slate-500 mt-2 leading-snug">{pred.rationale}</Text>
                                    )}
                                    {goal && (
                                        <div className={`mt-3 flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2 py-1.5 ${goal.delta <= 0
                                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400'}`}>
                                            <FlagIcon className="w-3.5 h-3.5 shrink-0" />
                                            {goal.delta <= 0
                                                ? `${fmtTime(Math.abs(goal.delta))} por debajo de tu objetivo (${fmtTime(goal.goalSec)})`
                                                : `A ${fmtTime(goal.delta)} de tu objetivo (${fmtTime(goal.goalSec)})`}
                                        </div>
                                    )}
                                </Card>
                            );
                        })}
                    </Grid>

                    <Card className="p-6 ring-1 ring-slate-200 dark:ring-slate-800 shadow-sm bg-white dark:bg-slate-900">
                        <Title className="text-lg font-semibold text-slate-900 dark:text-slate-100">Comparativa de Ritmos (min/km)</Title>
                        <div className="mt-4 space-y-3">
                            {predictions.map((p) => (
                                <div key={p.label} className="flex items-center gap-3">
                                    <span className="w-28 shrink-0 text-sm font-medium text-slate-600 dark:text-slate-300">{p.label}</span>
                                    <div className="flex-1 h-6 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                        <div
                                            className="h-full rounded-md bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
                                            style={{ width: `${(p.paceSec / maxPace) * 100}%` }}
                                        />
                                    </div>
                                    <span className="w-16 shrink-0 text-right font-mono text-sm text-slate-700 dark:text-slate-200">{fmtPace(p.paceSec)}</span>
                                </div>
                            ))}
                        </div>
                    </Card>

                    <Flex justifyContent="between" alignItems="center" className="flex-wrap gap-2">
                        <Text className="text-xs text-slate-400 dark:text-slate-500">
                            {generatedAt && `Generado a las ${generatedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · `}
                            Estimación orientativa; no sustituye un test de campo.
                        </Text>
                        <Button variant="secondary" onClick={generateAIPrediction} color="blue" disabled={loading}>
                            Recalcular Predicción
                        </Button>
                    </Flex>
                </div>
            )}
        </div>
    );
};

export default RacePredictor;
