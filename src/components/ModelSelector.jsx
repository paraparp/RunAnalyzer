import React, { useEffect } from 'react';
import { Text, Select, SelectItem, TabGroup, TabList, Tab } from "@tremor/react";
import { BoltIcon, SparklesIcon } from "@heroicons/react/24/solid";

/**
 * Reusable AI Model Selector component
 * Includes provider selection (Groq/Gemini) and model selection
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
        if (provider === 'groq') setSelectedModel('llama-3.1-8b-instant');
        else setSelectedModel('gemini-2.5-flash-lite');
    }, [provider, setSelectedModel]);

    return (
        <div className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 ${className}`}>
            {/* Provider Tabs */}
            <TabGroup
                index={provider === 'groq' ? 0 : 1}
                onIndexChange={(i) => setProvider(i === 0 ? 'groq' : 'gemini')}
            >
                <TabList variant="solid" className="bg-slate-100 dark:bg-slate-800">
                    <Tab icon={BoltIcon}>Groq ⚡</Tab>
                    <Tab icon={SparklesIcon}>Gemini 🧠</Tab>
                </TabList>
            </TabGroup>

            {/* Model Selection */}
            <div className="flex-1 min-w-[200px]">
                {showLabel && (
                    <Text className="mb-1 font-bold text-xs uppercase text-slate-400">Modelo</Text>
                )}
                <Select value={selectedModel} onValueChange={setSelectedModel} enableClear={false}>
                    {provider === 'groq' && <SelectItem key="llama-8b" value="llama-3.1-8b-instant">⚡ Llama 3.1 8B Instant</SelectItem>}
                    {provider === 'groq' && <SelectItem key="llama-70b" value="llama-3.3-70b-versatile">🧠 Llama 3.3 70B</SelectItem>}
                    {provider === 'groq' && <SelectItem key="mixtral" value="mixtral-8x7b-32768">🌀 Mixtral 8x7B</SelectItem>}
                    {provider !== 'groq' && <SelectItem key="gemini-lite" value="gemini-2.5-flash-lite">🆕 Gemini 2.5 Flash Lite</SelectItem>}
                    {provider !== 'groq' && <SelectItem key="gemini-flash" value="gemini-2.5-flash">⚡ Gemini 2.5 Flash</SelectItem>}
                    {provider !== 'groq' && <SelectItem key="gemini-2" value="gemini-2.0-flash">🚀 Gemini 2.0 Flash</SelectItem>}
                </Select>
            </div>
        </div>
    );
};

export default ModelSelector;
