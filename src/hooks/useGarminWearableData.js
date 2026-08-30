// ── Garmin wearable context (cardiac + sleep) ────────────────────────────────
// Single loader for the two Garmin caches that five different consumers used to
// read with five near-identical copies of the same effect. Every copy also had a
// `fetch('/garmin_data.json')` fallback that could never resolve: the file lives
// in the repo root, not in `public/`, so Vite never copies it to `dist/` — the
// fallback was a guaranteed 404 (and shipping it would have published personal
// resting-HR / HRV / Body Battery data). Dropped, not relocated.
//
// State contract — `undefined` means "not read yet", `null` means "read, nothing
// there". Consumers gating work on data being loaded (see useAIInsights) rely on
// that distinction, so the initial value MUST stay `undefined`.
import { useEffect, useState } from 'react';
import cloudStorage from '../lib/cloudStorage';

const read = (key) => {
  try {
    const raw = cloudStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupt cache — treat as absent
  }
};

export function useGarminWearableData() {
  const [garmin, setGarmin] = useState(undefined);
  const [sleep, setSleep] = useState(undefined);

  useEffect(() => {
    const load = () => {
      setGarmin(read('garmin_cardiac_data'));
      setSleep(read('garmin_sleep_data'));
    };
    load();
    window.addEventListener('garmin_sync_complete', load);
    return () => window.removeEventListener('garmin_sync_complete', load);
  }, []);

  return { garmin, sleep };
}

export default useGarminWearableData;
