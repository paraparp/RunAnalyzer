import { useCallback, useEffect, useRef, useState, useMemo, Suspense, lazy } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { supabase } from './lib/supabase';
import cloudStorage, { hydrate, reset as resetCloudStorage, flush as flushCloudStorage } from './lib/cloudStorage';
import { useTranslation } from 'react-i18next';
import './App.css';
import StravaCallback from './components/StravaCallback';
import OfflineBanner from './components/OfflineBanner';
// El chat solo se monta al abrirlo: con él bajan el renderizador OpenUI, el
// markdown y el cliente de IA, que no hacen falta para pintar la app.
const RunQA = lazy(() => import('./components/RunQA'));
import Logo from './components/Logo';
import UserMenu from './components/UserMenu';
// Solo la ve quien no ha iniciado sesión: fuera del bundle de la app.
const LandingPage = lazy(() => import('./components/LandingPage'));
import TodayView from './components/TodayView';
import CommandPalette from './components/CommandPalette';
import ViewSkeleton, { AppSplash } from './components/ViewSkeleton';
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
const TrainingPlans = lazy(() => import('./components/TrainingPlans'));
const RacePredictor = lazy(() => import('./components/RacePredictor'));
const FitnessHub = lazy(() => import('./components/FitnessHub'));
const HealthHub = lazy(() => import('./components/HealthHub'));
const DataExporter = lazy(() => import('./components/DataExporter'));
const HrCalibration = lazy(() => import('./components/HrCalibration'));
const Connections = lazy(() => import('./components/Connections'));
const GlobalHeatmap = lazy(() => import('./components/GlobalHeatmap'));
const GeoZones = lazy(() => import('./components/GeoZones'));
const RouteProgression = lazy(() => import('./components/RouteProgression'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const SessionView = lazy(() => import('./components/SessionView'));
const SessionCompare = lazy(() => import('./components/SessionCompare'));
// La conclusión de cada área arrastra la curva mean-max y el PMC: bajo demanda.
const EngineVerdict = lazy(() => import('./components/AreaVerdict').then(m => ({ default: m.EngineVerdict })));
const LoadVerdict = lazy(() => import('./components/AreaVerdict').then(m => ({ default: m.LoadVerdict })));
const RacingVerdict = lazy(() => import('./components/AreaVerdict').then(m => ({ default: m.RacingVerdict })));
import useHrParams from './hooks/useHrParams';
import useIsAdmin from './hooks/useIsAdmin';
import useDialogA11y from './hooks/useDialogA11y';
import useTheme from './hooks/useTheme';
import useTimeScope from './hooks/useTimeScope';
import { readSyncHistory } from './lib/syncHistory';

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
import { getActivity, getActivityStreams, getStravaAuthUrl } from './services/strava';
import { computeFlatEfforts, needsFlatEfforts } from './lib/flatEfforts';
import { computeStreamGap, needsStreamGap } from './lib/streamGap';
import { computeHrEffort, needsHrEffort } from './lib/hrEffortWindow';
import { slimActivity, persistStravaData, readStravaData } from './lib/stravaStore';
import syncAll from './lib/syncAll';
import { syncPlanStatuses } from './lib/trainingPlans';
import {
  ArrowPathIcon,
  ChevronRightIcon,
  Squares2X2Icon,
  ChatBubbleLeftRightIcon,
  Bars3Icon,
  XMarkIcon,
  BoltIcon,
  ChartBarIcon,
  ChartPieIcon,
  BeakerIcon,
  TrophyIcon,
  Cog6ToothIcon,
  MagnifyingGlassIcon,
  SunIcon,
  GlobeAltIcon,
} from "@heroicons/react/24/outline";

// Las vistas. El icono lo pone la categoría (NAV_CATEGORIES): los ítems se
// pintan como texto bajo ella, así que no llevan uno propio.
const NAV_ITEMS = [
  'dashboard', 'pmc', 'weekly', 'injury', 'hranalysis', 'technique', 'zones', 'log',
  'heatmap', 'gallery', 'geozones', 'routes', 'consistency', 'gear', 'targets',
  'racehistory', 'criticalspeed', 'planner', 'trainingplans', 'predictor', 'fitness',
  'health', 'calibration', 'connections', 'export',
].map(id => ({ id }));

// Vista solo para administradores. Vive fuera de NAV_ITEMS a propósito: se añade
// en tiempo de ejecución si `is_admin()` dice que sí, de modo que para el resto
// de usuarios ni existe la entrada ni la ruta responde (currentView la descarta).
// El gating es cosmético; quien mande la URL a mano verá el dashboard, y
// /api/admin le devolvería 403 igualmente.
const ADMIN_NAV_ITEM = { id: 'admin' };

// Las categorías agrupan por la PREGUNTA que responde cada vista. Cinco, y
// ninguna con un solo ítem: una categoría que al abrirla da una sola cosa es un
// clic de peaje, no jerarquía. Las dos fronteras que antes se discutían están
// resueltas a propósito: las predicciones y el historial son de COMPETICIÓN (son
// sobre correr una carrera, no sobre fisiología), y todo lo que mide el motor
// —capacidad y adaptación— vive junto en MOTOR en vez de repartido entre
// "fisiología" y "rendimiento".
const NAV_CATEGORIES = [
  { id: 'today', icon: Squares2X2Icon, itemIds: ['dashboard'] },
  { id: 'sessions', icon: ChartBarIcon, itemIds: ['log', 'routes', 'heatmap', 'gallery', 'geozones', 'gear'] },
  { id: 'load', icon: ChartPieIcon, itemIds: ['pmc', 'weekly', 'injury', 'consistency'] },
  // Capacidad primero (el techo: curva, VDOT/VO2, umbrales), adaptación después
  // (la tendencia: respuesta cardíaca, técnica, vitales). Son los dos ejes en
  // los que las fases 3-5 van a fundir estos seis ítems.
  { id: 'engine', icon: BeakerIcon, itemIds: ['criticalspeed', 'fitness', 'zones', 'hranalysis', 'technique', 'health'] },
  { id: 'racing', icon: TrophyIcon, itemIds: ['targets', 'planner', 'trainingplans', 'predictor', 'racehistory'] },
  { id: 'settings', icon: Cog6ToothIcon, itemIds: ['calibration', 'connections', 'export'] },
];

// Vistas que acotan el histórico con el período compartido (lib/timeScope). Solo
// en ellas se enseña el selector: ponerlo donde no manda nada invitaría a pensar
// que filtra lo que no filtra.
const SCOPED_VIEWS = new Set(['pmc', 'weekly', 'criticalspeed', 'fitness', 'zones', 'hranalysis', 'health']);

// Barra inferior del móvil: las cinco áreas de uso diario. Ajustes se queda en el
// menú lateral, que no es un sitio al que se vaya en cada visita.
const BOTTOM_NAV_IDS = ['today', 'sessions', 'load', 'engine', 'racing'];

/** "hace 5 min" / "2 hours ago" para una marca de tiempo pasada. */
const relativeTime = (ms, lang) => {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const minutes = Math.round((ms - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
};

const Dashboard = ({ user, handleLogout }) => {
  const { t, i18n } = useTranslation();
  // Lo guardado entra ya en el primer render: la app arranca con datos, y quien
  // no tiene Strava no ve parpadear la tarjeta de "conecta" antes de tiempo.
  const [stravaData, setStravaData] = useState(readStravaData);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { isDark, setTheme } = useTheme();
  const [scope] = useTimeScope();

  // Ctrl/⌘+K abre el buscador global desde cualquier vista.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  // Desde la vista de sesión: la sesión entra como contexto del chat (la misma
  // semilla `runqa_seed` que usa el panel de IA) y su pregunta se lanza sola.
  const askCoachAboutSession = useCallback((seed) => {
    cloudStorage.setItem('runqa_seed', JSON.stringify(seed));
    openChat({ withSeed: true });
  }, [openChat]);
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
  // La comparativa (/compare/:id?with=otroId) es igual: un detalle de Sesiones.
  const isDetailView = (viewParam === 'activity' || viewParam === 'compare') && routeId;
  const currentView = isDetailView
    ? viewParam
    : navItems.some(i => i.id === viewParam) ? viewParam : 'dashboard';
  const isDetail = currentView === 'activity' || currentView === 'compare';
  const navView = isDetail ? 'log' : currentView;
  // Como en una app nativa: cada sección empieza arriba, y tocar la pestaña activa sube al inicio.
  const mainRef = useRef(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [currentView]);
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

  // Progreso del enriquecido en segundo plano (los dos de abajo suman al mismo
  // contador): sin él, los datos cambian solos durante medio minuto tras un sync
  // y no hay forma de saber por qué. Al terminar el último se pone a cero.
  const [enrich, setEnrich] = useState({ done: 0, total: 0 });
  const enrichStart = (n) => { if (n > 0) setEnrich(p => ({ done: p.done, total: p.total + n })); };
  const enrichTick = () => setEnrich(p => (p.done + 1 >= p.total ? { done: 0, total: 0 } : { ...p, done: p.done + 1 }));

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
    enrichStart(need.length);
    for (const act of need) {
      try {
        const detail = await getActivity(accessToken, act.id);
        if (!detail?.splits_metric) continue;
        setStravaData(prev => {
          if (!prev?.activities) return prev;
          const idx = prev.activities.findIndex(x => x.id === act.id);
          if (idx === -1) return prev;
          const updated = [...prev.activities];
          // Encima de lo guardado, no en su lugar: sustituir borraba los tramos
          // llanos, el GAP y hr_effort que el otro enriquecido acababa de escribir
          // (corren a la vez), y el siguiente sync volvía a bajar sus streams.
          updated[idx] = { ...prev.activities[idx], ...slimActivity(detail, prev.activities[idx]) };
          const nd = { ...prev, activities: updated };
          persistStravaData(nd);
          return nd;
        });
      } catch (e) {
        console.warn('[sync] enrich parciales falló', act.id, e);
      }
      enrichTick();
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
    enrichStart(need.length);
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
      enrichTick();
      await new Promise(r => setTimeout(r, 400)); // throttle anti rate-limit
    }
  };


  // Las acciones del buscador llaman a la versión vigente de estas dos funciones
  // (cambian de identidad en cada render) sin rehacer la lista cada vez.
  const runSyncRef = useRef(() => {});
  const changeLanguageRef = useRef(() => {});
  useEffect(() => {
    runSyncRef.current = runSync;
    changeLanguageRef.current = changeLanguage;
  });

  const [isSyncing, setIsSyncing] = useState(false);
  // Cuándo fue el último sync (lib/syncHistory): se enseña junto al botón.
  const [lastSyncAt, setLastSyncAt] = useState(() => readSyncHistory()[0]?.startedAt ?? null);

  // Todo el sync vive en `lib/syncAll`: Strava, la salud y el sueño de Garmin y
  // las actividades con dinámica, con un solo aviso al final. Aquí solo queda lo
  // que es de la UI: el espejo en el estado de React, el spinner y el enriquecido
  // en segundo plano (que necesita los streams y setStravaData).
  //
  // Tres llamadas: al entrar (solo lo nuevo, y nada si se miró hace un rato), el
  // botón de la barra (`force`: solo lo nuevo, siempre) y el panel de usuario
  // (`full`: el histórico entero). Los carriles son independientes: sin Strava
  // conectado, Garmin se sincroniza igual.
  const runSync = async ({ force = false, full = false } = {}) => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await syncAll({
        force,
        full,
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
      setLastSyncAt(readSyncHistory()[0]?.startedAt ?? null);
    }
  };

  useEffect(() => {
    // Lo guardado ya está pintado (estado inicial); aquí se sanea y luego se
    // sincroniza. El saneo retroactivo recorta payloads inflados por
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
    runSync();
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

  // Entrenos del plan ya corridos → hechos (lib/planActuals). Tras cada sync.
  useEffect(() => {
    if (runningActivities.length) syncPlanStatuses(runningActivities);
  }, [runningActivities]);

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
  // Anterior/siguiente desde la ficha: sustituye la entrada del historial para que
  // "Volver" siga llevando a la bitácora y no recorra todas las sesiones vistas.
  const stepActivity = useCallback((id) => navigate(`/activity/${id}`, { replace: true }), [navigate]);
  // Volver es "atrás" si se llegó navegando; si se entró por la URL directa, atrás
  // saldría de la app, así que se cae a la bitácora.
  const goBackFromActivity = useCallback(
    () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/log')),
    [navigate]
  );

  // Menú móvil y chat son diálogos: foco dentro, Tab atrapado y Escape cierra.
  const mobileMenuRef = useRef(null);
  const chatRef = useRef(null);
  useDialogA11y(mobileMenuRef, mobileMenuOpen, () => setMobileMenuOpen(false));
  useDialogA11y(chatRef, chatOpen, () => setChatOpen(false));

  const activeCat = navCategories.find(cat => cat.itemIds.includes(navView));
  const subItems = (activeCat?.itemIds ?? []).map(id => navItems.find(i => i.id === id)).filter(Boolean);
  const hasTabs = subItems.length > 1;

  // En móvil las pestañas hacen scroll horizontal: la activa siempre a la vista.
  const mobileTabsRef = useRef(null);
  useEffect(() => {
    mobileTabsRef.current?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [navView]);

  // Lo que el chat sabe de dónde está el usuario: así "¿qué significa esto?"
  // funciona desde cualquier vista, no solo desde la ficha de sesión. Va al
  // prompt de sistema (lib/chatContext), no a la conversación.
  const viewContext = useMemo(() => {
    const parts = [`Vista «${t(`nav.${currentView}`)}»${activeCat && activeCat.itemIds.length > 1 ? `, del área «${t(`nav.categories.${activeCat.id}`)}»` : ''}.`];
    if (SCOPED_VIEWS.has(currentView) && typeof scope === 'string') {
      parts.push(`Período seleccionado: ${t(`time_scope.options.${scope}`, scope)}.`);
    }
    if (currentView === 'activity') {
      const a = allActivities.find(x => String(x.id) === String(routeId));
      if (a) parts.push(`Sesión abierta: ${a.name} (${String(a.start_date_local || a.start_date).slice(0, 10)}, ${((a.distance || 0) / 1000).toFixed(1)} km).`);
    }
    if (currentView === 'compare') parts.push('Está comparando dos sesiones lado a lado.');
    return parts.join(' ');
  }, [t, currentView, activeCat, scope, allActivities, routeId]);

  const paletteActions = useMemo(() => [
    { id: 'sync', label: t('palette.action_sync'), Icon: ArrowPathIcon, run: () => runSyncRef.current({ force: true }) },
    { id: 'chat', label: t('palette.action_chat'), Icon: ChatBubbleLeftRightIcon, run: () => openChat() },
    { id: 'theme', label: t('palette.action_theme'), Icon: SunIcon, run: () => setTheme(isDark ? 'light' : 'dark') },
    { id: 'language', label: t('palette.action_language'), Icon: GlobeAltIcon, run: () => changeLanguageRef.current() },
  ], [t, openChat, setTheme, isDark]);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Sidebar component
  const SidebarContent = () => {
    const activeCatId = navCategories.find(cat => cat.itemIds.includes(navView))?.id;
    return (
      <>
        {/* Logo */}
        <div className="h-14 px-4 flex items-center gap-2.5 shrink-0">
          <Logo className="w-7 h-7 rounded-md" />
          <span className="text-[15px] font-semibold text-slate-950 dark:text-white">RunAnalyzer</span>
        </div>

        {/* Navegación: la categoría activa despliega sus secciones */}
        <nav aria-label={t('topbar.main_nav')} className="flex-1 min-h-0 px-2 py-2 space-y-0.5 overflow-y-auto">
          {navCategories.map(cat => {
            const Icon = cat.icon;
            const isActive = cat.id === activeCatId;
            const hasChildren = cat.itemIds.length > 1;
            return (
              <div key={cat.id}>
                <button
                  type="button"
                  aria-current={isActive && !hasChildren ? 'page' : undefined}
                  aria-expanded={hasChildren ? isActive : undefined}
                  onClick={() => {
                    if (!isActive) setCurrentView(cat.itemIds[0]);
                    // Con secciones, el menú móvil sigue abierto para poder elegir una.
                    if (!hasChildren) setMobileMenuOpen(false);
                  }}
                  className={`group w-full h-9 flex items-center gap-2.5 px-2.5 rounded-md text-[13px] cursor-pointer transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${isActive
                    ? `font-medium text-slate-950 dark:text-white ${hasChildren ? '' : 'bg-slate-900/[0.06] dark:bg-white/[0.08]'}`
                    : 'text-slate-600 dark:text-white/60 hover:text-slate-950 dark:hover:text-white hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]'
                    }`}
                >
                  <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-accent' : ''}`} />
                  <span className="flex-1 min-w-0 truncate text-left">{t(`nav.categories.${cat.id}`)}</span>
                  {hasChildren && (
                    <ChevronRightIcon className={`w-3.5 h-3.5 shrink-0 transition-[transform,opacity] duration-150 ${isActive ? 'rotate-90 opacity-50' : 'opacity-0 group-hover:opacity-50'}`} />
                  )}
                </button>

                {isActive && hasChildren && (
                  <div className="ml-[19px] my-0.5 pl-2 border-l border-slate-900/10 dark:border-white/10 space-y-px">
                    {cat.itemIds.map(itemId => {
                      const item = navItems.find(i => i.id === itemId);
                      if (!item) return null;
                      const isItemActive = currentView === itemId;
                      return (
                        <button
                          key={itemId}
                          type="button"
                          aria-current={isItemActive ? 'page' : undefined}
                          onClick={() => {
                            setCurrentView(itemId);
                            setMobileMenuOpen(false);
                          }}
                          className={`relative w-full h-8 flex items-center px-2.5 rounded-md text-[13px] text-left cursor-pointer transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${isItemActive
                            ? 'font-medium text-slate-950 dark:text-white bg-slate-900/[0.06] dark:bg-white/[0.08]'
                            : 'text-slate-500 dark:text-white/55 hover:text-slate-950 dark:hover:text-white hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]'
                            }`}
                        >
                          {isItemActive && <span aria-hidden="true" className="absolute -left-[9px] inset-y-1.5 w-0.5 rounded-full bg-accent" />}
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
        <div className="shrink-0 p-2 border-t border-slate-900/10 dark:border-white/10">
          <UserMenu
            user={user}
            handleLogout={handleLogout}
            changeLanguage={changeLanguage}
            onFullSync={() => runSync({ full: true })}
            isSyncing={isSyncing}
            placement="sidebar"
            stravaConnected={Boolean(stravaData?.accessToken)}
          />
        </div>
      </>
    );
  };

  // Sin Strava ya no hay muro: la app se abre igual (Garmin, ajustes y el menú de
  // usuario siguen a mano) y la portada ofrece conectarlo. Antes esta pantalla
  // sustituía a todo el shell, sin forma siquiera de cerrar sesión.
  const stravaConnected = Boolean(stravaData?.accessToken);
  const enriching = enrich.total > 0;
  const lastSyncLabel = lastSyncAt ? t('topbar.last_sync', { when: relativeTime(lastSyncAt, i18n.language) }) : null;

  return (
    <div className="flex h-screen h-dvh overflow-hidden bg-bg">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 bg-white dark:bg-[#07090d] border-r border-slate-900/10 dark:border-white/10 shrink-0 h-screen h-dvh z-50">
        {SidebarContent()}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="sidebar-overlay fixed inset-0" onClick={() => setMobileMenuOpen(false)} />
          <aside
            ref={mobileMenuRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t('topbar.main_nav')}
            className="sidebar-enter fixed inset-y-0 left-0 w-[260px] pt-[env(safe-area-inset-top)] bg-white dark:bg-[#07090d] shadow-2xl flex flex-col z-50 focus:outline-none"
          >
            {SidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        {(() => {
          return (
            <header className="sticky top-0 z-40 flex justify-between items-center px-4 sm:px-8 w-full bg-white dark:bg-[#07090d] border-b border-slate-200 dark:border-white/10 h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] shrink-0 gap-3 sm:gap-6">
              {/* Mobile menu */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label={t('topbar.open_menu', 'Abrir el menú')}
                className="lg:hidden p-2 -ml-2 rounded-sm text-slate-500 hover:bg-slate-900/5 hover:text-slate-950 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white transition-colors"
              >
                <Bars3Icon className="w-5 h-5" />
              </button>

              <div className="flex items-center space-x-8 min-w-0">
                {/* Section title */}
                <h2 className="text-lg sm:text-xl font-black text-slate-950 dark:text-white tracking-tighter truncate md:shrink-0">{activeCat ? t(`nav.categories.${activeCat.id}`) : pageTitle}</h2>

                {/* Sub-navigation tabs — con un solo ítem no hay nada que elegir */}
                <nav aria-label={t('topbar.sections_nav')} className="hidden md:flex items-center space-x-6">
                  {(hasTabs ? subItems : []).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={navView === item.id ? 'page' : undefined}
                      onClick={() => setCurrentView(item.id)}
                      className={`text-sm font-medium whitespace-nowrap pb-1 transition-colors ${navView === item.id
                        ? 'text-slate-950 dark:text-white border-b-2 border-accent'
                        : 'text-slate-500 dark:text-white/55 hover:text-slate-950 dark:hover:text-white border-b-2 border-transparent'
                        }`}
                    >
                      {t(`nav.${item.id}`)}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Derecha: buscador + período + sync + avatar. Tema e idioma viven
                  en el menú de usuario (y en el buscador): aquí solo competían
                  por el sitio con lo que se usa a diario. */}
              <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-label={t('palette.title')}
                  title={`${t('palette.title')} (Ctrl+K)`}
                  className="inline-flex items-center gap-2 h-8 px-2 xl:pl-2.5 xl:pr-2 rounded-sm border border-transparent xl:border-slate-200 xl:dark:border-white/15 text-slate-500 hover:text-slate-950 hover:bg-slate-900/5 dark:text-white/60 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
                >
                  <MagnifyingGlassIcon className="w-4 h-4" />
                  <span className="hidden xl:inline text-xs font-medium">{t('topbar.search')}</span>
                  <kbd className="hidden xl:inline text-label font-semibold text-slate-400 dark:text-white/40">Ctrl K</kbd>
                </button>
                {/* Período global: uno para toda la app, visible donde la vista lo usa. */}
                {SCOPED_VIEWS.has(currentView) && <TimeScopeSelector className="hidden md:inline-flex" />}
                {enriching ? (
                  <span
                    role="status"
                    title={t('topbar.enriching_hint')}
                    className="hidden sm:inline text-xs font-medium text-slate-500 dark:text-white/55 tabular-nums whitespace-nowrap"
                  >
                    {t('topbar.enriching', enrich)}
                  </span>
                ) : lastSyncLabel && !isSyncing && (
                  <span className="hidden xl:inline text-xs text-slate-500 dark:text-white/45 whitespace-nowrap">{lastSyncLabel}</span>
                )}
                <button
                  type="button"
                  onClick={() => runSync({ force: true })}
                  disabled={isSyncing}
                  title={isSyncing ? t('topbar.syncing') : [t('topbar.sync'), lastSyncLabel].filter(Boolean).join(' · ')}
                  className={`inline-flex items-center gap-2 text-xs font-bold px-2.5 sm:px-4 py-2 rounded-sm transition-colors ${isSyncing
                    ? 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/40 cursor-not-allowed'
                    : 'bg-accent text-white hover:bg-accent/90 dark:text-slate-950'
                    }`}
                >
                  <ArrowPathIcon className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{isSyncing ? t('topbar.syncing') : t('topbar.sync')}</span>
                </button>
                {/* En escritorio el menú de usuario ya está al pie de la barra lateral. */}
                <UserMenu
                  user={user}
                  handleLogout={handleLogout}
                  changeLanguage={changeLanguage}
                  onFullSync={() => runSync({ full: true })}
                  isSyncing={isSyncing}
                  placement="topbar"
                  stravaConnected={stravaConnected}
                  className="lg:hidden"
                />
              </div>

              {/* Enriquecido en segundo plano: una línea fina que se ve también en móvil. */}
              {enriching && (
                <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-accent/15">
                  <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round((enrich.done / enrich.total) * 100)}%` }} />
                </div>
              )}
            </header>
          );
        })()}

        {/* Pestañas del área en móvil: la cabecera no tiene sitio para ellas, y
            sin esto cambiar de vista hermana obligaba a abrir el menú lateral. */}
        {hasTabs && (
          <nav
            ref={mobileTabsRef}
            aria-label={t('topbar.sections_nav')}
            className="md:hidden shrink-0 flex items-center gap-1 px-3 h-11 overflow-x-auto no-scrollbar bg-white dark:bg-[#07090d] border-b border-slate-200 dark:border-white/10"
          >
            {subItems.map(item => (
              <button
                key={item.id}
                type="button"
                aria-current={navView === item.id ? 'page' : undefined}
                onClick={() => setCurrentView(item.id)}
                className={`shrink-0 h-8 px-3 rounded-md text-[13px] whitespace-nowrap transition-colors ${navView === item.id
                  ? 'font-semibold text-slate-950 dark:text-white bg-slate-900/[0.06] dark:bg-white/[0.08]'
                  : 'font-medium text-slate-500 dark:text-white/55'
                  }`}
              >
                {t(`nav.${item.id}`)}
              </button>
            ))}
          </nav>
        )}

        {/* Scrollable Content */}
        <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-bg text-ink dark:shell-glow">
          <div className={`mx-auto w-full p-4 lg:p-8 space-y-6 ${currentView === 'dashboard' ? 'max-w-[2200px]' : 'max-w-[1400px]'}`}>

            {currentView === 'dashboard' && !stravaData && (
              <section className="card rounded-md max-w-md mx-auto mt-6 sm:mt-12 p-8 text-center">
                <div className="w-12 h-12 rounded-md bg-accent/10 ring-1 ring-accent/25 flex items-center justify-center mx-auto mb-5">
                  <BoltIcon className="w-6 h-6 text-accent" />
                </div>
                <h2 className="h-display text-2xl mb-2">{t('auth.connect_title')}</h2>
                <p className="text-sm text-slate-600 dark:text-white/55 mb-6 leading-relaxed">{t('auth.connect_desc')}</p>
                {/* Naranja de marca de Strava: es su botón, no un acento de la app. */}
                <button
                  type="button"
                  onClick={connectToStrava}
                  className="w-full py-3 px-6 bg-[#fc4c02] hover:bg-[#e34402] text-white text-sm font-bold rounded-sm transition-colors"
                >
                  {t('auth.connect_btn')}
                </button>
                <p className="mt-6 pt-5 border-t border-slate-900/10 dark:border-white/10 text-xs text-slate-500 dark:text-white/55 leading-relaxed">
                  {t('auth.garmin_hint')}{' '}
                  <button type="button" onClick={() => setCurrentView('connections')} className="font-semibold text-accent hover:underline">
                    {t('auth.garmin_btn')}
                  </button>
                </p>
              </section>
            )}

            {currentView === 'dashboard' && stravaData && (
              <TodayView
                activities={allActivities}
                runningActivities={runningActivities}
                hrParams={hrParams}
                onNavigate={(v) => navigate(v === 'dashboard' ? '/' : `/${v}`)}
                onOpenChat={() => openChat({ withSeed: true })}
                onSync={() => runSync({ force: true })}
                isSyncing={isSyncing}
              />
            )}

            {/* En móvil la barra superior no tiene sitio: el período baja aquí. */}
            {SCOPED_VIEWS.has(currentView) && (
              <div className="md:hidden flex flex-wrap items-center justify-end gap-2">
                <span className="text-label font-bold uppercase text-slate-500">{t('time_scope.label')}</span>
                <TimeScopeSelector />
              </div>
            )}

            {/* Conclusión del área (§6.3): la misma en todas las vistas del área. */}
            {/* Solo en las vistas del área, no en la ficha de sesión (que cuelga de
                Sesiones a efectos de menú pero es un detalle, no un área). */}
            {!isDetail && (() => {
              const catId = activeCat?.id;
              if (catId === 'engine') return <Suspense fallback={null}><EngineVerdict runs={runningActivities} hrParams={hrParams} /></Suspense>;
              if (catId === 'load') return <Suspense fallback={null}><LoadVerdict activities={allActivities} /></Suspense>;
              if (catId === 'racing') return <Suspense fallback={null}><RacingVerdict /></Suspense>;
              return null;
            })()}

            {currentView !== 'dashboard' && (() => {
              const viewMap = {
                log:         <ActivityLog activities={allActivities} runningActivities={runningActivities} hrParams={hrParams} onOpenActivity={openActivity} />,
                activity:    <SessionView key={routeId} activityId={routeId} activities={allActivities} hrParams={hrParams} accessToken={stravaData?.accessToken} shoes={stravaData?.athlete?.shoes} onBack={goBackFromActivity} onOpenActivity={openActivity} onStepActivity={stepActivity} onEnrichActivity={handleFetchDetails} onNavigate={setCurrentView} onAskCoach={askCoachAboutSession} />,
                compare:     <SessionCompare aId={routeId} activities={runningActivities} hrParams={hrParams} onBack={goBackFromActivity} onOpenActivity={openActivity} onAskCoach={askCoachAboutSession} />,
                pmc:         <FitnessFatigue activities={allActivities} />,
                weekly:      <WeeklyProgression activities={allActivities} />,
                injury:      <InjuryRisk activities={allActivities} />,
                hranalysis:  <HRAnalysis activities={runningActivities} />,
                technique:   <TechniqueAnalysis activities={runningActivities} />,
                zones:       <TrainingZones activities={runningActivities} hrParams={hrParams} onOpenCalibration={() => setCurrentView('calibration')} />,
                heatmap:     <GlobalHeatmap activities={runningActivities} />,
                gallery:     <RouteGallery activities={runningActivities} />,
                geozones:    <GeoZones activities={runningActivities} />,
                routes:      <RouteProgression activities={runningActivities} onOpenActivity={openActivity} />,
                consistency: <ConsistencyHeatmap activities={runningActivities} />,
                gear:        <GearTracker activities={runningActivities} stravaData={stravaData} setStravaData={setStravaData} />,
                targets:     <TargetRaces activities={runningActivities} planRaceId={routeId} />,
                racehistory: <RaceDetector activities={runningActivities} />,
                criticalspeed: <CriticalSpeed activities={runningActivities} />,
                planner:     <TrainingPlanner activities={runningActivities} />,
                trainingplans: <TrainingPlans activities={runningActivities} onOpenActivity={openActivity} />,
                predictor:   <RacePredictor activities={runningActivities} />,
                fitness:     <FitnessHub activities={runningActivities} />,
                health:      <HealthHub key={routeId} tab={routeId} activities={runningActivities} allActivities={allActivities} onOpenConnections={() => setCurrentView('connections')} onOpenActivity={openActivity} />,
                export:      <DataExporter activities={allActivities} onEnrichActivity={handleFetchDetails} />,
                calibration: <HrCalibration hrParams={hrParams} />,
                connections: <Connections stravaData={stravaData} onConnectStrava={connectToStrava} />,
                ...(isAdmin ? { admin: <AdminPanel /> } : {}),
              };
              const view = viewMap[currentView];
              if (!view) return null;
              return (
                <div className="fade-in">
                  <Suspense fallback={<ViewSkeleton />}>{view}</Suspense>
                </div>
              );
            })()}
          </div>
        </main>

        {/* Barra inferior (móvil): las áreas a un toque, como en una app instalada.
            `data-bottom-nav` hace que los avisos flotantes suban por encima (index.css). */}
        <nav
          data-bottom-nav=""
          aria-label={t('topbar.main_nav')}
          className="lg:hidden shrink-0 grid grid-cols-5 bg-white dark:bg-[#07090d] border-t border-slate-200 dark:border-white/10 pb-[env(safe-area-inset-bottom)]"
        >
          {BOTTOM_NAV_IDS.map(catId => {
            const cat = navCategories.find(c => c.id === catId);
            if (!cat) return null;
            const Icon = cat.icon;
            const isActive = activeCat?.id === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  if (!isActive || isDetail) setCurrentView(cat.itemIds[0]);
                  else mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`h-14 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${isActive
                  ? 'text-slate-950 dark:text-white'
                  : 'text-slate-500 dark:text-white/50'
                  }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-accent' : ''}`} />
                <span className={`max-w-full truncate text-label tracking-normal ${isActive ? 'font-semibold' : 'font-medium'}`}>{t(`nav.categories.${cat.id}`)}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {paletteOpen && (
        <CommandPalette
          categories={navCategories}
          activities={allActivities}
          actions={paletteActions}
          onNavigate={setCurrentView}
          onOpenActivity={openActivity}
          onClose={closePalette}
        />
      )}

      {/* ── Chat: lanzador flotante ─────────────────────────────────────────── */}
      {/* En móvil sube por encima de la barra inferior (--bottom-nav, index.css). */}
      {!chatOpen && (
        <button
          type="button"
          onClick={() => openChat()}
          title={t('nav.qa')}
          aria-label={t('nav.qa')}
          style={{ bottom: 'calc(1.25rem + var(--bottom-nav, 0px) + env(safe-area-inset-bottom))' }}
          className="fixed right-5 z-40 h-12 w-12 rounded-full bg-[#07090d] ring-1 ring-white/15 hover:ring-teal-300/60 text-teal-300 shadow-lg flex items-center justify-center transition-colors"
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
          <aside
            ref={chatRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.qa')}
            className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-xl lg:max-w-3xl pt-[env(safe-area-inset-top)] bg-slate-100 dark:bg-[#07090d] border-l border-slate-200 dark:border-white/10 shadow-2xl flex flex-col focus:outline-none"
          >
            <div className="flex items-center justify-between gap-3 px-4 h-14 shrink-0 bg-white dark:bg-[#07090d] border-b border-slate-900/10 dark:border-white/10">
              <div className="flex items-center gap-2 min-w-0">
                <ChatBubbleLeftRightIcon className="w-4 h-4 text-teal-600 dark:text-teal-300 shrink-0" />
                <h2 className="text-sm font-black tracking-tight text-slate-950 dark:text-white truncate">{t('nav.qa')}</h2>
                {currentNavItem && (
                  <span className="hidden sm:inline text-xs text-slate-500 dark:text-white/50 truncate">
                    · {t(`nav.${currentNavItem.id}`)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label={t('topbar.close')}
                className="p-1.5 -mr-1 rounded-sm text-slate-500 hover:bg-slate-900/5 hover:text-slate-950 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col p-3">
              <Suspense fallback={<ViewSkeleton />}>
                <RunQA key={chatSeedKey} activities={runningActivities} viewContext={viewContext} />
              </Suspense>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

function App() {
  const { t } = useTranslation();
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
    // Fotos de perfil/actividades cacheadas por el service worker: no dejarlas en un equipo compartido.
    window.caches?.delete('remote-images').catch(() => {});
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

  if (!authReady) return <AppSplash />;

  return (
    <>
      <OfflineBanner />
      <Routes>
        <Route path="/strava-callback" element={
          <StravaCallback onConnect={handleStravaConnected} />
        } />
        <Route path="/:view?/:raceId?" element={
          !user ? (
            <Suspense fallback={<AppSplash />}><LandingPage /></Suspense>
          ) : !storageReady ? (
            <AppSplash label={t('common.loading_data')} />
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
