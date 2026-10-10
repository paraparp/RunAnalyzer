import { useEffect, useMemo, useState } from 'react';
import useHrParams from './useHrParams';
import useCalibratedPMC from './useCalibratedPMC';
import useTimeScope from './useTimeScope';
import { scopeDays } from '../lib/timeScope';
import { readCardiac, readSleep, SYNC_COMPLETE_EVENT } from '../lib/garminHealthStore';
import { fetchWeightHistory } from '../services/garminWorkouts';
import {
  buildVitalMetrics, domainOf, xFormatter, GRAN_MIN_DAYS, GRAN_LABEL, AVG_LABEL, MS_DAY,
} from '../lib/vitalSeries';

// El peso se lee de Garmin en vivo: se pide un tope fijo una vez por montaje en
// vez de por cada cambio de período (el corte al período lo hace buildVitalMetrics).
const WEIGHT_DAYS = 1825;

/**
 * Métricas vitales del período global (lib/timeScope) con la granularidad
 * elegida. Compartido por Resumen Vital y el Explorador de Salud.
 *
 * @param {Array}   activities  carreras (VO₂max submáximo y eficiencia)
 * @param {object}  [opts]
 * @param {boolean} [opts.withWeight] pedir el peso a Garmin (llamada en vivo)
 * @param {Array}   [opts.loadActivities] actividades para la carga (todas, con
 *   cruzado, como la pestaña PMC); por defecto `activities`
 */
export default function useVitalMetrics(activities, { withWeight = false, loadActivities } = {}) {
  // "Todo" no tiene días: se usa un tope que cubre cualquier histórico.
  const [scope] = useTimeScope();
  const days = scopeDays(scope) ?? 99999;
  // La granularidad elegida se RESPETA, pero si el período no da para ella se
  // pinta diaria: se deriva en vez de reescribir la elección, así que al volver
  // a un período largo reaparece la que tenías.
  const [granPick, setGran] = useState('day'); // day | week | month | year
  const gran = days >= GRAN_MIN_DAYS[granPick] ? granPick : 'day';
  const [gapAdjust, setGapAdjust] = useState(false); // ajustar eficiencia por desnivel (GAP)
  // Extremo derecho de la ventana, estable por montaje: leerlo en cada render
  // movía el corte y hacía entrar y salir puntos según cuántas veces se repintara.
  const [nowMs] = useState(() => Date.now());

  const [garmin, setGarmin] = useState(readCardiac);
  const [sleep, setSleep] = useState(readSleep);
  useEffect(() => {
    const onUpdate = () => { setGarmin(readCardiac()); setSleep(readSleep()); };
    const events = ['garmin-cardiac-updated', 'storage', SYNC_COMPLETE_EVENT];
    events.forEach((e) => window.addEventListener(e, onUpdate));
    return () => events.forEach((e) => window.removeEventListener(e, onUpdate));
  }, []);

  const [weights, setWeights] = useState([]);
  useEffect(() => {
    if (!withWeight) return undefined;
    const ctrl = new AbortController();
    fetchWeightHistory({ days: WEIGHT_DAYS, signal: ctrl.signal })
      .then((d) => setWeights(d.weights || []))
      .catch(() => { /* sin báscula o sin conexión: la métrica sale vacía */ });
    return () => ctrl.abort();
  }, [withWeight]);

  // FCmax / FCreposo: la MISMA calibración que el resto de la app (override
  // manual → detección → fórmula), para que el VO₂max cuadre con su pestaña.
  const { hrmax, hrrest } = useHrParams(activities);

  // Carga: el PMC calibrado compartido (mismo CTL que la pestaña PMC y el coach).
  const { pmc } = useCalibratedPMC(loadActivities ?? activities);
  const pmcSeries = pmc?.series;

  const built = useMemo(
    () => buildVitalMetrics({ garmin, sleep, weights, pmc: pmcSeries ?? [], activities, days, gran, gapAdjust, hrmax, hrrest, nowMs }),
    [garmin, sleep, weights, pmcSeries, activities, days, gran, gapAdjust, hrmax, hrrest, nowMs],
  );

  return {
    ...built,
    garmin,
    hasGarmin: garmin.length > 0,
    domainFor: (keys) => domainOf(
      built.metrics.filter((m) => keys.includes(m.key)),
      [nowMs - days * MS_DAY, nowMs],
    ),
    days, gran, setGran, gapAdjust, setGapAdjust, nowMs,
    xFmt: xFormatter(gran),
    granLabel: GRAN_LABEL[gran],
    avgLabel: AVG_LABEL[gran],
  };
}
