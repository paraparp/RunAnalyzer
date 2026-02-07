import React, { useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import { Card, Grid, Title, Text, Metric, Button, NumberInput, Select, SelectItem, Badge, Callout, Divider, CategoryBar, DonutChart, Legend } from "@tremor/react";
import { PlayCircleIcon, FireIcon, HandRaisedIcon, FlagIcon, ClockIcon } from "@heroicons/react/24/solid";
import { BoltIcon } from "@heroicons/react/24/outline";
import ModelSelector from './ModelSelector';

// Define the schema for the training plan
const PlanSchema = z.object({
    analysis: z.string().describe("Análisis breve (max 60 palabras) del estado del corredor."),
    weekly_summary: z.string().describe("Enfoque de esta semana según periodización."),
    stats: z.object({
        total_dist_km: z.number().describe("Distancia total estimada en km."),
        total_time_min: z.number().describe("Tiempo total estimado en minutos."),
        distribution: z.object({
            easy: z.number().describe("Porcentaje Zona 1-2 aeróbico (>75)."),
            moderate: z.number().describe("Porcentaje Zona 3 umbral/tempo (~10-15)."),
            hard: z.number().describe("Porcentaje Zona 4-5 VO2max/velocidad (~5-10)."),
        }),
    }),
    schedule: z.array(z.object({
        day: z.string().describe("Nombre del día (ej: 'Lunes')."),
        type: z.string().describe("Categoría de la sesión."),
        daily_stats: z.object({
            dist: z.string().describe("Distancia (ej: '12 km')."),
            time: z.string().describe("Tiempo estimado (ej: '65 min')."),
        }).optional(),
        summary: z.string().describe("Objetivo de la sesión y zonas de trabajo."),
        structured_workout: z.array(z.object({
            phase: z.string().describe("Fase del entrenamiento (Calentamiento, Bloque Principal, etc)."),
            duration_min: z.number().describe("Duración en minutos."),
            intensity: z.number().min(1).max(5).describe("Intensidad (1-5)."),
            description: z.string().describe("Descripción detallada del ejercicio."),
        })).optional().describe("Detalle de la estructura del entrenamiento."),
    })),
});

const TrainingPlanner = ({ activities }) => {
    const [goalDist, setGoalDist] = useState('21k');

    // Calculate suggested time based on recent runs (slightly faster than current pace)
    const calculateSuggestedTime = () => {
        if (!activities || activities.length === 0) return '';

        const recentRuns = activities
            .filter(a => (a.distance / 1000) >= 3)
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
            .slice(0, 5);

        if (recentRuns.length === 0) return '';

        const avgPaceMinKm = recentRuns.reduce((acc, run) => {
            return acc + ((run.moving_time / 60) / (run.distance / 1000));
        }, 0) / recentRuns.length;

        // Suggested time: 5% faster than current average for 21k
        const targetPaceMinKm = avgPaceMinKm * 0.90;
        const suggestedTime = Math.round(targetPaceMinKm * 21);
        return suggestedTime.toString();
    };

    const [goalTime, setGoalTime] = useState(calculateSuggestedTime);
    const [targetDate, setTargetDate] = useState('');
    const [weeks, setWeeks] = useState(4);
    const [selectedDays, setSelectedDays] = useState(['Mi', 'Sa']); // Miércoles y Sábado por defecto

    // Provider state: 'gemini', 'groq' or 'anthropic'
    const [provider, setProvider] = useState('groq');

    // API keys from environment variables
    const apiKeys = {
        gemini: import.meta.env.VITE_GEMINI_API_KEY || '',
        groq: import.meta.env.VITE_GROQ_API_KEY || '',
        anthropic: import.meta.env.VITE_ANTHROPIC_API_KEY || ''
    };

    const [selectedModel, setSelectedModel] = useState('llama-3.1-8b-instant');
    const [loading, setLoading] = useState(false);
    const [plan, setPlan] = useState(null);
    const [error, setError] = useState('');

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
                const hr = a.average_heartrate ? `FC media: ${Math.round(a.average_heartrate)} ppm` : 'Sin datos FC';
                const elev = `Desnivel: ${Math.round(a.total_elevation_gain)}m`;
                return `- ${date}: ${distKm}km en ${timeMin}min (Ritmo ${pace} min/km). ${hr}. ${elev}.`;
            });

        return recent.join('\n');
    };

    // NEW: Calculate goal feasibility analysis with GAP adjustment for elevation
    const getGoalFeasibility = () => {
        if (!activities || activities.length === 0 || !goalDist || !goalTime) return null;

        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        // Filter recent runs (min 3km to avoid warm-ups)
        const recentRuns = activities
            .filter(a => {
                const date = new Date(a.start_date);
                return date >= threeMonthsAgo && (a.distance / 1000) >= 3;
            })
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

        if (recentRuns.length === 0) return null;

        // Calculate GAP (Grade Adjusted Pace) for each run
        // Formula: Subtract ~8 seconds per km for every 10m elevation gain per km
        const runsWithGAP = recentRuns.map(run => {
            const distKm = run.distance / 1000;
            const elevationGain = run.total_elevation_gain || 0;
            const elevPerKm = elevationGain / distKm;

            // Raw pace in min/km
            const rawPace = (run.moving_time / 60) / distKm;

            // GAP adjustment: -8 seconds per km for every 10m/km of elevation
            // This estimates equivalent flat pace (corrected for uphill effort)
            const gapAdjustmentSeconds = (elevPerKm / 10) * 8; // in seconds
            const gapAdjustment = gapAdjustmentSeconds / 60; // convert to minutes
            const adjustedPace = Math.max(rawPace - gapAdjustment, rawPace * 0.80); // Max 20% faster to avoid unrealistic adjustments

            return {
                ...run,
                distKm,
                elevPerKm,
                rawPace,
                adjustedPace,
                isFlat: elevPerKm < 8, // Less than 8m/km is considered relatively flat
                gapAdjustmentSeconds: Math.round(gapAdjustmentSeconds)
            };
        });

        // Prioritize flat runs for more accurate comparison (flat runs are more representative of race pace)
        const flatRuns = runsWithGAP.filter(r => r.isFlat);
        const runsToUse = flatRuns.length >= 3 ? flatRuns : runsWithGAP;

        // Last run
        const lastRun = runsWithGAP[0];

        // Average adjusted pace of last 5 runs (or all if less)
        const runsToAverage = runsToUse.slice(0, Math.min(5, runsToUse.length));
        const avgPace = runsToAverage.reduce((acc, run) => {
            return acc + run.adjustedPace;
        }, 0) / runsToAverage.length;

        // Calculate target pace
        const distances = {
            '5k': 5,
            '10k': 10,
            '21k': 21.097,
            '42k': 42.195
        };
        const targetDistanceKm = distances[goalDist];
        const targetPaceMinKm = goalTime / targetDistanceKm;

        // Calculate gap
        const paceGap = avgPace - targetPaceMinKm; // positive means too slow, negative means faster
        const gapPercent = ((paceGap / targetPaceMinKm) * 100).toFixed(1);

        // Determine feasibility level
        let feasibility = 'realistic';
        let recommendation = '';
        let color = '#3b82f6';

        if (paceGap <= -0.5) {
            feasibility = 'easy';
            recommendation = '¡Excelente! Tu forma actual supera el objetivo. Podrías plantearte un objetivo más ambicioso.';
            color = '#10b981';
        } else if (paceGap <= 0.1) {
            feasibility = 'realistic';
            recommendation = 'Objetivo muy realista. Tu ritmo actual está muy cerca. Con entrenamiento estructurado lo conseguirás.';
            color = '#3b82f6';
        } else if (paceGap <= 0.3) {
            feasibility = 'challenging';
            recommendation = 'Objetivo desafiante pero alcanzable. Necesitarás trabajo específico de ritmo y consistencia.';
            color = '#f59e0b';
        } else {
            feasibility = 'extreme';
            recommendation = '⚠️ Objetivo muy ambicioso. Considera ampliar el plazo o ajustar el objetivo para evitar lesiones.';
            color = '#ef4444';
        }

        return {
            currentPace: avgPace,
            lastRunPace: lastRun.adjustedPace,
            lastRunRawPace: lastRun.rawPace,
            targetPace: targetPaceMinKm,
            gap: paceGap,
            gapPercent: parseFloat(gapPercent),
            feasibility,
            recommendation,
            color,
            lastRunDate: new Date(lastRun.start_date).toLocaleDateString(),
            lastRunDist: lastRun.distKm.toFixed(2),
            lastRunElev: Math.round(lastRun.total_elevation_gain || 0),
            lastRunElevPerKm: lastRun.elevPerKm.toFixed(1),
            lastRunGapAdjustment: lastRun.gapAdjustmentSeconds,
            recentRunsCount: runsToAverage.length,
            usedFlatRuns: flatRuns.length >= 3,
            gapAdjusted: Math.abs(lastRun.rawPace - lastRun.adjustedPace) > 0.05 // Significant adjustment made
        };
    };

    const checkAvailableModels = async (key) => {
        if (provider === 'groq') return "Groq Models: llama-3.1-8b, llama-3.3-70b...";
        if (provider === 'anthropic') return "Claude Models: 3.5 Sonnet, 3.5 Haiku...";
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

    const generateAIPlan = async (e) => {
        e.preventDefault();

        const activeKey = apiKeys[provider];

        if (!activeKey) {
            setError(`Por favor, introduce una API Key de ${provider.charAt(0).toUpperCase() + provider.slice(1)}.`);
            return;
        }

        setLoading(true);
        setError('');
        setPlan(null);

        try {
            const activityLog = getRecentActivitiesSummary();
            const daysCount = selectedDays.length;
            const daysStr = selectedDays.join(', ');

            // Initialize Provider using AI SDK
            let model;
            if (provider === 'groq') {
                const groq = createOpenAI({
                    baseURL: 'https://api.groq.com/openai/v1',
                    apiKey: activeKey,
                });
                model = groq(selectedModel);
            } else if (provider === 'anthropic') {
                const anthropic = createAnthropic({ apiKey: activeKey });
                model = anthropic(selectedModel);
            } else {
                const google = createGoogleGenerativeAI({
                    apiKey: activeKey,
                });
                // Ensure model name is correct for Google provider
                // Note: The selectedModel state might have prefixes or be raw, but @ai-sdk/google handles 'gemini-1.5-flash' etc.
                model = google(selectedModel);
            }

            const prompt = `
            Actúa como un fisiólogo deportivo de élite y entrenador de running profesional.
            
            HISTORIAL DE ENTRENAMIENTO RECIENTE (Últimos 3 meses):
            ${activityLog}

            OBJETIVO DEL CORREDOR:
            - Meta: Correr ${goalDist === '42k' ? 'Maratón (42.195km)' : goalDist === '21k' ? 'Media Maratón (21.097km)' : goalDist === '10k' ? '10 Kilómetros' : '5 Kilómetros'} en ${goalTime} minutos.
            - Fecha actual: ${new Date().toLocaleDateString()}.
            - Disponibilidad semanal: ${daysCount} días de entrenamiento (${daysStr}).
            
            METODOLOGÍA Y PRINCIPIOS CIENTÍFICOS A APLICAR:
            1. **PRINCIPIO 80/20**: 80% del volumen total en Zona 2 (aeróbico).
            2. **ENTRENAMIENTO POLARIZADO**: Sesiones diferenciadas (Muy Fácil vs Muy Intenso).
            3. **PERIODIZACIÓN INTELIGENTE**: Basada en VDOT y capacidad actual.
            
            GENERA EXACTAMENTE ${daysCount} SESIONES para los días ${daysStr}. Los días NO seleccionados NO deben aparecer.
            CRITICAL: Respeta distribución 80/20. No sobreentrenes. Prioriza calidad sobre cantidad.
            `;

            const { object } = await generateObject({
                model: model,
                schema: PlanSchema,
                prompt: prompt,
                temperature: 0.7,
            });

            setPlan(object);
            setLoading(false);

        } catch (err) {
            console.error("Error generando plan:", err);

            // Check what's actually available to give a helpful error
            let debugInfo = '';
            // Only check manually for Google if we suspect key issues, though AI SDK handles errors well.
            if (provider === 'gemini') {
                debugInfo = await checkAvailableModels(activeKey);
            }

            let errorMessage = err.message || "Error desconocido";
            if (errorMessage.includes('404')) {
                errorMessage = "La API Key no es válida o no tiene permisos. " + debugInfo;
            } else if (errorMessage.includes('429')) {
                errorMessage = "Has excedido la cuota (429). Prueba otro modelo o Groq."
            } else {
                errorMessage = `Error generando plan: ${errorMessage}. ` + debugInfo;
            }

            setError(errorMessage);
            setLoading(false);
        }
    };

    const exportToPDF = (plan) => {
        const doc = new jsPDF();

        // Colors
        const primaryColor = [79, 70, 229]; // Indigo 600
        const secondaryColor = [100, 116, 139]; // Slate 500

        // Header
        doc.setFillColor(...primaryColor);
        doc.rect(0, 0, 210, 20, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('Plan de Entrenamiento - Entrenador AI', 15, 13);

        // Weekly Summary
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Estrategia Semanal', 15, 30);

        // Ensure valid string before splitTextToSize to prevent errors
        const summaryText = typeof plan.weekly_summary === 'string' ? plan.weekly_summary : 'Resumen no disponible.';
        const analysisText = typeof plan.analysis === 'string' ? plan.analysis : 'Análisis no disponible.';

        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...secondaryColor);
        const splitSummary = doc.splitTextToSize(summaryText, 180);
        doc.text(splitSummary, 15, 38);

        let yPos = 38 + (splitSummary.length * 5) + 5;

        // Analysis
        doc.setFontSize(10);
        doc.setFont('helvetica', 'italic');
        const splitAnalysis = doc.splitTextToSize(analysisText, 180);
        doc.text(splitAnalysis, 15, yPos);

        yPos += (splitAnalysis.length * 5) + 10;

        // Stats
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Resumen de Volumen', 15, yPos);
        yPos += 7;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Distancia Total: ${plan.stats.total_dist_km} km`, 15, yPos);
        doc.text(`Tiempo Total: ${Math.floor(plan.stats.total_time_min / 60)}h ${plan.stats.total_time_min % 60}m`, 80, yPos);
        yPos += 10;

        // Schedule Table
        const tableData = plan.schedule.map(day => {
            let details = day.summary;
            if (day.structured_workout && day.structured_workout.length > 0) {
                const steps = day.structured_workout.map(s => `• ${s.phase} (${s.duration_min}'): ${s.description}`).join('\n');
                details += '\n\n' + steps;
            }
            return [
                day.day,
                day.type,
                day.daily_stats ? `${day.daily_stats.dist}\n${day.daily_stats.time}` : '-',
                details
            ];
        });

        autoTable(doc, {
            startY: yPos,
            head: [['Día', 'Tipo', 'Volumen', 'Detalle de la Sesión']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: primaryColor, textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 20, fontStyle: 'bold' },
                1: { cellWidth: 25, fontStyle: 'bold' },
                2: { cellWidth: 25 },
                3: { cellWidth: 'auto' }
            },
            alternateRowStyles: { fillColor: [248, 250, 252] }
        });

        doc.save('plan-entrenamiento.pdf');
    };

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <Card className="p-6 ring-1 ring-slate-200 shadow-sm bg-white">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 rounded-xl">
                            <span className="text-2xl">🤖</span>
                        </div>
                        <div>
                            <Title className="text-xl font-bold text-slate-900">Entrenador AI</Title>
                            <Text className="text-slate-500 text-sm">Genera planes de entrenamiento personalizados</Text>
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

            <Card className="mb-8 p-6 ring-1 ring-slate-200 shadow-sm bg-white dark:bg-slate-900 dark:ring-slate-800">
                <form onSubmit={generateAIPlan} className="space-y-6">
                    <Grid numItems={1} numItemsSm={3} className="gap-6">
                        <div>
                            <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">Objetivo</Text>
                            <Select value={goalDist} onValueChange={setGoalDist} enableClear={false}>
                                <SelectItem value="5k">5K</SelectItem>
                                <SelectItem value="10k">10K</SelectItem>
                                <SelectItem value="21k">Media Maratón</SelectItem>
                                <SelectItem value="42k">Maratón</SelectItem>
                            </Select>
                        </div>
                        <div>
                            <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">Tiempo Objetivo (min)</Text>
                            <NumberInput value={goalTime} onValueChange={setGoalTime} placeholder="ej. 45" min={15} />
                        </div>
                        <div>
                            <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">Duración del Plan</Text>
                            <Select value={String(weeks)} onValueChange={(v) => setWeeks(Number(v))} enableClear={false}>
                                <SelectItem value="3">3 Semanas</SelectItem>
                                <SelectItem value="4">4 Semanas</SelectItem>
                                <SelectItem value="6">6 Semanas</SelectItem>
                                <SelectItem value="8">8 Semanas</SelectItem>
                                <SelectItem value="12">12 Semanas</SelectItem>
                                <SelectItem value="16">16 Semanas</SelectItem>
                            </Select>
                        </div>
                    </Grid>

                    <div>
                        <Text className="mb-2 font-bold text-xs uppercase text-slate-500">Días de Entrenamiento</Text>
                        <div className="flex flex-wrap gap-2">
                            {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'].map(day => (
                                <Badge
                                    key={day}
                                    size="lg"
                                    className={`cursor-pointer select-none px-4 py-1.5 transition-all ${selectedDays.includes(day) ? 'ring-2 ring-indigo-500 ring-offset-1' : 'opacity-60 hover:opacity-100'}`}
                                    color={selectedDays.includes(day) ? 'indigo' : 'slate'}
                                    onClick={() => {
                                        setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
                                    }}
                                >
                                    {day}
                                </Badge>
                            ))}
                        </div>
                    </div>

                    <div className="pt-2">
                        <Button size="xl" className="w-full font-bold" loading={loading} type="submit" variant="primary" color="indigo">
                            {loading ? 'Analizando Historial y Diseñando Plan...' : 'Generar Plan Estratégico'}
                        </Button>
                    </div>
                </form>
                {error && <Callout title="Error generando plan" color="rose" className="mt-4">{error}</Callout>}
            </Card>

            {plan && (
                <div className="space-y-6 fade-in">
                    <Card decoration="left" decorationColor="indigo" className="bg-slate-50 border-indigo-100 dark:bg-slate-900 dark:border-slate-800">
                        <div className="flex flex-col md:flex-row gap-6">
                            <div className="flex-1">
                                <Text className="uppercase text-xs font-bold text-slate-500 tracking-wider mb-2">Estrategia Semanal</Text>
                                <Title className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-4">{plan.weekly_summary}</Title>
                                <Text className="leading-relaxed text-slate-600 dark:text-slate-400 italic border-l-4 border-indigo-200 pl-4 py-1">{plan.analysis}</Text>
                            </div>
                            {plan.stats && (
                                <div className="w-full md:w-64 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700">
                                    <div className="space-y-4">
                                        <div>
                                            <Text className="text-xs uppercase text-slate-400">Volumen</Text>
                                            <Metric>{plan.stats.total_dist_km} km</Metric>
                                        </div>
                                        <Divider />
                                        <div>
                                            <Text className="text-xs uppercase text-slate-400">Tiempo</Text>
                                            <Metric>{Math.floor(plan.stats.total_time_min / 60)}h {plan.stats.total_time_min % 60}m</Metric>
                                        </div>
                                        <Divider />
                                        <Button size="xs" variant="secondary" color="slate" onClick={() => exportToPDF(plan)} className="w-full">
                                            📄 Exportar PDF
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                            <Text className="text-xs font-bold uppercase text-slate-400 mb-3">Distribución de Intensidad (Modelo 80/20)</Text>
                            <div className="flex flex-col sm:flex-row items-center gap-6">
                                <DonutChart
                                    data={[
                                        { name: 'Suave (Z1-2)', value: plan.stats.distribution.easy },
                                        { name: 'Umbral (Z3)', value: plan.stats.distribution.moderate },
                                        { name: 'Intenso (Z4-5)', value: plan.stats.distribution.hard },
                                    ]}
                                    category="value"
                                    index="name"
                                    colors={["emerald", "amber", "rose"]}
                                    variant="pie"
                                    className="w-32 h-32"
                                    showAnimation={true}
                                />
                                <Legend
                                    categories={["Suave (Z1-2)", "Umbral (Z3)", "Intenso (Z4-5)"]}
                                    colors={["emerald", "amber", "rose"]}
                                    className="max-w-xs"
                                />
                            </div>
                        </div>
                    </Card>

                    <div className="space-y-4">
                        <Title>Calendario de Sesiones</Title>
                        {plan.schedule.map((day, idx) => {
                            const typeLower = day.type.toLowerCase();
                            let decorationColor = "blue";
                            if (typeLower.includes('series') || typeLower.includes('velocidad')) decorationColor = "amber";
                            else if (typeLower.includes('recup') || typeLower.includes('suave')) decorationColor = "emerald";
                            else if (typeLower.includes('descanso')) decorationColor = "slate";

                            return (
                                <Card key={idx} decoration="left" decorationColor={decorationColor} className={`p-0 overflow-hidden ring-1 ring-slate-200 shadow-sm ${typeLower.includes('descanso') ? 'opacity-75 bg-slate-50 dark:bg-slate-900' : 'bg-white dark:bg-slate-800'}`}>
                                    <div className="p-5">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <Title className="text-lg">{day.day}</Title>
                                                <Badge size="xs" color={decorationColor} className="mt-1">{day.type}</Badge>
                                            </div>
                                            {!typeLower.includes('descanso') && day.daily_stats && (
                                                <div className="text-right">
                                                    <Metric className="text-xl">{day.daily_stats.dist}</Metric>
                                                    <Text className="text-xs">{day.daily_stats.time}</Text>
                                                </div>
                                            )}
                                        </div>

                                        <Text className="text-slate-600 dark:text-slate-400 mb-4">{day.summary}</Text>

                                        {day.structured_workout && day.structured_workout.length > 0 && (() => {
                                            const getTremorColor = (intensity) => {
                                                if (intensity >= 5) return 'rose';
                                                if (intensity === 4) return 'orange';
                                                if (intensity === 3) return 'amber';
                                                if (intensity === 2) return 'emerald';
                                                return 'blue';
                                            };

                                            const categoryBarValues = day.structured_workout.map(s => s.duration_min);
                                            const categoryBarColors = day.structured_workout.map(s => getTremorColor(s.intensity));

                                            return (
                                                <div className="mt-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl p-5 border border-slate-100 dark:border-slate-800">
                                                    <Text className="text-xs font-bold uppercase text-slate-400 mb-4 tracking-wider">Estructura del Entrenamiento</Text>

                                                    {/* Visual Timeline Bar */}
                                                    <div className="mb-8 px-1">
                                                        <CategoryBar
                                                            values={categoryBarValues}
                                                            colors={categoryBarColors}
                                                            className="h-2.5 rounded-full ring-1 ring-slate-900/5 dark:ring-white/10"
                                                            showLabels={false}
                                                        />
                                                    </div>

                                                    {/* Modern Vertical Timeline Steps */}
                                                    <div className="relative space-y-0 pl-2">
                                                        {/* Vertical connector line */}
                                                        <div className="absolute left-[19px] top-4 bottom-10 w-0.5 bg-gradient-to-b from-slate-200 via-slate-200 to-transparent dark:from-slate-700 dark:via-slate-700"></div>

                                                        {day.structured_workout.map((step, sIdx) => {
                                                            // Icons & Styles based on intensity/phase
                                                            let StepIcon = PlayCircleIcon;
                                                            let iconColor = "text-emerald-500 bg-emerald-50 ring-emerald-100 dark:bg-emerald-900/30 dark:ring-emerald-900/50";
                                                            let cardBorder = "border-l-4 border-l-emerald-400 dark:border-l-emerald-500";

                                                            if (step.intensity >= 4) {
                                                                StepIcon = FireIcon;
                                                                iconColor = "text-rose-500 bg-rose-50 ring-rose-100 dark:bg-rose-900/30 dark:ring-rose-900/50";
                                                                cardBorder = "border-l-4 border-l-rose-500";
                                                            } else if (step.intensity === 3) {
                                                                StepIcon = BoltIcon;
                                                                iconColor = "text-amber-500 bg-amber-50 ring-amber-100 dark:bg-amber-900/30 dark:ring-amber-900/50";
                                                                cardBorder = "border-l-4 border-l-amber-400 dark:border-l-amber-500";
                                                            } else if (step.phase.toLowerCase().includes('enfriami')) {
                                                                StepIcon = HandRaisedIcon;
                                                                iconColor = "text-sky-500 bg-sky-50 ring-sky-100 dark:bg-sky-900/30 dark:ring-sky-900/50";
                                                                cardBorder = "border-l-4 border-l-sky-400 dark:border-l-sky-500";
                                                            }

                                                            return (
                                                                <div key={sIdx} className="relative pl-12 pb-8 last:pb-0 group">
                                                                    {/* Timeline Node Icon */}
                                                                    <div className={`absolute left-0 top-0 w-10 h-10 rounded-full border-4 border-white dark:border-slate-900 shadow-sm flex items-center justify-center z-10 transition-transform group-hover:scale-110 ${iconColor}`}>
                                                                        <StepIcon className="w-5 h-5" />
                                                                    </div>

                                                                    {/* Step Card */}
                                                                    <div className={`bg-white dark:bg-slate-800 rounded-xl p-4 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] border border-slate-100 dark:border-slate-700 hover:shadow-md transition-all ${cardBorder}`}>
                                                                        <div className="flex justify-between items-start mb-2 gap-4">
                                                                            <div>
                                                                                <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm md:text-base">{step.phase}</h4>
                                                                                <div className="flex items-center gap-2 mt-1.5">
                                                                                    <Badge size="xs" color={getTremorColor(step.intensity)} icon={step.intensity >= 4 ? FireIcon : undefined}>
                                                                                        Zona {step.intensity}
                                                                                    </Badge>
                                                                                </div>
                                                                            </div>
                                                                            <div className="flex flex-col items-end shrink-0">
                                                                                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-700/50 px-2 py-1 rounded-md ring-1 ring-slate-200 dark:ring-slate-700/50">
                                                                                    <ClockIcon className="w-3.5 h-3.5 text-slate-400" />
                                                                                    <span className="font-mono font-bold text-sm tracking-tight">{step.duration_min}'</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                                                                            {step.description}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>

                                                    <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end items-center gap-2 text-slate-400">
                                                        <FlagIcon className="w-4 h-4" />
                                                        <Text className="text-xs font-medium uppercase tracking-widest">
                                                            Tiempo Total: <span className="text-slate-700 dark:text-slate-200 font-bold text-sm">{day.structured_workout.reduce((acc, s) => acc + s.duration_min, 0)} min</span>
                                                        </Text>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                </div>
            )
            }

            {
                !plan && !loading && (
                    <Card className="p-8 ring-1 ring-slate-200 shadow-sm bg-white">
                        <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
                            <span className="text-4xl block mb-3">🧠</span>
                            <Text className="text-slate-500">Configura tu objetivo para generar un plan de entrenamiento de élite.</Text>
                        </div>
                    </Card>
                )
            }
        </div >
    );
};

export default TrainingPlanner;
