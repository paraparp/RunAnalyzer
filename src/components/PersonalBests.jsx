import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { TrophyIcon as TrophyIconSolid } from '@heroicons/react/24/solid';

const RANGES = [
  { id: '5k',  min: 4900,  max: 5200  },
  { id: '10k', min: 9900,  max: 10500 },
  { id: 'hm',  min: 21000, max: 21500 },
  { id: 'fm',  min: 42000, max: 43000 },
];

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

function DistanceRecord({ record }) {
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
            {formatTime(pr.elapsed_time || pr.moving_time)}
          </span>
          <span className="text-xs font-semibold text-slate-400">{formatPace(pr.distance / (pr.elapsed_time || pr.moving_time))}/km</span>
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
              Top {record.top.length} carreras
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
                    <p className="text-sm font-bold text-slate-800 tabular-nums">{formatTime(a.elapsed_time || a.moving_time)}</p>
                    <p className="text-[10px] text-slate-400">{formatPace(a.distance / (a.elapsed_time || a.moving_time))}/km</p>
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

const PersonalBests = ({ activities }) => {
  const { t } = useTranslation();

  const records = useMemo(() => {
    if (!activities || activities.length === 0) return [];

    return RANGES.map(range => {
      const matches = activities
        .filter(a => a.distance >= range.min && a.distance <= range.max && (a.elapsed_time || a.moving_time) > 0)
        .sort((a, b) => {
          // sort by pace = elapsed_time / distance (lower = faster)
          const paceA = (a.elapsed_time || a.moving_time) / a.distance;
          const paceB = (b.elapsed_time || b.moving_time) / b.distance;
          return paceA - paceB;
        })
        .slice(0, 5);

      if (matches.length === 0) return null;

      return {
        id: range.id,
        name: t(`dashboard.records.${range.id}`),
        top: matches,
      };
    }).filter(Boolean);
  }, [activities, t]);

  if (records.length === 0) return null;

  return (
    <div className="space-y-3">
      {records.map(record => (
        <DistanceRecord key={record.id} record={record} />
      ))}
    </div>
  );
};

export default PersonalBests;
