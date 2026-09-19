import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrophyIcon } from '@heroicons/react/24/outline';
import NextRaceBanner from './NextRaceBanner';
import StatusHero from './StatusHero';
import TodayBalance from './TodayBalance';
import AIInsights from './AIInsights';
import PersonalBests from './PersonalBests';

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

// ─────────────────────────────────────────────────────────────────────────────
// Hoy. La portada contesta "¿cómo voy y qué hago?": carrera objetivo, estado,
// los dos repartos del último mes, el análisis de la IA y las marcas.
//
// Salió de `App.jsx` junto con la bitácora: el "dashboard" era portada y listado
// a la vez, y por eso el filtro de año de la barra superior mandaba también sobre
// lo que aquí es historia. Las marcas son de TODO el histórico, que es lo que
// significa un récord personal.
// ─────────────────────────────────────────────────────────────────────────────

export default function TodayView({ activities, runningActivities, hrParams, onNavigate, onOpenChat }) {
  const { t } = useTranslation();

  const runs = useMemo(
    () => runningActivities ?? activities.filter(a => RUNNING_TYPES.includes(a.sport_type || a.type)),
    [activities, runningActivities],
  );

  return (
    <div className="fade-in space-y-6">

      {/* Next target race countdown */}
      <NextRaceBanner
        onManage={() => onNavigate('targets')}
        onOpenPlan={(id) => onNavigate(`targets/${id}`)}
      />

      {/* Estado de hoy: fase + fitness/forma/volumen/ritmo, con la comparativa
          contra el histórico plegada dentro. */}
      <StatusHero activities={activities} />

      {/* Los dos repartos de hoy: en qué zonas se ha entrenado el
          último mes y cómo queda la carga contra el propio techo.
          Sin series temporales — esas son de Zonas y del PMC. */}
      <TodayBalance
        activities={activities}
        runActivities={runs}
        hrParams={hrParams}
        onOpenZones={() => onNavigate('zones')}
        onOpenLoad={() => onNavigate('pmc')}
      />

      {activities.length > 0 && (
        <div className="space-y-6">
        {/* Section 1: AI Insights (full width) */}
        <AIInsights activities={activities} onOpenChat={onOpenChat} />

        {/* Section 2: Personal Bests — horizontal row below the diagnosis */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-800">{t('dashboard.personal_bests')}</h3>
              <p className="text-[11px] text-slate-400">{t('dashboard.records.5k')} · {t('dashboard.records.10k')} · {t('dashboard.records.hm')} · {t('dashboard.records.fm')}</p>
            </div>
            <TrophyIcon className="w-5 h-5 text-amber-400 shrink-0" />
          </div>
          <PersonalBests activities={runs} horizontal />
        </div>
        </div>
      )}
    </div>
  );
}
