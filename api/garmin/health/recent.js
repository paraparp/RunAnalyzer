import {
  createClient, toDateStr, mergeSleepData,
  fetchHrvBulk, fetchBodyBatteryBulk, fetchSleepBulk, fetchDayData,
} from '../../_lib/garmin-helpers.js';

export const config = { maxDuration: 60 };

/** Ver la nota de inyección de cliente en `health/stream.js`. */
export default async function handler(req, res, { getClient = createClient, onError } = {}) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password, days = 30 } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Credenciales requeridas' });
  }

  try {
    const client = await getClient(username, password);
    const totalDays = Math.min(days, 90);
    const today = new Date();

    const rangeStart = new Date(today);
    rangeStart.setDate(today.getDate() - totalDays + 1);
    const numWeeks = Math.ceil(totalDays / 7);

    const [hrvMap, bbMap, sleepRows] = await Promise.all([
      fetchHrvBulk(client, toDateStr(rangeStart), toDateStr(today)),
      fetchBodyBatteryBulk(client, toDateStr(rangeStart), toDateStr(today)),
      fetchSleepBulk(client, numWeeks),
    ]);

    const results = [];
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const row = await fetchDayData(client, toDateStr(d), hrvMap, bbMap);
      if (row) results.push(row);
      await new Promise(r => setTimeout(r, 120));
    }

    res.json({ data: results, sleepData: mergeSleepData([], sleepRows), total: results.length });
  } catch (e) {
    onError?.(e);
    res.status(500).json({ error: e.message });
  }
}
