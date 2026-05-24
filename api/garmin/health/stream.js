import {
  createClient, toDateStr, mergeData, mergeSleepData,
  threeMonthChunks, fetchHrvBulk, fetchBodyBatteryBulk, fetchSleepBulk, fetchDayData,
} from '../../_lib/garmin-helpers.js';

export const config = { maxDuration: 300 };

const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const fmt = (d) => { const dt = new Date(d); return `${MONTHS_ES[dt.getMonth()]} ${dt.getFullYear()}`; };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password, days = 365 } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Credenciales requeridas' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');

  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  try {
    const client = await createClient(username, password);
    const cappedDays = Math.min(days, 1825);
    const chunks = threeMonthChunks(cappedDays);
    const totalChunks = chunks.length;
    let accumulated = [];

    const today = new Date();
    const rangeStart = new Date(today);
    rangeStart.setDate(today.getDate() - cappedDays + 1);
    const numWeeks = Math.ceil(cappedDays / 7);

    const [hrvMap, bbMap, sleepRows] = await Promise.all([
      fetchHrvBulk(client, toDateStr(rangeStart), toDateStr(today)),
      fetchBodyBatteryBulk(client, toDateStr(rangeStart), toDateStr(today)),
      fetchSleepBulk(client, numWeeks),
    ]);

    for (let ci = 0; ci < chunks.length; ci++) {
      const dates = chunks[ci];
      const chunkData = [];

      for (const dateStr of dates) {
        const row = await fetchDayData(client, dateStr, hrvMap, bbMap);
        if (row) chunkData.push(row);
        await new Promise(r => setTimeout(r, 120));
      }

      accumulated = mergeData(accumulated, chunkData);

      send({
        type: 'chunk',
        period: `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`,
        data: chunkData,
        progress: (ci + 1) / totalChunks,
        chunkIndex: ci,
        totalChunks,
      });
    }

    const mergedSleep = mergeSleepData([], sleepRows);
    send({ type: 'done', total: accumulated.length, sleepData: mergedSleep });
    res.end();
  } catch (e) {
    send({ type: 'error', error: e.message });
    res.end();
  }
}
