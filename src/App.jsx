import { useCallback, useEffect, useState, useMemo, Suspense, lazy } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { supabase } from './lib/supabase';
import cloudStorage, { hydrate, reset as resetCloudStorage, flush as flushCloudStorage } from './lib/cloudStorage';
import { useTranslation } from 'react-i18next';
import './App.css';
import StravaCallback from './components/StravaCallback';
import OfflineBanner from './components/OfflineBanner';
import RunQA from './components/RunQA';
import Logo from './components/Logo';
import UserMenu from './components/UserMenu';
import LandingPage from './components/LandingPage';
import TodayView from './components/TodayView';
import { TimeScopeProvider, TimeScopeSelector } from './components/TimeScope';
// Vistas secundarias: solo se monta una a la vez (viewMap), así que se cargan
// bajo demanda. Esto saca del bundle inicial sus dependencias pesadas
// (recharts/tremor, leaflet en los mapas, jspdf en el planner).
const ActivityLog = lazy(() => import('./components/ActivityLog'));
const FitnessFatigue = lazy(() => import('./components/FitnessFatigue'));
const WeeklyProgression = lazy(() => import('./components/WeeklyProgression'));
const InjuryRisk = lazy(() => import('./components/InjuryRisk'));
const HRAnalysis = lazy(() => import('./components/HRAnalysis'));
const TechniqueAnalysis = lazy(() => import('./components/TechniqueAnalysis'));
const TrainingZones = lazy(() => import('./components/TrainingZones'));
const RouteGallery = lazy(() => import('./components/RouteGallery'));
const ConsistencyHeatmap = lazy(() => import('./components/ConsistencyHeatmap'));
const GearTracker = lazy(() => import('./components/GearTracker'));
const TargetRaces = lazy(() => import('./components/TargetRaces'));
const RaceDetector = lazy(() => import('./components/RaceDetector'));
const CriticalSpeed = lazy(() => import('./components/CriticalSpeed'));
const TrainingPlanner = lazy(() => import('./components/TrainingPlanner'));
const RacePredictor = lazy(() => import('./components/RacePredictor'));
const FitnessHub = lazy(() => import('./components/FitnessHub'));
const HealthHub = lazy(() => import('./components/HealthHub'));
const DataExporter = lazy(() => import('./components/DataExporter'));
const HrCalibration = lazy(() => import('./components/HrCalibration'));
const Connections = lazy(() => import('./components/Connections'));
const GlobalHeatmap = lazy(() => import('./components/GlobalHeatmap'));
const GeoZones = lazy(() => import('./components/GeoZones'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const SessionView = lazy(() => import('./components/SessionView'));
import useHrParams from './hooks/useHrParams';
import useIsAdmin from './hooks/useIsAdmin';

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
import { getActivity, getActivityStreams, getStravaAuthUrl } from './services/strava';
import { computeFlatEfforts, needsFlatEfforts } from './lib/flatEfforts';
import { computeStreamGap, needsStreamGap } from './lib/streamGap';
import { computeHrEffort, needsHrEffort } from './lib/hrEffortWindow';
import { slimActivity, persistStravaData, readStravaData } from './lib/stravaStore';
import syncAll from './lib/syncAll';
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  Squares2X2Icon,
  SparklesIcon,
  ArrowTrendingUpIcon,
  ChatBubbleLeftRightIcon,
  ArrowDownTrayIcon,
  Bars3Icon,
  XMarkIcon,
  BoltIcon,
  ClockIcon,
  FireIcon,
  MapPinIcon,
  ChartBarIcon,
  HeartIcon,
  ChartPieIcon,
  MapIcon,
  SignalIcon,
  CalendarDaysIcon,
  ExclamationTriangleIcon,
  BeakerIcon,
  StarIcon,
  RectangleGroupIcon,
  TrophyIcon,
  FlagIcon,
  Cog6ToothIcon,
  LinkIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";

const NAV_ITEMS = [
  { id: 'dashboard',  icon: Squares2X2Icon },
  { id: 'pmc', icon: ArrowTrendingUpIcon },
  { id: 'weekly', icon: CalendarDaysIcon },
  { id: 'injury', icon: ExclamationTriangleIcon },
  { id: 'hranalysis', icon: HeartIcon },
  { id: 'technique', icon: FireIcon },
  { id: 'zones', icon: SignalIcon },
  { id: 'log', icon: ChartBarIcon },
  { id: 'heatmap', icon: MapIcon },
  { id: 'gallery', icon: RectangleGroupIcon },
  { id: 'geozones', icon: MapPinIcon },
  { id: 'consistency', icon: CalendarDaysIcon },
  { id: 'gear', icon: StarIcon },
  { id: 'targets', icon: FlagIcon },
  { id: 'racehistory', icon: ClockIcon },
  { id: 'criticalspeed', icon: BoltIcon },
  { id: 'planner', icon: SparklesIcon },
  { id: 'predictor', icon: ArrowTrendingUpIcon },
  { id: 'fitness', icon: BeakerIcon },
  { id: 'health', icon: HeartIcon },
  { id: 'calibration', icon: AdjustmentsHorizontalIcon },
  { id: 'connections', icon: LinkIcon },
  { id: 'export', icon: ArrowDownTrayIcon },
];

// Vista solo para administradores. Vive fuera de NAV_ITEMS a propósito: se añade
// en tiempo de ejecución si `is_admin()` dice que sí, de modo que para el resto
// de usuarios ni existe la entrada ni la ruta responde (currentView la descarta).
// El gating es cosmético; quien mande la URL a mano verá el dashboard, y
// /api/admin le devolvería 403 igualmente.
const ADMIN_NAV_ITEM = { id: 'admin', icon: ShieldCheckIcon };

// Las categorías agrupan por la PREGUNTA que responde cada vista. Cinco, y
// ninguna con un solo ítem: una categoría que al abrirla da una sola cosa es un
// clic de peaje, no jerarquía. Las dos fronteras que antes se discutían están
// resueltas a propósito: las predicciones y el historial son de COMPETICIÓN (son
// sobre correr una carrera, no sobre fisiología), y todo lo que mide el motor
// —capacidad y adaptación— vive junto en MOTOR en vez de repartido entre
// "fisiología" y "rendimiento".
// El plan completo, con el inventario de cada sección, está en
// docs/REESTRUCTURACION_SECCIONES.md.
const NAV_CATEGORIES = [
  { id: 'today', icon: Squares2X2Icon, itemIds: ['dashboard'] },
  { id: 'sessions', icon: ChartBarIcon, itemIds: ['log', 'heatmap', 'gallery', 'geozones', 'gear'] },
  { id: 'load', icon: ChartPieIcon, itemIds: ['pmc', 'weekly', 'injury', 'consistency'] },
  // Capacidad primero (el techo: curva, VDOT/VO2, umbrales), adaptación después
  // (la tendencia: respuesta cardíaca, técnica, vitales). Son los dos ejes en
  // los que las fases 3-5 van a fundir estos seis ítems.
  { id: 'engine', icon: BeakerIcon, itemIds: ['criticalspeed', 'fitness', 'zones', 'hranalysis', 'technique', 'health'] },
  { id: 'racing', icon: TrophyIcon, itemIds: ['targets', 'planner', 'predictor', 'racehistory'] },
  { id: 'settings', icon: Cog6ToothIcon, itemIds: ['calibration', 'connections', 'export'] },
];

// Vistas que acotan el histórico con el período compartido (lib/timeScope). Solo
// en ellas se enseña el selector: ponerlo donde no manda nada invitaría a pensar
// que filtra lo que no filtra.
const SCOPED_VIEWS = new Set(['pmc', 'weekly', 'criticalspeed', 'fitness', 'zones', 'hranalysis', 'health']);

const Dashboard = ({ user, handleLogout }) => {
  const { t, i18n } = useTranslation();
  const [stravaData, setStravaData] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const changeLanguage = () => {
    const newLang = i18n.language.startsWith('en') ? 'es' : 'en';
    i18n.changeLanguage(newLang);
    cloudStorage.setItem('app_language', newLang);
  };


  // ── Chat: panel transversal, no sección ─────────────────────────────────────
  // Preguntar es algo que se hace DESDE donde estés (mirando el PMC, un entreno
  // o una predicción), no un sitio al que ir: como ítem del menú obligaba a salir
  // de la vista sobre la que ibas a preguntar, y su layout a pantalla completa
  // metía un caso especial en cuatro sitios del shell.
  // Se monta una vez abierto y se oculta al cerrar (así la conversación
  // sobrevive); `chatSeedKey` lo REMONTA cuando llega semilla nueva desde el
  // panel de IA, que es lo que relanza la lectura de `runqa_seed`.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMounted, setChatMounted] = useState(false);
  const [chatSeedKey, setChatSeedKey] = useState(0);
  const openChat = useCallback(({ withSeed = false } = {}) => {
    setChatMounted(true);
    if (withSeed) setChatSeedKey(k => k + 1);
    setChatOpen(true);
  }, []);
  // La vista activa vive en la URL (/status, /planner, …) para sobrevivir recargas.
  // El segundo segmento es el id de la carrera en /targets y el de la actividad en
  // /activity/:id (la vista de sesión).
  const { view: viewParam, raceId: routeId } = useParams();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const navItems = useMemo(() => (isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS), [isAdmin]);
  const navCategories = useMemo(() => (
    isAdmin
      ? NAV_CATEGORIES.map(c => (c.id === 'settings' ? { ...c, itemIds: [...c.itemIds, 'admin'] } : c))
      : NAV_CATEGORIES
  ), [isAdmin]);
  // La sesión no está en el menú (es un detalle, no un sitio al que ir), así que se
  // resuelve aparte y cuelga de Sesiones a efectos de navegación.
  const currentView = viewParam === 'activity' && routeId
    ? 'activity'
    : navItems.some(i => i.id === viewParam) ? viewParam : 'dashboard';
  const navView = currentView === 'activity' ? 'log' : currentView;
  const setCurrentView = useCallback(
    (v) => navigate(v === 'dashboard' ? '/' : `/${v}`),
    [navigate]
  );

  const handleFetchDetails = async (activityId) => {
    if (!stravaData || !stravaData.activities) return;
    const activityIndex = stravaData.activities.findIndex(a => a.id === activityId);
    if (activityIndex === -1) return;
    const activity = stravaData.activities[activityIndex];
    if (activity.laps && activity.laps.length > 0 && activity.laps[0].elevation_difference !== undefined) return;

    try {
      const accessToken = stravaData.accessToken;
      const detailedActivity = await getActivity(accessToken, activityId);

      // Enriquecer laps con desnivel real usando streams si es posible
      if (detailedActivity.laps && detailedActivity.laps.length > 0) {
        try {
          const streams = await getActivityStreams(accessToken, activityId);
          if (streams && streams.altitude) {
            detailedActivity.laps = detailedActivity.laps.map(lap => {
              const startAlt = streams.altitude.data[lap.start_index];
              const endAlt = streams.altitude.data[lap.end_index];
              return {
                ...lap,
                elevation_difference: endAlt - startAlt
              };
            });
          }
        } catch (streamErr) {
          console.warn("Could not fetch streams for elevation calculation", streamErr);
        }
      }

      setStravaData(prev => {
        const updatedActivities = [...prev.activities];
        updatedActivities[activityIndex] = slimActivity(detailedActivity, activity);
        const updatedData = { ...prev, activities: updatedActivities };
        persistStravaData(updatedData);
        return updatedData;
      });
    } catch (err) {
      console.error("Failed to fetch activity details", err);
    }
  };

  // Enriquece en segundo plano los parciales (splits_metric) que falten tras un
  // sync. Se limita a carreras recientes sin detalle, con throttle y tope por sync,
  // para no tocar el rate-limit de Strava. Cada resultado se persiste en Supabase,
  // así que a lo largo de varios syncs se completa y no se vuelve a pedir nunca más.
  // days=null: TODO el histórico. Antes se cortaba en 400 días, y como el selector
  // de período de Zonas llega a 3 años y "Todo", cualquier actividad más vieja se
  // clasificaba por su FC media — un rodaje entero colapsado en UNA zona, lo que
  // infla Z2 y borra el Z1 del calentamiento y el Z3+ de los repechos. cap=60 por
  // sync fija cuántas trae de golpe: a 400ms de throttle son ~24s en segundo plano,
  // y a lo largo de varios syncs completa el histórico (cada resultado se persiste,
  // así que no se vuelve a pedir nunca más).
  const enrichMissingSplits = async (acts, accessToken, { cap = 60, days = null } = {}) => {
    if (!accessToken || !Array.isArray(acts)) return;
    const isRun = (a) => ['Run', 'TrailRun', 'VirtualRun'].includes(a.type);
    const since = days == null ? null : Date.now() - days * 86400000;
    const need = acts
      .filter(a => isRun(a) && a.distance > 0 && !a.splits_metric
                && (since == null || new Date(a.start_date).getTime() >= since))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
      .slice(0, cap);
    for (const act of need) {
      try {
        const detail = await getActivity(accessToken, act.id);
        if (!detail?.splits_metric) continue;
        setStravaData(prev => {
          if (!prev?.activities) return prev;
          const idx = prev.activities.findIndex(x => x.id === act.id);
          if (idx === -1) return prev;
          const updated = [...prev.activities];
          updated[idx] = slimActivity(detail, prev.activities[idx]);
          const nd = { ...prev, activities: updated };
          persistStravaData(nd);
          return nd;
        });
      } catch (e) {
        console.warn('[sync] enrich parciales falló', act.id, e);
      }
      await new Promise(r => setTimeout(r, 400)); // throttle anti rate-limit
    }
  };

  // Enriquece a partir de los streams (distance+altitude+time+grade_smooth+
  // heartrate+watts) los tres cálculos que los necesitan —el mejor 1km/2km llano
  // (flat_efforts), el GAP muestra a muestra (stream_gap) y el perfil FC-esfuerzo
  // por bloques (hr_effort)— y guarda SOLO los resultados, que son pequeños.
  // Una descarga, tres campos: pedirlos por separado triplicaría el gasto de API. Como los parciales, va en
  // segundo plano, con throttle y tope por sync; a lo largo de varios syncs cubre
  // todo el histórico y no se vuelve a pedir. Se cachea también el resultado vacío.
  const enrichMissingFlatEfforts = async (acts, accessToken, { cap = 30 } = {}) => {
    if (!accessToken || !Array.isArray(acts)) return;
    const isRun = (a) => ['Run', 'TrailRun', 'VirtualRun'].includes(a.type);
    const need = acts
      .filter(a => isRun(a) && a.distance >= 1000
        && (needsFlatEfforts(a) || needsStreamGap(a) || needsHrEffort(a)))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
      .slice(0, cap);
    for (const act of need) {
      try {
        const streams = await getActivityStreams(accessToken, act.id);
        // Los dos devuelven siempre un objeto con `_v`, aunque no haya ningún tramo
        // llano o no se pueda calcular el GAP: así esta actividad no se vuelve a
        // pedir hasta que cambie la versión del algoritmo.
        const flat_efforts = computeFlatEfforts(streams);
        const stream_gap = computeStreamGap(streams);
        const hr_effort = computeHrEffort(streams);
        setStravaData(prev => {
          if (!prev?.activities) return prev;
          const idx = prev.activities.findIndex(x => x.id === act.id);
          if (idx === -1) return prev;
          const updated = [...prev.activities];
          updated[idx] = { ...prev.activities[idx], flat_efforts, stream_gap, hr_effort };
          const nd = { ...prev, activities: updated };
          persistStravaData(nd);
          return nd;
        });
      } catch (e) {
        console.warn('[sync] enrich tramos llanos falló', act.id, e);
      }
      await new Promise(r => setTimeout(r, 400)); // throttle anti rate-limit
    }
  };


  const [isSyncing, setIsSyncing] = useState(false);

  // Todo el sync vive en `lib/syncAll`: Strava, la salud y el sueño de Garmin y
  // las actividades con dinámica, en ese orden y con un solo aviso al final. Aquí
  // solo queda lo que es de la UI: el espejo en el estado de React, el spinner y
  // el enriquecido en segundo plano (que necesita los streams y setStravaData).
  //
  // `force` es la ÚNICA diferencia entre entrar a la app y pulsar el botón: al
  // entrar no se vuelve a bajar el listado de Strava si ya se bajó hoy (el
  // rate-limit no aguanta un refresco por navegación); el botón sí, porque el
  // usuario lo está pidiendo. Los carriles son independientes: sin Strava
  // conectado, Garmin se sincroniza igual.
  const runSync = async (force = false) => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await syncAll({
        force,
        onStravaData: setStravaData,
        onStravaDisconnected: () => setStravaData(null),
        onActivities: (activities, accessToken) => {
          // Sin await a propósito: rellenan el backlog en segundo plano con su
          // propio throttle y tope por sync, sin retrasar el carril de Garmin.
          enrichMissingSplits(activities, accessToken);
          enrichMissingFlatEfforts(activities, accessToken);
        },
      });
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    // Primero se pinta lo guardado (la app arranca con datos, no en blanco) y
    // luego se sincroniza. El saneo retroactivo recorta payloads inflados por
    // versiones anteriores (segment_efforts, polylines completas…) y libera cuota.
    const saved = readStravaData();
    if (saved) {
      if (Array.isArray(saved.activities)) {
        saved.activities = saved.activities.map(a => slimActivity(a, a));
        persistStravaData(saved);
      }
      setStravaData(saved);
    }
    // Fuera del `if`: antes este sync entero colgaba de que hubiera `stravaData`
    // guardado, así que quien solo tenía Garmin conectado no sincronizaba nada.
    runSync(false);
    // Deliberadamente SOLO al montar: es el refresco de entrada a la app. Meter
    // `runSync` en las dependencias lo relanzaría cada vez que cambia su
    // identidad, es decir, en cada render — que es justo lo contrario de lo que
    // hace falta contra el rate-limit de Strava y de Garmin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `/qa` era una sección y puede estar en un marcador: ahora abre el panel y
  // deja la URL limpia, en vez de caer en silencio al dashboard.
  useEffect(() => {
    if (viewParam === 'qa') {
      openChat();
      navigate('/', { replace: true });
    }
  }, [viewParam, openChat, navigate]);

  const connectToStrava = () => {
    window.location.href = getStravaAuthUrl();
  };

  // Memoized: useHrParams runs the HRmax/LTHR detectors over this list, so a new
  // array identity every render would re-scan the whole history on every keystroke.
  const runningActivities = useMemo(() => stravaData?.activities
    ? stravaData.activities.filter(activity => RUNNING_TYPES.includes(activity.type) || RUNNING_TYPES.includes(activity.sport_type))
    : [], [stravaData]);

  // Memoizada por el mismo motivo que `runningActivities`: el modelo de carga
  // (CTL/ATL/ACWR) consume TODOS los deportes, y una identidad nueva por render
  // le hace recalcular el PMC entero en cada repintado.
  const allActivities = useMemo(() => stravaData?.activities ?? [], [stravaData]);

  // Calibrated FCmax / FCreposo / LTHR, resolved once and shared by the zones tab
  // and the per-lap zone badges so both classify a given bpm identically.
  const hrParams = useHrParams(runningActivities);


  const currentNavItem = navItems.find(item => item.id === navView);
  const pageTitle = currentNavItem ? t(`nav.${currentNavItem.id}`) : t('nav.dashboard');
  const openActivity = useCallback((id) => navigate(`/activity/${id}`), [navigate]);
  // Volver es "atrás" si se llegó navegando; si se entró por la URL directa, atrás
  // saldría de la app, así que se cae a la bitácora.
  const goBackFromActivity = useCallback(
    () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/log')),
    [navigate]
  );

  // Sidebar component
  const SidebarContent = () => {
    const activeCatId = navCategories.find(cat => cat.itemIds.includes(navView))?.id;
    return (
      <>
        {/* Logo */}
        <div className="px-5 py-6 shrink-0">
          <div className="flex items-center gap-3">
            <Logo className="w-11 h-11 rounded-2xl ring-1 ring-blue-100 shadow-sm shadow-blue-500/10" />
            <div className="leading-none">
              <div className="text-[18px] font-black italic tracking-tight bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 bg-clip-text text-transparent">RunAnalyzer</div>
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-slate-400 mt-1.5">AI Running Analytics</div>
            </div>
          </div>
        </div>

        {/* Navigation — top-level categories only */}
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {navCategories.map(cat => {
            const Icon = cat.icon;
            const isActive = cat.id === activeCatId;
            return (
              <div key={cat.id} className="mb-0.5">
                <button
                  onClick={() => {
                    if (!isActive) setCurrentView(cat.itemIds[0]);
                    // Don't close mobile menu here if we just clicked a category, let them see the submenu
                    // setMobileMenuOpen(false); 
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 text-sm transition-all active:opacity-75 ${isActive
                    ? 'text-blue-700 font-bold border-r-4 border-blue-600 bg-blue-50/50'
                    : 'text-slate-500 font-medium hover:text-blue-600 hover:bg-slate-100/80 border-r-4 border-transparent'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-5 h-5 shrink-0`} />
                    <span>{t(`nav.categories.${cat.id}`)}</span>
                  </div>
                  {isActive ? <ChevronDownIcon className="w-4 h-4 text-blue-500" /> : <ChevronRightIcon className="w-4 h-4 opacity-0 group-hover:opacity-50" />}
                </button>

                {/* Submenus (only shown if category is active) */}
                {isActive && (
                  <div className="pl-11 pr-2 py-1.5 space-y-0.5 mr-2">
                    {cat.itemIds.map(itemId => {
                      const item = navItems.find(i => i.id === itemId);
                      if (!item) return null;
                      const isItemActive = currentView === itemId;
                      return (
                        <button
                          key={itemId}
                          onClick={() => {
                            setCurrentView(itemId);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-lg transition-all ${isItemActive
                            ? 'text-blue-700 font-bold bg-blue-100/40'
                            : 'text-slate-500 font-medium hover:text-blue-600 hover:bg-slate-100'
                            }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${isItemActive ? 'bg-blue-600' : 'bg-transparent'}`} />
                          <span className="truncate">{t(`nav.${item.id}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User section */}
        <div className="mt-auto px-3 pb-5 border-t border-slate-200 dark:border-slate-800 pt-3">
          <UserMenu
            user={user}
            handleLogout={handleLogout}
            changeLanguage={changeLanguage}
            placement="sidebar"
          />
        </div>
      </>
    );
  };

  if (!stravaData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
            <div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <BoltIcon className="w-7 h-7 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{t('auth.connect_title', 'Conecta Strava')}</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">{t('auth.connect_desc', 'Vincula tu cuenta para visualizar y analizar tu rendimiento.')}</p>
            <button
              onClick={connectToStrava}
              className="w-full py-3 px-6 bg-[#fc4c02] hover:bg-[#e34402] text-white text-sm font-bold rounded-xl transition-colors"
            >
              {t('auth.connect_btn', 'Conectar con Strava')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-main)' }}>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-slate-50 dark:bg-slate-950 border-r border-slate-200/60 dark:border-slate-800 shrink-0 h-screen z-50">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="sidebar-overlay fixed inset-0" onClick={() => setMobileMenuOpen(false)} />
          <aside className="sidebar-enter fixed inset-y-0 left-0 w-[260px] bg-slate-50 shadow-2xl flex flex-col z-50">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        {(() => {
          const activeCat = navCategories.find(cat => cat.itemIds.includes(navView));
          const subItems = (activeCat?.itemIds ?? []).map(id => navItems.find(i => i.id === id)).filter(Boolean);
          return (
            <header className="sticky top-0 z-40 flex justify-between items-center px-8 w-full bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl h-16 shadow-sm dark:shadow-none shrink-0 gap-6">
              {/* Mobile menu */}
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-1.5 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <Bars3Icon className="w-5 h-5" />
              </button>

              <div className="flex items-center space-x-8">
                {/* Section title */}
                <h2 className="text-lg font-bold text-slate-900 tracking-tight shrink-0">{activeCat ? t(`nav.categories.${activeCat.id}`) : pageTitle}</h2>

                {/* Sub-navigation tabs — con un solo ítem no hay nada que elegir */}
                <nav className="hidden md:flex items-center space-x-6">
                  {(subItems.length > 1 ? subItems : []).map(item => (
                    <button
                      key={item.id}
                      onClick={() => setCurrentView(item.id)}
                      className={`text-sm font-medium whitespace-nowrap pb-1 transition-colors ${currentView === item.id
                        ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600'
                        : 'text-slate-500 dark:text-slate-400 hover:text-blue-700 border-b-2 border-transparent'
                        }`}
                    >
                      {t(`nav.${item.id}`)}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Right: year filter + sync + avatar */}
              <div className="flex items-center gap-3 shrink-0 ml-auto">
                <button
                  onClick={changeLanguage}
                  className="px-2 py-1 text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg uppercase tracking-wider transition-colors"
                  title={i18n.language.startsWith('en') ? 'Switch to Spanish' : 'Cambiar a Inglés'}
                >
                  {i18n.language.startsWith('en') ? 'EN' : 'ES'}
                </button>
                <button
                  onClick={() => runSync(true)}
                  disabled={isSyncing}
                  className={`inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl transition-all ${isSyncing ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-200'
                    }`}
                >
                  <ArrowPathIcon className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? t('topbar.syncing') : t('topbar.sync')}
                </button>
                <UserMenu
                  user={user}
                  handleLogout={handleLogout}
                  changeLanguage={changeLanguage}
                  placement="topbar"
                />
              </div>
            </header>
          );
        })()}

        {/* Scrollable Content */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full p-4 max-w-[1400px] lg:p-8 space-y-6">

            {currentView === 'dashboard' && (
              <TodayView
                activities={allActivities}
                runningActivities={runningActivities}
                hrParams={hrParams}
                onNavigate={(v) => navigate(v === 'dashboard' ? '/' : `/${v}`)}
                onOpenChat={() => openChat({ withSeed: true })}
                onSync={() => runSync(true)}
                isSyncing={isSyncing}
              />
            )}

            {SCOPED_VIEWS.has(currentView) && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('time_scope.label')}</span>
                <TimeScopeSelector />
              </div>
            )}

            {currentView !== 'dashboard' && (() => {
              const viewMap = {
                log:         <ActivityLog activities={allActivities} runningActivities={runningActivities} hrParams={hrParams} onEnrichActivity={handleFetchDetails} onOpenActivity={openActivity} />,
                activity:    <SessionView key={routeId} activityId={routeId} activities={allActivities} hrParams={hrParams} onBack={goBackFromActivity} onOpenActivity={openActivity} onEnrichActivity={handleFetchDetails} />,
                pmc:         <FitnessFatigue activities={allActivities} />,
                weekly:      <WeeklyProgression activities={allActivities} />,
                injury:      <InjuryRisk activities={allActivities} />,
                hranalysis:  <HRAnalysis activities={runningActivities} onEnrichActivity={handleFetchDetails} />,
                technique:   <TechniqueAnalysis activities={runningActivities} />,
                zones:       <TrainingZones activities={runningActivities} hrParams={hrParams} onOpenCalibration={() => setCurrentView('calibration')} />,
                heatmap:     <GlobalHeatmap activities={runningActivities} />,
                gallery:     <RouteGallery activities={runningActivities} />,
                geozones:    <GeoZones activities={runningActivities} />,
                consistency: <ConsistencyHeatmap activities={runningActivities} />,
                gear:        <GearTracker activities={runningActivities} stravaData={stravaData} setStravaData={setStravaData} />,
                targets:     <TargetRaces activities={runningActivities} planRaceId={routeId} />,
                racehistory: <RaceDetector activities={runningActivities} />,
                criticalspeed: <CriticalSpeed activities={runningActivities} />,
                planner:     <TrainingPlanner activities={runningActivities} />,
                predictor:   <RacePredictor activities={runningActivities} />,
                fitness:     <FitnessHub activities={runningActivities} />,
                health:      <HealthHub activities={runningActivities} onOpenConnections={() => setCurrentView('connections')} />,
                export:      <DataExporter activities={allActivities} onEnrichActivity={handleFetchDetails} />,
                calibration: <HrCalibration hrParams={hrParams} />,
                connections: <Connections stravaData={stravaData} onConnectStrava={connectToStrava} />,
                ...(isAdmin ? { admin: <AdminPanel /> } : {}),
              };
              const view = viewMap[currentView];
              if (!view) return null;
              return (
                <div className="fade-in">
                  <Suspense fallback={null}>{view}</Suspense>
                </div>
              );
            })()}
          </div>
        </main>
      </div>

      {/* ── Chat: lanzador flotante ─────────────────────────────────────────── */}
      {!chatOpen && (
        <button
          onClick={() => openChat()}
          title={t('nav.qa')}
          aria-label={t('nav.qa')}
          className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/25 flex items-center justify-center transition-colors"
        >
          <ChatBubbleLeftRightIcon className="w-5 h-5" />
        </button>
      )}

      {/* ── Chat: panel ────────────────────────────────────────────────────── */}
      {chatMounted && (
        <div className={chatOpen ? '' : 'hidden'}>
          <div
            onClick={() => setChatOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]"
          />
          <aside className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-xl lg:max-w-3xl bg-slate-100 border-l border-slate-200 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between gap-3 px-4 h-14 shrink-0 bg-white border-b border-slate-200">
              <div className="flex items-center gap-2 min-w-0">
                <ChatBubbleLeftRightIcon className="w-4 h-4 text-blue-600 shrink-0" />
                <h2 className="text-sm font-bold text-slate-900 truncate">{t('nav.qa')}</h2>
                {currentNavItem && (
                  <span className="hidden sm:inline text-xs text-slate-400 truncate">
                    · {t(`nav.${currentNavItem.id}`)}
                  </span>
                )}
              </div>
              <button
                onClick={() => setChatOpen(false)}
                aria-label={t('topbar.close', 'Cerrar')}
                className="p-1.5 -mr-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col p-3">
              <RunQA key={chatSeedKey} activities={runningActivities} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  // Qué usuario tiene la caché ya hidratada. Se guarda el ID, no un booleano: así
  // "listo" se DERIVA de si ese ID es el vigente, y cambiar de cuenta lo invalida
  // solo (antes hacía falta un setState síncrono dentro del efecto para bajarlo).
  const [hydratedFor, setHydratedFor] = useState(null);
  const navigate = useNavigate();

  // Sesión de Supabase Auth (Google).
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setAuthReady(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  // Hidratar la caché de cloudStorage cuando hay usuario.
  const userId = session?.user?.id ?? null;
  const storageReady = userId !== null && hydratedFor === userId;
  useEffect(() => {
    let active = true;
    if (userId) hydrate(userId).finally(() => { if (active) setHydratedFor(userId); });
    else resetCloudStorage();
    return () => { active = false; };
  }, [userId]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    resetCloudStorage();
    navigate('/');
  };

  const handleStravaConnected = async (data) => {
    const dataWithDate = { ...data, lastFetchDate: new Date().toDateString() };
    persistStravaData(dataWithDate);
    // Esperar a que la escritura llegue a Supabase antes de navegar, para que el
    // Dashboard (y un posible reload posterior) ya encuentre los datos.
    await flushCloudStorage();
    navigate('/');
  };

  // Mapear el usuario de Supabase a la forma { name, email, picture } que usa la UI.
  const meta = session?.user?.user_metadata ?? {};
  const user = session?.user ? {
    name: meta.full_name || meta.name || session.user.email,
    email: session.user.email,
    picture: meta.avatar_url || meta.picture || '',
  } : null;

  if (!authReady) return null;

  return (
    <>
      <OfflineBanner />
      <Routes>
        <Route path="/strava-callback" element={
          <StravaCallback onConnect={handleStravaConnected} />
        } />
        <Route path="/:view?/:raceId?" element={
          !user ? (
            <LandingPage />
          ) : !storageReady ? (
            <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <ArrowPathIcon className="w-8 h-8 animate-spin text-blue-500" />
                <span className="text-sm font-medium">Cargando tus datos…</span>
              </div>
            </div>
          ) : (
            <TimeScopeProvider>
              <Dashboard user={user} handleLogout={handleLogout} />
            </TimeScopeProvider>
          )
        } />
      </Routes>
    </>
  );
}

export default App;
