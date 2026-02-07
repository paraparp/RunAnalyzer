import { GoogleLogin } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { useEffect, useState, useMemo } from 'react';
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
import { getActivities, getStravaAuthUrl } from './services/strava';
import { Card, Grid, Metric, Text, Flex, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Select, SelectItem, TextInput, Title, Button, TabGroup, TabList, Tab, TabPanels, TabPanel } from "@tremor/react";

const Dashboard = ({ user, handleLogout }) => {
  const [stravaData, setStravaData] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard', 'planner', 'predictor', 'qa', 'export'
  const [selectedChartIndex, setSelectedChartIndex] = useState(0); // 0: distance, 1: time, 2: elevation
  const chartMetrics = ['distance', 'time', 'elevation'];


  useEffect(() => {
    // Check if we have saved Strava data
    const savedStrava = localStorage.getItem('stravaData');
    if (savedStrava) {
      const parsed = JSON.parse(savedStrava);
      setStravaData(parsed);

      // Update data in background to ensure we have up to 1000 activities
      if (parsed.accessToken) {
        getActivities(parsed.accessToken, 1000).then(activities => {
          const updated = { ...parsed, activities };
          // Only update if data changed (naive check by length or id for performance, but straightforward set is simpler for now)
          if (JSON.stringify(updated.activities) !== JSON.stringify(parsed.activities)) {
            setStravaData(updated);
            localStorage.setItem('stravaData', JSON.stringify(updated));
          }
        }).catch(err => {
          console.error("Failed to refresh activities", err);
        });
      }
    }
  }, []);

  const handleStravaConnect = (data) => {
    setStravaData(data);
    localStorage.setItem('stravaData', JSON.stringify(data));
  };

  const connectToStrava = () => {
    window.location.href = getStravaAuthUrl();
  };

  const calculatePace = (speed) => {
    if (!speed || speed === 0) return '0:00';
    const pace = 16.6667 / speed; // min/km
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
          aValue = a.distance;
          bValue = b.distance;
          break;
        case 'time':
          aValue = a.moving_time;
          bValue = b.moving_time;
          break;
        case 'elevation':
          aValue = a.total_elevation_gain;
          bValue = b.total_elevation_gain;
          break;
        case 'pace':
          aValue = a.average_speed;
          bValue = b.average_speed;
          break;
        case 'gap':
          // Calculate GAP for sorting
          const aDistKm = a.distance / 1000;
          const bDistKm = b.distance / 1000;
          const aElevPerKm = aDistKm > 0 ? (a.total_elevation_gain || 0) / aDistKm : 0;
          const bElevPerKm = bDistKm > 0 ? (b.total_elevation_gain || 0) / bDistKm : 0;
          const aRawPace = (a.moving_time / 60) / aDistKm;
          const bRawPace = (b.moving_time / 60) / bDistKm;
          const aGapAdj = (aElevPerKm / 10) * 8 / 60;
          const bGapAdj = (bElevPerKm / 10) * 8 / 60;
          aValue = Math.max(aRawPace - aGapAdj, aRawPace * 0.80);
          bValue = Math.max(bRawPace - bGapAdj, bRawPace * 0.80);
          break;
        case 'date':
        default:
          aValue = new Date(a.start_date).getTime();
          bValue = new Date(b.start_date).getTime();
          break;
        case 'gradient':
          aValue = a.distance > 0 ? (a.total_elevation_gain / a.distance) * 100 : 0;
          bValue = b.distance > 0 ? (b.total_elevation_gain / b.distance) * 100 : 0;
          break;
      }

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };



  return (
    <div className="dashboard">
      <header className="sticky top-4 z-50 mb-8">
        <Card className="p-3 ring-1 ring-slate-200 shadow-sm bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3 pl-2">
              <Logo />
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600 tracking-tight">RunAnalyzer</h1>
            </div>

            <button className="md:hidden text-2xl p-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle menu">
              {mobileMenuOpen ? '✕' : '☰'}
            </button>

            <nav className={`${mobileMenuOpen ? 'flex' : 'hidden'} md:flex absolute md:relative top-full left-0 right-0 md:top-auto bg-white md:bg-transparent flex-col md:flex-row p-4 md:p-0 gap-1 md:gap-2 shadow-xl md:shadow-none border-b md:border-0 border-slate-200 md:bg-none z-40 rounded-b-xl md:rounded-none mt-2 md:mt-0 ring-1 md:ring-0 ring-slate-200`}>
              <button
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${currentView === 'dashboard' ? 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200 shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
                onClick={() => { setCurrentView('dashboard'); setMobileMenuOpen(false); }}
              >
                Dashboard
              </button>
              <button
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${currentView === 'planner' ? 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200 shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
                onClick={() => { setCurrentView('planner'); setMobileMenuOpen(false); }}
              >
                Entrenador AI
              </button>
              <button
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${currentView === 'predictor' ? 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200 shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
                onClick={() => { setCurrentView('predictor'); setMobileMenuOpen(false); }}
              >
                Predictor AI
              </button>
              <button
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${currentView === 'qa' ? 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200 shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
                onClick={() => { setCurrentView('qa'); setMobileMenuOpen(false); }}
              >
                Preguntas AI
              </button>
              <button
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${currentView === 'export' ? 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200 shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
                onClick={() => { setCurrentView('export'); setMobileMenuOpen(false); }}
              >
                Exportar
              </button>
            </nav>

            <div className="relative pr-2">
              <button onClick={() => setShowUserMenu(!showUserMenu)} className="block rounded-full ring-2 ring-transparent hover:ring-indigo-100 transition-all p-0.5 focus:outline-none focus:ring-indigo-200">
                <img src={user.picture} alt={user.name} className="w-9 h-9 rounded-full bg-slate-200 block border border-slate-100" />
              </button>

              {showUserMenu && (
                <div className="absolute top-12 right-0 w-64 bg-white ring-1 ring-slate-200 rounded-xl shadow-xl p-2 z-50 animate-in fade-in zoom-in duration-200">
                  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg mb-2">
                    <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full bg-slate-200" />
                    <div className="overflow-hidden min-w-0">
                      <h4 className="font-bold text-sm truncate text-slate-900">{user.name}</h4>
                      <p className="text-xs text-slate-500 truncate">{user.email}</p>
                    </div>
                  </div>
                  <button onClick={handleLogout} className="w-full text-left px-4 py-2 rounded-lg text-sm font-medium text-rose-600 hover:bg-rose-50 transition-colors flex items-center gap-2">
                    <span>🚪</span> Cerrar Sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      </header>


      <div className="content-container">
        {!stravaData ? (
          <div className="flex justify-center items-center h-[50vh]">
            <Card className="max-w-md mx-auto p-8 text-center ring-1 ring-slate-200 shadow-lg">
              <Title className="text-2xl mb-2 text-indigo-600">Conecta tus estadísticas</Title>
              <Text className="text-slate-600 mb-6">Vincula tu cuenta de Strava para visualizar y analizar tu rendimiento de manera profesional.</Text>
              <Button size="xl" onClick={connectToStrava} className="w-full font-bold bg-[#fc4c02] hover:bg-[#e34402] border-none text-white">
                Conectar con Strava
              </Button>
            </Card>
          </div>
        ) : (
          <>
            {currentView === 'dashboard' && (
              <div className="dashboard-view fade-in">

                <div className="flex justify-end items-center gap-3 mb-6">
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg ring-1 ring-slate-200 shadow-sm">
                    <Text className="font-semibold text-slate-600 text-sm">Año:</Text>
                    <Select value={selectedYear} onValueChange={setSelectedYear} enableClear={false} className="w-32 min-w-[120px]">
                      <SelectItem value="All">Todos</SelectItem>
                      {availableYears.map(year => (
                        <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                      ))}
                    </Select>
                  </div>
                </div>

                <CollapsibleSection title="Estadísticas de Strava">
                  <Grid numItems={2} numItemsSm={3} numItemsLg={6} className="gap-3">
                    <Card decoration="top" decorationColor="indigo" className="p-4 ring-1 ring-slate-200 shadow-sm">
                      <Text className="truncate font-medium text-slate-500">Distancia</Text>
                      <Metric className="text-2xl text-slate-900 mt-1">{Math.round(stats.distance / 1000)} km</Metric>
                    </Card>
                    <Card decoration="top" decorationColor="indigo" className="p-4 ring-1 ring-slate-200 shadow-sm">
                      <Text className="truncate font-medium text-slate-500">Actividades</Text>
                      <Metric className="text-2xl text-slate-900 mt-1">{stats.count}</Metric>
                    </Card>
                    <Card decoration="top" decorationColor="indigo" className="p-4 ring-1 ring-slate-200 shadow-sm">
                      <Text className="truncate font-medium text-slate-500">Tiempo</Text>
                      <Metric className="text-2xl text-slate-900 mt-1">{Math.floor(stats.moving_time / 3600)}h</Metric>
                    </Card>
                    <Card decoration="top" decorationColor="cyan" className="p-4 ring-1 ring-slate-200 shadow-sm">
                      <Text className="truncate font-medium text-slate-500">Ritmo Medio</Text>
                      <Flex justifyContent="start" alignItems="baseline" className="gap-1 mt-1">
                        <Metric className="text-2xl text-slate-900">{calculatePace(stats.distance > 0 ? stats.distance / stats.moving_time : 0)}</Metric>
                        <Text className="text-xs text-slate-400">/km</Text>
                      </Flex>
                    </Card>
                    <Card decoration="top" decorationColor="fuchsia" className="p-4 ring-1 ring-slate-200 shadow-sm">
                      <Flex justifyContent="start" className="gap-1">
                        <Text className="truncate font-medium text-slate-500">GAP</Text>
                        <Badge size="xs" color="amber">⚡</Badge>
                      </Flex>
                      <Flex justifyContent="start" alignItems="baseline" className="gap-1 mt-1">
                        <Metric className="text-2xl text-slate-900">
                          {(() => {
                            const d = stats.distance / 1000;
                            if (d <= 0) return '0:00';
                            const p = (stats.moving_time / 60) / d;
                            const e = stats.elevation_gain / d;
                            const g = Math.max(p - ((e / 10) * 8 / 60), p * 0.8);
                            const m = Math.floor(g);
                            const s = Math.round((g - m) * 60);
                            return `${m}:${s.toString().padStart(2, '0')}`;
                          })()}
                        </Metric>
                        <Text className="text-xs text-slate-400">/km</Text>
                      </Flex>
                    </Card>
                    <Card decoration="top" decorationColor="indigo" className="p-4 ring-1 ring-slate-200 shadow-sm">
                      <Text className="truncate font-medium text-slate-500">Elevación</Text>
                      <Metric className="text-2xl text-slate-900 mt-1">{Math.round(stats.elevation_gain)} m</Metric>
                    </Card>
                  </Grid>
                </CollapsibleSection>

                {stravaData.activities && stravaData.activities.length > 0 && (
                  <div className="activities-section">
                    <CollapsibleSection title="🏆 Mejores Marcas Estimadas">
                      <PersonalBests activities={filteredActivities} />
                    </CollapsibleSection>

                    <CollapsibleSection title="📊 Progreso Mensual">
                      <TabGroup index={selectedChartIndex} onIndexChange={setSelectedChartIndex}>
                        <TabList variant="solid" className="mb-4">
                          <Tab>Distancia</Tab>
                          <Tab>Tiempo</Tab>
                          <Tab>Desnivel</Tab>
                        </TabList>
                        <MonthlyChart activities={sortedActivities} selectedMetric={chartMetrics[selectedChartIndex]} />
                      </TabGroup>
                    </CollapsibleSection>

                    <CollapsibleSection title="🏁 Últimas Carreras">
                      <div className="flex justify-end mb-4">
                        <TextInput
                          placeholder="🔍 Buscar carrera..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="max-w-xs"
                        />
                      </div>
                      <Table className="mt-4">
                        <TableHead>
                          <TableRow>
                            <TableHeaderCell onClick={() => handleSort('date')} className="cursor-pointer hover:text-indigo-600 transition-colors">
                              Fecha {getSortIcon('date')}
                            </TableHeaderCell>
                            <TableHeaderCell>Nombre</TableHeaderCell>
                            <TableHeaderCell onClick={() => handleSort('distance')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors">
                              Dist (km) {getSortIcon('distance')}
                            </TableHeaderCell>
                            <TableHeaderCell onClick={() => handleSort('time')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors">
                              Tiempo (min) {getSortIcon('time')}
                            </TableHeaderCell>
                            <TableHeaderCell onClick={() => handleSort('pace')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors">
                              Ritmo (/km) {getSortIcon('pace')}
                            </TableHeaderCell>
                            <TableHeaderCell onClick={() => handleSort('gap')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors" title="Grade Adjusted Pace">
                              GAP ⚡ {getSortIcon('gap')}
                            </TableHeaderCell>
                            <TableHeaderCell onClick={() => handleSort('elevation')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors">
                              Desnivel (m) {getSortIcon('elevation')}
                            </TableHeaderCell>
                            <TableHeaderCell onClick={() => handleSort('gradient')} className="cursor-pointer text-right hover:text-indigo-600 transition-colors">
                              Pendiente (%) {getSortIcon('gradient')}
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
                              <TableRow key={activity.id}>
                                <TableCell>
                                  <Text>{new Date(activity.start_date).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' })}</Text>
                                </TableCell>
                                <TableCell>
                                  <Text className="truncate max-w-xs font-medium">
                                    <a href={`https://www.strava.com/activities/${activity.id}`} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-indigo-600">
                                      {activity.name}
                                    </a>
                                  </Text>
                                </TableCell>
                                <TableCell className="text-right"><Text>{(activity.distance / 1000).toFixed(2)}</Text></TableCell>
                                <TableCell className="text-right"><Text>{Math.floor(activity.moving_time / 60)}</Text></TableCell>
                                <TableCell className="text-right"><Text>{calculatePace(activity.average_speed)}</Text></TableCell>
                                <TableCell className="text-right">
                                  {hasSignificantAdjustment ? (
                                    <Badge color="emerald" size="xs">{formatPace(adjustedPace)}</Badge>
                                  ) : (
                                    <Text>{formatPace(adjustedPace)}</Text>
                                  )}
                                </TableCell>
                                <TableCell className="text-right"><Text>{Math.round(activity.total_elevation_gain)}</Text></TableCell>
                                <TableCell className="text-right">
                                  <Text>{activity.distance > 0 ? ((activity.total_elevation_gain / activity.distance) * 100).toFixed(1) : '0.0'}%</Text>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CollapsibleSection>
                  </div>
                )}
              </div>
            )}

            {currentView === 'planner' && (
              <div className="planner-view fade-in">
                <TrainingPlanner activities={runningActivities} />
              </div>
            )}

            {currentView === 'predictor' && (
              <div className="predictor-view fade-in">
                <RacePredictor activities={runningActivities} />
              </div>
            )}

            {currentView === 'qa' && (
              <div className="qa-view fade-in">
                <RunQA activities={runningActivities} />
              </div>
            )}

            {currentView === 'export' && (
              <div className="export-view fade-in">
                <DataExporter activities={runningActivities} />
              </div>
            )}
          </>
        )}
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
    // Save data and redirect
    localStorage.setItem('stravaData', JSON.stringify(data));
    // We can't easily update Dashboard state from here without Context or moving state up
    // But since we navigate to '/', and Dashboard reads from localStorage on mount, it might work if we force re-render or if Dashboard is mounted newly.
    navigate('/');
    window.location.reload(); // Simple way to ensure state refresh for this prototype
  };

  return (
    <div className="app-container">
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
    </div>
  );
}

export default App;
