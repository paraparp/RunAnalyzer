import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, ReferenceArea, Brush
} from "recharts";
import { motion } from "framer-motion";
import {
  HeartIcon, ArrowPathIcon, TrashIcon, LockClosedIcon,
  CheckCircleIcon, ExclamationTriangleIcon,
  ArrowDownTrayIcon, ArrowUpTrayIcon, MoonIcon,
  UserIcon, KeyIcon
} from "@heroicons/react/24/outline";

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
function pearsonCorr(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b) / n;
  const my = ys.reduce((a, b) => a + b) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return dx === 0 || dy === 0 ? null : num / (dx * dy);
}

function slopePerYear(data, field) {
  const valid = data.filter(d => d[field] != null);
  if (valid.length < 2) return null;
  const xs = valid.map(d => new Date(d.date).getTime() / (1000 * 60 * 60 * 24 * 365.25));
  const ys = valid.map(d => d[field]);
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

// ---------------------------------------------------------------------------
// Chart helpers
// ---------------------------------------------------------------------------
const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function monthLabel(isoMonth) {
  const [y, m] = isoMonth.split('-');
  return `${MONTHS_ES[+m - 1]} ${y.slice(2)}`;
}

function isoWeek(dateStr) {
  // Returns "YYYY-Www" key for the Monday of that week
  const d = new Date(dateStr);
  const day = d.getDay() || 7; // Mon=1 … Sun=7
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().split('T')[0]; // Monday date as key
}

function weekLabel(mondayStr) {
  const d = new Date(mondayStr);
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

function avg(arr) {
  return arr.length ? +(arr.reduce((a, b) => a + b) / arr.length).toFixed(1) : null;
}

function buildChartData(data, sleepData = [], granularity = 'month') {
  const buckets = {};
  data.forEach(d => {
    const key =
      granularity === 'day'   ? d.date :
      granularity === 'week'  ? isoWeek(d.date) :
                                d.date.slice(0, 7);
    if (!buckets[key]) buckets[key] = { hr: [], hrv: [], bbHigh: [], bbLow: [], sleep: [] };
    if (d.restingHR)      buckets[key].hr.push(d.restingHR);
    if (d.hrv)            buckets[key].hrv.push(d.hrv);
    if (d.bbHigh != null) buckets[key].bbHigh.push(d.bbHigh);
    if (d.bbLow  != null) buckets[key].bbLow.push(d.bbLow);
  });
  
  sleepData.forEach(s => {
    if (s.score == null) return;
    const key =
      granularity === 'day'   ? s.weekStart :
      granularity === 'week'  ? s.weekStart :
                                s.weekStart.slice(0, 7);
    if (!buckets[key]) buckets[key] = { hr: [], hrv: [], bbHigh: [], bbLow: [], sleep: [] };
    if (!buckets[key].sleep) buckets[key].sleep = [];
    buckets[key].sleep.push(s.score);
  });

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      key,
      label: granularity === 'day'  ? (() => { const [y,m,d] = key.split('-'); return `${d} ${MONTHS_ES[+m-1]} ${y.slice(2)}`; })()
           : granularity === 'week' ? weekLabel(key)
           :                          monthLabel(key),
      restingHR: avg(v.hr || []),
      hrv:       avg(v.hrv || []),
      bbHigh:    avg(v.bbHigh || []),
      bbLow:     avg(v.bbLow || []),
      sleepScore: avg(v.sleep || []),
    }))
    .filter(d => d.restingHR || d.hrv || d.bbHigh || d.sleepScore);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <motion.div 
      initial={{ opacity: 0, y: 5 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="bg-white/90 backdrop-blur-xl border border-white/40 rounded-2xl p-4 text-xs shadow-[0_8px_30px_rgb(0,0,0,0.12)]"
    >
      <p className="font-bold text-slate-800 mb-3 border-b border-slate-100 pb-2">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 mb-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: p.color }} />
            <span className="text-slate-500 font-medium">{p.name}</span>
          </div>
          <span className="font-bold text-slate-900">{p.value}</span>
        </div>
      ))}
    </motion.div>
  );
};

const StatCard = ({ label, value, unit, sub, accent = "slate", delay = 0 }) => {
  const accentMap = {
    orange: "text-orange-500 bg-orange-500/10",
    red:    "text-rose-500 bg-rose-500/10",
    blue:   "text-blue-500 bg-blue-500/10",
    green:  "text-emerald-500 bg-emerald-500/10",
    slate:  "text-slate-800 bg-slate-800/10",
  };
  const colorMap = {
    orange: "text-orange-600",
    red:    "text-rose-600",
    blue:   "text-blue-600",
    green:  "text-emerald-600",
    slate:  "text-slate-800",
  };
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className="bg-white/60 backdrop-blur-3xl rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 p-5 flex flex-col gap-2 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-shadow duration-300 relative overflow-hidden"
    >
      <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full blur-2xl ${accentMap[accent] || "bg-slate-100"}`} />
      <span className="text-xs text-slate-400 font-semibold tracking-wider uppercase relative z-10">{label}</span>
      <div className={`text-3xl font-extrabold leading-tight tracking-tight relative z-10 ${colorMap[accent] || "text-slate-800"}`}>
        {value}
        {unit && <span className="text-sm font-semibold text-slate-400 ml-1">{unit}</span>}
      </div>
      {sub && <span className="text-xs font-medium text-slate-500 relative z-10">{sub}</span>}
    </motion.div>
  );
};

const MiniMetric = ({ label, value, unit, colorClass="text-slate-700", trend = null, isInverse = false }) => {
  let trendIndicator = null;
  if (trend != null && !isNaN(trend)) {
    const t = Number(trend);
    if (Math.abs(t) >= 0.1) {
      const isPositiveDelta = t > 0;
      const isGood = isInverse ? !isPositiveDelta : isPositiveDelta;
      const arrow = isPositiveDelta ? '↗' : '↘';
      const color = isGood ? 'text-emerald-600 bg-emerald-50 ring-emerald-500/20' : 'text-rose-600 bg-rose-50 ring-rose-500/20';
      trendIndicator = (
        <span className={`text-[10px] font-bold ml-2 px-1.5 py-0.5 rounded-md ${color} ring-1 flex items-center`}>
          {arrow} {Math.abs(t).toFixed(1)}
        </span>
      );
    }
  }

  return (
    <div className="flex flex-col bg-slate-50/50 p-2.5 rounded-2xl border border-slate-100/50">
      <span className="text-[10px] uppercase text-slate-400 font-bold mb-1 tracking-wider">{label}</span>
      <div className="flex items-baseline gap-0.5">
        <span className={`text-xl sm:text-2xl font-extrabold leading-none tracking-tight ${colorClass}`}>{value ?? '—'}</span>
        {value != null && unit && <span className="text-[10px] text-slate-400 font-semibold ml-0.5">{unit}</span>}
        {trendIndicator}
      </div>
    </div>
  );
};

const HRV_STATUS = {
  BALANCED:   { label: 'VFC Equilibrada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-500/20', dot: 'bg-emerald-500' },
  LOW:        { label: 'VFC Baja',        color: 'bg-rose-50 text-rose-600 border-rose-200 ring-rose-500/20', dot: 'bg-rose-500' },
  UNBALANCED: { label: 'VFC Desequilibrada', color: 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-500/20', dot: 'bg-amber-500' },
  POOR:       { label: 'VFC Pobre',       color: 'bg-orange-50 text-orange-700 border-orange-200 ring-orange-500/20', dot: 'bg-orange-500' },
};

const HrvStatusBadge = ({ status }) => {
  const s = HRV_STATUS[status?.toUpperCase()] ?? { label: status, color: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' };
  return (
    <motion.span 
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold border ring-4 uppercase tracking-wider ${s.color}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 animate-pulse ${s.dot}`} />
      {s.label}
    </motion.span>
  );
};

// ---------------------------------------------------------------------------
// Period presets
// ---------------------------------------------------------------------------
const PERIOD_PRESETS = [
  { label: '1 día',    days: 1    },
  { label: '2 días',   days: 2    },
  { label: '3 días',   days: 3    },
  { label: '5 días',   days: 5    },
  { label: '7 días',   days: 7    },
  { label: '10 días',  days: 10   },
  { label: '2 sem',    days: 14   },
  { label: '1 mes',    days: 30   },
  { label: '3 meses',  days: 90   },
  { label: '6 meses',  days: 180  },
  { label: '1 año',    days: 365  },
  { label: '2 años',   days: 730  },
  { label: '5 años',   days: 1825 },
];

function periodLabel(days) {
  return PERIOD_PRESETS.find(p => p.days === days)?.label ?? `${days}d`;
}

function estMinutes(days) {
  return Math.max(1, Math.ceil(days * 0.25 / 60));
}

const PeriodSelector = ({ value, onChange, label }) => {
  const presets = [
    { label: '7D', days: 7 },
    { label: '1M', days: 30 },
    { label: '3M', days: 90 },
    { label: '6M', days: 180 },
    { label: '1A', days: 365 },
    { label: '2A', days: 730 },
    { label: '5A', days: 1825 },
  ];

  const isPreset = presets.some(p => p.days === value);
  const [customDays, setCustomDays] = useState(isPreset ? '' : value.toString());

  const handleCustomChange = (e) => {
    const valStr = e.target.value;
    setCustomDays(valStr);
    const val = parseInt(valStr, 10);
    if (!isNaN(val) && val > 0) {
      onChange(val);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</label>
        <span className="text-xs text-slate-400 flex items-center gap-1.5">
          <span className="font-semibold text-slate-700">{value} días</span>
          {value > 30 && <span className="bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-md font-medium">~{estMinutes(value)} min</span>}
        </span>
      </div>
      
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        {/* Presets Group */}
        <div className="flex bg-slate-100 p-1 rounded-xl overflow-x-auto no-scrollbar">
          {presets.map(p => {
            const selected = value === p.days;
            return (
              <button
                key={p.days}
                type="button"
                onClick={() => {
                  setCustomDays('');
                  onChange(p.days);
                }}
                className={`flex-1 min-w-[40px] px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                  selected
                    ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200/50'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Custom Input */}
        <div className="relative flex-shrink-0">
          <input
            type="number"
            min="1"
            max="3650"
            value={!isPreset ? customDays : ''}
            onChange={handleCustomChange}
            placeholder="Personalizado..."
            className={`w-full sm:w-32 bg-slate-50 border rounded-xl px-3 py-1.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all h-full ${
              !isPreset ? 'border-blue-400 bg-white ring-2 ring-blue-50' : 'border-slate-200'
            }`}
          />
          <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
            <span className="text-xs text-slate-400 font-medium">días</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function GarminCardiac() {
  // Persisted state
  const [creds, setCreds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('garmin_creds') || 'null'); } catch { return null; }
  });
  const [data, setData] = useState(() => {
    try { return JSON.parse(localStorage.getItem('garmin_cardiac_data') || 'null'); } catch { return null; }
  });
  const [sleepData, setSleepData] = useState(() => {
    try { return JSON.parse(localStorage.getItem('garmin_sleep_data') || 'null'); } catch { return null; }
  });

  // Form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [daysToFetch, setDaysToFetch] = useState(365);

  // UI state
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [showHRV, setShowHRV] = useState(true);
  const [showHR, setShowHR] = useState(true);
  const [showBBHigh, setShowBBHigh] = useState(false);
  const [showBBLow, setShowBBLow] = useState(false);
  const [showSleep, setShowSleep] = useState(false);
  const [showReadiness, setShowReadiness] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const [normalizeChart, setNormalizeChart] = useState(true);
  const [chartGranularity, setChartGranularity] = useState('day'); // changed default to day for better readiness view
  const [lastSync, setLastSync] = useState(() => localStorage.getItem('garmin_last_sync') || null);
  const [syncDays, setSyncDays] = useState(30);
  const importRef = useRef(null);

  // ---- Load from server JSON file on mount ----
  useEffect(() => {
    fetch('/api/garmin/data')
      .then(r => r.ok ? r.json() : null)
      .then(db => {
        if (!db || !db.data?.length) return;
        setData(prev => {
          if (prev && prev.length) {
            const byDate = {};
            [...db.data, ...prev].forEach(r => { byDate[r.date] = { ...byDate[r.date], ...r }; });
            const merged = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
            localStorage.setItem('garmin_cardiac_data', JSON.stringify(merged));
            return merged;
          }
          localStorage.setItem('garmin_cardiac_data', JSON.stringify(db.data));
          return db.data;
        });
        if (db.sleepData?.length) {
          setSleepData(db.sleepData);
          localStorage.setItem('garmin_sleep_data', JSON.stringify(db.sleepData));
        }
        if (db.lastSync) {
          const t = new Date(db.lastSync).toLocaleString('es-ES');
          setLastSync(t);
          localStorage.setItem('garmin_last_sync', t);
        }
      })
      .catch(() => { /* server not running, use localStorage */ });
  }, []);

  // ---- Streaming fetch ----
  const fetchHealth = useCallback(async (usr, pwd, days, mergeExisting = false) => {
    setLoading(true);
    setError(null);
    setProgress({ value: 0, period: 'Iniciando…', chunks: [] });

    if (days <= 30) {
      try {
        const res = await fetch('/api/garmin/health/recent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: usr, password: pwd, days }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Error del servidor');
        saveData(json.data, mergeExisting, usr, pwd, json.sleepData);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
        setProgress(null);
      }
      return;
    }

    try {
      const res = await fetch('/api/garmin/health/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usr, password: pwd, days }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Error del servidor');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = mergeExisting && data ? [...data] : [];
      const completedChunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);

          if (msg.type === 'chunk') {
            const byDate = {};
            [...accumulated, ...msg.data].forEach(r => { byDate[r.date] = { ...byDate[r.date], ...r }; });
            accumulated = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
            completedChunks.push({ period: msg.period, count: msg.data.length });
            setProgress({ value: msg.progress, period: msg.period, chunks: [...completedChunks] });
            setData([...accumulated]);
          } else if (msg.type === 'done') {
            saveData(accumulated, false, usr, pwd, msg.sleepData);
          } else if (msg.type === 'error') {
            throw new Error(msg.error);
          }
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [data]);

  const saveData = (newData, mergeExisting, usr, pwd, newSleepData = null) => {
    let final = newData;
    if (mergeExisting && data) {
      const byDate = {};
      [...data, ...newData].forEach(r => { byDate[r.date] = { ...byDate[r.date], ...r }; });
      final = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    }
    setData(final);
    localStorage.setItem('garmin_cardiac_data', JSON.stringify(final));
    if (newSleepData?.length) {
      const merged = (() => {
        const byWeek = {};
        [...(sleepData || []), ...newSleepData].forEach(r => { byWeek[r.weekStart] = r; });
        return Object.values(byWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      })();
      setSleepData(merged);
      localStorage.setItem('garmin_sleep_data', JSON.stringify(merged));
    }
    const syncTime = new Date().toLocaleString('es-ES');
    setLastSync(syncTime);
    localStorage.setItem('garmin_last_sync', syncTime);
    if (usr) {
      localStorage.setItem('garmin_creds', JSON.stringify({ username: usr, password: pwd }));
      setCreds({ username: usr, password: pwd });
    }
    fetch('/api/garmin/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: final, lastSync: new Date().toISOString() }),
    }).catch(() => {});
  };

  // ---- Export JSON ----
  const handleExport = () => {
    if (!data) return;
    const blob = new Blob(
      [JSON.stringify({ lastSync: new Date().toISOString(), data }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `garmin_data_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Import JSON ----
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
        if (!rows.length) { setError('El archivo no contiene datos válidos'); return; }
        saveData(rows, true, null, null);
        setError(null);
      } catch {
        setError('Error al leer el archivo JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleLogin = async e => {
    e.preventDefault();
    if (!username || !password) return;
    await fetchHealth(username, password, daysToFetch);
  };

  const handleSync = () => {
    if (!creds) return;
    fetchHealth(creds.username, creds.password, syncDays, true);
  };

  const handleLogout = () => {
    setData(null);
    setCreds(null);
    setLastSync(null);
    localStorage.removeItem('garmin_cardiac_data');
    localStorage.removeItem('garmin_creds');
    localStorage.removeItem('garmin_last_sync');
    fetch('/api/garmin/data', { method: 'DELETE' }).catch(() => {});
  };

  // ---- Derived stats ----
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    
    // Use only last 365 days for historical averages/trends
    const recentData = data.filter(d => new Date(d.date).getTime() >= oneYearAgo);
    const refData = recentData.length > 0 ? recentData : data; // fallback if no data in last year

    const hrRows  = refData.filter(d => d.restingHR);
    const avgHR   = hrRows.length ? hrRows.reduce((s, d) => s + d.restingHR, 0) / hrRows.length : null;
    const last21HR  = hrRows.filter(d => (now - new Date(d.date).getTime()) / 86400000 <= 21);
    const avg21HR   = last21HR.length ? last21HR.reduce((s, d) => s + d.restingHR, 0) / last21HR.length : null;
    const last7HR   = hrRows.filter(d => (now - new Date(d.date).getTime()) / 86400000 <= 7);
    const avg7HR    = last7HR.length ? last7HR.reduce((s, d) => s + d.restingHR, 0) / last7HR.length : null;
    const trendHR   = slopePerYear(refData, 'restingHR');

    const hrvRows   = refData.filter(d => d.hrv);
    const avgHRV    = hrvRows.length ? hrvRows.reduce((s, d) => s + d.hrv, 0) / hrvRows.length : null;
    const last21HRV = hrvRows.filter(d => (now - new Date(d.date).getTime()) / 86400000 <= 21);
    const avg21HRV  = last21HRV.length ? last21HRV.reduce((s, d) => s + d.hrv, 0) / last21HRV.length : null;
    const last7HRV  = hrvRows.filter(d => (now - new Date(d.date).getTime()) / 86400000 <= 7);
    const avg7HRV   = last7HRV.length ? last7HRV.reduce((s, d) => s + d.hrv, 0) / last7HRV.length : null;
    const trendHRV  = slopePerYear(refData, 'hrv');

    const both = refData.filter(d => d.restingHR && d.hrv);
    const corr = pearsonCorr(both.map(d => d.hrv), both.map(d => d.restingHR));

    // Latest HRV status + baseline from most recent day that has one
    const latestDay = [...data].reverse().find(d => d.hrv);
    const latestStatus   = latestDay?.hrvStatus ?? null;
    const latestBaseline = latestDay?.baseline  ?? null;
    const latestHRV      = latestDay?.hrv       ?? null;
    
    const latestDayHR = [...data].reverse().find(d => d.restingHR);
    const latestHR = latestDayHR?.restingHR ?? null;

    // Body Battery
    const bbRows   = refData.filter(d => d.bbHigh != null);
    const avgBBHigh = bbRows.length ? +(bbRows.reduce((s, d) => s + d.bbHigh, 0) / bbRows.length).toFixed(1) : null;
    const avgBBLow  = bbRows.length ? +(bbRows.reduce((s, d) => s + (d.bbLow ?? 0), 0) / bbRows.length).toFixed(1) : null;
    const last21BB  = bbRows.filter(d => (now - new Date(d.date).getTime()) / 86400000 <= 21);
    const avg21BBHigh = last21BB.length ? +(last21BB.reduce((s, d) => s + d.bbHigh, 0) / last21BB.length).toFixed(1) : null;
    const last7BB   = bbRows.filter(d => (now - new Date(d.date).getTime()) / 86400000 <= 7);
    const avg7BBHigh = last7BB.length ? +(last7BB.reduce((s, d) => s + d.bbHigh, 0) / last7BB.length).toFixed(1) : null;
    const latestBB  = [...data].reverse().find(d => d.bbHigh != null);

    // Best/worst month per metric (min 10 days of data in month)
    const byMonth = {};
    refData.forEach(d => {
      const m = d.date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { hrv: [], hr: [], bb: [] };
      if (d.hrv)           byMonth[m].hrv.push(d.hrv);
      if (d.restingHR)     byMonth[m].hr.push(d.restingHR);
      if (d.bbHigh != null) byMonth[m].bb.push(d.bbHigh);
    });
    const monthAvgs = Object.entries(byMonth)
      .filter(([, v]) => v.hrv.length >= 10 || v.hr.length >= 10 || v.bb.length >= 10)
      .map(([month, v]) => ({
        month,
        label: monthLabel(month),
        avgHRV: v.hrv.length >= 10 ? +(v.hrv.reduce((a,b)=>a+b,0)/v.hrv.length).toFixed(1) : null,
        avgHR:  v.hr.length  >= 10 ? +(v.hr.reduce((a,b)=>a+b,0)/v.hr.length).toFixed(1)   : null,
        avgBB:  v.bb.length  >= 10 ? +(v.bb.reduce((a,b)=>a+b,0)/v.bb.length).toFixed(1)   : null,
      }));

    const withHRV = monthAvgs.filter(m => m.avgHRV != null);
    const withHR  = monthAvgs.filter(m => m.avgHR  != null);
    const withBB  = monthAvgs.filter(m => m.avgBB  != null);
    const bestHRVMonth  = withHRV.length ? withHRV.reduce((a,b) => +a.avgHRV > +b.avgHRV ? a : b) : null;
    const worstHRVMonth = withHRV.length ? withHRV.reduce((a,b) => +a.avgHRV < +b.avgHRV ? a : b) : null;
    const bestHRMonth   = withHR.length  ? withHR.reduce((a,b)  => +a.avgHR  < +b.avgHR  ? a : b) : null; // lower = better
    const worstHRMonth  = withHR.length  ? withHR.reduce((a,b)  => +a.avgHR  > +b.avgHR  ? a : b) : null;
    const bestBBMonth   = withBB.length  ? withBB.reduce((a,b)  => +a.avgBB  > +b.avgBB  ? a : b) : null;
    const worstBBMonth  = withBB.length  ? withBB.reduce((a,b)  => +a.avgBB  < +b.avgBB  ? a : b) : null;

    return {
      avgHR:    avgHR?.toFixed(1),
      avg7HR:   avg7HR?.toFixed(1),
      avg21HR:  avg21HR?.toFixed(1),
      latestHR,
      trendHR:  trendHR?.toFixed(1),
      avgHRV:   avgHRV?.toFixed(1),
      avg7HRV:  avg7HRV?.toFixed(1),
      avg21HRV: avg21HRV?.toFixed(1),
      trendHRV: trendHRV?.toFixed(1),
      corr:     corr?.toFixed(2),
      hasHRV:   hrvRows.length > 0,
      hasHR:    hrRows.length > 0,
      hasBB:    bbRows.length > 0,
      latestStatus,
      latestBaseline,
      latestHRV,
      avgBBHigh,
      avgBBLow,
      avg7BBHigh,
      avg21BBHigh,
      latestBBHigh: latestBB?.bbHigh ?? null,
      latestBBLow:  latestBB?.bbLow  ?? null,
      bestHRVMonth, worstHRVMonth,
      bestHRMonth,  worstHRMonth,
      bestBBMonth,  worstBBMonth,
    };
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    const raw = buildChartData(data, sleepData || [], chartGranularity);
    // Normalize HR and HRV to 0-100 so they share one axis
    // HR is inverted (lower = better), HRV is direct (higher = better)
    const hrs  = raw.map(d => d.restingHR).filter(v => v != null);
    const hrvs = raw.map(d => d.hrv).filter(v => v != null);
    const hrMin  = Math.min(...hrs),  hrMax  = Math.max(...hrs);
    const hrvMin = Math.min(...hrvs), hrvMax = Math.max(...hrvs);
    const norm = (v, min, max) => max === min ? 50 : +((v - min) / (max - min) * 100).toFixed(1);
    
    return raw.map((d, i) => {
      let readinessScore = null;
      let score = 0;
      let weight = 0;

      // Dynamic baseline window (21 days ~ 3 semanas ~ 1 mes)
      const windowSize = chartGranularity === 'day' ? 21 : chartGranularity === 'week' ? 3 : 1;
      // Inclusive window: from max(0, i - windowSize + 1) to i (inclusive, so slice to i + 1)
      const windowStart = Math.max(0, i - windowSize + 1);
      const windowData = raw.slice(windowStart, i + 1);
      const wHrvs = windowData.map(w => w.hrv).filter(v => v != null);
      const wHrs = windowData.map(w => w.restingHR).filter(v => v != null);
      const baselineHrv = wHrvs.length > 0 ? wHrvs.reduce((a,b)=>a+b,0)/wHrvs.length : null;
      const baselineHr = wHrs.length > 0 ? wHrs.reduce((a,b)=>a+b,0)/wHrs.length : null;

      if (d.hrv != null && baselineHrv != null) {
        // HRV: Higher is better. 75 base score for meeting baseline.
        const hrvScore = Math.max(0, Math.min(100, 75 + ((d.hrv - baselineHrv) / baselineHrv) * 125));
        score += hrvScore * 0.35;
        weight += 0.35;
      }
      if (d.restingHR != null && baselineHr != null) {
        // RHR: Lower is better. 75 base score for meeting baseline.
        const rhrScore = Math.max(0, Math.min(100, 75 + ((baselineHr - d.restingHR) / baselineHr) * 200));
        score += rhrScore * 0.15;
        weight += 0.15;
      }
      if (d.sleepScore != null) {
        score += d.sleepScore * 0.35;
        weight += 0.35;
      }
      if (d.bbHigh != null) {
        score += d.bbHigh * 0.15;
        weight += 0.15;
      }
      
      if (weight > 0) {
        // Normalize out of 100 based on available metrics
        readinessScore = +(score / weight).toFixed(1);
      }

      // 7-day trailing average for Stress index
      const windowSize7 = chartGranularity === 'day' ? 7 : 1;
      const windowStart7 = Math.max(0, i - windowSize7 + 1);
      const windowData7 = raw.slice(windowStart7, i + 1);
      const w7Hrvs = windowData7.map(w => w.hrv).filter(v => v != null);
      const w7Hrs = windowData7.map(w => w.restingHR).filter(v => v != null);
      const avg7Hrv = w7Hrvs.length > 0 ? w7Hrvs.reduce((a,b)=>a+b,0)/w7Hrvs.length : null;
      const avg7Hr = w7Hrs.length > 0 ? w7Hrs.reduce((a,b)=>a+b,0)/w7Hrs.length : null;
      const avg7Adaptation = avg7Hr != null && avg7Hrv != null ? +(avg7Hrv - avg7Hr).toFixed(1) : null;

      return {
        ...d,
        hrNorm:  d.restingHR != null ? 100 - norm(d.restingHR, hrMin, hrMax) : null,
        hrvNorm: d.hrv       != null ? norm(d.hrv, hrvMin, hrvMax)            : null,
        baselineHrv,
        baselineHr,
        baselineHrvNorm: baselineHrv != null ? norm(baselineHrv, hrvMin, hrvMax) : null,
        baselineHrNorm:  baselineHr != null ? 100 - norm(baselineHr, hrMin, hrMax) : null,
        sleepNorm: d.sleepScore,
        readinessScore,
        hrvMinusHr: d.restingHR != null && d.hrv != null ? +(d.hrv - d.restingHR).toFixed(1) : null,
        avg7Adaptation
      };
    });
  }, [data, sleepData, chartGranularity]);

  const adaptationLimits = useMemo(() => {
    const valid = chartData.map(d => d.hrvMinusHr).filter(v => v != null);
    if (valid.length < 10) return null;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const variance = valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / valid.length;
    const sd = Math.sqrt(variance);
    // Typical limits: +/- 0.75 SD defines the "normal" adaptation band
    return {
      upper: +(mean + sd * 0.75).toFixed(1),
      lower: +(mean - sd * 0.75).toFixed(1)
    };
  }, [chartData]);

  // ---- Login form ----
  if (!data) {
    return (
      <div className="max-w-lg space-y-5">
        {/* Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-rose-50 rounded-xl flex items-center justify-center">
            <HeartIcon className="w-4 h-4 text-rose-500" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">Monitor Cardíaco · Garmin</h2>
            <p className="text-xs text-slate-400">FC reposo + VFC nocturna</p>
          </div>
        </div>

        {/* Security note */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-1">
          <p className="flex items-center gap-1.5 font-semibold text-amber-900">
            <LockClosedIcon className="w-4 h-4 shrink-0" />
            Tus credenciales no salen del servidor local
          </p>
          <p className="text-amber-700 text-xs leading-relaxed">
            Se usan para autenticarte en Garmin Connect y descargar FC reposo + HRV.
            El proxy corre en <code className="bg-amber-100 rounded px-1 text-amber-900">localhost:3001</code> — nada va a internet salvo la petición a Garmin.
          </p>
        </div>

        {/* Form */}
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-sm border border-slate-200/60 p-6 space-y-6">
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">
                  Email de Garmin Connect
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <UserIcon className="h-5 w-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                  </div>
                  <input
                    type="email"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="tu@email.com"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block mb-1.5">
                  Contraseña
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <KeyIcon className="h-5 w-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-5">
              <PeriodSelector value={daysToFetch} onChange={setDaysToFetch} label="Período a importar" />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start gap-2">
                <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
                <span>
                  {error}
                  {error.includes('3001') && (
                    <span className="block mt-1 text-red-500 text-xs">
                      ¿Arrancaste el servidor? <code className="bg-red-100 rounded px-1">npm run server</code>
                    </span>
                  )}
                </span>
              </div>
            )}

            {loading && progress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <ArrowPathIcon className="w-3.5 h-3.5 animate-spin text-blue-500" />
                    {progress.period}
                  </span>
                  <span className="font-semibold text-slate-700">{Math.round(progress.value * 100)}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round(progress.value * 100)}%` }}
                  />
                </div>
                {progress.chunks.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {progress.chunks.map((c, i) => (
                      <span key={i} className="text-xs bg-blue-50 text-blue-600 border border-blue-100 rounded-md px-1.5 py-0.5">
                        {c.period} <span className="text-blue-400">({c.count}d)</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl px-4 py-3 text-sm transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg disabled:shadow-none"
            >
              {loading ? (
                <>
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  Descargando…
                </>
              ) : (
                <>
                  <HeartIcon className="w-4 h-4" />
                  Conectar con Garmin y descargar datos
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-xs text-slate-400 text-center">
          Servidor proxy requerido:{' '}
          <code className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">npm run server</code>
        </p>
      </div>
    );
  }

  // ---- Dashboard ----
  const trendHRAccent  = stats?.trendHR  > 0 ? "red"   : "blue";
  const trendHRSign    = stats?.trendHR  > 0 ? "+"     : "";
  const trendHRVAccent = stats?.trendHRV > 0 ? "blue"  : "orange";
  const trendHRVSign   = stats?.trendHRV > 0 ? "+"     : "";

  const hrAxisOnly = stats?.hasHR && !(stats?.hasHRV && showHRV);
  const bothVisible = stats?.hasHR && showHR && stats?.hasHRV && showHRV;
  const useNorm = normalizeChart && bothVisible;

  const latestReadiness = chartData.length > 0 ? chartData[chartData.length - 1].readinessScore : null;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-rose-50 rounded-xl flex items-center justify-center">
            <HeartIcon className="w-4 h-4 text-rose-500" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">Monitor Cardíaco · Garmin</h2>
            {lastSync && <p className="text-xs text-slate-400">Sync: {lastSync}</p>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Sync with period selector */}
          <div className="flex items-center">
            <select
              value={syncDays}
              onChange={e => setSyncDays(+e.target.value)}
              disabled={loading}
              className="bg-white border border-slate-200 border-r-0 text-slate-600 text-xs rounded-l-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 disabled:opacity-50 h-8"
            >
              {PERIOD_PRESETS.map(p => (
                <option key={p.days} value={p.days}>{p.label}</option>
              ))}
            </select>
            <button
              onClick={handleSync}
              disabled={loading}
              className="h-8 px-2.5 rounded-r-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600 flex items-center gap-1 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-500' : ''}`} />
              {loading ? 'Sync…' : 'Sync'}
            </button>
          </div>

          <button
            onClick={handleExport}
            disabled={!data}
            title="Exportar datos como JSON"
            className="h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-30"
          >
            <ArrowDownTrayIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exportar</span>
          </button>

          <label
            title="Importar JSON de datos"
            className="h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer"
          >
            <ArrowUpTrayIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Importar</span>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          </label>

          <button
            onClick={handleLogout}
            className="h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 flex items-center gap-1.5 text-xs font-medium transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Desconectar</span>
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {loading && progress && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-sm text-blue-700">
            <span className="flex items-center gap-2 font-medium">
              <ArrowPathIcon className="w-4 h-4 animate-spin shrink-0" />
              {progress.period}
            </span>
            <span className="font-bold">{Math.round(progress.value * 100)}%</span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.round(progress.value * 100)}%` }}
            />
          </div>
          {progress.chunks.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {progress.chunks.map((c, i) => (
                <span key={i} className="text-xs bg-white text-blue-600 border border-blue-100 rounded-md px-1.5 py-0.5">
                  {c.period} <span className="text-blue-400">({c.count}d)</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start gap-2">
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
          {error}
        </div>
      )}

      {/* Connected badge */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
        <span className="text-slate-500">Conectado como</span>
        <span className="font-semibold text-slate-700">{creds?.username}</span>
        <span className="text-slate-300">·</span>
        <span className="text-slate-400">{data.length} días de datos</span>
        {stats?.latestStatus && (
          <>
            <span className="text-slate-300">·</span>
            <HrvStatusBadge status={stats.latestStatus} />
          </>
        )}
      </div>

      {/* One-metric-only info banner */}
      {stats && !(stats.hasHR && stats.hasHRV) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 flex items-start gap-2">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
          {stats.hasHR && !stats.hasHRV && (
            <span>
              Solo FC reposo disponible. La VFC nocturna requiere dispositivos Garmin con{' '}
              <strong className="text-amber-800">HRV Status</strong> (Fenix 7+, FR955+, Venu 3+) y rastreo de sueño activado.
            </span>
          )}
          {stats.hasHRV && !stats.hasHR && (
            <span>Solo VFC disponible. No se encontró FC reposo en los datos importados.</span>
          )}
        </div>
      )}

      {/* ── Global Readiness ─────────────────────────────────────── */}
      {latestReadiness != null && (
        <div className="mb-2">
          <StatCard 
            label="Recovery & Readiness Score" 
            value={latestReadiness} 
            unit="/100" 
            sub="Combinación algorítmica de VFC, FC reposo, Sueño y Body Battery basada en las últimas 3 semanas (21 días)."
            accent={latestReadiness >= 80 ? 'green' : latestReadiness >= 60 ? 'blue' : 'orange'}
          />
        </div>
      )}

      {/* ── Fila 1: Estado actual ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* VFC + baseline */}
        {stats?.hasHRV && (
          <div className="bg-white/60 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 rounded-3xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400 font-medium tracking-wide uppercase">VFC nocturna</span>
              {stats.latestStatus && <HrvStatusBadge status={stats.latestStatus} />}
            </div>
            
            <div className="grid grid-cols-3 gap-2">
              <MiniMetric 
                label="Hoy" 
                value={stats.latestHRV} 
                unit="ms" 
                colorClass="text-blue-600" 
                trend={stats.latestHRV && stats.avg7HRV ? stats.latestHRV - stats.avg7HRV : null} 
              />
              <MiniMetric 
                label="7 Días" 
                value={stats.avg7HRV} 
                unit="ms" 
                trend={stats.avg7HRV && stats.avg21HRV ? stats.avg7HRV - stats.avg21HRV : null}
              />
              <MiniMetric 
                label="21 Días" 
                value={stats.avg21HRV} 
                unit="ms" 
              />
            </div>
            
            <div className="space-y-1">
              {stats.latestBaseline && (() => {
                const { lowUpper, balancedLow, balancedUpper } = stats.latestBaseline;
                const min = Math.max(0, lowUpper - 10);
                const max = balancedUpper + 15;
                const range = max - min;
                const toX = v => `${((v - min) / range * 100).toFixed(1)}%`;
                const hrv = stats.latestHRV;
                return (
                  <>
                    <div className="relative w-full h-3">
                      <div className="absolute h-1.5 top-0.5 rounded-l-full bg-red-200" style={{ left: '0', width: toX(lowUpper) }} />
                      <div className="absolute h-1.5 top-0.5 bg-emerald-200" style={{ left: toX(balancedLow), width: `calc(${toX(balancedUpper)} - ${toX(balancedLow)})` }} />
                      <div className="absolute h-1.5 top-0.5 rounded-r-full bg-blue-200" style={{ left: toX(balancedUpper), right: '0' }} />
                      {hrv && hrv >= min && hrv <= max && (
                        <div className="absolute w-2 h-3 top-0 rounded-full bg-slate-700 shadow" style={{ left: `calc(${toX(hrv)} - 4px)` }} />
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mb-1">Zona equilibrio: {balancedLow}–{balancedUpper} ms</p>
                  </>
                );
              })()}
              
              <div className={`flex items-center justify-between text-xs text-slate-400 pt-1 ${stats.latestBaseline ? 'border-t border-slate-100' : ''}`}>
                <span>Media histórica: <span className="font-semibold text-slate-600">{stats.avgHRV} ms</span></span>
              </div>

              {stats.bestHRVMonth && (
                <div className="flex gap-3 text-xs pt-1 border-t border-slate-100">
                  <span className="text-emerald-600">↑ Mejor: <span className="font-semibold">{stats.bestHRVMonth.label}</span> · {stats.bestHRVMonth.avgHRV}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-orange-500">↓ Peor: <span className="font-semibold">{stats.worstHRVMonth.label}</span> · {stats.worstHRVMonth.avgHRV}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* FC reposo */}
        {stats?.hasHR && (
          <div className="bg-white/60 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 rounded-3xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400 font-medium tracking-wide uppercase">FC Reposo</span>
              {stats.avg21HR && stats.avgHR && (
                <span className={`text-xs font-semibold ${+stats.avg21HR > +stats.avgHR ? 'text-red-500' : 'text-emerald-500'}`}>
                  {+stats.avg21HR > +stats.avgHR ? '▲' : '▼'} {Math.abs(+stats.avg21HR - +stats.avgHR).toFixed(1)} vs media
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <MiniMetric 
                label="Hoy" 
                value={stats.latestHR} 
                unit="ppm" 
                colorClass="text-orange-500" 
                trend={stats.latestHR && stats.avg7HR ? stats.latestHR - stats.avg7HR : null}
                isInverse={true}
              />
              <MiniMetric 
                label="7 Días" 
                value={stats.avg7HR} 
                unit="ppm" 
                trend={stats.avg7HR && stats.avg21HR ? stats.avg7HR - stats.avg21HR : null}
                isInverse={true}
              />
              <MiniMetric 
                label="21 Días" 
                value={stats.avg21HR} 
                unit="ppm" 
              />
            </div>

            <div className="flex flex-col gap-1 pt-1 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Media histórica: <span className="font-semibold text-slate-600">{stats.avgHR} ppm</span></span>
                <span className={`font-semibold ${trendHRAccent === 'red' ? 'text-red-500' : 'text-blue-500'}`}>
                  {trendHRSign}{stats.trendHR} ppm/año
                </span>
              </div>
              {stats.bestHRMonth && (
                <div className="flex gap-3 text-xs pt-1">
                  <span className="text-emerald-600">↓ Mejor: <span className="font-semibold">{stats.bestHRMonth.label}</span> · {stats.bestHRMonth.avgHR}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-orange-500">↑ Peor: <span className="font-semibold">{stats.worstHRMonth.label}</span> · {stats.worstHRMonth.avgHR}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Body Battery */}
        {stats?.hasBB && (
          <div className="bg-white/60 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 rounded-3xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400 font-medium tracking-wide uppercase">Body Battery (Máx)</span>
              {stats.latestBBLow != null && (
                <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                  Mín hoy: {stats.latestBBLow}
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <MiniMetric 
                label="Hoy" 
                value={stats.latestBBHigh} 
                colorClass={+stats.latestBBHigh >= 70 ? 'text-emerald-500' : +stats.latestBBHigh >= 45 ? 'text-blue-500' : 'text-orange-500'} 
                trend={stats.latestBBHigh && stats.avg7BBHigh ? stats.latestBBHigh - stats.avg7BBHigh : null}
              />
              <MiniMetric 
                label="7 Días" 
                value={stats.avg7BBHigh} 
                trend={stats.avg7BBHigh && stats.avg21BBHigh ? stats.avg7BBHigh - stats.avg21BBHigh : null}
              />
              <MiniMetric 
                label="21 Días" 
                value={stats.avg21BBHigh} 
              />
            </div>

            <div className="space-y-1.5 pt-1 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Media histórica: <span className="font-semibold text-slate-600">{stats.avgBBHigh}/100</span></span>
              </div>
              {stats.bestBBMonth && (
                <div className="flex gap-3 text-xs pt-1">
                  <span className="text-emerald-600">↑ Mejor: <span className="font-semibold">{stats.bestBBMonth.label}</span> · {stats.bestBBMonth.avgBB}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-orange-500">↓ Peor: <span className="font-semibold">{stats.worstBBMonth.label}</span> · {stats.worstBBMonth.avgBB}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Fila 2: Tendencias y correlación ─────────────────────────── */}
      {(stats?.hasHRV || stats?.hasHR) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats?.hasHRV && (
            <div className="bg-white/60 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 rounded-3xl p-4 flex flex-col gap-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide uppercase">Tendencia VFC</span>
              <div className={`text-2xl font-bold leading-tight ${trendHRVAccent === 'blue' ? 'text-blue-500' : 'text-orange-500'}`}>
                {trendHRVSign}{stats.trendHRV ?? '—'}
                {stats.trendHRV && <span className="text-xs font-semibold text-slate-400 ml-1">ms/año</span>}
              </div>
              <span className="text-xs text-slate-400">{+stats.trendHRV > 0 ? '↑ Mejorando con el tiempo' : '↓ Bajando con el tiempo'}</span>
            </div>
          )}
          {stats?.hasHR && (
            <div className="bg-white/60 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 rounded-3xl p-4 flex flex-col gap-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide uppercase">Tendencia FC</span>
              <div className={`text-2xl font-bold leading-tight ${trendHRAccent === 'red' ? 'text-red-500' : 'text-blue-500'}`}>
                {trendHRSign}{stats.trendHR ?? '—'}
                {stats.trendHR && <span className="text-xs font-semibold text-slate-400 ml-1">ppm/año</span>}
              </div>
              <span className="text-xs text-slate-400">{+stats.trendHR > 0 ? '↑ Sube — revisar carga' : '↓ Baja — buena adaptación'}</span>
            </div>
          )}
          {stats?.hasHRV && stats?.hasHR && stats.corr && (
            <div className="bg-white/60 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 rounded-3xl p-4 flex flex-col gap-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide uppercase">Correlación VFC↔FC</span>
              <div className={`text-2xl font-bold leading-tight ${Math.abs(+stats.corr) > 0.6 ? 'text-blue-600' : 'text-slate-500'}`}>
                r = {stats.corr}
              </div>
              <span className="text-xs text-slate-400">{+stats.corr < -0.6 ? '✓ Inversa fuerte — señal sana' : +stats.corr < -0.4 ? 'Inversa moderada' : 'Correlación débil'}</span>
            </div>
          )}
          {stats?.hasHRV && stats?.avg21HRV && stats?.avgHRV && (
            <div className="bg-white/60 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 rounded-3xl p-4 flex flex-col gap-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide uppercase">VFC 21d vs histórica</span>
              {(() => {
                const delta = (+stats.avg21HRV - +stats.avgHRV).toFixed(1);
                const pct   = ((+stats.avg21HRV - +stats.avgHRV) / +stats.avgHRV * 100).toFixed(0);
                const good  = +delta >= 0;
                return (
                  <>
                    <div className={`text-2xl font-bold leading-tight ${good ? 'text-emerald-500' : 'text-orange-500'}`}>
                      {good ? '+' : ''}{delta} ms
                    </div>
                    <span className="text-xs text-slate-400">{good ? `▲ ${pct}% sobre tu media` : `▼ ${Math.abs(pct)}% bajo tu media`}</span>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white/60 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 rounded-3xl p-5">
          {/* Legend / toggles */}
          <div className="flex items-center gap-4 mb-5 flex-wrap">
            {latestReadiness != null && (
              <button
                onClick={() => setShowReadiness(v => !v)}
                className={`flex items-center gap-2 text-xs font-medium transition-opacity ${showReadiness ? 'opacity-100' : 'opacity-35'}`}
              >
                <span className="w-6 h-0.5 bg-yellow-500 inline-block rounded-full shadow-[0_0_8px_rgba(234,179,8,0.8)]" />
                <span className="text-slate-600 font-bold">Readiness Score</span>
              </button>
            )}
            {stats?.hasHRV && (
              <button
                onClick={() => setShowHRV(v => !v)}
                className={`flex items-center gap-2 text-xs font-medium transition-opacity ${showHRV ? 'opacity-100' : 'opacity-35'}`}
              >
                <span className="w-6 h-0.5 bg-blue-500 inline-block rounded-full" />
                <span className="text-slate-600">VFC nocturna (ms)</span>
              </button>
            )}
            {stats?.hasHR && (
              <button
                onClick={() => setShowHR(v => !v)}
                className={`flex items-center gap-2 text-xs font-medium transition-opacity ${showHR ? 'opacity-100' : 'opacity-35'}`}
              >
                <span className="w-6 h-0.5 bg-orange-400 inline-block rounded-full" />
                <span className="text-slate-600">FC reposo (ppm)</span>
              </button>
            )}
            {stats?.hasBB && (
              <>
                <button
                  onClick={() => setShowBBHigh(v => !v)}
                  className={`flex items-center gap-2 text-xs font-medium transition-opacity ${showBBHigh ? 'opacity-100' : 'opacity-35'}`}
                >
                  <span className="w-6 h-0.5 bg-emerald-500 inline-block rounded-full" />
                  <span className="text-slate-600">BB máx</span>
                </button>
                <button
                  onClick={() => setShowBBLow(v => !v)}
                  className={`flex items-center gap-2 text-xs font-medium transition-opacity ${showBBLow ? 'opacity-100' : 'opacity-35'}`}
                >
                  <span className="w-6 h-4 inline-flex items-center">
                    <span className="w-6 border-t-2 border-dashed border-emerald-400 inline-block" />
                  </span>
                  <span className="text-slate-600">BB mín</span>
                </button>
              </>
            )}
            {sleepData?.length > 0 && (
              <button
                onClick={() => setShowSleep(v => !v)}
                className={`flex items-center gap-2 text-xs font-medium transition-opacity ${showSleep ? 'opacity-100' : 'opacity-35'}`}
              >
                <span className="w-6 h-0.5 bg-indigo-500 inline-block rounded-full" />
                <span className="text-slate-600">Sueño (pts)</span>
              </button>
            )}
            {bothVisible && (
              <button
                onClick={() => setNormalizeChart(v => !v)}
                title="Normalizar VFC y FC al mismo eje para comparar tendencias"
                className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg border transition-all ${
                  normalizeChart
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                }`}
              >
                ~%
              </button>
            )}
            <button
              onClick={() => setShowBaseline(v => !v)}
              className={`flex items-center gap-1.5 text-xs font-medium transition-opacity ${showBaseline ? 'opacity-100' : 'opacity-35'}`}
            >
              <span className="w-6 h-4 inline-flex items-center">
                <span className="w-6 border-t-2 border-dashed border-slate-400 inline-block" />
              </span>
              <span className="text-slate-600 font-bold">Línea Base (21d)</span>
            </button>
            <div className="ml-auto flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              {[['day','Día'],['week','Sem'],['month','Mes']].map(([g, label]) => (
                <button
                  key={g}
                  onClick={() => setChartGranularity(g)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    chartGranularity === g
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="w-full relative z-10" style={{ aspectRatio: '16/7' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart key={chartGranularity} data={chartData} margin={{ top: 12, right: hrAxisOnly ? 8 : 24, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorHrv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorHr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorBb" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorSleep" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorReadiness" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#eab308" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#eab308" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#64748b', fontWeight: 500 }}
                interval="preserveStartEnd"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
              />
              {useNorm ? (
                <YAxis
                  yAxisId="norm"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `${v}%`}
                />
              ) : (
                <>
                  {(stats?.hasHRV && showHRV) || (showReadiness) ? (
                    <YAxis
                      yAxisId="hrv"
                      orientation="left"
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 10, fill: '#3b82f6' }}
                      tickLine={false}
                      axisLine={false}
                      label={{ value: 'ms / pts', angle: -90, position: 'insideLeft', style: { fill: '#3b82f6', fontSize: 10 } }}
                    />
                  ) : null}
                  {stats?.hasHR && showHR && (
                    <YAxis
                      yAxisId="hr"
                      orientation={hrAxisOnly ? 'left' : 'right'}
                      reversed={!hrAxisOnly}
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 10, fill: '#f97316' }}
                      tickLine={false}
                      axisLine={false}
                      label={{ value: 'ppm', angle: -90, position: 'insideLeft', style: { fill: '#f97316', fontSize: 10 } }}
                    />
                  )}
                </>
              )}
              {stats?.hasBB && (showBBHigh || showBBLow) && (
                <YAxis
                  yAxisId="bb"
                  orientation="right"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#10b981' }}
                  tickLine={false}
                  axisLine={false}
                />
              )}
              {sleepData?.length > 0 && showSleep && !useNorm && (
                <YAxis
                  yAxisId="sleep"
                  orientation="right"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#6366f1' }}
                  tickLine={false}
                  axisLine={false}
                  hide={true}
                />
              )}
              <Tooltip content={<CustomTooltip />} />
              {stats?.hasHRV && showHRV && showBaseline && (
                <Line
                  yAxisId={useNorm ? 'norm' : 'hrv'}
                  type="monotone"
                  dataKey={useNorm ? 'baselineHrvNorm' : 'baselineHrv'}
                  name={useNorm ? 'Base VFC (norm.)' : 'Base VFC (21d)'}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={false}
                  connectNulls
                />
              )}
              {stats?.hasHRV && showHRV && (
                <Area
                  yAxisId={useNorm ? 'norm' : 'hrv'}
                  type="monotone"
                  dataKey={useNorm ? 'hrvNorm' : 'hrv'}
                  name={useNorm ? 'VFC (norm.)' : 'VFC (ms)'}
                  stroke="#3b82f6"
                  fill="url(#colorHrv)"
                  strokeWidth={3}
                  dot={{ r: 0 }}
                  activeDot={{ r: 6, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2, shadow: '0 0 10px rgba(59,130,246,0.5)' }}
                  connectNulls
                />
              )}
              {stats?.hasHR && showHR && showBaseline && (
                <Line
                  yAxisId={useNorm ? 'norm' : 'hr'}
                  type="monotone"
                  dataKey={useNorm ? 'baselineHrNorm' : 'baselineHr'}
                  name={useNorm ? 'Base FC (norm.)' : 'Base FC (21d)'}
                  stroke="#f97316"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={false}
                  connectNulls
                />
              )}
              {stats?.hasHR && showHR && (
                <Area
                  yAxisId={useNorm ? 'norm' : 'hr'}
                  type="monotone"
                  dataKey={useNorm ? 'hrNorm' : 'restingHR'}
                  name={useNorm ? 'FC inv. (norm.)' : 'FC reposo (ppm)'}
                  stroke="#f97316"
                  fill="url(#colorHr)"
                  strokeWidth={3}
                  dot={{ r: 0 }}
                  activeDot={{ r: 6, fill: '#f97316', stroke: '#fff', strokeWidth: 2 }}
                  connectNulls
                />
              )}
              {stats?.hasBB && showBBHigh && (
                <Area
                  yAxisId="bb"
                  type="monotone"
                  dataKey="bbHigh"
                  name="BB máx"
                  stroke="#10b981"
                  fill="url(#colorBb)"
                  strokeWidth={2}
                  dot={{ r: 0 }}
                  activeDot={{ r: 5, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
                  connectNulls
                />
              )}
              {stats?.hasBB && showBBLow && (
                <Line
                  yAxisId="bb"
                  type="monotone"
                  dataKey="bbLow"
                  name="BB mín"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={{ r: 4, fill: '#10b981', strokeWidth: 0 }}
                  connectNulls
                />
              )}
              {sleepData?.length > 0 && showSleep && (
                <Area
                  yAxisId={useNorm ? 'norm' : 'sleep'}
                  type="monotone"
                  dataKey={useNorm ? 'sleepNorm' : 'sleepScore'}
                  name="Puntuación Sueño"
                  stroke="#6366f1"
                  fill="url(#colorSleep)"
                  strokeWidth={3}
                  dot={{ r: 0 }}
                  activeDot={{ r: 6, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                  connectNulls
                />
              )}
              {showReadiness && (
                <Area
                  yAxisId={useNorm ? 'norm' : 'hrv'}
                  type="monotone"
                  dataKey="readinessScore"
                  name="Readiness Score"
                  stroke="#eab308"
                  fill="url(#colorReadiness)"
                  strokeWidth={4}
                  dot={{ r: 0 }}
                  activeDot={{ r: 7, fill: '#eab308', stroke: '#fff', strokeWidth: 2, shadow: '0 0 12px rgba(234,179,8,0.8)' }}
                  connectNulls
                />
              )}
              {chartData.length > 10 && (
                <Brush
                  key={`brush-${chartGranularity}-${chartData.length}`}
                  dataKey="label"
                  height={24}
                  stroke="#e2e8f0"
                  fill="#f8fafc"
                  travellerWidth={6}
                  startIndex={
                    chartGranularity === 'day' ? Math.max(0, chartData.length - 180) :
                    chartGranularity === 'week' ? Math.max(0, chartData.length - 26) :
                    Math.max(0, chartData.length - 6)
                  }
                  tickFormatter={() => ''}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
          </div>

          {stats?.hasHRV && stats?.hasHR && stats.corr && (
            <p className="text-center text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100">
              Correlación VFC↔FC reposo:{' '}
              <span className="text-blue-600 font-semibold">r = {stats.corr}</span>
              {+stats.corr < -0.5 && (
                <span className="text-slate-400"> — relación inversa esperada: buena señal fisiológica</span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Reading guide */}
      {stats?.hasHRV && stats?.hasHR && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
          <p className="font-semibold text-slate-600">Cómo leer el gráfico principal</p>
          <p>Correlación negativa fuerte (r &lt; −0.7): cuando sube VFC, baja FC reposo — señal de buena recuperación.</p>
        </div>
      )}

      {/* ── Índice de Adaptación (VFC - FC) ─────────────────────────────── */}
      {stats?.hasHRV && stats?.hasHR && chartData.length > 0 && (
        <div className="bg-white/60 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 rounded-3xl p-5 mt-5">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Adaptación (VFC - FC Reposo)</span>
            <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">↑ Valores altos = Mejor recuperación</span>
            <div className="ml-auto flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              {[['day','Día'],['week','Sem'],['month','Mes']].map(([g, label]) => (
                <button
                  key={g}
                  onClick={() => setChartGranularity(g)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    chartGranularity === g
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="w-full relative z-10" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAdaptation" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickMargin={10} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                {adaptationLimits && (
                  <>
                    <ReferenceArea y1={adaptationLimits.lower} y2={adaptationLimits.upper} fill="#94a3b8" fillOpacity={0.05} />
                    <ReferenceLine y={adaptationLimits.upper} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.6} label={{ position: 'insideTopLeft', value: '↑ Rango Óptimo', fill: '#10b981', fontSize: 10 }} />
                    <ReferenceLine y={adaptationLimits.lower} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} label={{ position: 'insideBottomLeft', value: '↓ Rango Bajo (Fatiga)', fill: '#ef4444', fontSize: 10 }} />
                  </>
                )}
                <Tooltip
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="bg-white/90 backdrop-blur-xl border border-white/40 rounded-xl p-3 text-xs shadow-lg">
                        <p className="font-bold text-slate-800 mb-1">{label}</p>
                        {payload.map((p, idx) => (
                          <p key={idx} className={`${p.dataKey === 'hrvMinusHr' ? 'text-emerald-600' : 'text-slate-600'} font-semibold text-sm`}>
                            {p.dataKey === 'hrvMinusHr' ? 'Adaptación:' : 'Media 7d:'} {p.value}
                          </p>
                        ))}
                        <p className="text-slate-400 text-[10px] mt-1">VFC - FC</p>
                      </div>
                    ) : null
                  }
                />
                <Area 
                  type="monotone" 
                  dataKey="hrvMinusHr" 
                  name="Adaptación Diaria"
                  stroke="#10b981" 
                  fill="url(#colorAdaptation)" 
                  strokeWidth={2} 
                  dot={{ r: 0 }} 
                  activeDot={{ r: 5, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }} 
                  connectNulls 
                />
                <Line
                  type="monotone"
                  dataKey="avg7Adaptation"
                  name="Media 7d"
                  stroke="#334155"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={false}
                  connectNulls
                />
                {chartData.length > 10 && (
                  <Brush
                    key={`brush-stress-${chartGranularity}-${chartData.length}`}
                    dataKey="label"
                    height={20}
                    stroke="#e2e8f0"
                    fill="#f8fafc"
                    travellerWidth={6}
                    startIndex={
                      chartGranularity === 'day' ? Math.max(0, chartData.length - 180) :
                      chartGranularity === 'week' ? Math.max(0, chartData.length - 26) :
                      Math.max(0, chartData.length - 6)
                    }
                    tickFormatter={() => ''}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Sleep section ──────────────────────────────────────────────── */}
      {sleepData?.length > 0 && <SleepSection sleepData={sleepData} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sleep section component
// ---------------------------------------------------------------------------
const QUALITY_COLOR = {
  EXCELLENT: 'text-emerald-600',
  GOOD:      'text-blue-600',
  FAIR:      'text-amber-600',
  POOR:      'text-red-500',
};
const QUALITY_LABEL = {
  EXCELLENT: 'Excelente',
  GOOD:      'Buena',
  FAIR:      'Regular',
  POOR:      'Pobre',
};

function fmtDur(min) {
  if (min == null) return '—';
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function SleepSection({ sleepData }) {
  const [view, setView] = useState('score'); // 'score' | 'stages'

  const recentWeeks = sleepData.slice(-12);

  const avgScore = sleepData.length
    ? Math.round(sleepData.reduce((s, w) => s + (w.score ?? 0), 0) / sleepData.filter(w => w.score).length)
    : null;
  const avgDur = sleepData.filter(w => w.durationMin).length
    ? Math.round(sleepData.reduce((s, w) => s + (w.durationMin ?? 0), 0) / sleepData.filter(w => w.durationMin).length)
    : null;
  const latestWeek = sleepData[sleepData.length - 1];

  const chartData = recentWeeks.map(w => ({
    label: w.weekStart.slice(5), // MM-DD
    score:  w.score,
    deep:   w.deepMin,
    rem:    w.remMin,
    light:  w.lightMin,
    awake:  w.awakeMin,
    dur:    w.durationMin,
  }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center">
          <MoonIcon className="w-4 h-4 text-indigo-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900 leading-tight">Sueño · Garmin</h2>
          <p className="text-xs text-slate-400">Estadísticas semanales</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Puntuación media" value={avgScore ?? '—'} unit={avgScore ? '/100' : ''} accent="blue" />
        <StatCard label="Duración media" value={fmtDur(avgDur)} accent="slate" />
        <StatCard
          label="Última semana"
          value={latestWeek?.score ?? '—'}
          unit={latestWeek?.score ? '/100' : ''}
          accent={latestWeek?.score >= 80 ? 'green' : latestWeek?.score >= 60 ? 'blue' : 'orange'}
          sub={latestWeek?.quality ? (QUALITY_LABEL[latestWeek.quality] ?? latestWeek.quality) : undefined}
        />
        <StatCard
          label="Sueño profundo"
          value={latestWeek?.deepMin != null ? fmtDur(latestWeek.deepMin) : '—'}
          accent="blue"
          sub={latestWeek?.remMin != null ? `REM: ${fmtDur(latestWeek.remMin)}` : undefined}
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            {[['score','Puntuación'],['stages','Fases']].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-slate-400">últimas {recentWeeks.length} semanas</span>
        </div>

        {view === 'score' ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorSleepScore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b', fontWeight: 500 }} tickLine={false} axisLine={false} tickMargin={10} />
              <YAxis domain={[40, 100]} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="bg-white/90 backdrop-blur-xl border border-white/40 rounded-2xl p-4 text-xs shadow-xl">
                      <p className="font-bold text-slate-800 mb-2 border-b border-slate-100 pb-1">Sem {label}</p>
                      <p className="text-indigo-600 font-extrabold text-lg">{payload[0]?.value} <span className="text-sm font-semibold text-slate-400">/ 100</span></p>
                      {payload[0]?.payload?.dur && <p className="text-slate-500 font-medium mt-1">{fmtDur(payload[0].payload.dur)}</p>}
                    </motion.div>
                  ) : null
                }
              />
              <ReferenceLine y={80} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: 'Excelente', position: 'insideTopLeft', fontSize: 10, fill: '#10b981', fontWeight: 600 }} />
              <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: 'Regular', position: 'insideTopLeft', fontSize: 10, fill: '#f59e0b', fontWeight: 600 }} />
              <Area type="monotone" dataKey="score" name="Puntuación" stroke="#6366f1" fill="url(#colorSleepScore)" strokeWidth={3}
                dot={{ r: 0 }} activeDot={{ r: 6, fill: '#6366f1', stroke: '#fff', strokeWidth: 2, shadow: '0 0 10px rgba(99,102,241,0.5)' }} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis tickFormatter={v => `${Math.floor(v/60)}h`} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs shadow-lg space-y-0.5">
                      <p className="font-semibold text-slate-700 mb-1">Sem {label}</p>
                      {payload.map(p => (
                        <div key={p.dataKey} className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: p.fill }} />
                          <span className="text-slate-500">{p.name}:</span>
                          <span className="font-bold text-slate-700">{fmtDur(p.value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="deep"  name="Profundo" stackId="s" fill="#3b82f6" radius={[0,0,0,0]} />
              <Bar dataKey="rem"   name="REM"      stackId="s" fill="#8b5cf6" />
              <Bar dataKey="light" name="Ligero"   stackId="s" fill="#93c5fd" />
              <Bar dataKey="awake" name="Despierto" stackId="s" fill="#fca5a5" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
