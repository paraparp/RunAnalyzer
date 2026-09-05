import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import { isoWeek, isoWeekKey, weekStartFromIso } from '../lib/isoWeek';
import { weeklyVolumeRamp } from '../lib/weeklyVolume';
import { activityDayKey, dayKey } from '../lib/trainingLoad';
import { monthsAgoISO } from '../lib/criticalSpeed';
import { monthShort } from '../lib/monthLabels';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';

// Definido fuera del componente: dentro del render sería un tipo nuevo en cada
// render y Recharts remontaría el subárbol del tooltip entero.
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold text-slate-700 mb-1">
        {d.label} (S{d.week}){d.isPartial && <span className="text-slate-400 font-medium"> · en curso</span>}
      </p>
      <p className="text-blue-600">Distancia: <span className="font-bold">{d.km.toFixed(1)} km</span></p>
      <p className="text-slate-500">Sesiones: {d.sessions} | Desnivel: {Math.round(d.elevation)}m</p>
      {d.avg4w != null && <p className="text-slate-500">Media 4 sem cerradas: {d.avg4w} km</p>}
      {d.isPartial ? (
        <p className="text-slate-400 italic">Semana incompleta: no se compara</p>
      ) : d.change !== 0 && (
        <p className={d.exceeds10 ? 'text-rose-600 font-bold' : 'text-slate-500'}>
          Cambio: {d.change > 0 ? '+' : ''}{d.change}% ({d.absDeltaKm > 0 ? '+' : ''}{d.absDeltaKm.toFixed(1)} km)
          {d.exceeds10 && ' ⚠️ salto excesivo'}
        </p>
      )}
    </div>
  );
}

export default function WeeklyProgression({ activities }) {
  const { i18n } = useTranslation();
  const MONTH_SHORT = monthShort(i18n.language);
  const [monthsToShow, setMonthsToShow] = useState('6');

  const { weeklyData, stats } = useMemo(() => {
    if (!activities || activities.length === 0) return { weeklyData: [], stats: null };

    const weeksMap = {};

    activities.forEach(a => {
      // El día LOCAL de la actividad decide su semana: una salida de domingo por
      // la noche en horario europeo cae en la semana siguiente si se lee en UTC.
      const day = activityDayKey(a);
      const { year, week } = isoWeek(day);
      const key = isoWeekKey(day);
      if (!weeksMap[key]) {
        weeksMap[key] = { key, year, week, km: 0, time: 0, sessions: 0, elevation: 0 };
      }
      weeksMap[key].km += (a.distance || 0) / 1000;
      weeksMap[key].time += (a.moving_time || 0) / 3600;
      weeksMap[key].sessions += 1;
      weeksMap[key].elevation += a.total_elevation_gain || 0;
    });

    const sorted = Object.values(weeksMap).sort((a, b) => a.key.localeCompare(b.key));

    // Fill gaps between weeks
    const filled = [];
    if (sorted.length > 0) {
      const firstWeekStart = weekStartFromIso(sorted[0].year, sorted[0].week);
      const lastWeekStart = weekStartFromIso(sorted[sorted.length - 1].year, sorted[sorted.length - 1].week);
      const cursor = new Date(firstWeekStart);

      while (cursor <= lastWeekStart) {
        const { year, week } = isoWeek(cursor);
        const key = isoWeekKey(cursor);
        const existing = weeksMap[key];
        filled.push(existing || { key, year, week, km: 0, time: 0, sessions: 0, elevation: 0 });
        cursor.setDate(cursor.getDate() + 7);
      }
    }

    // La semana en curso está a medias: su volumen NO es comparable con el de una
    // semana completa. Antes entraba en todo —el % de cambio, la alerta del 10 %,
    // la media móvil— y un lunes por la mañana la vista anunciaba -85 %. Aquí se
    // marca y se excluye de cualquier comparación, igual que hizo `A6` en
    // `InjuryRisk`. Se sigue dibujando, pero como barra "en curso".
    const currentWeekKey = isoWeekKey(dayKey(new Date()));

    // Calculate change % and moving average
    const withMetrics = filled.map((w, i) => {
      const isPartial = w.key >= currentWeekKey;
      const prev = i > 0 ? filled[i - 1] : null;
      // La regla del 10 % vive en lib/weeklyVolume.js, compartida con InjuryRisk:
      // porcentaje cruzado con el salto absoluto en km, que es el que se
      // corresponde con la carga real.
      const ramp = weeklyVolumeRamp(w.km, prev ? prev.km : 0);
      const change = prev && prev.km > 0 ? ramp.changePct : 0;
      const exceeds10 = !isPartial && !!prev && ramp.exceeds;

      // Media móvil de 4 semanas, solo sobre semanas CERRADAS: si la parcial
      // entra, arrastra el sesgo a la referencia contra la que se compara todo.
      const windowSrc = isPartial
        ? filled.slice(Math.max(0, i - 4), i)
        : filled.slice(Math.max(0, i - 3), i + 1);
      const window = windowSrc.filter(x => x.key < currentWeekKey);
      const avg4w = window.length
        ? window.reduce((s, x) => s + x.km, 0) / window.length
        : null;

      const weekStart = weekStartFromIso(w.year, w.week);
      const label = `${weekStart.getDate()} ${MONTH_SHORT[weekStart.getMonth()]}`;

      return {
        ...w,
        isPartial,
        change: Math.round(change),
        absDeltaKm: ramp.absDeltaKm,
        exceeds10,
        avg4w: avg4w == null ? null : Math.round(avg4w * 10) / 10,
        label,
        dateMs: weekStart.getTime(),
      };
    });

    // Filter by time range
    const months = parseInt(monthsToShow);
    // Meses de CALENDARIO: `months * 30 * 86400000` recorta 360 días cuando el
    // selector dice 12 meses. La frontera y el inicio de semana son días locales.
    const from = monthsAgoISO(months);
    const filtered = withMetrics.filter(w => dayKey(new Date(w.dateMs)) >= from);

    // Stats — todas sobre semanas CERRADAS; la parcial solo se informa aparte.
    const closed = filtered.filter(w => !w.isPartial);
    const partialWeek = filtered.find(w => w.isPartial) || null;

    const recent4 = closed.slice(-4);
    const avg4 = recent4.length > 0 ? recent4.reduce((s, w) => s + w.km, 0) / recent4.length : 0;
    const lastClosed = closed.length > 0 ? closed[closed.length - 1] : null;
    const exceedCount = closed.filter(w => w.exceeds10).length;

    // Racha de semanas consecutivas con actividad. La semana en curso solo suma
    // si ya tiene kilómetros: un lunes a las 9:00 no rompe una racha de meses.
    let streak = 0;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const w = filtered[i];
      if (w.isPartial && w.km === 0) continue;
      if (w.km > 0) streak++;
      else break;
    }

    const maxWeek = closed.reduce((max, w) => w.km > max.km ? w : max, { km: 0, label: '' });

    return {
      weeklyData: filtered,
      stats: {
        lastClosedKm: lastClosed ? lastClosed.km : 0,
        lastClosedChange: lastClosed ? lastClosed.change : 0,
        lastClosedLabel: lastClosed ? lastClosed.label : '',
        partialKm: partialWeek ? partialWeek.km : null,
        avg4weeks: avg4,
        streak,
        exceedCount,
        totalWeeks: closed.length,
        maxWeek: maxWeek.km,
        maxWeekLabel: maxWeek.label,
      },
    };
  }, [activities, monthsToShow, MONTH_SHORT]);

  if (!weeklyData.length || !stats) {
    return (
      <div className="text-center py-12 text-slate-400">
        <p className="text-sm">No hay datos suficientes para mostrar la progresión semanal.</p>
      </div>
    );
  }


  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Última semana cerrada</p>
          <p className="text-2xl font-black text-slate-900 tabular-nums">{stats.lastClosedKm.toFixed(1)}</p>
          <p className={`text-[10px] mt-0.5 font-semibold ${stats.lastClosedChange > 10 ? 'text-rose-500' : stats.lastClosedChange > 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
            {stats.lastClosedChange > 0 ? '+' : ''}{stats.lastClosedChange}% vs anterior
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">En curso</p>
          <p className="text-2xl font-black text-slate-500 tabular-nums">
            {stats.partialKm == null ? '—' : stats.partialKm.toFixed(1)}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">km hasta hoy (sin comparar)</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Media 4 semanas</p>
          <p className="text-2xl font-black text-blue-600 tabular-nums">{stats.avg4weeks.toFixed(1)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">km/semana</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Racha activa</p>
          <p className="text-2xl font-black text-emerald-600 tabular-nums">{stats.streak}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">semanas consecutivas</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Semana pico</p>
          <p className="text-2xl font-black text-amber-600 tabular-nums">{stats.maxWeek.toFixed(1)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{stats.maxWeekLabel}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Alertas +10%</p>
          <p className={`text-2xl font-black tabular-nums ${stats.exceedCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{stats.exceedCount}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">de {stats.totalWeeks} semanas</p>
        </div>
      </div>

      {/* Main chart */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex items-center justify-between mb-1">
          <div>
            <Title className="text-slate-800 font-bold">Progresión de Volumen Semanal</Title>
            <Text className="text-slate-500 text-sm">km por semana con media móvil de 4 semanas y regla del 10%</Text>
          </div>
          <Select value={monthsToShow} onValueChange={setMonthsToShow} className="w-32">
            <SelectItem value="3">3 meses</SelectItem>
            <SelectItem value="6">6 meses</SelectItem>
            <SelectItem value="12">12 meses</SelectItem>
            <SelectItem value="24">24 meses</SelectItem>
          </Select>
        </div>

        <div className="h-[360px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart data={weeklyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                interval={Math.max(0, Math.floor(weeklyData.length / 12))}
              />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <RechartsTooltip content={<CustomTooltip />} />
              <Bar dataKey="km" radius={[4, 4, 0, 0]} maxBarSize={24}>
                {weeklyData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={entry.isPartial ? '#94a3b8' : entry.exceeds10 ? '#f43f5e' : entry.km === 0 ? '#e2e8f0' : '#3b82f6'}
                    fillOpacity={entry.isPartial ? 0.45 : entry.exceeds10 ? 0.85 : 0.7}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="avg4w"
                stroke="#1d4ed8"
                strokeWidth={2}
                dot={false}
                strokeDasharray="5 3"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Legend */}
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-3">Regla del 10%</Title>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-600">
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 rounded-sm bg-blue-400 mt-0.5 shrink-0" />
            <p>Las barras muestran el volumen semanal en km. La línea punteada es la media móvil de 4 semanas.</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 rounded-sm bg-rose-500 mt-0.5 shrink-0" />
            <p>Las barras rojas indican semanas donde el salto de volumen excede la regla del 10% <em>y</em> supone un aumento absoluto relevante en km — el mismo criterio que usa el índice de riesgo de lesión.</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 rounded-sm bg-slate-400/50 mt-0.5 shrink-0" />
            <p>La barra gris es la semana en curso: al estar incompleta no se compara con la anterior ni entra en la media móvil, las alertas ni la semana pico.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
