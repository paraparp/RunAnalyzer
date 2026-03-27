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
                                    <circle cx="48" cy="48" r="38" fill="none" stroke="#e2e8f0" strokeWidth="8"/>
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
                                { dist: '5K',       time: '19:42', color: 'text-sky-600'    },
                                { dist: '10K',      time: '41:28', color: 'text-blue-600'   },
                                { dist: 'Half',     time: '1:31:05', color: 'text-indigo-600' },
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
                            { value: '20+',  label: tx(lang, 'Analytics Tools',   'Herramientas'),          color: 'text-blue-600'    },
                            { value: 'AI',   label: tx(lang, 'Gemini Powered',     'Potenciado por Gemini'), color: 'text-sky-600'     },
                            { value: '∞',    label: tx(lang, 'Strava Activities',  'Actividades Strava'),    color: 'text-indigo-600'  },
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
                            { icon: CpuChipIcon,          color: 'blue',   badge: 'AI',   title: t('landing.bento_1_title'), desc: t('landing.bento_1_desc'), cols: 'md:col-span-2' },
                            { icon: ArrowTrendingUpIcon,  color: 'cyan',                  title: t('landing.bento_2_title'), desc: t('landing.bento_2_desc') },
                            { icon: GlobeAmericasIcon,    color: 'indigo',                title: t('landing.bento_3_title'), desc: t('landing.bento_3_desc') },
                            { icon: ChartBarIcon,         color: 'violet', badge: 'Deep', title: t('landing.bento_4_title'), desc: t('landing.bento_4_desc'), cols: 'md:col-span-2' },
                            { icon: HeartIcon,            color: 'rose',
                              title: tx(lang, 'HR & Zones', 'FC & Zonas'),
                              desc:  tx(lang, 'Full cardiac decoupling analysis and training zone breakdown for every run.',
                                            'Análisis de decoupling cardíaco y desglose de zonas para cada carrera.') },
                            { icon: ShieldExclamationIcon,color: 'amber',
                              title: tx(lang, 'Injury Risk', 'Riesgo de Lesión'),
                              desc:  tx(lang, 'Detect overtraining signals before they become injuries using ACWR and load metrics.',
                                            'Detecta señales de sobreentrenamiento antes de lesiones mediante ACWR.') },
                        ].map((card, i) => <FeatureCard key={i} {...card} delay={i * 0.07} />)}
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
                                desc:  tx(lang, 'Sign in with Google and authorize your Strava account. Activities sync automatically.',
                                              'Inicia sesión con Google y autoriza tu cuenta Strava. Las actividades se sincronizan solas.'),
                            },
                            {
                                icon: BeakerIcon, bg: 'bg-sky-500',
                                title: tx(lang, 'Analyze Everything', 'Analiza Todo'),
                                desc:  tx(lang, 'Explore 20+ analytics tools covering performance, health, technique, and training load.',
                                              'Explora más de 20 herramientas de rendimiento, salud, técnica y carga de entrenamiento.'),
                            },
                            {
                                icon: FireIcon, bg: 'bg-indigo-600',
                                title: tx(lang, 'Run Smarter', 'Corre más inteligente'),
                                desc:  tx(lang, 'Let AI generate your training plan, predict race times, and answer any running question.',
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
                            { icon: HeartIcon,               label: tx(lang, 'HR Analysis',          'Análisis FC')           },
                            { icon: ChartBarIcon,            label: tx(lang, 'Fitness & Fatigue',    'Fitness y Fatiga')       },
                            { icon: FireIcon,                label: tx(lang, 'Technique',            'Técnica')                },
                            { icon: SignalIcon,              label: tx(lang, 'Training Zones',       'Zonas FC')               },
                            { icon: MapIcon,                 label: tx(lang, 'Global Heatmap',       'Heatmap Global')         },
                            { icon: CalendarDaysIcon,        label: tx(lang, 'Consistency',          'Consistencia')           },
                            { icon: BeakerIcon,              label: tx(lang, 'VDOT Estimator',       'Estimador VDOT')         },
                            { icon: StarIcon,                label: tx(lang, 'Gear Tracker',         'Zapatillas')             },
                            { icon: SparklesIcon,            label: tx(lang, 'AI Coach',             'Entrenador AI')          },
                            { icon: ArrowTrendingUpIcon,     label: tx(lang, 'Race Predictor',       'Predictor de Carrera')   },
                            { icon: ChatBubbleLeftRightIcon, label: tx(lang, 'AI Q&A',               'Preguntas AI')           },
                            { icon: BoltIcon,                label: tx(lang, 'Splits',               'Parciales')              },
                            { icon: GlobeAmericasIcon,       label: tx(lang, 'Race Detector',        'Detector de Carreras')   },
                            { icon: SignalIcon,              label: tx(lang, 'Cardiac Decoupling',   'Decoupling Cardíaco')    },
                            { icon: ShieldExclamationIcon,   label: tx(lang, 'Injury Risk',          'Riesgo de Lesión')       },
                            { icon: ArrowDownTrayIcon,       label: tx(lang, 'Data Export',          'Exportar Datos')         },
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
    blue:   { icon: 'bg-blue-100   text-blue-600',   hover: 'hover:border-blue-200   hover:shadow-blue-50/80'  },
    cyan:   { icon: 'bg-cyan-100   text-cyan-600',   hover: 'hover:border-cyan-200'                            },
    indigo: { icon: 'bg-indigo-100 text-indigo-600', hover: 'hover:border-indigo-200'                          },
    violet: { icon: 'bg-violet-100 text-violet-600', hover: 'hover:border-violet-200'                          },
    rose:   { icon: 'bg-rose-100   text-rose-600',   hover: 'hover:border-rose-200'                            },
    amber:  { icon: 'bg-amber-100  text-amber-600',  hover: 'hover:border-amber-200'                           },
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

export default LandingPage;
