import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { TrophyIcon as TrophyIconSolid } from '@heroicons/react/24/solid';

const RANGES = [
  { id: '5k',  min: 4900,  max: 5200,  effortNames: ['5k'] },
  { id: '10k', min: 9900,  max: 10500, effortNames: ['10k'] },
  { id: 'hm',  min: 21000, max: 21500, effortNames: ['half-marathon'] },
  { id: 'fm',  min: 42000, max: 43000, effortNames: ['marathon'] },
];

// Un candidato a PB por actividad y distancia. Preferimos el best_effort de
// Strava (mejor tramo continuo dentro de la actividad, calculado sobre el
// stream GPS); si la actividad no está enriquecida, cae a la lógica clásica
// de distancia total dentro del rango.
const getCandidate = (activity, range) => {
  const effort = activity.best_efforts?.find(
    e => range.effortNames.includes(e.name?.toLowerCase()) && (e.elapsed_time || e.moving_time) > 0
  );
  if (effort) {
    return {
      id: activity.id,
      name: activity.name,
      start_date: activity.start_date,
      time: effort.elapsed_time || effort.moving_time,
      distance: effort.distance,
      // Marcar cuando el esfuerzo es un tramo dentro de una tirada más larga
      isEffort: activity.distance > range.max,
    };
  }
  const time = activity.elapsed_time || activity.moving_time;
  if (activity.distance >= range.min && activity.distance <= range.max && time > 0) {
    return {
      id: activity.id,
      name: activity.name,
      start_date: activity.start_date,
      time,
      distance: activity.distance,
      isEffort: false,
    };
  }
  return null;
};

// PBs LLANOS: no vienen de best_efforts (Strava no filtra por desnivel).
// Fuente principal: flat_efforts, el mejor tramo continuo (ventana deslizante
// sobre los streams) precalculado y cacheado por actividad en App.jsx. Como
// fallback —mientras el enriquecido por streams se completa en segundo plano—
// aproximamos con los parciales (splits_metric), agrupando N splits consecutivos.
// effortKey → clave dentro de activity.flat_efforts; splits/min/max/maxElev →
// fallback por parciales. maxElev = desnivel neto máximo tolerado (5m en 1k, 10m en 2k).
const FLAT_RANGES = [
  { id: 'flat1k', effortKey: '1k', splits: 1, min: 950,  max: 1050, maxElev: 5 },
  { id: 'flat2k', effortKey: '2k', splits: 2, min: 1900, max: 2100, maxElev: 10 },
];

// Fallback: mejor tramo llano de una actividad agrupando N parciales (el más
// rápido cuya distancia y desnivel neto acumulados cumplan el criterio).
const getFlatFromSplits = (activity, range) => {
  const splits = activity.splits_metric;
  if (!Array.isArray(splits) || splits.length < range.splits) return null;

  let best = null;
  for (let i = 0; i + range.splits <= splits.length; i++) {
    const window = splits.slice(i, i + range.splits);
    if (window.some(sp => typeof sp.elevation_difference !== 'number')) continue;

    const distance = window.reduce((sum, sp) => sum + sp.distance, 0);
    const elevation = window.reduce((sum, sp) => sum + sp.elevation_difference, 0);
    const time = window.reduce((sum, sp) => sum + (sp.moving_time || sp.elapsed_time || 0), 0);

    if (Math.abs(elevation) > range.maxElev) continue;
    if (distance < range.min || distance > range.max) continue;
    if (time <= 0) continue;

    if (!best || time / distance < best.time / best.distance) {
      best = { time, distance, elevation };
    }
  }
  return best;
};

// Candidato a PB llano: preferimos el cálculo exacto por streams (flat_efforts);
// si aún no está enriquecido, caemos a la aproximación por parciales.
const getFlatCandidate = (activity, range) => {
  const eff = activity.flat_efforts?.[range.effortKey];
  const best = (eff && eff.time > 0) ? eff : getFlatFromSplits(activity, range);
  if (!best) return null;

  return {
    id: activity.id,
    name: activity.name,
    start_date: activity.start_date,
    time: best.time,
    distance: best.distance,
    elevation: best.elevation,
    isEffort: true,
    isFlat: true,
  };
};

const MEDAL_COLORS = ['text-amber-400', 'text-slate-400', 'text-orange-600'];

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPace(speed) {
  if (!speed || speed === 0) return '--:--';
  const pace = 16.6667 / speed;
  const m = Math.floor(pace);
  const s = Math.floor((pace - m) * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function DistanceRecord({ record, t }) {
  const [open, setOpen] = useState(false);
  const pr = record.top[0];
  const rest = record.top.slice(1);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* PR row */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <TrophyIconSolid className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{record.name}</span>
          </div>
          <span className="text-[10px] text-slate-400 shrink-0">{formatDate(pr.start_date)}</span>
        </div>

        {/* Time — big */}
        <div className="flex items-baseline gap-3 mb-1.5">
          <span className="text-3xl font-black text-slate-900 tabular-nums leading-none">
            {formatTime(pr.time)}
          </span>
          <span className="text-xs font-semibold text-slate-400">{formatPace(pr.distance / pr.time)}/km</span>
          {pr.isFlat ? (
            <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5">
              {t('dashboard.records.flat_badge', 'llano')}
            </span>
          ) : pr.isEffort && (
            <span className="text-[9px] font-bold uppercase tracking-wide text-violet-500 bg-violet-50 rounded px-1.5 py-0.5">
              {t('dashboard.records.effort_badge', 'parcial')}
            </span>
          )}
        </div>

        {/* Activity name */}
        <a
          href={`https://www.strava.com/activities/${pr.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline transition-colors truncate max-w-full"
          title={pr.name}
        >
          {pr.name}
        </a>
      </div>

      {/* Toggle button — only if there are more top runs */}
      {rest.length > 0 && (
        <>
          <button
            onClick={() => setOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-2 bg-slate-50 hover:bg-slate-100 border-t border-slate-100 transition-colors"
          >
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
              Top {record.top.length} {t('hr_analysis.filters.runs').toLowerCase()}
            </span>
            <ChevronDownIcon
              className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          </button>

          {open && (
            <div className="divide-y divide-slate-100">
              {rest.map((a, i) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  {/* Position badge */}
                  <span className={`text-[10px] font-black w-5 text-center ${MEDAL_COLORS[i] ?? 'text-slate-300'}`}>
                    {i === 0 ? '🥈' : i === 1 ? '🥉' : `#${i + 2}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <a
                      href={`https://www.strava.com/activities/${a.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-[11px] font-medium text-slate-700 hover:text-blue-600 truncate transition-colors"
                      title={a.name}
                    >
                      {a.name}
                    </a>
                    <span className="text-[10px] text-slate-400">{formatDate(a.start_date)}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-800 tabular-nums">
                      {formatTime(a.time)}
                      {a.isEffort && <span className="ml-1 text-[9px] font-bold text-violet-500 align-middle">✦</span>}
                    </p>
                    <p className="text-[10px] text-slate-400">{formatPace(a.distance / a.time)}/km</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const PersonalBests = ({ activities, horizontal = false }) => {
  const { t } = useTranslation();

  const records = useMemo(() => {
    if (!activities || activities.length === 0) return [];

    const flatRecords = FLAT_RANGES.map(range => {
      const matches = activities
        .map(a => getFlatCandidate(a, range))
        .filter(Boolean)
        .sort((a, b) => a.time / a.distance - b.time / b.distance)
        .slice(0, 5);

      if (matches.length === 0) return null;

      return { id: range.id, name: t(`dashboard.records.${range.id}`), top: matches };
    }).filter(Boolean);

    const distanceRecords = RANGES.map(range => {
      const matches = activities
        .map(a => getCandidate(a, range))
        .filter(Boolean)
        .sort((a, b) => a.time / a.distance - b.time / b.distance)
        .slice(0, 5);

      if (matches.length === 0) return null;

      return {
        id: range.id,
        name: t(`dashboard.records.${range.id}`),
        top: matches,
      };
    }).filter(Boolean);

    return [...flatRecords, ...distanceRecords];
  }, [activities, t]);

  if (records.length === 0) return null;

  return (
    <div className={horizontal
      ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start'
      : 'space-y-3'}>
      {records.map(record => (
        <DistanceRecord key={record.id} record={record} t={t} />
      ))}
    </div>
  );
};

export default PersonalBests;
