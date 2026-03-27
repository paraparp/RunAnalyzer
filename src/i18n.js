import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// English translations
const en = {
  translation: {
    nav: {
      dashboard: "Dashboard",
      hranalysis: "HR Analysis",
      fitness: "Fitness & Fatigue",
      technique: "Technique",
      zones: "HR Zones",
      heatmap: "Global Heatmap",
      gallery: "Route Gallery",
      consistency: "Consistency",
      vdot: "VDOT",
      gear: "Shoe Garage",
      planner: "AI Coach",
      predictor: "AI Predictor",
      qa: "AI Q&A",
      weekly: "Weekly Volume",
      splits: "Splits",
      races: "Races",
      decoupling: "Decoupling",
      injury: "Injury Risk",
      vo2tracker: "VO2max Tracker",
      export: "Export",
      categories: {
        analytics: "Analytics",
        maps: "Maps",
        ai: "AI Tools",
        performance: "Performance",
        system: "System"
      }
    },
    topbar: {
      all_filter: "All",
      syncing: "Syncing...",
      sync: "Sync Data",
      logout: "Log Out"
    },
    dashboard: {
      distance: "Distance",
      activities: "Activities",
      time: "Time",
      avg_pace: "Avg Pace",
      gap: "GAP",
      elevation: "Elevation",
      monthly_progress: "Monthly Progress",
      annual_distribution: "Annual activity distribution",
      personal_bests: "Personal Bests",
      recent_activities: "Recent Activities",
      view_all: "View all",
      today: "Today",
      yesterday: "Yesterday"
    },
    landing: {
      features: "Features",
      privacy: "Privacy",
      powered_by: "Powered by",
      title_1: "YOUR EVOLUTION",
      title_2: "POWERED BY AI",
      subtitle: "Unlock the true potential of your Strava data. AI-generated training plans, accurate race predictions, and professional-grade analytics.",
      free_access: "Immediate Free Access",
      tech_title: "Cutting-edge Technology",
      tech_desc: "Our suite of tools designed for runners who seek results, not just data.",
      bento_1_title: "AI Workouts",
      bento_1_desc: "Generative algorithms that create adaptive routines based on your fatigue and calendar.",
      bento_2_title: "Race Prediction",
      bento_2_desc: "Estimate your final times for 5K, 10K, and Marathon with astonishing accuracy.",
      bento_3_title: "Global Analysis",
      bento_3_desc: "Visualize annual trends in seconds.",
      bento_4_title: "Deep Metrics",
      bento_4_desc: "80/20 breakdown, GAP, and chronic vs. acute training load."
    },
    maps: {
      title: "Global Heatmap",
      subtitle: "Explore all your routes in a single interactive map. Connect the visual dots of your performance.",
      filter: "Activity Type",
      all: "All runs",
      road: "Road Only",
      trail: "Trail Only",
      long: "Long Runs (+20km)",
      color_mode: "Color Mode",
      density: "Heat/Density",
      pace: "Pace Dynamics",
      hr: "Heart Rate Stress",
      base_map: "Base Map",
      dark: "Dark Mode",
      light: "Light",
      satellite: "Satellite",
      legend_fast: "Fast / Hard",
      legend_slow: "Slow / Easy",
      showing: "Showing",
      routes: "routes"
    }
  }
};

// Spanish translations
const es = {
  translation: {
    nav: {
      dashboard: "Resumen",
      hranalysis: "Análisis FC",
      fitness: "Fitness y Fatiga",
      technique: "Técnica",
      zones: "Zonas FC",
      heatmap: "Heatmap Global",
      gallery: "Galería de Rutas",
      consistency: "Consistencia",
      vdot: "VDOT",
      gear: "Zapatillas",
      planner: "Entrenador AI",
      predictor: "Predictor AI",
      qa: "Preguntas AI",
      weekly: "Volumen Semanal",
      splits: "Parciales",
      races: "Carreras",
      decoupling: "Decoupling",
      injury: "Riesgo Lesión",
      vo2tracker: "Tracker VO2max",
      export: "Exportar",
      categories: {
        analytics: "Analítica",
        maps: "Mapas",
        ai: "Herramientas AI",
        performance: "Rendimiento",
        system: "Sistema"
      }
    },
    topbar: {
      all_filter: "Todo",
      syncing: "Sincronizando...",
      sync: "Sincronizar",
      logout: "Cerrar Sesión"
    },
    dashboard: {
      distance: "Distancia",
      activities: "Actividades",
      time: "Tiempo",
      avg_pace: "Ritmo Med.",
      gap: "GAP",
      elevation: "Desnivel",
      monthly_progress: "Progreso Mensual",
      annual_distribution: "Distribución anual de actividades",
      personal_bests: "Mejores Marcas",
      recent_activities: "Actividades Recientes",
      view_all: "Ver todas",
      today: "Hoy",
      yesterday: "Ayer"
    },
    landing: {
      features: "Características",
      privacy: "Privacidad",
      powered_by: "Potenciado por",
      title_1: "TU EVOLUCIÓN",
      title_2: "IMPULSADA POR IA",
      subtitle: "Desbloquea el verdadero potencial de tus datos de Strava. Planes de entreno generados por IA, predicciones de carrera precisas y analytics de nivel profesional.",
      free_access: "Acceso gratuito inmediato",
      tech_title: "Tecnología de Vanguardia",
      tech_desc: "Nuestra suite de herramientas diseñada para corredores que buscan resultados, no solo datos.",
      bento_1_title: "Entrenamientos AI",
      bento_1_desc: "Algoritmos generativos que crean rutinas adaptativas basadas en tu fatiga y calendario.",
      bento_2_title: "Predicción de Carrera",
      bento_2_desc: "Estima tus tiempos finales en 5K, 10K y Maratón con una precisión asombrosa.",
      bento_3_title: "Análisis Global",
      bento_3_desc: "Visualiza tendencias anuales en segundos.",
      bento_4_title: "Métricas Profundas",
      bento_4_desc: "Desglose 80/20, GAP, y carga de entrenamiento crónica vs aguda."
    },
    maps: {
      title: "Mapa de Calor Global",
      subtitle: "Explora todas tus rutas en un solo mapa interactivo. Las zonas que más transitas resaltan formando tu huella atlética personal.",
      filter: "Filtro",
      all: "Todas mis rutas",
      road: "Solo Asfalto",
      trail: "Solo Trail/Montaña",
      long: "Tiradas Largas (+20k)",
      color_mode: "Modo Relieve",
      density: "Densidad de Huella",
      pace: "Dinámica de Ritmo",
      hr: "Estrés Cardíaco",
      base_map: "Capa Base",
      dark: "Modo Oscuro",
      light: "Modo Claro",
      satellite: "Satélite",
      legend_fast: "Rápido / Intenso",
      legend_slow: "Lento / Suave",
      showing: "Procesando",
      routes: "rutas procesadas"
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en,
      es
    },
    lng: localStorage.getItem('app_language') || 'en', // default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

export default i18n;
