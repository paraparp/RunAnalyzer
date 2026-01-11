import React, { useState, useEffect } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

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

    /* Logic to avoid getting stuck with the placeholder key in localStorage */
    const [apiKeys, setApiKeys] = useState(() => {
        return {
            gemini: localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '',
            groq: localStorage.getItem('groq_api_key') || import.meta.env.VITE_GROQ_API_KEY || ''
        };
    });

    const [selectedModel, setSelectedModel] = useState('llama-3.1-8b-instant');
    const [loading, setLoading] = useState(false);
    const [plan, setPlan] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (apiKeys.gemini) localStorage.setItem('gemini_api_key', apiKeys.gemini);
        else localStorage.removeItem('gemini_api_key');

        if (apiKeys.groq) localStorage.setItem('groq_api_key', apiKeys.groq);
        else localStorage.removeItem('groq_api_key');
    }, [apiKeys]);

    // Reset model when provider changes
    useEffect(() => {
        if (provider === 'groq') setSelectedModel('llama-3.1-8b-instant');
        else setSelectedModel('gemini-2.5-flash-lite');
    }, [provider]);

    const handleApiKeyChange = (val) => {
        setApiKeys(prev => ({ ...prev, [provider]: val }));
    };

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
        <div className="planner-container" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <h3 className="section-title">🤖 Entrenador AI</h3>

                    {/* Provider Selector Switch */}
                    <div style={{ display: 'flex', background: 'var(--bg-card)', borderRadius: '20px', padding: '2px', border: '1px solid var(--border-color)' }}>
                        <button
                            onClick={() => setProvider('groq')}
                            style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '18px',
                                border: 'none',
                                background: provider === 'groq' ? '#f97316' : 'transparent', // Orange for Groq
                                color: provider === 'groq' ? 'white' : 'var(--text-secondary)',
                                fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.3s'
                            }}
                        >
                            Groq ⚡
                        </button>
                        <button
                            onClick={() => setProvider('gemini')}
                            style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '18px',
                                border: 'none',
                                background: provider === 'gemini' ? '#3b82f6' : 'transparent', // Blue for Gemini
                                color: provider === 'gemini' ? 'white' : 'var(--text-secondary)',
                                fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.3s'
                            }}
                        >
                            Gemini 🧠
                        </button>
                    </div>
                </div>

                {currentApiKey ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: 'bold' }}>✅ API Key activa</span>
                        <button
                            onClick={() => handleApiKeyChange('')}
                            style={{ fontSize: '0.7rem', textDecoration: 'underline', color: 'var(--text-muted)' }}
                        >
                            Cambiar
                        </button>
                    </div>
                ) : (
                    <input
                        type="password"
                        placeholder={provider === 'groq' ? "Pegar API Key de Groq" : "Pegar API Key de Gemini"}
                        value={currentApiKey}
                        onChange={e => handleApiKeyChange(e.target.value)}
                        style={{ width: '200px', fontSize: '0.7rem' }}
                    />
                )}
            </div>

            {!currentApiKey && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem', fontStyle: 'italic' }}>
                    {provider === 'groq'
                        ? <span>* Consigue tu API Key (14k req/día) en <a href="https://console.groq.com/keys" target="_blank" style={{ textDecoration: 'underline', color: '#f97316' }}>Groq Console</a>.</span>
                        : <span>* Consigue tu API Key en <a href="https://aistudio.google.com/app/apikey" target="_blank" style={{ textDecoration: 'underline' }}>Google AI Studio</a>.</span>
                    }
                </div>
            )}

            {/* Model Selector Settings */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flexGrow: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>MODELO INTELIGENTE ({provider.toUpperCase()})</label>
                    <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        style={{
                            padding: '0.5rem',
                            borderRadius: '8px',
                            border: 'var(--border-light)',
                            background: 'white',
                            color: 'var(--text-primary)',
                            width: '100%',
                            maxWidth: '300px',
                            fontSize: '0.85rem'
                        }}
                    >
                        {provider === 'groq' ? (
                            <>
                                <option value="llama-3.1-8b-instant">⚡ Llama 3.1 8B Instant (Ultra Rápido - 14k reqs)</option>
                                <option value="llama-3.3-70b-versatile">🧠 Llama 3.3 70B (Más Inteligente)</option>
                                <option value="mixtral-8x7b-32768">🌀 Mixtral 8x7B</option>
                                <option value="gemma2-9b-it">💎 Gemma 2 9B</option>
                            </>
                        ) : (
                            <>
                                <option value="gemini-2.5-flash-lite">🆕 Gemini 2.5 Flash Lite (Nuevo + Ahorro)</option>
                                <option value="gemini-2.5-flash">⚡ Gemini 2.5 Flash (Más Rápido)</option>
                                <option value="gemini-2.0-flash-lite-001">🛡️ Gemini 2.0 Flash Lite (Estable)</option>
                                <option value="gemini-2.0-flash">🚀 Gemini 2.0 Flash (Equilibrado)</option>
                                <option value="gemini-2.5-pro">🧠 Gemini 2.5 Pro (Máximo Razonamiento)</option>
                            </>
                        )}
                    </select>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '400px', lineHeight: '1.4' }}>
                    {provider === 'groq'
                        ? `ℹ️ Groq es increíblemente rápido. El modelo 8B tiene un límite gratuito masivo (14,400/día).`
                        : `ℹ️ Gemini es multimodal y tiene gran ventana de contexto. Flash Lite es ideal para ahorrar cuota.`
                    }
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Form - Now at the top */}
                <div className="planner-form-card" style={{
                    background: 'var(--bg-card)',
                    padding: '1.5rem',
                    borderRadius: '12px',
                    border: 'var(--border-light)',
                    boxShadow: 'var(--shadow-sm)'
                }}>
                    <form onSubmit={generateAIPlan} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {/* Compact Grid for all inputs */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', alignItems: 'end' }}>
                            <div>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.15rem', display: 'block' }}>OBJETIVO</label>
                                <select
                                    value={goalDist}
                                    onChange={e => setGoalDist(e.target.value)}
                                    style={{ width: '100%', padding: '0.25rem', fontSize: '0.8rem', borderRadius: '4px', border: 'var(--border-light)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}
                                >
                                    <option value="5k">5K</option>
                                    <option value="10k">10K</option>
                                    <option value="hm">Media Maratón</option>
                                    <option value="fm">Maratón</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.15rem', display: 'block' }}>TIEMPO (min)</label>
                                <input
                                    type="number"
                                    value={goalTime}
                                    onChange={e => setGoalTime(e.target.value)}
                                    placeholder="ej. 45"
                                    style={{ width: '100%', padding: '0.25rem', fontSize: '0.8rem', borderRadius: '4px', border: 'var(--border-light)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '0.15rem', display: 'block' }}>PLAZO</label>
                                <select
                                    value={weeks}
                                    onChange={e => setWeeks(Number(e.target.value))}
                                    style={{ width: '100%', padding: '0.25rem', fontSize: '0.8rem', borderRadius: '4px', border: 'var(--border-light)', background: 'var(--bg-main)', color: 'var(--text-primary)' }}
                                >
                                    <option value={3}>3 Semanas</option>
                                    <option value={4}>4 Semanas</option>
                                    <option value={6}>6 Semanas</option>
                                    <option value={8}>8 Semanas</option>
                                    <option value={12}>12 Semanas</option>
                                    <option value={16}>16 Semanas</option>
                                </select>
                            </div>
                        </div>

                        {/* Weekdays - Super compact */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>DÍAS:</label>
                            <div style={{ display: 'flex', gap: '0.25rem', flex: 1 }}>
                                {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'].map(day => (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() => {
                                            setSelectedDays(prev =>
                                                prev.includes(day)
                                                    ? prev.filter(d => d !== day)
                                                    : [...prev, day]
                                            );
                                        }}
                                        style={{
                                            flex: 1,
                                            padding: '0.25rem 0',
                                            borderRadius: '4px',
                                            background: selectedDays.includes(day) ? 'var(--accent-primary)' : 'var(--bg-main)',
                                            color: selectedDays.includes(day) ? 'white' : 'var(--text-secondary)',
                                            border: selectedDays.includes(day) ? 'none' : '1px solid transparent',
                                            fontSize: '0.7rem',
                                            fontWeight: selectedDays.includes(day) ? 'bold' : 'normal',
                                            cursor: 'pointer',
                                            transition: 'all 0.1s'
                                        }}
                                    >
                                        {day}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !goalTime}
                            style={{
                                padding: '0.4rem',
                                borderRadius: '6px',
                                border: 'none',
                                background: loading ? '#9ca3af' : 'var(--accent-primary)',
                                color: 'white',
                                fontWeight: 'bold',
                                fontSize: '0.85rem',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                transition: 'background 0.2s',
                                width: '100%',
                                marginTop: '0.2rem'
                            }}
                        >
                            {loading ? 'Analizando...' : 'Generar Plan'}
                        </button>
                    </form>
                    {error && <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '1rem' }}>{error}</div>}
                </div>

                {/* Goal Feasibility Analysis */}
                {goalDist && goalTime && (() => {
                    const analysis = getGoalFeasibility();
                    if (!analysis) return null;

                    return (
                        <div style={{
                            marginTop: '0',
                            background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(249,250,251,0.9))',
                            borderRadius: '10px',
                            padding: '0.75rem',
                            border: `1px solid ${analysis.color}`,
                            boxShadow: `0 2px 8px ${analysis.color}20`
                        }}>
                            {/* Header Row: Icon + Title + Status */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div style={{ fontSize: '1.25rem' }}>
                                    {analysis.feasibility === 'easy' ? '🎯' :
                                        analysis.feasibility === 'realistic' ? '✅' :
                                            analysis.feasibility === 'challenging' ? '💪' : '⚠️'}
                                </div>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                                    <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                        {analysis.feasibility === 'easy' ? 'Fácilmente Alcanzable' :
                                            analysis.feasibility === 'realistic' ? 'Objetivo Realista' :
                                                analysis.feasibility === 'challenging' ? 'Desafiante' : 'Muy Ambicioso'}
                                    </h3>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Análisis de Factibilidad</span>
                                </div>
                            </div>

                            {/* Paces Row - No Cards, Just Data */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                background: 'white',
                                padding: '0.5rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                marginBottom: '0.75rem'
                            }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Actual (GAP)</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', fontFamily: 'monospace', color: '#6366f1' }}>
                                        {Math.floor(analysis.currentPace)}:{String(Math.round((analysis.currentPace % 1) * 60)).padStart(2, '0')}
                                    </div>
                                    <div style={{ fontSize: '0.6rem', color: '#f59e0b' }}>
                                        {analysis.gapAdjusted ? '⚡ Corregido' : 'Sin ajuste'}
                                    </div>
                                </div>
                                <div style={{ width: '1px', background: 'var(--border-color)' }}></div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Objetivo</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', fontFamily: 'monospace', color: analysis.color }}>
                                        {Math.floor(analysis.targetPace)}:{String(Math.round((analysis.targetPace % 1) * 60)).padStart(2, '0')}
                                    </div>
                                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{goalTime}min</div>
                                </div>
                                <div style={{ width: '1px', background: 'var(--border-color)' }}></div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Diferencia</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', fontFamily: 'monospace', color: analysis.gap <= 0 ? '#10b981' : '#ef4444' }}>
                                        {analysis.gap <= 0 ? '-' : '+'}{Math.abs(analysis.gapPercent).toFixed(1)}%
                                    </div>
                                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                                        {Math.abs(analysis.gap * 60).toFixed(0)}s/km
                                    </div>
                                </div>
                            </div>

                            {/* Minimalist Bar */}
                            <div style={{ marginBottom: '0.5rem', position: 'relative', height: '14px' }}>
                                <div style={{
                                    height: '6px',
                                    marginTop: '4px',
                                    background: 'linear-gradient(90deg, #10b981 0%, #10b981 25%, #3b82f6  25%, #3b82f6 50%, #f59e0b 50%, #f59e0b 75%, #ef4444 75%, #ef4444 100%)',
                                    borderRadius: '3px',
                                    opacity: 0.8
                                }}></div>
                                {/* Dot Marker */}
                                <div style={{
                                    position: 'absolute',
                                    left: `${Math.max(0, Math.min(100, 50 + (analysis.gapPercent * 0.5)))}%`,
                                    top: '0',
                                    transform: 'translateX(-50%)',
                                    background: 'white',
                                    border: `2px solid ${analysis.color}`,
                                    borderRadius: '50%',
                                    width: '14px',
                                    height: '14px',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                }}></div>
                            </div>

                            {/* Combined Info & Recommendation Row */}
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'start' }}>
                                <div style={{ flex: 1, fontSize: '0.65rem', padding: '0.4rem', background: 'rgba(99, 102, 241, 0.05)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                                    <strong>Última:</strong> {analysis.lastRunDate} ({analysis.lastRunDist}km a {Math.floor(analysis.lastRunRawPace)}:{String(Math.round((analysis.lastRunRawPace % 1) * 60)).padStart(2, '0')})
                                    {analysis.gapAdjusted && <span style={{ color: '#10b981', marginLeft: '0.3rem' }}>⚡ GAP: {Math.floor(analysis.lastRunPace)}:{String(Math.round((analysis.lastRunPace % 1) * 60)).padStart(2, '0')}</span>}
                                </div>
                                <div style={{ flex: 1.5, fontSize: '0.65rem', borderLeft: `2px solid ${analysis.color}`, paddingLeft: '0.5rem', color: 'var(--text-primary)', fontStyle: 'italic' }}>
                                    "{analysis.recommendation}"
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Result */}
                <div className="planner-results">
                    {!plan && !loading && (
                        <div style={{
                            height: '300px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-muted)',
                            border: '2px dashed var(--border-color)',
                            borderRadius: '12px',
                            fontSize: '0.9rem',
                            textAlign: 'center',
                            padding: '2rem'
                        }}>
                            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧠</div>
                            <div>Define tu objetivo y la IA diseñará tu semana perfecta.</div>
                        </div>
                    )}

                    {loading && (
                        <div style={{
                            height: '300px',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            color: 'var(--accent-primary)'
                        }}>
                            Generando estrategia personalizada...
                        </div>
                    )}

                    {plan && (
                        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {/* Analysis Card */}
                            <div style={{
                                background: 'linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%)',
                                padding: '1.5rem',
                                borderRadius: '16px',
                                color: 'white',
                                boxShadow: 'var(--shadow-md)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '1.25rem'
                            }}>
                                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                                    <div style={{ fontSize: '2.5rem', background: 'rgba(255,255,255,0.1)', borderRadius: '12px', width: '60px', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        ⚡
                                    </div>
                                    <div style={{ flexGrow: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                                            <div>
                                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.5rem' }}>Estrategia Semanal</div>
                                                <div style={{ fontSize: '1.25rem', fontWeight: '800', lineHeight: '1.3' }}>{plan.weekly_summary}</div>
                                            </div>
                                            {plan.stats && (
                                                <div style={{ display: 'flex', gap: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem 1rem', borderRadius: '8px' }}>
                                                    <div style={{ textAlign: 'center' }}>
                                                        <div style={{ fontSize: '0.7rem', opacity: 0.7, textTransform: 'uppercase' }}>Distancia</div>
                                                        <div style={{ fontSize: '1.1rem', fontWeight: '800', fontFamily: 'monospace' }}>{plan.stats.total_dist_km} km</div>
                                                    </div>
                                                    <div style={{ width: '1px', background: 'rgba(255,255,255,0.2)' }}></div>
                                                    <div style={{ textAlign: 'center' }}>
                                                        <div style={{ fontSize: '0.7rem', opacity: 0.7, textTransform: 'uppercase' }}>Tiempo</div>
                                                        <div style={{ fontSize: '1.1rem', fontWeight: '800', fontFamily: 'monospace' }}>
                                                            {Math.floor(plan.stats.total_time_min / 60)}h {plan.stats.total_time_min % 60}m
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.9rem', opacity: 0.9, lineHeight: '1.6', marginTop: '0.75rem' }}>{plan.analysis}</div>
                                    </div>
                                </div>

                                {/* Enhanced Stats Grid */}
                                {plan.stats && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
                                        {/* Average Pace */}
                                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                            <div style={{ fontSize: '0.65rem', opacity: 0.7, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Ritmo Promedio</div>
                                            <div style={{ fontSize: '1rem', fontWeight: '800', fontFamily: 'monospace' }}>
                                                {plan.stats.total_dist_km && plan.stats.total_time_min
                                                    ? `${Math.floor(plan.stats.total_time_min / plan.stats.total_dist_km)}:${String(Math.round((plan.stats.total_time_min / plan.stats.total_dist_km % 1) * 60)).padStart(2, '0')} /km`
                                                    : 'N/A'
                                                }
                                            </div>
                                        </div>

                                        {/* Sessions Count */}
                                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                            <div style={{ fontSize: '0.65rem', opacity: 0.7, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Sesiones</div>
                                            <div style={{ fontSize: '1rem', fontWeight: '800' }}>
                                                {plan.schedule ? `${plan.schedule.filter(d => !d.type.toLowerCase().includes('descanso')).length} entrenamientos` : 'N/A'}
                                            </div>
                                        </div>

                                        {/* Estimated TSS */}
                                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                            <div style={{ fontSize: '0.65rem', opacity: 0.7, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Carga TSS (est.)</div>
                                            <div style={{ fontSize: '1rem', fontWeight: '800' }}>
                                                {plan.stats.total_time_min
                                                    ? Math.round((plan.stats.distribution.easy * plan.stats.total_time_min * 0.6 / 100) +
                                                        (plan.stats.distribution.moderate * plan.stats.total_time_min * 1.0 / 100) +
                                                        (plan.stats.distribution.hard * plan.stats.total_time_min * 1.4 / 100))
                                                    : 'N/A'
                                                }
                                            </div>
                                        </div>

                                        {/* Avg Session Duration */}
                                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                            <div style={{ fontSize: '0.65rem', opacity: 0.7, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Sesión Media</div>
                                            <div style={{ fontSize: '1rem', fontWeight: '800' }}>
                                                {plan.schedule && plan.stats.total_time_min
                                                    ? `${Math.round(plan.stats.total_time_min / plan.schedule.filter(d => !d.type.toLowerCase().includes('descanso')).length)} min`
                                                    : 'N/A'
                                                }
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Distribution Chart */}
                                {plan.stats && plan.stats.distribution && (
                                    <div style={{ marginTop: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '12px' }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.75rem', opacity: 0.8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span>Distribución de Intensidad (Modelo 80/20)</span>
                                            <span style={{
                                                padding: '0.25rem 0.75rem',
                                                borderRadius: '12px',
                                                fontSize: '0.7rem',
                                                background: plan.stats.distribution.easy >= 75 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(251, 191, 36, 0.2)',
                                                color: plan.stats.distribution.easy >= 75 ? '#10b981' : '#fbbf24',
                                                fontWeight: 'bold'
                                            }}>
                                                {plan.stats.distribution.easy >= 75 ? '✅ Óptimo' : '⚠️ Revisar'}
                                            </span>
                                        </div>

                                        {/* Visual Bar */}
                                        <div style={{ height: '24px', width: '100%', display: 'flex', borderRadius: '12px', overflow: 'hidden', marginBottom: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
                                            <div style={{ width: `${plan.stats.distribution.easy}%`, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', transition: 'width 1s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 'bold', color: 'white' }} title={`Suave: ${plan.stats.distribution.easy}%`}>
                                                {plan.stats.distribution.easy >= 15 && `${plan.stats.distribution.easy}%`}
                                            </div>
                                            <div style={{ width: `${plan.stats.distribution.moderate}%`, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', transition: 'width 1s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 'bold', color: 'white' }} title={`Moderado: ${plan.stats.distribution.moderate}%`}>
                                                {plan.stats.distribution.moderate >= 10 && `${plan.stats.distribution.moderate}%`}
                                            </div>
                                            <div style={{ width: `${plan.stats.distribution.hard}%`, background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', transition: 'width 1s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 'bold', color: 'white' }} title={`Intenso: ${plan.stats.distribution.hard}%`}>
                                                {plan.stats.distribution.hard >= 10 && `${plan.stats.distribution.hard}%`}
                                            </div>
                                        </div>

                                        {/* Legend with percentages and time breakdown */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', fontSize: '0.75rem' }}>
                                            <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }}></div>
                                                    <span style={{ opacity: 0.9, fontWeight: 'bold' }}>Zona 1-2 (Aeróbico)</span>
                                                </div>
                                                <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#10b981' }}>{plan.stats.distribution.easy}%</div>
                                                <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                                                    ≈{Math.round(plan.stats.total_time_min * plan.stats.distribution.easy / 100)} min
                                                </div>
                                            </div>
                                            <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }}></div>
                                                    <span style={{ opacity: 0.9, fontWeight: 'bold' }}>Zona 3 (Umbral)</span>
                                                </div>
                                                <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#f59e0b' }}>{plan.stats.distribution.moderate}%</div>
                                                <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                                                    ≈{Math.round(plan.stats.total_time_min * plan.stats.distribution.moderate / 100)} min
                                                </div>
                                            </div>
                                            <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }}></div>
                                                    <span style={{ opacity: 0.9, fontWeight: 'bold' }}>Zona 4-5 (VO2max)</span>
                                                </div>
                                                <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#ef4444' }}>{plan.stats.distribution.hard}%</div>
                                                <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                                                    ≈{Math.round(plan.stats.total_time_min * plan.stats.distribution.hard / 100)} min
                                                </div>
                                            </div>
                                        </div>

                                        {/* Scientific Reference */}
                                        <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)', fontSize: '0.7rem', lineHeight: '1.4' }}>
                                            <strong style={{ color: '#60a5fa' }}>💡 Principio 80/20 (Stephen Seiler):</strong> Los atletas de élite entrenan 75-80% en zona aeróbica y solo 20-25% en alta intensidad. Esta distribución polarizada maximiza adaptaciones y minimiza lesiones.
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Schedule Grid */}
                            <div className="plan-schedule" style={{ display: 'grid', gap: '1.25rem' }}>
                                {plan.schedule.map((day, idx) => {
                                    // Determine icon and color based on type
                                    let icon = '🏃';
                                    let color = 'var(--text-primary)';
                                    let bgColor = 'var(--bg-card)';

                                    const typeLower = day.type.toLowerCase();
                                    if (typeLower.includes('series') || typeLower.includes('velocidad') || typeLower.includes('intervals')) {
                                        icon = '🔥';
                                        color = '#f59e0b'; // Amber
                                    } else if (typeLower.includes('larga') || typeLower.includes('fondo')) {
                                        icon = '🛣️';
                                        color = '#3b82f6'; // Blue
                                    } else if (typeLower.includes('recup') || typeLower.includes('suave')) {
                                        icon = '🔋';
                                        color = '#10b981'; // Emerald
                                    } else if (typeLower.includes('descanso')) {
                                        icon = '💤';
                                        color = '#94a3b8'; // Slate
                                        bgColor = '#f8fafc';
                                    }

                                    return (
                                        <div key={idx} style={{
                                            background: bgColor,
                                            borderRadius: '16px',
                                            border: '1px solid var(--border-color)',
                                            boxShadow: 'var(--shadow-sm)',
                                            overflow: 'hidden'
                                        }}>
                                            {/* Header */}
                                            <div style={{
                                                padding: '1rem 1.25rem',
                                                borderBottom: '1px solid var(--border-color)',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                background: typeLower.includes('descanso') ? 'transparent' : 'rgba(255,255,255,0.5)'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <div style={{
                                                        background: typeLower.includes('descanso') ? '#e2e8f0' : `${color}20`,
                                                        color: color,
                                                        width: '36px', height: '36px',
                                                        borderRadius: '10px',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: '1.2rem'
                                                    }}>
                                                        {icon}
                                                    </div>
                                                    <div>
                                                        <h4 style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>{day.day}</h4>
                                                        <span style={{ fontSize: '0.8rem', color: color, fontWeight: '700', textTransform: 'uppercase' }}>{day.type}</span>
                                                    </div>
                                                </div>

                                                {/* Daily Stats Badge */}
                                                {!typeLower.includes('descanso') && day.daily_stats && (
                                                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                        <div style={{ fontSize: '0.9rem', fontWeight: '800', color: 'var(--text-primary)' }}>{day.daily_stats.dist}</div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{day.daily_stats.time}</div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Body */}
                                            {!typeLower.includes('descanso') && (
                                                <div style={{ padding: '1.25rem' }}>
                                                    <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: '1.5' }}>
                                                        {day.summary}
                                                    </div>

                                                    {/* Graphical Workout Visualization */}
                                                    {day.structured_workout && day.structured_workout.length > 0 ? (
                                                        <div style={{ marginTop: '1rem', background: 'rgba(0,0,0,0.02)', padding: '1rem', borderRadius: '12px' }}>
                                                            {/* Title */}
                                                            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span>📊 Estructura del Entrenamiento</span>
                                                                <span style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                                                    {day.structured_workout.reduce((acc, s) => acc + s.duration_min, 0)} min total
                                                                </span>
                                                            </div>

                                                            {/* Enhanced Bars Graph with Labels */}
                                                            <div style={{
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                gap: '0.75rem',
                                                                marginBottom: '1rem'
                                                            }}>
                                                                {/* Intensity Scale Reference */}
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)', paddingLeft: '140px' }}>
                                                                    <span>Zona 1-2</span>
                                                                    <span>Zona 3</span>
                                                                    <span>Zona 4-5</span>
                                                                </div>

                                                                {/* Bars Container */}
                                                                <div style={{
                                                                    position: 'relative'
                                                                }}>
                                                                    {day.structured_workout.map((step, sIdx) => {
                                                                        // Calculate total duration for percentage
                                                                        const totalDuration = day.structured_workout.reduce((acc, s) => acc + s.duration_min, 0);
                                                                        const widthPercent = (step.duration_min / totalDuration) * 100;

                                                                        // Intensity to height mapping
                                                                        const heightPercent = Math.max(25, Math.min(100, step.intensity * 20));

                                                                        // Color and zone based on intensity
                                                                        let barGradient = 'linear-gradient(135deg, #10b981, #059669)';
                                                                        let borderColor = '#10b981';
                                                                        let zoneName = 'Z1-2';
                                                                        let zoneDescription = 'Aeróbico';

                                                                        if (step.intensity >= 4) {
                                                                            barGradient = 'linear-gradient(135deg, #ef4444, #dc2626)';
                                                                            borderColor = '#ef4444';
                                                                            zoneName = 'Z4-5';
                                                                            zoneDescription = 'Alta Intensidad';
                                                                        } else if (step.intensity === 3) {
                                                                            barGradient = 'linear-gradient(135deg, #f59e0b, #d97706)';
                                                                            borderColor = '#f59e0b';
                                                                            zoneName = 'Z3';
                                                                            zoneDescription = 'Umbral';
                                                                        } else if (step.intensity === 2) {
                                                                            barGradient = 'linear-gradient(135deg, #3b82f6, #2563eb)';
                                                                            borderColor = '#3b82f6';
                                                                            zoneName = 'Z2';
                                                                            zoneDescription = 'Moderado';
                                                                        }

                                                                        return (
                                                                            <div key={sIdx} style={{
                                                                                display: 'flex',
                                                                                flexDirection: 'column',
                                                                                alignItems: 'stretch',
                                                                                gap: '0.25rem',
                                                                                marginBottom: sIdx < day.structured_workout.length - 1 ? '0.5rem' : 0,
                                                                                animation: 'fadeIn 0.5s ease-in-out',
                                                                                animationDelay: `${sIdx * 100}ms`,
                                                                                animationFillMode: 'backwards'
                                                                            }}>
                                                                                {/* Header: Phase | Duration | Zone */}
                                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.25rem' }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                        <span style={{ fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--text-primary)' }}>{step.phase}</span>
                                                                                        <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'white', background: borderColor, padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{zoneName}</span>
                                                                                    </div>
                                                                                    <span style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--text-primary)' }}>{step.duration_min}'</span>
                                                                                </div>

                                                                                {/* Bar with animation */}
                                                                                <div style={{
                                                                                    width: '100%',
                                                                                    height: '8px',
                                                                                    background: 'rgba(0,0,0,0.05)',
                                                                                    borderRadius: '4px',
                                                                                    marginTop: '0.1rem',
                                                                                    overflow: 'hidden'
                                                                                }}>
                                                                                    <div style={{
                                                                                        width: `${widthPercent}%`,
                                                                                        height: '100%',
                                                                                        background: barGradient,
                                                                                        borderRadius: '6px',
                                                                                        position: 'relative',
                                                                                        transition: 'width 1s ease-out',
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        padding: '0 0.75rem',
                                                                                        justifyContent: 'space-between',
                                                                                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                                                                                        cursor: 'help'
                                                                                    }}
                                                                                        title={`${step.phase}: ${step.duration_min} min - ${step.description}`}>

                                                                                        {/* Interval Dividers if detected (e.g. "2x15") */}
                                                                                        {(() => {
                                                                                            const intervalMatch = step.description.match(/(\d+)\s*x\s*/i) || step.phase.match(/(\d+)\s*x\s*/i);
                                                                                            const intervalCount = intervalMatch ? parseInt(intervalMatch[1]) : 1;
                                                                                            if (intervalCount <= 1) return null;

                                                                                            return Array.from({ length: intervalCount - 1 }).map((_, i) => (
                                                                                                <div key={i} style={{
                                                                                                    position: 'absolute',
                                                                                                    left: `${(100 / intervalCount) * (i + 1)}%`,
                                                                                                    top: 0,
                                                                                                    bottom: 0,
                                                                                                    width: '1px',
                                                                                                    background: 'rgba(255,255,255,0.6)',
                                                                                                    boxShadow: '1px 0 2px rgba(0,0,0,0.1)',
                                                                                                    zIndex: 2
                                                                                                }} />
                                                                                            ));
                                                                                        })()}




                                                                                    </div>
                                                                                </div>

                                                                                {/* Description inline */}
                                                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.3', padding: '0 0.25rem' }}>
                                                                                    {step.description}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>



                                                            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--text-secondary)', flexWrap: 'wrap', opacity: 0.8 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></div><span>Z1-2 Fácil</span></div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6' }}></div><span>Z2 Moderado</span></div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }}></div><span>Z3 Umbral</span></div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></div><span>Z4-5 Max</span></div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        /* Fallback text if no structured data (old plans) */
                                                        <div style={{ fontStyle: 'italic', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Detalles visuales no disponibles.</div>
                                                    )}
                                                </div>
                                            )}

                                            {typeLower.includes('descanso') && (
                                                <div style={{ padding: '1.25rem', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.9rem' }}>
                                                    {day.summary || "Día de recuperación total."}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};

export default TrainingPlanner;
