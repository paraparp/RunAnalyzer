import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { motion, useScroll, useTransform } from "framer-motion";
import heroImage from '../assets/Gemini_Generated_Image_5svrde5svrde5svr.jpeg';
import {
    ArrowTrendingUpIcon, SparklesIcon, ChartBarIcon, HeartIcon,
    ShieldExclamationIcon, FireIcon, SignalIcon, MapIcon,
    CalendarDaysIcon, BeakerIcon, StarIcon, ChatBubbleLeftRightIcon,
    BoltIcon, CpuChipIcon, ArrowRightIcon, ChevronDownIcon
} from "@heroicons/react/24/outline";
import Logo from './Logo';
import { useTranslation } from 'react-i18next';

const tx = (lang, en, es) => (lang.startsWith('es') ? es : en);

// Accent sampled from the hero image's sunset
const ACCENT_TEXT = 'text-orange-300';

const GoogleIcon = ({ className = 'w-5 h-5' }) => (
    <svg className={className} viewBox="0 0 48 48">
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
        <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
);

const Reveal = ({ children, delay = 0, className = '' }) => (
    <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
        className={className}
    >
        {children}
    </motion.div>
);

const SectionHeading = ({ eyebrow, title, subtitle, align = 'center' }) => (
    <Reveal className={`mb-14 ${align === 'center' ? 'text-center mx-auto' : ''} max-w-3xl`}>
        <p className="inline-flex items-center gap-2 text-teal-300 text-xs font-bold uppercase tracking-[0.25em] mb-5">
            <span className="w-6 h-px bg-teal-300/60" />
            {eyebrow}
        </p>
        <h2 className="text-4xl md:text-6xl font-black tracking-tighter text-white leading-[0.95] mb-5">
            {title}
        </h2>
        {subtitle && <p className="text-white/55 text-lg leading-relaxed">{subtitle}</p>}
    </Reveal>
);

const Sparkline = () => (
    <svg viewBox="0 0 120 32" className="w-full h-8" preserveAspectRatio="none">
        <defs>
            <linearGradient id="spark" x1="0" x2="1">
                <stop offset="0%" stopColor="#5eead4" />
                <stop offset="100%" stopColor="#fb923c" />
            </linearGradient>
        </defs>
        <motion.path
            d="M0 26 L12 22 L24 24 L36 17 L48 19 L60 12 L72 14 L84 8 L96 10 L108 4 L120 6"
            fill="none" stroke="url(#spark)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: 1.8, delay: 1.2, ease: 'easeInOut' }}
        />
    </svg>
);

const HeroMetric = ({ label, value, unit, accent }) => (
    <div className="px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-semibold mb-1">{label}</p>
        <p className="text-2xl font-black tabular-nums text-white">
            {value}<span className={`text-sm font-semibold ml-0.5 ${accent}`}>{unit}</span>
        </p>
    </div>
);

const BentoCard = ({ icon: Icon, title, description, className = '', glow = 'teal', children, delay = 0 }) => (
    <Reveal delay={delay} className={className}>
        <div className="group relative h-full overflow-hidden rounded-md border border-white/10 bg-white/[0.03] p-7 transition-colors duration-300 hover:border-white/25 hover:bg-white/[0.05]">
            <div className={`pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${glow === 'teal' ? 'bg-teal-400/20' : 'bg-orange-400/20'}`} />
            <div className={`relative w-11 h-11 rounded-sm flex items-center justify-center mb-6 ring-1 ${glow === 'teal' ? 'bg-teal-400/10 ring-teal-300/30 text-teal-300' : 'bg-orange-400/10 ring-orange-300/30 text-orange-300'}`}>
                <Icon className="w-5 h-5" />
            </div>
            <h3 className="relative text-xl font-bold text-white mb-2 tracking-tight">{title}</h3>
            <p className="relative text-white/55 text-sm leading-relaxed">{description}</p>
            {children}
        </div>
    </Reveal>
);

const TestimonialCard = ({ quote, name, role, delay = 0 }) => (
    <Reveal delay={delay}>
        <figure className="h-full rounded-md border border-white/10 bg-white/[0.03] p-7 flex flex-col justify-between">
            <blockquote className="text-white/80 text-base leading-relaxed mb-6">“{quote}”</blockquote>
            <figcaption className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-sm bg-gradient-to-br from-teal-400 to-orange-400 flex items-center justify-center">
                    <span className="text-slate-950 font-black text-xs">{name.substring(0, 2).toUpperCase()}</span>
                </div>
                <div>
                    <p className="text-white font-bold text-sm">{name}</p>
                    <p className="text-white/45 text-xs">{role}</p>
                </div>
            </figcaption>
        </figure>
    </Reveal>
);

const LandingPage = () => {
    const { t, i18n } = useTranslation();
    const lang = i18n.language;
    const heroRef = useRef(null);
    const [scrolled, setScrolled] = useState(false);

    const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
    const imgScale = useTransform(scrollYProgress, [0, 1], [1.05, 1.25]);
    const imgY = useTransform(scrollYProgress, [0, 1], ['0%', '15%']);
    const contentY = useTransform(scrollYProgress, [0, 1], ['0%', '40%']);
    const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 40);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    const changeLanguage = () => {
        const newLang = lang.startsWith('en') ? 'es' : 'en';
        i18n.changeLanguage(newLang);
        localStorage.setItem('app_language', newLang);
    };

    const handleGoogleLogin = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin },
        });
        if (error) console.error('Login error:', error);
    };

    const tools = [
        { icon: HeartIcon, label: tx(lang, 'HR Analysis', 'Análisis FC') },
        { icon: ChartBarIcon, label: tx(lang, 'Fitness & Fatigue', 'Fitness y Fatiga') },
        { icon: FireIcon, label: tx(lang, 'Technique', 'Técnica') },
        { icon: SignalIcon, label: tx(lang, 'Training Zones', 'Zonas FC') },
        { icon: MapIcon, label: tx(lang, 'Global Heatmap', 'Heatmap Global') },
        { icon: CalendarDaysIcon, label: tx(lang, 'Consistency', 'Consistencia') },
        { icon: BeakerIcon, label: tx(lang, 'VDOT Estimator', 'Estimador VDOT') },
        { icon: StarIcon, label: tx(lang, 'Gear Tracker', 'Zapatillas') },
        { icon: SparklesIcon, label: tx(lang, 'AI Coach', 'Entrenador IA') },
        { icon: ArrowTrendingUpIcon, label: tx(lang, 'Race Predictor', 'Predictor') },
        { icon: ChatBubbleLeftRightIcon, label: tx(lang, 'AI Q&A', 'Preguntas IA') },
        { icon: BoltIcon, label: tx(lang, 'Splits', 'Parciales') },
    ];

    return (
        <div className="min-h-screen bg-[#07090d] text-white overflow-x-hidden antialiased selection:bg-teal-300/30">
            <style>{`
                @keyframes ra-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
                .ra-marquee { animation: ra-marquee 40s linear infinite; }
                .ra-marquee:hover { animation-play-state: paused; }
                .ra-grain { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E"); }
                @media (prefers-reduced-motion: reduce) { .ra-marquee { animation: none; } }
            `}</style>

            {/* ==================== NAVBAR ==================== */}
            <motion.nav
                initial={{ y: -40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? 'bg-[#07090d]/70 backdrop-blur-xl border-b border-white/10' : 'bg-transparent border-b border-transparent'}`}
            >
                <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Logo className="w-8 h-8 rounded-sm ring-1 ring-white/20" />
                        <span className="font-black text-lg tracking-tighter">RunAnalyzer</span>
                        <span className="px-2 py-0.5 rounded-sm bg-teal-300/10 ring-1 ring-teal-300/30 text-teal-200 text-[10px] font-bold uppercase tracking-wider">
                            Beta
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <a href="#features" className="hidden md:block text-sm text-white/70 hover:text-white transition-colors px-3">
                            {tx(lang, 'Features', 'Funciones')}
                        </a>
                        <button
                            onClick={changeLanguage}
                            className="px-3 py-1.5 rounded-sm border border-white/20 text-white/80 text-xs font-bold uppercase hover:bg-white/10 transition-colors"
                        >
                            {lang.startsWith('en') ? 'ES' : 'EN'}
                        </button>
                        <button
                            onClick={handleGoogleLogin}
                            className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-sm bg-white text-slate-950 text-xs font-bold hover:bg-teal-100 transition-colors"
                        >
                            <GoogleIcon className="w-4 h-4" />
                            {t('landing.get_started_short', 'Start')}
                        </button>
                    </div>
                </div>
            </motion.nav>

            {/* ==================== HERO — full-bleed cinematic image ==================== */}
            <section ref={heroRef} className="relative h-[100svh] min-h-[680px] overflow-hidden">
                <motion.div style={{ scale: imgScale, y: imgY }} className="absolute inset-0 will-change-transform">
                    <motion.img
                        src={heroImage}
                        alt={tx(lang, 'Runner at sunset on a mountain road above the city', 'Corredora al atardecer en una carretera de montaña sobre la ciudad')}
                        className="w-full h-full object-cover object-[38%_center] md:object-center"
                        loading="eager"
                        fetchpriority="high"
                        initial={{ opacity: 0, scale: 1.08 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
                    />
                </motion.div>

                {/* Overlays: keep the image vivid, only darken where text sits */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent h-1/2" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[#07090d] via-[#07090d]/60 to-transparent" />
                <div className="absolute inset-0 ra-grain opacity-[0.07] mix-blend-overlay pointer-events-none" />

                <motion.div
                    style={{ y: contentY, opacity: contentOpacity }}
                    className="relative z-10 h-full max-w-7xl mx-auto px-6 flex flex-col justify-center pt-16"
                >
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4, duration: 0.6 }}
                        className="inline-flex self-start items-center gap-2 pl-1.5 pr-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/20 text-xs font-semibold mb-8"
                    >
                        <span className="px-2 py-0.5 rounded-sm bg-teal-300 text-slate-950 text-[10px] font-black uppercase">IA</span>
                        <span className="text-white/90">{tx(lang, 'AI-powered running analytics', 'Analítica de running con IA')}</span>
                    </motion.div>

                    <h1 className="font-black tracking-[-0.045em] leading-[0.85] text-[clamp(3.5rem,11vw,10rem)] mb-8">
                        <motion.span
                            className="block text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.35)]"
                            initial={{ opacity: 0, y: 60 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5, duration: 1, ease: [0.22, 1, 0.36, 1] }}
                        >
                            {tx(lang, 'Run', 'Corre')}
                        </motion.span>
                        <motion.span
                            className={`block ${ACCENT_TEXT} pb-2`}
                            initial={{ opacity: 0, y: 60 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.65, duration: 1, ease: [0.22, 1, 0.36, 1] }}
                        >
                            {tx(lang, 'without limits.', 'sin límites.')}
                        </motion.span>
                    </h1>

                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.85, duration: 0.8 }}
                        className="text-lg md:text-xl text-white/80 max-w-md mb-10 leading-relaxed"
                    >
                        {tx(lang,
                            'Your Strava and Garmin data, turned into AI insights to reach what you once thought impossible.',
                            'Tus datos de Strava y Garmin convertidos en insights con IA para alcanzar lo que creías imposible.'
                        )}
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 1, duration: 0.8 }}
                        className="flex flex-col sm:flex-row gap-3"
                    >
                        <button
                            onClick={handleGoogleLogin}
                            className="group flex items-center justify-center gap-3 px-7 py-4 rounded-sm bg-white text-slate-950 font-bold text-sm shadow-[0_10px_40px_-10px_rgba(94,234,212,0.6)] hover:shadow-[0_10px_50px_-5px_rgba(94,234,212,0.8)] transition-all"
                        >
                            <GoogleIcon />
                            {t('landing.continue_with_google', 'Continuar con Google')}
                            <ArrowRightIcon className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </button>
                        <a
                            href="#features"
                            className="flex items-center justify-center gap-2 px-7 py-4 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/25 text-white font-bold text-sm hover:bg-white/20 transition-colors"
                        >
                            {tx(lang, 'Discover more', 'Descubrir más')}
                        </a>
                    </motion.div>
                </motion.div>

                {/* Floating live-metrics glass card, sits over the road */}
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.1, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                    className="hidden lg:block absolute z-10 right-8 xl:right-[max(2rem,calc((100vw-80rem)/2+1.5rem))] bottom-24 w-[380px]"
                >
                    <div className="rounded-md bg-black/30 backdrop-blur-2xl ring-1 ring-white/15 shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-5 pt-4">
                            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">
                                <span className="relative flex w-2 h-2">
                                    <span className="absolute inline-flex h-full w-full rounded-full bg-teal-300 opacity-75 animate-ping" />
                                    <span className="relative inline-flex w-2 h-2 rounded-full bg-teal-300" />
                                </span>
                                {tx(lang, 'Sunset run', 'Rodaje al atardecer')}
                            </span>
                            <span className="text-[11px] text-white/50 tabular-nums">12.4 km</span>
                        </div>
                        <div className="grid grid-cols-3 divide-x divide-white/10">
                            <HeroMetric label={tx(lang, 'Pace', 'Ritmo')} value="4:52" unit="/km" accent="text-teal-300" />
                            <HeroMetric label={tx(lang, 'HR', 'FC')} value="148" unit="ppm" accent="text-orange-300" />
                            <HeroMetric label="VO2max" value="54" unit="" accent="" />
                        </div>
                        <div className="px-5 pb-4">
                            <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] text-white/40 mb-1">
                                <span>{tx(lang, 'Fitness · 8 weeks', 'Forma · 8 semanas')}</span>
                                <span className="text-teal-300 font-bold">+12%</span>
                            </div>
                            <Sparkline />
                        </div>
                    </div>
                </motion.div>

                <motion.a
                    href="#features"
                    aria-label={tx(lang, 'Scroll down', 'Bajar')}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, y: [0, 8, 0] }}
                    transition={{ opacity: { delay: 1.6 }, y: { repeat: Infinity, duration: 2, ease: 'easeInOut' } }}
                    className="absolute z-10 bottom-6 left-1/2 -translate-x-1/2 text-white/60 hover:text-white"
                >
                    <ChevronDownIcon className="w-6 h-6" />
                </motion.a>
            </section>

            {/* ==================== TOOLS MARQUEE ==================== */}
            <section className="relative py-10 border-y border-white/5 overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#07090d] to-transparent z-10" />
                <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#07090d] to-transparent z-10" />
                <div className="flex w-max ra-marquee gap-3">
                    {[...tools, ...tools].map((tool, i) => (
                        <div key={i} className="flex items-center gap-2.5 px-5 py-2.5 rounded-sm border border-white/10 bg-white/[0.03] whitespace-nowrap">
                            <tool.icon className="w-4 h-4 text-teal-300" />
                            <span className="text-sm font-semibold text-white/75">{tool.label}</span>
                        </div>
                    ))}
                </div>
            </section>

            {/* ==================== FEATURES — bento ==================== */}
            <section id="features" className="relative py-28 scroll-mt-16">
                <div className="pointer-events-none absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-teal-500/10 blur-[120px]" />
                <div className="pointer-events-none absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-orange-500/10 blur-[120px]" />
                <div className="relative max-w-7xl mx-auto px-6">
                    <SectionHeading
                        eyebrow={tx(lang, 'Everything you need', 'Todo lo que necesitas')}
                        title={<>{tx(lang, 'Analytics that ', 'Analítica que ')}<span className={ACCENT_TEXT}>{tx(lang, 'move you.', 'te mueve.')}</span></>}
                        subtitle={tx(lang,
                            'From predicting race times to preventing injuries, our AI tools give you the insights you need.',
                            'Desde predecir tiempos hasta prevenir lesiones, nuestras herramientas con IA te dan lo que necesitas.'
                        )}
                    />

                    <div className="grid md:grid-cols-6 gap-4 auto-rows-fr">
                        <BentoCard
                            className="md:col-span-4"
                            icon={ArrowTrendingUpIcon}
                            title={tx(lang, 'Race Predictor', 'Predictor de Carreras')}
                            description={tx(lang,
                                'Predict your 5K, 10K, Half and Marathon times from your current fitness.',
                                'Predice tus tiempos de 5K, 10K, Media y Maratón según tu forma actual.'
                            )}
                        >
                            <div className="relative mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {[['5K', '21:48'], ['10K', '45:30'], ['21K', '1:41:12'], ['42K', '3:32:40']].map(([d, time]) => (
                                    <div key={d} className="rounded-sm bg-white/[0.04] ring-1 ring-white/10 px-4 py-3">
                                        <p className="text-[10px] font-bold tracking-[0.2em] text-white/40">{d}</p>
                                        <p className="text-xl font-black tabular-nums text-white">{time}</p>
                                    </div>
                                ))}
                            </div>
                        </BentoCard>
                        <BentoCard
                            className="md:col-span-2"
                            glow="orange"
                            icon={SparklesIcon}
                            title={tx(lang, 'AI Coach', 'Entrenador IA')}
                            description={tx(lang,
                                'Personalised training advice based on your real performance data.',
                                'Consejos de entrenamiento personalizados basados en tus datos reales.'
                            )}
                            delay={0.05}
                        />
                        <BentoCard
                            className="md:col-span-2"
                            glow="orange"
                            icon={HeartIcon}
                            title={tx(lang, 'Heart Rate', 'Frecuencia Cardiaca')}
                            description={tx(lang,
                                'Advanced HR analysis, drift detection and zone training.',
                                'Análisis avanzado de FC, deriva cardiaca y entrenamiento por zonas.'
                            )}
                            delay={0.1}
                        />
                        <BentoCard
                            className="md:col-span-2"
                            icon={ChartBarIcon}
                            title={tx(lang, 'Fitness & Fatigue', 'Fitness y Fatiga')}
                            description={tx(lang,
                                'Track training load, fitness progression and fatigue over time.',
                                'Monitoriza carga, progresión de forma y fatiga a lo largo del tiempo.'
                            )}
                            delay={0.15}
                        />
                        <BentoCard
                            className="md:col-span-2"
                            glow="orange"
                            icon={ShieldExclamationIcon}
                            title={tx(lang, 'Injury Risk', 'Riesgo de Lesión')}
                            description={tx(lang,
                                'Spot overtraining signals before they become injuries with ACWR.',
                                'Detecta señales de sobreentrenamiento antes de que sean lesiones.'
                            )}
                            delay={0.2}
                        />
                    </div>
                </div>
            </section>

            {/* ==================== SHOWCASE — image again, wide ==================== */}
            <section className="relative py-12 md:py-20">
                <div className="max-w-7xl mx-auto px-6">
                    <Reveal>
                        <div className="relative overflow-hidden rounded-md ring-1 ring-white/10 min-h-[520px] flex items-end">
                            <img
                                src={heroImage}
                                alt=""
                                loading="lazy"
                                className="absolute inset-0 w-full h-full object-cover object-[20%_75%] scale-110"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                            <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />

                            <div className="relative w-full p-8 md:p-14 grid lg:grid-cols-2 gap-10 items-end">
                                <div>
                                    <p className="inline-flex items-center gap-2 text-orange-300 text-xs font-bold uppercase tracking-[0.25em] mb-5">
                                        <MapIcon className="w-4 h-4" />
                                        {tx(lang, 'Your running journey', 'Tu viaje corriendo')}
                                    </p>
                                    <h2 className="text-4xl md:text-6xl font-black tracking-tighter leading-[0.95] mb-5">
                                        {tx(lang, 'Every kilometre,', 'Cada kilómetro,')}<br />
                                        <span className={ACCENT_TEXT}>{tx(lang, 'mapped.', 'mapeado.')}</span>
                                    </h2>
                                    <p className="text-white/70 text-lg max-w-md leading-relaxed">
                                        {tx(lang,
                                            'See where you have been, how far you have come and plan where you are going next.',
                                            'Mira dónde has estado, cuánto has avanzado y planea adónde vas después.'
                                        )}
                                    </p>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    {[
                                        ['1,284', tx(lang, 'km tracked', 'km registrados')],
                                        ['247', tx(lang, 'activities', 'actividades')],
                                        ['+85%', tx(lang, 'progress', 'progreso')],
                                    ].map(([v, l]) => (
                                        <div key={l} className="rounded-sm bg-white/10 backdrop-blur-xl ring-1 ring-white/15 p-4">
                                            <p className="text-2xl md:text-3xl font-black tabular-nums">{v}</p>
                                            <p className="text-[10px] uppercase tracking-[0.2em] text-white/55 mt-1">{l}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </Reveal>
                </div>
            </section>

            {/* ==================== STATS STRIP ==================== */}
            <section className="py-16">
                <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-px rounded-md overflow-hidden bg-white/10 ring-1 ring-white/10">
                    {[
                        ['20+', t('landing.stats.tools', 'Analytics Tools'), CpuChipIcon],
                        ['AI', t('landing.stats.ai', 'Gemini Powered'), SparklesIcon],
                        ['∞', t('landing.stats.activities', 'Strava Activities'), ArrowTrendingUpIcon],
                        ['VO2', t('landing.stats.vo2', 'VO2max Tracker'), HeartIcon],
                    ].map(([v, l, Icon], i) => (
                        <Reveal key={i} delay={i * 0.05} className="bg-[#07090d] p-8">
                            <Icon className="w-5 h-5 text-teal-300 mb-4" />
                            <p className="text-4xl md:text-5xl font-black tracking-tight">{v}</p>
                            <p className="text-white/50 text-xs font-semibold uppercase tracking-[0.2em] mt-2">{l}</p>
                        </Reveal>
                    ))}
                </div>
            </section>

            {/* ==================== TESTIMONIALS ==================== */}
            <section id="testimonials" className="py-28">
                <div className="max-w-7xl mx-auto px-6">
                    <SectionHeading
                        eyebrow={tx(lang, 'Trusted by runners', 'Confían los corredores')}
                        title={tx(lang, 'What runners are saying', 'Lo que dicen los corredores')}
                    />
                    <div className="grid md:grid-cols-2 gap-4">
                        <TestimonialCard
                            quote={tx(lang,
                                'I never thought I could break the 4-hour marathon barrier. RunAnalyzer showed me I was capable and gave me the exact plan. Crossed the line in 3:52.',
                                'Nunca pensé que podría bajar de 4 horas en maratón. RunAnalyzer me mostró que era capaz y me dio el plan exacto. Crucé en 3:52.'
                            )}
                            name={tx(lang, 'Michael Chen', 'Carlos R.')}
                            role={tx(lang, 'Marathon Runner', 'Maratonista')}
                        />
                        <TestimonialCard
                            quote={tx(lang,
                                'After three injuries in two years, I was ready to quit. RunAnalyzer helped me train smarter. Now I run pain-free and just set a new 10K PR.',
                                'Después de tres lesiones en dos años, estaba a punto de dejarlo. RunAnalyzer me ayudó a entrenar mejor. Ahora corro sin dolor y acabo de batir mi marca en 10K.'
                            )}
                            name={tx(lang, 'Sarah Johnson', 'Laura M.')}
                            role={tx(lang, 'Competitive Runner', 'Corredora Competitiva')}
                            delay={0.1}
                        />
                        <TestimonialCard
                            quote={tx(lang,
                                'The AI coach feels like having a world-class trainer in my pocket. It understands my body, my goals, and pushes me just the right amount.',
                                'El entrenador IA es como tener un entrenador de primer nivel en el bolsillo. Entiende mi cuerpo, mis metas y me exige lo justo.'
                            )}
                            name={tx(lang, 'David Kim', 'Javier L.')}
                            role={tx(lang, '5K Specialist', 'Especialista 5K')}
                            delay={0.15}
                        />
                        <TestimonialCard
                            quote={tx(lang,
                                'I have been running for 15 years and thought I knew everything. RunAnalyzer proved me wrong, in the best way.',
                                'Llevo 15 años corriendo y pensaba que lo sabía todo. RunAnalyzer me demostró lo contrario, de la mejor manera.'
                            )}
                            name={tx(lang, 'James Wilson', 'Alejandro G.')}
                            role={tx(lang, 'Veteran Runner', 'Corredor Veterano')}
                            delay={0.2}
                        />
                    </div>
                </div>
            </section>

            {/* ==================== FINAL CTA — sunset crop ==================== */}
            <section className="relative overflow-hidden">
                <img
                    src={heroImage}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover object-[85%_45%]"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-[#07090d] via-black/40 to-[#07090d]" />
                <div className="relative max-w-4xl mx-auto px-6 py-40 text-center">
                    <Reveal>
                        <p className="text-orange-200 text-xs font-bold uppercase tracking-[0.3em] mb-6">
                            {tx(lang, 'Your turn', 'Tu turno')}
                        </p>
                        <h2 className="text-5xl md:text-7xl font-black tracking-tighter leading-[0.9] mb-6">
                            {tx(lang, 'What will your', '¿Cuál será tu')}<br />
                            <span className={ACCENT_TEXT}>{tx(lang, 'running story be?', 'historia corriendo?')}</span>
                        </h2>
                        <p className="text-white/75 text-lg max-w-xl mx-auto mb-10">
                            {tx(lang, 'Every great achievement starts with a single step. Take yours today.', 'Todo gran logro empieza con un solo paso. Da el tuyo hoy.')}
                        </p>
                        <button
                            onClick={handleGoogleLogin}
                            className="group inline-flex items-center gap-3 px-8 py-4 rounded-sm bg-white text-slate-950 font-bold text-sm shadow-[0_10px_50px_-10px_rgba(251,146,60,0.7)] hover:shadow-[0_10px_60px_-5px_rgba(251,146,60,0.9)] transition-all"
                        >
                            <GoogleIcon />
                            {tx(lang, 'Begin your journey', 'Empieza ahora')}
                            <ArrowRightIcon className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </button>
                    </Reveal>
                </div>
            </section>

            {/* ==================== FOOTER ==================== */}
            <footer className="border-t border-white/10 py-10">
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-3">
                        <Logo className="w-8 h-8 rounded-sm" />
                        <span className="font-black tracking-tighter">RunAnalyzer</span>
                        <span className="text-white/40 text-sm hidden sm:inline">· {tx(lang, 'AI-powered running analytics', 'Analítica de running con IA')}</span>
                    </div>
                    <div className="flex gap-6 text-sm text-white/50">
                        <a href="#features" className="hover:text-white transition-colors">{tx(lang, 'Features', 'Funciones')}</a>
                        <a href="#" className="hover:text-white transition-colors">{tx(lang, 'Privacy', 'Privacidad')}</a>
                        <a href="#" className="hover:text-white transition-colors">{tx(lang, 'Contact', 'Contacto')}</a>
                    </div>
                    <p className="text-white/35 text-xs">
                        {tx(lang, '© 2026 RunAnalyzer. All rights reserved.', '© 2026 RunAnalyzer. Todos los derechos reservados.')}
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
