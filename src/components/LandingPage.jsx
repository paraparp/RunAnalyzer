import React, { useRef } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { motion, useScroll, useTransform } from "framer-motion";
import {
    CpuChipIcon, BoltIcon, GlobeAmericasIcon, ArrowTrendingUpIcon,
    SparklesIcon, ChartBarIcon, HeartIcon, ShieldExclamationIcon,
    FireIcon, SignalIcon, MapIcon, CalendarDaysIcon, BeakerIcon,
    StarIcon, ChatBubbleLeftRightIcon, ArrowDownTrayIcon,
    CheckCircleIcon, LinkIcon
} from "@heroicons/react/24/outline";
import Logo from './Logo';
import { useTranslation } from 'react-i18next';

const tx = (lang, en, es) => (lang.startsWith('es') ? es : en);

const LandingPage = ({ onLoginSuccess, onLoginError }) => {
    const { t, i18n } = useTranslation();
    const lang = i18n.language;
    const heroRef = useRef(null);
    const { scrollY } = useScroll();
    const heroBgY = useTransform(scrollY, [0, 500], [0, 60]);

    const changeLanguage = () => {
        const newLang = lang.startsWith('en') ? 'es' : 'en';
        i18n.changeLanguage(newLang);
        localStorage.setItem('app_language', newLang);
    };


    return (
        <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans overflow-x-hidden">

            {/* ══════════════════════ NAVBAR ══════════════════════ */}
            <nav className="fixed top-0 left-0 right-0 z-50">
                <div className="flex justify-between items-center px-6 py-4 md:px-12 max-w-7xl mx-auto w-full relative">
                    <div className="absolute inset-0 -z-10 bg-white/90 backdrop-blur-md border-b border-slate-200/70" />
                    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3">
                        <Logo className="w-9 h-9" />
                        <span className="font-black text-lg tracking-tighter text-slate-900">RunAnalyzer</span>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-5 text-sm font-medium">
                        <span className="hidden md:block text-slate-500 hover:text-blue-600 transition-colors cursor-pointer">
                            {t('landing.features')}
                        </span>
                        <span className="hidden md:block text-slate-500 hover:text-blue-600 transition-colors cursor-pointer">
                            {t('landing.privacy')}
                        </span>
                        <div className="px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-[10px] text-blue-600 font-bold uppercase tracking-widest">
                            Beta v1.0
                        </div>
                        <button onClick={changeLanguage}
                            className="px-2.5 py-1 text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 rounded-full uppercase tracking-wider transition-colors">
                            {lang.startsWith('en') ? 'EN' : 'ES'}
                        </button>
                    </motion.div>
                </div>
            </nav>

            {/* ══════════════════════ HERO ══════════════════════ */}
            <section ref={heroRef} className="relative min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center overflow-hidden pt-24 pb-32">

                {/* Light orbs */}
                <motion.div style={{ y: heroBgY }} className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-[-10%] left-[-5%]  w-[50%] h-[50%] bg-blue-400/10  rounded-full blur-[130px] animate-pulse-slow" />
                    <div className="absolute bottom-[-5%]  right-[-5%] w-[45%] h-[45%] bg-sky-400/8   rounded-full blur-[110px] animate-pulse-slow delay-1000" />
                    <div className="absolute top-[35%]  right-[10%]  w-[30%] h-[30%] bg-indigo-300/8  rounded-full blur-[90px]" />
                </motion.div>

                {/* Mesh grid */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.03)_1px,transparent_1px),linear-gradient(to_right,rgba(15,23,42,0.03)_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,#000_50%,transparent_100%)]" />

                <div className="relative z-10 max-w-6xl mx-auto px-6 text-center">

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
                        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-200 bg-white shadow-sm mb-8">
                        <SparklesIcon className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-slate-600 text-xs font-semibold tracking-wide">
                            {t('landing.powered_by')} <span className="text-slate-900 font-bold">Gemini 2.0 Flash</span>
                        </span>
                    </motion.div>

                    <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}
                        className="text-5xl sm:text-7xl md:text-[96px] font-black tracking-[-0.04em] leading-[0.9] mb-6 text-slate-900 uppercase">
                        {t('landing.title_1')}
                        <br />
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 via-sky-500 to-indigo-500 animate-gradient-x">
                            {t('landing.title_2')}
                        </span>
                    </motion.h1>

                    <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
                        className="text-slate-500 text-base md:text-lg max-w-xl mx-auto mb-10 leading-relaxed font-medium">
                        {t('landing.subtitle')}
                    </motion.p>

                    <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, delay: 0.35 }}
                        className="flex flex-col items-center gap-3">
                        <div className="p-1 rounded-full bg-white shadow-xl ring-1 ring-slate-200 hover:ring-blue-300 hover:shadow-2xl transition-all duration-300">
                            <div className="w-full max-w-xs md:max-w-sm">
                                <GoogleLogin onSuccess={onLoginSuccess} onError={onLoginError}
                                    theme="filled_black" shape="pill" size="large" width="100%"
                                    text="continue_with" locale={i18n.language.substring(0, 2)} />
                            </div>
                        </div>
                    </motion.div>

                    {/* ── Dashboard Mockup (light) ── */}
                    {/* ── Floating Metric Cards ── */}
                    <div className="mt-24 hidden md:block relative mx-auto max-w-4xl h-[380px]">

                        {/* Card 1 — VO2max gauge (left) */}
                        <motion.div
                            initial={{ opacity: 0, y: 40, rotate: -8 }}
                            animate={{ opacity: 1, y: 0, rotate: -6 }}
                            transition={{ duration: 0.9, delay: 0.7, type: "spring" }}
                            className="absolute left-0 top-6 w-52 bg-white rounded-2xl border border-slate-200 shadow-xl p-5">
                            <p className="text-slate-400 text-[9px] font-bold uppercase tracking-widest mb-3">VO2max</p>
                            <div className="flex items-center justify-center my-1">
                                <svg width="96" height="96" viewBox="0 0 96 96">
                                    <circle cx="48" cy="48" r="38" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                                    <motion.circle cx="48" cy="48" r="38" fill="none" stroke="#2563eb" strokeWidth="8"
                                        strokeLinecap="round" strokeDasharray="238.76"
                                        initial={{ strokeDashoffset: 238.76 }}
                                        animate={{ strokeDashoffset: 238.76 * (1 - 0.73) }}
                                        transition={{ duration: 1.4, delay: 1.0, ease: "easeOut" }}
                                        transform="rotate(-90 48 48)" />
                                    <text x="48" y="44" textAnchor="middle" className="font-black" fill="#0f172a" fontSize="18" fontWeight="900">58.4</text>
                                    <text x="48" y="58" textAnchor="middle" fill="#94a3b8" fontSize="8">ml/kg/min</text>
                                </svg>
                            </div>
                            <div className="mt-1 text-center">
                                <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold border border-emerald-100">
                                    Excellent
                                </span>
                            </div>
                        </motion.div>

                        {/* Card 2 — Race Predictor (center, hero card) */}
                        <motion.div
                            initial={{ opacity: 0, y: 60, rotate: 3 }}
                            animate={{ opacity: 1, y: 0, rotate: 2 }}
                            transition={{ duration: 1.0, delay: 0.85, type: "spring" }}
                            className="absolute left-1/2 -translate-x-1/2 top-0 w-64 bg-white rounded-2xl border border-slate-200 shadow-2xl p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                                    <ArrowTrendingUpIcon className="w-4 h-4 text-white" />
                                </div>
                                <p className="text-slate-700 text-xs font-bold uppercase tracking-widest">Race Predictor</p>
                            </div>
                            {[
                                { dist: '5K', time: '19:42', color: 'text-sky-600' },
                                { dist: '10K', time: '41:28', color: 'text-blue-600' },
                                { dist: 'Half', time: '1:31:05', color: 'text-indigo-600' },
                                { dist: 'Marathon', time: '3:11:48', color: 'text-violet-600' },
                            ].map((r, i) => (
                                <motion.div key={i}
                                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 1.2 + i * 0.1 }}
                                    className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                                    <span className="text-slate-400 text-xs font-semibold">{r.dist}</span>
                                    <span className={`text-sm font-black tabular-nums ${r.color}`}>{r.time}</span>
                                </motion.div>
                            ))}
                        </motion.div>

                        {/* Card 3 — AI Insight (right) */}
                        <motion.div
                            initial={{ opacity: 0, y: 40, rotate: 5 }}
                            animate={{ opacity: 1, y: 0, rotate: 5 }}
                            transition={{ duration: 0.9, delay: 1.0, type: "spring" }}
                            className="absolute right-0 top-10 w-56 bg-white rounded-2xl border border-slate-200 shadow-xl p-5">
                            <div className="flex items-center gap-1.5 mb-3">
                                <SparklesIcon className="w-3.5 h-3.5 text-blue-500" />
                                <p className="text-blue-600 text-[9px] font-bold uppercase tracking-widest">AI Coach</p>
                            </div>
                            <p className="text-slate-600 text-xs leading-relaxed mb-3">
                                "Add one tempo run this week. Your aerobic base supports a higher lactate threshold effort."
                            </p>
                            <div className="flex gap-1.5 flex-wrap">
                                {['80/20', 'Tempo', 'Week 3'].map(tag => (
                                    <span key={tag} className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[9px] font-semibold border border-blue-100">{tag}</span>
                                ))}
                            </div>
                        </motion.div>

                        {/* Card 4 — Injury Risk (bottom-left) */}
                        <motion.div
                            initial={{ opacity: 0, y: 30, rotate: -4 }}
                            animate={{ opacity: 1, y: 0, rotate: -3 }}
                            transition={{ duration: 0.8, delay: 1.15, type: "spring" }}
                            className="absolute left-20 bottom-0 w-48 bg-white rounded-2xl border border-slate-200 shadow-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <ShieldExclamationIcon className="w-4 h-4 text-amber-500" />
                                <p className="text-slate-500 text-[9px] font-bold uppercase tracking-widest">Injury Risk</p>
                            </div>
                            <div className="flex items-end gap-1 mb-2">
                                <span className="text-3xl font-black text-amber-500 tabular-nums leading-none">24</span>
                                <span className="text-slate-400 text-xs mb-1">/ 100</span>
                            </div>
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                <motion.div initial={{ width: 0 }} animate={{ width: '24%' }}
                                    transition={{ duration: 0.8, delay: 1.5 }}
                                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-400" />
                            </div>
                            <p className="text-emerald-600 text-[9px] font-bold mt-1.5">Low risk</p>
                        </motion.div>

                        {/* Card 5 — Heart Rate pulse (bottom-right) */}
                        <motion.div
                            initial={{ opacity: 0, y: 30, rotate: 4 }}
                            animate={{ opacity: 1, y: 0, rotate: 3 }}
                            transition={{ duration: 0.8, delay: 1.3, type: "spring" }}
                            className="absolute right-14 bottom-4 w-48 bg-white rounded-2xl border border-slate-200 shadow-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-slate-400 text-[9px] font-bold uppercase tracking-widest">Avg HR</p>
                                <HeartIcon className="w-3.5 h-3.5 text-rose-400" />
                            </div>
                            <p className="text-3xl font-black text-rose-500 tabular-nums leading-none mb-2">148 <span className="text-sm text-slate-400 font-semibold">bpm</span></p>
                            <svg viewBox="0 0 120 32" className="w-full" fill="none">
                                <motion.polyline
                                    points="0,16 10,16 14,6 18,26 22,16 32,16 38,16 44,10 50,22 56,16 66,16 72,4 76,28 80,16 90,16 96,12 100,20 104,16 120,16"
                                    stroke="#f43f5e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{ duration: 1.2, delay: 1.6, ease: "easeInOut" }}
                                />
                            </svg>
                        </motion.div>

                    </div>
                </div>
            </section>

            {/* ══════════════════════ STATS BAR ══════════════════════ */}
            <section className="bg-white border-y border-slate-100 py-14">
                <div className="max-w-5xl mx-auto px-6">
                    <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }} transition={{ duration: 0.6 }}
                        className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        {[
                            { value: '20+', label: tx(lang, 'Analytics Tools', 'Herramientas'), color: 'text-blue-600' },
                            { value: 'AI', label: tx(lang, 'Gemini Powered', 'Potenciado por Gemini'), color: 'text-sky-600' },
                            { value: '∞', label: tx(lang, 'Strava Activities', 'Actividades Strava'), color: 'text-indigo-600' },
                            { value: 'VO2', label: tx(lang, 'VO2max Tracker', 'Tracker VO2max'), color: 'text-emerald-600' },
                        ].map((s, i) => (
                            <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                                className="flex flex-col items-center text-center p-6 rounded-2xl bg-slate-50 border border-slate-100">
                                <span className={`text-4xl font-black tracking-tighter ${s.color}`}>{s.value}</span>
                                <span className="text-slate-500 text-sm font-medium mt-1">{s.label}</span>
                            </motion.div>
                        ))}
                    </motion.div>
                </div>
            </section>

            {/* ══════════════════════ FEATURES ══════════════════════ */}
            <section className="bg-[#F8FAFC] py-24">
                <div className="max-w-7xl mx-auto px-6">
                    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }} className="text-center mb-16">
                        <p className="text-blue-600 text-xs font-bold uppercase tracking-[0.2em] mb-3">
                            {tx(lang, 'Everything you need', 'Todo lo que necesitas')}
                        </p>
                        <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-900 mb-4">
                            {t('landing.tech_title')}
                        </h2>
                        <p className="text-slate-500 max-w-xl mx-auto text-base">{t('landing.tech_desc')}</p>
                    </motion.div>

                    <div className="grid md:grid-cols-3 gap-5">
                        {[
                            { icon: CpuChipIcon, color: 'blue', badge: 'AI', title: t('landing.bento_1_title'), desc: t('landing.bento_1_desc'), cols: 'md:col-span-2' },
                            { icon: ArrowTrendingUpIcon, color: 'cyan', title: t('landing.bento_2_title'), desc: t('landing.bento_2_desc') },
                            { icon: GlobeAmericasIcon, color: 'indigo', title: t('landing.bento_3_title'), desc: t('landing.bento_3_desc') },
                            { icon: ChartBarIcon, color: 'violet', badge: 'Deep', title: t('landing.bento_4_title'), desc: t('landing.bento_4_desc'), cols: 'md:col-span-2' },
                            {
                                icon: HeartIcon, color: 'rose',
                                title: tx(lang, 'HR & Zones', 'FC & Zonas'),
                                desc: tx(lang, 'Full cardiac decoupling analysis and training zone breakdown for every run.',
                                    'Análisis de decoupling cardíaco y desglose de zonas para cada carrera.')
                            },
                            {
                                icon: ShieldExclamationIcon, color: 'amber',
                                title: tx(lang, 'Injury Risk', 'Riesgo de Lesión'),
                                desc: tx(lang, 'Detect overtraining signals before they become injuries using ACWR and load metrics.',
                                    'Detecta señales de sobreentrenamiento antes de lesiones mediante ACWR.')
                            },
                        ].map((card, i) => <FeatureCard key={i} {...card} delay={i * 0.07} />)}
                    </div>
                </div>
            </section>

            {/* ══════════════════════ HEATMAP SHOWCASE ══════════════════════ */}
            <section className="bg-white py-24 border-t border-slate-100 overflow-hidden">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid md:grid-cols-2 gap-16 items-center">

                        {/* Left: text */}
                        <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }} transition={{ duration: 0.7 }}>
                            <p className="text-blue-600 text-xs font-bold uppercase tracking-[0.2em] mb-4">
                                {tx(lang, 'Global Heatmap', 'Heatmap Global')}
                            </p>
                            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-900 mb-5 leading-tight">
                                {tx(lang, "Every km you've run, visually mapped.", 'Cada km recorrido, mapeado visualmente.')}
                            </h2>
                            <p className="text-slate-500 text-base leading-relaxed mb-8 max-w-md">
                                {tx(lang,
                                    'See your entire running history on an interactive world map. Filter by year, type, or effort — your geography of dedication.',
                                    'Visualiza todo tu historial de carrera en un mapa interactivo. Filtra por año, tipo o esfuerzo — tu geografía de dedicación.'
                                )}
                            </p>
                            <div className="grid grid-cols-3 gap-4">
                                {[
                                    { val: '1,284', label: tx(lang, 'km tracked', 'km registrados'), color: 'text-blue-600' },
                                    { val: '247', label: tx(lang, 'activities', 'actividades'), color: 'text-indigo-600' },
                                    { val: '18.4k', label: tx(lang, 'm elevation', 'm desnivel'), color: 'text-sky-600' },
                                ].map((s, i) => (
                                    <motion.div key={i} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }}
                                        viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.1 }}
                                        className="p-4 rounded-xl bg-slate-50 border border-slate-100 text-center">
                                        <p className={`text-xl font-black tabular-nums ${s.color}`}>{s.val}</p>
                                        <p className="text-slate-400 text-[10px] font-semibold mt-0.5">{s.label}</p>
                                    </motion.div>
                                ))}
                            </div>
                        </motion.div>

                        {/* Right: heatmap dot visualization */}
                        <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }} transition={{ duration: 0.7 }}
                            className="relative">

                            <div className="relative rounded-3xl bg-[#0d1117] border border-slate-200 shadow-2xl overflow-hidden p-6 aspect-[4/3]">
                                {/* subtle glow */}
                                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 via-transparent to-indigo-600/5 pointer-events-none" />

                                {/* dot grid heatmap */}
                                <HeatmapViz />

                                {/* overlay label */}
                                <div className="absolute bottom-4 left-4 flex items-center gap-2">
                                    <MapIcon className="w-4 h-4 text-white/40" />
                                    <span className="text-white/40 text-[10px] font-bold uppercase tracking-widest">
                                        {tx(lang, 'Global Activity Map', 'Mapa de Actividad Global')}
                                    </span>
                                </div>

                                {/* legend */}
                                <div className="absolute top-4 right-4 flex items-center gap-1.5">
                                    <span className="text-white/30 text-[9px] font-semibold uppercase tracking-widest mr-1">
                                        {tx(lang, 'intensity', 'intensidad')}
                                    </span>
                                    {['bg-blue-900/60', 'bg-blue-600/70', 'bg-cyan-500/80', 'bg-orange-400/90', 'bg-red-500'].map((c, i) => (
                                        <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* ══════════════════════ HOW IT WORKS ══════════════════════ */}
            <section className="bg-white py-24 border-t border-slate-100">
                <div className="max-w-5xl mx-auto px-6">
                    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }} className="text-center mb-16">
                        <p className="text-blue-600 text-xs font-bold uppercase tracking-[0.2em] mb-3">
                            {tx(lang, 'Simple setup', 'Configuración simple')}
                        </p>
                        <h2 className="text-4xl font-black tracking-tighter text-slate-900">
                            {tx(lang, 'Up and running in seconds', 'Listo en segundos')}
                        </h2>
                    </motion.div>

                    <div className="relative grid md:grid-cols-3 gap-8">
                        <div className="hidden md:block absolute top-12 left-[20%] right-[20%] h-px bg-gradient-to-r from-slate-200 via-blue-300 to-slate-200" />
                        {[
                            {
                                icon: LinkIcon, bg: 'bg-blue-600',
                                title: tx(lang, 'Connect Strava', 'Conecta Strava'),
                                desc: tx(lang, 'Sign in with Google and authorize your Strava account. Activities sync automatically.',
                                    'Inicia sesión con Google y autoriza tu cuenta Strava. Las actividades se sincronizan solas.'),
                            },
                            {
                                icon: BeakerIcon, bg: 'bg-sky-500',
                                title: tx(lang, 'Analyze Everything', 'Analiza Todo'),
                                desc: tx(lang, 'Explore 20+ analytics tools covering performance, health, technique, and training load.',
                                    'Explora más de 20 herramientas de rendimiento, salud, técnica y carga de entrenamiento.'),
                            },
                            {
                                icon: FireIcon, bg: 'bg-indigo-600',
                                title: tx(lang, 'Run Smarter', 'Corre más inteligente'),
                                desc: tx(lang, 'Let AI generate your training plan, predict race times, and answer any running question.',
                                    'Deja que la IA genere tu plan, prediga tiempos y responda cualquier pregunta.'),
                            },
                        ].map((step, i) => (
                            <motion.div key={i} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                                className="flex flex-col items-center text-center">
                                <div className={`relative w-24 h-24 rounded-3xl flex items-center justify-center mb-6 shadow-md ${step.bg}`}>
                                    <step.icon className="w-10 h-10 text-white" />
                                    <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border-2 border-slate-100 shadow flex items-center justify-center text-[10px] font-black text-slate-700">
                                        {i + 1}
                                    </span>
                                </div>
                                <h3 className="text-lg font-black text-slate-900 mb-2">{step.title}</h3>
                                <p className="text-slate-500 text-sm leading-relaxed">{step.desc}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ══════════════════════ TOOLS GRID ══════════════════════ */}
            <section className="bg-[#F8FAFC] py-24 border-t border-slate-100">
                <div className="max-w-5xl mx-auto px-6">
                    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }} className="text-center mb-12">
                        <h2 className="text-3xl font-black tracking-tighter text-slate-900">
                            {tx(lang, 'All the tools. One platform.', 'Todas las herramientas. Una plataforma.')}
                        </h2>
                    </motion.div>
                    <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
                        viewport={{ once: true }} transition={{ duration: 0.5 }}
                        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {[
                            { icon: HeartIcon, label: tx(lang, 'HR Analysis', 'Análisis FC') },
                            { icon: ChartBarIcon, label: tx(lang, 'Fitness & Fatigue', 'Fitness y Fatiga') },
                            { icon: FireIcon, label: tx(lang, 'Technique', 'Técnica') },
                            { icon: SignalIcon, label: tx(lang, 'Training Zones', 'Zonas FC') },
                            { icon: MapIcon, label: tx(lang, 'Global Heatmap', 'Heatmap Global') },
                            { icon: CalendarDaysIcon, label: tx(lang, 'Consistency', 'Consistencia') },
                            { icon: BeakerIcon, label: tx(lang, 'VDOT Estimator', 'Estimador VDOT') },
                            { icon: StarIcon, label: tx(lang, 'Gear Tracker', 'Zapatillas') },
                            { icon: SparklesIcon, label: tx(lang, 'AI Coach', 'Entrenador AI') },
                            { icon: ArrowTrendingUpIcon, label: tx(lang, 'Race Predictor', 'Predictor de Carrera') },
                            { icon: ChatBubbleLeftRightIcon, label: tx(lang, 'AI Q&A', 'Preguntas AI') },
                            { icon: BoltIcon, label: tx(lang, 'Splits', 'Parciales') },
                            { icon: GlobeAmericasIcon, label: tx(lang, 'Race Detector', 'Detector de Carreras') },
                            { icon: SignalIcon, label: tx(lang, 'Cardiac Decoupling', 'Decoupling Cardíaco') },
                            { icon: ShieldExclamationIcon, label: tx(lang, 'Injury Risk', 'Riesgo de Lesión') },
                            { icon: ArrowDownTrayIcon, label: tx(lang, 'Data Export', 'Exportar Datos') },
                        ].map((tool, i) => (
                            <motion.div key={i} initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }}
                                viewport={{ once: true }} transition={{ delay: i * 0.03 }}
                                className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40 transition-all duration-200 cursor-default group">
                                <div className="w-7 h-7 rounded-lg bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center flex-shrink-0 transition-colors">
                                    <tool.icon className="w-3.5 h-3.5 text-blue-600" />
                                </div>
                                <span className="text-slate-700 text-xs font-semibold leading-tight">{tool.label}</span>
                            </motion.div>
                        ))}
                    </motion.div>
                </div>
            </section>

            {/* ══════════════════════ SOCIAL PROOF ══════════════════════ */}
            <section className="bg-white py-24 border-t border-slate-100 overflow-hidden">
                <div className="max-w-6xl mx-auto px-6">
                    <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }} className="text-center mb-16">
                        <p className="text-blue-600 text-xs font-bold uppercase tracking-[0.2em] mb-3">
                            {tx(lang, 'Trusted by runners', 'Los runners confían')}
                        </p>
                        <h2 className="text-4xl font-black tracking-tighter text-slate-900">
                            {tx(lang, 'What runners are saying', 'Lo que dicen los corredores')}
                        </h2>
                    </motion.div>

                    {/* Animated counters */}
                    <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }}
                        viewport={{ once: true }} transition={{ duration: 0.6 }}
                        className="grid grid-cols-3 gap-8 mb-16 max-w-2xl mx-auto">
                        {[
                            { end: '2.4K', label: tx(lang, 'Activities Analyzed', 'Actividades Analizadas'), color: 'text-blue-600' },
                            { end: '98%', label: tx(lang, 'Prediction Accuracy', 'Precisión de Predicción'), color: 'text-emerald-600' },
                            { end: '4.9', label: tx(lang, 'User Rating', 'Valoración'), color: 'text-amber-500' },
                        ].map((stat, i) => (
                            <motion.div key={i}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.15 }}
                                className="text-center">
                                <p className={`text-3xl md:text-4xl font-black tracking-tighter ${stat.color}`}>{stat.end}</p>
                                <p className="text-slate-400 text-xs font-semibold mt-1">{stat.label}</p>
                            </motion.div>
                        ))}
                    </motion.div>

                    {/* Testimonial Cards */}
                    <div className="grid md:grid-cols-3 gap-6">
                        {[
                            {
                                name: 'Carlos M.',
                                role: tx(lang, 'Marathon Runner', 'Maratonista'),
                                avatar: '🏃‍♂️',
                                text: tx(lang,
                                    "The race predictor nailed my marathon time within 2 minutes. The AI coach suggested a taper strategy I hadn't considered. Absolutely game-changing.",
                                    "El predictor clavó mi tiempo de maratón con 2 minutos de diferencia. El entrenador AI me sugirió una estrategia de taper que no había considerado. Revolucionario."),
                                accent: 'border-blue-200 hover:border-blue-300',
                            },
                            {
                                name: 'Laura S.',
                                role: tx(lang, 'Trail Runner', 'Corredora de Trail'),
                                avatar: '⛰️',
                                text: tx(lang,
                                    "The VO2max tracker and cardiac decoupling analysis helped me understand why my easy runs felt hard. Turns out my zones were all wrong!",
                                    "El tracker VO2max y el análisis de decoupling cardíaco me ayudaron a entender por qué mis rodajes me costaban. ¡Resulta que mis zonas estaban mal!"),
                                accent: 'border-emerald-200 hover:border-emerald-300',
                            },
                            {
                                name: 'Pablo R.',
                                role: tx(lang, 'Ultra Runner', 'Ultra Runner'),
                                avatar: '🦁',
                                text: tx(lang,
                                    "Route Gallery is insane — seeing all my mountain runs as minimalist posters is beautiful. And the injury risk alert saved me from overtraining twice.",
                                    "La Galería de Rutas es una locura — ver mis rutas de montaña como pósters minimalistas es precioso. Y la alerta de riesgo de lesión me salvó dos veces."),
                                accent: 'border-violet-200 hover:border-violet-300',
                            },
                        ].map((review, i) => (
                            <motion.div key={i}
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.12 }}
                                whileHover={{ y: -4 }}
                                className={`bg-white rounded-2xl p-7 border ${review.accent} shadow-sm hover:shadow-lg transition-all duration-300`}>
                                <div className="flex items-center gap-3 mb-5">
                                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-lg">
                                        {review.avatar}
                                    </div>
                                    <div>
                                        <p className="text-sm font-black text-slate-900 leading-tight">{review.name}</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{review.role}</p>
                                    </div>
                                    <div className="ml-auto flex gap-0.5">
                                        {[...Array(5)].map((_, s) => (
                                            <svg key={s} className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                            </svg>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-slate-600 text-sm leading-relaxed italic">"{review.text}"</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ══════════════════════ FINAL CTA ══════════════════════ */}
            <section className="bg-gradient-to-b from-blue-50 to-white py-28 border-t border-blue-100">
                <div className="max-w-2xl mx-auto px-6 text-center">
                    <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
                        <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-900 mb-4 uppercase leading-tight">
                            {tx(lang, 'Start analyzing your runs today', 'Empieza a analizar tus carreras hoy')}
                        </h2>
                        <p className="text-slate-500 mb-10 text-base">
                            {tx(lang, 'Connect your Strava account and unlock professional-grade analytics in seconds.',
                                'Conecta tu cuenta de Strava y desbloquea análisis de nivel profesional en segundos.')}
                        </p>
                        <div className="flex flex-col items-center gap-3">
                            <div className="p-1 rounded-full bg-white shadow-xl ring-1 ring-slate-200 hover:ring-blue-300 hover:shadow-2xl transition-all duration-300">
                                <div className="w-full max-w-xs md:max-w-sm">
                                    <GoogleLogin onSuccess={onLoginSuccess} onError={onLoginError}
                                        theme="filled_black" shape="pill" size="large" width="100%"
                                        text="continue_with" locale={i18n.language.substring(0, 2)} />
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* ══════════════════════ FOOTER ══════════════════════ */}
            <footer className="bg-white py-10 border-t border-slate-100">
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Logo className="w-7 h-7 opacity-70" />
                        <span className="text-slate-400 text-sm font-bold tracking-tight">RunAnalyzer</span>
                    </div>
                    <p className="text-slate-300 text-xs">Running Data Intelligence · 2026</p>
                    <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span className="text-slate-400 text-xs">
                            {tx(lang, 'Powered by Strava API & Gemini AI', 'Potenciado por Strava API & Gemini AI')}
                        </span>
                    </div>
                </div>
            </footer>
        </div>
    );
};

/* ─── Feature Card ─── */
const colorMap = {
    blue: { icon: 'bg-blue-100   text-blue-600', hover: 'hover:border-blue-200   hover:shadow-blue-50/80' },
    cyan: { icon: 'bg-cyan-100   text-cyan-600', hover: 'hover:border-cyan-200' },
    indigo: { icon: 'bg-indigo-100 text-indigo-600', hover: 'hover:border-indigo-200' },
    violet: { icon: 'bg-violet-100 text-violet-600', hover: 'hover:border-violet-200' },
    rose: { icon: 'bg-rose-100   text-rose-600', hover: 'hover:border-rose-200' },
    amber: { icon: 'bg-amber-100  text-amber-600', hover: 'hover:border-amber-200' },
};

const FeatureCard = ({ title, desc, icon: Icon, color = 'blue', badge, cols = '', delay = 0 }) => {
    const c = colorMap[color] ?? colorMap.blue;
    return (
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.5, delay }}
            whileHover={{ y: -4 }}
            className={`relative overflow-hidden p-7 rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-lg transition-all duration-300 ${c.hover} ${cols}`}>
            <div className="flex justify-between items-start mb-5">
                <div className={`p-3 rounded-xl ${c.icon}`}>
                    <Icon className="w-6 h-6" />
                </div>
                {badge && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                        {badge}
                    </span>
                )}
            </div>
            <h3 className="text-base font-black text-slate-900 mb-2 tracking-tight">{title}</h3>
            <p className="text-slate-500 text-sm leading-relaxed">{desc}</p>
        </motion.div>
    );
};

/* ─── Heatmap blob visualization (smooth, no grid) ─── */
/* ─── GPS route heatmap visualization ─── */
// Organic paths mimicking real running routes on a city map
const ROUTES = [
    // Main cluster — dense overlapping routes (like the screenshot)
    "M 180,130 C 185,120 192,115 200,110 C 210,105 218,108 222,115 C 228,124 224,132 218,138 C 212,144 204,148 196,150 C 188,152 180,148 176,142 C 172,136 174,130 180,130Z",
    "M 178,128 C 183,112 196,102 210,105 C 226,108 234,122 230,136 C 226,150 212,156 198,154 C 184,152 174,142 174,130 C 174,118 178,110 186,106",
    "M 200,108 C 208,98 220,92 232,96 C 244,100 250,112 246,124 C 242,136 230,142 218,140 C 206,138 198,130 200,120",
    "M 172,140 C 164,148 158,158 155,168 C 152,178 155,188 163,192 C 171,196 180,192 186,184 C 192,176 192,166 186,158 C 180,150 172,148 168,152",
    "M 222,116 C 232,108 244,104 256,108 C 268,112 274,124 270,136 C 266,146 256,152 246,150 C 236,148 228,140 226,130",
    "M 196,152 C 196,162 194,172 190,180 C 186,188 180,194 172,196 C 164,198 156,194 152,186 C 148,178 150,168 156,162 C 162,156 170,154 178,156",
    "M 200,106 C 196,94 188,84 178,80 C 168,76 158,80 152,90 C 146,100 148,112 156,118 C 164,124 174,124 182,118",
    // Longer route going outward (like the user's long trail routes)
    "M 220,112 C 234,100 250,90 266,84 C 282,78 298,78 310,86 C 322,94 326,108 320,120",
    "M 176,142 C 166,150 154,156 140,158 C 126,160 112,156 102,148 C 92,140 88,128 92,116",
    // Coastal run (bottom path)
    "M 155,168 C 148,174 138,178 128,180 C 118,182 108,180 100,174 C 92,168 88,158 90,148",
    // Faint solo run far away
    "M 310,88 C 318,80 328,74 338,72 C 348,70 356,74 360,82",
    "M 90,148 C 82,142 76,134 74,124 C 72,114 74,104 80,96",
];

const HeatmapViz = () => (
    <div className="absolute inset-0">
        <svg viewBox="0 0 420 260" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
                {/* Outer glow */}
                <filter id="routeglow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3.5" result="glow" />
                    <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
            </defs>

            {/* Solid dark background */}
            <rect width="420" height="260" fill="#0d1117" />

            {/* Glow halo behind routes */}
            <g filter="url(#routeglow)" opacity="0.35">
                {ROUTES.slice(0, 9).map((d, i) => (
                    <path key={`glow-${i}`} d={d} fill="none"
                        stroke="#f97316" strokeWidth={i < 7 ? 6 : 3} strokeLinecap="round" strokeLinejoin="round" />
                ))}
            </g>

            {/* Main routes — animated draw */}
            {ROUTES.map((d, i) => (
                <motion.path key={i} d={d} fill="none"
                    stroke={i < 7 ? '#fb923c' : i < 10 ? '#f97316' : '#ea580c'}
                    strokeWidth={i < 7 ? 1.6 : i < 10 ? 1.2 : 0.8}
                    strokeLinecap="round" strokeLinejoin="round"
                    opacity={i < 7 ? 0.95 : i < 10 ? 0.7 : 0.45}
                    initial={{ pathLength: 0, opacity: 0 }}
                    whileInView={{ pathLength: 1, opacity: i < 7 ? 0.95 : i < 10 ? 0.7 : 0.45 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.6, delay: 0.3 + i * 0.12, ease: 'easeInOut' }}
                />
            ))}

            {/* Hot-spot dots at route intersections */}
            {[[200, 130], [210, 110], [196, 150], [222, 116], [180, 130], [186, 106], [230, 112]].map(([cx, cy], i) => (
                <motion.circle key={`dot-${i}`} cx={cx} cy={cy} r={i === 0 ? 3.5 : 2}
                    fill="#fbbf24"
                    initial={{ scale: 0, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: i === 0 ? 1 : 0.7 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: 1.8 + i * 0.08 }}
                    style={{ transformOrigin: `${cx}px ${cy}px` }}
                />
            ))}
        </svg>
    </div>
);

export default LandingPage;
