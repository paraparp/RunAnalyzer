import React, { useState, useRef, useEffect, useMemo } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { streamAI } from '../services/ai';
import { Card, Text, Button, Select, SelectItem, Badge } from "@tremor/react";
import { PaperAirplaneIcon, ChatBubbleLeftRightIcon, SparklesIcon, TrashIcon, BoltIcon, ClipboardDocumentIcon, CheckIcon, ArrowPathIcon, StopIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, ChevronDownIcon, CheckCircleIcon, Cog6ToothIcon } from "@heroicons/react/24/solid";
import ModelSelector, { DEFAULT_GEMINI_MODEL } from './ModelSelector';
import { paceStr } from '../lib/aiInsights';

// Renderiza diagramas mermaid con carga bajo demanda; si falla (o el código
// aún está incompleto durante el streaming) muestra el código como fallback
const MermaidDiagram = ({ code }) => {
    const [svg, setSvg] = useState(null);
    const [error, setError] = useState(false);
    const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 10)}`);

    useEffect(() => {
        let cancelled = false;
        setError(false);
        Promise.all([import('mermaid'), import('dompurify')])
            .then(async ([{ default: mermaid }, { default: DOMPurify }]) => {
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'neutral',
                    securityLevel: 'strict',
                    flowchart: { htmlLabels: false },
                });
                try {
                    const { svg: rendered } = await mermaid.render(idRef.current, code);
                    const clean = DOMPurify.sanitize(rendered, {
                        USE_PROFILES: { svg: true, svgFilters: true },
                        ADD_TAGS: ['style'],
                    });
                    if (!cancelled) setSvg(clean);
                } catch {
                    if (!cancelled) setError(true);
                }
            })
            .catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; };
    }, [code]);

    if (error || !svg) {
        return (
            <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 my-3 overflow-x-auto text-xs font-mono text-slate-600">
                <code>{code}</code>
            </pre>
        );
    }
    return (
        <div
            className="my-3 flex justify-center overflow-x-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
};

// Simple markdown parser component
const MarkdownText = ({ content }) => {
    const parsedContent = useMemo(() => {
        if (!content) return [];

        const lines = content.split('\n');
        const elements = [];
        let listItems = [];
        let listType = null;
        let tableRows = [];
        let olCounter = 0;
        let inCodeBlock = false;
        let codeLang = '';
        let codeLines = [];

        const parseInline = (text) => {
            const parts = [];
            let key = 0;
            let lastIndex = 0;
            const regex = /\*\*(.+?)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*/g;
            let m;

            while ((m = regex.exec(text)) !== null) {
                if (m.index > lastIndex) {
                    parts.push(<span key={key++}>{text.slice(lastIndex, m.index)}</span>);
                }
                if (m[1] !== undefined) {
                    parts.push(<strong key={key++} className="font-semibold text-slate-900">{m[1]}</strong>);
                } else if (m[2] !== undefined) {
                    parts.push(
                        <code key={key++} className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs font-mono">
                            {m[2]}
                        </code>
                    );
                } else {
                    parts.push(<em key={key++} className="italic">{m[3]}</em>);
                }
                lastIndex = m.index + m[0].length;
            }

            if (lastIndex < text.length) {
                parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
            }

            return parts.length > 0 ? parts : text;
        };

        const flushList = () => {
            if (listItems.length > 0) {
                if (listType === 'ol') {
                    elements.push(
                        <ol key={elements.length} className="list-decimal list-outside ml-5 space-y-1.5 my-3 text-slate-700">
                            {listItems.map((item, i) => (
                                <li key={i} value={item.value} className="leading-relaxed pl-1">{parseInline(item.text)}</li>
                            ))}
                        </ol>
                    );
                } else {
                    elements.push(
                        <ul key={elements.length} className="list-disc list-outside ml-5 space-y-1.5 my-3 text-slate-700">
                            {listItems.map((item, i) => (
                                <li key={i} className="leading-relaxed pl-1">{parseInline(item)}</li>
                            ))}
                        </ul>
                    );
                }
                listItems = [];
                listType = null;
            }
        };

        const flushTable = () => {
            if (tableRows.length > 0) {
                const [header, ...body] = tableRows;
                elements.push(
                    <div key={elements.length} className="overflow-x-auto my-3">
                        <table className="min-w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
                            <thead className="bg-slate-50">
                                <tr>
                                    {header.map((cell, i) => (
                                        <th key={i} className="px-3 py-2 text-left font-semibold text-slate-800 border-b border-slate-200">
                                            {parseInline(cell)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {body.map((row, r) => (
                                    <tr key={r} className={r % 2 === 1 ? 'bg-slate-50/50' : ''}>
                                        {row.map((cell, c) => (
                                            <td key={c} className="px-3 py-2 text-slate-700 border-b border-slate-100 align-top">
                                                {parseInline(cell)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
                tableRows = [];
            }
        };

        const flushCode = () => {
            const codeText = codeLines.join('\n');
            if (codeLang === 'mermaid') {
                elements.push(<MermaidDiagram key={elements.length} code={codeText} />);
            } else {
                elements.push(
                    <pre key={elements.length} className="bg-slate-50 border border-slate-200 rounded-lg p-3 my-3 overflow-x-auto text-xs font-mono text-slate-700 leading-snug">
                        <code>{codeText}</code>
                    </pre>
                );
            }
            inCodeBlock = false;
            codeLang = '';
            codeLines = [];
        };

        lines.forEach((line, idx) => {
            const trimmedLine = line.trim();

            if (inCodeBlock) {
                if (trimmedLine.startsWith('```')) {
                    flushCode();
                } else {
                    codeLines.push(line);
                }
                return;
            }

            if (trimmedLine.startsWith('```')) {
                flushList();
                flushTable();
                olCounter = 0;
                inCodeBlock = true;
                codeLang = trimmedLine.slice(3).trim().toLowerCase();
                codeLines = [];
                return;
            }

            if (!trimmedLine) {
                flushList();
                flushTable();
                return;
            }

            if (trimmedLine.startsWith('|') && trimmedLine.includes('|', 1)) {
                flushList();
                // Fila separadora tipo |:---|---| — se ignora
                if (/^\|[\s:|-]+\|$/.test(trimmedLine)) return;
                const cells = trimmedLine.split('|').slice(1, -1).map(c => c.trim());
                if (cells.length > 0) {
                    tableRows.push(cells);
                    return;
                }
            }
            flushTable();

            if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
                flushList();
                flushTable();
                olCounter = 0;
                elements.push(<hr key={idx} className="my-3 border-slate-200" />);
                return;
            }

            const ulMatch = trimmedLine.match(/^[\*\-]\s+(.+)/);
            if (ulMatch) {
                if (listType && listType !== 'ul') flushList();
                listType = 'ul';
                listItems.push(ulMatch[1]);
                return;
            }

            const olMatch = trimmedLine.match(/^(\d+)\.\s+(.+)/);
            if (olMatch) {
                if (listType && listType !== 'ol') flushList();
                listType = 'ol';
                // Continúa la numeración si el modelo repite "1." tras viñetas intermedias
                const num = parseInt(olMatch[1], 10);
                const value = num > olCounter ? num : olCounter + 1;
                olCounter = value;
                listItems.push({ value, text: olMatch[2] });
                return;
            }

            flushList();
            olCounter = 0;

            const h4Match = trimmedLine.match(/^#{4,6}\s+(.+)/);
            if (h4Match) {
                elements.push(
                    <h5 key={idx} className="font-semibold text-slate-800 mt-3 mb-1.5 text-sm">
                        {parseInline(h4Match[1])}
                    </h5>
                );
                return;
            }
            if (trimmedLine.startsWith('### ')) {
                elements.push(
                    <h4 key={idx} className="font-bold text-slate-800 mt-4 mb-2 text-sm uppercase tracking-wide">
                        {parseInline(trimmedLine.slice(4))}
                    </h4>
                );
                return;
            }
            if (trimmedLine.startsWith('## ')) {
                elements.push(
                    <h3 key={idx} className="font-bold text-slate-900 text-base mt-4 mb-2">
                        {parseInline(trimmedLine.slice(3))}
                    </h3>
                );
                return;
            }
            if (trimmedLine.startsWith('# ')) {
                elements.push(
                    <h2 key={idx} className="font-bold text-slate-900 text-lg mt-4 mb-2">
                        {parseInline(trimmedLine.slice(2))}
                    </h2>
                );
                return;
            }

            elements.push(
                <p key={idx} className="leading-relaxed text-slate-700 my-1.5">
                    {parseInline(trimmedLine)}
                </p>
            );
        });

        if (inCodeBlock) flushCode();
        flushList();
        flushTable();
        return elements;
    }, [content]);

    return <div className="space-y-0.5">{parsedContent}</div>;
};

// Typing indicator component
const TypingIndicator = () => (
    <div className="flex items-center gap-1 px-2 py-1">
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
);

// Convierte el análisis del panel (AIInsights) en texto markdown reutilizable
// tanto para la tarjeta de contexto visible como para el system prompt del chat.
const seedToText = (seed) => {
    if (!seed?.blocks) return '';
    const b = seed.blocks;
    const s = seed.sci;
    const lines = [];
    if (b.cur) lines.push(`**Estado actual**\n${b.cur}`);
    if (b.trend) lines.push(`**Tendencia y patrón**\n${b.trend}`);
    if (b.nextWork) lines.push(`**Sesión recomendada**\n${b.nextWork}`);
    if (b.lastWork) lines.push(`**Análisis del último entrenamiento**\n${b.lastWork}`);
    if (s) {
        const parts = [];
        if (s.readiness != null) parts.push(`Readiness ${s.readiness}/100${s.readinessLabel ? ` (${s.readinessLabel})` : ''}`);
        if (s.ctl != null) parts.push(`CTL ${s.ctl}`);
        if (s.atl != null) parts.push(`ATL ${s.atl}`);
        if (s.tsb != null) parts.push(`TSB ${s.tsb > 0 ? '+' : ''}${s.tsb}`);
        if (s.acwr != null) parts.push(`ACWR ${s.acwr}`);
        if (s.fcmax != null) parts.push(`FCmax ${s.fcmax}ppm`);
        if (s.lthr != null) parts.push(`LTHR ${s.lthr}ppm`);
        if (s.fcRest != null) parts.push(`FC reposo ${s.fcRest}ppm`);
        if (parts.length) lines.push(`**Métricas clave:** ${parts.join(' · ')}`);
    }
    return lines.join('\n\n');
};

const RunQA = ({ activities }) => {
    const [question, setQuestion] = useState('');
    const [numRaces, setNumRaces] = useState('10');
    const [filterMode, setFilterMode] = useState('count'); // 'count' | 'period'
    const [selectedPeriod, setSelectedPeriod] = useState('30d');
    const [garmin, setGarmin] = useState(null);
    const [garminPeriod, setGarminPeriod] = useState('none'); // 'none' | '30d' | '90d'
    const [loading, setLoading] = useState(false);
    const [conversation, setConversation] = useState([]);
    const [seed, setSeed] = useState(null);
    const [pendingAsk, setPendingAsk] = useState(null); // pregunta auto-lanzada al llegar con foco desde el panel
    const autoAskedRef = useRef(false);
    const [error, setError] = useState('');
    const provider = 'gemini'; // chat usa exclusivamente Google Gemini
    const [selectedModel, setSelectedModel] = useState(() => cloudStorage.getItem('runqa_model') || DEFAULT_GEMINI_MODEL);
    const [copiedIdx, setCopiedIdx] = useState(null);
    const [fullscreen, setFullscreen] = useState(false);
    const [seedOpen, setSeedOpen] = useState(false);
    // En móvil los controles de configuración van plegados para no comerse la pantalla
    const [configOpen, setConfigOpen] = useState(false);
    // En pantallas táctiles Enter hace salto de línea; se envía con el botón
    const isTouch = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches, []);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const abortRef = useRef(null);

    // Persist the model choice across sessions.
    useEffect(() => { try { cloudStorage.setItem('runqa_model', selectedModel); } catch {} }, [selectedModel]);
    // Abort any in-flight stream on unmount.
    useEffect(() => () => abortRef.current?.abort(), []);

    // Fullscreen: bloquea el scroll del body y permite salir con Escape.
    useEffect(() => {
        if (!fullscreen) return;
        const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [fullscreen]);

    // Recoge el análisis del panel (AIInsights) si el usuario llegó vía "Seguir
    // preguntando en el chat". Se consume una sola vez y se inyecta como contexto.
    useEffect(() => {
        try {
            const s = cloudStorage.getItem('runqa_seed');
            if (s) {
                const parsed = JSON.parse(s);
                if (parsed?.blocks) {
                    setSeed(parsed);
                    // Si el usuario pulsó "Ampliar" en una sección concreta, el seed
                    // trae la pregunta lista para lanzarse sola al abrir el chat.
                    if (parsed.ask) setPendingAsk(parsed.ask);
                }
                cloudStorage.removeItem('runqa_seed');
            }
        } catch {}
    }, []);

    useEffect(() => {
        try {
            const s = cloudStorage.getItem('garmin_cardiac_data');
            if (s) { setGarmin(JSON.parse(s)); return; }
        } catch {}
        fetch('/garmin_data.json')
            .then(r => r.ok ? r.json() : null)
            .then(j => setGarmin(j?.data ?? null))
            .catch(() => setGarmin(null));
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [conversation, loading]);

    const periodDays = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
    const periodLabels = { '7d': 'última semana', '30d': 'último mes', '90d': 'últimos 3 meses', '180d': 'últimos 6 meses', '365d': 'último año' };

    const getSelectedActivities = () => {
        if (!activities || activities.length === 0) return [];
        const sorted = [...activities].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
        if (filterMode === 'period') {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - periodDays[selectedPeriod]);
            return sorted.filter(a => new Date(a.start_date) >= cutoff);
        }
        return sorted.slice(0, parseInt(numRaces));
    };

    const formatActivitiesForPrompt = (acts) => {
        return acts.map((a, idx) => {
            const distKm = (a.distance / 1000).toFixed(2);
            const timeMin = Math.floor(a.moving_time / 60);
            const timeSec = a.moving_time % 60;
            // Ritmo en M:SS (el decimal "5.32 min/km" se presta a leerse como 5:32)
            // y con guard: una actividad manual sin distancia no debe meter Infinity.
            const pace = a.distance > 0 && a.moving_time > 0
                ? `${paceStr((a.moving_time / 60) / (a.distance / 1000))} min/km`
                : 'n/d';
            const date = new Date(a.start_date).toLocaleDateString('es-ES', {
                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
            });
            const extras = [];
            if (a.average_heartrate) extras.push(`FC: ${Math.round(a.average_heartrate)} ppm`);
            if (a.total_elevation_gain) extras.push(`Desnivel: +${Math.round(a.total_elevation_gain)}m`);
            if (a.max_speed) extras.push(`Vel. máx: ${(a.max_speed * 3.6).toFixed(1)} km/h`);
            if (a.average_cadence) extras.push(`Cadencia: ${Math.round(a.average_cadence * 2)} spm`);
            return `${idx + 1}. "${a.name}" - ${date}
   • Distancia: ${distKm} km | Tiempo: ${timeMin}:${timeSec.toString().padStart(2, '0')} | Ritmo: ${pace}${extras.length ? '\n   • ' + extras.join(' | ') : ''}`;
        }).join('\n\n');
    };

    const formatGarminForPrompt = () => {
        if (!garmin?.length || garminPeriod === 'none') return null;
        const days = garminPeriod === '30d' ? 30 : 90;
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
        const filtered = [...garmin]
            .filter(d => new Date(d.date) >= cutoff)
            .sort((a, b) => b.date.localeCompare(a.date));
        if (!filtered.length) return null;
        const lines = filtered.map(d => {
            const parts = [d.date.slice(5)];
            if (d.hrv)        parts.push(`VFC=${d.hrv}ms`);
            if (d.restingHR)  parts.push(`RHR=${d.restingHR}ppm`);
            if (d.hrvStatus)  parts.push(`[${d.hrvStatus}]`);
            if (d.sleepHours) parts.push(`sueño=${d.sleepHours}h`);
            if (d.stress)     parts.push(`estrés=${d.stress}`);
            return parts.join(' ');
        });
        return `DATOS GARMIN (últimos ${days} días):\n${lines.join('\n')}`;
    };

    const buildSystemPrompt = (selectedActs) => {
        const activitiesText = formatActivitiesForPrompt(selectedActs);
        const garminText = formatGarminForPrompt();
        return `Eres un analista experto de running y entrenamiento deportivo.
El usuario te proporcionará sus últimas carreras/entrenamientos y te hará preguntas sobre ellas.

HOY ES: ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Usa esta fecha como referencia para "esta semana", "último mes", etc.

DATOS DE LAS ÚLTIMAS ${selectedActs.length} CARRERAS/ENTRENAMIENTOS:
${activitiesText}
${garminText ? '\n' + garminText : ''}
${seed ? `\nANÁLISIS PREVIO DEL PANEL DE IA (el usuario viene de aquí; sus preguntas son SEGUIMIENTO de este diagnóstico — trátalo como contexto principal y mantén coherencia con él):\n${seedToText(seed)}\n` : ''}
INSTRUCCIONES:
- Responde de forma clara, directa y útil
- Usa SOLO los datos proporcionados para dar respuestas precisas; si un dato no está en ellos, dilo claramente en lugar de estimarlo o inventarlo
- Si necesitas hacer cálculos (promedios, tendencias, etc.), hazlos con las cifras exactas de los datos
- Puedes dar recomendaciones basadas en los datos
- Responde en el mismo idioma en el que pregunta el usuario (por defecto, español)
- Sé conciso pero completo
- Usa formato markdown: **negrita** para destacar, listas con - o números`;
    };

    // Core: stream a response for the given history (which must end with a user
    // turn). Shared by submit, suggestion chips and regenerate.
    const runQuery = async (history) => {
        const selectedActs = getSelectedActivities();
        if (selectedActs.length === 0) {
            setError('No hay carreras disponibles para analizar.');
            return;
        }

        setLoading(true);
        setError('');
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const messages = [
                { role: 'system', content: buildSystemPrompt(selectedActs) },
                ...history.map(m => ({ role: m.role, content: m.content })),
            ];

            setConversation(prev => [...prev, { role: 'assistant', content: '', timestamp: new Date() }]);
            const onChunk = (_chunk, aiContent) => {
                setConversation(prev => {
                    const next = [...prev];
                    next[next.length - 1] = { ...next[next.length - 1], content: aiContent };
                    return next;
                });
            };

            // Cadena de proveedores (misma que el resto de herramientas IA):
            // Gemini primero y, si falla (p. ej. 429 de cuota), Groq. El abort
            // del usuario se propaga tal cual y conserva el texto parcial.
            const chain = [
                { provider, model: selectedModel },
                { provider: 'groq', model: 'llama-3.3-70b-versatile' },
            ];
            let full = '';
            let primaryErr = null;
            for (const step of chain) {
                if (controller.signal.aborted) break;
                try {
                    onChunk(null, ''); // limpia el parcial del intento anterior
                    full = await streamAI(
                        { provider: step.provider, model: step.model, messages, temperature: 0.7, signal: controller.signal },
                        onChunk
                    );
                    primaryErr = null;
                    break;
                } catch (e) {
                    if (e?.name === 'AbortError') throw e;
                    if (!primaryErr) primaryErr = e;
                }
            }
            if (primaryErr) throw primaryErr;
            // Si el stream terminó sin texto (p. ej. corte del servidor a mitad),
            // no dejamos una burbuja vacía: la quitamos y avisamos.
            if (!full.trim() && !controller.signal.aborted) {
                setConversation(prev => {
                    const next = [...prev];
                    if (next[next.length - 1]?.role === 'assistant' && !next[next.length - 1].content) next.pop();
                    return next;
                });
                setError('La respuesta se interrumpió. Inténtalo de nuevo o cambia de modelo.');
            }
        } catch (err) {
            if (err?.name === 'AbortError' || /abort/i.test(err?.message || '')) {
                // user stopped the stream — keep whatever streamed so far
            } else {
                console.error('Error en la consulta:', err);
                setError(`Error: ${err.message}`);
                // No dejes la burbuja del asistente vacía si nadie respondió.
                setConversation(prev => {
                    const next = [...prev];
                    if (next[next.length - 1]?.role === 'assistant' && !next[next.length - 1].content) next.pop();
                    return next;
                });
            }
        } finally {
            setLoading(false);
            abortRef.current = null;
            inputRef.current?.focus();
        }
    };

    const handleSubmit = (e) => {
        e?.preventDefault?.();
        const q = question.trim();
        if (!q || loading) return;
        const newHistory = [...conversation, { role: 'user', content: q, timestamp: new Date() }];
        setQuestion('');
        if (inputRef.current) inputRef.current.style.height = 'auto';
        setConversation(newHistory);
        runQuery(newHistory);
    };

    const sendSuggestion = (text) => {
        if (loading) return;
        const newHistory = [...conversation, { role: 'user', content: text, timestamp: new Date() }];
        setConversation(newHistory);
        runQuery(newHistory);
    };

    // Lanza automáticamente la pregunta de ampliación que llegó con el seed
    // (botón "Ampliar" de una sección del panel de IA). El ref evita el doble
    // disparo del StrictMode en desarrollo.
    useEffect(() => {
        if (!pendingAsk || loading || autoAskedRef.current) return;
        if (!activities?.length) return;
        autoAskedRef.current = true;
        setPendingAsk(null);
        sendSuggestion(pendingAsk);
    }, [pendingAsk, loading, activities]); // eslint-disable-line react-hooks/exhaustive-deps

    const stopGeneration = () => abortRef.current?.abort();

    const regenerate = () => {
        if (loading) return;
        const conv = [...conversation];
        while (conv.length && conv[conv.length - 1].role === 'assistant') conv.pop();
        if (!conv.length) return;
        setConversation(conv);
        runQuery(conv);
    };

    const copyMessage = async (text, idx) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedIdx(idx);
            setTimeout(() => setCopiedIdx(c => (c === idx ? null : c)), 1500);
        } catch {}
    };

    const clearConversation = () => {
        abortRef.current?.abort();
        setConversation([]);
        setError('');
    };

    const suggestedQuestions = seed
        ? [
            { text: "¿Por qué me recomiendas esa sesión y no intervalos?", icon: "🤔" },
            { text: "¿Cómo subo volumen sin pasarme de carga?", icon: "📈" },
            { text: "¿Llego en forma al maratón con esta tendencia?", icon: "🎯" },
            { text: "Explícame mi readiness y mi forma (TSB) actual", icon: "🔋" }
        ]
        : [
            { text: "¿Cuál fue mi mejor carrera?", icon: "🏆" },
            { text: "¿Cómo ha evolucionado mi ritmo?", icon: "📈" },
            { text: "¿Cuál es mi distancia promedio?", icon: "📊" },
            { text: "Dame un resumen de mi entrenamiento", icon: "📋" }
        ];

    const selectedCount = getSelectedActivities().length;

    return (
        <div className={fullscreen
            ? 'fixed inset-0 z-50 bg-slate-100 p-2 sm:p-4 flex flex-col gap-2 sm:gap-3 overflow-hidden'
            : 'flex flex-col gap-2 sm:gap-3 flex-1 min-h-0'}>
            {/* Compact Header — mismo lenguaje visual que el módulo Coach IA */}
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shrink-0 px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="absolute inset-x-0 top-0 h-[3px] kinetic-gradient" />
                <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="hidden sm:flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 text-blue-600 shrink-0">
                            <ChatBubbleLeftRightIcon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-black uppercase tracking-tight text-slate-800 leading-tight truncate">Pregunta sobre tus Carreras</p>
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600">
                                <BoltIcon className="w-3 h-3" />
                                {selectedCount} carreras cargadas
                            </span>
                        </div>
                        {/* Ajustes: solo visible bajo lg, despliega los controles */}
                        <button
                            type="button"
                            onClick={() => setConfigOpen(o => !o)}
                            title="Configuración del chat"
                            className={`ml-auto lg:hidden flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${configOpen
                                ? 'text-blue-700 bg-blue-50 border-blue-200'
                                : 'text-slate-600 bg-white border-slate-200 hover:border-blue-300 hover:text-blue-700'}`}
                        >
                            <Cog6ToothIcon className="w-4 h-4" />
                            <ChevronDownIcon className={`w-3 h-3 transition-transform ${configOpen ? 'rotate-180' : ''}`} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setFullscreen(f => !f)}
                            title={fullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'}
                            className="lg:ml-1 flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50/60 transition-colors"
                        >
                            {fullscreen
                                ? <ArrowsPointingInIcon className="w-3.5 h-3.5" />
                                : <ArrowsPointingOutIcon className="w-3.5 h-3.5" />}
                            <span className="hidden sm:inline">{fullscreen ? 'Reducir' : 'Ampliar'}</span>
                        </button>
                    </div>

                    <div className={`${configOpen ? 'flex' : 'hidden'} lg:flex flex-wrap items-center gap-2`}>
                        {/* Filter mode toggle + selector */}
                        {/* Toggle buttons */}
                        <div className="flex rounded-lg overflow-hidden border border-slate-200 text-[11px] font-medium flex-shrink-0">
                            <button
                                onClick={() => setFilterMode('count')}
                                className={`px-2.5 py-1.5 transition-colors ${filterMode === 'count' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                                Por número
                            </button>
                            <button
                                onClick={() => setFilterMode('period')}
                                className={`px-2.5 py-1.5 transition-colors ${filterMode === 'period' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                                Por periodo
                            </button>
                        </div>

                        {filterMode === 'count' ? (
                            <Select value={numRaces} onValueChange={setNumRaces} enableClear={false} className="w-32">
                                <SelectItem value="5">Últimas 5</SelectItem>
                                <SelectItem value="10">Últimas 10</SelectItem>
                                <SelectItem value="20">Últimas 20</SelectItem>
                                <SelectItem value="30">Últimas 30</SelectItem>
                                <SelectItem value="50">Últimas 50</SelectItem>
                            </Select>
                        ) : (
                            <Select value={selectedPeriod} onValueChange={setSelectedPeriod} enableClear={false} className="w-40">
                                <SelectItem value="7d">Última semana</SelectItem>
                                <SelectItem value="30d">Último mes</SelectItem>
                                <SelectItem value="90d">Últimos 3 meses</SelectItem>
                                <SelectItem value="180d">Últimos 6 meses</SelectItem>
                                <SelectItem value="365d">Último año</SelectItem>
                            </Select>
                        )}

                        <ModelSelector
                            selectedModel={selectedModel}
                            setSelectedModel={setSelectedModel}
                            disabled={loading}
                            showLabel={false}
                        />

                        {/* Garmin period selector */}
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-slate-500 flex-shrink-0">Garmin</span>
                            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-[11px] font-medium">
                                {[
                                    { value: 'none', label: 'Sin datos' },
                                    { value: '30d', label: '30 días' },
                                    { value: '90d', label: '90 días' },
                                ].map(({ value, label }) => (
                                    <button
                                        key={value}
                                        onClick={() => setGarminPeriod(value)}
                                        className={`px-2.5 py-1.5 transition-colors ${garminPeriod === value ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {garmin && garminPeriod !== 'none' && (
                                <span className="text-xs text-slate-400">
                                    {[...garmin].filter(d => {
                                        const c = new Date(); c.setDate(c.getDate() - (garminPeriod === '30d' ? 30 : 90));
                                        return new Date(d.date) >= c;
                                    }).length} registros
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Context from the AI panel (when arriving via "Seguir preguntando en el chat") */}
            {seed && (
                <Card className="p-0 ring-1 ring-blue-200 shadow-sm bg-blue-50/40 shrink-0 overflow-hidden">
                    {/* Barra compacta: contexto añadido + desplegar */}
                    <div className="flex items-center gap-2 px-3 py-2">
                        <CheckCircleIcon className="w-4 h-4 text-emerald-500 shrink-0" />
                        <button
                            onClick={() => setSeedOpen(o => !o)}
                            className="flex items-center gap-1.5 min-w-0 text-left group"
                            title={seedOpen ? 'Ocultar contexto' : 'Ver contexto añadido'}
                        >
                            <span className="text-xs font-semibold text-blue-800 truncate">
                                Contexto del análisis añadido a la conversación
                            </span>
                            <ChevronDownIcon className={`w-3.5 h-3.5 text-blue-500 shrink-0 transition-transform ${seedOpen ? 'rotate-180' : ''}`} />
                        </button>
                        <button
                            onClick={() => copyMessage(seedToText(seed), 'seed')}
                            title="Copiar contexto"
                            className="ml-auto shrink-0 text-slate-400 hover:text-blue-600 transition-colors"
                        >
                            {copiedIdx === 'seed'
                                ? <CheckIcon className="w-4 h-4 text-emerald-500" />
                                : <ClipboardDocumentIcon className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={() => setSeed(null)}
                            title="Quitar contexto"
                            className="shrink-0 text-slate-400 hover:text-rose-500 transition-colors"
                        >
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                    {seedOpen && (
                        <div className="px-3 pb-3 border-t border-blue-100">
                            <div className="text-sm text-slate-700 max-h-48 overflow-y-auto pr-1 pt-2">
                                <MarkdownText content={seedToText(seed)} />
                            </div>
                        </div>
                    )}
                </Card>
            )}

            {/* Chat Container */}
            <Card
                className="ring-1 ring-slate-200 shadow-sm bg-white overflow-hidden flex flex-col flex-1 min-h-[45dvh] lg:min-h-0"
            >
                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto">
                    {conversation.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center p-4 sm:p-8">
                            <div className="relative mb-4 sm:mb-6">
                                <div className="absolute inset-0 bg-blue-200 rounded-full blur-xl opacity-50 animate-pulse" />
                                <div className="relative p-4 sm:p-5 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl shadow-xl">
                                    <SparklesIcon className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
                                </div>
                            </div>

                            <h3 className="text-lg sm:text-xl font-bold text-slate-800 mb-2">¿Qué quieres saber?</h3>
                            <Text className="text-slate-500 mb-5 sm:mb-8 text-center max-w-md text-sm">
                                Analizo tus {selectedCount} carreras {filterMode === 'period' ? `del ${periodLabels[selectedPeriod]}` : 'más recientes'} y respondo cualquier pregunta sobre tu rendimiento
                            </Text>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg">
                                {suggestedQuestions.map((q, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => sendSuggestion(q.text)}
                                        disabled={loading}
                                        className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 rounded-xl transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                    >
                                        <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center text-base transition-colors">{q.icon}</span>
                                        <span className="text-sm font-medium text-slate-700 group-hover:text-blue-700 leading-snug">{q.text}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="p-3 sm:p-4 space-y-4 sm:space-y-5">
                            {conversation.map((msg, idx) => {
                                const isUser = msg.role === 'user';
                                const isLastAssistant = !isUser && idx === conversation.length - 1;
                                const streaming = isLastAssistant && loading;
                                return (
                                    <div key={idx} className={`flex gap-2 sm:gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} group`}>
                                        {/* Avatar — oculto en móvil para ganar ancho de burbuja */}
                                        <div className={`flex-shrink-0 w-8 h-8 rounded-full hidden sm:flex items-center justify-center shadow-sm ${isUser
                                                ? 'bg-blue-600 text-white text-xs font-bold'
                                                : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
                                            }`}>
                                            {isUser ? 'Tú' : <SparklesIcon className="w-4 h-4" />}
                                        </div>

                                        {/* Message Bubble */}
                                        <div className={`flex flex-col max-w-[92%] sm:max-w-[82%] ${isUser ? 'items-end' : 'items-start'}`}>
                                            <div className={`rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 ${isUser
                                                    ? 'bg-blue-600 text-white rounded-tr-sm'
                                                    : 'bg-white ring-1 ring-slate-200 shadow-sm rounded-tl-sm'
                                                }`}>
                                                {isUser ? (
                                                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                                ) : (
                                                    <div className="text-sm">
                                                        <MarkdownText content={msg.content} />
                                                        {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-blue-500 animate-pulse rounded-sm" />}
                                                    </div>
                                                )}
                                            </div>
                                            {/* Meta + actions */}
                                            <div className={`flex items-center gap-1.5 mt-1 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                                                <span className="text-xs text-slate-400">
                                                    {msg.timestamp?.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {!isUser && msg.content && !streaming && (
                                                    // En táctil no hay hover: las acciones se muestran siempre
                                                    <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            type="button"
                                                            onClick={() => copyMessage(msg.content, idx)}
                                                            title="Copiar respuesta"
                                                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                                        >
                                                            {copiedIdx === idx ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                                                        </button>
                                                        {isLastAssistant && (
                                                            <button
                                                                type="button"
                                                                onClick={regenerate}
                                                                disabled={loading}
                                                                title="Regenerar respuesta"
                                                                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-40"
                                                            >
                                                                <ArrowPathIcon className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Loading indicator (only before the assistant bubble appears) */}
                            {loading && (conversation.length === 0 || conversation[conversation.length - 1].role !== 'assistant' || conversation[conversation.length - 1].content === '') && (
                                <div className="flex gap-2 sm:gap-3">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 hidden sm:flex items-center justify-center shadow-sm">
                                        <SparklesIcon className="w-4 h-4 text-white" />
                                    </div>
                                    <div className="bg-white ring-1 ring-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                                        <TypingIndicator />
                                    </div>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="px-4 py-2 bg-rose-50 border-t border-rose-100">
                        <Text className="text-rose-600 text-sm">{error}</Text>
                    </div>
                )}

                {/* Input Area */}
                <div className="border-t border-slate-100 bg-slate-50 p-2.5 sm:p-4">
                    {/* Quick follow-up chips: en móvil una fila con scroll horizontal */}
                    {conversation.length > 0 && !loading && (
                        <div className="flex sm:flex-wrap gap-1.5 mb-2.5 sm:mb-3 overflow-x-auto sm:overflow-visible [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {suggestedQuestions.slice(0, 3).map((q, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => sendSuggestion(q.text)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 shrink-0 whitespace-nowrap bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50/60 rounded-full text-xs font-medium text-slate-600 hover:text-blue-700 transition-colors"
                                >
                                    <span>{q.icon}</span>
                                    {q.text}
                                </button>
                            ))}
                        </div>
                    )}
                    <form onSubmit={handleSubmit} className="flex items-end gap-2 sm:gap-3">
                        <div className="flex-1 relative">
                            <textarea
                                ref={inputRef}
                                placeholder="Escribe tu pregunta..."
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                rows={1}
                                className="w-full px-4 py-3 pr-12 bg-white border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm placeholder:text-slate-400 transition-all"
                                style={{ minHeight: '48px', maxHeight: '120px' }}
                                onKeyDown={(e) => {
                                    // En táctil, Enter hace salto de línea; se envía con el botón
                                    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
                                        e.preventDefault();
                                        handleSubmit(e);
                                    }
                                }}
                                onInput={(e) => {
                                    e.target.style.height = 'auto';
                                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                                }}
                            />
                            {conversation.length > 0 && !loading && (
                                <button
                                    type="button"
                                    onClick={clearConversation}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                                    title="Limpiar conversación"
                                >
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        {loading ? (
                            <Button
                                type="button"
                                icon={StopIcon}
                                onClick={stopGeneration}
                                color="rose"
                                variant="secondary"
                                className="h-12 px-3 sm:px-5 shrink-0"
                            >
                                <span className="hidden sm:inline">Detener</span>
                            </Button>
                        ) : (
                            <Button
                                type="submit"
                                icon={PaperAirplaneIcon}
                                disabled={!question.trim()}
                                color="blue"
                                className="h-12 px-3 sm:px-5 shrink-0"
                            >
                                <span className="hidden sm:inline">Enviar</span>
                            </Button>
                        )}
                    </form>
                    <p className="hidden sm:block text-xs text-slate-400 mt-2 text-center">
                        Enter para enviar • Shift+Enter para nueva línea
                    </p>
                </div>
            </Card>
        </div>
    );
};

export default RunQA;
