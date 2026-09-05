import React, { useState, useEffect, useRef, useMemo } from 'react';
import useGarminWearableData from '../hooks/useGarminWearableData';
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
import { SparklesIcon, FlagIcon } from "@heroicons/react/24/solid";
import useAIModel from '../hooks/useAIModel';
import AIToolHeader from './AIToolHeader';
import { buildPrompt, buildPlainActivityLog } from '../lib/athleteContext';
import NextRaceBanner from './NextRaceBanner';
import { getPrimaryTargetRace, daysUntil, formatMinutes, TARGET_RACES_EVENT } from '../lib/targetRaces';
import { LABEL_BY_KEY } from '../lib/raceDistances';
import { formatDuration, formatPaceFromSecPerKm } from '../lib/timeFormat';
import { predictRaces, applyCoachAdjustment } from '../lib/racePrediction';

const GOAL_KEY_TO_LABEL = LABEL_BY_KEY;
const CONFIDENCE_COLOR = { Alta: 'emerald', Media: 'amber', Baja: 'rose' };

// Nombre corto de cada modelo, para que la tarjeta diga de dónde sale el número.
const MODEL_LABEL = { vdot: 'VDOT', cs: 'CS/D′', riegel: 'Riegel' };

const RacePredictor = ({ activities }) => {
    // Modelo IA: preferencia global (se cambia en el menú de usuario).
    const [selectedModel] = useAIModel();
    // Aborta la petición en curso al desmontar (evita setState sobre desmontado).
    const abortRef = useRef(null);
    useEffect(() => () => abortRef.current?.abort(), []);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Predicción DETERMINISTA: VDOT sobre la curva mean-max + velocidad crítica
    // dentro de su ventana + Riegel con exponente ajustado al atleta. Se calcula
    // sin pedirle nada a nadie, así que está lista al abrir la pestaña.
    const model = useMemo(() => predictRaces(activities || []), [activities]);

    // El ajuste y la redacción de la IA se guardan JUNTO AL modelo que los
    // originó: si el histórico cambia, el ajuste deja de aplicarse por sí solo y
    // se vuelve a los números calculados, sin un efecto que resetee estado.
    const [coach, setCoach] = useState(null);
    const applied = coach?.forModel === model ? coach : null;
    const predictions = applied?.items || model.items;
    const analysis = applied?.analysis || '';
    const generatedAt = applied?.at || null;

    // Próxima carrera objetivo (gestionada en la sección "Carreras objetivo").
    // Si existe, se inyecta en el prompt para evaluar la viabilidad del objetivo.
    const [nextRace, setNextRace] = useState(getPrimaryTargetRace);
    useEffect(() => {
        const reload = () => setNextRace(getPrimaryTargetRace());
        window.addEventListener(TARGET_RACES_EVENT, reload);
        return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
    }, []);

    // Wearable context (HRV / sleep), same sources as the AI suggestion panel.
    const { garmin, sleep } = useGarminWearableData();

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

    const generateAIAnalysis = async () => {
        setLoading(true);
        setError('');

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

        const anchor = model.anchor;
        const computedBlock = model.items.map((p) => {
            const from = Object.keys(p.models).map((k) => MODEL_LABEL[k]).join(' + ');
            return `- ${p.label}: ${p.timeSeconds} s (${formatDuration(p.timeSeconds)}, ${formatPaceFromSecPerKm(p.paceSec)}/km) — modelos: ${from}; confianza ${p.confidence}`;
        }).join('\n');

        try {
            const prompt = `Actúa como un experto fisiólogo deportivo y entrenador de running que aplica ciencia validada (modelo PMC de Banister CTL/ATL/TSB, ratio agudo:crónico de Gabbett, umbral de lactato).

PREDICCIONES YA CALCULADAS (no las recalcules: salen de modelos deterministas ajustados sobre el histórico real de este corredor — VDOT de Daniels sobre su curva de mejores esfuerzos, velocidad crítica CS/D′ dentro de su ventana de validez, y Riegel con exponente ${model.riegel?.exponent?.toFixed(3) || '1.060'} ajustado a sus propias marcas):

${computedBlock}

ANCLAJE: ${anchor ? `mejor esfuerzo de ${(anchor.distance_m / 1000).toFixed(1)} km en ${formatDuration(anchor.time_s)} (${anchor.date}), VDOT ${model.vdot}` : 'sin ancla'}.

CONTEXTO DEL CORREDOR (carga de entrenamiento, ACWR, zonas de FC, ritmos de referencia, marcas personales, distribución polarizada, wearable):

${richContext}

TAREA:
Devuelve las mismas ${model.items.length} distancias con:
1. "time_seconds": el tiempo calculado arriba AJUSTADO por contexto (forma actual CTL/TSB, volumen semanal, especificidad, calor). El ajuste no puede pasar del 8 % en ninguna dirección: si crees que hace falta más, dilo en "analysis" pero no lo apliques. Si el contexto no aporta nada, devuelve el tiempo tal cual.
2. "rationale" (máx 15 palabras): QUÉ ajuste has aplicado y por qué, p. ej. "sin tiradas largas: +6 % en maratón" o "sin cambios: volumen acorde".
3. "confidence": repite la confianza indicada arriba; está medida sobre los datos.
4. "analysis" (máx 60 palabras): estado de forma y, si falta volumen o especificidad para alguna distancia, dilo.${goalBlock}`;

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

            setCoach({
                forModel: model,
                items: applyCoachAdjustment(model.items, object.predictions),
                analysis: object.analysis,
                at: new Date(),
            });
            setLoading(false);

        } catch (err) {
            if (err?.name === 'AbortError') return; // desmontado o cancelado
            console.error("Error generando análisis:", err);

            let errorMessage = err.message || "Error desconocido";
            if (errorMessage.includes('404') || errorMessage.includes('401')) {
                errorMessage = "La API Key del servidor no es válida o no tiene permisos.";
            } else if (errorMessage.includes('429')) {
                errorMessage = "Has excedido la cuota (429) en Gemini y Groq. Prueba otro modelo o inténtalo más tarde.";
            } else {
                errorMessage = `Error generando el análisis: ${errorMessage}.`;
            }

            setError(errorMessage);
            setLoading(false);
        }
    };

    // Comparación con el objetivo guardado: solo aplica a la tarjeta de esa distancia.
    const goalForPrediction = (pred) => {
        if (!nextRace || nextRace.goalTimeMin == null) return null;
        if (nextRace.distance !== pred.key) return null;
        const goalSec = nextRace.goalTimeMin * 60;
        const delta = pred.timeSeconds - goalSec; // >0: forma actual más lenta que el objetivo
        return { goalSec, delta };
    };

    const maxPace = predictions.length ? Math.max(...predictions.map(p => p.paceSec)) : 0;
    const anchor = model.anchor;

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <AIToolHeader title="Predictor de Marcas" subtitle="Marcas potenciales actuales, calculadas sobre tus propios esfuerzos" />

            {/* Próxima carrera objetivo */}
            <NextRaceBanner />

            {predictions.length === 0 && (
                <Card className="p-8 ring-1 ring-slate-200 dark:ring-slate-800 shadow-sm bg-white dark:bg-slate-900">
                    <div className="text-center py-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        <span className="text-4xl block mb-3">🎯</span>
                        <Text className="text-slate-500 dark:text-slate-400 mb-2">
                            Aún no se puede predecir: {model.reason || 'faltan esfuerzos máximos en el histórico'}.
                        </Text>
                        <Text className="text-xs text-slate-400 dark:text-slate-500">
                            La predicción se ancla en tu mejor esfuerzo sostenido (de 3,5 min a 3,8 h) del último año.
                        </Text>
                    </div>
                </Card>
            )}

            {/* Results Grid */}
            {predictions.length > 0 && (
                <div className="space-y-6 fade-in">
                    {analysis && (
                        <Callout title="Análisis del Entrenador AI" icon={SparklesIcon} color="blue">
                            {analysis}
                        </Callout>
                    )}

                    {error && <Callout title="Error" color="rose">{error}</Callout>}

                    <Grid numItems={1} numItemsSm={2} numItemsLg={4} className="gap-4">
                        {predictions.map((pred) => {
                            const goal = goalForPrediction(pred);
                            return (
                                <Card
                                    key={pred.key}
                                    decoration="top"
                                    decorationColor={CONFIDENCE_COLOR[pred.confidence]}
                                    className="p-4 ring-1 ring-slate-200 dark:ring-slate-800 shadow-sm bg-white dark:bg-slate-900"
                                >
                                    <Flex justifyContent="between" alignItems="start">
                                        <Text className="font-semibold text-slate-700 dark:text-slate-200">{pred.label}</Text>
                                        <Badge color={CONFIDENCE_COLOR[pred.confidence]} size="xs">{pred.confidence}</Badge>
                                    </Flex>
                                    <Metric className="mt-2 text-slate-900 dark:text-slate-50">{formatDuration(pred.timeSeconds)}</Metric>
                                    <Text className="font-mono mt-1 text-slate-500 dark:text-slate-400">{formatPaceFromSecPerKm(pred.paceSec)} /km</Text>
                                    <Text className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
                                        {Object.keys(pred.models).map(k => MODEL_LABEL[k]).join(' · ')}
                                        {pred.baseTimeSeconds != null && pred.baseTimeSeconds !== pred.timeSeconds &&
                                            ` · ajustado desde ${formatDuration(pred.baseTimeSeconds)}`}
                                    </Text>
                                    {pred.rationale && (
                                        <Text className="text-xs text-slate-400 dark:text-slate-500 mt-2 leading-snug">{pred.rationale}</Text>
                                    )}
                                    {goal && (
                                        <div className={`mt-3 flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2 py-1.5 ${goal.delta <= 0
                                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400'}`}>
                                            <FlagIcon className="w-3.5 h-3.5 shrink-0" />
                                            {goal.delta <= 0
                                                ? `${formatDuration(Math.abs(goal.delta))} por debajo de tu objetivo (${formatDuration(goal.goalSec)})`
                                                : `A ${formatDuration(goal.delta)} de tu objetivo (${formatDuration(goal.goalSec)})`}
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
                                <div key={p.key} className="flex items-center gap-3">
                                    <span className="w-28 shrink-0 text-sm font-medium text-slate-600 dark:text-slate-300">{p.label}</span>
                                    <div className="flex-1 h-6 rounded-md bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                        <div
                                            className="h-full rounded-md bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
                                            style={{ width: `${(p.paceSec / maxPace) * 100}%` }}
                                        />
                                    </div>
                                    <span className="w-16 shrink-0 text-right font-mono text-sm text-slate-700 dark:text-slate-200">{formatPaceFromSecPerKm(p.paceSec)}</span>
                                </div>
                            ))}
                        </div>
                    </Card>

                    {/* Procedencia: de dónde sale cada número, para que sea auditable. */}
                    <Card className="p-4 ring-1 ring-slate-200 dark:ring-slate-800 shadow-sm bg-white dark:bg-slate-900">
                        <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">Cómo se ha calculado</Text>
                        <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1 leading-relaxed">
                            {anchor && (
                                <li>
                                    <span className="font-medium">Anclaje</span>: {(anchor.distance_m / 1000).toFixed(1)} km en {formatDuration(anchor.time_s)} ({anchor.date}) → VDOT {model.vdot}
                                </li>
                            )}
                            {model.cs && (
                                <li>
                                    <span className="font-medium">Velocidad crítica</span>: {formatPaceFromSecPerKm(model.cs.cs_pace_min_km * 60)}/km, D′ {Math.round(model.cs.d_prime_m)} m (R² {model.cs.r2.toFixed(3)}, n={model.cs.n}) — solo se usa hasta 30 min
                                </li>
                            )}
                            {model.riegel && (
                                <li>
                                    <span className="font-medium">Riegel</span>: exponente {model.riegel.exponent.toFixed(3)} {model.riegel.fitted ? `ajustado a tus marcas (n=${model.riegel.n})` : '(clásico: no hay marcas suficientes para individualizarlo)'}
                                </li>
                            )}
                        </ul>
                    </Card>

                    <Flex justifyContent="between" alignItems="center" className="flex-wrap gap-2">
                        <Text className="text-xs text-slate-400 dark:text-slate-500">
                            {generatedAt && `Análisis de las ${generatedAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · `}
                            Estimación en llano; no sustituye un test de campo.
                        </Text>
                        <Button variant="secondary" onClick={generateAIAnalysis} color="blue" disabled={loading} icon={SparklesIcon}>
                            {loading ? 'Analizando…' : analysis ? 'Recalcular análisis' : 'Ajustar y analizar con IA'}
                        </Button>
                    </Flex>
                </div>
            )}
        </div>
    );
};

export default RacePredictor;
