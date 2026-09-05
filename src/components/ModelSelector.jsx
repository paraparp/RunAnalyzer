import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  SparklesIcon,
  BoltIcon,
  GlobeAltIcon,
  CpuChipIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/solid';
import {
  fetchModelGroups,
  buildModelGroups,
  parseModelValue,
  PROVIDER_LABELS,
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI,
} from '../services/ai';
import useAIModel from '../hooks/useAIModel';

// Metadatos visuales por proveedor
const PROVIDER_METADATA = {
  gemini: {
    label: 'Google Gemini',
    shortName: 'Gemini',
    icon: SparklesIcon,
    theme: {
      badge: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
      activeRing: 'ring-blue-500 border-blue-500 bg-blue-50/70 dark:bg-blue-950/40',
      tag: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
      dot: 'bg-blue-600',
    },
    hint: 'Máxima precisión y salida estructurada',
  },
  groq: {
    label: 'Groq',
    shortName: 'Groq',
    icon: BoltIcon,
    theme: {
      badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
      activeRing: 'ring-amber-500 border-amber-500 bg-amber-50/70 dark:bg-amber-950/40',
      tag: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
      dot: 'bg-amber-600',
    },
    hint: 'Ultra rápido con hardware LPU',
  },
  zai: {
    label: 'Z.ai (GLM)',
    shortName: 'Z.ai',
    icon: CpuChipIcon,
    theme: {
      badge: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800',
      activeRing: 'ring-purple-500 border-purple-500 bg-purple-50/70 dark:bg-purple-950/40',
      tag: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200',
      dot: 'bg-purple-600',
    },
    hint: 'Modelo gratuito para chat y consultas',
  },
  openrouter: {
    label: 'OpenRouter',
    shortName: 'OpenRouter',
    icon: GlobeAltIcon,
    theme: {
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
      activeRing: 'ring-emerald-500 border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40',
      tag: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
      dot: 'bg-emerald-600',
    },
    hint: 'Catálogo de modelos abiertos gratuitos',
  },
};

/**
 * Desglosa la etiqueta original (ej: "3.8 Flash", "3.7 Flash · versión anterior")
 * en un título legible y una etiqueta/badge descriptiva.
 */
function parseOptionLabel(optLabel, modelId, provider) {
  let title = optLabel;
  let tag = null;

  if (optLabel.includes(' · ')) {
    const parts = optLabel.split(' · ');
    title = parts[0];
    tag = parts[1];
  }

  // Resaltar el modelo por defecto recomendado
  if (provider === 'gemini' && modelId === DEFAULT_GEMINI_MODEL && !tag) {
    tag = 'Recomendado';
  }

  return { title, tag };
}

/**
 * Selector ÚNICO de modelo IA de la app.
 *
 * Lee y escribe la preferencia global con useAIModel().
 * Todas las herramientas de IA (Coach, Planner, Predictor, Q&A) comparten
 * este ajuste centralizado.
 */
const ModelSelector = ({
  disabled = false,
  showLabel = true,
  className = '',
  mode = 'card', // 'card', 'menu', 'compact'
  onSelect,
}) => {
  const [selectedModel, setSelectedModel] = useAIModel();
  const [groups, setGroups] = useState(() => buildModelGroups({ gemini: FALLBACK_GEMINI }));
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setIsLoading(true);
    fetchModelGroups(ctrl.signal)
      .then((g) => {
        if (g.length) setGroups(g);
      })
      .catch(() => {
        /* keep fallback */
      })
      .finally(() => setIsLoading(false));
    return () => ctrl.abort();
  }, []);

  // Mantiene el valor seleccionado válido si el modelo desaparece
  const allValues = useMemo(() => groups.flatMap((g) => g.options.map((o) => o.value)), [groups]);
  useEffect(() => {
    if (allValues.length && !allValues.includes(selectedModel)) {
      setSelectedModel(allValues[0]);
    }
  }, [allValues, selectedModel, setSelectedModel]);

  const { provider, model } = parseModelValue(selectedModel);
  const currentMeta = PROVIDER_METADATA[provider] || PROVIDER_METADATA.gemini;
  const CurrentIcon = currentMeta.icon;

  // Obtener nombre bonito del modelo actual
  const currentOption = useMemo(() => {
    for (const g of groups) {
      for (const opt of g.options) {
        if (opt.value === selectedModel) return opt;
      }
    }
    return null;
  }, [groups, selectedModel]);

  const currentParsed = useMemo(() => {
    return parseOptionLabel(currentOption?.label || model, model, provider);
  }, [currentOption, model, provider]);

  // Filtrado por búsqueda
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase().trim();
    return groups
      .map((g) => ({
        ...g,
        options: g.options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            o.value.toLowerCase().includes(q) ||
            (PROVIDER_METADATA[g.provider]?.label || '').toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, searchQuery]);

  const handleChoose = (val) => {
    if (disabled) return;
    setSelectedModel(val);
    setIsExpanded(false);
    onSelect?.(val);
  };

  const totalOptionsCount = useMemo(
    () => groups.reduce((acc, g) => acc + g.options.length, 0),
    [groups]
  );

  // Variante Compacta (estilo botón píldora minimalista)
  if (mode === 'compact') {
    return (
      <div className={`relative ${className}`}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsExpanded((prev) => !prev)}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all ${currentMeta.theme.badge} hover:shadow-sm focus:outline-none`}
        >
          <CurrentIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate max-w-[120px]">{currentParsed.title}</span>
          <ChevronDownIcon
            className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>

        {isExpanded && (
          <div className="absolute right-0 mt-2 w-72 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50">
            {renderGroupsList()}
          </div>
        )}
      </div>
    );
  }

  // Renderizador de la lista de modelos
  function renderGroupsList() {
    return (
      <div className="space-y-3">
        {/* Barra de búsqueda si hay varios modelos */}
        {totalOptionsCount > 5 && (
          <div className="relative">
            <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar modelo..."
              className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-blue-400"
            />
          </div>
        )}

        {/* Lista con scroll suave */}
        <div className="max-h-64 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
          {filteredGroups.map((g) => {
            const meta = PROVIDER_METADATA[g.provider] || PROVIDER_METADATA.gemini;
            const IconComponent = meta.icon;

            return (
              <div key={g.provider} className="space-y-1.5">
                {/* Encabezado del Proveedor */}
                <div className="flex items-center justify-between px-1.5 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <IconComponent className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                    <span>{meta.label}</span>
                  </div>
                  <span className="text-[10px] font-medium lowercase tracking-normal">
                    {g.options.length} {g.options.length === 1 ? 'modelo' : 'modelos'}
                  </span>
                </div>

                {/* Tarjetas de opciones */}
                <div className="space-y-1">
                  {g.options.map((opt) => {
                    const isSelected = opt.value === selectedModel;
                    const { model: optModelId } = parseModelValue(opt.value);
                    const { title, tag } = parseOptionLabel(opt.label, optModelId, g.provider);

                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleChoose(opt.value)}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left transition-all group ${
                          isSelected
                            ? 'bg-blue-50/90 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100 shadow-xs'
                            : 'bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/90 dark:hover:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/50 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold truncate leading-snug">
                              {title}
                            </span>
                            {tag && (
                              <span
                                className={`text-[9.5px] font-medium px-1.5 py-0.2 rounded-md shrink-0 uppercase tracking-wider ${
                                  isSelected
                                    ? 'bg-blue-200/70 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                    : 'bg-slate-200/70 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {tag}
                              </span>
                            )}
                          </div>
                        </div>

                        {isSelected ? (
                          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                            <CheckIcon className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 group-hover:border-blue-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {filteredGroups.length === 0 && (
            <p className="text-xs text-center text-slate-400 py-3">
              No se encontraron modelos con "{searchQuery}"
            </p>
          )}
        </div>
      </div>
    );
  }

  // Variante Predeterminada y para Menú (Tarjeta interactiva expandible)
  return (
    <div className={`space-y-2 ${className}`}>
      {showLabel && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Motor IA
          </span>
          {isLoading && (
            <div className="flex items-center gap-1 text-[10px] text-slate-400 animate-pulse">
              <ArrowPathIcon className="w-2.5 h-2.5 animate-spin" />
              <span>Sincronizando</span>
            </div>
          )}
        </div>
      )}

      {/* Tarjeta del Modelo Activo (Clic para expandir opciones) */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsExpanded((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border transition-all text-left group ${
          isExpanded
            ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500/20'
            : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 hover:border-slate-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer shadow-xs'}`}
        aria-expanded={isExpanded}
        aria-label="Seleccionar modelo de IA"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Badge del proveedor con icono */}
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-lg border shrink-0 ${currentMeta.theme.badge}`}
          >
            <CurrentIcon className="w-4 h-4" />
          </div>

          {/* Información del modelo */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                {currentParsed.title}
              </span>
              {currentParsed.tag && (
                <span
                  className={`text-[9.5px] font-semibold px-1.5 py-0.2 rounded-md shrink-0 uppercase tracking-wider ${currentMeta.theme.tag}`}
                >
                  {currentParsed.tag}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">
              {currentMeta.label} · {currentMeta.hint}
            </p>
          </div>
        </div>

        {/* Indicador de alternancia */}
        <div className="flex items-center gap-1 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">
            {isExpanded ? 'Cerrar' : 'Cambiar'}
          </span>
          {isExpanded ? (
            <ChevronUpIcon className="w-4 h-4" />
          ) : (
            <ChevronDownIcon className="w-4 h-4" />
          )}
        </div>
      </button>

      {/* Panel Desplegable de Selección de Modelos */}
      {isExpanded && (
        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-lg animate-in fade-in slide-in-from-top-1 duration-150">
          {renderGroupsList()}
        </div>
      )}
    </div>
  );
};

export { DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI };
export default ModelSelector;
