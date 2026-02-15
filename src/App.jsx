import { GoogleLogin } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { useEffect, useState, useMemo, Fragment } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import './App.css';
import StravaCallback from './components/StravaCallback';
import MonthlyChart from './components/MonthlyChart';
import PersonalBests from './components/PersonalBests';
import TrainingPlanner from './components/TrainingPlanner';
import RacePredictor from './components/RacePredictor';
import RunQA from './components/RunQA';
import DataExporter from './components/DataExporter';
import Logo from './components/Logo';
import CollapsibleSection from './components/CollapsibleSection';
import LandingPage from './components/LandingPage';
import ActivitySplits from './components/ActivitySplits';
import { getActivities, getActivity, getStravaAuthUrl, refreshAccessToken } from './services/strava';
import { Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Select, SelectItem, TextInput, TabGroup, TabList, Tab } from "@tremor/react";
import {
  ArrowPathIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  Squares2X2Icon,
  SparklesIcon,
  ArrowTrendingUpIcon,
  ChatBubbleLeftRightIcon,
  ArrowDownTrayIcon,
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
  MagnifyingGlassIcon,
  BoltIcon,
  ClockIcon,
  FireIcon,
  MapPinIcon,
  ChartBarIcon,
  HeartIcon,
} from "@heroicons/react/24/outline";

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Squares2X2Icon },
  { id: 'planner', label: 'Entrenador AI', icon: SparklesIcon },
  { id: 'predictor', label: 'Predictor AI', icon: ArrowTrendingUpIcon },
  { id: 'qa', label: 'Preguntas AI', icon: ChatBubbleLeftRightIcon },
  { id: 'export', label: 'Exportar', icon: ArrowDownTrayIcon },
];

const Dashboard = ({ user, handleLogout }) => {
  const [stravaData, setStravaData] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedChartIndex, setSelectedChartIndex] = useState(0);
  const chartMetrics = ['distance', 'time', 'elevation'];
  const [expandedRows, setExpandedRows] = useState(new Set());

  const handleFetchDetails = async (activityId) => {
    if (!stravaData || !stravaData.activities) return;
    const activityIndex = stravaData.activities.findIndex(a => a.id === activityId);
    if (activityIndex === -1) return;
    if (stravaData.activities[activityIndex].splits_metric) return;

    try {
      const accessToken = stravaData.accessToken;
      const detailedActivity = await getActivity(accessToken, activityId);
      const updatedActivities = [...stravaData.activities];
      updatedActivities[activityIndex] = detailedActivity;
      const updatedData = { ...stravaData, activities: updatedActivities };
      setStravaData(updatedData);
      localStorage.setItem('stravaData', JSON.stringify(updatedData));
    } catch (err) {
      console.error("Failed to fetch activity details", err);
    }
  };

  const toggleRow = (id) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
      handleFetchDetails(id);
    }
    setExpandedRows(newExpanded);
  };

  const [isSyncing, setIsSyncing] = useState(false);

  const syncData = async () => {
    if (!stravaData) return;
    setIsSyncing(true);
    try {
      let currentData = { ...stravaData };
      const now = Date.now() / 1000;
      let accessToken = currentData.accessToken;

      if (currentData.expiresAt && now >= currentData.expiresAt) {
        if (currentData.refreshToken) {
          const newTokens = await refreshAccessToken(currentData.refreshToken);
          currentData.accessToken = newTokens.access_token;
          currentData.refreshToken = newTokens.refresh_token;
          currentData.expiresAt = newTokens.expires_at;
          accessToken = newTokens.access_token;
          localStorage.setItem('stravaData', JSON.stringify(currentData));
        }
      }

      const activities = await getActivities(accessToken, 1000);
      const updated = {
        ...currentData,
        activities,
        lastFetchDate: new Date().toDateString()
      };
      setStravaData(updated);
      localStorage.setItem('stravaData', JSON.stringify(updated));
    } catch (err) {
      console.error("Sync failed", err);
      if (err.message.includes('401') || err.message.includes('refresh')) {
        setStravaData(null);
        localStorage.removeItem('stravaData');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const savedStrava = localStorage.getItem('stravaData');
    if (savedStrava) {
      const parsed = JSON.parse(savedStrava);
      setStravaData(parsed);

      const checkAndRefreshData = async () => {
        try {
          const now = Date.now() / 1000;
          let accessToken = parsed.accessToken;
          let needsRefresh = false;

          if (parsed.expiresAt && now >= parsed.expiresAt) {
            if (parsed.refreshToken) {
              const newTokens = await refreshAccessToken(parsed.refreshToken);
              parsed.accessToken = newTokens.access_token;
              parsed.refreshToken = newTokens.refresh_token;
              parsed.expiresAt = newTokens.expires_at;
              accessToken = newTokens.access_token;

              const updatedTokens = {
                ...parsed,
                accessToken: newTokens.access_token,
                refreshToken: newTokens.refresh_token,
                expiresAt: newTokens.expires_at
              };
              setStravaData(updatedTokens);
              localStorage.setItem('stravaData', JSON.stringify(updatedTokens));
              needsRefresh = true;
            } else {
              setStravaData(null);
              localStorage.removeItem('stravaData');
              return;
            }
          }

          const lastFetchDate = parsed.lastFetchDate;
          const today = new Date().toDateString();

          if (!lastFetchDate || lastFetchDate !== today || needsRefresh) {
            const activities = await getActivities(accessToken, 1000);
            const updated = { ...parsed, activities, lastFetchDate: today };
            setStravaData(updated);
            localStorage.setItem('stravaData', JSON.stringify(updated));
          }
        } catch (err) {
          console.error("Failed to refresh Strava data:", err);
          if (err.message.includes('refresh') || err.message.includes('401')) {
            setStravaData(null);
            localStorage.removeItem('stravaData');
          }
        }
      };

      checkAndRefreshData();
    }
  }, []);

  const connectToStrava = () => {
    window.location.href = getStravaAuthUrl();
  };

  const calculatePace = (speed) => {
    if (!speed || speed === 0) return '0:00';
    const pace = 16.6667 / speed;
    const minutes = Math.floor(pace);
    const seconds = Math.floor((pace - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

  const runningActivities = stravaData?.activities ?
    stravaData.activities.filter(activity => RUNNING_TYPES.includes(activity.type) || RUNNING_TYPES.includes(activity.sport_type))
    : [];

  const [selectedYear, setSelectedYear] = useState('All');

  const availableYears = useMemo(() => {
    if (!runningActivities.length) return [];
    const years = new Set(runningActivities.map(a => new Date(a.start_date).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [runningActivities]);

  const filteredActivities = useMemo(() => {
    if (selectedYear === 'All') return runningActivities;
    return runningActivities.filter(a => new Date(a.start_date).getFullYear() === parseInt(selectedYear));
  }, [selectedYear, runningActivities]);

  const stats = useMemo(() => {
    return filteredActivities.reduce((acc, act) => ({
      distance: acc.distance + act.distance,
      moving_time: acc.moving_time + act.moving_time,
      elevation_gain: acc.elevation_gain + act.total_elevation_gain,
      count: acc.count + 1
    }), { distance: 0, moving_time: 0, elevation_gain: 0, count: 0 });
  }, [filteredActivities]);

  const handleSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const sortedActivities = [...filteredActivities]
    .filter(activity => activity.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      let aValue, bValue;
      switch (sortConfig.key) {
        case 'distance':
          aValue = a.distance; bValue = b.distance; break;
        case 'time':
          aValue = a.moving_time; bValue = b.moving_time; break;
        case 'real_pace': {
          const aDist = a.distance / 1000;
          const bDist = b.distance / 1000;
          aValue = aDist > 0 ? (a.elapsed_time / 60) / aDist : 0;
          bValue = bDist > 0 ? (b.elapsed_time / 60) / bDist : 0;
          break;
        }
        case 'elevation':
          aValue = a.total_elevation_gain; bValue = b.total_elevation_gain; break;
        case 'heartrate':
          aValue = a.average_heartrate || 0; bValue = b.average_heartrate || 0; break;
        case 'pace':
          aValue = a.average_speed; bValue = b.average_speed; break;
        case 'gap': {
          const aDistKm = a.distance / 1000;
          const bDistKm = b.distance / 1000;
          const aElevPerKm = aDistKm > 0 ? (a.total_elevation_gain || 0) / aDistKm : 0;
          const bElevPerKm = bDistKm > 0 ? (b.total_elevation_gain || 0) / bDistKm : 0;
          const aRawPace = (a.moving_time / 60) / aDistKm;
          const bRawPace = (b.moving_time / 60) / bDistKm;
          aValue = Math.max(aRawPace - ((aElevPerKm / 10) * 8 / 60), aRawPace * 0.80);
          bValue = Math.max(bRawPace - ((bElevPerKm / 10) * 8 / 60), bRawPace * 0.80);
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

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const currentNavItem = NAV_ITEMS.find(item => item.id === currentView);
  const pageTitle = currentNavItem?.label || 'Dashboard';

  // Sidebar component
  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 shrink-0">
        <Logo />
        <span className="font-bold text-[15px] tracking-tight text-slate-900">RunAnalyzer</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        <p className="px-3 pt-3 pb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Menu</p>
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => { setCurrentView(item.id); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 group
                ${isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
            >
              <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
              {item.label}
              {item.id !== 'dashboard' && item.id !== 'export' && (
                <span className={`ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>AI</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User section */}
      <div className="shrink-0 border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors">
          <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full bg-slate-200 ring-1 ring-slate-100" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 truncate">{user.name}</p>
            <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full mt-1 flex items-center gap-2.5 px-4 py-2 rounded-lg text-[13px] font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
        >
          <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
          Cerrar Sesion
        </button>
      </div>
    </>
  );

  if (!stravaData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
            <div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <BoltIcon className="w-7 h-7 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Conecta Strava</h2>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">Vincula tu cuenta para visualizar y analizar tu rendimiento.</p>
            <button
              onClick={connectToStrava}
              className="w-full py-3 px-6 bg-[#fc4c02] hover:bg-[#e34402] text-white text-sm font-bold rounded-xl transition-colors"
            >
              Conectar con Strava
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-[260px] bg-white border-r border-slate-200/80 shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="sidebar-overlay fixed inset-0" onClick={() => setMobileMenuOpen(false)} />
          <aside className="sidebar-enter fixed inset-y-0 left-0 w-[280px] bg-white shadow-2xl flex flex-col z-50">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200/80 flex items-center px-4 lg:px-8 shrink-0 gap-4">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden p-1.5 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <Bars3Icon className="w-5 h-5" />
          </button>

          <h1 className="text-[15px] font-semibold text-slate-800">{pageTitle}</h1>

          <div className="flex-1" />

          {currentView === 'dashboard' && (
            <div className="flex items-center gap-2">
              <button
                onClick={syncData}
                disabled={isSyncing}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border
                  ${isSyncing
                    ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300'
                  }`}
              >
                <ArrowPathIcon className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Sincronizando...' : 'Sincronizar'}
              </button>

              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Ano</span>
                <Select value={selectedYear} onValueChange={setSelectedYear} enableClear={false} className="w-24 min-w-[90px] [&>button]:!border-0 [&>button]:!shadow-none [&>button]:!ring-0 [&>button]:!py-0 [&>button]:!px-1 [&>button]:!text-xs [&>button]:!font-semibold">
                  <SelectItem value="All">Todos</SelectItem>
                  {availableYears.map(year => (
                    <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                  ))}
                </Select>
              </div>
            </div>
          )}
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto p-4 lg:p-8 space-y-6">

            {currentView === 'dashboard' && (
              <div className="fade-in space-y-6">

                {/* Mobile year filter */}
                <div className="sm:hidden flex items-center gap-2 px-1">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Ano:</span>
                  <Select value={selectedYear} onValueChange={setSelectedYear} enableClear={false} className="w-28">
                    <SelectItem value="All">Todos</SelectItem>
                    {availableYears.map(year => (
                      <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                    ))}
                  </Select>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <StatCard
                    label="Distancia"
                    value={`${Math.round(stats.distance / 1000)}`}
                    unit="km"
                    icon={MapPinIcon}
                    color="indigo"
                  />
                  <StatCard
                    label="Actividades"
                    value={stats.count}
                    icon={ChartBarIcon}
                    color="violet"
                  />
                  <StatCard
                    label="Tiempo"
                    value={`${Math.floor(stats.moving_time / 3600)}`}
                    unit="h"
                    icon={ClockIcon}
                    color="sky"
                  />
                  <StatCard
                    label="Ritmo Medio"
                    value={calculatePace(stats.distance > 0 ? stats.distance / stats.moving_time : 0)}
                    unit="/km"
                    icon={BoltIcon}
                    color="emerald"
                  />
                  <StatCard
                    label="GAP"
                    value={(() => {
                      const d = stats.distance / 1000;
                      if (d <= 0) return '0:00';
                      const p = (stats.moving_time / 60) / d;
                      const e = stats.elevation_gain / d;
                      const g = Math.max(p - ((e / 10) * 8 / 60), p * 0.8);
                      const m = Math.floor(g);
                      const s = Math.round((g - m) * 60);
                      return `${m}:${s.toString().padStart(2, '0')}`;
                    })()}
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

                {stravaData.activities && stravaData.activities.length > 0 && (
                  <div className="space-y-6">
                    <CollapsibleSection title="Mejores Marcas">
                      <PersonalBests activities={filteredActivities} />
                    </CollapsibleSection>

                    <CollapsibleSection title="Progreso Mensual">
                      <TabGroup index={selectedChartIndex} onIndexChange={setSelectedChartIndex}>
                        <TabList variant="solid" className="mb-4 w-fit">
                          <Tab>Distancia</Tab>
                          <Tab>Tiempo</Tab>
                          <Tab>Desnivel</Tab>
                        </TabList>
                        <MonthlyChart activities={sortedActivities} selectedMetric={chartMetrics[selectedChartIndex]} />
                      </TabGroup>
                    </CollapsibleSection>

                    <CollapsibleSection title="Actividades">
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <p className="text-xs text-slate-400 font-medium">{sortedActivities.length} carreras</p>
                        <div className="relative max-w-[240px] w-full">
                          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Buscar..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition-all placeholder:text-slate-400"
                          />
                        </div>
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
                              <TableHeaderCell onClick={() => handleSort('real_pace')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors px-2 whitespace-nowrap">
                                R. Real {getSortIcon('real_pace')}
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
                            {sortedActivities.map(activity => {
                              const distKm = activity.distance / 1000;
                              const elevPerKm = distKm > 0 ? (activity.total_elevation_gain || 0) / distKm : 0;
                              const rawPaceMinKm = (activity.moving_time / 60) / distKm;
                              const gapAdjustmentSeconds = (elevPerKm / 10) * 8;
                              const gapAdjustment = gapAdjustmentSeconds / 60;
                              const adjustedPace = Math.max(rawPaceMinKm - gapAdjustment, rawPaceMinKm * 0.80);
                              const hasSignificantAdjustment = Math.abs(rawPaceMinKm - adjustedPace) > 0.05;

                              const formatPace = (paceMinKm) => {
                                const minutes = Math.floor(paceMinKm);
                                const seconds = Math.round((paceMinKm % 1) * 60);
                                return `${minutes}:${seconds.toString().padStart(2, '0')}`;
                              };

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
                                      <a href={`https://www.strava.com/activities/${activity.id}`} target="_blank" rel="noopener noreferrer"
                                        className="text-sm font-medium text-slate-800 hover:text-indigo-600 transition-colors truncate max-w-[180px] block">
                                        {activity.name}
                                      </a>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <span className="text-sm tabular-nums text-slate-700">{(activity.distance / 1000).toFixed(2)}</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <span className="text-sm tabular-nums text-slate-700">{Math.floor(activity.moving_time / 60)}</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <span className="text-sm tabular-nums text-slate-700">{calculatePace(activity.distance / activity.elapsed_time)}</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <span className="text-sm tabular-nums text-slate-700">{calculatePace(activity.average_speed)}</span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {hasSignificantAdjustment ? (
                                        <Badge color="emerald" size="xs">{formatPace(adjustedPace)}</Badge>
                                      ) : (
                                        <span className="text-sm tabular-nums text-slate-700">{formatPace(adjustedPace)}</span>
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
                                          <ActivitySplits splits={activity.splits_metric} />
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </Fragment>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleSection>
                  </div>
                )}
              </div>
            )}

            {currentView === 'planner' && (
              <div className="fade-in">
                <TrainingPlanner activities={runningActivities} />
              </div>
            )}

            {currentView === 'predictor' && (
              <div className="fade-in">
                <RacePredictor activities={runningActivities} />
              </div>
            )}

            {currentView === 'qa' && (
              <div className="fade-in">
                <RunQA activities={runningActivities} />
              </div>
            )}

            {currentView === 'export' && (
              <div className="fade-in">
                <DataExporter activities={runningActivities} onEnrichActivity={handleFetchDetails} />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

// Stat card component
const STAT_COLORS = {
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', icon: 'text-indigo-500' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600', icon: 'text-violet-500' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-600', icon: 'text-sky-500' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', icon: 'text-emerald-500' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', icon: 'text-amber-500' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600', icon: 'text-rose-500' },
};

const StatCard = ({ label, value, unit, icon: Icon, color = 'indigo' }) => {
  const colors = STAT_COLORS[color] || STAT_COLORS.indigo;
  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-4 hover:shadow-md hover:border-slate-300/80 transition-all duration-200 group">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <div className={`w-7 h-7 rounded-lg ${colors.bg} flex items-center justify-center`}>
          <Icon className={`w-3.5 h-3.5 ${colors.icon}`} />
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{value}</span>
        {unit && <span className="text-xs font-medium text-slate-400">{unit}</span>}
      </div>
    </div>
  );
};

function App() {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const navigate = useNavigate();

  const handleLoginSuccess = (credentialResponse) => {
    try {
      const decoded = jwtDecode(credentialResponse.credential);
      setUser(decoded);
      localStorage.setItem('user', JSON.stringify(decoded));
    } catch (error) {
      console.error('Token decoding failed', error);
    }
  };

  const handleLoginError = () => {
    console.log('Login Failed');
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('stravaData');
    navigate('/');
  };

  const handleStravaConnected = (data) => {
    const dataWithDate = { ...data, lastFetchDate: new Date().toDateString() };
    localStorage.setItem('stravaData', JSON.stringify(dataWithDate));
    navigate('/');
    window.location.reload();
  };

  return (
    <Routes>
      <Route path="/strava-callback" element={
        <StravaCallback onConnect={handleStravaConnected} />
      } />
      <Route path="/" element={
        !user ? (
          <LandingPage onLoginSuccess={handleLoginSuccess} onLoginError={handleLoginError} />
        ) : (
          <Dashboard user={user} handleLogout={handleLogout} />
        )
      } />
    </Routes>
  );
}

export default App;
