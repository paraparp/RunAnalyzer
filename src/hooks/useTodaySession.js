import { useEffect, useMemo, useState } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { readGarminCreds } from '../lib/garminHealthStore';
import { toISODate } from '../lib/planSchedule';
import { AI_PLAN_KEY, GARMIN_PLANNED_KEY, resolveTodaySession } from '../lib/todaySession';
import { fetchPlannedWorkouts } from '../services/garminWorkouts';

const readJSON = (key) => {
  try { return JSON.parse(cloudStorage.getItem(key) || 'null'); } catch { return null; }
};

/**
 * Qué toca hoy (lib/todaySession): Garmin > plan del Entrenador IA > automática.
 *
 * El calendario de Garmin se pide en vivo, pero como mucho UNA vez al día: se
 * cachea con la fecha en que se bajó (el rate-limit de Garmin no aguanta una
 * petición por visita a la portada). Sin Garmin conectado no se pide nada. Un
 * fallo de red deja la caché como estaba y la portada sigue con el plan o la
 * propuesta automática.
 */
export default function useTodaySession({ advisesRest, nowMs }) {
  const todayISO = toISODate(new Date(nowMs));
  const [garminCache, setGarminCache] = useState(() => readJSON(GARMIN_PLANNED_KEY));
  const savedPlan = useMemo(() => readJSON(AI_PLAN_KEY), []);

  useEffect(() => {
    if (!readGarminCreds() || garminCache?.fetched_on === todayISO) return undefined;
    const controller = new AbortController();
    fetchPlannedWorkouts({ signal: controller.signal })
      .then((data) => {
        const next = { fetched_on: todayISO, planned: data?.planned ?? [] };
        cloudStorage.setItem(GARMIN_PLANNED_KEY, JSON.stringify(next));
        setGarminCache(next);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') console.warn('[today] calendario de Garmin no disponible', e);
      });
    return () => controller.abort();
  }, [todayISO, garminCache?.fetched_on]);

  return useMemo(
    () => resolveTodaySession({
      garminPlanned: garminCache?.planned ?? [],
      savedPlan,
      todayISO,
      advisesRest,
    }),
    [garminCache, savedPlan, todayISO, advisesRest],
  );
}
