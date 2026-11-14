import { useState, useRef, useEffect, useMemo } from 'react';
import { Renderer } from '@openuidev/react-lang';
import cloudStorage from '../lib/cloudStorage';
import useGarminWearableData from '../hooks/useGarminWearableData';
import { streamAI, buildProviderChain, parseModelValue, THESYS_MODEL } from '../services/ai';
import { ArrowUpIcon, StopIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, ChevronDownIcon, ClipboardDocumentIcon, CheckIcon, ArrowPathIcon, XMarkIcon, PlusIcon, DocumentTextIcon, ClockIcon, TrashIcon, PaperClipIcon, PhotoIcon } from "@heroicons/react/20/solid";
import { fileToChatImage, isImageFile, toApiMessages, MAX_CHAT_IMAGES } from '../lib/chatImages';
import { listConversations, saveConversation, deleteConversation, newConversationId, restoreMessages, dayLabel, HISTORY_DAYS } from '../lib/chatHistory';
import useAIModel from '../hooks/useAIModel';
import MarkdownText from './MarkdownText';
import { getTargetRaces, getPrimaryTargetRace, daysUntil, formatMinutes } from '../lib/targetRaces';
import { buildChatSystemPrompt, sortActivities, selectDetail, seedToText } from '../lib/chatContext';
import { getTrainingPlans } from '../lib/trainingPlans';
import { chatLibrary, chatUIPrompt, chatCloudPrompt, isOpenUI, cleanOpenUI, ChatAskContext } from '../lib/chatUI';


const SUGGESTIONS_DEFAULT = [
    { title: 'Mejor sesión', text: '¿Cuál fue mi mejor carrera y por qué?' },
    { title: 'Evolución del ritmo', text: '¿Cómo ha evolucionado mi ritmo con la misma frecuencia cardiaca?' },
    { title: 'Volumen y carga', text: 'Resume mi volumen semanal y si la carga es sostenible.' },
    { title: 'Próxima sesión', text: '¿Qué sesión me recomiendas hacer mañana?' },
];
// "Zurich Maratón Donostia San Sebastián" → "Maratón Donostia": nombre corto
// para la etiqueta de la cabecera.
const shortRaceName = (name = '') => {
    const words = name.replace(/^(zurich|the)\s+/i, '').split(/\s+/);
    return words.slice(0, 2).join(' ') || name;
};

// Sugerencias según el momento: carrera recién corrida, semanas finales antes
// de la principal, preparación en curso o sin objetivo.
function raceContext() {
    let races = [], primary = null;
    try { races = getTargetRaces() || []; primary = getPrimaryTargetRace(); } catch { /* sin datos */ }
    const recent = races
        .filter(r => { const d = daysUntil(r.date); return d < 0 && d >= -7; })
        .sort((a, b) => b.date.localeCompare(a.date))[0];
    const d = primary ? daysUntil(primary.date) : null;
    const name = primary ? shortRaceName(primary.name) : '';
    if (recent) {
        const rn = shortRaceName(recent.name);
        return { race: primary, suggestions: [
            { title: `Analiza ${rn}`, text: `Analiza mi carrera ${recent.name}: ritmos, FC y cómo la gestioné.` },
            { title: 'Frente al objetivo', text: `¿Cómo quedé en ${recent.name} frente a mi objetivo y qué me dice de mi forma?` },
            { title: 'Recuperación', text: '¿Cómo tengo que recuperar estos días después de la carrera?' },
            primary && d >= 0
                ? { title: `Hacia ${name}`, text: `¿Qué cambia de cara a ${primary.name} tras esta carrera?` }
                : { title: 'Siguiente objetivo', text: '¿Qué objetivo me propones para las próximas semanas?' },
        ] };
    }
    if (primary && d >= 0 && d <= 14) {
        return { race: primary, suggestions: [
            { title: '¿Llego bien?', text: `¿Llego bien a ${primary.name}?` },
            { title: 'Estrategia de ritmo', text: `¿Qué estrategia de ritmo sigo en ${primary.name}?` },
            { title: 'Esta semana', text: '¿Qué tengo que hacer esta semana?' },
            { title: 'Días previos', text: '¿Cómo organizo la alimentación, el descanso y la víspera de la carrera?' },
        ] };
    }
    if (primary && d > 14) {
        return { race: primary, suggestions: [
            { title: 'Progreso al objetivo', text: `¿Cómo voy de cara a ${primary.name}?` },
            { title: 'Próxima sesión', text: '¿Qué sesión me toca mañana y cómo la hago?' },
            { title: 'Volumen y carga', text: 'Resume mi volumen semanal y si la carga es sostenible.' },
            { title: 'Predicción', text: `¿Qué tiempo podría hacer hoy en ${primary.name}?` },
        ] };
    }
    return { race: primary && d >= 0 ? primary : null, suggestions: null };
}

const SUGGESTIONS_SEED = [
    { title: 'Justifica la sesión', text: '¿Por qué me recomiendas esa sesión y no intervalos?' },
    { title: 'Subir volumen', text: '¿Cómo subo volumen sin pasarme de carga?' },
    { title: 'Objetivo', text: '¿Llego en forma a mi carrera objetivo con esta tendencia?' },
    { title: 'Forma actual', text: 'Explícame mi readiness y mi forma (TSB) actual.' },
];

const IconButton = ({ title, onClick, disabled, children, className = '' }) => (
    <button
        type="button"
        title={title}
        aria-label={title}
        onClick={onClick}
        disabled={disabled}
        className={`p-1.5 rounded-md text-slate-500 dark:text-white/55 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors disabled:opacity-40 ${className}`}
    >
        {children}
    </button>
);

// Respuesta del asistente: UI generativa (OpenUI) o markdown si el modelo no
// siguió el formato. Mientras el stream aún no deja ver qué es, se muestra el
// indicador de escritura en vez de restos de "root =".
const AssistantContent = ({ content: raw, streaming }) => {
    const content = cleanOpenUI(raw);
    const trimmed = content.trimStart();
    // Mientras llega: hasta que aparezca `root =` puede ser narración previa a
    // las herramientas ("Voy a consultar…"); no se pinta. Un modelo que responda
    // en markdown se muestra en cuanto el texto deja claro que no es OpenUI.
    if (!trimmed || (streaming && !isOpenUI(content) && trimmed.length < 400 && !/\n\n/.test(trimmed))) {
        return <ThinkingDots />;
    }
    if (isOpenUI(content)) {
        return <Renderer response={content} library={chatLibrary} isStreaming={streaming} />;
    }
    return (
        <div className="text-sm text-slate-700 dark:text-white/80 leading-relaxed">
            <MarkdownText content={content} />
        </div>
    );
};

const ThinkingDots = () => (
    <div className="flex items-center gap-2 h-6 text-xs font-medium text-slate-500 dark:text-white/55">
        <span className="flex gap-1">
            {[0, 150, 300].map(d => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-teal-600 dark:bg-teal-300 animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
        </span>
        Analizando tus datos
    </div>
);

const RunQA = ({ activities }) => {
    const [question, setQuestion] = useState('');
    // Capturas adjuntas pendientes de enviar (ya reducidas, ver lib/chatImages).
    const [attachments, setAttachments] = useState([]);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef(null);
    const { garmin } = useGarminWearableData();
    const [loading, setLoading] = useState(false);
    const [conversation, setConversation] = useState([]);
    // Historial (lib/chatHistory): id de la conversación actual y lista de los últimos 7 días.
    const [convId, setConvId] = useState(newConversationId);
    const [history, setHistory] = useState(listConversations);
    const [historyOpen, setHistoryOpen] = useState(false);
    const savedSigRef = useRef('');
    const [seed, setSeed] = useState(null);
    const [pendingAsk, setPendingAsk] = useState(null); // pregunta auto-lanzada al llegar con foco desde el panel
    const autoAskedRef = useRef(false);
    const [error, setError] = useState('');
    // Modelo IA: preferencia global (se cambia en el menú de usuario).
    const [selectedModel] = useAIModel();
    const [copiedIdx, setCopiedIdx] = useState(null);
    const [fullscreen, setFullscreen] = useState(false);
    const [seedOpen, setSeedOpen] = useState(false);
    // En pantallas táctiles Enter hace salto de línea; se envía con el botón
    const isTouch = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches, []);

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const abortRef = useRef(null);
    const msgRefs = useRef({});

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
        } catch { /* semilla ilegible: se abre el chat vacío */ }
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: 'end' });
    }, [conversation, loading]);

    // Contexto automático (lib/chatContext): detalle reciente + historial
    // mensual + objetivos y plan. Se lee en cada envío para estar al día.
    const sortedActs = useMemo(() => sortActivities(activities), [activities]);
    const getSelectedActivities = () => selectDetail(sortedActs);

    const buildSystemPrompt = (formatPrompt, lean = false) => {
        let races = [], primary = null, plans = [];
        try { races = getTargetRaces() || []; primary = getPrimaryTargetRace(); plans = getTrainingPlans() || []; } catch { /* datos ilegibles */ }
        return buildChatSystemPrompt({ activities, garmin, races, primary, plans, seed, formatPrompt, lean });
    };

    // Core: stream a response for the given history (which must end with a user
    // turn). Shared by submit, suggestion chips and regenerate.
    const runQuery = async (history) => {
        const selectedActs = getSelectedActivities();
        if (selectedActs.length === 0) {
            setError('Todavía no hay actividades sincronizadas para analizar.');
            return;
        }

        setLoading(true);
        setError('');
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const turns = toApiMessages(history);
            // El OpenUI Gateway recibe su bloque gestionado (cloud), herramientas
            // para consultar datos y un contexto ligero; el resto de proveedores
            // (respaldo, quizá sin soporte de herramientas), el prompt completo.
            const messagesFor = (provider) => [
                { role: 'system', content: provider === 'thesys' ? buildSystemPrompt(chatCloudPrompt, true) : buildSystemPrompt(chatUIPrompt) },
                ...turns,
            ];

            setConversation(prev => [...prev, { role: 'assistant', content: '', timestamp: new Date() }]);
            const onChunk = (_chunk, aiContent) => {
                setConversation(prev => {
                    const next = [...prev];
                    next[next.length - 1] = { ...next[next.length - 1], content: aiContent };
                    return next;
                });
            };

            // Cadena de proveedores (misma que el resto de herramientas IA): el
            // modelo elegido primero y, si falla (p. ej. 429 de cuota), el resto
            // de proveedores gratuitos. El abort del usuario se propaga tal cual
            // y conserva el texto parcial.
            // Primero el OpenUI Gateway (si el servidor no tiene THESYS_API_KEY falla
            // al instante y se sigue con la cadena habitual).
            const chain = [{ provider: 'thesys', model: THESYS_MODEL }, ...buildProviderChain(parseModelValue(selectedModel))];
            let full = '';
            let primaryErr = null;
            for (const step of chain) {
                if (controller.signal.aborted) break;
                try {
                    onChunk(null, ''); // limpia el parcial del intento anterior
                    full = await streamAI(
                        { provider: step.provider, model: step.model, messages: messagesFor(step.provider), temperature: 0.5, signal: controller.signal, tools: step.provider === 'thesys' },
                        onChunk
                    );
                    primaryErr = null;
                    break;
                } catch (e) {
                    if (e?.name === 'AbortError') throw e;
                    if (step.provider === 'thesys') console.warn('[chat] OpenUI Gateway no disponible, se usa la cadena habitual:', e?.message);
                    else if (!primaryErr) primaryErr = e;
                }
            }
            if (primaryErr) throw primaryErr;
            // Si el stream terminó sin texto (p. ej. corte del servidor a mitad),
            // no dejamos una respuesta vacía: la quitamos y avisamos.
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
                setError(err.message || 'No se pudo completar la consulta.');
                setConversation(prev => {
                    const next = [...prev];
                    if (next[next.length - 1]?.role === 'assistant' && !next[next.length - 1].content) next.pop();
                    return next;
                });
            }
        } finally {
            setLoading(false);
            abortRef.current = null;
            if (!isTouch) inputRef.current?.focus();
        }
    };

    const ask = (text, images = []) => {
        const q = (text || '').trim();
        if ((!q && !images.length) || loading) return;
        const msg = { role: 'user', content: q || (images.length > 1 ? 'Analiza estas imágenes.' : 'Analiza esta imagen.'), timestamp: new Date() };
        if (images.length) msg.images = images;
        const newHistory = [...conversation, msg];
        setConversation(newHistory);
        runQuery(newHistory);
    };

    const handleSubmit = (e) => {
        e?.preventDefault?.();
        if ((!question.trim() && !attachments.length) || loading) return;
        ask(question, attachments);
        setQuestion('');
        setAttachments([]);
        if (inputRef.current) inputRef.current.style.height = 'auto';
    };

    // Adjuntar: botón, pegar (Ctrl+V de una captura) o arrastrar al chat.
    const addFiles = async (files) => {
        const imgs = [...(files || [])].filter(isImageFile);
        if (!imgs.length) return;
        const room = MAX_CHAT_IMAGES - attachments.length;
        if (room <= 0) { setError(`Máximo ${MAX_CHAT_IMAGES} imágenes por mensaje.`); return; }
        if (imgs.length > room) setError(`Máximo ${MAX_CHAT_IMAGES} imágenes por mensaje: se añaden las ${room} primeras.`);
        else setError('');
        try {
            const ready = await Promise.all(imgs.slice(0, room).map(fileToChatImage));
            setAttachments(prev => [...prev, ...ready].slice(0, MAX_CHAT_IMAGES));
            inputRef.current?.focus();
        } catch (err) {
            setError(err.message || 'No se pudo leer la imagen.');
        }
    };
    const onPaste = (e) => {
        const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
        if (files.some(isImageFile)) { e.preventDefault(); addFiles(files); }
    };
    const dragProps = {
        onDragOver: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true); } },
        onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); },
        onDrop: (e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer?.files); },
    };

    // Lanza automáticamente la pregunta de ampliación que llegó con el seed
    // (botón "Ampliar" de una sección del panel de IA). El ref evita el doble
    // disparo del StrictMode en desarrollo.
    useEffect(() => {
        if (!pendingAsk || loading || autoAskedRef.current) return;
        if (!activities?.length) return;
        autoAskedRef.current = true;
        setPendingAsk(null);
        ask(pendingAsk);
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

    // Copia el texto ya renderizado (no el código OpenUI crudo).
    const copyText = async (text, key) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedIdx(key);
            setTimeout(() => setCopiedIdx(c => (c === key ? null : c)), 1500);
        } catch { /* el portapapeles puede estar bloqueado */ }
    };
    const copyMessage = (idx, raw) => copyText(msgRefs.current[idx]?.innerText?.trim() || raw, idx);

    const clearConversation = () => {
        abortRef.current?.abort();
        setConversation([]);
        setConvId(newConversationId());
        setError('');
    };

    // Guarda la conversación al terminar cada respuesta (no a cada trozo del stream).
    useEffect(() => {
        if (loading || !conversation.some(m => m.role === 'assistant' && m.content)) return;
        // Solo si cambió algo: abrir una conversación antigua no la "rejuvenece".
        const sig = `${convId}:${conversation.length}:${conversation[conversation.length - 1]?.content?.length}`;
        if (sig === savedSigRef.current) return;
        savedSigRef.current = sig;
        saveConversation(convId, conversation);
        setHistory(listConversations());
    }, [loading, conversation, convId]);

    const openConversation = (c) => {
        abortRef.current?.abort();
        const msgs = restoreMessages(c);
        savedSigRef.current = `${c.id}:${msgs.length}:${msgs[msgs.length - 1]?.content?.length}`;
        setConvId(c.id);
        setConversation(msgs);
        setError('');
        setHistoryOpen(false);
    };

    const removeConversation = (id) => {
        deleteConversation(id);
        setHistory(listConversations());
        if (id === convId) clearConversation();
    };

    const historyGroups = history.reduce((acc, c) => {
        const label = dayLabel(c.updatedAt);
        (acc[label] ||= []).push(c);
        return acc;
    }, {});

    const { race: mainRace, suggestions: raceSuggestions } = raceContext();
    const suggestions = seed ? SUGGESTIONS_SEED : (raceSuggestions || SUGGESTIONS_DEFAULT);
    const mainDays = mainRace ? daysUntil(mainRace.date) : null;
    // En pantalla completa hay sitio: la conversación se ensancha (tablas y
    // gráficos respiran) sin pasar de una línea de lectura cómoda.
    const column = fullscreen ? 'max-w-5xl' : 'max-w-3xl';
    const selectedCount = getSelectedActivities().length;
    const empty = conversation.length === 0;

    return (
        <ChatAskContext.Provider value={ask}>
            <div className={fullscreen
                ? 'fixed inset-0 z-50 bg-[#f4f6fb] dark:bg-[#07090d] p-0 sm:p-4 flex flex-col overflow-hidden'
                : 'flex flex-col flex-1 min-h-0'}>
                <section {...dragProps} className="relative flex flex-col flex-1 min-h-[60dvh] lg:min-h-0 overflow-hidden bg-white dark:bg-[#0c0e12] ring-1 ring-slate-200 dark:ring-white/10 sm:rounded-xl shadow-sm">
                    {dragging && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/85 dark:bg-[#0c0e12]/85 border-2 border-dashed border-teal-600/60 dark:border-teal-300/50 sm:rounded-xl pointer-events-none">
                            <p className="inline-flex items-center gap-2 text-sm font-semibold text-teal-800 dark:text-teal-200"><PhotoIcon className="w-5 h-5" /> Suelta aquí tus capturas</p>
                        </div>
                    )}
                    {/* Cabecera */}
                    <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-white/10 shrink-0">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                                <h2 className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white leading-tight truncate">Analista de entrenamiento</h2>
                                {mainRace && mainDays >= 0 && (
                                    <span title={`${mainRace.name} · ${mainRace.date}`} className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold tabular-nums text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-400/10 ring-1 ring-teal-600/20 dark:ring-teal-300/20 shrink-0 truncate max-w-[22rem]">
                                        {shortRaceName(mainRace.name)} · {mainDays === 0 ? 'hoy' : mainDays === 1 ? 'mañana' : `${mainDays} días`}{mainRace.goalTimeMin ? ` · objetivo ${formatMinutes(mainRace.goalTimeMin)}` : ''}
                                    </span>
                                )}
                            </div>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-white/55 truncate">
                                {selectedCount} actividades recientes en detalle{sortedActs.length > selectedCount ? ` · historial de ${sortedActs.length}` : ''}{garmin?.length ? ' · salud Garmin' : ''}{seed ? ' · análisis del panel' : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                            {!empty && (
                                <IconButton title="Nueva conversación" onClick={() => { clearConversation(); setHistoryOpen(false); }}>
                                    <PlusIcon className="w-4 h-4" />
                                </IconButton>
                            )}
                            <IconButton title={`Historial (${HISTORY_DAYS} días)`} onClick={() => { setHistory(listConversations()); setHistoryOpen(o => !o); }} className={historyOpen ? 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-400/10' : ''}>
                                <ClockIcon className="w-4 h-4" />
                            </IconButton>
                            <IconButton title={fullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'} onClick={() => setFullscreen(f => !f)}>
                                {fullscreen ? <ArrowsPointingInIcon className="w-4 h-4" /> : <ArrowsPointingOutIcon className="w-4 h-4" />}
                            </IconButton>
                        </div>
                    </header>


                    {/* Contexto heredado del panel de IA */}
                    {historyOpen && (
                        <div className="shrink-0 max-h-[45%] overflow-y-auto border-b border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02]">
                            {history.length === 0 ? (
                                <p className="px-4 py-4 text-sm text-slate-500 dark:text-white/55">Aún no hay conversaciones en los últimos {HISTORY_DAYS} días.</p>
                            ) : Object.entries(historyGroups).map(([label, items]) => (
                                <div key={label} className="px-2 py-2">
                                    <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500 dark:text-white/55">{label}</p>
                                    <ul>
                                        {items.map(c => (
                                            <li key={c.id} className="group/item flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => openConversation(c)}
                                                    className={`flex-1 min-w-0 flex items-baseline gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${c.id === convId ? 'bg-white dark:bg-white/[0.06] ring-1 ring-slate-200 dark:ring-white/10' : 'hover:bg-white dark:hover:bg-white/[0.04]'}`}
                                                >
                                                    <span className="flex-1 truncate text-sm text-slate-800 dark:text-white/85">{c.title}</span>
                                                    <span className="shrink-0 text-[11px] tabular-nums text-slate-400 dark:text-white/40">
                                                        {new Date(c.updatedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </button>
                                                <IconButton title="Borrar conversación" onClick={() => removeConversation(c.id)} className="sm:opacity-0 sm:group-hover/item:opacity-100 focus:opacity-100">
                                                    <TrashIcon className="w-3.5 h-3.5" />
                                                </IconButton>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    )}

                    {seed && (
                        <div className="px-4 py-2 border-b border-slate-200 dark:border-white/10 bg-teal-50/60 dark:bg-teal-400/[0.06] shrink-0">
                            <div className="flex items-center gap-2">
                                <DocumentTextIcon className="w-4 h-4 text-teal-700 dark:text-teal-300 shrink-0" />
                                <button type="button" onClick={() => setSeedOpen(o => !o)} className="flex items-center gap-1 min-w-0 text-left">
                                    <span className="text-xs font-semibold text-teal-900 dark:text-teal-100 truncate">Usando el análisis del panel como contexto</span>
                                    <ChevronDownIcon className={`w-3.5 h-3.5 text-teal-700 dark:text-teal-300 shrink-0 transition-transform ${seedOpen ? 'rotate-180' : ''}`} />
                                </button>
                                <div className="ml-auto flex items-center">
                                    <IconButton title="Copiar contexto" onClick={() => copyText(seedToText(seed), 'seed')}>
                                        {copiedIdx === 'seed' ? <CheckIcon className="w-3.5 h-3.5 text-emerald-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                                    </IconButton>
                                    <IconButton title="Quitar contexto" onClick={() => setSeed(null)}>
                                        <XMarkIcon className="w-3.5 h-3.5" />
                                    </IconButton>
                                </div>
                            </div>
                            {seedOpen && (
                                <div className="mt-2 text-sm text-slate-700 dark:text-white/75 max-h-48 overflow-y-auto pr-1">
                                    <MarkdownText content={seedToText(seed)} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Conversación */}
                    <div className="flex-1 overflow-y-auto">
                        <div className={`mx-auto w-full ${column} px-4 sm:px-6 py-5 sm:py-6`}>
                            {empty ? (
                                <div className="flex flex-col justify-center min-h-full py-6 sm:py-10">
                                    <h3 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">¿Qué quieres analizar?</h3>
                                    <p className="mt-1.5 text-sm text-slate-500 dark:text-white/55 max-w-lg">
                                        Respuestas con cifras, tablas y gráficos a partir de todo tu historial de entrenamiento y salud.
                                    </p>
                                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {suggestions.map((s) => (
                                            <button
                                                key={s.title}
                                                type="button"
                                                onClick={() => ask(s.text)}
                                                disabled={loading || !selectedCount}
                                                className="group text-left px-3.5 py-3 rounded-lg ring-1 ring-slate-200 dark:ring-white/10 hover:ring-teal-600/40 dark:hover:ring-teal-300/40 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.title}</p>
                                                <p className="text-xs text-slate-500 dark:text-white/55 mt-0.5 leading-snug">{s.text}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {conversation.map((msg, idx) => {
                                        const isUser = msg.role === 'user';
                                        const isLastAssistant = !isUser && idx === conversation.length - 1;
                                        const streaming = isLastAssistant && loading;
                                        if (isUser) {
                                            return (
                                                <div key={idx} className="flex flex-col items-end gap-1.5">
                                                    {msg.images?.length > 0 && (
                                                        <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
                                                            {msg.images.map(im => (
                                                                <a key={im.id} href={im.dataUrl} target="_blank" rel="noreferrer" title={im.name}>
                                                                    <img src={im.dataUrl} alt={im.name} className="h-28 max-w-[14rem] object-cover rounded-lg ring-1 ring-slate-200 dark:ring-white/10" />
                                                                </a>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {!msg.images?.length && msg.imageCount > 0 && (
                                                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-white/40"><PhotoIcon className="w-3.5 h-3.5" /> {msg.imageCount === 1 ? '1 imagen no guardada' : `${msg.imageCount} imágenes no guardadas`} en el historial</span>
                                                    )}
                                                    <p className="max-w-[85%] px-3.5 py-2 rounded-xl rounded-br-sm bg-slate-100 dark:bg-white/[0.07] text-sm text-slate-900 dark:text-white whitespace-pre-wrap">
                                                        {msg.content}
                                                    </p>
                                                </div>
                                            );
                                        }
                                        return (
                                            <article key={idx} className="group">
                                                <div ref={el => { msgRefs.current[idx] = el; }}>
                                                    <AssistantContent content={msg.content} streaming={streaming} />
                                                </div>
                                                {msg.content && !streaming && (
                                                    <div className="flex items-center gap-0.5 mt-2 -ml-1.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                                                        <IconButton title="Copiar respuesta" onClick={() => copyMessage(idx, msg.content)}>
                                                            {copiedIdx === idx ? <CheckIcon className="w-3.5 h-3.5 text-emerald-600" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
                                                        </IconButton>
                                                        {isLastAssistant && (
                                                            <IconButton title="Regenerar respuesta" onClick={regenerate} disabled={loading}>
                                                                <ArrowPathIcon className="w-3.5 h-3.5" />
                                                            </IconButton>
                                                        )}
                                                        <span className="ml-1 text-xs text-slate-400 dark:text-white/40 tabular-nums">
                                                            {msg.timestamp?.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                )}
                                            </article>
                                        );
                                    })}
                                    <div ref={messagesEndRef} />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Composer */}
                    <div className="shrink-0 border-t border-slate-200 dark:border-white/10 px-3 sm:px-4 py-3">
                        <div className={`mx-auto w-full ${column}`}>
                            {error && (
                                <p role="alert" className="mb-2 px-3 py-2 rounded-md text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-400/10 ring-1 ring-rose-200 dark:ring-rose-300/20">
                                    {error}
                                </p>
                            )}
                            {attachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {attachments.map(im => (
                                        <div key={im.id} className="relative">
                                            <img src={im.dataUrl} alt={im.name} className="h-16 w-16 object-cover rounded-lg ring-1 ring-slate-200 dark:ring-white/10" />
                                            <button type="button" onClick={() => setAttachments(a => a.filter(x => x.id !== im.id))} title="Quitar imagen" aria-label="Quitar imagen"
                                                className="absolute -top-1.5 -right-1.5 h-5 w-5 inline-flex items-center justify-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow">
                                                <XMarkIcon className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <form
                                onSubmit={handleSubmit}
                                className="flex items-end gap-1.5 rounded-xl ring-1 ring-slate-200 dark:ring-white/10 bg-slate-50 dark:bg-white/[0.03] focus-within:bg-white dark:focus-within:bg-white/[0.05] focus-within:ring-2 focus-within:ring-teal-600/50 dark:focus-within:ring-teal-300/40 pl-1.5 pr-1.5 py-1.5 transition-colors"
                            >
                                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                                    onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading || attachments.length >= MAX_CHAT_IMAGES}
                                    title="Adjuntar captura o imagen" aria-label="Adjuntar captura o imagen"
                                    className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-white/55 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] disabled:opacity-40 transition-colors">
                                    <PaperClipIcon className="w-4 h-4" />
                                </button>
                                <textarea
                                    onPaste={onPaste}
                                    ref={inputRef}
                                    placeholder="Pregunta sobre tus entrenamientos…"
                                    aria-label="Pregunta"
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    rows={1}
                                    className="flex-1 bg-transparent resize-none border-0 p-0 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 focus:outline-none focus:ring-0"
                                    style={{ maxHeight: '140px' }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
                                            e.preventDefault();
                                            handleSubmit(e);
                                        }
                                    }}
                                    onInput={(e) => {
                                        e.target.style.height = 'auto';
                                        e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
                                    }}
                                />
                                {loading ? (
                                    <button type="button" onClick={stopGeneration} title="Detener" aria-label="Detener"
                                        className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 transition-opacity">
                                        <StopIcon className="w-4 h-4" />
                                    </button>
                                ) : (
                                    <button type="submit" disabled={!question.trim() && !attachments.length} title="Enviar" aria-label="Enviar"
                                        className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-white/10 dark:disabled:text-white/30 transition-colors">
                                        <ArrowUpIcon className="w-4 h-4" />
                                    </button>
                                )}
                            </form>
                            <p className="hidden sm:block mt-1.5 text-[11px] text-slate-400 dark:text-white/35 text-center">
                                Enter para enviar · Shift+Enter nueva línea · Pega o arrastra capturas para analizarlas
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </ChatAskContext.Provider>
    );
};

export default RunQA;
