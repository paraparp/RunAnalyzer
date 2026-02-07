import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { Card, Title, Text, Button, Select, SelectItem, Badge } from "@tremor/react";
import { PaperAirplaneIcon, ChatBubbleLeftRightIcon, SparklesIcon, TrashIcon, BoltIcon } from "@heroicons/react/24/solid";
import ModelSelector from './ModelSelector';

// Simple markdown parser component
const MarkdownText = ({ content }) => {
    const parsedContent = useMemo(() => {
        if (!content) return [];

        const lines = content.split('\n');
        const elements = [];
        let listItems = [];
        let listType = null;

        const parseInline = (text) => {
            const parts = [];
            let remaining = text;
            let key = 0;

            while (remaining) {
                const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
                if (boldMatch && boldMatch.index !== undefined) {
                    if (boldMatch.index > 0) {
                        parts.push(<span key={key++}>{remaining.slice(0, boldMatch.index)}</span>);
                    }
                    parts.push(<strong key={key++} className="font-semibold text-slate-900">{boldMatch[1]}</strong>);
                    remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
                    continue;
                }

                const codeMatch = remaining.match(/`(.+?)`/);
                if (codeMatch && codeMatch.index !== undefined) {
                    if (codeMatch.index > 0) {
                        parts.push(<span key={key++}>{remaining.slice(0, codeMatch.index)}</span>);
                    }
                    parts.push(
                        <code key={key++} className="bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded text-xs font-mono">
                            {codeMatch[1]}
                        </code>
                    );
                    remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
                    continue;
                }

                parts.push(<span key={key++}>{remaining}</span>);
                break;
            }

            return parts.length > 0 ? parts : text;
        };

        const flushList = () => {
            if (listItems.length > 0) {
                const ListTag = listType === 'ol' ? 'ol' : 'ul';
                const listClass = listType === 'ol'
                    ? 'list-decimal list-outside ml-5 space-y-1.5 my-3 text-slate-700'
                    : 'list-disc list-outside ml-5 space-y-1.5 my-3 text-slate-700';
                elements.push(
                    <ListTag key={elements.length} className={listClass}>
                        {listItems.map((item, i) => (
                            <li key={i} className="leading-relaxed pl-1">{parseInline(item)}</li>
                        ))}
                    </ListTag>
                );
                listItems = [];
                listType = null;
            }
        };

        lines.forEach((line, idx) => {
            const trimmedLine = line.trim();

            if (!trimmedLine) {
                flushList();
                return;
            }

            const ulMatch = trimmedLine.match(/^[\*\-]\s+(.+)/);
            if (ulMatch) {
                if (listType && listType !== 'ul') flushList();
                listType = 'ul';
                listItems.push(ulMatch[1]);
                return;
            }

            const olMatch = trimmedLine.match(/^\d+\.\s+(.+)/);
            if (olMatch) {
                if (listType && listType !== 'ol') flushList();
                listType = 'ol';
                listItems.push(olMatch[1]);
                return;
            }

            flushList();

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

        flushList();
        return elements;
    }, [content]);

    return <div className="space-y-0.5">{parsedContent}</div>;
};

// Typing indicator component
const TypingIndicator = () => (
    <div className="flex items-center gap-1 px-2 py-1">
        <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
);

const RunQA = ({ activities }) => {
    const [question, setQuestion] = useState('');
    const [numRaces, setNumRaces] = useState('10');
    const [loading, setLoading] = useState(false);
    const [conversation, setConversation] = useState([]);
    const [error, setError] = useState('');
    const [provider, setProvider] = useState('groq');
    const [selectedModel, setSelectedModel] = useState('llama-3.1-8b-instant');

    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    const apiKeys = {
        gemini: import.meta.env.VITE_GEMINI_API_KEY || '',
        groq: import.meta.env.VITE_GROQ_API_KEY || '',
        anthropic: import.meta.env.VITE_ANTHROPIC_API_KEY || ''
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [conversation, loading]);

    const getSelectedActivities = () => {
        if (!activities || activities.length === 0) return [];
        const count = parseInt(numRaces);
        return activities
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
            .slice(0, count);
    };

    const formatActivitiesForPrompt = (acts) => {
        return acts.map((a, idx) => {
            const distKm = (a.distance / 1000).toFixed(2);
            const timeMin = Math.floor(a.moving_time / 60);
            const timeSec = a.moving_time % 60;
            const pace = (a.moving_time / 60 / (a.distance / 1000)).toFixed(2);
            const date = new Date(a.start_date).toLocaleDateString('es-ES', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            const hr = a.average_heartrate ? `FC media: ${Math.round(a.average_heartrate)} ppm` : '';
            const elev = `Desnivel: +${Math.round(a.total_elevation_gain)}m`;
            const maxSpeed = a.max_speed ? `Vel. máx: ${(a.max_speed * 3.6).toFixed(1)} km/h` : '';

            return `${idx + 1}. "${a.name}" - ${date}
   • Distancia: ${distKm} km | Tiempo: ${timeMin}:${timeSec.toString().padStart(2, '0')} | Ritmo: ${pace} min/km
   • ${elev} | ${hr} ${maxSpeed ? '| ' + maxSpeed : ''}`;
        }).join('\n\n');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!question.trim()) return;

        const activeKey = apiKeys[provider];
        if (!activeKey) {
            setError(`Configura la API Key de ${provider.charAt(0).toUpperCase() + provider.slice(1)}.`);
            return;
        }

        const selectedActs = getSelectedActivities();
        if (selectedActs.length === 0) {
            setError('No hay carreras disponibles para analizar.');
            return;
        }

        const userQuestion = question.trim();
        setQuestion('');
        setLoading(true);
        setError('');

        const newHistory = [...conversation, { role: 'user', content: userQuestion, timestamp: new Date() }];
        setConversation(newHistory);

        try {
            const activitiesText = formatActivitiesForPrompt(selectedActs);

            const systemPrompt = `Eres un analista experto de running y entrenamiento deportivo.
El usuario te proporcionará sus últimas carreras/entrenamientos y te hará preguntas sobre ellas.

DATOS DE LAS ÚLTIMAS ${selectedActs.length} CARRERAS/ENTRENAMIENTOS:
${activitiesText}

INSTRUCCIONES:
- Responde de forma clara, directa y útil
- Usa los datos proporcionados para dar respuestas precisas
- Si necesitas hacer cálculos (promedios, tendencias, etc.), hazlos
- Puedes dar recomendaciones basadas en los datos
- Responde en español
- Sé conciso pero completo
- Usa formato markdown: **negrita** para destacar, listas con - o números`;

            // Initialize Provider
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
                const google = createGoogleGenerativeAI({ apiKey: activeKey });
                model = google(selectedModel);
            }

            // Messages for the AI
            const messages = [
                { role: "system", content: systemPrompt },
                ...newHistory.map(m => ({ role: m.role, content: m.content }))
            ];

            const result = await streamText({
                model: model,
                messages: messages,
                temperature: 0.7,
            });

            // Add placeholder for AI response
            let aiContent = "";
            setConversation(prev => [...prev, { role: 'assistant', content: '', timestamp: new Date() }]);

            for await (const textPart of result.textStream) {
                aiContent += textPart;
                setConversation(prev => {
                    const newConv = [...prev];
                    newConv[newConv.length - 1] = {
                        ...newConv[newConv.length - 1],
                        content: aiContent
                    };
                    return newConv;
                });
            }

        } catch (err) {
            console.error("Error en la consulta:", err);
            setError(`Error: ${err.message}`);
            // Remove the user message if it failed immediately, or just leave it.
            // Better to show error.
        } finally {
            setLoading(false);
            inputRef.current?.focus();
        }
    };

    const clearConversation = () => {
        setConversation([]);
        setError('');
    };

    const suggestedQuestions = [
        { text: "¿Cuál fue mi mejor carrera?", icon: "🏆" },
        { text: "¿Cómo ha evolucionado mi ritmo?", icon: "📈" },
        { text: "¿Cuál es mi distancia promedio?", icon: "📊" },
        { text: "Dame un resumen de mi entrenamiento", icon: "📋" }
    ];

    const selectedCount = Math.min(parseInt(numRaces), activities?.length || 0);

    return (
        <div className="space-y-4">
            {/* Compact Header */}
            <Card className="p-4 ring-1 ring-slate-200 shadow-sm bg-white">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl shadow-lg shadow-violet-200">
                            <ChatBubbleLeftRightIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <Title className="text-lg font-bold text-slate-900">Pregunta sobre tus Carreras</Title>
                            <div className="flex items-center gap-2 mt-0.5">
                                <Badge size="xs" color="violet" icon={BoltIcon}>
                                    {selectedCount} carreras cargadas
                                </Badge>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full lg:w-auto">
                        <Select
                            value={numRaces}
                            onValueChange={setNumRaces}
                            enableClear={false}
                            className="w-full sm:w-44"
                        >
                            <SelectItem value="5">Últimas 5</SelectItem>
                            <SelectItem value="10">Últimas 10</SelectItem>
                            <SelectItem value="20">Últimas 20</SelectItem>
                            <SelectItem value="30">Últimas 30</SelectItem>
                            <SelectItem value="50">Últimas 50</SelectItem>
                        </Select>
                        <ModelSelector
                            provider={provider}
                            setProvider={setProvider}
                            selectedModel={selectedModel}
                            setSelectedModel={setSelectedModel}
                            showLabel={false}
                        />
                    </div>
                </div>
            </Card>

            {/* Chat Container */}
            <Card className="ring-1 ring-slate-200 shadow-sm bg-white overflow-hidden flex flex-col" style={{ height: '600px' }}>
                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto">
                    {conversation.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center p-8">
                            <div className="relative mb-6">
                                <div className="absolute inset-0 bg-violet-200 rounded-full blur-xl opacity-50 animate-pulse" />
                                <div className="relative p-5 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl shadow-xl">
                                    <SparklesIcon className="w-10 h-10 text-white" />
                                </div>
                            </div>

                            <h3 className="text-xl font-bold text-slate-800 mb-2">¿Qué quieres saber?</h3>
                            <Text className="text-slate-500 mb-8 text-center max-w-md">
                                Analizo tus {selectedCount} últimas carreras y respondo cualquier pregunta sobre tu rendimiento
                            </Text>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                                {suggestedQuestions.map((q, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setQuestion(q.text)}
                                        className="flex items-center gap-3 p-4 bg-slate-50 hover:bg-violet-50 border border-slate-200 hover:border-violet-300 rounded-xl transition-all text-left group"
                                    >
                                        <span className="text-2xl">{q.icon}</span>
                                        <span className="text-sm font-medium text-slate-700 group-hover:text-violet-700">{q.text}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="p-4 space-y-4">
                            {conversation.map((msg, idx) => (
                                <div
                                    key={idx}
                                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                                >
                                    {/* Avatar */}
                                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${msg.role === 'user'
                                            ? 'bg-violet-600 text-white'
                                            : 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'
                                        }`}>
                                        {msg.role === 'user' ? 'Tú' : '🏃'}
                                    </div>

                                    {/* Message Bubble */}
                                    <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                        <div
                                            className={`rounded-2xl px-4 py-3 ${msg.role === 'user'
                                                    ? 'bg-violet-600 text-white rounded-tr-sm'
                                                    : 'bg-white ring-1 ring-slate-200 shadow-sm rounded-tl-sm'
                                                }`}
                                        >
                                            {msg.role === 'assistant' ? (
                                                <div className="text-sm">
                                                    <MarkdownText content={msg.content} />
                                                </div>
                                            ) : (
                                                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                            )}
                                        </div>
                                        <span className="text-xs text-slate-400 mt-1 px-1">
                                            {msg.timestamp?.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            ))}

                            {/* Loading indicator */}
                            {loading && (conversation.length === 0 || conversation[conversation.length - 1].role !== 'assistant' || conversation[conversation.length - 1].content === '') && (
                                <div className="flex gap-3">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                                        <span>🏃</span>
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
                <div className="border-t border-slate-100 bg-slate-50 p-4">
                    <form onSubmit={handleSubmit} className="flex items-end gap-3">
                        <div className="flex-1 relative">
                            <textarea
                                ref={inputRef}
                                placeholder="Escribe tu pregunta..."
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                rows={1}
                                className="w-full px-4 py-3 pr-12 bg-white border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent text-sm placeholder:text-slate-400 transition-all"
                                style={{ minHeight: '48px', maxHeight: '120px' }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSubmit(e);
                                    }
                                }}
                                onInput={(e) => {
                                    e.target.style.height = 'auto';
                                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                                }}
                            />
                            {conversation.length > 0 && (
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
                        <Button
                            type="submit"
                            icon={PaperAirplaneIcon}
                            loading={loading}
                            disabled={!question.trim() || loading}
                            color="violet"
                            className="h-12 px-5"
                        >
                            Enviar
                        </Button>
                    </form>
                    <p className="text-xs text-slate-400 mt-2 text-center">
                        Presiona Enter para enviar • Shift+Enter para nueva línea
                    </p>
                </div>
            </Card>
        </div>
    );
};

export default RunQA;
