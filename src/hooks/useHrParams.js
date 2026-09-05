// ── Effective HR calibration parameters — single source for the whole app ─────
// FCmax / FCreposo / LTHR were previously derived independently by each consumer
// (TrainingZones did it properly; the splits table used the raw all-time
// max_heartrate peak and a storage key nobody ever wrote). That let the same
// kilometre read Z2 in one view and Z3 in another. This hook owns the resolution
// order — manual override → auto-detection → formula fallback — and everything
// that needs zones consumes it.
//
// Call it ONCE near the top of the tree and pass the result down: the detectors
// scan the full activity history, so re-running them per rendered row is wasteful.
import { useMemo, useState, useEffect } from 'react';
import cloudStorage from '../lib/cloudStorage';
import useGarminWearableData from './useGarminWearableData';
import { resolveHrCalibration, parseOverride } from '../lib/loadCalibration';
import { OVERRIDES_KEY, OVERRIDES_EVENT, loadOverrides } from '../lib/hrOverrides';

// Reexportados para no romper a quien ya los importaba de aquí.
export { OVERRIDES_KEY, loadOverrides, parseOverride };

export default function useHrParams(activities) {
  const [userMax,  setUserMax]  = useState(() => loadOverrides().max  ?? '');
  const [userRest, setUserRest] = useState(() => loadOverrides().rest ?? '');
  const [userLTHR, setUserLTHR] = useState(() => loadOverrides().lthr ?? '');

  // Persist manual calibration so it survives reloads
  useEffect(() => {
    const o = {};
    if (userMax)  o.max  = userMax;
    if (userRest) o.rest = userRest;
    if (userLTHR) o.lthr = userLTHR;
    if (Object.keys(o).length) cloudStorage.setItem(OVERRIDES_KEY, JSON.stringify(o));
    else cloudStorage.removeItem(OVERRIDES_KEY);
    // El PMC de las otras vistas también depende de estos overrides (useCalibratedPMC):
    // sin el aviso, ajustar el LTHR a mano no movía el CTL hasta recargar la página.
    window.dispatchEvent(new Event(OVERRIDES_EVENT));
  }, [userMax, userRest, userLTHR]);

  // ── Garmin cardiac data (resting HR source) ──
  const { garmin } = useGarminWearableData();

  // ── La RESOLUCIÓN vive en lib/loadCalibration, no aquí: es la misma que usa el
  //    PMC de las cuatro vistas y la que el MCP reproduce en el servidor. Este
  //    hook solo aporta lo que es de la UI: el estado de los overrides y su
  //    persistencia. Antes la cascada estaba escrita aquí y la carga la ignoraba,
  //    así que el atleta podía fijar su LTHR a mano y el CTL seguía con la fórmula. ──
  const overrides = useMemo(
    () => ({ max: userMax, rest: userRest, lthr: userLTHR }),
    [userMax, userRest, userLTHR],
  );
  const cal = useMemo(
    () => resolveHrCalibration(activities, { garminData: garmin, overrides }),
    [activities, garmin, overrides],
  );
  const { hrmax, hrrest, lthr, maxOv, restOv, lthrOv, autoMax, autoRest, lthrResult, recentActivities } = cal;

  return {
    hrmax, hrrest, lthr, hrr: cal.hrr,
    calibration: cal,
    maxOv, restOv, lthrOv,
    autoMax, autoRest, lthrResult,
    recentActivities,
    userMax, setUserMax, userRest, setUserRest, userLTHR, setUserLTHR,
    invalidMax:  userMax  !== '' && !maxOv,
    invalidRest: userRest !== '' && !restOv,
    invalidLTHR: userLTHR !== '' && !lthrOv,
  };
}
