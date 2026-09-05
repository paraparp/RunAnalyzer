import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MapContainer, TileLayer, Polyline, Circle, CircleMarker,
  Tooltip as LeafletTooltip,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import polyline from '@mapbox/polyline';
import { Card, Select, SelectItem, Badge, Callout } from '@tremor/react';
import {
  MapPinIcon, ArrowsPointingInIcon, ArrowUturnLeftIcon,
  ArrowTopRightOnSquareIcon, InformationCircleIcon, SparklesIcon, ArrowPathIcon,
  MapIcon, XMarkIcon, ChevronDownIcon, PencilIcon, CheckIcon,
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
// La pantalla se organiza alrededor de UN objeto: la lista de lugares. Todo lo
// demás (estacionalidad, exploración, sitios dormidos) es lectura secundaria y
// va plegado, porque son preguntas que uno se hace de vez en cuando y no cada
// vez que abre la pestaña.

const STORE_KEY = 'geo_zones';

// Paleta cualitativa: cada lugar es una categoría sin orden intrínseco, así que
// tonos distintos y no una rampa (una rampa insinuaría una magnitud que no hay).
const PALETTE = [
  '#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#a78bfa', '#fb923c',
  '#2dd4bf', '#f472b6', '#facc15', '#60a5fa', '#34d399', '#c084fc',
];

// El color sale de un hash de la CLAVE del sitio, nunca de su posición en la
// lista. Si dependiera del orden, mover el radio o fusionar dos zonas repintaría
// media pantalla, y el mismo sitio aparecería de un color en la lista, de otro
// en la rejilla de estacionalidad y de un tercero en el mapa. Con el hash, un
// sitio tiene su color para siempre y en todas las vistas.
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

// Teselas CARTO, las mismas del heatmap global. El tema se lee del <html> porque
// Tailwind va en modo 'class': un mapa claro dentro de la app en oscuro deslumbra.
const isDarkTheme = () => typeof document !== 'undefined'
  && document.documentElement.classList.contains('dark');

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

/** Etiqueta de dato: la palabra en pequeño y el valor a su lado. */
function Metric({ label, children }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <span className="tabular-nums text-slate-600 dark:text-slate-300">{children}</span>
    </span>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

/** Sección plegable nativa: sin JS, con teclado y foco visible de serie. */
function Section({ title, subtitle, defaultOpen = false, children }) {
  return (
    <Card className="overflow-hidden p-0">
      <details open={defaultOpen} className="group">
        <summary
          className={`flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4
                      transition hover:bg-slate-50 motion-reduce:transition-none
                      dark:hover:bg-slate-800/60 ${FOCUS}`}
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">{children}</div>
      </details>
    </Card>
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

  const zones = useMemo(
    () => shareOfKm(applyZoneEdits(raw, { labels, mergeInto })),
    [raw, labels, mergeInto],
  );

  const totalKm = zones.reduce((s, z) => s + z.distanceKm, 0);
  const maxKm = zones.length ? zones[0].distanceKm : 0;

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

  // ── Nombres automáticos ────────────────────────────────────────────────────
  // Se dispara SOLO en cuanto hay zonas sin nombrar, así que la lista llega ya
  // nombrada sin que el atleta tenga que pedirlo. Contrapartida, dicha en claro:
  // esto envía tus coordenadas a un tercero (nominatim.openstreetmap.org) sin que
  // medie un clic. El botón sigue ahí para pararlo en seco.
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

  const toggleDetect = () => {
    if (geo) { geoAbort.current?.abort(); return; }
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

  // Cerrar con Escape y bloquear el scroll de detrás, que si no la rueda del
  // ratón mueve la página en vez de hacer zoom en el mapa.
  useEffect(() => {
    if (!mapKey) return;
    const onKey = (e) => { if (e.key === 'Escape') setMapKey(null); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
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

  const zoneLabel = (z) => z.name || contexts[z.key] || t('geozones.name_placeholder');

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              <MapPinIcon className="h-5 w-5 text-slate-400" />
              {t('geozones.title')}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {t('geozones.subtitle')}
            </p>
          </div>
          <div className="w-52">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('geozones.radius')}
            </label>
            <Select value={String(radiusKm)} onValueChange={(v) => patchStore({ radiusKm: Number(v) })} enableClear={false}>
              {RADIUS_OPTIONS.map(r => (
                <SelectItem key={r} value={String(r)}>{t('geozones.radius_value', { km: r })}</SelectItem>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6 border-t border-slate-200 pt-5 sm:grid-cols-4 dark:border-slate-800">
          <Kpi label={t('geozones.kpi_zones')} value={zones.length} />
          <Kpi label={t('geozones.kpi_km')} value={`${fmtKm(totalKm, lang)} km`} />
          <Kpi label={t('geozones.kpi_runs')} value={zones.reduce((s, z) => s + z.count, 0)} />
          <Kpi
            label={t('geozones.kpi_unlocated')}
            value={unlocated.count ? `${fmtKm(unlocated.distanceKm, lang)} km` : '—'}
            hint={unlocated.count ? t('geozones.kpi_unlocated_hint', { count: unlocated.count }) : null}
          />
        </div>

        <p className="mt-4 border-l-2 border-slate-200 pl-3 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t('geozones.caveat')}
        </p>
      </Card>

      {/* ── Lista de lugares: el objeto principal de la pantalla ────────── */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('geozones.table_title')}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {mergeMode ? t('geozones.merge_mode_hint') : t('geozones.table_sub')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {mergeMode ? (
              <>
                <button type="button" onClick={() => { setMergeMode(false); setSelected(new Set()); }} className={BTN}>
                  {t('geozones.cancel')}
                </button>
                <button type="button" onClick={mergeSelected} disabled={selected.size < 2} className={BTN}>
                  <CheckIcon className="h-4 w-4" />
                  {t('geozones.merge', { count: selected.size })}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={toggleDetect}
                  disabled={!geo && !unnamed.length}
                  title={t('geozones.detect_hint')}
                  className={BTN}
                >
                  <SparklesIcon className={`h-4 w-4 ${geo ? 'animate-pulse motion-reduce:animate-none' : ''}`} />
                  {geo
                    ? t('geozones.detect_running', { done: geo.done, total: geo.total })
                    : t('geozones.detect', { count: unnamed.length })}
                </button>
                <button
                  type="button"
                  onClick={resetNames}
                  disabled={!Object.keys(labels).length && !Object.keys(contexts).length}
                  title={t('geozones.reset_hint')}
                  className={confirmReset
                    ? `${BTN} !border-rose-400 !text-rose-600 dark:!border-rose-500 dark:!text-rose-400`
                    : BTN}
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  {confirmReset ? t('geozones.reset_confirm') : t('geozones.reset')}
                </button>
                <button type="button" onClick={() => setMergeMode(true)} disabled={zones.length < 2} className={BTN}>
                  <ArrowsPointingInIcon className="h-4 w-4" />
                  {t('geozones.merge_start')}
                </button>
              </>
            )}
          </div>
        </div>

        <ul className="mt-4 space-y-1.5">
          {zones.map((z) => {
            const color = colorForKey(z.key);
            const picked = selected.has(z.key);
            const pending = !z.name && !!geo;
            return (
              <li
                key={z.key}
                className={`relative overflow-hidden rounded-xl border transition motion-reduce:transition-none
                            ${picked
                              ? 'border-slate-400 dark:border-slate-500'
                              : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'}`}
              >
                {/* La barra de km ES la fila: proporción sobre el sitio con más
                    kilómetros. Absorbe el gráfico de barras que antes vivía en su
                    propia tarjeta diciendo exactamente lo mismo que esta lista. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0"
                  style={{ width: `${maxKm > 0 ? (z.distanceKm / maxKm) * 100 : 0}%`, background: tint(color, 9) }}
                />
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />

                <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 py-3 pl-4 pr-3">
                  {mergeMode && (
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() => toggle(z.key)}
                      aria-label={t('geozones.select_zone')}
                      className={`h-4 w-4 shrink-0 rounded border-slate-300 dark:border-slate-600 ${FOCUS}`}
                    />
                  )}

                  <div className="min-w-[12rem] flex-1">
                    <div className="group/name flex items-center gap-1.5">
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
                                        placeholder:text-slate-400 hover:border-slate-300 dark:text-slate-100
                                        dark:hover:border-slate-600 ${FOCUS}`}
                          />
                          <PencilIcon className="h-3.5 w-3.5 shrink-0 text-slate-300 opacity-0 transition group-hover/name:opacity-100 motion-reduce:transition-none dark:text-slate-600" />
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

                  <div className="flex items-baseline gap-2 tabular-nums">
                    <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                      {fmtKm(z.distanceKm, lang)}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">km · {z.pct.toFixed(1)}%</span>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                    <Metric label={t('geozones.col_runs')}>{z.count}</Metric>
                    <Metric label={t('geozones.col_avg')}>{fmtKm(z.distanceKm / z.count, lang)} km</Metric>
                    <Metric label={t('geozones.col_time')}>{formatDurationHm(z.movingSec)}</Metric>
                    <Metric label={t('geozones.col_slope')}>{z.elevPct.toFixed(1)} %</Metric>
                    <Metric label={t('geozones.col_period')}>
                      {fmtDate(z.firstDate, lang)} → {fmtDate(z.lastDate, lang)}
                    </Metric>
                  </div>

                  <div className="ml-auto flex items-center gap-0.5">
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

        {unlocated.count > 0 && (
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            {t('geozones.unlocated_note', { count: unlocated.count, km: fmtKm(unlocated.distanceKm, lang) })}
          </p>
        )}
      </Card>

      {/* ── Lecturas secundarias, plegadas ──────────────────────────────── */}
      {seasonMax > 0 && (
        <Section title={t('geozones.season_title')} subtitle={t('geozones.season_sub')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-separate border-spacing-y-1 text-sm">
              <caption className="sr-only">{t('geozones.season_title')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pb-1 pr-3 text-left text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    {t('geozones.col_zone')}
                  </th>
                  {monthLabels.map((m, i) => (
                    <th key={i} scope="col" className="pb-1 text-center text-[10px] font-medium uppercase text-slate-400">
                      {m}
                    </th>
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
                          <span className="truncate text-slate-700 dark:text-slate-200">
                            {z.name || contexts[z.key] || t('geozones.name_placeholder')}
                          </span>
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

          <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
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
        </Section>
      )}

      {exploration.length > 0 && (
        <Section
          title={t('geozones.explore_title')}
          subtitle={t('geozones.explore_sub', { home: zoneLabel(zones[0]) })}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400 dark:border-slate-700">
                  <th scope="col" className="py-2 pr-3 font-medium">{t('geozones.col_year')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('geozones.col_radius')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('geozones.col_places')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('geozones.col_area')}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t('geozones.col_runs')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('geozones.col_km')}</th>
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
        </Section>
      )}

      {dormant.length > 0 && (
        <Section
          title={t('geozones.dormant_title')}
          subtitle={t('geozones.dormant_sub', { months: DORMANT_MONTHS })}
        >
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
        </Section>
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
                </p>
                {routine.total > 1 && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t('geozones.routine', { distinct: routine.distinct, top: Math.round(routine.topShare) })}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setMapKey(null)} title={t('geozones.close')} className={ICON_BTN} autoFocus>
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {mapBounds ? (
              // `key` fuerza el remontaje al cambiar de zona: Leaflet solo aplica
              // `bounds` al montar, así que sin esto el mapa se quedaría en el
              // encuadre del sitio anterior.
              <div className="h-[70vh] min-h-[360px] w-full">
                <MapContainer key={mapZone.key} bounds={mapBounds} scrollWheelZoom className="z-0 h-full w-full">
                  <TileLayer
                    attribution="&copy; OpenStreetMap &copy; CARTO"
                    url={isDarkTheme()
                      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
                  />
                  {/* Cada ruta distinta va de un color: el reparto de colores ES
                      el índice de rutina hecho imagen. Un mapa monocolor significa
                      que siempre haces la misma vuelta. */}
                  {routes.map(r => (
                    <Polyline
                      key={r.id}
                      positions={r.positions}
                      pathOptions={{
                        color: PALETTE[(groupOf.get(r.id) ?? 0) % PALETTE.length],
                        weight: 2,
                        opacity: 0.6,
                        className: 'cursor-pointer',
                      }}
                      eventHandlers={stravaHandlers(r.id)}
                    >
                      <LeafletTooltip sticky>{actLabel(r, lang)}</LeafletTooltip>
                    </Polyline>
                  ))}

                  {/* El radio del cúmulo, para ver qué está capturando. Si las
                      salidas rozan el borde, probablemente estés juntando dos sitios. */}
                  <Circle
                    center={mapZone.seed}
                    radius={radiusKm * 1000}
                    interactive={false}
                    pathOptions={{ color: '#94a3b8', weight: 1, dashArray: '4 4', fill: false }}
                  />
                  {mapStarts.map(s => (
                    <CircleMarker
                      key={s.id}
                      center={s.point}
                      radius={4}
                      pathOptions={{
                        color: '#0f172a', weight: 1, fillColor: '#fff', fillOpacity: 0.9,
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
                      color: '#0f172a', weight: 2,
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

            <p className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700 dark:text-slate-500">
              {t('geozones.map_footer')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
