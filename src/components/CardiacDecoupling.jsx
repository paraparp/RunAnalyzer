import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import {
  ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ReferenceLine, ZAxis
} from 'recharts';

function formatPace(minPerKm) {
  if (!minPerKm || minPerKm <= 0 || minPerKm > 15) return '--:--';
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function calcDecoupling(splits) {
  if (!splits || splits.length < 4) return null;

  const valid = splits.filter(s => s.average_speed > 0 && s.average_heartrate > 0 && s.distance > 500);
  if (valid.length < 4) return null;

  const mid = Math.floor(valid.length / 2);
  const firstHalf = valid.slice(0, mid);
  const secondHalf = valid.slice(mid);

  const ratioFirst = firstHalf.reduce((s, sp) => {
    const pace = 1000 / (sp.average_speed * 60);
    return s + sp.average_heartrate / pace;
  }, 0) / firstHalf.length;

  const ratioSecond = secondHalf.reduce((s, sp) => {
    const pace = 1000 / (sp.average_speed * 60);
    return s + sp.average_heartrate / pace;
  }, 0) / secondHalf.length;

  if (ratioFirst === 0) return null;

  return ((ratioSecond - ratioFirst) / ratioFirst) * 100;
}

// Level keys for i18n lookup
function getDecouplingLevelKey(pct) {
  if (pct === null) return null;
  if (pct < 3) return 'excellent';
  if (pct < 5) return 'good';
  if (pct < 8) return 'normal';
  if (pct < 12) return 'high';
  return 'very_high';
}

const LEVEL_COLORS = {
  excellent: '#10b981',
  good: '#22c55e',
  normal: '#f59e0b',
  high: '#f97316',
  very_high: '#ef4444',
};

function getDecouplingColor(pct) {
  const key = getDecouplingLevelKey(pct);
  return key ? LEVEL_COLORS[key] : '#94a3b8';
}

export default function CardiacDecoupling({ activities, onEnrichActivity }) {
  const { t } = useTranslation();
  const [monthsToShow, setMonthsToShow] = useState('6');
  const [minDuration, setMinDuration] = useState('30');

  const { decouplingData, trendData, stats } = useMemo(() => {
    if (!activities || activities.length === 0) return { decouplingData: [], trendData: [], stats: null };

    const minMins = parseInt(minDuration);
    const months = parseInt(monthsToShow);
    const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;

    const results = activities
      .filter(a =>
        a.splits_metric &&
        a.splits_metric.length >= 4 &&
        a.average_heartrate > 0 &&
        a.moving_time >= minMins * 60 &&
        new Date(a.start_date).getTime() >= cutoff
      )
      .map(a => {
        const dc = calcDecoupling(a.splits_metric);
        if (dc === null) return null;

        const pace = a.average_speed > 0 ? 16.6667 / a.average_speed : 0;
        const levelKey = getDecouplingLevelKey(dc);
        const color = levelKey ? LEVEL_COLORS[levelKey] : '#94a3b8';

        return {
          id: a.id,
          name: a.name,
          date: a.start_date,
          dateLabel: new Date(a.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
          km: (a.distance / 1000).toFixed(1),
          duration: Math.round(a.moving_time / 60),
          pace,
          paceLabel: formatPace(pace),
          hr: Math.round(a.average_heartrate),
          decoupling: Math.round(dc * 10) / 10,
          levelKey,
          color,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Trend: monthly average decoupling
    const monthly = {};
    results.forEach(r => {
      const month = r.date.slice(0, 7);
      if (!monthly[month]) monthly[month] = { values: [], sum: 0 };
      monthly[month].values.push(r.decoupling);
      monthly[month].sum += r.decoupling;
    });
    const trend = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({
        month: month.slice(5) + '/' + month.slice(2, 4),
        avgDecoupling: Math.round((d.sum / d.values.length) * 10) / 10,
        count: d.values.length,
      }));

    // Stats
    const last5 = results.slice(-5);
    const avgLast5 = last5.length > 0 ? last5.reduce((s, r) => s + r.decoupling, 0) / last5.length : 0;
    const bestDc = results.length > 0 ? Math.min(...results.map(r => r.decoupling)) : 0;
    const avgAll = results.length > 0 ? results.reduce((s, r) => s + r.decoupling, 0) / results.length : 0;

    // Trend direction
    const firstHalfAvg = results.length >= 4
      ? results.slice(0, Math.floor(results.length / 2)).reduce((s, r) => s + r.decoupling, 0) / Math.floor(results.length / 2)
      : null;
    const secondHalfAvg = results.length >= 4
      ? results.slice(Math.floor(results.length / 2)).reduce((s, r) => s + r.decoupling, 0) / (results.length - Math.floor(results.length / 2))
      : null;
    const improving = firstHalfAvg !== null && secondHalfAvg !== null ? secondHalfAvg < firstHalfAvg : null;

    const avgLast5Key = getDecouplingLevelKey(avgLast5);

    return {
      decouplingData: results,
      trendData: trend,
      stats: {
        total: results.length,
        avgLast5: Math.round(avgLast5 * 10) / 10,
        bestDc: Math.round(bestDc * 10) / 10,
        avgAll: Math.round(avgAll * 10) / 10,
        improving,
        levelLast5Key: avgLast5Key,
        levelLast5Color: avgLast5Key ? LEVEL_COLORS[avgLast5Key] : '#94a3b8',
      },
    };
  }, [activities, monthsToShow, minDuration]);

  if (!decouplingData.length) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-sm">{t('decoupling.no_data')}</p>
        <p className="text-xs mt-2">{t('decoupling.no_data_hint')}</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
        <p className="font-bold text-slate-700 mb-1">{d.name}</p>
        <p className="text-slate-500">{d.dateLabel} — {d.km} km — {d.duration} min</p>
        <p className="text-slate-600">{t('decoupling.subtitle').split(' ')[0]}: {d.paceLabel}/km | FC: {d.hr} bpm</p>
        <p className="font-bold" style={{ color: d.color }}>
          Decoupling: {d.decoupling}% ({d.levelKey ? t(`decoupling.levels.${d.levelKey}`) : 'N/A'})
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('decoupling.sessions_analyzed')}</p>
          <p className="text-2xl font-black text-slate-900 tabular-nums">{stats.total}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t('decoupling.with_complete_data')}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('decoupling.last_5_avg')}</p>
          <p className="text-2xl font-black tabular-nums" style={{ color: stats.levelLast5Color }}>{stats.avgLast5}%</p>
          <p className="text-[10px] font-semibold mt-0.5" style={{ color: stats.levelLast5Color }}>
            {stats.levelLast5Key ? t(`decoupling.levels.${stats.levelLast5Key}`) : ''}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('decoupling.best_session')}</p>
          <p className="text-2xl font-black text-emerald-600 tabular-nums">{stats.bestDc}%</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t('decoupling.min_decoupling')}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('decoupling.global_avg')}</p>
          <p className="text-2xl font-black text-slate-700 tabular-nums">{stats.avgAll}%</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t('decoupling.all_sessions')}</p>
        </div>
        {stats.improving !== null && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{t('decoupling.trend')}</p>
            <p className={`text-2xl font-black tabular-nums ${stats.improving ? 'text-emerald-600' : 'text-amber-600'}`}>
              {stats.improving ? `↗ ${t('decoupling.improving')}` : `↘ ${t('decoupling.worsening')}`}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">{t('decoupling.aerobic_efficiency')}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        <Select value={monthsToShow} onValueChange={setMonthsToShow} className="w-32">
          <SelectItem value="3">{t('decoupling.months_3')}</SelectItem>
          <SelectItem value="6">{t('decoupling.months_6')}</SelectItem>
          <SelectItem value="12">{t('decoupling.months_12')}</SelectItem>
          <SelectItem value="24">{t('decoupling.months_24')}</SelectItem>
        </Select>
        <Select value={minDuration} onValueChange={setMinDuration} className="w-36">
          <SelectItem value="20">+20 min</SelectItem>
          <SelectItem value="30">+30 min</SelectItem>
          <SelectItem value="45">+45 min</SelectItem>
          <SelectItem value="60">+60 min</SelectItem>
        </Select>
      </div>

      {/* Timeline chart */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">{t('decoupling.title')}</Title>
        <Text className="text-slate-500 text-sm mb-4">{t('decoupling.subtitle')}</Text>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                type="category"
                allowDuplicatedCategory={false}
              />
              <YAxis
                dataKey="decoupling"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                domain={[0, 'auto']}
                unit="%"
              />
              <ZAxis dataKey="km" range={[30, 150]} />
              <RechartsTooltip content={<CustomTooltip />} />
              <ReferenceLine y={5} stroke="#10b981" strokeDasharray="5 3" label={{ value: t('decoupling.good_threshold'), fontSize: 10, fill: '#10b981' }} />
              <ReferenceLine y={10} stroke="#f59e0b" strokeDasharray="5 3" label={{ value: t('decoupling.high_threshold'), fontSize: 10, fill: '#f59e0b' }} />
              <Scatter data={decouplingData} shape="circle">
                {decouplingData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} fillOpacity={0.8} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Duration vs Decoupling scatter */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-1">Duración vs Decoupling</Title>
        <Text className="text-slate-500 text-sm mb-4">Relación entre la duración de la sesión y el desacoplamiento</Text>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="duration"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                type="number"
                unit=" min"
                name="Duración"
              />
              <YAxis
                dataKey="decoupling"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                domain={[0, 'auto']}
                unit="%"
                name="Decoupling"
              />
              <RechartsTooltip content={<CustomTooltip />} />
              <ReferenceLine y={5} stroke="#10b981" strokeDasharray="5 3" />
              <Scatter data={decouplingData} shape="circle">
                {decouplingData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} fillOpacity={0.8} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Monthly trend */}
      {trendData.length > 1 && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-1">Tendencia Mensual</Title>
          <Text className="text-slate-500 text-sm mb-4">Media de decoupling por mes</Text>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} domain={[0, 'auto']} unit="%" />
                <RechartsTooltip
                  formatter={(val) => [`${val}%`, 'Avg Decoupling']}
                  contentStyle={{ fontSize: 12 }}
                />
                <ReferenceLine y={5} stroke="#10b981" strokeDasharray="5 3" />
                <Line type="monotone" dataKey="avgDecoupling" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Interpretation guide */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">{t('decoupling.how_to_interpret')}</Title>
        <div className="space-y-2 text-sm text-slate-600">
          <p>El <span className="font-semibold">decoupling cardíaco</span> mide cuánto se desacopla tu frecuencia cardíaca del ritmo durante una sesión. Se compara la relación FC/ritmo de la primera mitad con la segunda mitad.</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
            {[
              { range: '<3%', key: 'excellent', color: LEVEL_COLORS.excellent },
              { range: '3-5%', key: 'good', color: LEVEL_COLORS.good },
              { range: '5-8%', key: 'normal', color: LEVEL_COLORS.normal },
              { range: '8-12%', key: 'high', color: LEVEL_COLORS.high },
              { range: '>12%', key: 'very_high', color: LEVEL_COLORS.very_high },
            ].map(z => (
              <div key={z.key} className="text-center p-2 rounded-lg" style={{ backgroundColor: z.color + '15' }}>
                <p className="font-bold text-xs" style={{ color: z.color }}>{z.range}</p>
                <p className="text-[10px] text-slate-500">{t(`decoupling.levels.${z.key}`)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">Un decoupling bajo indica buena eficiencia aeróbica. Si mejora con el tiempo, tu base aeróbica se está fortaleciendo.</p>
        </div>
      </Card>
    </div>
  );
}
