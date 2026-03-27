import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { motion } from "framer-motion";
import { CpuChipIcon, BoltIcon, GlobeAmericasIcon, ArrowTrendingUpIcon, SparklesIcon, ChartBarIcon } from "@heroicons/react/24/outline";
import Logo from './Logo';
import { useTranslation } from 'react-i18next';

const LandingPage = ({ onLoginSuccess, onLoginError }) => {
    const { t, i18n } = useTranslation();

    const changeLanguage = () => {
        const newLang = i18n.language.startsWith('en') ? 'es' : 'en';
        i18n.changeLanguage(newLang);
        localStorage.setItem('app_language', newLang);
    };
    return (
        <div className="min-h-screen bg-[#F8FAFC] text-slate-900 selection:bg-indigo-100 font-sans overflow-x-hidden relative">

            {/* Background Effects (Light Mode Optimized) */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                {/* Subtle glowing Orbs */}
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/5 rounded-full blur-[120px] animate-pulse-slow"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-sky-500/5 rounded-full blur-[120px] animate-pulse-slow delay-1000"></div>
                <div className="absolute top-[30%] right-[20%] w-[40%] h-[40%] bg-rose-500/5 rounded-full blur-[100px]"></div>

                {/* Mesh Grid Pattern */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.02)_1px,transparent_1px),linear-gradient(to_right,rgba(15,23,42,0.02)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>
            </div>

            <div className="relative z-10 flex flex-col min-h-screen">

                {/* Navbar */}
                <nav className="flex justify-between items-center px-6 py-6 md:px-12 max-w-7xl mx-auto w-full">
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3"
                    >
                        <Logo className="w-10 h-10" />
                        <span className="font-bold text-xl tracking-tight text-slate-900">RunAnalyzer</span>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-500"
                    >
                        <span className="hover:text-indigo-600 transition-colors cursor-pointer">{t('landing.features')}</span>
                        <span className="hover:text-indigo-600 transition-colors cursor-pointer">{t('landing.privacy')}</span>
                        <div className="px-3 py-1 rounded-full border border-indigo-100 bg-indigo-50 text-xs text-indigo-600 font-semibold">Beta v1.0</div>
                        
                        <button 
                            onClick={changeLanguage}
                            className="px-2 py-1 text-xs font-bold bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 rounded-full uppercase tracking-wider transition-colors ml-2"
                            title={i18n.language.startsWith('en') ? 'Switch to Spanish' : 'Cambiar a Inglés'}
                        >
                            {i18n.language.startsWith('en') ? 'EN' : 'ES'}
                        </button>
                    </motion.div>
                </nav>

                {/* Hero Section */}
                <main className="flex-grow max-w-7xl mx-auto px-6 pt-16 pb-24 md:pt-24 text-center w-full">

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-slate-200 shadow-sm mb-8"
                    >
                        <SparklesIcon className="w-4 h-4 text-amber-500" />
                        <span className="text-slate-600 text-sm font-medium">{t('landing.powered_by')} <span className="text-slate-900 font-bold">Gemini 2.0 Flash</span></span>
                    </motion.div>

                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                        className="text-6xl md:text-8xl font-black tracking-tighter mb-8 leading-[0.95] text-slate-900 uppercase"
                    >
                        {t('landing.title_1')} <br />
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-sky-500 to-emerald-500 animate-gradient-x">{t('landing.title_2')}</span>
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto mb-12 leading-relaxed font-medium"
                    >
                        {t('landing.subtitle')}
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="flex flex-col items-center gap-4"
                    >
                        <div className="p-1 rounded-full bg-white shadow-xl hover:shadow-2xl transition-shadow duration-300 ring-1 ring-slate-100">
                            <div className="w-full max-w-xs md:max-w-sm">
                                <GoogleLogin
                                    onSuccess={onLoginSuccess}
                                    onError={onLoginError}
                                    theme="filled_black" // Keeping black button for high contrast CTA
                                    shape="pill"
                                    size="large"
                                    width="100%"
                                    text="continue_with"
                                    locale={i18n.language.substring(0, 2)}
                                />
                            </div>
                        </div>
                        <p className="text-slate-400 text-xs mt-2 uppercase tracking-widest font-semibold flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            {t('landing.free_access')}
                        </p>
                    </motion.div>

                    {/* Dashboard Preview - Tilt Effect (Light Version) */}
                    <motion.div
                        initial={{ opacity: 0, y: 100, rotateX: 20 }}
                        animate={{ opacity: 1, y: 0, rotateX: 0 }}
                        transition={{ duration: 1, delay: 0.5, type: "spring" }}
                        className="mt-28 relative mx-auto max-w-5xl perspective-1000 hidden md:block" // Hidden on small mobile to save space
                    >
                        <div className="relative rounded-2xl bg-white border border-slate-200/60 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] overflow-hidden aspect-[21/9] group">
                            {/* Mock UI Header */}
                            <div className="h-10 border-b border-slate-100 bg-slate-50/80 flex items-center px-4 gap-2">
                                <div className="flex gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-200"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-200"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-slate-200"></div>
                                </div>
                            </div>
                            {/* Mock Content - Abstract Representation */}
                            <div className="p-8 grid grid-cols-3 gap-6 h-full bg-white opacity-90 transition-opacity duration-500 group-hover:opacity-100">
                                <div className="col-span-2 space-y-6">
                                    {/* Chart Area */}
                                    <div className="h-40 rounded-xl bg-slate-50 border border-slate-100 relative overflow-hidden flex items-end justify-between px-6 pb-0 pt-8 gap-3">
                                        {[35, 55, 45, 70, 60, 85, 75, 90, 65, 95].map((h, i) => (
                                            <motion.div
                                                key={i}
                                                initial={{ height: 0 }}
                                                animate={{ height: `${h}%` }}
                                                transition={{ duration: 1, delay: 0.8 + (i * 0.1) }}
                                                className="w-full bg-indigo-500/80 rounded-t-sm opacity-80"
                                            ></motion.div>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-2 gap-6">
                                        <div className="h-20 rounded-xl bg-slate-50 border border-slate-100 shimmer"></div>
                                        <div className="h-20 rounded-xl bg-slate-50 border border-slate-100 shimmer"></div>
                                    </div>
                                </div>
                                <div className="h-full rounded-xl bg-gradient-to-b from-slate-50 to-white border border-slate-100 p-5 shadow-sm">
                                    <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center mb-4">
                                        <BoltIcon className="text-emerald-600 w-5 h-5" />
                                    </div>
                                    <div className="h-2 w-20 bg-slate-200 rounded mb-3"></div>
                                    <div className="h-2 w-12 bg-slate-200 rounded"></div>
                                    <div className="mt-8 space-y-3">
                                        <div className="h-1.5 w-full bg-slate-100 rounded overflow-hidden">
                                            <div className="h-full w-3/4 bg-emerald-400"></div>
                                        </div>
                                        <div className="h-1.5 w-full bg-slate-100 rounded overflow-hidden">
                                            <div className="h-full w-1/2 bg-amber-400"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>

                </main>

                {/* Features Bento Grid - Light */}
                <section className="max-w-7xl mx-auto px-6 pb-24 border-t border-slate-100/50 pt-24 bg-white/50 backdrop-blur-sm">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold text-slate-900 mb-4">{t('landing.tech_title')}</h2>
                        <p className="text-slate-500 max-w-xl mx-auto">{t('landing.tech_desc')}</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-6">

                        <BentoCard
                            title={t('landing.bento_1_title')}
                            desc={t('landing.bento_1_desc')}
                            icon={CpuChipIcon}
                            color="indigo"
                            badge="Core"
                            cols="md:col-span-2"
                        />

                        <BentoCard
                            title={t('landing.bento_2_title')}
                            desc={t('landing.bento_2_desc')}
                            icon={ArrowTrendingUpIcon}
                            color="emerald"
                        />

                        <BentoCard
                            title={t('landing.bento_3_title')}
                            desc={t('landing.bento_3_desc')}
                            icon={GlobeAmericasIcon}
                            color="sky"
                        />

                        <BentoCard
                            title={t('landing.bento_4_title')}
                            desc={t('landing.bento_4_desc')}
                            icon={ChartBarIcon}
                            color="rose"
                            cols="md:col-span-2"
                        />

                    </div>
                </section>

                <footer className="py-12 text-center text-slate-400 text-sm border-t border-slate-100 bg-white">
                    <p className="flex items-center justify-center gap-2">
                        Running Data Intelligence
                        <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                        2026
                    </p>
                </footer>
            </div>
        </div>
    );
};

const BentoCard = ({ title, desc, icon: Icon, color, badge, cols = "" }) => {
    // Dynamic color mapping for Tailwind 
    const colorClasses = {
        indigo: "bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white",
        emerald: "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white",
        sky: "bg-sky-50 text-sky-600 group-hover:bg-sky-600 group-hover:text-white",
        rose: "bg-rose-50 text-rose-600 group-hover:bg-rose-600 group-hover:text-white"
    };

    return (
        <motion.div
            whileHover={{ y: -5 }}
            className={`relative overflow-hidden p-8 rounded-3xl bg-white border border-slate-100 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] hover:shadow-[0_20px_40px_-5px_rgba(0,0,0,0.1)] transition-all duration-300 group ${cols}`}
        >
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-6">
                    <div className={`p-3.5 rounded-2xl transition-colors duration-300 ${colorClasses[color]}`}>
                        <Icon className="w-7 h-7" />
                    </div>
                    {badge && <span className="px-2.5 py-1 rounded-full bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest">{badge}</span>}
                </div>

                <h3 className="text-xl font-bold text-slate-900 mb-3">{title}</h3>
                <p className="text-slate-500 leading-relaxed text-sm font-medium">{desc}</p>
            </div>
        </motion.div>
    )
};

export default LandingPage;
