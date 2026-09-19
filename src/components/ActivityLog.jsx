import { useState, useMemo, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Select, SelectItem } from '@tremor/react';
import {
  AdjustmentsHorizontalIcon, ArrowTrendingUpIcon, BoltIcon, ChartBarIcon,
  ChevronDownIcon, ChevronRightIcon, ClockIcon, FireIcon, MagnifyingGlassIcon,
  MapPinIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import MonthlyChart from './MonthlyChart';
import ActivitySplits from './ActivitySplits';
import CollapsibleSection from './CollapsibleSection';
import { formatPaceFromSpeed, formatPaceFromMinPerKm } from '../lib/timeFormat';
import { activityGapSpeed } from '../lib/streamGap';
import { activityEmoji } from '../lib/aiInsights';

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

// Stat card component
const STAT_COLORS = {
  indigo: { bg: 'bg-blue-50', text: 'text-blue-600', icon: 'text-blue-500' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600', icon: 'text-violet-500' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-600', icon: 'text-sky-500' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', icon: 'text-emerald-500' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', icon: 'text-amber-500' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600', icon: 'text-rose-500' },
};

const StatCard = ({ label, value, unit, icon: Icon, color = 'indigo' }) => {
  const colors = STAT_COLORS[color] || STAT_COLORS.indigo;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
      <div className={`w-9 h-9 rounded-lg ${colors.bg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-4.5 h-4.5 ${colors.icon}`} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">{label}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-black text-slate-800 tabular-nums leading-none">{value}</span>
          {unit && <span className="text-xs font-medium text-slate-400">{unit}</span>}
        </div>
      </div>
    </div>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// Sesiones › Bitácora. El registro de entrenamientos: filtros por año y deporte,
// totales del período, el gráfico de volumen y la tabla con los parciales.
//
// Vivía dentro de `App.jsx`, que llegó a 1585 líneas siendo a la vez shell,
// navegación, carga de datos, portada y listado. Aquí es una vista más, y el
// filtro de año deja de vivir en la barra superior de TODA la app para vivir
// donde se usa.
// ─────────────────────────────────────────────────────────────────────────────

export default function ActivityLog({ activities, runningActivities, hrParams, onEnrichActivity }) {
  const { t, i18n } = useTranslation();
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [distanceRange, setDistanceRange] = useState({ min: '', max: '' });
  const [elevationRange, setElevationRange] = useState({ min: '', max: '' });
  const [paceRange, setPaceRange] = useState({ min: '', max: '' });
  const [activitiesPage, setActivitiesPage] = useState(1);
  const ACTIVITIES_PAGE_SIZE = 10;
  const [selectedChartIndex, setSelectedChartIndex] = useState(0);
  const [chartGroupBy, setChartGroupBy] = useState('month');
  const chartMetrics = ['distance', 'time', 'elevation', 'load'];
  const [expandedRows, setExpandedRows] = useState(new Set());

  const [selectedYear, setSelectedYear] = useState('All');

  // Selector de deportes del dashboard. `null` = comportamiento por defecto
  // (solo carrera), para no cambiar lo que ve quien no toca el filtro. En cuanto
  // se marca algo pasa a ser una lista explícita de sport_type.
  const [selectedSports, setSelectedSports] = useState(null);

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

  // Base del dashboard (stats + gráfico + tabla): carrera por defecto, o los
  // deportes marcados. El resto de la app sigue colgando de runningActivities.
  const dashboardActivities = useMemo(() => {
    if (selectedSports === null) return runningActivities;
    if (!activities || !selectedSports.length) return [];
    return activities.filter(a => selectedSports.includes(a.sport_type || a.type));
  }, [selectedSports, runningActivities, activities]);

  const toggleSport = (type) => {
    setActivitiesPage(1);
    setSelectedSports(prev => {
      const base = prev === null ? RUNNING_TYPES.filter(t => availableSports.some(s => s.type === t)) : prev;
      const next = base.includes(type) ? base.filter(t => t !== type) : [...base, type];
      return next;
    });
  };

  const resetSports = () => {
    setActivitiesPage(1);
    setSelectedSports(null);
  };

  // Deportes marcados de cara a la UI (con el default expandido a los checks).
  const activeSports = selectedSports === null
    ? RUNNING_TYPES.filter(t => availableSports.some(s => s.type === t))
    : selectedSports;

  const availableYears = useMemo(() => {
    if (!dashboardActivities.length) return [];
    const years = new Set(dashboardActivities.map(a => new Date(a.start_date).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [dashboardActivities]);

  const filteredActivities = useMemo(() => {
    if (selectedYear === 'All') return dashboardActivities;
    return dashboardActivities.filter(a => new Date(a.start_date).getFullYear() === parseInt(selectedYear));
  }, [selectedYear, dashboardActivities]);

  const stats = useMemo(() => {
    // Tiempo EN MOVIMIENTO, no puerta a puerta: es la base sobre la que la app
    // calcula ritmos (average_speed) en el resto de vistas. Mezclarlas hacía que
    // el ritmo del dashboard no cuadrase con el de los parciales de la actividad.
    // El GAP agregado NO se calcula sobre los totales: la hipótesis de perfil
    // ondulado no es lineal, y el D+ sumado de 300 sesiones repartido sobre la
    // distancia sumada no describe ninguna de ellas. Se acumula el tiempo
    // equivalente en llano actividad a actividad, con la misma fuente que usa la
    // tabla de abajo (`activityGapSpeed`: medida por streams si la hay), y el
    // ritmo sale de distancia_total / tiempo_llano_total.
    return filteredActivities.reduce((acc, act) => {
      const v = activityGapSpeed(act);
      const t = act.moving_time || act.elapsed_time;
      return {
        distance: acc.distance + act.distance,
        moving_time: acc.moving_time + t,
        gap_time: acc.gap_time + (v > 0 ? act.distance / v : t),
        elevation_gain: acc.elevation_gain + act.total_elevation_gain,
        count: acc.count + 1
      };
    }, { distance: 0, moving_time: 0, gap_time: 0, elevation_gain: 0, count: 0 });
  }, [filteredActivities]);

  const handleSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
    setActivitiesPage(1);
  };

  // Compute min/max bounds for distance and elevation range filters
  const distanceBounds = useMemo(() => {
    if (!filteredActivities.length) return { min: 0, max: 100 };
    const dists = filteredActivities.map(a => a.distance / 1000);
    return { min: Math.floor(Math.min(...dists)), max: Math.ceil(Math.max(...dists)) };
  }, [filteredActivities]);

  const elevationBounds = useMemo(() => {
    if (!filteredActivities.length) return { min: 0, max: 1000 };
    const elevs = filteredActivities.map(a => a.total_elevation_gain || 0);
    return { min: Math.floor(Math.min(...elevs)), max: Math.ceil(Math.max(...elevs)) };
  }, [filteredActivities]);

  // Pace bounds in min/km (lower = faster)
  const paceBounds = useMemo(() => {
    if (!filteredActivities.length) return { min: '3:00', max: '10:00' };
    const paces = filteredActivities
      .filter(a => a.average_speed > 0)
      .map(a => 16.6667 / a.average_speed); // min/km
    if (!paces.length) return { min: '3:00', max: '10:00' };
    const minPace = Math.min(...paces);
    const maxPace = Math.max(...paces);
    const formatP = (p) => `${Math.floor(p)}:${Math.floor((p % 1) * 60).toString().padStart(2, '0')}`;
    return { min: formatP(minPace), max: formatP(maxPace) };
  }, [filteredActivities]);

  // Helper: parse "M:SS" pace string to decimal minutes
  const parsePaceToMinutes = (paceStr) => {
    if (!paceStr || paceStr === '') return null;
    if (paceStr.includes(':')) {
      const [m, s] = paceStr.split(':').map(Number);
      return m + (s || 0) / 60;
    }
    return parseFloat(paceStr);
  };

  const activeFilterCount = [distanceRange.min, distanceRange.max, elevationRange.min, elevationRange.max, paceRange.min, paceRange.max].filter(v => v !== '').length
    + (selectedSports === null ? 0 : 1);

  const clearFilters = () => {
    setDistanceRange({ min: '', max: '' });
    setElevationRange({ min: '', max: '' });
    setPaceRange({ min: '', max: '' });
    resetSports();
  };

  const sortedActivities = [...filteredActivities]
    .filter(activity => {
      // Text search
      if (searchQuery && !activity.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      // Distance range filter (in km)
      const distKm = activity.distance / 1000;
      if (distanceRange.min !== '' && distKm < parseFloat(distanceRange.min)) return false;
      if (distanceRange.max !== '' && distKm > parseFloat(distanceRange.max)) return false;
      // Elevation range filter (in m)
      const elev = activity.total_elevation_gain || 0;
      if (elevationRange.min !== '' && elev < parseFloat(elevationRange.min)) return false;
      if (elevationRange.max !== '' && elev > parseFloat(elevationRange.max)) return false;
      // Pace range filter (min/km) — note: higher pace value = slower
      if (paceRange.min !== '' || paceRange.max !== '') {
        const paceMinKm = activity.average_speed > 0 ? 16.6667 / activity.average_speed : Infinity;
        const paceMinVal = parsePaceToMinutes(paceRange.min);
        const paceMaxVal = parsePaceToMinutes(paceRange.max);
        if (paceMinVal !== null && paceMinKm < paceMinVal) return false;
        if (paceMaxVal !== null && paceMinKm > paceMaxVal) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let aValue, bValue;
      switch (sortConfig.key) {
        case 'distance':
          aValue = a.distance; bValue = b.distance; break;
        case 'time':
          aValue = a.moving_time || a.elapsed_time; bValue = b.moving_time || b.elapsed_time; break;
        case 'real_pace': {
          const aDist = a.distance / 1000;
          const bDist = b.distance / 1000;
          aValue = aDist > 0 ? ((a.moving_time || a.elapsed_time) / 60) / aDist : 0;
          bValue = bDist > 0 ? ((b.moving_time || b.elapsed_time) / 60) / bDist : 0;
          break;
        }
        case 'elevation':
          aValue = a.total_elevation_gain; bValue = b.total_elevation_gain; break;
        case 'heartrate':
          aValue = a.average_heartrate || 0; bValue = b.average_heartrate || 0; break;
        case 'pace': {
          const aDkm = a.distance / 1000;
          const bDkm = b.distance / 1000;
          aValue = aDkm > 0 ? (a.moving_time || a.elapsed_time) / aDkm : 0;
          bValue = bDkm > 0 ? (b.moving_time || b.elapsed_time) / bDkm : 0;
          break;
        }
        case 'gap': {
          // Ritmo GAP en min/km: misma fuente que la columna que se pinta (medida
          // por streams si la actividad está enriquecida, hipótesis de perfil
          // ondulado si no), para que ordenar y leer no den cifras distintas.
          const gapPace = (x) => {
            const v = activityGapSpeed(x);
            return v > 0 ? 1000 / (v * 60) : 0;
          };
          aValue = gapPace(a); bValue = gapPace(b);
          break;
        }
        case 'suffer_score':
          aValue = a.suffer_score || 0; bValue = b.suffer_score || 0; break;
        case 'gradient':
          aValue = a.distance > 0 ? (a.total_elevation_gain / a.distance) * 100 : 0;
          bValue = b.distance > 0 ? (b.total_elevation_gain / b.distance) * 100 : 0;
          break;
        case 'date':
        default:
          aValue = new Date(a.start_date).getTime();
          bValue = new Date(b.start_date).getTime();
          break;
      }
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

  const activitiesTotalPages = Math.ceil(sortedActivities.length / ACTIVITIES_PAGE_SIZE);
  const pagedActivities = sortedActivities.slice(
    (activitiesPage - 1) * ACTIVITIES_PAGE_SIZE,
    activitiesPage * ACTIVITIES_PAGE_SIZE
  );

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const toggleRow = (id) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
      onEnrichActivity?.(id);
    }
    setExpandedRows(newExpanded);
  };

  return (
    <div className="fade-in space-y-6">
      {/* Mobile year filter */}
      <div className="sm:hidden flex items-center gap-2 px-1">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t('hr_analysis.filters.year')}:</span>
        <Select value={selectedYear} onValueChange={setSelectedYear} enableClear={false} className="w-28">
          <SelectItem value="All">{t('topbar.all_filter')}</SelectItem>
          {availableYears.map(year => (
            <SelectItem key={year} value={String(year)}>{year}</SelectItem>
          ))}
        </Select>
      </div>


      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label={t('dashboard.distance')}
          value={`${Math.round(stats.distance / 1000)}`}
          unit="km"
          icon={MapPinIcon}
          color="indigo"
        />
        <StatCard
          label={t('dashboard.activities')}
          value={stats.count}
          icon={ChartBarIcon}
          color="violet"
        />
        <StatCard
          label={t('dashboard.time')}
          value={`${Math.floor(stats.moving_time / 3600)}`}
          unit="h"
          icon={ClockIcon}
          color="sky"
        />
        <StatCard
          label={t('dashboard.avg_pace')}
          value={formatPaceFromSpeed(stats.distance > 0 ? stats.distance / stats.moving_time : 0)}
          unit="/km"
          icon={BoltIcon}
          color="emerald"
        />
        <StatCard
          label={t('dashboard.gap')}
          value={stats.distance > 0 && stats.gap_time > 0
            ? formatPaceFromSpeed(stats.distance / stats.gap_time)
            : '0:00'}
          unit="/km"
          icon={FireIcon}
          color="amber"
        />
        <StatCard
          label="Elevacion"
          value={`${Math.round(stats.elevation_gain)}`}
          unit="m"
          icon={ArrowTrendingUpIcon}
          color="rose"
        />
      </div>

        {/* Section 3: Progress Chart (full width) */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col">
              {/* Single header row: title + metric pills + group toggle */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">{t('dashboard.monthly_progress')}</h3>
                  <p className="text-[11px] text-slate-400">{t('dashboard.annual_distribution')}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Metric selector */}
                  <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
                    {[
                      { key: 'distance', label: t('dashboard.distance') },
                      { key: 'time',     label: t('dashboard.time')     },
                      { key: 'elevation',label: t('dashboard.elevation')},
                      { key: 'load',     label: i18n.language.startsWith('es') ? 'Carga' : 'Load' },
                    ].map((m, idx) => (
                      <button
                        key={m.key}
                        onClick={() => setSelectedChartIndex(idx)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${selectedChartIndex === idx ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {/* Group-by toggle */}
                  <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
                    <button
                      onClick={() => setChartGroupBy('week')}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${chartGroupBy === 'week' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {t('zones.weekly')}
                    </button>
                    <button
                      onClick={() => setChartGroupBy('month')}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${chartGroupBy === 'month' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {t('zones.monthly')}
                    </button>
                    <button
                      onClick={() => setChartGroupBy('year')}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${chartGroupBy === 'year' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {i18n.language.startsWith('es') ? 'Anual' : 'Annual'}
                    </button>
                  </div>
                </div>
              </div>

          <div className="flex-grow flex flex-col justify-end min-h-[160px]">
            <MonthlyChart activities={sortedActivities} selectedMetric={chartMetrics[selectedChartIndex]} groupBy={chartGroupBy} />
          </div>
        </div>

        <CollapsibleSection title={t('dashboard.activities')}>
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-400 font-medium">{sortedActivities.length} {t('hr_analysis.filters.runs').toLowerCase()}</p>
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold">
                    {activeFilterCount} filtro{activeFilterCount > 1 ? 's' : ''} activo{activeFilterCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200
                    ${showFilters || activeFilterCount > 0
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300 hover:shadow-sm'
                    }`}
                >
                  <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" />
                  Filtros
                </button>
                <div className="relative max-w-[220px] w-full">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Buscar..."
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setActivitiesPage(1); }}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all placeholder:text-slate-400"
                  />
                </div>
              </div>
            </div>

            {/* Range Filters Panel */}
            {showFilters && (
              <div className="rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-white">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Filtros de rango</span>
                  </div>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={clearFilters}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors"
                    >
                      <XMarkIcon className="w-3 h-3" />
                      Limpiar
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
                        <p className="text-[11px] font-bold text-slate-700 leading-none">Deportes</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {selectedSports === null ? 'Solo carrera (por defecto)' : `${dashboardActivities.length} actividades`}
                        </p>
                      </div>
                      {selectedSports !== null && (
                        <button
                          onClick={resetSports}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors shrink-0"
                        >
                          Por defecto
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
                  {/* Distance filter card */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                        <MapPinIcon className="w-3.5 h-3.5 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-slate-700 leading-none">Distancia</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{distanceBounds.min} – {distanceBounds.max} km</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          placeholder="Min"
                          value={distanceRange.min}
                          onChange={(e) => setDistanceRange(prev => ({ ...prev, min: e.target.value }))}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 focus:bg-white transition-all placeholder:text-slate-400 tabular-nums"
                          step="0.1"
                          min="0"
                        />
                      </div>
                      <div className="w-4 h-px bg-slate-300 shrink-0"></div>
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          placeholder="Max"
                          value={distanceRange.max}
                          onChange={(e) => setDistanceRange(prev => ({ ...prev, max: e.target.value }))}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 focus:bg-white transition-all placeholder:text-slate-400 tabular-nums"
                          step="0.1"
                          min="0"
                        />
                      </div>
                      <span className="text-[10px] font-medium text-slate-400 shrink-0">km</span>
                    </div>
                  </div>
                  {/* Elevation filter card */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
                        <ArrowTrendingUpIcon className="w-3.5 h-3.5 text-rose-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-slate-700 leading-none">Desnivel</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{elevationBounds.min} – {elevationBounds.max} m</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          placeholder="Min"
                          value={elevationRange.min}
                          onChange={(e) => setElevationRange(prev => ({ ...prev, min: e.target.value }))}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300 focus:bg-white transition-all placeholder:text-slate-400 tabular-nums"
                          step="1"
                          min="0"
                        />
                      </div>
                      <div className="w-4 h-px bg-slate-300 shrink-0"></div>
                      <div className="flex-1 relative">
                        <input
                          type="number"
                          placeholder="Max"
                          value={elevationRange.max}
                          onChange={(e) => setElevationRange(prev => ({ ...prev, max: e.target.value }))}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300 focus:bg-white transition-all placeholder:text-slate-400 tabular-nums"
                          step="1"
                          min="0"
                        />
                      </div>
                      <span className="text-[10px] font-medium text-slate-400 shrink-0">m</span>
                    </div>
                  </div>
                  {/* Pace filter card */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                        <BoltIcon className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-slate-700 leading-none">Ritmo</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{paceBounds.min} – {paceBounds.max} /km</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder={paceBounds.min}
                          value={paceRange.min}
                          onChange={(e) => setPaceRange(prev => ({ ...prev, min: e.target.value }))}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 focus:bg-white transition-all placeholder:text-slate-400 tabular-nums"
                        />
                      </div>
                      <div className="w-4 h-px bg-slate-300 shrink-0"></div>
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder={paceBounds.max}
                          value={paceRange.max}
                          onChange={(e) => setPaceRange(prev => ({ ...prev, max: e.target.value }))}
                          className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 focus:bg-white transition-all placeholder:text-slate-400 tabular-nums"
                        />
                      </div>
                      <span className="text-[10px] font-medium text-slate-400 shrink-0">/km</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="overflow-x-auto -mx-6 px-6">
            <Table>
              <TableHead>
                <TableRow className="border-b border-slate-100">
                  <TableHeaderCell className="w-8 px-2"></TableHeaderCell>
                  <TableHeaderCell onClick={() => handleSort('date')} className="cursor-pointer hover:text-indigo-600 transition-colors px-2 whitespace-nowrap">
                    Fecha {getSortIcon('date')}
                  </TableHeaderCell>
                  <TableHeaderCell className="px-2">Nombre</TableHeaderCell>
                  <TableHeaderCell onClick={() => handleSort('distance')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors px-2 whitespace-nowrap">
                    Dist {getSortIcon('distance')}
                  </TableHeaderCell>
                  <TableHeaderCell onClick={() => handleSort('time')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors px-2 whitespace-nowrap">
                    Tiempo {getSortIcon('time')}
                  </TableHeaderCell>
                  <TableHeaderCell onClick={() => handleSort('pace')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors px-2 whitespace-nowrap">
                    Ritmo {getSortIcon('pace')}
                  </TableHeaderCell>
                  <TableHeaderCell onClick={() => handleSort('gap')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors px-2 whitespace-nowrap" title="Grade Adjusted Pace">
                    GAP {getSortIcon('gap')}
                  </TableHeaderCell>
                  <TableHeaderCell onClick={() => handleSort('heartrate')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors px-2 whitespace-nowrap">
                    FC {getSortIcon('heartrate')}
                  </TableHeaderCell>
                  <TableHeaderCell onClick={() => handleSort('suffer_score')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors px-2 whitespace-nowrap" title="Esfuerzo Relativo">
                    Esfuerzo {getSortIcon('suffer_score')}
                  </TableHeaderCell>
                  <TableHeaderCell onClick={() => handleSort('elevation')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors px-2 whitespace-nowrap">
                    Elev. {getSortIcon('elevation')}
                  </TableHeaderCell>
                  <TableHeaderCell onClick={() => handleSort('gradient')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors px-2 whitespace-nowrap">
                    % {getSortIcon('gradient')}
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pagedActivities.map(activity => {
                  const distKm = activity.distance / 1000;
                  const movingSecs = activity.moving_time || activity.elapsed_time;
                  const rawPaceMinKm = distKm > 0 ? (movingSecs / 60) / distKm : 0;
                  // GAP medido sobre los streams cuando ya está cacheado; si no,
                  // la hipótesis de perfil ondulado sobre el D+ de la cabecera.
                  const gapSpeedMs = activityGapSpeed(activity);
                  const adjustedPace = gapSpeedMs > 0 ? 1000 / (gapSpeedMs * 60) : rawPaceMinKm;
                  const hasSignificantAdjustment = Math.abs(rawPaceMinKm - adjustedPace) > 0.05;

                  return (
                    <Fragment key={activity.id}>
                      <TableRow className="group hover:bg-slate-50/80 transition-colors">
                        <TableCell className="p-0 pl-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleRow(activity.id); }}
                            className="p-1 rounded text-slate-300 hover:text-indigo-600 transition-colors"
                            title="Ver parciales"
                          >
                            {expandedRows.has(activity.id) ? (
                              <ChevronDownIcon className="w-4 h-4" />
                            ) : (
                              <ChevronRightIcon className="w-4 h-4" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-slate-500 tabular-nums">{new Date(activity.start_date).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' })}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <a href={`https://www.strava.com/activities/${activity.id}`} target="_blank" rel="noopener noreferrer"
                              className="text-sm font-medium text-slate-800 hover:text-indigo-600 transition-colors truncate max-w-[160px]">
                              {activity.name}
                            </a>
                            {(() => {
                              const st = activity.sport_type || activity.type;
                              const isRace = activity.workout_type === 1;
                              if (isRace) return <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold tracking-wide bg-amber-400 text-white uppercase">Race</span>;
                              if (st === 'TrailRun') return <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold tracking-wide bg-emerald-500 text-white uppercase">Trail</span>;
                              // Con varios deportes en la tabla hace falta distinguirlos de un vistazo.
                              if (!RUNNING_TYPES.includes(st)) return <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold tracking-wide bg-violet-500 text-white uppercase">{activityEmoji(st)} {st}</span>;
                              return null;
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm tabular-nums text-slate-700">{(activity.distance / 1000).toFixed(2)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm tabular-nums text-slate-700">{Math.floor((activity.moving_time || activity.elapsed_time) / 60)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm tabular-nums text-slate-700">{formatPaceFromSpeed(activity.distance / (activity.moving_time || activity.elapsed_time))}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {hasSignificantAdjustment ? (
                            <Badge color="emerald" size="xs">{formatPaceFromMinPerKm(adjustedPace)}</Badge>
                          ) : (
                            <span className="text-sm tabular-nums text-slate-700">{formatPaceFromMinPerKm(adjustedPace)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm tabular-nums text-slate-500">{activity.average_heartrate ? Math.round(activity.average_heartrate) : '-'}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {activity.suffer_score ? (
                            <Badge size="xs" color={
                              activity.suffer_score < 20 ? 'slate' :
                                activity.suffer_score < 50 ? 'emerald' :
                                  activity.suffer_score < 100 ? 'amber' :
                                    activity.suffer_score < 200 ? 'orange' : 'rose'
                            }>
                              {activity.suffer_score}
                            </Badge>
                          ) : <span className="text-sm text-slate-400">-</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm tabular-nums text-slate-500">{Math.round(activity.total_elevation_gain)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm tabular-nums text-slate-500">{activity.distance > 0 ? ((activity.total_elevation_gain / activity.distance) * 100).toFixed(1) : '0.0'}%</span>
                        </TableCell>
                      </TableRow>
                      {expandedRows.has(activity.id) && (
                        <TableRow>
                          <TableCell colSpan={12} className="!p-0">
                            <div className="bg-slate-50/70 border-y border-slate-100 px-4 py-3">
                              <ActivitySplits
                                splits={activity.laps}
                                hrParams={hrParams}
                                bestEfforts={activity.best_efforts}
                                similarActivities={activity.similar_activities}
                                splitsMetric={activity.splits_metric}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            {/* Pagination */}
            {activitiesTotalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                <span className="text-xs text-slate-400">
                  {(activitiesPage - 1) * ACTIVITIES_PAGE_SIZE + 1}–{Math.min(activitiesPage * ACTIVITIES_PAGE_SIZE, sortedActivities.length)} / {sortedActivities.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setActivitiesPage(p => Math.max(1, p - 1))}
                    disabled={activitiesPage === 1}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >‹</button>
                  {Array.from({ length: activitiesTotalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === activitiesTotalPages || Math.abs(p - activitiesPage) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) =>
                      p === '…' ? (
                        <span key={`e-${i}`} className="px-1 text-xs text-slate-300">…</span>
                      ) : (
                        <button key={p} onClick={() => setActivitiesPage(p)}
                          className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors ${p === activitiesPage ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                          {p}
                        </button>
                      )
                    )
                  }
                  <button
                    onClick={() => setActivitiesPage(p => Math.min(activitiesTotalPages, p + 1))}
                    disabled={activitiesPage === activitiesTotalPages}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >›</button>
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
    </div>
  );
}
