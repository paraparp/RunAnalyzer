import { useMemo } from 'react';
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
    <section className="rounded-xl border border-blue-100 bg-blue-50/60 px-5 py-3">
      <h3 className="text-label font-bold uppercase text-blue-700/70 mb-1.5">{title}</h3>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2 text-sm text-slate-700">
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
