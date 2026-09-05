// ── PMC calibrado — el único CTL de la app ───────────────────────────────────
// Estado, PMC, Lesión y Vitales llamaban cada una a `computePMC(activities)` a
// secas. Sin `opts` eso usa FC de reposo 60 y LTHR por fórmula (ver
// lib/loadCalibration), así que las cuatro pintaban un CTL sesgado y ninguna
// respetaba los overrides manuales de la pestaña de Zonas.
//
// Este hook resuelve las dos entradas que faltaban (FC de reposo de Garmin y
// overrides guardados) y delega el cálculo en la calibración compartida, que es
// la misma que reproduce el MCP en el servidor. Consumirlo es lo que garantiza
// que el número de la app y el del agente coincidan.
import { useMemo, useState, useEffect } from 'react';
import cloudStorage from '../lib/cloudStorage';
import useGarminWearableData from './useGarminWearableData';
import { computeCalibratedPMC } from '../lib/loadCalibration';
import { OVERRIDES_KEY, loadOverrides } from './useHrParams';

export default function useCalibratedPMC(activities) {
  const { garmin } = useGarminWearableData();

  // Los overrides los escribe useHrParams desde la pestaña de Zonas; aquí solo se
  // leen, y se recargan cuando cambian para que el CTL siga al ajuste manual sin
  // esperar a un recargado de página.
  const [overrides, setOverrides] = useState(loadOverrides);
  useEffect(() => {
    const onUpdate = (e) => {
      if (e?.type === 'storage' && e.key && e.key !== OVERRIDES_KEY) return;
      setOverrides(loadOverrides());
    };
    window.addEventListener('storage', onUpdate);
    window.addEventListener('hr-overrides-updated', onUpdate);
    return () => {
      window.removeEventListener('storage', onUpdate);
      window.removeEventListener('hr-overrides-updated', onUpdate);
    };
  }, []);

  return useMemo(
    () => computeCalibratedPMC(activities, { garminData: garmin, overrides }),
    [activities, garmin, overrides],
  );
}
