import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ClockIcon,
  FireIcon,
  FlagIcon,
  SparklesIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
} from '@heroicons/react/24/outline';
import { isRun } from '../lib/statusStats';
import { gapSpeedFromGain } from '../lib/gap';
import { weekStartKey } from '../lib/isoWeek';
import { formatPaceFromSpeed } from '../lib/timeFormat';

// ─────────────────────────────────────────────────────────────────────────────
// Rejilla de KPIs globales de running (histórico completo): distancia, sesiones,
// tiempo, ritmo medio, GAP y desnivel. Vive en la vista de Carga porque son los
// totales acumulados del atleta, el contexto del que cuelga todo lo demás.
//
// El cálculo es el mismo que usaban estos números en la portada: GAP real por
// actividad (Minetti sobre el D+ acumulado), semanas REALES con actividad para
// la media semanal, y `—` cuando un dato no está, nunca un relleno.
// ─────────────────────────────────────────────────────────────────────────────

const DASH = '—';
const EVEREST_M = 8848;               // altura del Everest, para el equivalente en D+

const fmtInt = (v) => (v == null || !Number.isFinite(v) ? DASH : Math.round(v).toLocaleString());
const fmtNum = (v, d = 1) => (v == null || !Number.isFinite(v) ? DASH : Number(v).toFixed(d));

export default function GlobalKpiGrid({ activities }) {
  const { t } = useTranslation();

  const runs = useMemo(() => (activities || []).filter(isRun), [activities]);

  const globalKpis = useMemo(() => {
    const nowMs = Date.now();
    let distM = 0, time = 0, elev = 0, gapDistM = 0, withHr = 0;
    const weeks = new Set();

    runs.forEach(r => {
      const d = r.distance || 0;
      const s = r.moving_time || 0;
      distM += d;
      time += s;
      elev += r.total_elevation_gain || 0;
      if (r.average_heartrate) withHr++;
      if (r.start_date) weeks.add(weekStartKey(new Date(r.start_date)));
      // GAP real por actividad (Minetti sobre el D+ acumulado), no un factor fijo.
      if (r.average_speed > 0 && s > 0) {
        gapDistM += gapSpeedFromGain(r.average_speed, d, r.total_elevation_gain || 0) * s;
      }
    });

    const avgSpeed = time > 0 ? distM / time : null;
    const avgGapSpeed = time > 0 && gapDistM > 0 ? gapDistM / time : null;
    // Segundos/km que el terreno se lleva: la diferencia entre ritmo real y GAP.
    const gapGainSec = avgSpeed && avgGapSpeed
      ? Math.round(1000 / avgSpeed - 1000 / avgGapSpeed)
      : null;

    // Tendencia de volumen: últimos 30 días contra los 30 anteriores.
    const cutoff30 = nowMs - 30 * 86400000;
    const cutoff60 = nowMs - 60 * 86400000;
    let distLast30 = 0, distPrev30 = 0;
    runs.forEach(r => {
      const ts = new Date(r.start_date).getTime();
      if (ts >= cutoff30 && ts <= nowMs) distLast30 += (r.distance || 0) / 1000;
      else if (ts >= cutoff60) distPrev30 += (r.distance || 0) / 1000;
    });
    const trend30 = distPrev30 > 0 ? Math.round(((distLast30 - distPrev30) / distPrev30) * 100) : null;

    const totalHours = time > 0 ? time / 3600 : null;
    // Semanas REALES con actividad, no una estimación por número de sesiones.
    const weeklyHours = totalHours != null && weeks.size > 0 ? totalHours / weeks.size : null;

    return {
      distanceKm: distM > 0 ? distM / 1000 : null,
      trend30,
      sessionsCount: runs.length,
      hrCoveragePct: runs.length ? Math.round((withHr / runs.length) * 100) : null,
      totalHours,
      weeklyHours,
      avgPace: formatPaceFromSpeed(avgSpeed ?? 0, DASH),
      avgGap: formatPaceFromSpeed(avgGapSpeed ?? 0, DASH),
      gapGainSec,
      elevationM: elev > 0 ? elev : null,
      everestEquiv: elev > 0 ? elev / EVEREST_M : null,
    };
  }, [runs]);

  if (!runs.length) return null;

  return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Distancia */}
        <div className="flex flex-col justify-between p-4 rounded-xl border border-slate-200/80 bg-white shadow-sm hover:shadow-md transition-shadow dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('dashboard.distance')}</span>
            <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center dark:bg-blue-950/60 dark:text-blue-400">
              <span className="material-symbols-outlined text-[16px]">straighten</span>
            </div>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-900 dark:text-slate-50 tabular-nums">
                {fmtInt(globalKpis.distanceKm)}
              </span>
              <span className="text-xs text-slate-400 font-semibold">km</span>
            </div>
            {globalKpis.trend30 != null ? (
              <div className={`mt-1 flex items-center gap-1 text-[10px] font-bold ${
                globalKpis.trend30 >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
              }`}>
                {globalKpis.trend30 >= 0
                  ? <ArrowTrendingUpIcon className="w-3 h-3" />
                  : <ArrowTrendingDownIcon className="w-3 h-3" />}
                <span>{globalKpis.trend30 >= 0 ? '+' : ''}{globalKpis.trend30}% vs mes ant.</span>
              </div>
            ) : (
              <div className="mt-1 text-[10px] font-medium text-slate-400">Sin mes previo comparable</div>
            )}
          </div>
        </div>

        {/* Card 2: Sesiones */}
        <div className="flex flex-col justify-between p-4 rounded-xl border border-slate-200/80 bg-white shadow-sm hover:shadow-md transition-shadow dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('dashboard.activities')}</span>
            <div className="w-7 h-7 rounded-full bg-cyan-50 text-cyan-600 flex items-center justify-center dark:bg-cyan-950/60 dark:text-cyan-400">
              <ClockIcon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-900 dark:text-slate-50 tabular-nums">
                {globalKpis.sessionsCount}
              </span>
              <span className="text-xs text-slate-400 font-semibold">runs</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
              {/* Cobertura real de pulsómetro, no un "100% sincronizado" fijo. */}
              <span>{globalKpis.hrCoveragePct != null ? `${globalKpis.hrCoveragePct}% con FC` : 'Sin datos de FC'}</span>
            </div>
          </div>
        </div>

        {/* Card 3: Tiempo Activo */}
        <div className="flex flex-col justify-between p-4 rounded-xl border border-slate-200/80 bg-white shadow-sm hover:shadow-md transition-shadow dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('dashboard.time')}</span>
            <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center dark:bg-slate-800 dark:text-slate-300">
              <ClockIcon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-900 dark:text-slate-50 tabular-nums">
                {fmtInt(globalKpis.totalHours)}
              </span>
              <span className="text-xs text-slate-400 font-semibold">horas</span>
            </div>
            <div className="mt-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
              Media {fmtNum(globalKpis.weeklyHours)}h / semana
            </div>
          </div>
        </div>

        {/* Card 4: Ritmo Medio */}
        <div className="flex flex-col justify-between p-4 rounded-xl border border-slate-200/80 bg-white shadow-sm hover:shadow-md transition-shadow dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('dashboard.avg_pace')}</span>
            <div className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center dark:bg-emerald-950/60 dark:text-emerald-400">
              <FireIcon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-900 dark:text-slate-50 tabular-nums">
                {globalKpis.avgPace}
              </span>
              <span className="text-xs text-slate-400 font-semibold">/km</span>
            </div>
            <div className="mt-1">
              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[9px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                Histórico completo
              </span>
            </div>
          </div>
        </div>

        {/* Card 5: Ritmo Ajustado (GAP) */}
        <div className="flex flex-col justify-between p-4 rounded-xl border border-slate-200/80 bg-white shadow-sm hover:shadow-md transition-shadow dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('dashboard.gap')}</span>
            <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center dark:bg-indigo-950/60 dark:text-indigo-400">
              <SparklesIcon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-900 dark:text-slate-50 tabular-nums">
                {globalKpis.avgGap}
              </span>
              <span className="text-xs text-slate-400 font-semibold">/km</span>
            </div>
            <div className="mt-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
              {globalKpis.gapGainSec != null ? `-${globalKpis.gapGainSec}s compensado D+` : 'Sin desnivel registrado'}
            </div>
          </div>
        </div>

        {/* Card 6: Elevación Acumulada */}
        <div className="flex flex-col justify-between p-4 rounded-xl border border-slate-200/80 bg-white shadow-sm hover:shadow-md transition-shadow dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('dashboard.elevation')}</span>
            <div className="w-7 h-7 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center dark:bg-amber-950/60 dark:text-amber-400">
              <FlagIcon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-900 dark:text-slate-50 tabular-nums">
                {fmtInt(globalKpis.elevationM)}
              </span>
              <span className="text-xs text-slate-400 font-semibold">m D+</span>
            </div>
            <div className="mt-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
              {fmtNum(globalKpis.everestEquiv)}x Everest Equiv.
            </div>
          </div>
        </div>
      </div>
  );
}
