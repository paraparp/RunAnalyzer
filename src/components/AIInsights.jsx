import { useMemo } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { ClockIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import HRZonesCard from './HRZonesCard';
import { CoachDisclosure as Disclosure } from './CoachAI';
import {
  RUN_TYPES, RIDE_TYPES, activityEmoji,
  paceStr, formatDataDate,
} from '../lib/aiInsights';

// Pie del análisis del Coach IA. El diagnóstico, la sesión, la tendencia y la
// ejecución viven ya en los módulos de la portada (TodayView), que es quien
// llama a `useAIInsights` y pasa aquí su estado (`ai`): aquí queda la
// referencia — zonas de FC, fuentes y sesiones que alimentan el análisis.
const AIInsights = ({ activities, ai, onOpenChat }) => {
  const { cur, trend, nextWork, lastWork, sci, garmin, stravaFetch } = ai;

  const sortedActivities = useMemo(
    () => [...(activities ?? [])].sort((a, b) => new Date(b.start_date) - new Date(a.start_date)),
    [activities]
  );

  if (!activities || activities.length < 3) return null;

  const hasGarmin = garmin?.length > 0;

  // ── Data freshness (last sync of each source) ───────────────────────────────
  const garminDataDate = hasGarmin
    ? [...garmin].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
    : null;
  const stravaFresh = formatDataDate(stravaFetch);
  const garminFresh = formatDataDate(garminDataDate);

  const openInChat = (focus) => {
    try {
      const last = sortedActivities[0];
      const lastDesc = last
        ? `mi última sesión «${last.name}» del ${new Date(last.start_date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}`
        : 'mi última sesión';
      const ASKS = {
        cur: 'Amplía el diagnóstico de mi estado actual: explica en detalle qué indican mis métricas (readiness, TSB, ACWR, VFC, sueño…), qué riesgos ves y qué debería vigilar los próximos días. Quiero un análisis largo y razonado, con secciones.',
        nextWork: 'Amplía la sesión que me recomiendas: desglosa calentamiento, bloques principales con ritmos y FC objetivo, vuelta a la calma, y explica por qué esta sesión y no otra dado mi estado actual. Quiero el detalle completo de ejecución.',
        trend: 'Amplía el análisis de mi tendencia de los últimos 2 meses: evolución de volumen, ritmo y FC, qué patrón ves en mi carga (ACWR, progresión) y qué proyección haces si sigo así. Quiero un análisis largo apoyado en cifras concretas.',
        lastWork: `Analiza en profundidad ${lastDesc}: valora ritmo, FC, desnivel y esfuerzo comparándola con mis sesiones anteriores, dime qué hice bien, qué puedo mejorar y cómo encaja en mi carga actual. Quiero un análisis extendido, no un resumen.`,
        general: 'Amplía todo el análisis del panel de IA: explícame con más detalle mi estado actual y qué indican mis métricas, la tendencia de los últimos 2 meses, cómo fue mi última sesión y por qué me recomiendas la próxima sesión. Quiero un análisis largo y completo, con secciones.',
      };
      const seed = {
        ts: Date.now(),
        blocks: { cur, trend, nextWork, lastWork },
        focus: focus ?? 'general',
        ask: ASKS[focus ?? 'general'] ?? null,
        sci: sci ? {
          readiness: sci.readiness?.score ?? null,
          readinessLabel: sci.readiness?.label ?? null,
          ctl: sci.pmc?.ctl ?? null,
          atl: sci.pmc?.atl ?? null,
          tsb: sci.pmc?.tsb ?? null,
          acwr: sci.pmc?.acwr ?? null,
          fcmax: sci.fcmax ?? null,
          fcRest: sci.fcRest ?? null,
          lthr: sci.lthr ?? null,
        } : null,
      };
      cloudStorage.setItem('runqa_seed', JSON.stringify(seed));
    } catch { /* ignore quota/serialization errors */ }
    onOpenChat?.();
  };

  return (
    <div className="space-y-5">

      {/* ── ZONAS DE FC — referencia (plegada): mismos umbrales que usa el coach ── */}
      <HRZonesCard sci={sci} />

      {/* ═══════════ 04 · FUENTES — pie único: qué se analizó, cuándo y con qué ═══════════ */}
      <div className="border-t border-slate-200/60 dark:border-slate-800/60 pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 text-[10px] font-semibold text-slate-500">
          <span className="flex items-center gap-1.5">
            <ClockIcon className="w-3.5 h-3.5 shrink-0" />
            {sortedActivities.length} sesiones analizadas
          </span>
          {stravaFresh && <span className="font-mono">Strava {stravaFresh}</span>}
          {garminFresh && <span className="font-mono">Garmin {garminFresh}</span>}
        </div>
        {onOpenChat && (cur || trend || nextWork) && (
          <button
            onClick={() => openInChat()}
            className="shrink-0 self-start sm:self-center inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border border-blue-100/50 dark:border-blue-900/50 hover:bg-blue-100/80 hover:text-blue-700 transition-all"
          >
            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
            <span>Consultar Coach Virtual</span>
          </button>
        )}
      </div>

      {/* Detalle de las sesiones que alimentan el análisis (plegado) */}
      <Disclosure label="Sesiones analizadas">
        <div className="flex flex-wrap gap-2">
          {sortedActivities.slice(0, 5).map(a => {
            const tooltipParts = [];
            if (a.name) tooltipParts.push(a.name);
            tooltipParts.push(new Date(a.start_date).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
            if (a.total_elevation_gain) tooltipParts.push(`Desnivel: +${Math.round(a.total_elevation_gain)}m`);
            if (a.average_heartrate) tooltipParts.push(`FC Media: ${Math.round(a.average_heartrate)} ppm`);
            if (a.suffer_score) tooltipParts.push(`Esfuerzo: ${a.suffer_score}`);

            return (
              <div key={a.id} title={tooltipParts.join('\n')} className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 rounded-md cursor-help hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <span className="font-mono text-[9px] text-slate-500 font-medium border-r border-slate-200 dark:border-slate-700 pr-1.5">
                  {new Date(a.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                  <span>{activityEmoji(a.type)}</span>
                  <span className="font-mono tabular-nums">
                    {a.distance > 0 ? `${(a.distance / 1000).toFixed(1)}k` : `${Math.round((a.moving_time || 0) / 60)}min`}
                  </span>
                </span>
                {a.moving_time > 0 && a.distance > 0 && RUN_TYPES.includes(a.type) && (
                  <span className="font-mono text-[9px] text-slate-500 font-medium border-l border-slate-200 dark:border-slate-700 pl-1.5 tabular-nums">
                    {`${paceStr((a.moving_time / 60) / (a.distance / 1000))}/km`}
                  </span>
                )}
                {a.moving_time > 0 && a.distance > 0 && RIDE_TYPES.includes(a.type) && (
                  <span className="font-mono text-[9px] text-slate-500 font-medium border-l border-slate-200 dark:border-slate-700 pl-1.5 tabular-nums">
                    {((a.distance / 1000) / (a.moving_time / 3600)).toFixed(1)} km/h
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Disclosure>

    </div>
  );
};

export default AIInsights;
