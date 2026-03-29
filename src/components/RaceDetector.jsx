import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ScatterChart, Scatter, ZAxis, Cell
} from 'recharts';

const RACE_KEYWORDS = [
  'race', 'carrera', 'maratón', 'marathon', 'media maratón', 'half marathon',
  '10k', '5k', '15k', '21k', '42k', 'competición', 'competition', 'trail',
  'cross', 'campeonato', 'championship', 'gran premio', 'classic', 'clásica',
  'popular', 'nocturna', 'san silvestre', 'parkrun',
];

// Static distance category definitions (no labels — labels are computed inside component via t())
const DISTANCE_CATEGORY_DEFS = [
  { id: '5k', labelKey: null, staticLabel: '5K', min: 4500, max: 5500 },
  { id: '10k', labelKey: null, staticLabel: '10K', min: 9500, max: 10500 },
  { id: '15k', labelKey: null, staticLabel: '15K', min: 14000, max: 16000 },
  { id: 'hm', labelKey: 'races.half_marathon', staticLabel: 'Half Marathon', min: 20000, max: 22000 },
  { id: 'marathon', labelKey: 'races.marathon', staticLabel: 'Marathon', min: 41000, max: 43000 },
  { id: 'other', labelKey: 'races.other', staticLabel: 'Other', min: 0, max: Infinity },
];

function categorizeDistanceDef(meters) {
  for (const cat of DISTANCE_CATEGORY_DEFS) {
    if (cat.id !== 'other' && meters >= cat.min && meters <= cat.max) return cat;
  }
  return DISTANCE_CATEGORY_DEFS[DISTANCE_CATEGORY_DEFS.length - 1];
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPace(minPerKm) {
  if (!minPerKm || minPerKm <= 0 || minPerKm > 15) return '--:--';
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function isLikelyRace(activity, sufferP85) {
  const name = (activity.name || '').toLowerCase();
  const nameMatch = RACE_KEYWORDS.some(kw => name.includes(kw));
  const workoutType = activity.workout_type === 1;
  const highEffort = activity.suffer_score && activity.suffer_score >= sufferP85;

  return nameMatch || workoutType || (highEffort && activity.distance >= 4500);
}

export default function RaceDetector({ activities }) {
  const { t } = useTranslation();
  const [filterDist, setFilterDist] = useState('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // Build distance categories with translated labels
  const DISTANCE_CATEGORIES = useMemo(() => DISTANCE_CATEGORY_DEFS.map(def => ({
    ...def,
    label: def.labelKey ? t(def.labelKey) : def.staticLabel,
  })), [t]);

  const { races, prs, stats, progressionData } = useMemo(() => {
    if (!activities || activities.length === 0) return { races: [], prs: {}, stats: null, progressionData: [] };

    // Calculate suffer score percentile 85
    const scores = activities.filter(a => a.suffer_score > 0).map(a => a.suffer_score).sort((a, b) => a - b);
    const p85 = scores.length > 0 ? scores[Math.floor(scores.length * 0.85)] : Infinity;

    const detected = activities
      .filter(a => a.distance >= 1000 && isLikelyRace(a, p85))
      .map(a => {
        const pace = a.average_speed > 0 ? 16.6667 / a.average_speed : 0;
        const catDef = categorizeDistanceDef(a.distance);
        const catLabel = catDef.labelKey ? t(catDef.labelKey) : catDef.staticLabel;
        return {
          id: a.id,
          name: a.name,
          date: a.start_date,
          dateLabel: new Date(a.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }),
          distance: a.distance,
          km: (a.distance / 1000).toFixed(2),
          time: a.moving_time,
          timeLabel: formatTime(a.moving_time),
          pace,
          paceLabel: formatPace(pace),
          category: { ...catDef, label: catLabel },
          categoryId: catDef.id,
          hr: a.average_heartrate || 0,
          suffer: a.suffer_score || 0,
          elevation: a.total_elevation_gain || 0,
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // PRs by distance category
    const prsByDist = {};
    detected.forEach(r => {
      if (r.categoryId === 'other') return;
      if (!prsByDist[r.categoryId] || r.time < prsByDist[r.categoryId].time) {
        prsByDist[r.categoryId] = r;
      }
    });

    // Progression data by category
    const progression = {};
    detected.forEach(r => {
      if (r.categoryId === 'other') return;
      if (!progression[r.categoryId]) progression[r.categoryId] = [];
      progression[r.categoryId].push({
        date: r.dateLabel,
        dateMs: new Date(r.date).getTime(),
        pace: r.pace,
        paceLabel: r.paceLabel,
        time: r.time,
        timeLabel: r.timeLabel,
        name: r.name,
      });
    });
    Object.values(progression).forEach(arr => arr.sort((a, b) => a.dateMs - b.dateMs));

    const totalRaces = detected.length;
    const thisYear = detected.filter(r => new Date(r.date).getFullYear() === new Date().getFullYear()).length;
    const lastRace = detected.length > 0 ? detected[0] : null;

    return {
      races: detected,
      prs: prsByDist,
      stats: { totalRaces, thisYear, lastRace, prCount: Object.keys(prsByDist).length },
      progressionData: progression,
    };
  }, [activities, t]);

  const filteredRaces = useMemo(() => {
    setPage(1); // reset to first page when filter changes
    if (filterDist === 'all') return races;
    return races.filter(r => r.categoryId === filterDist);
  }, [races, filterDist]);

  const totalPages = Math.ceil(filteredRaces.length / PAGE_SIZE);
  const pagedRaces = filteredRaces.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (!races.length) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-sm">{t('races.no_data')}</p>
        <p className="text-xs mt-2">{t('races.no_data_hint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('races.total_races')}</p>
          <p className="text-2xl font-black text-slate-900 tabular-nums">{stats.totalRaces}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t('races.detected')}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('races.this_year')}</p>
          <p className="text-2xl font-black text-blue-600 tabular-nums">{stats.thisYear}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{new Date().getFullYear()}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('races.distances_with_pr')}</p>
          <p className="text-2xl font-black text-emerald-600 tabular-nums">{stats.prCount}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">categorías</p>
        </div>
        {stats.lastRace && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('races.last_race')}</p>
            <p className="text-lg font-black text-slate-900 tabular-nums truncate">{stats.lastRace.timeLabel}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{stats.lastRace.dateLabel}</p>
          </div>
        )}
      </div>

      {/* PRs */}
      {Object.keys(prs).length > 0 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-4">{t('races.personal_records')}</Title>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {DISTANCE_CATEGORIES.filter(c => c.id !== 'other' && prs[c.id]).map(cat => {
              const pr = prs[cat.id];
              return (
                <div key={cat.id} className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl border border-amber-200 p-4 text-center">
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-2">{cat.label}</p>
                  <p className="text-xl font-black text-slate-900 tabular-nums">{pr.timeLabel}</p>
                  <p className="text-xs text-slate-500 mt-1">{pr.paceLabel}/km</p>
                  <p className="text-[10px] text-slate-400 mt-1">{pr.dateLabel}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Progression charts */}
      {Object.entries(progressionData).filter(([, data]) => data.length >= 2).map(([catId, data]) => {
        const cat = DISTANCE_CATEGORIES.find(c => c.id === catId);
        return (
          <Card key={catId} className="shadow-lg border-slate-200">
            <Title className="text-slate-800 font-bold mb-1">{t('races.progression', { cat: cat?.label })}</Title>
            <Text className="text-slate-500 text-sm mb-4">{t('races.pace_evolution', { cat: cat?.label })}</Text>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis
                    reversed
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    tickFormatter={v => formatPace(v)}
                    domain={['auto', 'auto']}
                  />
                  <RechartsTooltip
                    formatter={(val) => [formatPace(val), t('races.pace_label')]}
                    labelFormatter={(label) => label}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="pace" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: '#2563eb' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        );
      })}

      {/* Race history table */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Title className="text-slate-800 font-bold">{t('races.all_races')}</Title>
            <Text className="text-slate-500 text-sm">{t('races.all_races_subtitle')}</Text>
          </div>
          <Select value={filterDist} onValueChange={setFilterDist} className="w-40">
            <SelectItem value="all">{t('races.all')}</SelectItem>
            {DISTANCE_CATEGORIES.filter(c => c.id !== 'other').map(c => (
              <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
            ))}
          </Select>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Fecha</th>
              <th className="text-left py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Nombre</th>
              <th className="text-right py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Dist.</th>
              <th className="text-right py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Tiempo</th>
              <th className="text-right py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">{t('races.pace_label')}</th>
              <th className="text-right py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">FC</th>
              <th className="text-center py-2 px-2 text-[10px] font-bold text-slate-400 uppercase">Cat.</th>
            </tr>
          </thead>
          <tbody>
            {pagedRaces.map(r => {
              const isPR = prs[r.categoryId]?.id === r.id;
              return (
                <tr key={r.id} className={`border-b border-slate-100 ${isPR ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                  <td className="py-2 px-2 text-slate-500 text-xs">{r.dateLabel}</td>
                  <td className="py-2 px-2 text-slate-700 font-medium truncate max-w-[200px]">
                    {isPR && <span className="text-amber-500 mr-1">★</span>}
                    {r.name}
                  </td>
                  <td className="py-2 px-2 text-right text-slate-600 tabular-nums">{r.km} km</td>
                  <td className="py-2 px-2 text-right text-slate-600 tabular-nums font-medium">{r.timeLabel}</td>
                  <td className="py-2 px-2 text-right text-slate-600 tabular-nums">{r.paceLabel}</td>
                  <td className="py-2 px-2 text-right text-slate-500 tabular-nums">{r.hr > 0 ? Math.round(r.hr) : '-'}</td>
                  <td className="py-2 px-2 text-center">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                      {r.category.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
            <span className="text-xs text-slate-400">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredRaces.length)} / {filteredRaces.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce((acc, p, idx, arr) => {
                  if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '…' ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-300">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors ${
                        p === page
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )
              }
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
