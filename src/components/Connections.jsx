import { useState } from 'react';
import {
  ArrowPathIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, CheckCircleIcon,
  ExclamationTriangleIcon, HeartIcon, KeyIcon, LockClosedIcon, TrashIcon, UserIcon,
} from '@heroicons/react/24/outline';
import useGarminConnection from '../hooks/useGarminConnection';

// ─────────────────────────────────────────────────────────────────────────────
// Ajustes › Conexiones. Reúne lo que la app necesita de terceros: la cuenta de
// Strava (de dónde vienen las actividades) y la de Garmin Connect (FC reposo,
// VFC, sueño y las actividades con running dynamics).
//
// El formulario de Garmin, el sync manual y el import/export del JSON vivían
// dentro de `GarminCardiac`, que es una vista de análisis. El menú de usuario
// mandaba literalmente al atleta a una pantalla de métricas para vincular el
// reloj. Aquí es donde se espera encontrarlos; `GarminCardiac` solo lee.
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD_PRESETS = [
  { label: '7 días', days: 7 },
  { label: '1 mes', days: 30 },
  { label: '3 meses', days: 90 },
  { label: '6 meses', days: 180 },
  { label: '1 año', days: 365 },
];

const IMPORT_PRESETS = [
  { label: '7D', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1A', days: 365 },
  { label: '2A', days: 730 },
  { label: '3A', days: 1095 },
  { label: '5A', days: 1825 },
];

// La descarga va por bloques y tarda ~0,25 s por día: avisarlo antes de empezar
// evita que un "5 años" parezca que se ha quedado colgado.
const estMinutes = (days) => Math.max(1, Math.ceil((days * 0.25) / 60));

const PeriodSelector = ({ value, onChange, label }) => {
  const isPreset = IMPORT_PRESETS.some(p => p.days === value);
  const [customDays, setCustomDays] = useState(isPreset ? '' : String(value));

  const handleCustom = (e) => {
    const raw = e.target.value;
    setCustomDays(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) onChange(parsed);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</label>
        <span className="text-xs text-slate-400 flex items-center gap-1.5">
          <span className="font-semibold text-slate-700">{value} días</span>
          {value > 30 && (
            <span className="bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-md font-medium">
              ~{estMinutes(value)} min
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="flex bg-slate-100 p-1 rounded-xl overflow-x-auto no-scrollbar">
          {IMPORT_PRESETS.map(p => (
            <button
              key={p.days}
              type="button"
              onClick={() => { setCustomDays(''); onChange(p.days); }}
              className={`flex-1 min-w-[40px] px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                value === p.days
                  ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200/50'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="number"
          min="1"
          value={customDays}
          onChange={handleCustom}
          placeholder="días"
          className="w-full sm:w-24 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 tabular-nums text-center placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
      </div>
    </div>
  );
};

const SectionCard = ({ icon: Icon, tint, title, subtitle, children, right = null }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${tint}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900 leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
    {children}
  </div>
);

const ErrorNote = ({ message }) => (
  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start gap-2">
    <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
    <span>
      {message}
      {message.includes('3001') && (
        <span className="block mt-1 text-red-500 text-xs">
          ¿Arrancaste el servidor? <code className="bg-red-100 rounded px-1">npm run server</code>
        </span>
      )}
    </span>
  </div>
);

const Progress = ({ progress }) => (
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
);

export default function Connections({ stravaData, onConnectStrava }) {
  const {
    creds, data, sleepData, lastSync,
    loading, progress, error,
    connect, sync, disconnect, exportJson, importJson,
  } = useGarminConnection();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [daysToFetch, setDaysToFetch] = useState(365);
  const [syncDays, setSyncDays] = useState(30);

  const stravaConnected = Boolean(stravaData?.accessToken);
  const stravaCount = stravaData?.activities?.length ?? 0;

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    await connect(username, password, daysToFetch);
  };

  return (
    <div className="max-w-3xl space-y-5">

      {/* ── Strava ─────────────────────────────────────────────────────────── */}
      <SectionCard
        icon={ArrowPathIcon}
        tint="bg-orange-50 text-orange-500"
        title="Strava"
        subtitle="Actividades, parciales y mejores esfuerzos"
        right={
          stravaConnected ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <CheckCircleIcon className="w-4 h-4" /> Conectado
            </span>
          ) : (
            <button
              onClick={onConnectStrava}
              className="h-8 px-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-colors"
            >
              Conectar con Strava
            </button>
          )
        }
      >
        {stravaConnected ? (
          <div className="flex flex-wrap gap-2.5 text-xs">
            <span className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5">
              <span className="text-slate-400">Actividades guardadas </span>
              <span className="font-bold text-slate-700 tabular-nums">{stravaCount}</span>
            </span>
            <span className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5">
              <span className="text-slate-400">Último listado </span>
              <span className="font-bold text-slate-700">{stravaData?.lastFetchDate ?? '—'}</span>
            </span>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Sin Strava no hay actividades: es la fuente de los entrenamientos, los parciales y los
            mejores esfuerzos sobre los que se calcula todo lo demás.
          </p>
        )}
      </SectionCard>

      {/* ── Garmin ─────────────────────────────────────────────────────────── */}
      <SectionCard
        icon={HeartIcon}
        tint="bg-rose-50 text-rose-500"
        title="Garmin Connect"
        subtitle="FC reposo, VFC nocturna, sueño y running dynamics"
        right={
          data ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <CheckCircleIcon className="w-4 h-4" /> Conectado
            </span>
          ) : null
        }
      >
        {!data ? (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-1">
              <p className="flex items-center gap-1.5 font-semibold text-amber-900">
                <LockClosedIcon className="w-4 h-4 shrink-0" />
                Tus credenciales no salen del servidor local
              </p>
              <p className="text-amber-700 text-xs leading-relaxed">
                Se usan únicamente para autenticarte en Garmin Connect y descargar FC reposo, VFC y
                sueño — nada más va a internet.
              </p>
            </div>

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

              {error && <ErrorNote message={error} />}
              {loading && progress && <Progress progress={progress} />}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl px-4 py-3 text-sm transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg disabled:shadow-none"
              >
                {loading ? (
                  <><ArrowPathIcon className="w-4 h-4 animate-spin" /> Descargando…</>
                ) : (
                  <><HeartIcon className="w-4 h-4" /> Conectar con Garmin y descargar datos</>
                )}
              </button>
            </form>

            <p className="text-xs text-slate-400 text-center">
              Servidor proxy requerido:{' '}
              <code className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">npm run server</code>
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2.5 text-xs">
              <span className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5">
                <span className="text-slate-400">Cuenta </span>
                <span className="font-bold text-slate-700">{creds?.username ?? '—'}</span>
              </span>
              <span className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5">
                <span className="text-slate-400">Días de salud </span>
                <span className="font-bold text-slate-700 tabular-nums">{data.length}</span>
              </span>
              <span className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5">
                <span className="text-slate-400">Noches de sueño </span>
                <span className="font-bold text-slate-700 tabular-nums">{sleepData?.length ?? 0}</span>
              </span>
              <span className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5">
                <span className="text-slate-400">Último sync </span>
                <span className="font-bold text-slate-700">{lastSync ?? '—'}</span>
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
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
                  onClick={() => sync(syncDays)}
                  disabled={loading}
                  className="h-8 px-2.5 rounded-r-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600 flex items-center gap-1 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-500' : ''}`} />
                  {loading ? 'Sync…' : 'Sincronizar'}
                </button>
              </div>

              <button
                onClick={exportJson}
                title="Exportar la salud de Garmin como JSON"
                className="h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors"
              >
                <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                Exportar JSON
              </button>

              <label
                title="Importar un JSON de salud de Garmin"
                className="h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer"
              >
                <ArrowUpTrayIcon className="w-3.5 h-3.5" />
                Importar JSON
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => { importJson(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>

              <button
                onClick={disconnect}
                className="h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 flex items-center gap-1.5 text-xs font-medium transition-colors"
              >
                <TrashIcon className="w-3.5 h-3.5" />
                Desconectar
              </button>
            </div>

            {error && <ErrorNote message={error} />}
            {loading && progress && <Progress progress={progress} />}
          </>
        )}
      </SectionCard>

      <p className="text-xs text-slate-400 leading-relaxed">
        El botón de sincronizar de la barra superior refresca los dos carriles a la vez (Strava y
        después Garmin). El sync de aquí es el específico de la salud de Garmin, con el período que
        elijas.
      </p>
    </div>
  );
}
