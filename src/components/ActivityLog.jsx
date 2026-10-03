import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Select, SelectItem } from '@tremor/react';
import {
  AdjustmentsHorizontalIcon, ArrowTrendingUpIcon, BoltIcon, MagnifyingGlassIcon,
  MapPinIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import MonthlyChart from './MonthlyChart';
import CollapsibleSection from './CollapsibleSection';
import { formatPaceFromSpeed, formatPaceFromMinPerKm, formatDurationHm } from '../lib/timeFormat';
import { activityGapSpeed } from '../lib/streamGap';
import { activityEmoji } from '../lib/aiInsights';
import GlobalKpiGrid from './GlobalKpiGrid';
import { karvonenBounds, classifyHR } from '../lib/hrZones';
import { ZONES } from '../lib/zoneColors';
import { readLogState, writeLogState } from '../lib/activityLogParams';

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
const ACTIVITIES_PAGE_SIZE = 25;

// Marca de Strava (los dos chevrons), en currentColor para que herede el tono.
const StravaMark = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
  </svg>
);

const movingSecs = (a) => a.moving_time || a.elapsed_time;

// Valor de ordenación por columna. `null` = dato que falta (sin distancia, sin
// FC…): va siempre al final, ordenes como ordenes. Antes contaba como 0 y una
// sesión de fuerza salía la primera al ordenar por "ritmo más rápido".
function sortValue(a, key) {
  switch (key) {
    case 'distance': return a.distance ?? null;
    case 'time': return movingSecs(a) || null;
    case 'pace': return a.distance > 0 && movingSecs(a) ? movingSecs(a) / (a.distance / 1000) : null;
    case 'gap': {
      // Misma fuente que la columna que se pinta (streams si están, hipótesis
      // de perfil ondulado si no), para que ordenar y leer no den cifras distintas.
      const v = activityGapSpeed(a);
      return v > 0 ? 1000 / v : null;
    }
    case 'heartrate': return a.average_heartrate || null;
    case 'suffer_score': return a.suffer_score || null;
    case 'elevation': return a.total_elevation_gain ?? null;
    case 'gradient': return a.distance > 0 ? (a.total_elevation_gain / a.distance) * 100 : null;
    case 'date':
    default: return new Date(a.start_date).getTime();
  }
}

// "M:SS" → minutos decimales.
const parsePaceToMinutes = (paceStr) => {
  if (!paceStr) return null;
  if (paceStr.includes(':')) {
    const [m, s] = paceStr.split(':').map(Number);
    return m + (s || 0) / 60;
  }
  return parseFloat(paceStr);
};

const sportBadge = (activity) => {
  const st = activity.sport_type || activity.type;
  if (activity.workout_type === 1) return <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold tracking-wide bg-amber-400 text-white uppercase">Race</span>;
  if (st === 'TrailRun') return <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold tracking-wide bg-emerald-500 text-white uppercase">Trail</span>;
  // Con varios deportes en la tabla hace falta distinguirlos de un vistazo.
  if (!RUNNING_TYPES.includes(st)) return <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold tracking-wide bg-violet-500 text-white uppercase">{activityEmoji(st)} {st}</span>;
  return null;
};

const StravaLink = ({ id, label }) => (
  <a href={`https://www.strava.com/activities/${id}`} target="_blank" rel="noopener noreferrer"
    onClick={(e) => e.stopPropagation()} title={label} aria-label={label}
    className="shrink-0 p-0.5 rounded text-slate-300 hover:text-[#fc4c02] transition-colors">
    <StravaMark className="w-3.5 h-3.5" />
  </a>
);

// FC media coloreada por zona de Karvonen (misma paleta que los parciales).
const HrValue = ({ hr, bounds, t, className = 'text-sm' }) => {
  if (!hr) return <span className={`${className} tabular-nums text-slate-500`}>-</span>;
  const z = bounds ? ZONES[classifyHR(hr, bounds) + 1] : null;
  if (!z) return <span className={`${className} tabular-nums text-slate-500`}>{Math.round(hr)}</span>;
  return (
    <span className={`${className} inline-block px-1.5 py-px rounded font-semibold tabular-nums`}
      style={{ color: z.text, backgroundColor: z.bg }} title={t('activity_log.hr_zone', { zone: z.label })}>
      {Math.round(hr)}
    </span>
  );
};

const RangeInput = ({ value, onChange, placeholder, ring, type = 'number', step }) => (
  <input
    type={type}
    placeholder={placeholder}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    step={step}
    min={type === 'number' ? '0' : undefined}
    className={`w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 ${ring} focus:bg-white transition-all placeholder:text-slate-400 tabular-nums`}
  />
);

const RangeFilter = ({ icon: Icon, tone, title, hint, unit, range, onChange, type, step, placeholders }) => (
  <div className="p-4 space-y-3">
    <div className="flex items-center gap-2.5">
      <div className={`w-7 h-7 rounded-lg ${tone.bg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-3.5 h-3.5 ${tone.icon}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold text-slate-700 leading-none">{title}</p>
        <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>
      </div>
    </div>
    <div className="flex items-center gap-1.5">
      <div className="flex-1"><RangeInput type={type} step={step} ring={tone.ring} placeholder={placeholders[0]} value={range.min} onChange={(v) => onChange({ ...range, min: v })} /></div>
      <div className="w-4 h-px bg-slate-300 shrink-0"></div>
      <div className="flex-1"><RangeInput type={type} step={step} ring={tone.ring} placeholder={placeholders[1]} value={range.max} onChange={(v) => onChange({ ...range, max: v })} /></div>
      <span className="text-[10px] font-medium text-slate-500 shrink-0">{unit}</span>
    </div>
  </div>
);

const TONES = {
  indigo:  { bg: 'bg-indigo-50',  icon: 'text-indigo-600',  ring: 'focus:ring-indigo-500/20 focus:border-indigo-300' },
  rose:    { bg: 'bg-rose-50',    icon: 'text-rose-600',    ring: 'focus:ring-rose-500/20 focus:border-rose-300' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', ring: 'focus:ring-emerald-500/20 focus:border-emerald-300' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sesiones › Bitácora. El registro de entrenamientos: filtros (año, deporte,
// búsqueda y rangos) que acotan a la vez el gráfico de volumen y la lista; cada
// actividad abre su ficha (`/activity/:id`).
//
// El estado de los filtros vive en la URL (`activityLogParams`): al abrir una
// actividad y volver atrás, la lista sigue como estaba.
// ─────────────────────────────────────────────────────────────────────────────

export default function ActivityLog({ activities, runningActivities, hrParams, onOpenActivity }) {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Se lee de la URL al montar y se vuelca a ella en cada cambio. Estado local
  // (y no derivado de la URL en cada render) para que escribir en la búsqueda no
  // dependa de las transiciones del router.
  const [state, setState] = useState(() => readLogState(searchParams));
  const { year: selectedYear, sports: selectedSports, q: searchQuery, sort, dir, dist, elev, pace } = state;
  const update = (patch) => setState(s => ({ ...s, page: 1, ...patch }));

  useEffect(() => {
    const next = writeLogState(state);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [state, searchParams, setSearchParams]);

  const [showFilters, setShowFilters] = useState(false);
  const [selectedChartIndex, setSelectedChartIndex] = useState(0);
  const [chartGroupBy, setChartGroupBy] = useState('month');
  const chartMetrics = ['distance', 'time', 'elevation', 'load'];

  const hrBounds = useMemo(() => {
    const { hrmax, hrrest } = hrParams ?? {};
    return hrmax && hrrest ? karvonenBounds({ hrmax, hrrest }) : null;
  }, [hrParams]);

  // Deportes presentes en el historial, con su nº de actividades, para pintar
  // solo los checks que tienen datos.
  const availableSports = useMemo(() => {
    if (!activities) return [];
    const counts = new Map();
    for (const a of activities) {
      const st = a.sport_type || a.type;
      if (!st) continue;
      counts.set(st, (counts.get(st) || 0) + 1);
    }
    return Array.from(counts, ([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [activities]);

  // Base de la vista: carrera por defecto (`sports === null`), o los deportes
  // marcados. El resto de la app sigue colgando de runningActivities.
  const dashboardActivities = useMemo(() => {
    if (selectedSports === null) return runningActivities;
    if (!activities || !selectedSports.length) return [];
    return activities.filter(a => selectedSports.includes(a.sport_type || a.type));
  }, [selectedSports, runningActivities, activities]);

  const defaultSports = RUNNING_TYPES.filter(type => availableSports.some(s => s.type === type));
  const activeSports = selectedSports ?? defaultSports;

  const toggleSport = (type) => {
    const next = activeSports.includes(type) ? activeSports.filter(x => x !== type) : [...activeSports, type];
    update({ sports: next });
  };

  const availableYears = useMemo(() => {
    const years = new Set(dashboardActivities.map(a => new Date(a.start_date).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [dashboardActivities]);

  const filteredActivities = useMemo(() => {
    if (selectedYear === 'All') return dashboardActivities;
    return dashboardActivities.filter(a => new Date(a.start_date).getFullYear() === parseInt(selectedYear));
  }, [selectedYear, dashboardActivities]);

  // Límites de los rangos, como pista bajo cada filtro.
  const bounds = useMemo(() => {
    const span = (xs, fallback) => xs.length ? [Math.floor(Math.min(...xs)), Math.ceil(Math.max(...xs))] : fallback;
    const paces = filteredActivities.filter(a => a.average_speed > 0).map(a => 1000 / 60 / a.average_speed);
    return {
      dist: span(filteredActivities.map(a => a.distance / 1000), [0, 100]),
      elev: span(filteredActivities.map(a => a.total_elevation_gain || 0), [0, 1000]),
      pace: paces.length
        ? [formatPaceFromMinPerKm(Math.min(...paces)), formatPaceFromMinPerKm(Math.max(...paces))]
        : ['3:00', '10:00'],
    };
  }, [filteredActivities]);

  const activeFilterCount = [dist.min, dist.max, elev.min, elev.max, pace.min, pace.max].filter(v => v !== '').length
    + (selectedSports === null ? 0 : 1);

  const clearFilters = () => update({
    sports: null, dist: { min: '', max: '' }, elev: { min: '', max: '' }, pace: { min: '', max: '' },
  });

  const sortedActivities = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const paceMin = parsePaceToMinutes(pace.min);
    const paceMax = parsePaceToMinutes(pace.max);
    const out = filteredActivities.filter(a => {
      if (q && !a.name.toLowerCase().includes(q)) return false;
      const distKm = a.distance / 1000;
      if (dist.min !== '' && distKm < parseFloat(dist.min)) return false;
      if (dist.max !== '' && distKm > parseFloat(dist.max)) return false;
      const e = a.total_elevation_gain || 0;
      if (elev.min !== '' && e < parseFloat(elev.min)) return false;
      if (elev.max !== '' && e > parseFloat(elev.max)) return false;
      if (paceMin !== null || paceMax !== null) {
        const p = a.average_speed > 0 ? 1000 / 60 / a.average_speed : Infinity;
        if (paceMin !== null && p < paceMin) return false;
        if (paceMax !== null && p > paceMax) return false;
      }
      return true;
    });
    const sign = dir === 'asc' ? 1 : -1;
    return out
      .map(a => [a, sortValue(a, sort)])
      .sort(([, va], [, vb]) => {
        if (va === null || vb === null) return (va === null) - (vb === null);
        return (va - vb) * sign;
      })
      .map(([a]) => a);
  }, [filteredActivities, searchQuery, dist, elev, pace, sort, dir]);

  // Resumen de lo que hay filtrado (sustituye a la antigua fila de KPIs del período).
  const summary = useMemo(() => sortedActivities.reduce((acc, a) => ({
    distance: acc.distance + (a.distance || 0),
    time: acc.time + (movingSecs(a) || 0),
    elevation: acc.elevation + (a.total_elevation_gain || 0),
  }), { distance: 0, time: 0, elevation: 0 }), [sortedActivities]);

  const totalPages = Math.max(1, Math.ceil(sortedActivities.length / ACTIVITIES_PAGE_SIZE));
  const page = Math.min(state.page, totalPages); // una URL vieja puede pedir una página que ya no existe
  const pagedActivities = sortedActivities.slice((page - 1) * ACTIVITIES_PAGE_SIZE, page * ACTIVITIES_PAGE_SIZE);
  const setPage = (p) => setState(s => ({ ...s, page: p }));

  const handleSort = (key) => update({ sort: key, dir: sort === key && dir === 'desc' ? 'asc' : 'desc' });
  const sortIcon = (key) => sort !== key ? '↕' : dir === 'asc' ? '↑' : '↓';

  const locale = i18n.language;
  const fmtNum = (n, digits = 0) => n.toLocaleString(locale, { maximumFractionDigits: digits });
  const formatDate = (d) => new Date(d).toLocaleDateString(locale, { month: '2-digit', day: '2-digit', year: '2-digit' });

  const header = (key, label, { align = 'right', title } = {}) => (
    <TableHeaderCell onClick={() => handleSort(key)} title={title}
      className={`cursor-pointer hover:text-indigo-600 transition-colors px-2 whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}>
      {label} {sortIcon(key)}
    </TableHeaderCell>
  );

  const pillClass = (on) => `px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${on ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;

  return (
    <div className="fade-in space-y-6">
      {/* Totales acumulados del atleta: el contexto del que cuelga el historial. */}
      <GlobalKpiGrid activities={activities} />

      {/* Barra de filtros: acota el gráfico y la lista a la vez. */}
      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
            <p className="text-sm font-semibold text-slate-700">{t('activity_log.activities', { count: sortedActivities.length })}</p>
            <p className="text-xs text-slate-500 tabular-nums">
              {fmtNum(summary.distance / 1000)} km · {formatDurationHm(summary.time)} · +{fmtNum(summary.elevation)} m
            </p>
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold">
                {t('activity_log.active_filters', { count: activeFilterCount })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedYear} onValueChange={(y) => update({ year: y })} enableClear={false}
              className="w-28 shrink-0" aria-label={t('activity_log.year')}>
              <SelectItem value="All">{t('topbar.all_filter')}</SelectItem>
              {availableYears.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </Select>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200
                ${showFilters || activeFilterCount > 0
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300 hover:shadow-sm'
                }`}
            >
              <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
              {t('activity_log.filters')}
            </button>
            <div className="relative flex-1 lg:w-56 lg:flex-none">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder={t('activity_log.search')}
                value={searchQuery}
                onChange={(e) => update({ q: e.target.value })}
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>

        {showFilters && (
          <div className="rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">{t('activity_log.range_filters')}</span>
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors"
                >
                  <XMarkIcon className="w-3 h-3" />
                  {t('activity_log.clear')}
                </button>
              )}
            </div>
            {availableSports.length > 1 && (
              <div className="px-5 py-4 border-b border-slate-100 space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                    <span className="text-xs">🏅</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-slate-700 leading-none">{t('activity_log.sports')}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {selectedSports === null ? t('activity_log.sports_default') : t('activity_log.activities', { count: dashboardActivities.length })}
                    </p>
                  </div>
                  {selectedSports !== null && (
                    <button
                      onClick={() => update({ sports: null })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors shrink-0"
                    >
                      {t('activity_log.reset_default')}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {availableSports.map(({ type, count }) => {
                    const checked = activeSports.includes(type);
                    return (
                      <label
                        key={type}
                        className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer transition-all select-none
                          ${checked
                            ? 'bg-violet-50 border-violet-300 text-violet-700'
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSport(type)}
                          className="w-3 h-3 rounded border-slate-300 text-violet-600 focus:ring-violet-500/30 cursor-pointer"
                        />
                        <span>{activityEmoji(type)}</span>
                        <span>{type}</span>
                        <span className="text-[10px] font-medium opacity-60 tabular-nums">{count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              <RangeFilter icon={MapPinIcon} tone={TONES.indigo} title={t('activity_log.distance')}
                hint={`${bounds.dist[0]} – ${bounds.dist[1]} km`} unit="km" step="0.1"
                placeholders={[t('activity_log.min'), t('activity_log.max')]}
                range={dist} onChange={(r) => update({ dist: r })} />
              <RangeFilter icon={ArrowTrendingUpIcon} tone={TONES.rose} title={t('activity_log.elevation')}
                hint={`${bounds.elev[0]} – ${bounds.elev[1]} m`} unit="m" step="1"
                placeholders={[t('activity_log.min'), t('activity_log.max')]}
                range={elev} onChange={(r) => update({ elev: r })} />
              <RangeFilter icon={BoltIcon} tone={TONES.emerald} title={t('activity_log.pace')} type="text"
                hint={`${bounds.pace[0]} – ${bounds.pace[1]} /km`} unit="/km"
                placeholders={bounds.pace}
                range={pace} onChange={(r) => update({ pace: r })} />
            </div>
          </div>
        )}
      </div>

      {/* Gráfico de volumen */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{t('dashboard.monthly_progress')}</h3>
            <p className="text-[11px] text-slate-500">{t('dashboard.annual_distribution')}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
              {[t('dashboard.distance'), t('dashboard.time'), t('dashboard.elevation'), t('activity_log.load')].map((label, idx) => (
                <button key={chartMetrics[idx]} onClick={() => setSelectedChartIndex(idx)} className={pillClass(selectedChartIndex === idx)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
              <button onClick={() => setChartGroupBy('week')} className={pillClass(chartGroupBy === 'week')}>{t('zones.weekly')}</button>
              <button onClick={() => setChartGroupBy('month')} className={pillClass(chartGroupBy === 'month')}>{t('zones.monthly')}</button>
              <button onClick={() => setChartGroupBy('year')} className={pillClass(chartGroupBy === 'year')}>{t('activity_log.annual')}</button>
            </div>
          </div>
        </div>
        <div className="flex-grow flex flex-col justify-end min-h-[160px]">
          <MonthlyChart activities={sortedActivities} selectedMetric={chartMetrics[selectedChartIndex]} groupBy={chartGroupBy} />
        </div>
      </div>

      <CollapsibleSection title={t('dashboard.activities')}>
        {sortedActivities.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">{t('activity_log.empty')}</p>
        )}

        {/* Móvil: una tarjeta por actividad en vez de 10 columnas con scroll lateral. */}
        <ul className="sm:hidden -mx-2 divide-y divide-slate-100">
          {pagedActivities.map(a => (
            <li key={a.id}>
              <button type="button" onClick={() => onOpenActivity?.(a.id)}
                className="w-full text-left px-2 py-3 rounded-lg active:bg-slate-50 transition-colors">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-semibold text-slate-800 truncate">{a.name}</span>
                  {sportBadge(a)}
                  <span className="ml-auto shrink-0 text-[11px] text-slate-500 tabular-nums">{formatDate(a.start_date)}</span>
                  <StravaLink id={a.id} label={t('activity_log.open_strava')} />
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-600 tabular-nums">
                  <span><span className="font-semibold text-slate-800">{(a.distance / 1000).toFixed(2)}</span> km</span>
                  <span>{formatDurationHm(movingSecs(a))}</span>
                  <span>{formatPaceFromSpeed(a.distance / movingSecs(a))} /km</span>
                  <HrValue hr={a.average_heartrate} bounds={hrBounds} t={t} className="text-xs" />
                  <span className="ml-auto text-slate-500">+{Math.round(a.total_elevation_gain || 0)} m</span>
                </div>
              </button>
            </li>
          ))}
        </ul>

        {/* Escritorio: tabla */}
        <div className="hidden sm:block overflow-x-auto -mx-6 px-6">
          <Table>
            <TableHead>
              <TableRow className="border-b border-slate-100">
                {header('date', t('activity_log.col.date'), { align: 'left' })}
                <TableHeaderCell className="px-2">{t('activity_log.col.name')}</TableHeaderCell>
                {header('distance', t('activity_log.col.distance'))}
                {header('time', t('activity_log.col.time'))}
                {header('pace', t('activity_log.col.pace'))}
                {header('gap', t('activity_log.col.gap'), { title: t('activity_log.col.gap_title') })}
                {header('heartrate', t('activity_log.col.hr'))}
                {header('suffer_score', t('activity_log.col.effort'), { title: t('activity_log.col.effort_title') })}
                {header('elevation', t('activity_log.col.elevation'))}
                {header('gradient', t('activity_log.col.grade'), { title: t('activity_log.col.grade_title') })}
              </TableRow>
            </TableHead>
            <TableBody>
              {pagedActivities.map(activity => {
                const distKm = activity.distance / 1000;
                const rawPaceMinKm = distKm > 0 ? (movingSecs(activity) / 60) / distKm : 0;
                // GAP medido sobre los streams cuando ya está cacheado; si no,
                // la hipótesis de perfil ondulado sobre el D+ de la cabecera.
                const gapSpeedMs = activityGapSpeed(activity);
                const adjustedPace = gapSpeedMs > 0 ? 1000 / (gapSpeedMs * 60) : rawPaceMinKm;
                const hasSignificantAdjustment = Math.abs(rawPaceMinKm - adjustedPace) > 0.05;

                return (
                  <TableRow key={activity.id} onClick={() => onOpenActivity?.(activity.id)} className="group cursor-pointer hover:bg-slate-50/80 transition-colors">
                    <TableCell className="px-2">
                      <span className="text-xs text-slate-500 tabular-nums">{formatDate(activity.start_date)}</span>
                    </TableCell>
                    <TableCell className="px-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenActivity?.(activity.id); }}
                          className="text-left text-sm font-medium text-slate-800 group-hover:text-indigo-600 hover:underline transition-colors truncate max-w-[200px]">
                          {activity.name}
                        </button>
                        {sportBadge(activity)}
                        <StravaLink id={activity.id} label={t('activity_log.open_strava')} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right px-2">
                      <span className="text-sm tabular-nums text-slate-700">{distKm.toFixed(2)}</span>
                    </TableCell>
                    <TableCell className="text-right px-2">
                      <span className="text-sm tabular-nums text-slate-700">{formatDurationHm(movingSecs(activity))}</span>
                    </TableCell>
                    <TableCell className="text-right px-2">
                      <span className="text-sm tabular-nums text-slate-700">{formatPaceFromSpeed(activity.distance / movingSecs(activity))}</span>
                    </TableCell>
                    <TableCell className="text-right px-2">
                      {hasSignificantAdjustment ? (
                        <Badge color="emerald" size="xs">{formatPaceFromMinPerKm(adjustedPace)}</Badge>
                      ) : (
                        <span className="text-sm tabular-nums text-slate-700">{formatPaceFromMinPerKm(adjustedPace)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right px-2">
                      <HrValue hr={activity.average_heartrate} bounds={hrBounds} t={t} />
                    </TableCell>
                    <TableCell className="text-right px-2">
                      {activity.suffer_score ? (
                        <Badge size="xs" color={
                          activity.suffer_score < 20 ? 'slate' :
                            activity.suffer_score < 50 ? 'emerald' :
                              activity.suffer_score < 100 ? 'amber' :
                                activity.suffer_score < 200 ? 'orange' : 'rose'
                        }>
                          {activity.suffer_score}
                        </Badge>
                      ) : <span className="text-sm text-slate-500">-</span>}
                    </TableCell>
                    <TableCell className="text-right px-2">
                      <span className="text-sm tabular-nums text-slate-500">{Math.round(activity.total_elevation_gain || 0)}</span>
                    </TableCell>
                    <TableCell className="text-right px-2">
                      <span className="text-sm tabular-nums text-slate-500">{activity.distance > 0 ? ((activity.total_elevation_gain / activity.distance) * 100).toFixed(1) : '0.0'}%</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
            <span className="text-xs text-slate-500 tabular-nums">
              {(page - 1) * ACTIVITIES_PAGE_SIZE + 1}–{Math.min(page * ACTIVITIES_PAGE_SIZE, sortedActivities.length)} / {sortedActivities.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >‹</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '…' ? (
                    <span key={`e-${i}`} className="px-1 text-xs text-slate-300">…</span>
                  ) : (
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors ${p === page ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                      {p}
                    </button>
                  )
                )
              }
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >›</button>
            </div>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
