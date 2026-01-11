import React, { useState } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { Card, Grid, Title, Text, Metric, Button, NumberInput, Select, SelectItem, Badge, Callout, ProgressBar, Divider } from "@tremor/react";
import ModelSelector from './ModelSelector';

const TrainingPlanner = ({ activities }) => {
    const [goalDist, setGoalDist] = useState('10k');

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

        // Suggested time: 5% faster than current average for 10k
        const targetPaceMinKm = avgPaceMinKm * 0.95;
        const suggestedTime = Math.round(targetPaceMinKm * 10);
        return suggestedTime.toString();
    };

    const [goalTime, setGoalTime] = useState(calculateSuggestedTime);
    const [targetDate, setTargetDate] = useState('');
    const [weeks, setWeeks] = useState(4);
    const [selectedDays, setSelectedDays] = useState(['Mi', 'Sa']); // Miércoles y Sábado por defecto

    // Provider state: 'gemini' or 'groq'
    const [provider, setProvider] = useState('groq');

    // API keys from environment variables
    const apiKeys = {
        gemini: import.meta.env.VITE_GEMINI_API_KEY || '',
        groq: import.meta.env.VITE_GROQ_API_KEY || ''
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
            'hm': 21.097,
            'fm': 42.195
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
            setError(`Por favor, introduce una API Key de ${provider === 'groq' ? 'Groq' : 'Google Gemini'}.`);
            return;
        }

        setLoading(true);
        setError('');
        setPlan(null);

        try {
            const activityLog = getRecentActivitiesSummary();

            const daysCount = selectedDays.length;
            const daysStr = selectedDays.join(', ');

            const prompt = `
            Actúa como un fisiólogo deportivo de élite y entrenador de running profesional con conocimiento profundo de las metodologías más avanzadas y contrastadas.
            
            HISTORIAL DE ENTRENAMIENTO RECIENTE (Últimos 3 meses):
            ${activityLog}

            DATOS CLAVE A ANALIZAR:
            1. **Frecuencia Cardíaca**: Analiza las zonas de FC para determinar distribución de intensidad real.
            2. **Desnivel Acumulado**: Ajusta GAP (Grade Adjusted Pace) - los entrenamientos en montaña desarrollan fuerza pero ritmos más lentos.
            3. **Carga y Fatiga**: Evalúa volumen reciente, consistencia, y señales de sobreentrenamiento.
            4. **Progresión**: Identifica tendencias de mejora o estancamiento.
            
            OBJETIVO DEL CORREDOR:
            - Meta: Correr ${goalDist === 'fm' ? 'Maratón (42.195km)' : goalDist === 'hm' ? 'Media Maratón (21.097km)' : goalDist === '10k' ? '10 Kilómetros' : '5 Kilómetros'} en ${goalTime} minutos.
            - Fecha actual: ${new Date().toLocaleDateString()}.
            - Fecha objetivo de carrera: ${targetDate || 'No definida - Enfoque en mejora general de forma'}.
            - Disponibilidad semanal: ${daysCount} días de entrenamiento (${daysStr}).
            
            METODOLOGÍA Y PRINCIPIOS CIENTÍFICOS A APLICAR:
            
            1. **PRINCIPIO 80/20 (Stephen Seiler - Fisiólogo del Deporte)**:
               - Mínimo 75-80% del volumen total en Zona 2 (aeróbico conversacional, 60-75% FCmáx).
               - Máximo 20-25% en intensidad (Zona 4-5: Umbral y VO2max).
               - EVITA la "zona gris" (Zona 3 - tempo moderado) salvo sesiones específicas de umbral.
            
            2. **ENTRENAMIENTO POLARIZADO (Modelo Noruego - Ingebrigtsen, Warholm)**:
               - Sesiones claramente diferenciadas: MUY FÁCIL o MUY INTENSO.
               - Recuperación activa fundamental entre sesiones de calidad.
               - No más de 2-3 sesiones de alta intensidad por semana.
            
            3. **PERIODIZACIÓN INTELIGENTE (Jack Daniels VDOT)**:
               - Define zonas según capacidad actual (VDOT basado en tiempos recientes).
               - R (Recovery): Más lento que ritmo maratón +90s/km.
               - E (Easy): Ritmo maratón +60-90s/km, conversacional.
               - M (Marathon pace): Ritmo objetivo de maratón.
               - T (Threshold): Ritmo sostenible ~50-60min, aprox. ritmo 10K +15-20s/km.
               - I (Interval/VO2max): Ritmo 3K-5K, esfuerzo muy alto, bloques cortos.
               - R (Repetition): Ritmo 800m-1500m, desarrollo de velocidad pura.
            
            4. **CONSTRUCCIÓN DE BASE AERÓBICA (Arthur Lydiard)**:
               - Si faltan >12 semanas: Prioriza volumen en Zona 2 con pendientes suaves.
               - Si faltan 8-12 semanas: Introduce trabajo de umbral (Tempo runs).
               - Si faltan 4-8 semanas: Trabajo específico de ritmo de carrera + intervalos VO2max.
               - Si faltan <4 semanas: Afinamiento - reducir volumen, mantener intensidad, priorizar frescura.
            
            5. **TRABAJO ESPECÍFICO DE CARRERA (Renato Canova)**:
               - Para maratón: Long runs con finish a ritmo maratón (last 30-40% del rodaje).
               - Para 10K/HM: Bloques largos a ritmo objetivo (ej: 3x3km a ritmo HM).
               - Simulación de condiciones de carrera en entrenamientos clave.
            
            6. **RECUPERACIÓN Y PREVENCIÓN (Tom Schwartz - Fisioterapeuta Elite)**:
               - Días de descanso activo con movilidad/core/técnica en lugar de sentarte.
               - Post-intensidad: Siempre 48h antes de otra sesión de calidad.
               - Escucha las señales: FC matinal elevada = necesitas descanso extra.
            
            7. **PROGRESIÓN CONSERVADORA (Regla del 10%)**:
               - Incrementa volumen máximo 10% semanal.
               - Semanas de descarga (60-70% volumen) cada 3-4 semanas.
            
            ESTRUCTURA DE SESIONES RECOMENDADAS:
            
            - **Rodaje Fácil (Easy Run)**: Base aeróbica, Zona 2, ritmo conversacional. Nunca forzar.
            - **Rodaje Largo (Long Run)**: Zona 2 mayormente, puede incluir finish a objetivo. Clave para resistencia.
            - **Tempo/Umbral (Threshold)**: Bloques 15-40min a ritmo 10K+15-20s. Mejora eficiencia lactato.
            - **Intervalos VO2max**: 3-5min intensos (ritmo 3K-5K) con recuperación igual o mayor. Máximo rendimiento.
            - **Series de Velocidad**: 200m-1K a ritmo muy rápido. Economía de carrera y explosividad.
            - **Fartlek**: Variaciones de ritmo orgánicas. Mental y físicamente adaptativo.
            - **Rodaje Recuperación**: Muy muy suave, 20-40min. Activa circulación sin fatiga.
            
            IMPORTANTE: Devuelve SOLO un objeto JSON válido (sin markdown, sin bloques de código) con esta estructura:
            {
              "analysis": "Análisis breve (max 60 palabras) de su estado: base aeróbica, fatiga acumulada, fortalezas/debilidades detectadas",
              "weekly_summary": "Enfoque de esta semana según periodización (ej: 'Semana de base aeróbica con introducción de trabajo de umbral')",
              "stats": {
                "total_dist_km": "Distancia total estimada (número, ej: 52)",
                "total_time_min": "Tiempo total estimado (número, ej: 300)",
                "distribution": {
                    "easy": "Porcentaje Zona 1-2 aeróbico (número, objetivo >75)",
                    "moderate": "Porcentaje Zona 3 umbral/tempo (número, ~10-15)",
                    "hard": "Porcentaje Zona 4-5 VO2max/velocidad (número, ~5-10)"
                }
              },
              "schedule": [
                {
                  "day": "Nombre del día (ej: 'Lunes')",
                  "type": "Categoría (Rodaje Fácil / Rodaje Largo / Tempo / Intervalos / Series / Descanso / Recuperación)",
                  "daily_stats": {
                    "dist": "Distancia (ej: '12 km')",
                    "time": "Tiempo estimado (ej: '65 min')"
                  },
                  "summary": "Objetivo de la sesión y zonas de trabajo (ej: 'Rodaje aeróbico Zona 2, fortalecer base')",
                  "structured_workout": [
                    { 
                        "phase": "Calentamiento", 
                        "duration_min": 10, 
                        "intensity": 1, 
                        "description": "Trote progresivo Zona 1-2" 
                    },
                    { 
                        "phase": "Bloque Principal", 
                        "duration_min": 20, 
                        "intensity": 4, 
                        "description": "4x5min Zona 4 (ritmo 5K) con 3min trote recuperación" 
                    },
                    { 
                        "phase": "Enfriamiento", 
                        "duration_min": 10, 
                        "intensity": 1, 
                        "description": "Trote suave + estiramientos" 
                    }
                  ]
                }
              ] 
              
              GENERA EXACTAMENTE ${daysCount} SESIONES para los días ${daysStr}. Los días NO seleccionados NO deben aparecer o márcados como Descanso.
              
              CRITICAL: Respeta distribución 80/20. No sobreentrenes. Prioriza calidad sobre cantidad. Periodiza correctamente según tiempo hasta objetivo.
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
                    max_tokens: 2048,
                    response_format: { type: "json_object" } // Force JSON mode for models that support it
                });
                jsonString = completion.choices[0]?.message?.content || '';
            }
            // --- GEMINI EXECUTION ---
            else {
                // Models supported for content generation
                const availableModels = [
                    "gemini-2.0-flash",
                    "gemini-2.0-flash-lite-preview-02-05",
                    "gemini-2.0-flash-lite",
                    "gemini-2.0-flash-exp",
                    "gemini-2.0-pro-exp-02-05",
                    "gemini-2.5-flash",
                    "gemini-2.5-pro",
                    "gemini-1.5-flash",
                    "gemini-1.5-pro"
                ];

                const modelsToTry = selectedModel ? [selectedModel] : availableModels;
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
            const planData = JSON.parse(cleanJson);

            setPlan(planData);
            setLoading(false);

        } catch (err) {
            console.error("Error generando plan:", err);

            // Check what's actually available to give a helpful error
            let debugInfo = '';
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

    return (
        <div className="mb-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <Title className="text-xl uppercase tracking-widest flex items-center gap-2">
                    <span className="text-2xl">🤖</span> Entrenador AI
                </Title>
                <ModelSelector
                    provider={provider}
                    setProvider={setProvider}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    showLabel={false}
                />
            </div>

            <Card className="mb-8 p-6 ring-1 ring-slate-200 shadow-sm bg-white dark:bg-slate-900 dark:ring-slate-800">
                <form onSubmit={generateAIPlan} className="space-y-6">
                    <Grid numItems={1} numItemsSm={3} className="gap-6">
                        <div>
                            <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">Objetivo</Text>
                            <Select value={goalDist} onValueChange={setGoalDist} enableClear={false}>
                                <SelectItem value="5k">5K</SelectItem>
                                <SelectItem value="10k">10K</SelectItem>
                                <SelectItem value="hm">Media Maratón</SelectItem>
                                <SelectItem value="fm">Maratón</SelectItem>
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
                                    </div>
                                </div>
                            )}
                        </div>

                        {plan.stats && plan.stats.distribution && (
                            <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                                <Text className="text-xs font-bold uppercase text-slate-400 mb-3">Distribución de Intensidad (80/20)</Text>
                                <ProgressBar value={plan.stats.distribution.easy} color="emerald" className="mt-2" />
                                <div className="flex justify-between mt-2 text-xs text-slate-500 font-medium">
                                    <span className="text-emerald-600">Suave (Z1-2): {plan.stats.distribution.easy}%</span>
                                    <span className="text-amber-500">Umbral (Z3): {plan.stats.distribution.moderate}%</span>
                                    <span className="text-rose-500">Intenso (Z4-5): {plan.stats.distribution.hard}%</span>
                                </div>
                            </div>
                        )}
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

                                        {day.structured_workout && day.structured_workout.length > 0 && (
                                            <div className="mt-4 bg-slate-50 dark:bg-slate-900 rounded-lg p-3 border border-slate-100 dark:border-slate-800">
                                                <Text className="text-xs font-bold uppercase text-slate-400 mb-2">Estructura</Text>
                                                <div className="space-y-2">
                                                    {day.structured_workout.map((step, sIdx) => (
                                                        <div key={sIdx} className="flex justify-between items-center text-sm border-b border-slate-200 dark:border-slate-800 pb-2 last:border-0 last:pb-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-semibold text-slate-700 dark:text-slate-300">{step.phase}</span>
                                                                <span className="text-slate-500 text-xs truncate max-w-[200px] hidden sm:block">- {step.description}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <Badge size="xs" color={step.intensity >= 4 ? 'rose' : step.intensity === 3 ? 'amber' : 'emerald'}>Z{step.intensity}</Badge>
                                                                <span className="font-mono font-bold dark:text-slate-300">{step.duration_min}'</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                </div>
            )}

            {!plan && !loading && (
                <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl mt-8">
                    <span className="text-4xl block mb-2">🧠</span>
                    <Text className="text-slate-400">Configura tu objetivo para generar un plan de élite.</Text>
                </div>
            )}
        </div>
    );
};

export default TrainingPlanner;
