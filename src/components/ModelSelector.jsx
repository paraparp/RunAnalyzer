import React, { useEffect, useState } from 'react';
import { Text, Select, SelectItem } from "@tremor/react";
import { SparklesIcon } from "@heroicons/react/24/solid";

/**
 * Google Gemini model selector.
 * Fetches the live list of available models from the ListModels endpoint (same
 * source as the AI panel) and falls back to a static list when unavailable.
 */

// Fallback list used when the ListModels API can't be reached.
const FALLBACK_GEMINI = [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
];

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

// Short capability hint derived from the model id.
const tierOf = (id) => {
    if (/pro/i.test(id)) return 'Máxima calidad';
    if (/flash-?lite/i.test(id)) return 'Económico';
    if (/flash/i.test(id)) return 'Equilibrado';
    return '';
};

const ModelSelector = ({ selectedModel, setSelectedModel, showLabel = true, className = "" }) => {
    const [models, setModels] = useState(FALLBACK_GEMINI);

    // Fetch the live list of Gemini models for this API key (mirrors AIInsights).
    useEffect(() => {
        const key = import.meta.env.VITE_GEMINI_API_KEY;
        if (!key) return;
        const ctrl = new AbortController();
        fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: ctrl.signal })
            .then(r => r.ok ? r.json() : null)
            .then(j => {
                // Exclude non-chat variants: robotics, TTS, image gen, audio, embeddings, etc.
                const EXCLUDE = /robotics|tts|image|audio|embedding|aqa|vision|nano|gemma|learnlm/i;
                const list = (j?.models ?? [])
                    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                    .filter(m => m.name?.includes('gemini'))
                    .filter(m => !EXCLUDE.test(m.name) && !EXCLUDE.test(m.displayName || ''))
                    .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name.replace('models/', '') }))
                    .sort((a, b) => b.id.localeCompare(a.id));
                if (list.length) setModels(list);
            })
            .catch(() => { /* keep fallback */ });
        return () => ctrl.abort();
    }, []);

    // Keep the selected model valid against the available list.
    useEffect(() => {
        if (models.length && !models.some(m => m.id === selectedModel)) {
            setSelectedModel(models[0].id);
        }
    }, [models, selectedModel, setSelectedModel]);

    return (
        <div className={`flex flex-col sm:flex-row items-start sm:items-center gap-2 ${className}`}>
            <div className="flex items-center gap-1.5 flex-none px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-100">
                <SparklesIcon className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-700 whitespace-nowrap">Google Gemini</span>
            </div>
            <div className="flex-1 min-w-[210px] w-full">
                {showLabel && (
                    <Text className="mb-1 font-bold text-xs uppercase text-slate-400">Modelo</Text>
                )}
                <Select value={selectedModel} onValueChange={setSelectedModel} enableClear={false}>
                    {models.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center justify-between gap-3 w-full">
                                <span className="font-medium text-slate-700">{m.label}</span>
                                {tierOf(m.id) && <span className="text-[11px] text-slate-400 font-medium">{tierOf(m.id)}</span>}
                            </span>
                        </SelectItem>
                    ))}
                </Select>
            </div>
        </div>
    );
};

export { DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI };
export default ModelSelector;
