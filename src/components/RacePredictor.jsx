import React, { useState, useEffect } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

const RacePredictor = ({ activities }) => {
    // Provider state: 'gemini' or 'groq'
    const [provider, setProvider] = useState('groq');

    /* Logic to share keys with TrainingPlanner via localStorage */
    const [apiKeys, setApiKeys] = useState(() => {
        return {
            gemini: localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '',
            groq: localStorage.getItem('groq_api_key') || import.meta.env.VITE_GROQ_API_KEY || ''
        };
    });

    const [selectedModel, setSelectedModel] = useState('llama-3.1-8b-instant');
    const [loading, setLoading] = useState(false);
    const [predictions, setPredictions] = useState(null);
    const [error, setError] = useState('');
    const [analysis, setAnalysis] = useState('');

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
        <div className="predictor-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <h3 className="section-title">🧬 Predictor Biométrico AI</h3>

                    {/* Provider Selector Switch */}
                    <div style={{ display: 'flex', background: 'var(--bg-card)', borderRadius: '20px', padding: '2px', border: '1px solid var(--border-color)' }}>
                        <button
                            onClick={() => setProvider('groq')}
                            style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '18px',
                                border: 'none',
                                background: provider === 'groq' ? '#f97316' : 'transparent',
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
                                background: provider === 'gemini' ? '#3b82f6' : 'transparent',
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
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: '1rem', fontStyle: 'italic' }}>
                    {provider === 'groq'
                        ? <span>* Consigue tu API Key (14k req/día) en <a href="https://console.groq.com/keys" target="_blank" style={{ textDecoration: 'underline', color: '#f97316' }}>Groq Console</a>.</span>
                        : <span>* Consigue tu API Key en <a href="https://aistudio.google.com/app/apikey" target="_blank" style={{ textDecoration: 'underline' }}>Google AI Studio</a>.</span>
                    }
                </div>
            )}

            {/* Model Selector */}
            <div style={{ marginBottom: '1.5rem', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
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

            {!predictions && !loading && (
                <div style={{ textAlign: 'center', padding: '3rem', background: 'var(--bg-card)', borderRadius: '12px', border: 'var(--border-light)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔮</div>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                        Analiza tus últimas carreras (3 meses) con Inteligencia Artificial para obtener predicciones realistas.
                    </p>
                    <button
                        onClick={generateAIPrediction}
                        className="avatar-btn"
                        style={{
                            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                            color: 'white',
                            padding: '0.75rem 2rem',
                            borderRadius: '100px',
                            fontWeight: 'bold',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        Generar Predicción IA
                    </button>
                    {error && <div style={{ color: '#ef4444', marginTop: '1rem', fontSize: '0.9rem' }}>{error}</div>}
                </div>
            )}

            {loading && (
                <div style={{
                    height: '300px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    color: 'var(--accent-primary)',
                    gap: '1rem'
                }}>
                    <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid var(--bg-main)', borderTop: '3px solid var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                    <div>Analizando biomecánica y fatiga reciente...</div>
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </div>
            )}

            {predictions && (
                <div className="fade-in">
                    {/* Analysis Banner */}
                    {analysis && (
                        <div style={{
                            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                            borderRadius: '16px',
                            padding: '1.5rem',
                            marginBottom: '2rem',
                            color: 'white',
                            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
                            display: 'flex',
                            gap: '1rem',
                            alignItems: 'flex-start'
                        }}>
                            <div style={{ fontSize: '2rem', flexShrink: 0 }}>🤖</div>
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Análisis Biomecánico AI</div>
                                <div style={{ fontSize: '0.95rem', lineHeight: '1.6' }}>{analysis}</div>
                            </div>
                        </div>
                    )}

                    {/* Predictions Grid with Enhanced Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
                        {predictions.map((pred, idx) => {
                            // Calculate predicted pace in seconds for comparison
                            const [paceMin, paceSec] = pred.pace.split(':').map(Number);
                            const paceInSeconds = paceMin * 60 + (paceSec || 0);

                            // Distance mapping
                            const distanceKm = pred.label === '5K' ? 5 : pred.label === '10K' ? 10 : pred.label === 'Media Maratón' ? 21.097 : 42.195;

                            // Calculate total seconds
                            const timeParts = pred.time.split(':');
                            const totalSeconds = timeParts.length === 3
                                ? parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseInt(timeParts[2])
                                : parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);

                            return (
                                <div key={idx} style={{
                                    background: 'var(--bg-card)',
                                    borderRadius: '16px',
                                    padding: '1.5rem',
                                    boxShadow: 'var(--shadow-md)',
                                    border: '2px solid',
                                    borderColor: pred.confidence === 'Alta' ? '#22c55e' : pred.confidence === 'Baja' ? '#ef4444' : '#eab308',
                                    animation: 'fadeIn 0.5s ease-in-out',
                                    animationDelay: `${idx * 100}ms`,
                                    animationFillMode: 'backwards',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}>
                                    {/* Confidence Badge */}
                                    <div style={{
                                        position: 'absolute',
                                        top: '0.75rem',
                                        right: '0.75rem',
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '12px',
                                        fontSize: '0.65rem',
                                        fontWeight: 'bold',
                                        background: pred.confidence === 'Alta' ? 'rgba(34, 197, 94, 0.2)' : pred.confidence === 'Baja' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                                        color: pred.confidence === 'Alta' ? '#22c55e' : pred.confidence === 'Baja' ? '#ef4444' : '#eab308',
                                        textTransform: 'uppercase'
                                    }}>
                                        {pred.confidence === 'Alta' ? '✅' : pred.confidence === 'Baja' ? '⚠️' : '📊'} {pred.confidence}
                                    </div>

                                    {/* Distance Label */}
                                    <div style={{
                                        fontSize: '1.5rem',
                                        fontWeight: '900',
                                        color: 'var(--accent-primary)',
                                        marginBottom: '1rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}>
                                        {pred.label === '5K' ? '🏃' : pred.label === '10K' ? '🏃‍♂️' : pred.label === 'Media Maratón' ? '🏅' : '🏆'}
                                        {pred.label}
                                    </div>

                                    {/* Main Time */}
                                    <div style={{
                                        fontSize: '2.5rem',
                                        fontWeight: '900',
                                        fontFamily: 'monospace',
                                        color: 'var(--text-primary)',
                                        marginBottom: '0.5rem',
                                        lineHeight: 1
                                    }}>
                                        {pred.time}
                                    </div>

                                    {/* Pace */}
                                    <div style={{
                                        fontSize: '1.1rem',
                                        fontFamily: 'monospace',
                                        color: 'var(--text-secondary)',
                                        marginBottom: '1rem'
                                    }}>
                                        📊 {pred.pace} /km
                                    </div>

                                    {/* Additional Stats */}
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: '0.75rem',
                                        padding: '1rem',
                                        background: 'var(--bg-main)',
                                        borderRadius: '12px',
                                        fontSize: '0.75rem'
                                    }}>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Distancia</div>
                                            <div style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{distanceKm.toFixed(2)} km</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Velocidad</div>
                                            <div style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{(distanceKm / (totalSeconds / 3600)).toFixed(2)} km/h</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Total Pasos*</div>
                                            <div style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{Math.round(distanceKm * 1300)}</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Cadencia**</div>
                                            <div style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>~170-180 spm</div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Comparative Analysis */}
                    <div style={{
                        background: 'var(--bg-card)',
                        borderRadius: '16px',
                        padding: '1.5rem',
                        boxShadow: 'var(--shadow-md)',
                        marginBottom: '2rem'
                    }}>
                        <h4 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
                            📈 Análisis Comparativo de Ritmos
                        </h4>

                        {/* Pace Comparison Bars */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {predictions.map((pred, idx) => {
                                const [paceMin, paceSec] = pred.pace.split(':').map(Number);
                                const paceInSeconds = paceMin * 60 + (paceSec || 0);
                                const maxPace = Math.max(...predictions.map(p => {
                                    const [m, s] = p.pace.split(':').map(Number);
                                    return m * 60 + (s || 0);
                                }));
                                const percentage = (paceInSeconds / maxPace) * 100;

                                return (
                                    <div key={idx}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
                                            <span style={{ fontWeight: 'bold' }}>{pred.label}</span>
                                            <span style={{ fontFamily: 'monospace', color: 'var(--accent-primary)' }}>{pred.pace} /km</span>
                                        </div>
                                        <div style={{
                                            height: '32px',
                                            background: 'var(--bg-main)',
                                            borderRadius: '8px',
                                            overflow: 'hidden',
                                            position: 'relative'
                                        }}>
                                            <div style={{
                                                width: `${percentage}%`,
                                                height: '100%',
                                                background: `linear-gradient(90deg, ${idx === 0 ? '#ef4444' : idx === 1 ? '#f59e0b' : idx === 2 ? '#3b82f6' : '#8b5cf6'
                                                    }, ${idx === 0 ? '#dc2626' : idx === 1 ? '#d97706' : idx === 2 ? '#2563eb' : '#7c3aed'
                                                    })`,
                                                transition: 'width 1s ease',
                                                display: 'flex',
                                                alignItems: 'center',
                                                paddingLeft: '1rem',
                                                color: 'white',
                                                fontSize: '0.75rem',
                                                fontWeight: 'bold'
                                            }}>
                                                {paceMin}:{String(paceSec || 0).padStart(2, '0')}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Riegel Formula Validation */}
                    <div style={{
                        background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
                        borderRadius: '16px',
                        padding: '1.5rem',
                        marginBottom: '2rem'
                    }}>
                        <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem', color: 'var(--text-primary)' }}>
                            🔬 Validación Fórmula de Riegel
                        </h4>
                        <div style={{ fontSize: '0.8rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                            <p style={{ marginBottom: '0.75rem' }}>
                                <strong style={{ color: 'var(--text-primary)' }}>Fórmula:</strong> T2 = T1 × (D2/D1)^1.06
                            </p>
                            <p>
                                Las predicciones AI consideran tu historial de <strong>fatiga</strong>, <strong>desnivel acumulado</strong>,
                                y <strong>datos de FC</strong> para ajustes más precisos que la fórmula estándar de Riegel.
                            </p>
                        </div>
                    </div>

                    {/* Training Zones Recommendation */}
                    <div style={{
                        background: 'var(--bg-card)',
                        borderRadius: '16px',
                        padding: '1.5rem',
                        boxShadow: 'var(--shadow-md)',
                        marginBottom: '2rem'
                    }}>
                        <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem' }}>
                            🎯 Zonas de Entrenamiento Recomendadas (VDOT)
                        </h4>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', fontSize: '0.75rem' }}>
                            {predictions[1] && (() => {
                                const [paceMin, paceSec] = predictions[1].pace.split(':').map(Number);
                                const basePaceSeconds = paceMin * 60 + (paceSec || 0);

                                return (
                                    <>
                                        <div style={{ padding: '1rem', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '8px', border: '1px solid #22c55e' }}>
                                            <div style={{ fontWeight: 'bold', color: '#22c55e', marginBottom: '0.5rem' }}>✅ Easy (Z2)</div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '1rem' }}>
                                                {Math.floor((basePaceSeconds + 90) / 60)}:{String(Math.round((basePaceSeconds + 90) % 60)).padStart(2, '0')}
                                            </div>
                                            <div style={{ opacity: 0.7, marginTop: '0.25rem' }}>Conversacional</div>
                                        </div>
                                        <div style={{ padding: '1rem', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px', border: '1px solid #f59e0b' }}>
                                            <div style={{ fontWeight: 'bold', color: '#f59e0b', marginBottom: '0.5rem' }}>⚡ Threshold (Z4)</div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '1rem' }}>
                                                {Math.floor((basePaceSeconds + 20) / 60)}:{String(Math.round((basePaceSeconds + 20) % 60)).padStart(2, '0')}
                                            </div>
                                            <div style={{ opacity: 0.7, marginTop: '0.25rem' }}>Umbral</div>
                                        </div>
                                        <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid #ef4444' }}>
                                            <div style={{ fontWeight: 'bold', color: '#ef4444', marginBottom: '0.5rem' }}>🔥 Interval (Z5)</div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '1rem' }}>
                                                {Math.floor((basePaceSeconds - 15) / 60)}:{String(Math.round((basePaceSeconds - 15) % 60)).padStart(2, '0')}
                                            </div>
                                            <div style={{ opacity: 0.7, marginTop: '0.25rem' }}>VO2max</div>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>

                        <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', fontSize: '0.7rem', lineHeight: '1.4' }}>
                            <strong style={{ color: '#3b82f6' }}>💡 Consejo:</strong> Usa estas zonas basadas en tu ritmo de 10K predicho para entrenamientos específicos.
                            Recuerda: 80% del volumen debe ser en zona Easy.
                        </div>
                    </div>

                    {/* Footer Notes */}
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: '1.4', marginTop: '1.5rem' }}>
                        <div>* Estimación basada en ~1300 pasos/km (promedio corredor)</div>
                        <div>** Cadencia óptima varía individualmente (165-185 spm típicamente)</div>
                    </div>

                    <button
                        onClick={generateAIPrediction}
                        style={{
                            marginTop: '2rem',
                            width: '100%',
                            padding: '1rem',
                            color: 'var(--text-muted)',
                            fontSize: '0.8rem',
                            textDecoration: 'underline',
                            cursor: 'pointer'
                        }}
                    >
                        ↻ Recalcular Predicciones
                    </button>
                </div>
            )}
        </div>
    );
};

export default RacePredictor;
