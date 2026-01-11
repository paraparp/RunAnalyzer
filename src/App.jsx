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
import Logo from './components/Logo';
import CollapsibleSection from './components/CollapsibleSection';
import { getActivities, getStravaAuthUrl } from './services/strava';

const Dashboard = ({ user, handleLogout }) => {
  const [stravaData, setStravaData] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard' or 'planner'


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
      <header className="main-header">
        <div className="brand">
          <Logo />
          <h1>RunAnalyzer</h1>
        </div>

        <button className="menu-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Toggle menu">
          {mobileMenuOpen ? '✕' : '☰'}
        </button>

        <nav className={`header-nav ${mobileMenuOpen ? 'open' : ''}`}>
          <button
            className={`nav-link ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={() => { setCurrentView('dashboard'); setMobileMenuOpen(false); }}
          >
            Dashboard
          </button>
          <button
            className={`nav-link ${currentView === 'planner' ? 'active' : ''}`}
            onClick={() => { setCurrentView('planner'); setMobileMenuOpen(false); }}
          >
            Entrenador
          </button>
          <button
            className={`nav-link ${currentView === 'predictor' ? 'active' : ''}`}
            onClick={() => { setCurrentView('predictor'); setMobileMenuOpen(false); }}
          >
            Predictor
          </button>
        </nav>

        <div className="user-menu-container">
          <button onClick={() => setShowUserMenu(!showUserMenu)} className="avatar-btn">
            <img src={user.picture} alt={user.name} className="header-avatar" />
          </button>

          {showUserMenu && (
            <div className="user-dropdown">
              <div className="dropdown-user-info">
                <img src={user.picture} alt={user.name} className="dropdown-avatar" />
                <div>
                  <h4>{user.name}</h4>
                  <p>{user.email}</p>
                </div>
              </div>
              <div className="dropdown-divider"></div>
              <div className="dropdown-details">
                <div className="dropdown-item">
                  <span>ID Google:</span> <span className="mono">{user.sub.slice(0, 8)}...</span>
                </div>
              </div>
              <div className="dropdown-divider"></div>
              <button onClick={handleLogout} className="dropdown-logout-btn">
                Cerrar Sesión
              </button>
            </div>
          )}
        </div>
      </header>


      <div className="content-container">
        {!stravaData ? (
          <div className="strava-connect-card">
            <h3>Conecta tus estadísticas</h3>
            <p>Vincula tu cuenta de Strava para ver tu rendimiento.</p>
            <button onClick={connectToStrava} className="strava-connect-btn">
              Conectar con Strava
            </button>
          </div>
        ) : (
          <>
            {currentView === 'dashboard' && (
              <div className="dashboard-view fade-in">

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Año:</label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    style={{
                      padding: '0.3rem 2rem 0.3rem 1rem',
                      borderRadius: '6px',
                      border: 'var(--border-light)',
                      backgroundColor: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      fontWeight: '600',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    <option value="All">Todos</option>
                    {availableYears.map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>

                <CollapsibleSection title="Estadísticas de Strava">
                  <div className="stats-grid">
                    <div className="stat-card">
                      <span className="stat-label">Distancia Total</span>
                      <span className="stat-value">
                        {Math.round(stats.distance / 1000)} km
                      </span>
                      <span className="stat-sub">Corriendo</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Actividades</span>
                      <span className="stat-value">
                        {stats.count}
                      </span>
                      <span className="stat-sub">Carreras</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Tiempo en Movimiento</span>
                      <span className="stat-value">
                        {Math.floor(stats.moving_time / 3600)}h
                      </span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Ritmo Medio</span>
                      <span className="stat-value">
                        {calculatePace(stats.distance > 0 ? stats.distance / stats.moving_time : 0)}
                      </span>
                      <span className="stat-sub">/km</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label" title="Grade Adjusted Pace - Ritmo ajustado por desnivel">GAP Promedio</span>
                      <span className="stat-value" style={{ color: 'var(--accent-secondary)' }}>
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
                      </span>
                      <span className="stat-sub">⚡ /km</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Elevación Ganada</span>
                      <span className="stat-value">
                        {Math.round(stats.elevation_gain)} m
                      </span>
                    </div>
                  </div>
                </CollapsibleSection>

                {stravaData.activities && stravaData.activities.length > 0 && (
                  <div className="activities-section">
                    <CollapsibleSection title="🏆 Mejores Marcas Estimadas">
                      <PersonalBests activities={filteredActivities} />
                    </CollapsibleSection>

                    <CollapsibleSection title="📊 Progreso Mensual">
                      <MonthlyChart activities={sortedActivities} />
                    </CollapsibleSection>

                    <CollapsibleSection title="🏁 Últimas Carreras">
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                        <input
                          type="text"
                          placeholder="Buscar carrera..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '8px',
                            border: 'var(--border-light)',
                            background: 'var(--bg-card)',
                            color: 'var(--text-primary)',
                            width: '200px',
                            boxShadow: 'var(--shadow-sm)'
                          }}
                        />
                      </div>
                      <div className="table-container">
                        <table className="activities-table">
                          <thead>
                            <tr>
                              <th onClick={() => handleSort('date')}>Fecha {getSortIcon('date')}</th>
                              <th>Nombre</th>
                              <th onClick={() => handleSort('distance')} className="text-right">Dist (km) {getSortIcon('distance')}</th>
                              <th onClick={() => handleSort('time')} className="text-right">Tiempo (min) {getSortIcon('time')}</th>
                              <th onClick={() => handleSort('pace')} className="text-right">Ritmo (/km) {getSortIcon('pace')}</th>
                              <th onClick={() => handleSort('gap')} className="text-right" title="Grade Adjusted Pace - Ritmo ajustado por desnivel">GAP (/km) ⚡ {getSortIcon('gap')}</th>
                              <th onClick={() => handleSort('elevation')} className="text-right">Desnivel (m) {getSortIcon('elevation')}</th>
                              <th onClick={() => handleSort('gradient')} className="text-right">Pendiente (%) {getSortIcon('gradient')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedActivities.map(activity => {
                              // Calculate GAP for this activity
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
                                <tr key={activity.id}>
                                  <td>{new Date(activity.start_date).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' })}</td>
                                  <td className="activity-name">
                                    <a
                                      href={`https://www.strava.com/activities/${activity.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}
                                      onMouseEnter={(e) => e.target.style.color = '#3b82f6'}
                                      onMouseLeave={(e) => e.target.style.color = 'inherit'}
                                    >
                                      {activity.name}
                                    </a>
                                  </td>
                                  <td className="text-right">{(activity.distance / 1000).toFixed(2)}</td>
                                  <td className="text-right">{Math.floor(activity.moving_time / 60)}</td>
                                  <td className="text-right">{calculatePace(activity.average_speed)}</td>
                                  <td className="text-right" style={{
                                    color: hasSignificantAdjustment ? '#10b981' : 'inherit',
                                    fontWeight: hasSignificantAdjustment ? 'bold' : 'normal'
                                  }}>
                                    {formatPace(adjustedPace)}
                                    {hasSignificantAdjustment && (
                                      <span style={{ fontSize: '0.7em', marginLeft: '0.25rem', opacity: 0.8 }}>
                                        (-{Math.round(gapAdjustmentSeconds)}s)
                                      </span>
                                    )}
                                  </td>
                                  <td className="text-right">{Math.round(activity.total_elevation_gain)}</td>
                                  <td className="text-right">
                                    {activity.distance > 0
                                      ? ((activity.total_elevation_gain / activity.distance) * 100).toFixed(1)
                                      : '0.0'}%
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
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
            <div className="login-card">
              <div className="login-header">
                <h1>Bienvenido</h1>
                <p>Inicia sesión con Google para continuar</p>
              </div>
              <div className="google-btn-wrapper">
                <GoogleLogin
                  onSuccess={handleLoginSuccess}
                  onError={handleLoginError}
                  theme="filled_black"
                  shape="pill"
                  size="large"
                />
              </div>
            </div>
          ) : (
            <Dashboard user={user} handleLogout={handleLogout} />
          )
        } />
      </Routes>
    </div>
  );
}

export default App;
