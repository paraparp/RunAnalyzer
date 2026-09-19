import { useMemo, useState } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { Card, Text } from '@tremor/react';
import {
  ComposedChart, Area, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
  Line,
} from 'recharts';
import {
  ArrowTrendingUpIcon, BoltIcon, HeartIcon,
  XMarkIcon, ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import useCalibratedPMC from '../hooks/useCalibratedPMC';
import { weekStartKey } from '../lib/isoWeek';
import { monthKey } from '../lib/trainingLoad';
import {
  computeStats, computeGarminStats, isRun, paceStr, timeStr, fmt1,
} from '../lib/statusStats';
import { HeroCard, MiniSparkline, PctPill, RangeSelector } from './StatusCards';

// ─────────────────────────────────────────────────────────────────────────────
// Carga › Mi Estado: el detalle del estado actual contra el histórico.
// Comparativa de métricas (ahora / mejor del año / mejor histórico), el PMC día
// a día con las zonas de pico y el panel de lo que se hizo el día que pinchas, y
// las tendencias de Garmin.
//
// Es lo que quedaba de la pestaña "Estado" de `StatusSnapshot` una vez que el
// briefing se fue a Hoy (`StatusHero`) y las otras tres pestañas —PMC, Semanal y
// Riesgo— pasaron a ser ítems del menú. El gráfico de CTL/ATL y el bloque de
// Garmin están de paso: la fase 3b los funde con sus dueños
// (`FitnessFatigue` y `VitalsOverview`), que ya pintan las mismas series.
// ─────────────────────────────────────────────────────────────────────────────

export default function StatusOverview({ activities }) {
  const { pmc } = useCalibratedPMC(activities);
  const pmcSeries = pmc?.series ?? null;
  const pmcCurrent = pmc?.current ?? null;
  // "Ahora" estable por montaje: leer el reloj en cada render hace que el mismo
  // dato entre y salga de la ventana según cuántas veces se repinte la vista.
  const [nowMs2] = useState(() => Date.now());

  const stats = useMemo(
    () => (pmcSeries && pmcCurrent
      ? computeStats(activities, { series: pmcSeries, current: pmcCurrent }, { now: nowMs2 })
      : null),
    [activities, pmcSeries, pmcCurrent, nowMs2],
  );

  const garmin = useMemo(() => {
    try {
      const raw = cloudStorage.getItem('garmin_cardiac_data');
      if (raw) return computeGarminStats(JSON.parse(raw), { now: nowMs2 });
    } catch { /* cache de Garmin ilegible: se sigue sin ella */ }
    return null;
  }, [nowMs2]);

  const [timeRange, setTimeRange] = useState('90d'); // '90d' | '6m' | '1y' | 'all'
  const [selectedDay, setSelectedDay] = useState(null);
  const [showGarminHR, setShowGarminHR] = useState(true);
  const [showGarminRec, setShowGarminRec] = useState(true);
  const [garminGranularity, setGarminGranularity] = useState('day'); // 'day', 'week', 'month'

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        No hay datos suficientes para mostrar el estado actual.
      </div>
    );
  }

  const {
    currentCTL, currentATL, currentTSB,
    peakCTL, peakCTLYear,
    last7daysKm, peakWeekKm, peakWeekKmYear,
    bestPace10kRecent, bestPace10kYear, bestPace10kAll,
    hrEffRecent, hrEffYear, hrEffAll,
    activeLast28,
    elevLast28, avgMonthlyElevYear, peakMonthlyElev,
    chartDataFull, sparkData,
  } = stats;

  // sparkline datasets (last 8 weeks)
  const ctlSparkData  = sparkData.map((d) => ({ v: d.ctl }));
  const atlSparkData  = sparkData.map((d) => ({ v: d.atl }));
  const volSparkData  = (() => {
    // Km reales por semana (8 últimas). Antes se pintaba Sum(TSS)/1000 como "proxy
    // de km": con 300-700 TSS por semana salia 0-1 y el sparkline era una linea de
    // ceros. La serie del PMC ya trae las actividades originales de cada dia.
    const weeksData = [];
    for (let i = 7; i >= 0; i--) {
      const slice = chartDataFull.slice(-(i + 1) * 7, i > 0 ? -i * 7 : undefined);
      const km = slice.reduce(
        (s, d) => s + (d.activities ?? []).filter(isRun).reduce((a, act) => a + (act.distance ?? 0), 0),
        0,
      ) / 1000;
      weeksData.push({ v: Math.round(km) });
    }
    return weeksData;
  })();

  // comparison table rows
  const tableRows = [
    {
      label: 'Fitness (CTL)',
      now: fmt1(currentCTL),
      nowRaw: currentCTL,
      bestYear: fmt1(peakCTLYear),
      bestYearRaw: peakCTLYear,
      bestAll: fmt1(peakCTL),
      bestAllRaw: peakCTL,
      spark: ctlSparkData,
      sparkColor: '#3b82f6',
      lowerIsBetter: false,
    },
    {
      label: 'Fatiga (ATL)',
      now: fmt1(currentATL),
      nowRaw: currentATL,
      bestYear: '—', bestYearRaw: null,
      bestAll: '—', bestAllRaw: null,
      spark: atlSparkData,
      sparkColor: '#f97316',
      lowerIsBetter: false,
      noCompare: true,
    },
    {
      label: 'Forma (TSB)',
      now: fmt1(currentTSB),
      nowRaw: null,
      bestYear: '—', bestYearRaw: null,
      bestAll: '—', bestAllRaw: null,
      spark: ctlSparkData.map((d, i) => ({ v: sparkData[i]?.tsb ?? 0 })),
      sparkColor: '#8b5cf6',
      noCompare: true,
    },
    {
      label: 'Km (última semana)',
      now: `${last7daysKm.toFixed(1)} km`,
      nowRaw: last7daysKm,
      bestYear: `${peakWeekKmYear.toFixed(1)} km`,
      bestYearRaw: peakWeekKmYear,
      bestAll: `${peakWeekKm.toFixed(1)} km`,
      bestAllRaw: peakWeekKm,
      spark: volSparkData,
      sparkColor: '#10b981',
      lowerIsBetter: false,
    },
    {
      label: 'Desnivel mensual',
      now: `${Math.round(elevLast28)} m`,
      nowRaw: elevLast28,
      bestYear: `${Math.round(avgMonthlyElevYear)} m`,
      bestYearRaw: avgMonthlyElevYear,
      bestAll: `${Math.round(peakMonthlyElev)} m`,
      bestAllRaw: peakMonthlyElev,
      spark: null,
      sparkColor: '#64748b',
      lowerIsBetter: false,
    },
    {
      label: 'Consistencia (28d)',
      now: `${activeLast28} días`,
      nowRaw: activeLast28,
      bestYear: '28 días',
      bestYearRaw: 28,
      bestAll: '28 días',
      bestAllRaw: 28,
      spark: null,
      lowerIsBetter: false,
    },
    {
      label: 'Mejor ritmo 10k',
      now: paceStr(bestPace10kRecent),
      nowRaw: bestPace10kRecent,
      bestYear: paceStr(bestPace10kYear),
      bestYearRaw: bestPace10kYear,
      bestAll: paceStr(bestPace10kAll),
      bestAllRaw: bestPace10kAll,
      spark: null,
      lowerIsBetter: true, // lower pace = better
      unit: '/km',
    },
    {
      label: 'Eficiencia aeróbica',
      now: hrEffRecent ? hrEffRecent.toFixed(2) : '—',
      nowRaw: hrEffRecent,
      bestYear: hrEffYear ? hrEffYear.toFixed(2) : '—',
      bestYearRaw: hrEffYear,
      bestAll: hrEffAll ? hrEffAll.toFixed(2) : '—',
      bestAllRaw: hrEffAll,
      spark: null,
      lowerIsBetter: true, // lower HR/speed = better efficiency
    },
    // ── Garmin rows (only if data available) ──
    ...(garmin ? [
      {
        label: 'FC Reposo',
        now: garmin.currentRHR ? `${garmin.currentRHR} bpm` : '—',
        nowRaw: garmin.currentRHR,
        bestYear: garmin.rhrYearMin ? `${garmin.rhrYearMin} bpm` : '—',
        bestYearRaw: garmin.rhrYearMin,
        bestAll: garmin.rhrAllTimeMin ? `${garmin.rhrAllTimeMin} bpm` : '—',
        bestAllRaw: garmin.rhrAllTimeMin,
        spark: garmin.rhrSparkData,
        sparkColor: '#ef4444',
        lowerIsBetter: true, // lower RHR = better
      },
      {
        label: 'Body Battery (máx)',
        now: garmin.currentBB ? `${garmin.currentBB}/100` : '—',
        nowRaw: garmin.currentBB,
        bestYear: garmin.bbYearAvg ? `${Math.round(garmin.bbYearAvg)}/100` : '—',
        bestYearRaw: garmin.bbYearAvg,
        bestAll: garmin.bbAllTimeMax ? `${garmin.bbAllTimeMax}/100` : '—',
        bestAllRaw: garmin.bbAllTimeMax,
        spark: garmin.bbSparkData,
        sparkColor: '#8b5cf6',
        lowerIsBetter: false,
      },
    ] : []),
  ];

  const rangeMs = { '90d': 90*86400000, '6m': 183*86400000, '1y': 365*86400000, 'all': Infinity };

  const sampledChart = chartDataFull
    .filter(d => rangeMs[timeRange] === Infinity || new Date(d.date).getTime() >= nowMs2 - rangeMs[timeRange]);

  const peakCTLVal = Math.round(peakCTL * 10) / 10;


  return (
    <div className="space-y-4">

      {/* ── Comparison Table ── */}
      <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white overflow-x-auto">
        <div className="flex items-center gap-2 mb-4">
          <HeartIcon className="w-4 h-4 text-slate-400" />
          <Text className="font-bold text-slate-700 text-sm">Estado actual vs mejor histórico</Text>
        </div>
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 px-2 text-xs font-bold uppercase text-slate-400 w-48">Métrica</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-slate-400">Ahora</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-slate-400">Mejor año</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-slate-400">Pico histórico</th>
              <th className="text-right py-2 px-3 text-xs font-bold uppercase text-slate-400">% pico</th>
              <th className="text-center py-2 px-3 text-xs font-bold uppercase text-slate-400">Tendencia 8s</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, i) => (
              <tr key={i} className={`border-b border-slate-50 ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                <td className="py-2.5 px-2 font-semibold text-slate-600 text-xs whitespace-nowrap">{row.label}</td>
                <td className="py-2.5 px-3 text-right font-black text-slate-800 text-sm">{row.now}</td>
                <td className="py-2.5 px-3 text-right text-slate-500 text-xs">{row.bestYear}</td>
                <td className="py-2.5 px-3 text-right text-slate-500 text-xs">{row.bestAll}</td>
                <td className="py-2.5 px-3 text-right">
                  {row.noCompare ? <span className="text-slate-300 text-xs">—</span>
                    : <PctPill now={row.nowRaw} best={row.bestAllRaw} lowerIsBetter={row.lowerIsBetter} />}
                </td>
                <td className="py-2.5 px-3 flex justify-center items-center">
                  {row.spark
                    ? <MiniSparkline data={row.spark} color={row.sparkColor} />
                    : <span className="text-slate-200 text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* ── CTL / ATL Chart ── */}
      <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white">
        <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ArrowTrendingUpIcon className="w-4 h-4 text-slate-400" />
              <Text className="font-bold text-slate-700 text-sm">Fitness y Fatiga</Text>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-blue-500 rounded" /> CTL</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-orange-400 rounded" /> ATL</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-slate-200 rounded-sm" /> Carga</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'rgba(59,130,246,0.15)'}} /> Pico histórico</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'rgba(251,191,36,0.2)'}} /> Pico anual</span>
            </div>
          </div>
          <RangeSelector value={timeRange} onChange={setTimeRange} options={[
            { v: '90d', label: '90d' }, { v: '6m', label: '6m' },
            { v: '1y', label: '1a' }, { v: 'all', label: 'Todo' },
          ]} />
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={sampledChart} syncId="statusCharts" margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorCtl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorAtl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fb923c" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#fb923c" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={(d) => {
                const dt = new Date(d);
                return `${dt.getDate()}/${dt.getMonth() + 1}`;
              }}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={false}
            />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#cbd5e1' }} tickLine={false} axisLine={false} />
            <RechartsTooltip
              wrapperStyle={{ pointerEvents: 'auto' }}
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-3 text-xs shadow-xl min-w-[160px]">
                      <p className="font-bold text-slate-700 mb-2 border-b border-slate-100 pb-1">{new Date(label).toLocaleDateString('es-ES')}</p>
                      <div className="space-y-1 mb-2">
                        {payload.map((p, idx) => (
                          <p key={idx} style={{ color: p.color || p.stroke || p.fill }} className="font-medium flex justify-between gap-4">
                            <span>{p.name}:</span>
                            <span>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
                          </p>
                        ))}
                      </div>
                      {data.activities && data.activities.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                          <p className="text-slate-400 font-semibold mb-1 text-[10px] uppercase tracking-wider">Actividades</p>
                          <ul className="space-y-2 mt-1">
                            {data.activities.map((a, i) => (
                              <li key={i} className="text-slate-600 flex flex-col gap-0.5 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                                <div className="flex justify-between items-start gap-3">
                                  <a 
                                    href={`https://www.strava.com/activities/${a.id}`} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="truncate max-w-[160px] font-semibold text-[11px] hover:text-blue-500 hover:underline transition-colors" 
                                    title={`Ver en Strava: ${a.name}`}
                                  >
                                    {a.name}
                                  </a>
                                  <span className="text-slate-500 font-bold whitespace-nowrap">{(a.distance / 1000).toFixed(1)}k</span>
                                </div>
                                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9.5px] text-slate-400 font-medium">
                                  {a.moving_time > 0 && <span>⏱ {timeStr(a.moving_time)}</span>}
                                  {isRun(a) ? (a.average_speed > 0 && <span>⚡ {paceStr(a.average_speed)}/km</span>) 
                                            : (a.average_speed > 0 && <span>⚡ {(a.average_speed * 3.6).toFixed(1)} km/h</span>)}
                                  {a.average_heartrate > 0 && <span>❤️ {Math.round(a.average_heartrate)} bpm</span>}
                                  {a.suffer_score > 0 && <span>🔥 SS: {Math.round(a.suffer_score)}</span>}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            {/* Zona pico histórico: top 10% del máximo */}
            <ReferenceArea yAxisId="left" y1={peakCTL * 0.9} y2={peakCTL} fill="#3b82f6" fillOpacity={0.08} />
            {/* Zona pico anual (solo si es distinta de la histórica) */}
            {peakCTLYear < peakCTL * 0.98 && (
              <ReferenceArea yAxisId="left" y1={peakCTLYear * 0.9} y2={peakCTLYear} fill="#f59e0b" fillOpacity={0.1} />
            )}
            <Bar yAxisId="right" dataKey="load" radius={[2, 2, 0, 0]} maxBarSize={6} name="Carga" cursor="pointer"
              onClick={(data) => setSelectedDay(prev => prev?.date === data.date ? null : data)}>
              {sampledChart.map((entry, i) => (
                <Cell key={i}
                  fill={selectedDay?.date === entry.date ? '#f97316' : entry.load > 0 ? '#cbd5e1' : 'transparent'}
                />
              ))}
            </Bar>
            <Area yAxisId="left" type="monotone" dataKey="atl" stroke="#fb923c" strokeWidth={1.5} fill="url(#colorAtl)" name="ATL" dot={false} isAnimationActive={false} />
            <Area yAxisId="left" type="monotone" dataKey="ctl" stroke="#3b82f6" strokeWidth={2} fill="url(#colorCtl)" name="CTL" dot={false} isAnimationActive={false} />
            {/* Línea pico histórico */}
            <ReferenceLine yAxisId="left" y={peakCTLVal} stroke="#3b82f6" strokeDasharray="4 3" strokeOpacity={0.6}
              label={{ value: `Pico hist. ${peakCTLVal}`, position: 'insideTopRight', fontSize: 9, fill: '#3b82f6', opacity: 0.8 }} />
            {/* Línea pico anual */}
            {peakCTLYear < peakCTL * 0.98 && (
              <ReferenceLine yAxisId="left" y={Math.round(peakCTLYear * 10) / 10} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.6}
                label={{ value: `Pico año ${Math.round(peakCTLYear * 10) / 10}`, position: 'insideBottomRight', fontSize: 9, fill: '#b45309', opacity: 0.8 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {/* ── Panel actividades del día seleccionado ── */}
        {selectedDay?.activities?.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {new Date(selectedDay.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <button onClick={() => setSelectedDay(null)} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {selectedDay.activities.map((a, i) => (
                <a key={i} href={`https://www.strava.com/activities/${a.id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition-all group"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 text-xs group-hover:text-orange-600 transition-colors truncate">{a.name}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-slate-400">
                      {a.moving_time > 0 && <span>⏱ {timeStr(a.moving_time)}</span>}
                      {isRun(a)
                        ? (a.average_speed > 0 && <span>⚡ {paceStr(a.average_speed)}/km</span>)
                        : (a.average_speed > 0 && <span>⚡ {(a.average_speed * 3.6).toFixed(1)} km/h</span>)}
                      {a.average_heartrate > 0 && <span>❤️ {Math.round(a.average_heartrate)} bpm</span>}
                      {a.suffer_score > 0 && <span>🔥 SS: {Math.round(a.suffer_score)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="font-bold text-slate-700 text-sm">{(a.distance / 1000).toFixed(1)} km</span>
                    <ArrowTopRightOnSquareIcon className="w-4 h-4 text-slate-300 group-hover:text-orange-400 transition-colors" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ── Garmin: FC Reposo + Body Battery cards + chart ── */}
      {garmin && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <HeroCard
              label="FC Reposo"
              value={garmin.currentRHR ?? '—'}
              unit="bpm"
              icon={HeartIcon}
              color={garmin.rhrAllTimeMin && garmin.currentRHR <= garmin.rhrAllTimeMin + 2 ? 'emerald'
                : garmin.rhr28avg && garmin.currentRHR > garmin.rhr28avg + 5 ? 'rose' : 'blue'}
              subRows={[
                { label: 'Media 7 días',       value: garmin.rhr7avg  ? `${garmin.rhr7avg.toFixed(1)} bpm` : '—' },
                { label: 'Media 28 días',      value: garmin.rhr28avg ? `${garmin.rhr28avg.toFixed(1)} bpm` : '—' },
                { label: 'Mínimo histórico',   value: garmin.rhrAllTimeMin ? `${garmin.rhrAllTimeMin} bpm` : '—' },
                { label: 'Mínimo este año',    value: garmin.rhrYearMin    ? `${garmin.rhrYearMin} bpm` : '—' },
              ]}
            />
            <HeroCard
              label={garmin.hasHRV ? 'VFC — RMSSD' : 'Body Battery'}
              value={garmin.currentRec != null ? (garmin.hasHRV ? `${Math.round(garmin.currentRec)}` : garmin.currentRec) : '—'}
              unit={garmin.hasHRV ? 'ms' : '/ 100'}
              icon={BoltIcon}
              color={
                garmin.hasHRV
                  ? (garmin.hrvDeviation > 5 ? 'emerald' : garmin.hrvDeviation < -10 ? 'rose' : 'amber')
                  : (garmin.currentRec >= 80 ? 'emerald' : garmin.currentRec >= 50 ? 'amber' : 'rose')
              }
              subRows={garmin.hasHRV ? [
                { label: 'vs baseline 60d',    value: garmin.hrvDeviation != null ? `${garmin.hrvDeviation >= 0 ? '+' : ''}${garmin.hrvDeviation}%` : '—' },
                { label: 'Media 7 días',       value: garmin.rec7avg   ? `${Math.round(garmin.rec7avg)} ms` : '—' },
                { label: 'Media 28 días',      value: garmin.rec28avg  ? `${Math.round(garmin.rec28avg)} ms` : '—' },
                { label: 'Máximo histórico',   value: garmin.recAllTimeMax ? `${Math.round(garmin.recAllTimeMax)} ms` : '—' },
                { label: 'Máximo este año',    value: garmin.recYearMax    ? `${Math.round(garmin.recYearMax)} ms` : '—' },
              ] : [
                { label: 'Mínimo hoy',         value: garmin.currentBBLow != null ? `${garmin.currentBBLow}/100` : '—' },
                { label: 'Media 7 días',       value: garmin.rec7avg  ? `${garmin.rec7avg.toFixed(0)}/100` : '—' },
                { label: 'Media 28 días',      value: garmin.rec28avg ? `${garmin.rec28avg.toFixed(0)}/100` : '—' },
                { label: 'Máximo histórico',   value: garmin.recAllTimeMax ? `${garmin.recAllTimeMax}/100` : '—' },
              ]}
            />
          </div>

          <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white">
            <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <HeartIcon className="w-4 h-4 text-slate-400" />
                  <Text className="font-bold text-slate-700 text-sm">
                    FC Reposo y {garmin.hasHRV ? 'VFC (RMSSD)' : 'Body Battery'}
                  </Text>
                  <div className="flex items-center gap-1 bg-slate-100 rounded-md p-0.5 ml-2">
                    {[['day', 'Día'], ['week', 'Sem'], ['month', 'Mes']].map(([g, label]) => (
                      <button
                        key={g}
                        onClick={() => setGarminGranularity(g)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                          garminGranularity === g
                            ? 'bg-white text-slate-700 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-400 ml-1">(FC Reposo: eje invertido — arriba = mejor)</span>
                </div>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <button 
                    onClick={() => setShowGarminHR(!showGarminHR)}
                    className={`flex items-center gap-1.5 transition-opacity hover:opacity-80 ${showGarminHR ? 'opacity-100 font-bold text-slate-700' : 'opacity-40 text-slate-500'}`}
                  >
                    <span className="inline-block w-4 h-0.5 bg-red-400 rounded" /> FC Reposo ↑mejor
                  </button>
                  <button 
                    onClick={() => setShowGarminRec(!showGarminRec)}
                    className={`flex items-center gap-1.5 transition-opacity hover:opacity-80 ${showGarminRec ? 'opacity-100 font-bold text-slate-700' : 'opacity-40 text-slate-500'}`}
                  >
                    <span className="inline-block w-4 h-0.5 bg-violet-500 rounded" />
                    {garmin.hasHRV ? 'VFC ms' : 'Body Battery'}
                  </button>
                  {garmin.hasHRV && <span className="flex items-center gap-1 text-slate-400 opacity-70"><span className="inline-block w-3 h-0.5 bg-violet-300 rounded" style={{borderTop:'2px dashed #a78bfa'}} /> Media 7d</span>}
                  <span className="flex items-center gap-1 text-slate-400 opacity-70"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'rgba(34,197,94,0.15)'}} /> Zona mejor hist.</span>
                  <span className="flex items-center gap-1 text-slate-400 opacity-70"><span className="inline-block w-3 h-2 rounded-sm" style={{background:'rgba(134,239,172,0.2)'}} /> Zona mejor año</span>
                </div>
              </div>
              <RangeSelector value={timeRange} onChange={setTimeRange} options={[
                { v: '90d', label: '90d' }, { v: '6m', label: '6m' },
                { v: '1y', label: '1a' }, { v: 'all', label: 'Todo' },
              ]} />
            </div>
            {(() => {
              const cutoff = rangeMs[timeRange] === Infinity ? null
                : new Date(nowMs2 - rangeMs[timeRange]).toISOString().split('T')[0];
              const filteredGarminData = cutoff
                ? garmin.chartData.filter(d => d.date >= cutoff)
                : garmin.chartData;

              let finalGarminData = filteredGarminData;
              if (garminGranularity !== 'day') {
                const grouped = {};
                filteredGarminData.forEach(d => {
                  const dateObj = new Date(d.date);
                  let key = d.date;
                  if (garminGranularity === 'week') {
                    key = weekStartKey(dateObj);
                  } else if (garminGranularity === 'month') {
                    key = `${monthKey(dateObj)}-01`;
                  }
                  if (!grouped[key]) grouped[key] = { date: key, rhr: [], rec: [] };
                  if (d.rhr != null) grouped[key].rhr.push(d.rhr);
                  if (d.rec != null) grouped[key].rec.push(d.rec);
                });
                finalGarminData = Object.values(grouped).map(g => ({
                  date: g.date,
                  rhr: g.rhr.length ? +(g.rhr.reduce((a,b)=>a+b,0)/g.rhr.length).toFixed(1) : null,
                  rec: g.rec.length ? +(g.rec.reduce((a,b)=>a+b,0)/g.rec.length).toFixed(1) : null,
                })).sort((a,b) => a.date.localeCompare(b.date));
              }

              // RHR domain: invert so lower values sit visually higher
              const rhrVals = finalGarminData.map(d => d.rhr).filter(Boolean);
              const rhrMin = rhrVals.length ? Math.min(...rhrVals) - 2 : 40;
              const rhrMax = rhrVals.length ? Math.max(...rhrVals) + 2 : 75;
              return (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={finalGarminData} syncId="statusCharts" margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickFormatter={(d) => { const dt = new Date(d); return `${dt.getDate()}/${dt.getMonth() + 1}`; }}
                  interval="preserveStartEnd"
                  tickLine={false} axisLine={false}
                />
                {/* Eje FC Reposo invertido: domain=[max, min] → valores bajos arriba */}
                {showGarminHR && <YAxis yAxisId="rhr" domain={[rhrMax, rhrMin]} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />}
                {showGarminRec && <YAxis yAxisId="rec" orientation="right"
                  domain={garmin.hasHRV ? ['auto', 'auto'] : [0, 100]}
                  tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />}
                <RechartsTooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(val, name) => [val, name]}
                  labelFormatter={(d) => new Date(d).toLocaleDateString('es-ES')}
                />
                {/* ── FC Reposo zones (eje izquierdo) — verde = bueno, rojo = malo ── */}
                {showGarminHR && garmin.rhrAllTimeMin && (
                  <ReferenceArea yAxisId="rhr" y1={garmin.rhrAllTimeMin} y2={garmin.rhrAllTimeMin + 4} fill="#22c55e" fillOpacity={0.12} />
                )}
                {/* Zona mejor anual (solo si es distinta) */}
                {showGarminHR && garmin.rhrYearMin && garmin.rhrAllTimeMin && garmin.rhrYearMin > garmin.rhrAllTimeMin + 2 && (
                  <ReferenceArea yAxisId="rhr" y1={garmin.rhrYearMin} y2={garmin.rhrYearMin + 4} fill="#86efac" fillOpacity={0.15} />
                )}
                {/* Zona FC alta/peor — visualmente abajo con eje invertido */}
                {showGarminHR && garmin.rhrAllTimeMax && (
                  <ReferenceArea yAxisId="rhr" y1={garmin.rhrAllTimeMax - 4} y2={garmin.rhrAllTimeMax} fill="#ef4444" fillOpacity={0.1} />
                )}

                {/* ── Recovery zones (eje derecho) ── */}
                {showGarminRec && (garmin.hasHRV ? (
                  // HRV: zonas relativas al baseline personal (rec60avg)
                  garmin.rec60avg && <>
                    <ReferenceArea yAxisId="rec" y1={garmin.rec60avg * 1.05} y2={garmin.recAllTimeMax * 1.05} fill="#22c55e" fillOpacity={0.06} />
                    <ReferenceArea yAxisId="rec" y1={garmin.rec60avg * 0.9}  y2={garmin.rec60avg * 1.05}      fill="#f59e0b" fillOpacity={0.05} />
                    <ReferenceArea yAxisId="rec" y1={0}                       y2={garmin.rec60avg * 0.9}       fill="#ef4444" fillOpacity={0.05} />
                  </>
                ) : (
                  // Body Battery: zonas fijas 0-100
                  <>
                    <ReferenceArea yAxisId="rec" y1={75}  y2={100} fill="#22c55e" fillOpacity={0.06} />
                    <ReferenceArea yAxisId="rec" y1={40}  y2={75}  fill="#f59e0b" fillOpacity={0.05} />
                    <ReferenceArea yAxisId="rec" y1={0}   y2={40}  fill="#ef4444" fillOpacity={0.05} />
                  </>
                ))}

                {/* ── Reference lines ── */}
                {showGarminHR && garmin.rhrAllTimeMin && (
                  <ReferenceLine yAxisId="rhr" y={garmin.rhrAllTimeMin} stroke="#16a34a" strokeDasharray="3 3" strokeOpacity={0.7}
                    label={{ value: `Mejor hist. ${garmin.rhrAllTimeMin} bpm`, position: 'insideTopLeft', fontSize: 9, fill: '#16a34a', opacity: 0.9 }} />
                )}
                {showGarminHR && garmin.rhrYearMin && garmin.rhrYearMin !== garmin.rhrAllTimeMin && (
                  <ReferenceLine yAxisId="rhr" y={garmin.rhrYearMin} stroke="#4ade80" strokeDasharray="3 3" strokeOpacity={0.6}
                    label={{ value: `Mejor año ${garmin.rhrYearMin} bpm`, position: 'insideTopLeft', fontSize: 9, fill: '#15803d', opacity: 0.8 }} />
                )}
                {showGarminHR && garmin.rhrAllTimeMax && (
                  <ReferenceLine yAxisId="rhr" y={garmin.rhrAllTimeMax} stroke="#ef4444" strokeDasharray="2 4" strokeOpacity={0.4}
                    label={{ value: `Peor hist. ${garmin.rhrAllTimeMax} bpm`, position: 'insideBottomLeft', fontSize: 9, fill: '#dc2626', opacity: 0.7 }} />
                )}
                {/* Recovery: máximo histórico y baseline */}
                {showGarminRec && garmin.recAllTimeMax && (
                  <ReferenceLine yAxisId="rec" y={Math.round(garmin.recAllTimeMax)} stroke="#7c3aed" strokeDasharray="3 3" strokeOpacity={0.5}
                    label={{ value: `${garmin.hasHRV ? 'Pico VFC' : 'Max BB'} ${Math.round(garmin.recAllTimeMax)}${garmin.hasHRV ? 'ms' : ''}`, position: 'insideTopRight', fontSize: 9, fill: '#7c3aed', opacity: 0.8 }} />
                )}
                {showGarminRec && garmin.rec60avg && (
                  <ReferenceLine yAxisId="rec" y={Math.round(garmin.rec60avg)} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.6}
                    label={{ value: `Baseline 60d ${Math.round(garmin.rec60avg)}${garmin.hasHRV ? 'ms' : ''}`, position: 'insideBottomRight', fontSize: 9, fill: '#7c3aed', opacity: 0.8 }} />
                )}
                {showGarminRec && garmin.recYearMax && garmin.recYearMax !== garmin.recAllTimeMax && (
                  <ReferenceLine yAxisId="rec" y={Math.round(garmin.recYearMax)} stroke="#c4b5fd" strokeDasharray="3 3" strokeOpacity={0.5}
                    label={{ value: `Pico año ${Math.round(garmin.recYearMax)}${garmin.hasHRV ? 'ms' : ''}`, position: 'insideTopRight', fontSize: 9, fill: '#6d28d9', opacity: 0.7 }} />
                )}

                {showGarminRec && <Area yAxisId="rec" type="monotone" dataKey="rec" stroke="#8b5cf6" strokeWidth={1.5} fill="url(#colorRec)"
                  name={garmin.hasHRV ? 'VFC (ms)' : 'Body Battery'} dot={false} isAnimationActive={false} connectNulls />}
                {/* Media móvil 7d solo para HRV (reduce ruido diario) si la vista es diaria */}
                {garminGranularity === 'day' && showGarminRec && garmin.hasHRV && (
                  <Line yAxisId="rec" type="monotone" dataKey="recRolling7" stroke="#a78bfa" strokeWidth={2} strokeDasharray="4 2"
                    name="Media 7d" dot={false} isAnimationActive={false} connectNulls />
                )}
                {showGarminHR && <Line yAxisId="rhr" type="monotone" dataKey="rhr" stroke="#ef4444" strokeWidth={2}
                  name="FC Reposo" dot={false} isAnimationActive={false} connectNulls />}
              </ComposedChart>
            </ResponsiveContainer>
              );
            })()}
            {garmin.lastDate && (
              <p className="text-xs text-slate-400 mt-2 text-right">Último dato: {new Date(garmin.lastDate).toLocaleDateString('es-ES')}</p>
            )}
          </Card>
        </>
      )}

    </div>
  );
}
