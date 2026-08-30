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
import {
  detectMaxHR, detectRestHR, detectLTHR, estimateLTHR, HR_LIMITS,
} from '../lib/hrZones';

export const OVERRIDES_KEY = 'hr_zone_overrides';

export const loadOverrides = () => {
  try { return JSON.parse(cloudStorage.getItem(OVERRIDES_KEY)) ?? {}; } catch { return {}; }
};

// Parse a manual override. Returns the integer if it's inside [lo, hi],
// null if empty, NaN if present but out of range (→ ignored, flagged in UI).
export const parseOverride = (raw, lo, hi) => {
  if (raw === '' || raw == null) return null;
  const v = Math.round(+raw);
  return Number.isFinite(v) && v >= lo && v <= hi ? v : NaN;
};

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
  }, [userMax, userRest, userLTHR]);

  // ── Garmin cardiac data (resting HR source) ──
  const { garmin } = useGarminWearableData();

  // ── Calibration window: LTHR drifts with fitness, so it is read from the last
  //    two months. HRmax is a stable trait → detected over the full history. ──
  const recentActivities = useMemo(() => {
    if (!activities?.length) return [];
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
    return activities.filter(a => new Date(a.start_date) >= twoMonthsAgo);
  }, [activities]);

  const autoMax    = useMemo(() => detectMaxHR(activities), [activities]);
  const autoRest   = useMemo(() => detectRestHR(garmin), [garmin]);
  const lthrResult = useMemo(() => detectLTHR(recentActivities, autoMax.value), [recentActivities, autoMax]);

  // ── Effective parameters: valid manual overrides win, out-of-range input is
  //    ignored (falls back to auto) and flagged in the UI. Ordering is enforced
  //    (hrrest < hrmax, hrrest < lthr ≤ hrmax) so no model can produce inverted zones. ──
  const maxOv  = parseOverride(userMax, HR_LIMITS.maxLo, HR_LIMITS.maxHi);
  const hrmax  = maxOv || autoMax.value;
  const restOv = parseOverride(userRest, HR_LIMITS.restLo, Math.min(HR_LIMITS.restHi, hrmax - 20));
  const hrrest = restOv || Math.min(autoRest.value, hrmax - 20);
  const lthrOv = parseOverride(userLTHR, hrrest + 10, hrmax);
  const lthr   = lthrOv || Math.min(lthrResult.lthr ?? estimateLTHR(hrmax), hrmax);

  return {
    hrmax, hrrest, lthr, hrr: hrmax - hrrest,
    maxOv, restOv, lthrOv,
    autoMax, autoRest, lthrResult,
    recentActivities,
    userMax, setUserMax, userRest, setUserRest, userLTHR, setUserLTHR,
    invalidMax:  userMax  !== '' && !maxOv,
    invalidRest: userRest !== '' && !restOv,
    invalidLTHR: userLTHR !== '' && !lthrOv,
  };
}
