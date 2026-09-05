import React, { useEffect, useState, useMemo } from 'react';
import { SparklesIcon } from "@heroicons/react/24/solid";
import {
    fetchModelGroups,
    buildModelGroups,
    parseModelValue,
    PROVIDER_LABELS,
    DEFAULT_GEMINI_MODEL,
    FALLBACK_GEMINI,
} from '../services/ai';
import useAIModel from '../hooks/useAIModel';

/**
 * Selector ÚNICO de modelo IA de la app (vive en el menú de usuario).
 *
 * No recibe ni el valor ni el setter: lee y escribe la preferencia global
 * (ver lib/aiModel). El resto de herramientas —sugerencia, planner, predictor,
 * chat— solo consumen esa preferencia con useAIModel(), así que cambiar el
 * modelo aquí las afecta a todas a la vez.
 *
 * Agrupa por empresa (Google Gemini, Z.ai, Groq, OpenRouter) con <optgroup> y
 * la lista viva de /api/ai/models; cae a una lista estática si no responde.
 */
const ModelSelector = ({ disabled = false, showLabel = true, className = "" }) => {
    const [selectedModel, setSelectedModel] = useAIModel();
    // Empieza con el grupo Gemini de reserva; se reemplaza con la lista viva.
    const [groups, setGroups] = useState(() => buildModelGroups({ gemini: FALLBACK_GEMINI }));

    useEffect(() => {
        const ctrl = new AbortController();
        fetchModelGroups(ctrl.signal)
            .then(g => { if (g.length) setGroups(g); })
            .catch(() => { /* keep fallback */ });
        return () => ctrl.abort();
    }, []);

    // Mantiene el valor seleccionado válido contra la lista disponible: si el
    // modelo guardado ya no existe se cae al primero disponible.
    const allValues = useMemo(() => groups.flatMap(g => g.options.map(o => o.value)), [groups]);
    useEffect(() => {
        if (allValues.length && !allValues.includes(selectedModel)) {
            setSelectedModel(allValues[0]);
        }
    }, [allValues, selectedModel, setSelectedModel]);

    const providerLabel = PROVIDER_LABELS[parseModelValue(selectedModel).provider] ?? 'IA';

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <div className="flex items-center gap-1.5 flex-none px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-100">
                <SparklesIcon className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-blue-700 whitespace-nowrap">{providerLabel}</span>
            </div>
            {showLabel && (
                <span className="font-bold text-xs uppercase text-slate-400 whitespace-nowrap">Modelo</span>
            )}
            <select
                value={selectedModel}
                disabled={disabled}
                onChange={e => setSelectedModel(e.target.value)}
                aria-label="Modelo de IA"
                className="flex-1 min-w-0 text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 pr-7 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none shadow-sm truncate"
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

export { DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI };
export default ModelSelector;
