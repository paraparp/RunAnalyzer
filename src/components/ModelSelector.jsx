import React, { useEffect, useState } from 'react';
import { Text } from "@tremor/react";
import { SparklesIcon } from "@heroicons/react/24/solid";

/**
 * Google Gemini model selector — unified across every AI feature (AI suggestion,
 * planner, race predictor, chat). Renders the compact native <select> used by the
 * AI suggestion panel. Fetches the live list of models from the ListModels
 * endpoint and falls back to a static list when unavailable.
 *
 * Controlled component: the parent owns `selectedModel` (and any persistence).
 */

// Fallback list used when the ListModels API can't be reached.
const FALLBACK_GEMINI = [
    { id: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite · menos tokens' },
    { id: 'gemini-3.5-flash', label: '3.5 Flash · mejor calidad' },
    { id: 'gemini-2.5-flash', label: '2.5 Flash · equilibrado' },
];

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const ModelSelector = ({ selectedModel, setSelectedModel, disabled = false, showLabel = true, className = "" }) => {
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
        <div className={`flex items-center gap-2 ${className}`}>
            <div className="flex items-center gap-1.5 flex-none px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-100">
                <SparklesIcon className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-700 whitespace-nowrap">Google Gemini</span>
            </div>
            {showLabel && (
                <Text className="font-bold text-xs uppercase text-slate-400 whitespace-nowrap">Modelo</Text>
            )}
            <select
                value={selectedModel}
                disabled={disabled}
                onChange={e => setSelectedModel(e.target.value)}
                className="text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 pr-7 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none shadow-sm max-w-[220px] truncate"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
                {models.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                ))}
            </select>
        </div>
    );
};

export { DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI };
export default ModelSelector;
