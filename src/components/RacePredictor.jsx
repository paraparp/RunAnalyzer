import React, { useState, useEffect } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { generateAIObject } from '../services/ai';
import {
    Card,
    Title,
    Text,
    Metric,
    Grid,
    Badge,
    Flex,
    Button,
    Callout,
    BarList,
    Icon
} from "@tremor/react";
import { CalculatorIcon, SparklesIcon } from "@heroicons/react/24/solid";
import ModelSelector, { DEFAULT_GEMINI_MODEL } from './ModelSelector';
import { buildPrompt } from '../lib/athleteContext';
import NextRaceBanner from './NextRaceBanner';
import { getNextTargetRace, daysUntil, formatMinutes, TARGET_RACES_EVENT } from '../lib/targetRaces';

const RacePredictor = ({ activities }) => {
    const [provider] = useState('gemini');

    const [selectedModel, setSelectedModel] = useState(
        () => cloudStorage.getItem('racepredictor_model') || DEFAULT_GEMINI_MODEL
    );
    useEffect(() => { try { cloudStorage.setItem('racepredictor_model', selectedModel); } catch { /* ignore */ } }, [selectedModel]);
    const [loading, setLoading] = useState(false);
    const [predictions, setPredictions] = useState(null);
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
            return athleteContext || getRecentActivitiesSummary();
        } catch {
            return getRecentActivitiesSummary();
        }
    };

    // Model reset is handled by ModelSelector component

    const getRecentActivitiesSummary = () => {
        if (!activities || activities.length === 0) return "No hay historial.";

        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const recent = activities
            .filter(a => new Date(a.start_date) >= threeMonthsAgo)
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date)) // Newest first
            .map(a => {
                const distKm = (a.distance / 1000).toFixed(2);
                const timeMin = (a.moving_time / 60).toFixed(1);
                const pace = (a.moving_time / 60 / (a.distance / 1000)).toFixed(2);
                const date = new Date(a.start_date).toLocaleDateString();
                const hr = a.average_heartrate ? `FC media: ${Math.round(a.average_heartrate)}` : 'Sin datos FC';
                return `- ${date}: ${distKm}km en ${timeMin}min (Ritmo ${pace} min/km). ${hr}. Desnivel: ${Math.round(a.total_elevation_gain)}m.`;
            });

        return recent.join('\n');
    };

    const generateAIPrediction = async () => {
        setLoading(true);
        setError('');
        setPredictions(null);

        const activityLog = getRecentActivitiesSummary();

        // If very little data
        if (activityLog.length < 50) {
            setError("No hay suficientes actividades en los últimos 3 meses para una predicción fiable.");
            setLoading(false);
            return;
        }

        const richContext = buildRaceContext();

        // Objetivo del corredor (si tiene una carrera futura guardada).
        const distLabels = { '5k': '5K', '10k': '10K', '21k': 'Media Maratón', '42k': 'Maratón' };
        let goalBlock = '';
        if (nextRace) {
            const d = daysUntil(nextRace.date);
            const goalTimeStr = nextRace.goalTimeMin != null ? formatMinutes(nextRace.goalTimeMin) : null;
            goalBlock = `\n\nOBJETIVO DEL CORREDOR: "${nextRace.name}" — ${distLabels[nextRace.distance] || nextRace.distance}` +
                (goalTimeStr ? ` con tiempo objetivo ${goalTimeStr}` : '') +
                (d != null ? `, dentro de ${d} días` : '') +
                `. En el análisis indica explícitamente si su forma actual lo pone en camino de lograr ese objetivo y, si no, qué le falta (ritmo, volumen, semanas de trabajo).`;
        }

        try {
            const prompt = `
                Actúa como un experto fisiólogo deportivo y entrenador de running que aplica ciencia validada (modelo PMC de Banister CTL/ATL/TSB, ratio agudo:crónico de Gabbett, umbral de lactato).
                Analiza el siguiente contexto del corredor (datos científicos: carga de entrenamiento, ACWR, zonas de FC, ritmos de referencia, marcas personales, distribución polarizada, wearable):

                ${richContext}

                TAREA:
                Predice de forma realista y precisa sus marcas potenciales ACTUALES (si compitiera hoy) para 5K, 10K, Media Maratón y Maratón.
                
                IMPORTANTE SOBRE DESNIVELES:
                Ten muy en cuenta el desnivel positivo (+m) de cada actividad. Muchos ritmos medios pueden parecer lentos debido a que se corrieron con desnivel.
                Calcula el esfuerzo equivalente en llano (GAP - Grade Adjusted Pace) para tus análisis.
                LAS PREDICCIONES DEBEN SER PARA CRONOS EN UNA CARRERA TOTALMENTE LLANA.

                Usa fórmulas como Riegel pero ajústalas según la fatiga, consistencia, volumen semanal aparente y datos de frecuencia cardíaca si los hay.
                Diferencia entre "Mejor Marca Teórica" y "Predicción Realista Actual". Danos la Realista en llano.${goalBlock}
            `;

            const object = await generateAIObject({
                provider,
                model: selectedModel,
                prompt,
                temperature: 0.5, // Slightly lower temp for more consistent predictions
                schema: 'racePrediction',
            });

            setPredictions(object.predictions);
            setAnalysis(object.analysis);
            setLoading(false);

        } catch (err) {
            console.error("Error generando predicción:", err);

            let errorMessage = err.message || "Error desconocido";
            if (errorMessage.includes('404') || errorMessage.includes('401')) {
                errorMessage = "La API Key del servidor no es válida o no tiene permisos.";
            } else if (errorMessage.includes('429')) {
                errorMessage = "Has excedido la cuota (429). Prueba otro modelo o Groq.";
            } else {
                errorMessage = `Error generando predicción: ${errorMessage}.`;
            }

            setError(errorMessage);
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <Card className="p-6 ring-1 ring-slate-200 shadow-sm bg-white">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-xl">
                            <Icon icon={SparklesIcon} size="lg" color="blue" variant="light" />
                        </div>
                        <div>
                            <Title className="text-xl font-bold text-slate-900">Predictor Biométrico AI</Title>
                            <Text className="text-slate-500 text-sm">Predice tus marcas potenciales en carrera</Text>
                        </div>
                    </div>
                    <ModelSelector
                        selectedModel={selectedModel}
                        setSelectedModel={setSelectedModel}
                        disabled={loading}
                        showLabel={false}
                    />
                </div>
            </Card>

            {/* Próxima carrera objetivo */}
            <NextRaceBanner />

            {/* Generate Button */}
            {!predictions && !loading && (
                <Card className="p-8 ring-1 ring-slate-200 shadow-sm bg-white">
                    <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
                        <span className="text-4xl block mb-3">🎯</span>
                        <Text className="text-slate-500 mb-6">Analiza tus últimas carreras con IA para predecir marcas en llano.</Text>
                        <Button size="xl" onClick={generateAIPrediction} icon={CalculatorIcon} disabled={loading} color="blue">
                            Generar Predicción Inteligente
                        </Button>
                        {error && <Callout title="Error" color="rose" className="mt-6">{error}</Callout>}
                    </div>
                </Card>
            )}

            {loading && (
                <Card className="p-8 ring-1 ring-slate-200 shadow-sm bg-white">
                    <div className="text-center py-12">
                        <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                        <Text className="text-slate-600 font-medium">Analizando biomecánica y fatiga...</Text>
                    </div>
                </Card>
            )}

            {/* Results Grid */}
            {predictions && (
                <div className="space-y-6 fade-in">
                    {analysis && (
                        <Card className="p-6 ring-1 ring-slate-200 shadow-sm bg-white">
                            <Callout title="Análisis del Entrenador AI" icon={SparklesIcon} color="blue">
                                {analysis}
                            </Callout>
                        </Card>
                    )}

                    <Grid numItems={1} numItemsSm={2} className="gap-4">
                        {predictions.map((pred, idx) => (
                            <Card key={idx} decoration="top" decorationColor={pred.confidence === 'Alta' ? 'emerald' : 'amber'} className="p-4 ring-1 ring-slate-200 shadow-sm">
                                <Flex justifyContent="between" alignItems="start">
                                    <Text className="font-semibold text-slate-700">{pred.label}</Text>
                                    <Badge color={pred.confidence === 'Alta' ? 'emerald' : 'amber'} size="xs">{pred.confidence}</Badge>
                                </Flex>
                                <Metric className="mt-2 text-slate-900">{pred.time}</Metric>
                                <Text className="font-mono mt-1 text-slate-500">{pred.pace} /km</Text>
                            </Card>
                        ))}
                    </Grid>

                    <Card className="p-6 ring-1 ring-slate-200 shadow-sm bg-white">
                        <Title className="text-lg font-semibold text-slate-900">Comparativa de Ritmos (min/km)</Title>
                        <BarList
                            data={predictions.map(p => {
                                const [min, sec] = p.pace.split(':').map(Number);
                                return {
                                    name: p.label,
                                    value: min * 60 + (sec || 0),
                                    href: '#'
                                };
                            })}
                            valueFormatter={(val) => `${Math.floor(val / 60)}:${(val % 60).toString().padStart(2, '0')}`}
                            color="blue"
                            className="mt-4"
                        />
                    </Card>

                    <Button variant="secondary" onClick={generateAIPrediction} className="w-full" color="blue">Recalcular Predicción</Button>
                </div>
            )}
        </div>
    );
};

export default RacePredictor;
