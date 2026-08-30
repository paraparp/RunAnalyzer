import React, { useState, useEffect, useRef } from 'react';
import cloudStorage from '../lib/cloudStorage';
import useGarminWearableData from '../hooks/useGarminWearableData';
import { useTranslation } from 'react-i18next';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { generateAIObjectWithFallback, parseModelValue } from '../services/ai';
import { Card, Grid, Title, Text, Metric, Button, NumberInput, Select, SelectItem, Badge, Callout, Divider, CategoryBar, DonutChart, Legend } from "@tremor/react";
import { PlayCircleIcon, FireIcon, HandRaisedIcon, FlagIcon, ClockIcon, CpuChipIcon, SparklesIcon } from "@heroicons/react/24/solid";
import { BoltIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import ModelSelector, { DEFAULT_GEMINI_MODEL } from './ModelSelector';
import AIToolHeader from './AIToolHeader';
import { formatPaceFromMinPerKm } from '../lib/timeFormat';
import { buildPrompt, buildPlainActivityLog } from '../lib/athleteContext';
import { getTargetRaces, getPrimaryTargetRace, daysUntil, formatMinutes, TARGET_RACES_EVENT } from '../lib/targetRaces';
import { DISTANCE_KM } from '../lib/raceDistances';

// Prompt del plan — vive en código y siempre en español (antes estaba duplicado
// en i18n en dos idiomas que podían divergir y mezclaba idioma con el
// athleteContext, que es español, igual que los schemas Zod del servidor).
const buildPlannerPrompt = ({ history, dist, time, weeks, daysCount, daysStr }) => {
    const goal = time
        ? `Correr ${dist} en ${time} minutos`
        : `Correr ${dist} (sin tiempo meta fijado: propón un objetivo realista a partir de las MARCAS PERSONALES y la forma actual del contexto, y dilo en el análisis)`;
    return `Actúa como un fisiólogo deportivo de élite y entrenador de running profesional que aplica ciencia validada del entrenamiento (modelo PMC de Banister CTL/ATL/TSB, polarizado 80/20 de Seiler, ratio agudo:crónico de Gabbett para riesgo de lesión).

CONTEXTO DEL ATLETA (datos científicos — carga de entrenamiento, ACWR, zonas de FC, ritmos de referencia, marcas personales, distribución polarizada, wearable):
${history}

OBJETIVO: ${goal}. Horizonte del plan: ${weeks} semanas. Disponibilidad: ${daysCount} día(s) (${daysStr}).

REGLAS:
- 80/20 polarizado; mantén segura la rampa de carga semanal (ACWR ~0,8–1,3); dimensiona el volumen al CTL actual.
- Este plan cubre la SEMANA 1 de las ${weeks} disponibles: periodízala como el inicio del camino al objetivo (base → construcción → específico → taper según el tiempo restante).
- Usa los ritmos de referencia y las zonas de FC EXACTOS del contexto; PROHIBIDO inventar cifras que no salgan de esos anclajes. Si un dato no está, no lo estimes.
- CALIDAD OBLIGATORIA salvo excepción: si hay ≥2 días disponibles Y el READINESS SCORE permite intensidad (≥62) Y no es semana de descarga/taper, incluye AL MENOS una sesión de calidad con SERIES/INTERVALOS reales expresadas como repeticiones (campo "reps": N × "duration_min"′), con "pace" del ancla "Intervalos/series" (o "Tempo/umbral" si es tempo), "recovery" concreta entre reps (ej: 90″ trote) y "hr" del rango de zona. Empieza conservador (pocas reps) por ser la semana 1.
  EXCEPCIONES en las que NO metes series (haz rodaje/tirada de calidad en su lugar y dilo): CTL bajo/fase base pura donde el limitante es el VOLUMEN, readiness <62, o carga cruzada que ya cubre la intensidad del 80/20.
- Toda sesión de calidad lleva "Calentamiento" (trote progresivo + alguna progresión) y "Vuelta a la calma"; nunca empieces en frío ni acabes en seco.
- "hrv_guidance": da la regla verde/ámbar/rojo de auto-regulación del día duro según la VFC/readiness al despertar.
- Los porcentajes de distribución (easy/moderate/hard) deben cuadrar con las sesiones prescritas.
- GENERA EXACTAMENTE ${daysCount} SESIÓN(ES), una por día disponible, en los días indicados.`;
};


const TrainingPlanner = ({ activities }) => {
    const { t } = useTranslation();
    const [selectedDays, setSelectedDays] = useState(['Mi', 'Sa']);
    // Aborta la petición en curso al desmontar (evita setState sobre desmontado).
    const abortRef = useRef(null);
    useEffect(() => () => abortRef.current?.abort(), []);

    // El objetivo del plan es la carrera objetivo seleccionada (gestionadas en la
    // sección "Carreras Objetivo"). Distancia, tiempo meta y duración del plan se
    // derivan de ella; aquí solo se eligen los días de entrenamiento.
    const [targetRaces, setTargetRaces] = useState(getTargetRaces);
    const [selectedRaceId, setSelectedRaceId] = useState(() => getPrimaryTargetRace()?.id || '');
    useEffect(() => {
        const reload = () => {
            const list = getTargetRaces();
            setTargetRaces(list);
            // Si la seleccionada desaparece, se vuelve a la principal.
            setSelectedRaceId(prev => (list.some(r => r.id === prev) ? prev : (getPrimaryTargetRace()?.id || '')));
        };
        window.addEventListener(TARGET_RACES_EVENT, reload);
        return () => window.removeEventListener(TARGET_RACES_EVENT, reload);
    }, []);

    const selectedRace = targetRaces.find(r => r.id === selectedRaceId) || null;
    const goalDist = selectedRace?.distance || '21k';
    const goalTime = selectedRace?.goalTimeMin != null ? String(Math.round(selectedRace.goalTimeMin)) : '';
    // Días hasta la carrera: negativo = ya pasó (se bloquea el plan y se avisa,
    // antes se clampaba en silencio a un plan de 1 semana hacia una carrera pasada).
    const daysToRace = selectedRace ? daysUntil(selectedRace.date) : null;
    const racePassed = daysToRace != null && daysToRace < 0;
    // Duración del plan = semanas hasta la carrera (acotado 1–24); 8 si no hay fecha.
    const weeks = (() => {
        if (daysToRace == null) return 8;
        return Math.min(24, Math.max(1, Math.round(daysToRace / 7)));
    })();

    const [selectedModel, setSelectedModel] = useState(
        () => cloudStorage.getItem('planner_model') || DEFAULT_GEMINI_MODEL
    );
    useEffect(() => { try { cloudStorage.setItem('planner_model', selectedModel); } catch { /* ignore */ } }, [selectedModel]);
    const [loading, setLoading] = useState(false);
    const [plan, setPlan] = useState(null);
    const [error, setError] = useState('');

    // Wearable context (HRV / sleep), same sources as the AI suggestion panel.
    const { garmin, sleep } = useGarminWearableData();

    // Rich athlete context (PMC/CTL-ATL-TSB, ACWR, HR zones, reference paces, PBs,
    // polarized distribution, wearable) — reuses the AI suggestion builder so the
    // plan is grounded in the same science. Falls back to a plain run list.
    const buildPlanContext = (daysCount) => {
        try {
            const km = (goalTime && Number(goalTime) > 0 && DISTANCE_KM[goalDist]) || 0;
            let pace;
            if (km > 0) {
                const p = Number(goalTime) / km;
                pace = formatPaceFromMinPerKm(p, null);
            }
            const { athleteContext } = buildPrompt(
                activities, garmin, sleep, daysCount,
                { distance: goalDist.toUpperCase(), pace }
            );
            return athleteContext || buildPlainActivityLog(activities) || t('hr_analysis.no_data');
        } catch {
            return buildPlainActivityLog(activities) || t('hr_analysis.no_data');
        }
    };

    const generateAIPlan = async (e) => {
        e.preventDefault();
        if (!selectedRace) {
            setError(t('planner.no_target_desc'));
            return;
        }
        if (racePassed) {
            setError(t('planner.race_passed'));
            return;
        }
        setLoading(true);
        setError('');
        setPlan(null);
        try {
            const daysCount = selectedDays.length;
            const daysStr = selectedDays.join(', ');
            const activityLog = buildPlanContext(daysCount);
            const prompt = buildPlannerPrompt({
                history: activityLog,
                dist: t(`planner.distances.${goalDist}`),
                time: goalTime,
                weeks: weeks,
                daysCount: daysCount,
                daysStr: daysStr
            });
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            // 0.5: la prescripción debe ser consistente entre ejecuciones, no creativa.
            const object = await generateAIObjectWithFallback({ ...parseModelValue(selectedModel), prompt, temperature: 0.5, schema: 'plan', signal: controller.signal });
            setPlan(object);
            setLoading(false);
        } catch (err) {
            if (err?.name === 'AbortError') return; // desmontado o cancelado
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
            head: [[t('planner.pdf.day'), t('planner.pdf.type'), t('planner.pdf.vol'), t('planner.pdf.session')]],
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
            <AIToolHeader title={t('planner.title')} subtitle={t('planner.subtitle')}>
                <ModelSelector
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    disabled={loading}
                    showLabel={false}
                />
            </AIToolHeader>

            {/* Config Card */}
            <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm mb-8">
                <form onSubmit={generateAIPlan} className="space-y-8">
                    {targetRaces.length === 0 ? (
                        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl">
                            <FlagIcon className="w-10 h-10 text-blue-400 mx-auto mb-3" />
                            <h3 className="text-base font-black text-slate-900 mb-1">{t('planner.no_target_title')}</h3>
                            <p className="text-slate-500 text-sm font-medium max-w-sm mx-auto">{t('planner.no_target_desc')}</p>
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{t('planner.target_race')}</label>
                                <Select value={selectedRaceId} onValueChange={setSelectedRaceId} enableClear={false}>
                                    {targetRaces.map(r => (
                                        <SelectItem key={r.id} value={r.id}>
                                            {r.primary ? '★ ' : ''}{r.name}{r.date ? ` · ${new Date(r.date + 'T00:00:00').toLocaleDateString()}` : ''}
                                        </SelectItem>
                                    ))}
                                </Select>
                                {racePassed && (
                                    <p className="mt-2 text-xs font-semibold text-amber-600">⚠ {t('planner.race_passed')}</p>
                                )}
                            </div>

                            {/* Objetivo derivado de la carrera seleccionada */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('planner.goal_dist')}</p>
                                    <p className="text-sm font-black text-slate-900">{t(`planner.distances.${goalDist}`)}</p>
                                </div>
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('targets.goal_time')}</p>
                                    <p className="text-sm font-black text-slate-900">{selectedRace?.goalTimeMin != null ? formatMinutes(selectedRace.goalTimeMin) : '—'}</p>
                                </div>
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('planner.weeks')}</p>
                                    <p className="text-sm font-black text-slate-900">{weeks} {t('planner.weeks_unit')}</p>
                                </div>
                            </div>

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
                        </>
                    )}

                    <button
                        disabled={loading || targetRaces.length === 0 || racePassed}
                        type="submit"
                        className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all shadow-xl ${loading || racePassed || targetRaces.length === 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]'}`}
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

                    {plan.hrv_guidance && (
                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex items-start gap-3">
                            <HandRaisedIcon className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">VFC / Readiness</p>
                                <p className="text-sm font-semibold text-amber-800 leading-relaxed">{plan.hrv_guidance}</p>
                            </div>
                        </div>
                    )}

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
                                                                        {step.reps > 1 ? `${step.reps} × ${step.duration_min}′` : `${step.duration_min}m`}
                                                                    </div>
                                                                </div>
                                                                {(step.pace || step.hr || (step.reps > 1 && step.recovery)) && (
                                                                    <div className="flex flex-wrap gap-1.5 mb-2 mt-1.5">
                                                                        {step.pace && <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 tabular-nums">{step.pace}</span>}
                                                                        {step.hr && <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 tabular-nums">{step.hr} ppm</span>}
                                                                        {step.reps > 1 && step.recovery && <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600">rec. {step.recovery}</span>}
                                                                    </div>
                                                                )}
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
