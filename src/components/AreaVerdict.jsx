import { useEffect, useMemo, useState } from 'react';
import { getPrimaryTargetRace, daysUntil, formatMinutes, DISTANCE_KM, TARGET_RACES_EVENT } from '../lib/targetRaces';
import { useTranslation } from 'react-i18next';
import useCalibratedPMC from '../hooks/useCalibratedPMC';
import useTimeScope from '../hooks/useTimeScope';
import { karvonenBounds } from '../lib/hrZones';
import { scopeMonths } from '../lib/timeScope';
import { formatPaceFromMinPerKm } from '../lib/timeFormat';
import { loadVerdict, engineVerdict } from '../lib/areaVerdicts';

// Conclusión del área (§6.3 del plan): unas líneas derivadas de los módulos dueños
// de cada número (lib/areaVerdicts). Se pinta encima de cada vista del área.

const TONE_DOT = {
  good: 'bg-emerald-500',
  neutral: 'bg-slate-400',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
};

function VerdictList({ title, items }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <section className="rounded-xl border border-teal-200 dark:border-teal-300/25 bg-teal-50 dark:bg-teal-400/10 px-5 py-3">
      <h3 className="text-label font-bold uppercase text-teal-800/80 dark:text-teal-200/70 mb-1.5">{title}</h3>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2 text-sm text-slate-700 dark:text-white/75">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[it.tone] ?? TONE_DOT.neutral}`} />
            <span>{t(it.key, it.params)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Carga: fase, ACWR y tendencia del CTL, del mismo PMC calibrado que la pestaña. */
export function LoadVerdict({ activities }) {
  const { t } = useTranslation();
  const { pmc } = useCalibratedPMC(activities);
  const items = useMemo(() => loadVerdict(pmc?.current), [pmc]);
  return <VerdictList title={t('area_verdict.load.title')} items={items} />;
}

/**
 * Competición: la carrera principal, cuánto falta y a qué ritmo hay que correrla.
 * Es la referencia de todas las vistas del área (plan, predictor, historial).
 */
export function RacingVerdict() {
  const { t } = useTranslation();
  const [race, setRace] = useState(getPrimaryTargetRace);
  useEffect(() => {
    const refresh = () => setRace(getPrimaryTargetRace());
    window.addEventListener(TARGET_RACES_EVENT, refresh);
    return () => window.removeEventListener(TARGET_RACES_EVENT, refresh);
  }, []);

  const items = useMemo(() => {
    const days = race ? daysUntil(race.date) : null;
    if (!race || days == null || days < 0) {
      return [{ id: 'race', tone: 'neutral', key: 'area_verdict.racing.no_race' }];
    }
    const phase = days === 0 ? 'today' : days <= 7 ? 'week' : days <= 21 ? 'taper' : 'build';
    const out = [{
      id: 'race',
      tone: days <= 7 ? 'warn' : 'good',
      key: `area_verdict.racing.race_${phase}`,
      params: { name: race.name, days, weeks: Math.round(days / 7) },
    }];
    const km = DISTANCE_KM[race.distance];
    if (race.goalTimeMin > 0) {
      out.push({
        id: 'goal',
        tone: 'neutral',
        key: km ? 'area_verdict.racing.goal_pace' : 'area_verdict.racing.goal',
        params: { goal: formatMinutes(race.goalTimeMin), pace: km ? formatPaceFromMinPerKm(race.goalTimeMin / km) : null },
      });
    } else {
      out.push({ id: 'goal', tone: 'neutral', key: 'area_verdict.racing.no_goal' });
    }
    return out;
  }, [race]);
  return <VerdictList title={t('area_verdict.racing.title')} items={items} />;
}

/** Motor: eficiencia, velocidad crítica, deriva y 80/20 dentro del período compartido. */
export function EngineVerdict({ runs, hrParams }) {
  const { t } = useTranslation();
  const [scope] = useTimeScope();
  const { hrmax, hrrest } = hrParams ?? {};
  const items = useMemo(() => {
    const bounds = hrmax && hrrest ? karvonenBounds({ hrmax, hrrest }) : null;
    return engineVerdict(runs, { months: scopeMonths(scope), hrmax, bounds }).map((it) => {
      const params = { ...it.params };
      if (params.pace != null) params.pace = formatPaceFromMinPerKm(params.pace);
      if (params.level) params.level = t(`decoupling.levels.${params.level}`).toLowerCase();
      if (params.delta != null) params.delta = `${params.delta > 0 ? '+' : ''}${params.delta}`;
      return { ...it, params };
    });
  }, [runs, scope, hrmax, hrrest, t]);
  return <VerdictList title={t('area_verdict.engine.title')} items={items} />;
}
