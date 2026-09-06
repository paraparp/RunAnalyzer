import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MapContainer, TileLayer, Polyline, Circle, CircleMarker,
  Tooltip as LeafletTooltip,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import polyline from '@mapbox/polyline';
import {
  getDarkMapTileUrl, getLightMapTileUrl, getSatelliteMapTileUrl, getMapAttribution,
} from '../lib/mapTiles';
import { Card, Badge, Callout } from '@tremor/react';
import {
  MapPinIcon, ArrowsPointingInIcon, ArrowUturnLeftIcon,
  ArrowTopRightOnSquareIcon, InformationCircleIcon, SparklesIcon, ArrowPathIcon,
  MapIcon, XMarkIcon, ChevronDownIcon, PencilIcon, CheckIcon,
  MagnifyingGlassIcon, EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';
import cloudStorage from '../lib/cloudStorage';
import {
  clusterActivities, applyZoneEdits, shareOfKm, startPoint,
  monthlyByZone, dormantZones, explorationByYear,
  DEFAULT_RADIUS_KM, RADIUS_OPTIONS, DORMANT_MONTHS,
} from '../lib/geoZones';
import { groupRoutes, routineIndex } from '../lib/routeSimilarity';
import { reverseGeocodeBatch, uniqueLabels } from '../lib/reverseGeocode';
import { formatDurationHm } from '../lib/timeFormat';

// ── Zonas geográficas: cuántos km en cada sitio ──────────────────────────────
// El cálculo entero vive en lib/geoZones.js y lib/routeSimilarity.js (puros y
// testeados); aquí solo está la UI y el estado que edita el atleta.
//
// La pantalla se organiza alrededor de UN objeto: la lista de lugares. Se lee
// como una tabla — la cabecera nombra las columnas UNA vez, en vez de repetir
// una etiqueta por celda y fila — y todo lo secundario (estacionalidad,
// exploración, sitios dormidos) vive en un único panel con pestañas, porque son
// preguntas que uno se hace de vez en cuando y no cada vez que abre la pestaña.

const STORE_KEY = 'geo_zones';

// Paleta cualitativa: cada lugar es una categoría sin orden intrínseco, así que
// tonos distintos y no una rampa (una rampa insinuaría una magnitud que no hay).
const PALETTE = [
  '#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#a78bfa', '#fb923c',
  '#2dd4bf', '#f472b6', '#facc15', '#60a5fa', '#34d399', '#c084fc',
];

// El color sale de un hash de la CLAVE del sitio, nunca de su posición en la
// lista. Si dependiera del orden, mover el radio, reordenar la lista o fusionar
// dos zonas repintaría media pantalla, y el mismo sitio aparecería de un color
// en la lista, de otro en la rejilla de estacionalidad y de un tercero en el
// mapa. Con el hash, un sitio tiene su color para siempre y en todas las vistas.
const hashKey = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const colorForKey = (key) => PALETTE[hashKey(String(key)) % PALETTE.length];

// Tinte del color de un sitio, para fondos. `color-mix` evita tener que declarar
// una variante clara de cada color de la paleta.
const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const readStore = () => {
  try { return JSON.parse(cloudStorage.getItem(STORE_KEY) || 'null') || {}; }
  catch { return {}; }
};

const fmtKm = (km, lang) => km.toLocaleString(lang, { maximumFractionDigits: 1 });
const fmtDate = (iso, lang) => (iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString(lang, { month: 'short', year: 'numeric' })
  : '—');
const osmUrl = ([lat, lng]) => `https://www.openstreetmap.org/#map=14/${lat.toFixed(5)}/${lng.toFixed(5)}`;

/** Etiqueta de una actividad para el tooltip del mapa: nombre, fecha y km. */
const actLabel = (a, lang) => [
  a.name,
  a.date ? new Date(a.date + 'T00:00:00').toLocaleDateString(lang) : null,
  a.distanceKm ? `${a.distanceKm.toFixed(1)} km` : null,
].filter(Boolean).join(' · ');

// Normalización para el buscador: minúsculas y sin tildes, que un sitio llamado
// "Alcalá" tiene que salir escribiendo "alcala".
const norm = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

// Capa base del mapa. La versión anterior la deducía de la clase `dark` del
// <html>, y esa clase no la pone nadie en esta app: el mapa salía SIEMPRE claro,
// sin manera de cambiarlo. Ahora es una elección explícita, con las mismas tres
// opciones y el mismo defecto oscuro que el heatmap global, para que las dos
// pantallas de mapa no se contradigan.
const BASEMAPS = ['dark', 'light', 'satellite'];
const DEFAULT_BASEMAP = 'dark';

const basemapUrl = (id) => (id === 'light' ? getLightMapTileUrl()
  : id === 'satellite' ? getSatelliteMapTileUrl()
  : getDarkMapTileUrl());

// El punto de la opción, para reconocerla sin leer: gris oscuro, gris claro,
// verde de imagen aérea.
const BASEMAP_DOT = {
  dark: 'bg-slate-800',
  light: 'bg-slate-200 border border-slate-400',
  satellite: 'bg-emerald-600',
};

// Grosor y opacidad de una traza según lo repetida que sea su ruta. El grupo 0
// es el más repetido (groupRoutes ordena por tamaño): la vuelta de siempre se
// dibuja gruesa y las excursiones sueltas se apagan, así el mapa dice de un
// vistazo lo mismo que el índice de rutina.
const routeStyle = (groupIdx) => ({
  color: PALETTE[groupIdx % PALETTE.length],
  weight: groupIdx === 0 ? 3.5 : 2,
  opacity: groupIdx === 0 ? 0.85 : 0.45,
  className: 'cursor-pointer',
});

/** Encuadre [[minLat,minLng],[maxLat,maxLng]] de un puñado de trazas. */
function boundsOf(routes) {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  for (const r of routes) {
    for (const [lat, lng] of r.positions) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  if (!Number.isFinite(minLat)) return null;
  // Un solo punto degeneraría el encuadre: se le da un margen mínimo.
  const pad = 0.002;
  return [[minLat - pad, minLng - pad], [maxLat + pad, maxLng + pad]];
}

// ── Piezas de UI ─────────────────────────────────────────────────────────────

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ' +
              'focus-visible:ring-offset-1 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-slate-900';

const BTN = 'inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm ' +
            'font-medium text-slate-700 transition enabled:hover:bg-slate-100 disabled:opacity-40 ' +
            'motion-reduce:transition-none dark:border-slate-600 dark:text-slate-200 ' +
            `dark:enabled:hover:bg-slate-800 ${FOCUS}`;

const ICON_BTN = 'rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 ' +
                 `motion-reduce:transition-none dark:hover:bg-slate-800 dark:hover:text-slate-200 ${FOCUS}`;

const LABEL = 'text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500';

// Una sola rejilla para la cabecera y para cada fila: es lo que alinea las
// columnas entre filas. Por debajo de lg la fila se deshace en un flex que
// envuelve, y ahí cada dato recupera su etiqueta.
const ROW_GRID = 'lg:grid lg:grid-cols-[minmax(0,1fr)_8.5rem_4rem_5rem_5rem_4.5rem_9.5rem_5.5rem] ' +
                 'lg:items-center lg:gap-x-3';

/** Celda de dato: en columna estrecha lleva su etiqueta delante; en tabla, no. */
function Cell({ label, align = 'left', children }) {
  return (
    <div className={`flex items-baseline gap-1.5 whitespace-nowrap lg:block ${align === 'right' ? 'lg:text-right' : ''}`}>
      <span className={`${LABEL} lg:hidden`}>{label}</span>
      <span className="tabular-nums text-slate-600 dark:text-slate-300">{children}</span>
    </div>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <div className="bg-white p-4 dark:bg-slate-900">
      <div className={LABEL}>{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

/**
 * Radio del cúmulo como control segmentado: son seis valores fijos y la pregunta
 * ("¿más ancho o más estrecho?") es de grado. Un desplegable esconde la escala y
 * obliga a dos clics para probar el siguiente valor; aquí se ve entera y se
 * recorre con las flechas del teclado.
 */
function RadiusPicker({ value, onChange, label }) {
  const idx = RADIUS_OPTIONS.indexOf(value);
  const onKeyDown = (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const from = idx < 0 ? 0 : idx;
    onChange(RADIUS_OPTIONS[Math.min(RADIUS_OPTIONS.length - 1, Math.max(0, from + d))]);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800/60"
    >
      {RADIUS_OPTIONS.map((r) => {
        const on = r === value;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(r)}
            className={`min-w-[2.5rem] rounded-md px-2 py-1 text-xs font-medium tabular-nums transition
                        motion-reduce:transition-none ${FOCUS}
                        ${on
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-50'
                          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}`}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

/** Menú de acciones poco frecuentes: se cierra al pulsar fuera o con Escape. */
function Menu({ label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`rounded-lg border border-slate-300 p-1.5 text-slate-500 transition hover:bg-slate-100
                    motion-reduce:transition-none dark:border-slate-600 dark:text-slate-400
                    dark:hover:bg-slate-800 ${FOCUS}`}
      >
        <EllipsisHorizontalIcon className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200
                     bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {children}
        </div>
      )}
    </div>
  );
}

const MENU_ITEM = 'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 ' +
                  'transition enabled:hover:bg-slate-100 disabled:opacity-40 motion-reduce:transition-none ' +
                  `dark:text-slate-200 dark:enabled:hover:bg-slate-800 ${FOCUS}`;

/** Interruptor de capa del mapa: pulsado = capa visible. */
function LayerToggle({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition motion-reduce:transition-none ${FOCUS}
                  ${on
                    ? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                    : 'border-slate-200 text-slate-400 hover:text-slate-600 dark:border-slate-700 dark:text-slate-500 dark:hover:text-slate-300'}`}
    >
      {children}
    </button>
  );
}

/** Texto secundario de una entrada de menú: qué hace, en una línea. */
function MenuHint({ children }) {
  return (
    <span className="mt-0.5 block text-[11px] leading-snug text-slate-400 dark:text-slate-500">
      {children}
    </span>
  );
}

// ── Componente ───────────────────────────────────────────────────────────────

export default function GeoZones({ activities }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [store, setStore] = useState(readStore);
  const [selected, setSelected] = useState(() => new Set());
  const [mergeMode, setMergeMode] = useState(false);
  const [geo, setGeo] = useState(null); // { done, total } mientras se geocodifica
  const geoAbort = useRef(null);

  // Cortar el lote si el atleta se va de la pestaña: son peticiones espaciadas
  // 1,1 s, así que un lote grande sigue vivo un buen rato tras desmontar.
  useEffect(() => () => geoAbort.current?.abort(), []);

  const radiusKm = store.radiusKm ?? DEFAULT_RADIUS_KM;
  // Memoizados: sin esto el `?? {}` fabrica un objeto nuevo en cada render y
  // tumbaría el useMemo del clustering, que es lo caro de esta vista.
  const labels = useMemo(() => store.labels ?? {}, [store.labels]);
  const mergeInto = useMemo(() => store.mergeInto ?? {}, [store.mergeInto]);
  const contexts = useMemo(() => store.contexts ?? {}, [store.contexts]);

  // Escritura única: estado + nube a la vez, para que no puedan divergir.
  const patchStore = useCallback((patch) => {
    setStore(prev => {
      const next = { ...prev, ...patch };
      cloudStorage.setItem(STORE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // El clustering es O(n²) sobre las salidas; se memoiza por radio para que
  // escribir un nombre no lo recalcule en cada tecla.
  const { zones: raw, unlocated } = useMemo(
    () => clusterActivities(activities, { radiusKm }),
    [activities, radiusKm],
  );

  // `zones` es la lista canónica y va SIEMPRE ordenada por km desc: de ahí sale
  // el destino de una fusión y la escala de las barras. Lo que se ve en pantalla
  // (`visible`) es una vista filtrada y reordenada encima, nunca la fuente.
  const zones = useMemo(
    () => shareOfKm(applyZoneEdits(raw, { labels, mergeInto })),
    [raw, labels, mergeInto],
  );

  const totalKm = zones.reduce((s, z) => s + z.distanceKm, 0);
  const maxKm = zones.length ? zones[0].distanceKm : 0;

  const zoneLabel = useCallback(
    (z) => z.name || contexts[z.key] || t('geozones.name_placeholder'),
    [contexts, t],
  );

  const rename = (key, value) => {
    const next = { ...labels };
    if (value.trim()) next[key] = value;
    else delete next[key];
    patchStore({ labels: next });
  };

  const toggle = (key) => setSelected(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // Fusionar: la zona con más km hace de destino, así el nombre que ya tuviera
  // el sitio principal sobrevive y las demás se pliegan bajo él.
  const mergeSelected = () => {
    const picked = zones.filter(z => selected.has(z.key));
    if (picked.length < 2) return;
    const target = picked[0]; // `zones` ya viene ordenado por km desc.
    const next = { ...mergeInto };
    for (const z of picked.slice(1)) next[z.key] = target.key;
    patchStore({ mergeInto: next });
    setSelected(new Set());
    setMergeMode(false);
  };

  // Deshacer: quitar toda entrada que acabe resolviendo a esta zona devuelve sus
  // cúmulos al estado original (los nombres de cada uno siguen guardados).
  const unmerge = (key) => {
    const next = { ...mergeInto };
    for (const k of Object.keys(next)) {
      let cur = k, guard = 0;
      while (next[cur] && guard++ < 50) cur = next[cur];
      if (cur === key) delete next[k];
    }
    patchStore({ mergeInto: next });
  };

  // ── Buscar y ordenar ───────────────────────────────────────────────────────
  // Con veinte o treinta sitios, recorrer la lista con el ojo deja de valer: el
  // buscador es la manera de llegar a UNO, y el orden la de responder "¿dónde
  // más corro?" o "¿qué he dejado de pisar?" sin cambiar de vista.
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('km');

  const visible = useMemo(() => {
    const q = norm(query.trim());
    const list = q
      ? zones.filter(z => norm(zoneLabel(z)).includes(q) || norm(contexts[z.key]).includes(q))
      : zones.slice();
    const by = {
      km: (a, b) => b.distanceKm - a.distanceKm,
      runs: (a, b) => b.count - a.count,
      recent: (a, b) => String(b.lastDate ?? '').localeCompare(String(a.lastDate ?? '')),
      name: (a, b) => zoneLabel(a).localeCompare(zoneLabel(b), lang),
    };
    return list.sort(by[sort] ?? by.km);
  }, [zones, query, sort, contexts, zoneLabel, lang]);

  // ── Nombres automáticos ────────────────────────────────────────────────────
  // Se dispara SOLO en cuanto hay zonas sin nombrar, así que la lista llega ya
  // nombrada sin que el atleta tenga que pedirlo. Contrapartida, dicha en claro:
  // esto envía tus coordenadas a un tercero (nominatim.openstreetmap.org) sin que
  // medie un clic. El aviso de progreso deja pararlo en seco.
  const unnamed = zones.filter(z => !z.name);
  const attempted = useRef(new Set());

  const zonesRef = useRef(zones);
  const labelsRef = useRef(labels);
  const contextsRef = useRef(contexts);
  zonesRef.current = zones;
  labelsRef.current = labels;
  contextsRef.current = contexts;

  const detectNames = useCallback(async (targets) => {
    if (!targets.length) return;
    const controller = new AbortController();
    geoAbort.current = controller;
    setGeo({ done: 0, total: targets.length });
    for (const z of targets) attempted.current.add(z.key);
    try {
      const found = await reverseGeocodeBatch(
        targets.map(z => ({ key: z.key, centroid: z.centroid })),
        { lang, signal: controller.signal, onProgress: (done, total) => setGeo({ done, total }) },
      );
      // Los nombres ya puestos a mano entran en el reparto para que el
      // desambiguador no cree un duplicado de algo que el atleta ya escribió.
      const taken = zonesRef.current
        .filter(z => z.name)
        .map(z => ({ key: z.key, local: z.name, area: null }));
      const ctx = {};
      for (const f of found) if (f.context) ctx[f.key] = f.context;
      patchStore({
        labels: { ...labelsRef.current, ...uniqueLabels([...taken, ...found]) },
        contexts: { ...contextsRef.current, ...ctx },
      });
    } catch {
      // Abortado o red caída: las zonas se quedan sin nombre y se escriben a mano.
    } finally {
      setGeo(null);
      geoAbort.current = null;
    }
  }, [lang, patchStore]);

  // Arranque automático. El retardo deja asentar los cúmulos: mover el radio
  // rehace la lista entera y sin esperar se lanzaría un lote por cada paso.
  const pendingKeys = unnamed.filter(z => !attempted.current.has(z.key)).map(z => z.key).join('|');
  useEffect(() => {
    if (!pendingKeys || geoAbort.current) return;
    const id = setTimeout(() => {
      const targets = zonesRef.current.filter(z => !z.name && !attempted.current.has(z.key));
      if (targets.length) detectNames(targets);
    }, 1200);
    return () => clearTimeout(id);
  }, [pendingKeys, detectNames]);

  const stopDetect = () => geoAbort.current?.abort();
  const retryDetect = () => {
    if (geo) return;
    attempted.current = new Set();
    detectNames(zones.filter(z => !z.name));
  };

  // Reset a dos clics: se lleva por delante lo que hayas escrito a mano, así que
  // el primero pide confirmación y se cae solo a los 5 s. Las fusiones NO se
  // tocan: son decisiones de geometría, no de nombre.
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const id = setTimeout(() => setConfirmReset(false), 5000);
    return () => clearTimeout(id);
  }, [confirmReset]);

  const resetNames = () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    geoAbort.current?.abort();
    attempted.current = new Set();
    patchStore({ labels: {}, contexts: {} });
  };

  // ── Mapa de una zona ───────────────────────────────────────────────────────
  const [mapKey, setMapKey] = useState(null);
  const mapZone = zones.find(z => z.key === mapKey) ?? null;

  const routes = useMemo(() => {
    if (!mapZone) return [];
    return mapZone.activities
      .filter(a => a.map?.summary_polyline)
      .map(a => ({
        id: a.id,
        name: a.name,
        date: String(a.start_date_local || a.start_date || '').slice(0, 10),
        distanceKm: (a.distance || 0) / 1000,
        positions: polyline.decode(a.map.summary_polyline),
      }))
      .filter(r => r.positions.length > 1);
  }, [mapZone]);

  // Índice de rutina: cuántas rutas DISTINTAS hay bajo este mismo sitio. Se
  // calcula solo sobre la zona abierta, aprovechando que sus trazas ya están
  // decodificadas para pintarlas.
  const routeGroups = useMemo(() => groupRoutes(routes), [routes]);
  const routine = useMemo(() => routineIndex(routeGroups), [routeGroups]);
  const groupOf = useMemo(() => {
    const m = new Map();
    routeGroups.forEach((g, i) => g.memberIds.forEach(id => m.set(id, i)));
    return m;
  }, [routeGroups]);

  // Puntos de salida reales de la zona: enseñan la dispersión que el radio está
  // tragando, que es justo lo que hay que juzgar para saber si está bien puesto.
  const mapStarts = useMemo(() => (mapZone?.activities ?? [])
    .map(a => ({
      id: a.id,
      name: a.name,
      date: String(a.start_date_local || a.start_date || '').slice(0, 10),
      distanceKm: (a.distance || 0) / 1000,
      point: startPoint(a),
    }))
    .filter(s => s.point), [mapZone]);

  // Las salidas entran en el encuadre aunque su carrera no tenga traza: si no,
  // una zona sin polylines abriría el mapa en el sitio equivocado.
  const mapBounds = useMemo(
    () => boundsOf([...routes, { positions: mapStarts.map(s => s.point) }]),
    [routes, mapStarts],
  );

  // Cada traza y cada punto de salida abre SU actividad en Strava. El mapa deja
  // de ser un dibujo y pasa a ser un índice.
  const stravaHandlers = useCallback((id) => ({
    click: () => window.open(`https://www.strava.com/activities/${id}`, '_blank', 'noopener,noreferrer'),
  }), []);

  // Sobre una maraña de veinte trazas superpuestas, apuntar a una y no saber
  // cuál se va a abrir es lo que hace inútil el clic. Al pasar por encima, esa
  // traza se engorda, sube al frente y se opaca: se ve entera y se ve cuál es.
  const routeHandlers = useCallback((id, base) => ({
    ...stravaHandlers(id),
    mouseover: (e) => {
      e.target.setStyle({ weight: base.weight + 2, opacity: 1 });
      e.target.bringToFront();
    },
    mouseout: (e) => e.target.setStyle(base),
  }), [stravaHandlers]);

  // Capas que se pueden apagar: con cien salidas encima, los puntos tapan las
  // trazas, y el círculo del radio solo hace falta mientras se ajusta.
  const [showStarts, setShowStarts] = useState(true);
  const [showRadius, setShowRadius] = useState(true);

  // La capa base es una preferencia, no un estado de sesión: se guarda con el
  // resto para no reelegirla cada vez que se abre un sitio.
  const basemap = BASEMAPS.includes(store.basemap) ? store.basemap : DEFAULT_BASEMAP;
  // Sobre teselas oscuras o una foto aérea, un borde casi negro desaparece.
  const markerStroke = basemap === 'light' ? '#0f172a' : '#f8fafc';

  // Cerrar con Escape, bloquear el scroll de detrás (que si no la rueda del
  // ratón mueve la página en vez de hacer zoom) y devolver el foco a la fila
  // desde la que se abrió, que si no se queda huérfano en el <body>.
  useEffect(() => {
    if (!mapKey) return;
    const opener = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') setMapKey(null); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, [mapKey]);

  // ── Lecturas secundarias ───────────────────────────────────────────────────
  const SEASON_ZONES = 10;
  const seasonality = useMemo(() => monthlyByZone(zones.slice(0, SEASON_ZONES)), [zones]);
  const seasonMax = useMemo(
    () => Math.max(0, ...seasonality.flatMap(z => z.months)),
    [seasonality],
  );
  const exploration = useMemo(() => explorationByYear(zones), [zones]);
  const dormant = useMemo(() => dormantZones(zones), [zones]);
  const dormantKeys = useMemo(() => new Set(dormant.map(z => z.key)), [dormant]);

  const monthLabels = useMemo(() => Array.from({ length: 12 }, (_, m) =>
    new Date(2026, m, 1).toLocaleDateString(lang, { month: 'narrow' })), [lang]);
  const monthNames = useMemo(() => Array.from({ length: 12 }, (_, m) =>
    new Date(2026, m, 1).toLocaleDateString(lang, { month: 'long' })), [lang]);

  // Un solo panel con pestañas en vez de tres acordeones apilados: las tres
  // responden a la misma pregunta ("¿cómo se reparte esto en el tiempo?") vista
  // de tres maneras, y solo se mira una a la vez.
  const tabs = useMemo(() => [
    seasonMax > 0 && { id: 'season', label: t('geozones.season_title'), sub: t('geozones.season_sub') },
    exploration.length > 0 && {
      id: 'explore',
      label: t('geozones.explore_title'),
      sub: t('geozones.explore_sub', {
        home: zones.length ? zoneLabel(zones[0]) : t('geozones.explore_home_fallback'),
      }),
    },
    dormant.length > 0 && {
      id: 'dormant',
      label: t('geozones.dormant_title'),
      sub: t('geozones.dormant_sub', { months: DORMANT_MONTHS }),
      count: dormant.length,
    },
  ].filter(Boolean), [seasonMax, exploration.length, dormant, zones, zoneLabel, t]);

  const [tab, setTab] = useState('season');
  const activeTab = tabs.find(x => x.id === tab) ?? tabs[0] ?? null;

  if (!zones.length) {
    return (
      <Card>
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {t('geozones.title')}
        </h2>
        <Callout title={t('geozones.empty_title')} icon={InformationCircleIcon} color="amber" className="mt-4">
          {t('geozones.empty', { count: unlocated.count })}
        </Callout>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Cabecera y cifras ───────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="max-w-xl">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              <MapPinIcon className="h-5 w-5 text-slate-400" />
              {t('geozones.title')}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {t('geozones.subtitle')}
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-baseline gap-1.5">
              <span className={LABEL}>{t('geozones.radius')}</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">km</span>
            </div>
            <RadiusPicker
              value={radiusKm}
              onChange={(v) => patchStore({ radiusKm: v })}
              label={t('geozones.radius')}
            />
            <p className="mt-1.5 max-w-[17rem] text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              {t('geozones.radius_hint', { km: fmtKm(radiusKm, lang) })}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-200 sm:grid-cols-4 dark:bg-slate-800">
          <Kpi label={t('geozones.kpi_zones')} value={zones.length} />
          <Kpi label={t('geozones.kpi_km')} value={`${fmtKm(totalKm, lang)} km`} />
          <Kpi label={t('geozones.kpi_runs')} value={zones.reduce((s, z) => s + z.count, 0)} />
          <Kpi
            label={t('geozones.kpi_unlocated')}
            value={unlocated.count ? `${fmtKm(unlocated.distanceKm, lang)} km` : '—'}
            hint={unlocated.count ? t('geozones.kpi_unlocated_hint', { count: unlocated.count }) : null}
          />
        </dl>

        {/* El matiz importa, pero no todos los días: plegado, no un párrafo fijo. */}
        <details className="group mt-3">
          <summary
            className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-xs font-medium
                        text-slate-500 transition hover:text-slate-800 motion-reduce:transition-none
                        dark:text-slate-400 dark:hover:text-slate-100 ${FOCUS}`}
          >
            <InformationCircleIcon className="h-4 w-4" />
            {t('geozones.caveat_title')}
            <ChevronDownIcon className="h-3.5 w-3.5 transition group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <p className="mt-2 border-l-2 border-slate-200 pl-3 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t('geozones.caveat')}
          </p>
        </details>
      </Card>

      {/* ── Lista de lugares: el objeto principal de la pantalla ────────── */}
      <Card className="overflow-visible p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('geozones.table_title')}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t('geozones.table_sub')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('geozones.search_placeholder')}
                aria-label={t('geozones.search_placeholder')}
                className={`w-44 rounded-lg border border-slate-300 bg-transparent py-1.5 pl-8 pr-2 text-sm
                            text-slate-700 placeholder:text-slate-400 dark:border-slate-600
                            dark:text-slate-200 ${FOCUS}`}
              />
            </div>

            <label className="sr-only" htmlFor="geozones-sort">{t('geozones.sort_label')}</label>
            <select
              id="geozones-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className={`rounded-lg border border-slate-300 bg-transparent py-1.5 pl-2.5 pr-7 text-sm
                          font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-900
                          dark:text-slate-200 ${FOCUS}`}
            >
              <option value="km">{t('geozones.sort_km')}</option>
              <option value="runs">{t('geozones.sort_runs')}</option>
              <option value="recent">{t('geozones.sort_recent')}</option>
              <option value="name">{t('geozones.sort_name')}</option>
            </select>

            {!mergeMode && (
              <button type="button" onClick={() => setMergeMode(true)} disabled={zones.length < 2} className={BTN}>
                <ArrowsPointingInIcon className="h-4 w-4" />
                {t('geozones.merge_start')}
              </button>
            )}

            {/* Reintentar y reiniciar nombres se usan una vez al año: fuera de la
                barra, que si no compiten con lo que sí se toca a diario. */}
            <Menu label={t('geozones.more_actions')}>
              <button
                type="button"
                onClick={retryDetect}
                disabled={!!geo || !unnamed.length}
                className={MENU_ITEM}
              >
                <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span>
                  {t('geozones.detect', { count: unnamed.length })}
                  <MenuHint>{t('geozones.detect_hint')}</MenuHint>
                </span>
              </button>
              <button
                type="button"
                onClick={resetNames}
                disabled={!Object.keys(labels).length && !Object.keys(contexts).length}
                className={confirmReset ? `${MENU_ITEM} !text-rose-600 dark:!text-rose-400` : MENU_ITEM}
              >
                <ArrowPathIcon className={`mt-0.5 h-4 w-4 shrink-0 ${confirmReset ? 'text-rose-500' : 'text-slate-400'}`} />
                <span>
                  {confirmReset ? t('geozones.reset_confirm') : t('geozones.reset')}
                  <MenuHint>{t('geozones.reset_hint')}</MenuHint>
                </span>
              </button>
            </Menu>
          </div>
        </div>

        {/* Estado de la geocodificación: un aviso que informa y deja parar, en vez
            de un botón que cambia de significado a mitad de faena. */}
        {geo && (
          <div className="mx-5 mt-3 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
            <SparklesIcon className="h-4 w-4 shrink-0 animate-pulse text-slate-400 motion-reduce:animate-none" />
            <span className="text-xs text-slate-600 dark:text-slate-300">
              {t('geozones.detect_progress', { done: geo.done, total: geo.total })}
            </span>
            <span className="h-1 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <span
                className="block h-full rounded-full bg-slate-400 transition-[width] motion-reduce:transition-none dark:bg-slate-500"
                style={{ width: `${geo.total ? (geo.done / geo.total) * 100 : 0}%` }}
              />
            </span>
            <button
              type="button"
              onClick={stopDetect}
              className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 transition
                          hover:text-slate-900 motion-reduce:transition-none dark:text-slate-400
                          dark:hover:text-slate-100 ${FOCUS}`}
            >
              {t('geozones.detect_stop')}
            </button>
          </div>
        )}

        {/* Modo fusión: barra propia, para que se vea que la lista ha cambiado de
            modo y por dónde se sale. */}
        {mergeMode && (
          <div className="mx-5 mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 dark:border-sky-800 dark:bg-sky-950/40">
            <ArrowsPointingInIcon className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <span className="flex-1 text-xs text-sky-900 dark:text-sky-200">
              {t('geozones.merge_mode_hint')}
            </span>
            <button
              type="button"
              onClick={() => { setMergeMode(false); setSelected(new Set()); }}
              className={`rounded-lg px-2.5 py-1 text-sm font-medium text-sky-800 transition hover:bg-sky-100
                          motion-reduce:transition-none dark:text-sky-200 dark:hover:bg-sky-900/60 ${FOCUS}`}
            >
              {t('geozones.cancel')}
            </button>
            <button
              type="button"
              onClick={mergeSelected}
              disabled={selected.size < 2}
              className={`inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1 text-sm font-medium
                          text-white transition enabled:hover:bg-sky-700 disabled:opacity-40
                          motion-reduce:transition-none ${FOCUS}`}
            >
              <CheckIcon className="h-4 w-4" />
              {t('geozones.merge', { count: selected.size })}
            </button>
          </div>
        )}

        <div className="px-5 pb-5">
          {/* Cabecera de columnas: las etiquetas se dicen UNA vez y no una por
              celda y fila, que era lo que llenaba la lista de letra pequeña. */}
          <div className={`mt-4 hidden border-b border-slate-200 px-4 pb-2 dark:border-slate-800 ${ROW_GRID}`}>
            <span className={LABEL}>{t('geozones.col_zone')}</span>
            <span className={`${LABEL} lg:text-right`}>{t('geozones.col_km')}</span>
            <span className={`${LABEL} lg:text-right`}>{t('geozones.col_runs')}</span>
            <span className={`${LABEL} lg:text-right`}>{t('geozones.col_avg')}</span>
            <span className={`${LABEL} lg:text-right`}>{t('geozones.col_time')}</span>
            <span className={`${LABEL} lg:text-right`} title={t('geozones.col_slope_hint')}>
              {t('geozones.col_slope')}
            </span>
            <span className={`${LABEL} lg:text-right`}>{t('geozones.col_period')}</span>
            <span className="sr-only">{t('geozones.col_actions')}</span>
          </div>

          <ul className="mt-2 space-y-1">
            {visible.map((z) => {
              const color = colorForKey(z.key);
              const picked = selected.has(z.key);
              const pending = !z.name && !!geo;
              return (
                <li
                  key={z.key}
                  className={`group relative overflow-hidden rounded-xl border transition motion-reduce:transition-none
                              ${picked
                                ? 'border-sky-400 bg-sky-50/60 dark:border-sky-600 dark:bg-sky-950/20'
                                : 'border-transparent hover:border-slate-200 hover:bg-slate-50/60 dark:hover:border-slate-800 dark:hover:bg-slate-800/30'}`}
                >
                  {/* La barra de km ES la fila: proporción sobre el sitio con más
                      kilómetros. Absorbe el gráfico de barras que antes vivía en su
                      propia tarjeta diciendo exactamente lo mismo que esta lista. */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${maxKm > 0 ? (z.distanceKm / maxKm) * 100 : 0}%`, background: tint(color, 8) }}
                  />
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />

                  <div className={`relative flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 pl-4 pr-2 ${ROW_GRID}`}>
                    {/* Lugar */}
                    <div className="flex min-w-[12rem] flex-1 items-center gap-2 lg:min-w-0">
                      {mergeMode && (
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => toggle(z.key)}
                          aria-label={t('geozones.select_zone')}
                          className={`h-4 w-4 shrink-0 rounded border-slate-300 text-sky-600 dark:border-slate-600 ${FOCUS}`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {pending ? (
                            <span className="h-5 w-32 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-700" />
                          ) : (
                            <>
                              <input
                                value={z.name ?? ''}
                                onChange={(e) => rename(z.key, e.target.value)}
                                placeholder={t('geozones.name_placeholder')}
                                aria-label={t('geozones.name_label')}
                                className={`w-full max-w-[16rem] rounded border border-transparent bg-transparent px-1 py-0.5
                                            text-sm font-semibold text-slate-900 placeholder:font-normal
                                            placeholder:text-slate-400 hover:border-slate-300 hover:bg-white
                                            dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-900 ${FOCUS}`}
                              />
                              <PencilIcon className="h-3.5 w-3.5 shrink-0 text-slate-300 opacity-0 transition group-hover:opacity-100 motion-reduce:transition-none dark:text-slate-600" />
                            </>
                          )}
                          {z.mergedFrom && (
                            <Badge size="xs" color="slate">{t('geozones.merged', { count: z.mergedFrom.length })}</Badge>
                          )}
                          {dormantKeys.has(z.key) && (
                            <Badge size="xs" color="amber">{t('geozones.dormant_badge')}</Badge>
                          )}
                        </div>
                        <div className="mt-0.5 truncate pl-1 text-xs text-slate-400 dark:text-slate-500">
                          {contexts[z.key] || `${z.centroid[0].toFixed(3)}, ${z.centroid[1].toFixed(3)}`}
                        </div>
                      </div>
                    </div>

                    {/* Km: el dato principal, con su cuota al lado. */}
                    <div className="whitespace-nowrap lg:text-right">
                      <span className="text-base font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                        {fmtKm(z.distanceKm, lang)}
                      </span>
                      <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">km</span>
                      <span className="ml-2 text-xs tabular-nums text-slate-400 dark:text-slate-500">
                        {z.pct.toFixed(1)} %
                      </span>
                    </div>

                    <Cell label={t('geozones.col_runs')} align="right">{z.count}</Cell>
                    <Cell label={t('geozones.col_avg')} align="right">{fmtKm(z.distanceKm / z.count, lang)}</Cell>
                    <Cell label={t('geozones.col_time')} align="right">{formatDurationHm(z.movingSec)}</Cell>
                    <Cell label={t('geozones.col_slope')} align="right">{z.elevPct.toFixed(1)} %</Cell>
                    <Cell label={t('geozones.col_period')} align="right">
                      <span className="text-xs">{fmtDate(z.firstDate, lang)} → {fmtDate(z.lastDate, lang)}</span>
                    </Cell>

                    {/* Acciones: aparecen al pasar por encima o al tabular. En
                        táctil y en columna estrecha siguen siempre visibles. */}
                    <div
                      className="ml-auto flex items-center justify-end gap-0.5 transition motion-reduce:transition-none
                                 lg:ml-0 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
                    >
                      {z.mergedFrom && (
                        <button type="button" onClick={() => unmerge(z.key)} title={t('geozones.unmerge')} className={ICON_BTN}>
                          <ArrowUturnLeftIcon className="h-4 w-4" />
                        </button>
                      )}
                      <a
                        href={osmUrl(z.centroid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('geozones.open_map')}
                        className={ICON_BTN}
                      >
                        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                      </a>
                      <button type="button" onClick={() => setMapKey(z.key)} title={t('geozones.show_routes')} className={ICON_BTN}>
                        <MapIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {!visible.length && (
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('geozones.no_matches', { query: query.trim() })}
            </p>
          )}
        </div>
      </Card>

      {/* ── Lecturas secundarias: un panel, tres pestañas ───────────────── */}
      {activeTab && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-5 pt-4 dark:border-slate-800">
            <div role="tablist" aria-label={t('geozones.patterns_title')} className="-mb-px flex flex-wrap gap-1">
              {tabs.map((x) => {
                const on = x.id === activeTab.id;
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTab(x.id)}
                    className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition
                                motion-reduce:transition-none ${FOCUS}
                                ${on
                                  ? 'border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-50'
                                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}`}
                  >
                    {x.label}
                    {x.count != null && (
                      <span className="rounded-full bg-slate-100 px-1.5 text-[11px] tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {x.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="mb-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{activeTab.sub}</p>

            {activeTab.id === 'season' && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] border-separate border-spacing-y-1 text-sm">
                    <caption className="sr-only">{t('geozones.season_title')}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={`pb-1 pr-3 text-left ${LABEL}`}>{t('geozones.col_zone')}</th>
                        {monthLabels.map((m, i) => (
                          <th key={i} scope="col" className={`pb-1 text-center ${LABEL}`}>{m}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {seasonality.map((z) => {
                        const color = colorForKey(z.key);
                        return (
                          <tr key={z.key}>
                            <th scope="row" className="w-44 max-w-[11rem] truncate pr-3 text-left text-xs font-medium">
                              <span className="flex items-center gap-2">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                                <span className="truncate text-slate-700 dark:text-slate-200">{zoneLabel(z)}</span>
                              </span>
                            </th>
                            {z.months.map((km, m) => (
                              <td key={m} className="px-0.5">
                                {/* Sin cifras dentro: a partir de 100 km no caben en la
                                    celda. El color da la lectura y el tooltip el dato. */}
                                <div
                                  title={`${monthNames[m]} · ${fmtKm(km, lang)} km`}
                                  className="h-6 rounded-[3px]"
                                  style={{ background: km > 0 ? tint(color, 15 + (km / seasonMax) * 85) : tint('#94a3b8', 8) }}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className={`mt-3 flex items-center gap-2 ${LABEL}`}>
                  <span>{t('geozones.season_less')}</span>
                  <span className="flex gap-0.5">
                    {[8, 30, 55, 80, 100].map(p => (
                      <span key={p} className="h-3 w-5 rounded-[2px]" style={{ background: tint('#64748b', p) }} />
                    ))}
                  </span>
                  <span>{t('geozones.season_more', { km: fmtKm(seasonMax, lang) })}</span>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {t('geozones.season_note')}
                </p>
              </>
            )}

            {activeTab.id === 'explore' && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={`border-b border-slate-200 text-left dark:border-slate-700 ${LABEL}`}>
                        <th scope="col" className="py-2 pr-3">{t('geozones.col_year')}</th>
                        <th scope="col" className="py-2 pr-3 text-right">{t('geozones.col_radius')}</th>
                        <th scope="col" className="py-2 pr-3 text-right">{t('geozones.col_places')}</th>
                        <th scope="col" className="py-2 pr-3 text-right">{t('geozones.col_area')}</th>
                        <th scope="col" className="py-2 pr-3 text-right">{t('geozones.col_runs')}</th>
                        <th scope="col" className="py-2 text-right">{t('geozones.col_km')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exploration.map(y => (
                        <tr key={y.year} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                          <td className="py-2 pr-3 font-medium tabular-nums">{y.year}</td>
                          <td className="py-2 pr-3 text-right font-semibold tabular-nums">{fmtKm(y.radiusKm, lang)} km</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{y.places}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                            {y.areaKm2 >= 1 ? `${Math.round(y.areaKm2).toLocaleString(lang)} km²` : '—'}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{y.runs}</td>
                          <td className="py-2 text-right tabular-nums text-slate-500">{fmtKm(y.distanceKm, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {t('geozones.explore_note')}
                </p>
              </>
            )}

            {activeTab.id === 'dormant' && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dormant.slice(0, 24).map(z => (
                  <button
                    key={z.key}
                    type="button"
                    onClick={() => setMapKey(z.key)}
                    className={`flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-left transition
                                hover:bg-slate-50 motion-reduce:transition-none dark:border-slate-700
                                dark:hover:bg-slate-800 ${FOCUS}`}
                  >
                    <span className="h-8 w-1 shrink-0 rounded" style={{ background: colorForKey(z.key) }} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {zoneLabel(z)}
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {t('geozones.dormant_since', {
                          months: z.monthsSince,
                          km: fmtKm(z.distanceKm, lang),
                          date: fmtDate(z.lastDate, lang),
                        })}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Mapa de un lugar ────────────────────────────────────────────── */}
      {mapZone && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={zoneLabel(mapZone)}
          onClick={() => setMapKey(null)}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
        >
          {/* El clic en el fondo cierra; dentro del panel no debe propagarse, o
              arrastrar el mapa hasta soltar fuera cerraría el modal. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorForKey(mapZone.key) }} />
                  <span className="truncate">{zoneLabel(mapZone)}</span>
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t('geozones.map_sub', { routes: routes.length, count: mapZone.count })}
                  {contexts[mapZone.key] ? ` · ${contexts[mapZone.key]}` : ''}
                  {routine.total > 1
                    ? ` · ${t('geozones.routine', { distinct: routine.distinct, top: Math.round(routine.topShare) })}`
                    : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <label className="sr-only" htmlFor="geozones-basemap">{t('maps.base_map')}</label>
                <span className={`h-2 w-2 shrink-0 rounded-full ${BASEMAP_DOT[basemap]}`} aria-hidden="true" />
                <select
                  id="geozones-basemap"
                  value={basemap}
                  onChange={(e) => patchStore({ basemap: e.target.value })}
                  className={`mr-1 rounded-lg border border-slate-300 bg-transparent py-1 pl-1.5 pr-6 text-xs
                              font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-900
                              dark:text-slate-300 ${FOCUS}`}
                >
                  <option value="dark">{t('maps.dark')}</option>
                  <option value="light">{t('maps.light')}</option>
                  <option value="satellite">{t('maps.satellite')}</option>
                </select>
                {mapStarts.length > 0 && (
                  <LayerToggle on={showStarts} onClick={() => setShowStarts(v => !v)}>
                    {t('geozones.layer_starts', { count: mapStarts.length })}
                  </LayerToggle>
                )}
                <LayerToggle on={showRadius} onClick={() => setShowRadius(v => !v)}>
                  {t('geozones.layer_radius')}
                </LayerToggle>
                <button type="button" onClick={() => setMapKey(null)} title={t('geozones.close')} className={ICON_BTN} autoFocus>
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            {mapBounds ? (
              // `key` fuerza el remontaje al cambiar de zona: Leaflet solo aplica
              // `bounds` al montar, así que sin esto el mapa se quedaría en el
              // encuadre del sitio anterior.
              <div className="h-[70vh] min-h-[360px] w-full">
                <MapContainer key={mapZone.key} bounds={mapBounds} scrollWheelZoom className="z-0 h-full w-full">
                  {/* `key` fuerza el cambio de teselas al elegir otra capa. */}
                  <TileLayer
                    key={basemap}
                    attribution={getMapAttribution(basemap)}
                    url={basemapUrl(basemap)}
                  />
                  {/* Cada ruta distinta va de un color: el reparto de colores ES
                      el índice de rutina hecho imagen. Un mapa monocolor significa
                      que siempre haces la misma vuelta. La más repetida va gruesa
                      y las excursiones sueltas apagadas, para no leer todo a la vez. */}
                  {routes.map(r => {
                    const style = routeStyle(groupOf.get(r.id) ?? 0);
                    return (
                      <Polyline
                        key={r.id}
                        positions={r.positions}
                        pathOptions={style}
                        eventHandlers={routeHandlers(r.id, style)}
                      >
                        <LeafletTooltip sticky>{actLabel(r, lang)}</LeafletTooltip>
                      </Polyline>
                    );
                  })}

                  {/* El radio del cúmulo, para ver qué está capturando. Si las
                      salidas rozan el borde, probablemente estés juntando dos sitios. */}
                  {showRadius && (
                    <Circle
                      center={mapZone.seed}
                      radius={radiusKm * 1000}
                      interactive={false}
                      pathOptions={{ color: '#94a3b8', weight: 1, dashArray: '4 4', fill: false }}
                    />
                  )}
                  {showStarts && mapStarts.map(s => (
                    <CircleMarker
                      key={s.id}
                      center={s.point}
                      radius={4}
                      pathOptions={{
                        color: markerStroke, weight: 1, fillColor: '#fff', fillOpacity: 0.9,
                        className: 'cursor-pointer',
                      }}
                      eventHandlers={stravaHandlers(s.id)}
                    >
                      <LeafletTooltip>{actLabel(s, lang)}</LeafletTooltip>
                    </CircleMarker>
                  ))}
                  {/* El centroide no es una actividad: no se puede pulsar. */}
                  <CircleMarker
                    center={mapZone.centroid}
                    radius={7}
                    interactive={false}
                    pathOptions={{
                      color: markerStroke, weight: 2,
                      fillColor: colorForKey(mapZone.key), fillOpacity: 1,
                    }}
                  />
                </MapContainer>
              </div>
            ) : (
              <div className="p-4">
                <Callout title={t('geozones.map_empty_title')} icon={InformationCircleIcon} color="amber">
                  {t('geozones.map_empty', { count: mapZone.count })}
                </Callout>
              </div>
            )}

            {/* Leyenda: sin ella hay que adivinar qué es el círculo de puntos y
                por qué las trazas cambian de color. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-slate-900 dark:border-slate-200"
                  style={{ background: colorForKey(mapZone.key) }}
                />
                {t('geozones.legend_center')}
              </span>
              {showStarts && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full border border-slate-900 bg-white dark:border-slate-200" />
                  {t('geozones.legend_start')}
                </span>
              )}
              {showRadius && (
                <span className="flex items-center gap-1.5">
                  <span className="h-0 w-4 shrink-0 border-t border-dashed border-slate-400" />
                  {t('geozones.legend_radius', { km: fmtKm(radiusKm, lang) })}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="flex items-center gap-0.5">
                  <span className="h-1 w-4 shrink-0 rounded" style={{ background: PALETTE[0] }} />
                  {PALETTE.slice(1, 3).map(c => (
                    <span key={c} className="h-px w-3 shrink-0 rounded opacity-60" style={{ background: c }} />
                  ))}
                </span>
                {t('geozones.legend_routes')}
              </span>
              <span className="ml-auto hidden sm:inline">{t('geozones.map_footer')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
