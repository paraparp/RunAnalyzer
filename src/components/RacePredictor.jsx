import React, { useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
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
import ModelSelector from './ModelSelector';

const RacePredictor = ({ activities }) => {
    const [provider, setProvider] = useState('groq');

    // API keys from environment variables
    const apiKeys = {
        gemini: import.meta.env.VITE_GEMINI_API_KEY || '',
        groq: import.meta.env.VITE_GROQ_API_KEY || ''
    };

    const [selectedModel, setSelectedModel] = useState('llama-3.1-8b-instant');
    const [loading, setLoading] = useState(false);
    const [predictions, setPredictions] = useState(null);
    const [error, setError] = useState('');
    const [analysis, setAnalysis] = useState('');

    // Model reset is handled by ModelSelector component

    const currentApiKey = apiKeys[provider];


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

    const checkAvailableModels = async (key) => {
        if (provider === 'groq') return "Groq Models: llama-3.1-8b, llama-3.3-70b...";
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            const data = await response.json();
            if (data.error) return `Error verificando modelos: ${data.error.message}`;
            if (data.models) return `Modelos disponibles: ${data.models.map(m => m.name.replace('models/', '')).join(', ')}`;
            return 'No se pudieron listar los modelos.';
        } catch (e) {
            return `Error de conexión: ${e.message}`;
        }
    };

    const generateAIPrediction = async () => {
        const activeKey = apiKeys[provider];

        if (!activeKey) {
            setError(`Por favor, introduce una API Key de ${provider === 'groq' ? 'Groq' : 'Google Gemini'}.`);
            return;
        }

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

        try {
            const prompt = `
                Actúa como un experto fisiólogo deportivo y entrenador de running.
                Analiza el siguiente historial de entrenamiento de los últimos 3 meses de un corredor:
                
                ${activityLog}

                TAREA:
                Predice de forma realista y precisa sus marcas potenciales ACTUALES (si compitiera hoy) para 5K, 10K, Media Maratón y Maratón.
                
                IMPORTANTE SOBRE DESNIVELES:
                Ten muy en cuenta el desnivel positivo (+m) de cada actividad. Muchos ritmos medios pueden parecer lentos debido a que se corrieron con desnivel.
                Calcula el esfuerzo equivalente en llano (GAP - Grade Adjusted Pace) para tus análisis.
                LAS PREDICCIONES DEBEN SER PARA CRONOS EN UNA CARRERA TOTALMENTE LLANA.

                Usa fórmulas como Riegel pero ajústalas según la fatiga, consistencia, volumen semanal aparente y datos de frecuencia cardíaca si los hay.
                Diferencia entre "Mejor Marca Teórica" y "Predicción Realista Actual". Danos la Realista en llano.

                FORMATO DE RESPUESTA JSON (SÓLO JSON):
                {
                    "analysis": "Breve párrafo (max 30 palabras) sobre su estado de forma actual.",
                    "predictions": [
                        { "label": "5K", "time": "MM:SS", "pace": "M:SS", "confidence": "Alta/Media/Baja" },
                        { "label": "10K", "time": "MM:SS", "pace": "M:SS", "confidence": "Alta/Media/Baja" },
                        { "label": "Media Maratón", "time": "H:MM:SS", "pace": "M:SS", "confidence": "Alta/Media/Baja" },
                        { "label": "Maratón", "time": "H:MM:SS", "pace": "M:SS", "confidence": "Alta/Media/Baja" }
                    ]
                }
            `;

            let jsonString = '';

            // --- GROQ EXECUTION ---
            if (provider === 'groq') {
                const groq = new Groq({ apiKey: activeKey, dangerouslyAllowBrowser: true });
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: "Eres un API que devuelve solo JSON." },
                        { role: "user", content: prompt }
                    ],
                    model: selectedModel,
                    temperature: 0.7,
                    max_tokens: 1024,
                    response_format: { type: "json_object" }
                });
                jsonString = completion.choices[0]?.message?.content || '';
            }
            // --- GEMINI EXECUTION ---
            else {
                const modelsToTry = selectedModel ? [selectedModel] : [
                    "gemini-2.5-flash-lite",
                    "gemini-2.5-flash",
                    "gemini-2.0-flash",
                    "gemini-2.0-flash-lite",
                    "gemini-1.5-flash"
                ];
                let lastError = null;
                let success = false;

                for (const modelName of modelsToTry) {
                    try {
                        console.log(`Intentando con modelo: ${modelName}`);
                        const genAI = new GoogleGenerativeAI(activeKey);
                        const model = genAI.getGenerativeModel({ model: modelName });

                        const result = await model.generateContent(prompt);
                        const response = await result.response;
                        jsonString = response.text();
                        success = true;
                        break;
                    } catch (err) {
                        console.warn(`Fallo con modelo ${modelName}:`, err);
                        lastError = err;
                    }
                }

                if (!success) throw lastError || new Error("Todos los modelos de Gemini fallaron.");
            }

            // --- COMMON PARSING ---
            const cleanJson = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(cleanJson);

            setPredictions(data.predictions);
            setAnalysis(data.analysis);
            setLoading(false);

        } catch (err) {
            console.error("Error generando predicción:", err);

            let debugInfo = '';
            if (provider === 'gemini') {
                debugInfo = await checkAvailableModels(activeKey);
            }

            let errorMessage = err.message || "Error desconocido";
            if (errorMessage.includes('404')) {
                errorMessage = "La API Key no es válida o no tiene permisos. " + debugInfo;
            } else if (errorMessage.includes('429')) {
                errorMessage = "Has excedido la cuota (429). Prueba otro modelo o Groq.";
            } else {
                errorMessage = `Error generando predicción: ${errorMessage}. ` + debugInfo;
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
                        <div className="p-2 bg-indigo-100 rounded-xl">
                            <Icon icon={SparklesIcon} size="lg" color="indigo" variant="light" />
                        </div>
                        <div>
                            <Title className="text-xl font-bold text-slate-900">Predictor Biométrico AI</Title>
                            <Text className="text-slate-500 text-sm">Predice tus marcas potenciales en carrera</Text>
                        </div>
                    </div>
                    <ModelSelector
                        provider={provider}
                        setProvider={setProvider}
                        selectedModel={selectedModel}
                        setSelectedModel={setSelectedModel}
                        showLabel={false}
                    />
                </div>
            </Card>

            {/* Generate Button */}
            {!predictions && !loading && (
                <Card className="p-8 ring-1 ring-slate-200 shadow-sm bg-white">
                    <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
                        <span className="text-4xl block mb-3">🎯</span>
                        <Text className="text-slate-500 mb-6">Analiza tus últimas carreras con IA para predecir marcas en llano.</Text>
                        <Button size="xl" onClick={generateAIPrediction} icon={CalculatorIcon} disabled={!currentApiKey} color="indigo">
                            Generar Predicción Inteligente
                        </Button>
                        {error && <Callout title="Error" color="rose" className="mt-6">{error}</Callout>}
                    </div>
                </Card>
            )}

            {loading && (
                <Card className="p-8 ring-1 ring-slate-200 shadow-sm bg-white">
                    <div className="text-center py-12">
                        <div className="animate-spin h-10 w-10 border-4 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                        <Text className="text-slate-600 font-medium">Analizando biomecánica y fatiga...</Text>
                    </div>
                </Card>
            )}

            {/* Results Grid */}
            {predictions && (
                <div className="space-y-6 fade-in">
                    {analysis && (
                        <Card className="p-6 ring-1 ring-slate-200 shadow-sm bg-white">
                            <Callout title="Análisis del Entrenador AI" icon={SparklesIcon} color="indigo">
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
                            color="indigo"
                            className="mt-4"
                        />
                    </Card>

                    <Button variant="secondary" onClick={generateAIPrediction} className="w-full" color="indigo">Recalcular Predicción</Button>
                </div>
            )}
        </div>
    );
};

export default RacePredictor;
