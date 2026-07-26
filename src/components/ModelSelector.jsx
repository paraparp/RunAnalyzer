import React, { useEffect, useState } from 'react';
import { Text } from "@tremor/react";
import { SparklesIcon } from "@heroicons/react/24/solid";
import {
    fetchModelGroups,
    buildModelGroups,
    parseModelValue,
    normalizeModelValue,
    PROVIDER_LABELS,
    DEFAULT_GEMINI_MODEL,
    FALLBACK_GEMINI,
    toModelValue,
} from '../services/ai';

/**
 * Selector de modelo IA unificado (sugerencia, planner, predictor, chat).
 * Agrupa por empresa (Google Gemini, Z.ai, Groq, OpenRouter) con <optgroup> y
 * la lista viva de /api/ai/models; cae a una lista estática si no responde.
 *
 * El valor es "provider|model" (ver parseModelValue). Componente controlado: el
 * padre posee `selectedModel` y su persistencia.
 */

// Valor por defecto normalizado ("gemini|gemini-3.1-flash-lite").
const DEFAULT_MODEL_VALUE = toModelValue('gemini', DEFAULT_GEMINI_MODEL);

const ModelSelector = ({ selectedModel, setSelectedModel, disabled = false, showLabel = true, className = "" }) => {
    // Empieza con el grupo Gemini de reserva; se reemplaza con la lista viva.
    const [groups, setGroups] = useState(() => buildModelGroups({ gemini: FALLBACK_GEMINI }));

    useEffect(() => {
        const ctrl = new AbortController();
        fetchModelGroups(ctrl.signal)
            .then(g => { if (g.length) setGroups(g); })
            .catch(() => { /* keep fallback */ });
        return () => ctrl.abort();
    }, []);

    // Mantiene el valor seleccionado válido contra la lista disponible.
    const allValues = groups.flatMap(g => g.options.map(o => o.value));
    const currentValue = normalizeModelValue(selectedModel);
    useEffect(() => {
        if (allValues.length && !allValues.includes(currentValue)) {
            setSelectedModel(allValues[0]);
        }
    }, [allValues.join(','), currentValue, setSelectedModel]);

    const providerLabel = PROVIDER_LABELS[parseModelValue(currentValue).provider] ?? 'IA';

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <div className="flex items-center gap-1.5 flex-none px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-100">
                <SparklesIcon className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-700 whitespace-nowrap">{providerLabel}</span>
            </div>
            {showLabel && (
                <Text className="font-bold text-xs uppercase text-slate-400 whitespace-nowrap">Modelo</Text>
            )}
            <select
                value={currentValue}
                disabled={disabled}
                onChange={e => setSelectedModel(e.target.value)}
                className="text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 pr-7 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none shadow-sm max-w-[220px] truncate"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
                {groups.map(g => (
                    <optgroup key={g.provider} label={g.label}>
                        {g.options.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </div>
    );
};

export { DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI, DEFAULT_MODEL_VALUE };
export default ModelSelector;
