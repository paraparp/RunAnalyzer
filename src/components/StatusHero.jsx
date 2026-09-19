import { useMemo, useState } from 'react';
import cloudStorage from '../lib/cloudStorage';
import {
  ArrowTrendingUpIcon, BoltIcon, FireIcon, CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import useCalibratedPMC from '../hooks/useCalibratedPMC';
import { computeStats, computeGarminStats, paceStr, fmt1 } from '../lib/statusStats';
import { PhaseBanner, HeroCard } from './StatusCards';

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
    activeLast7, streak,
  } = stats;

  const ctlTrend = currentCTL - ctl7ago;
  const ctlPctPeak = peakCTL > 0 ? Math.round((currentCTL / peakCTL) * 100) : 0;
  const fitnessColor = ctlPctPeak >= 80 ? 'emerald' : ctlPctPeak >= 50 ? 'blue' : 'amber';
  const formColor = currentTSB > 5 ? 'emerald' : currentTSB > -5 ? 'amber' : 'rose';

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
    </div>
  );
}
