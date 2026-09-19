import { useMemo, useState } from 'react';
import cloudStorage from '../lib/cloudStorage';
import {
  ArrowTrendingUpIcon, BoltIcon, FireIcon, CalendarDaysIcon, HeartIcon,
} from '@heroicons/react/24/outline';
import { Card, Text } from '@tremor/react';
import CollapsibleSection from './CollapsibleSection';
import useCalibratedPMC from '../hooks/useCalibratedPMC';
import { computeStats, computeGarminStats, isRun, paceStr, fmt1 } from '../lib/statusStats';
import { PhaseBanner, HeroCard, MiniSparkline, PctPill } from './StatusCards';

// ─────────────────────────────────────────────────────────────────────────────
// El briefing de HOY: en qué fase estás y los cuatro números que contestan
// "¿cómo voy?" — fitness, forma, volumen de la semana y mejor ritmo reciente.
//
// Eran la primera pestaña de `StatusSnapshot`, o sea: el resumen del estado
// estaba a dos clics dentro de una sección de análisis, mientras la portada
// enseñaba los totales del año. Aquí es donde se miran.
// Los detalles (comparativa con el histórico, PMC día a día, Garmin) viven en
// Carga › Mi Estado: esta vista no repite sus gráficos.
// ─────────────────────────────────────────────────────────────────────────────

export default function StatusHero({ activities }) {
  const { pmc } = useCalibratedPMC(activities);
  const pmcSeries = pmc?.series ?? null;
  const pmcCurrent = pmc?.current ?? null;
  // "Ahora" estable por montaje: las ventanas de 7/28 días no pueden moverse
  // entre repintados.
  const [nowMs] = useState(() => Date.now());

  const stats = useMemo(
    () => (pmcSeries && pmcCurrent
      ? computeStats(activities, { series: pmcSeries, current: pmcCurrent }, { now: nowMs })
      : null),
    [activities, pmcSeries, pmcCurrent, nowMs],
  );

  const garmin = useMemo(() => {
    try {
      const raw = cloudStorage.getItem('garmin_cardiac_data');
      if (raw) return computeGarminStats(JSON.parse(raw), { now: nowMs });
    } catch { /* cache de Garmin ilegible: se sigue sin ella */ }
    return null;
  }, [nowMs]);

  if (!stats) return null;

  const {
    currentCTL, currentATL, currentTSB, currentACWR,
    peakCTL, peakCTLYear, ctl7ago,
    last7daysKm, avgWeekKmYear, peakWeekKm, peakWeekKmYear,
    bestPace10kRecent, bestPace10kYear, bestPace10kAll, bestPace5kRecent,
    hrEffRecent, hrEffYear, hrEffAll,
    activeLast7, activeLast28, streak,
    elevLast28, avgMonthlyElevYear, peakMonthlyElev,
    chartDataFull, sparkData,
  } = stats;

  const ctlTrend = currentCTL - ctl7ago;
  const ctlPctPeak = peakCTL > 0 ? Math.round((currentCTL / peakCTL) * 100) : 0;
  const fitnessColor = ctlPctPeak >= 80 ? 'emerald' : ctlPctPeak >= 50 ? 'blue' : 'amber';
  const formColor = currentTSB > 5 ? 'emerald' : currentTSB > -5 ? 'amber' : 'rose';

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


  return (
    <div className="space-y-4">
      {/* ── Phase Banner ── */}
      <PhaseBanner tsb={currentTSB} acwr={currentACWR} garmin={garmin} />

      {/* ── Hero Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <HeroCard
          label="Fitness (CTL)"
          value={fmt1(currentCTL)}
          trendDelta={ctlTrend}
          icon={ArrowTrendingUpIcon}
          color={fitnessColor}
          subRows={[
            { label: 'Pico histórico',  value: `${fmt1(peakCTL)} (${ctlPctPeak}%)` },
            { label: 'Pico este año',   value: fmt1(peakCTLYear) },
            { label: 'Tendencia 7d',    value: ctlTrend >= 0 ? `+${ctlTrend.toFixed(1)}` : ctlTrend.toFixed(1) },
          ]}
        />
        <HeroCard
          label="Forma (TSB)"
          value={fmt1(currentTSB)}
          icon={BoltIcon}
          color={formColor}
          subRows={[
            { label: 'Fatiga actual (ATL)',  value: fmt1(currentATL) },
            { label: 'ACWR',                value: currentACWR.toFixed(2) },
            { label: 'Días activos (7d)',    value: `${activeLast7} / 7` },
          ]}
        />
        <HeroCard
          label="Volumen semanal"
          value={last7daysKm.toFixed(1)}
          unit="km"
          icon={CalendarDaysIcon}
          color="blue"
          subRows={[
            { label: 'Media semanal año', value: `${avgWeekKmYear.toFixed(1)} km` },
            { label: 'Semana pico año',   value: `${peakWeekKmYear.toFixed(1)} km` },
            { label: 'Semana pico total', value: `${peakWeekKm.toFixed(1)} km` },
          ]}
        />
        <HeroCard
          label="Mejor ritmo reciente"
          value={paceStr(bestPace10kRecent) !== '—' ? paceStr(bestPace10kRecent) : paceStr(bestPace5kRecent)}
          unit={paceStr(bestPace10kRecent) !== '—' ? '/km 10k' : '/km 5k'}
          icon={FireIcon}
          color="amber"
          subRows={[
            { label: 'PB 10k este año',   value: paceStr(bestPace10kYear) },
            { label: 'PB 10k histórico',  value: paceStr(bestPace10kAll) },
            { label: 'Racha actual',       value: `${streak} días` },
          ]}
        />
      </div>

      {/* La comparativa contra el histórico: el mismo estado, con contexto. Va
          plegada porque la portada contesta "¿cómo voy?" con los cuatro números
          de arriba; esto es para cuando quieres saber respecto a qué. */}
      <CollapsibleSection title="Estado actual vs mejor histórico" defaultOpen={false}>
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
      </CollapsibleSection>
    </div>
  );
}
