import React, { useEffect } from 'react';
import { Text, Select, SelectItem, TabGroup, TabList, Tab } from "@tremor/react";
import { BoltIcon, SparklesIcon, CpuChipIcon } from "@heroicons/react/24/solid";

/**
 * Reusable AI Model Selector component
 * Includes provider selection (Groq/Gemini/Anthropic) and model selection
 */
const ModelSelector = ({
    provider,
    setProvider,
    selectedModel,
    setSelectedModel,
    showLabel = true,
    className = ""
}) => {
    // Reset model when provider changes
    useEffect(() => {
        if (provider === 'groq') setSelectedModel(m => m.startsWith('llama') || m.startsWith('mixtral') ? m : 'llama-3.1-8b-instant');
        else if (provider === 'gemini') setSelectedModel(m => m.startsWith('gemini') ? m : 'gemini-2.5-flash-lite');
        else if (provider === 'anthropic') setSelectedModel(m => m.startsWith('claude') ? m : 'claude-3-5-sonnet-latest');
    }, [provider, setSelectedModel]);

    const getProviderIndex = (p) => {
        if (p === 'groq') return 0;
        if (p === 'gemini') return 1;
        if (p === 'anthropic') return 2;
        return 0;
    };

    const handleIndexChange = (i) => {
        if (i === 0) setProvider('groq');
        else if (i === 1) setProvider('gemini');
        else if (i === 2) setProvider('anthropic');
    };

    return (
        <div className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 ${className}`}>
            {/* Provider Tabs */}
            <div className="flex-none">
                <TabGroup
                    index={getProviderIndex(provider)}
                    onIndexChange={handleIndexChange}
                >
                    <TabList variant="solid" className="bg-slate-100 dark:bg-slate-800">
                        <Tab icon={BoltIcon}>Groq</Tab>
                        <Tab icon={SparklesIcon}>Gemini</Tab>
                        <Tab icon={CpuChipIcon}>Claude</Tab>
                    </TabList>
                </TabGroup>
            </div>

            {/* Model Selection */}
            <div className="flex-1 min-w-[200px] w-full">
                {showLabel && (
                    <Text className="mb-1 font-bold text-xs uppercase text-slate-400">Modelo</Text>
                )}
                <Select value={selectedModel} onValueChange={setSelectedModel} enableClear={false}>
                    {/* Groq Models */}
                    {provider === 'groq' && <SelectItem value="llama-3.1-8b-instant">⚡ Llama 3.1 8B Instant</SelectItem>}
                    {provider === 'groq' && <SelectItem value="llama-3.3-70b-versatile">🧠 Llama 3.3 70B</SelectItem>}
                    {provider === 'groq' && <SelectItem value="mixtral-8x7b-32768">🌀 Mixtral 8x7B</SelectItem>}

                    {/* Gemini Models */}
                    {provider === 'gemini' && <SelectItem value="gemini-2.5-flash-lite">🆕 Gemini 2.5 Flash Lite</SelectItem>}
                    {provider === 'gemini' && <SelectItem value="gemini-2.5-flash">⚡ Gemini 2.5 Flash</SelectItem>}
                    {provider === 'gemini' && <SelectItem value="gemini-2.0-flash">🚀 Gemini 2.0 Flash</SelectItem>}
                    {provider === 'gemini' && <SelectItem value="gemini-2.0-pro-exp-02-05">🧪 Gemini 2.0 Pro Exp</SelectItem>}

                    {/* Anthropic Models */}
                    {provider === 'anthropic' && <SelectItem value="claude-3-5-sonnet-latest">🧠 Claude 3.5 Sonnet</SelectItem>}
                    {provider === 'anthropic' && <SelectItem value="claude-3-5-haiku-20241022">⚡ Claude 3.5 Haiku</SelectItem>}
                    {provider === 'anthropic' && <SelectItem value="claude-3-opus-latest">🎓 Claude 3 Opus</SelectItem>}
                </Select>
            </div>
        </div>
    );
};

export default ModelSelector;
