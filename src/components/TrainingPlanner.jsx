import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import { Card, Grid, Title, Text, Metric, Button, NumberInput, Select, SelectItem, Badge, Callout, Divider, CategoryBar, DonutChart, Legend } from "@tremor/react";
import { PlayCircleIcon, FireIcon, HandRaisedIcon, FlagIcon, ClockIcon, CpuChipIcon, SparklesIcon } from "@heroicons/react/24/solid";
import { BoltIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import ModelSelector from './ModelSelector';

// Define the schema for the training plan
const PlanSchema = z.object({
    analysis: z.string().describe("Análisis breve (max 60 palabras) del estado del corredor."),
    weekly_summary: z.string().describe("Enfoque de esta semana según periodización."),
    stats: z.object({
        total_dist_km: z.number().describe("Distancia total estimada en km."),
        total_time_min: z.number().describe("Tiempo total estimado en minutos."),
        distribution: z.object({
            easy: z.number().describe("Porcentaje Zona 1-2 aeróbico (>75)."),
            moderate: z.number().describe("Porcentaje Zona 3 umbral/tempo (~10-15)."),
            hard: z.number().describe("Porcentaje Zona 4-5 VO2max/velocidad (~5-10)."),
        }),
    }),
    schedule: z.array(z.object({
        day: z.string().describe("Nombre del día (ej: 'Lunes')."),
        type: z.string().describe("Categoría de la sesión."),
        daily_stats: z.object({
            dist: z.string().describe("Distancia (ej: '12 km')."),
            time: z.string().describe("Tiempo estimado (ej: '65 min')."),
        }).optional(),
        summary: z.string().describe("Objetivo de la sesión y zonas de trabajo."),
        structured_workout: z.array(z.object({
            phase: z.string().describe("Fase del entrenamiento (Calentamiento, Bloque Principal, etc)."),
            duration_min: z.number().describe("Duración en minutos."),
            intensity: z.number().min(1).max(5).describe("Intensidad (1-5)."),
            description: z.string().describe("Descripción detallada del ejercicio."),
        })).optional().describe("Detalle de la estructura del entrenamiento."),
    })),
});

const TrainingPlanner = ({ activities }) => {
    const { t, i18n } = useTranslation();
    const [goalDist, setGoalDist] = useState('21k');

    const calculateSuggestedTime = () => {
        if (!activities || activities.length === 0) return '';
        const recentRuns = activities
            .filter(a => (a.distance / 1000) >= 3)
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
            .slice(0, 5);
        if (recentRuns.length === 0) return '';
        const avgPaceMinKm = recentRuns.reduce((acc, run) => acc + ((run.moving_time / 60) / (run.distance / 1000)), 0) / recentRuns.length;
        const targetPaceMinKm = avgPaceMinKm * 0.90;
        const suggestedTime = Math.round(targetPaceMinKm * 21);
        return suggestedTime.toString();
    };

    const [goalTime, setGoalTime] = useState(calculateSuggestedTime);
    const [weeks, setWeeks] = useState(4);
    const [selectedDays, setSelectedDays] = useState(['Mi', 'Sa']);
    const [provider, setProvider] = useState('groq');

    const apiKeys = {
        gemini: import.meta.env.VITE_GEMINI_API_KEY || '',
        groq: import.meta.env.VITE_GROQ_API_KEY || '',
        anthropic: import.meta.env.VITE_ANTHROPIC_API_KEY || ''
    };

    const [selectedModel, setSelectedModel] = useState('llama-3.1-8b-instant');
    const [loading, setLoading] = useState(false);
    const [plan, setPlan] = useState(null);
    const [error, setError] = useState('');

    const getRecentActivitiesSummary = () => {
        if (!activities || activities.length === 0) return t('hr_analysis.no_data');
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const recent = activities
            .filter(a => new Date(a.start_date) >= threeMonthsAgo)
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
            .map(a => {
                const distKm = (a.distance / 1000).toFixed(2);
                const timeMin = (a.moving_time / 60).toFixed(1);
                const pace = (a.moving_time / 60 / (a.distance / 1000)).toFixed(2);
                const date = new Date(a.start_date).toLocaleDateString();
                const hr = a.average_heartrate ? `${Math.round(a.average_heartrate)} ppm` : 'Sin datos FC';
                const elev = `${Math.round(a.total_elevation_gain)}m`;
                return `- ${date}: ${distKm}km em ${timeMin}min (Ritmo ${pace} min/km). FC: ${hr}. Desnivel: ${elev}.`;
            });
        return recent.join('\n');
    };

    const generateAIPlan = async (e) => {
        e.preventDefault();
        const activeKey = apiKeys[provider];
        if (!activeKey) {
            setError(t('auth.login_error', { provider: provider.charAt(0).toUpperCase() + provider.slice(1) }));
            return;
        }
        setLoading(true);
        setError('');
        setPlan(null);
        try {
            const activityLog = getRecentActivitiesSummary();
            const daysCount = selectedDays.length;
            const daysStr = selectedDays.join(', ');
            let model;
            if (provider === 'groq') {
                const groq = createOpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: activeKey });
                model = groq(selectedModel);
            } else if (provider === 'anthropic') {
                const anthropic = createAnthropic({ apiKey: activeKey });
                model = anthropic(selectedModel);
            } else {
                const google = createGoogleGenerativeAI({ apiKey: activeKey });
                model = google(selectedModel);
            }
            const prompt = t('planner.prompt', { 
                history: activityLog, 
                dist: t(`planner.distances.${goalDist}`), 
                time: goalTime, 
                daysCount: daysCount, 
                daysStr: daysStr 
            });
            const { object } = await generateObject({ model, schema: PlanSchema, prompt, temperature: 0.7 });
            setPlan(object);
            setLoading(false);
        } catch (err) {
            console.error("Error generando plan:", err);
            setError(err.message || "Error desconocido");
            setLoading(false);
        }
    };

    const exportToPDF = (plan) => {
        const doc = new jsPDF();
        const primaryColor = [37, 99, 235];
        doc.setFillColor(...primaryColor);
        doc.rect(0, 0, 210, 20, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(`${t('planner.title')} - RunAnalyzer`, 15, 13);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(14);
        doc.text(t('planner.analysis_title'), 15, 30);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        const splitSummary = doc.splitTextToSize(plan.weekly_summary, 180);
        doc.text(splitSummary, 15, 38);
        let yPos = 38 + (splitSummary.length * 5) + 10;
        const tableData = plan.schedule.map(day => [day.day, day.type, day.daily_stats ? `${day.daily_stats.dist}\n${day.daily_stats.time}` : '-', day.summary]);
        autoTable(doc, {
            startY: yPos,
            head: [[t('consistency.stats.active_days').slice(0, 3), t('dashboard.status'), t('planner.vol'), t('dashboard.activity')]],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: primaryColor, textColor: 255 },
            alternateRowStyles: { fillColor: [248, 250, 252] }
        });
        doc.save('plan-entrenamiento.pdf');
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* Header Section */}
            <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm transition-all hover:shadow-md mb-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl">
                            <SparklesIcon className="w-8 h-8" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-1.5 uppercase">{t('planner.title')}</h2>
                            <p className="text-slate-500 text-sm font-medium">{t('planner.subtitle')}</p>
                        </div>
                    </div>
                    <div className="p-1 px-3 bg-slate-50 rounded-xl border border-slate-100">
                        <ModelSelector
                            provider={provider}
                            setProvider={setProvider}
                            selectedModel={selectedModel}
                            setSelectedModel={setSelectedModel}
                            showLabel={false}
                        />
                    </div>
                </div>
            </div>

            {/* Config Card */}
            <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm mb-8">
                <form onSubmit={generateAIPlan} className="space-y-8">
                    <Grid numItems={1} numItemsSm={3} className="gap-8">
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('planner.goal_dist')}</label>
                            <Select value={goalDist} onValueChange={setGoalDist} enableClear={false}>
                                <SelectItem value="5k">{t('planner.distances.5k')}</SelectItem>
                                <SelectItem value="10k">{t('planner.distances.10k')}</SelectItem>
                                <SelectItem value="21k">{t('planner.distances.21k')}</SelectItem>
                                <SelectItem value="42k">{t('planner.distances.42k')}</SelectItem>
                            </Select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('planner.goal_time')}</label>
                            <NumberInput value={goalTime} onValueChange={setGoalTime} placeholder="ej. 45" min={15} />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('planner.weeks')}</label>
                            <Select value={String(weeks)} onValueChange={(v) => setWeeks(Number(v))} enableClear={false}>
                                {[3, 4, 6, 8, 12, 16].map(w => <SelectItem key={w} value={String(w)}>{w} {t('planner.weeks_unit')}</SelectItem>)}
                            </Select>
                        </div>
                    </Grid>

                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t('planner.days')}</label>
                        <div className="flex flex-wrap gap-2">
                            {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'].map(day => (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={() => setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])}
                                    className={`px-5 py-2.5 text-xs font-black transition-all rounded-xl border-2 ${selectedDays.includes(day) ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-100 scale-105' : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'}`}
                                >
                                    {day}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        disabled={loading}
                        type="submit"
                        className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all shadow-xl ${loading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]'}`}
                    >
                        {loading ? t('planner.analyzing') : t('planner.generate_btn')}
                    </button>
                </form>
                {error && <div className="mt-4 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl text-sm font-medium">{error}</div>}
            </div>

            {/* Plan Display */}
            {plan && (
                <div className="space-y-8 fade-in">
                    <div className="bg-white rounded-2xl p-8 border-l-8 border-blue-600 border border-slate-100 shadow-sm">
                        <div className="flex flex-col lg:flex-row gap-8">
                            <div className="flex-1">
                                <span className="uppercase text-[10px] font-black text-slate-400 tracking-widest mb-3 block">{t('planner.analysis_title')}</span>
                                <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight mb-4">{plan.weekly_summary}</h1>
                                <p className="text-lg text-slate-600 italic border-l-4 border-blue-100 pl-4">{plan.analysis}</p>
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 w-full lg:w-64">
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('planner.vol')}</p>
                                    <p className="text-2xl font-black text-blue-600">{plan.stats.total_dist_km} km</p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('planner.time')}</p>
                                    <p className="text-2xl font-black text-blue-600">{Math.floor(plan.stats.total_time_min / 60)}h {plan.stats.total_time_min % 60}m</p>
                                </div>
                            </div>
                        </div>
                        <div className="mt-8 pt-8 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6">
                            <div className="flex flex-wrap gap-4">
                                {[
                                    { z: 'Z1-2', v: plan.stats.distribution.easy, c: 'bg-emerald-500' },
                                    { z: 'Z3', v: plan.stats.distribution.moderate, c: 'bg-amber-500' },
                                    { z: 'Z4-5', v: plan.stats.distribution.hard, c: 'bg-rose-500' }
                                ].map(t => (
                                    <div key={t.z} className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-lg border border-slate-100">
                                        <div className={`w-2 h-2 rounded-full ${t.c}`} />
                                        <span className="text-[10px] font-black text-slate-600">{t.z}: {t.v}%</span>
                                    </div>
                                ))}
                            </div>
                            <button onClick={() => exportToPDF(plan)} className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all">
                                {t('planner.export_pdf')}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
                            Calendario Semanal
                            <div className="flex-1 h-px bg-slate-100" />
                        </h2>
                        {plan.schedule.map((day, idx) => {
                            const type = day.type.toLowerCase();
                            let color = "text-blue-600 bg-blue-50";
                            if (type.includes('series') || type.includes('velocidad')) color = "text-rose-600 bg-rose-50";
                            else if (type.includes('recup') || type.includes('suave')) color = "text-emerald-600 bg-emerald-50";
                            else if (type.includes('descanso')) color = "text-slate-400 bg-slate-100";

                            return (
                                <div key={idx} className={`bg-white rounded-2xl border border-slate-100 p-6 shadow-sm transition-all hover:shadow-md ${type.includes('descanso') ? 'opacity-60' : ''}`}>
                                    <div className="flex justify-between items-center mb-4">
                                        <div className="flex items-center gap-4">
                                            <div className="bg-slate-900 text-white px-3 py-1 rounded-lg text-xs font-black">{day.day}</div>
                                            <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${color}`}>{day.type}</div>
                                        </div>
                                        {day.daily_stats && (
                                            <div className="text-right">
                                                <p className="text-sm font-black text-slate-900">{day.daily_stats.dist} · {day.daily_stats.time}</p>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-slate-600 text-sm font-medium mb-4 leading-relaxed">{day.summary}</p>
                                    
                                    {day.structured_workout && day.structured_workout.length > 0 && (
                                        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 overflow-hidden relative">
                                            <div className="flex items-center gap-2 mb-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                <CpuChipIcon className="w-4 h-4" />
                                                {t('planner.structure')}
                                            </div>
                                            <div className="space-y-0 relative">
                                                <div className="absolute left-4 top-2 bottom-4 w-0.5 bg-slate-200" />
                                                {day.structured_workout.map((step, sIdx) => {
                                                    let dotColor = "bg-emerald-500";
                                                    if (step.intensity >= 4) dotColor = "bg-rose-500";
                                                    else if (step.intensity === 3) dotColor = "bg-amber-500";
                                                    
                                                    return (
                                                        <div key={sIdx} className="relative pl-10 pb-6 last:pb-0">
                                                            <div className={`absolute left-[13px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white ring-2 ring-slate-100 z-10 ${dotColor}`} />
                                                            <div className="bg-white rounded-xl p-4 border border-slate-100">
                                                                <div className="flex justify-between items-start mb-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-black text-slate-900 text-sm tracking-tight">{step.phase}</span>
                                                                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${dotColor} bg-opacity-10 ${dotColor.replace('bg-', 'text-')}`}>Z{step.intensity}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-1 text-slate-500 font-black text-xs tabular-nums">
                                                                        <ClockIcon className="w-3.5 h-3.5 opacity-50" />
                                                                        {step.duration_min}m
                                                                    </div>
                                                                </div>
                                                                <p className="text-xs text-slate-400 font-medium leading-relaxed">{step.description}</p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {!plan && !loading && (
                <div className="bg-white rounded-2xl p-16 border border-slate-100 shadow-sm text-center">
                    <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                        <SparklesIcon className="w-10 h-10" />
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight mb-2">{t('planner.empty_state_title')}</h3>
                    <p className="text-slate-500 font-medium max-w-sm mx-auto">{t('planner.empty_state_desc')}</p>
                </div>
            )}
        </div>
    );
};

export default TrainingPlanner;
