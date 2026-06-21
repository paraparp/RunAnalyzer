import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'garmin-connect';
const { GarminConnect } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'garmin_data.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ---------------------------------------------------------------------------
// Local JSON database helpers
// ---------------------------------------------------------------------------
async function loadDB() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { data: [], sleepData: [], lastSync: null };
  }
}

async function saveDB(db) {
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

/** Merge newRows into existing data, dedup by date, sort asc */
function mergeData(existing, newRows) {
  const byDate = {};
  [...existing, ...newRows].forEach(r => {
    byDate[r.date] = { ...byDate[r.date], ...r };
  });
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

/** Merge sleep weekly rows, dedup by weekStart */
function mergeSleepData(existing = [], newRows = []) {
  const byWeek = {};
  [...existing, ...newRows].forEach(r => { byWeek[r.weekStart] = r; });
  return Object.values(byWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

// ---------------------------------------------------------------------------
// Garmin session
// ---------------------------------------------------------------------------
let gc = null;
let lastLogin = null;
const SESSION_TTL_MS = 55 * 60 * 1000;

async function getClient(username, password) {
  const now = Date.now();
  if (gc && lastLogin && (now - lastLogin) < SESSION_TTL_MS) return gc;
  gc = new GarminConnect({ username, password });
  await gc.login(username, password);
  lastLogin = Date.now();
  return gc;
}

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

// Split a range of N days into 3-month chunks, oldest first
function threeMonthChunks(totalDays) {
  const chunks = [];
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - totalDays + 1);

  let cursor = new Date(start);
  while (cursor <= today) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setMonth(chunkEnd.getMonth() + 3);
    if (chunkEnd > today) chunkEnd.setTime(today.getTime());

    const dates = [];
    const d = new Date(cursor);
    while (d <= chunkEnd) {
      dates.push(toDateStr(d));
      d.setDate(d.getDate() + 1);
    }
    if (dates.length) chunks.push(dates);
    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

async function fetchHrvBulk(client, startDate, endDate) {
  const map = new Map();
  const CHUNK_DAYS = 90;
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    try {
      const body = await client.client.get(
        `https://connectapi.garmin.com/hrv-service/hrv/daily/${toDateStr(cursor)}/${toDateStr(chunkEnd)}`
      );
      for (const s of body?.hrvSummaries ?? []) {
        if (s.lastNightAvg > 0) {
          map.set(s.calendarDate, {
            hrv: s.lastNightAvg,
            hrvStatus: s.status ?? null,
            baseline: s.baseline ?? null,
          });
        }
      }
    } catch (e) {
      console.warn(`HRV bulk chunk ${toDateStr(cursor)}→${toDateStr(chunkEnd)} failed:`, e.message);
    }
    
    cursor.setDate(cursor.getDate() + CHUNK_DAYS);
  }
  
  console.log(`HRV bulk: ${map.size} records (${startDate} → ${endDate})`);
  return map;
}

/** Fetch Body Battery daily range in 28-day chunks (API limit).
 *  Returns a Map<dateStr, { bbLow, bbHigh }> */
async function fetchBodyBatteryBulk(client, startDate, endDate) {
  const map = new Map();
  const CHUNK_DAYS = 28;
  const start = new Date(startDate);
  const end   = new Date(endDate);

  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    try {
      const body = await client.client.get(
        `https://connectapi.garmin.com/usersummary-service/stats/bodybattery/daily/${toDateStr(cursor)}/${toDateStr(chunkEnd)}`
      );
      for (const d of body ?? []) {
        if (d.calendarDate && d.values) {
          map.set(d.calendarDate, {
            bbLow:  d.values.lowBodyBattery  ?? null,
            bbHigh: d.values.highBodyBattery ?? null,
          });
        }
      }
    } catch (e) {
      console.warn(`Body Battery chunk ${toDateStr(cursor)}→${toDateStr(chunkEnd)} failed:`, e.message);
    }

    cursor.setDate(cursor.getDate() + CHUNK_DAYS);
  }
  console.log(`Body Battery bulk: ${map.size} records (${startDate} → ${endDate})`);
  return map;
}

async function fetchSleepBulk(client, numWeeks) {
  const allRows = [];
  const CHUNK_WEEKS = 52;
  
  // Anclar al lunes de la semana actual y retroceder N-1 semanas,
  // así el rango cubre hasta la semana en curso (incluida).
  const monday = new Date();
  const d = monday.getDay() || 7;
  monday.setDate(monday.getDate() - d + 1);
  const start = new Date(monday);
  start.setDate(start.getDate() - (numWeeks - 1) * 7);

  let weeksRemaining = numWeeks;
  let currentStart = new Date(start);

  while (weeksRemaining > 0) {
    const fetchWeeks = Math.min(weeksRemaining, CHUNK_WEEKS);
    try {
      const body = await client.client.get(
        `https://connectapi.garmin.com/sleep-service/stats/sleep/weekly/${toDateStr(currentStart)}/${fetchWeeks}`
      );
      const rows = (body?.individualStats ?? []).map(s => ({
        weekStart:    s.weekStartDate,
        weekEnd:      s.weekEndDate,
        score:        s.values.averageSleepScore ?? null,
        quality:      s.values.sleepScoreQuality ?? null,
        durationMin:  s.values.averageSleepSeconds != null ? Math.round(s.values.averageSleepSeconds / 60) : null,
        remMin:       s.values.remTime   != null ? Math.round(s.values.remTime   / 60) : null,
        deepMin:      s.values.deepTime  != null ? Math.round(s.values.deepTime  / 60) : null,
        lightMin:     s.values.lightTime != null ? Math.round(s.values.lightTime / 60) : null,
        awakeMin:     s.values.awakeTime != null ? Math.round(s.values.awakeTime / 60) : null,
        needMin:      s.values.averageSleepNeed ?? null,
        daysCount:    s.values.sleepDataDaysCount ?? null,
      }));
      allRows.push(...rows);
    } catch (e) {
      console.warn(`Sleep bulk fetch failed for ${toDateStr(currentStart)} (${fetchWeeks} weeks):`, e.message);
    }
    
    // Advance currentStart by fetchWeeks
    currentStart.setDate(currentStart.getDate() + fetchWeeks * 7);
    weeksRemaining -= fetchWeeks;
  }
  
  console.log(`Sleep bulk: ${allRows.length} weeks total`);
  return allRows;
}

async function fetchDayData(client, dateStr, hrvMap = null, bbMap = null) {
  const row = { date: dateStr };
  const date = new Date(dateStr);

  // ── FC reposo: getHeartRate() → restingHeartRate ──────────────────────────
  try {
    const hr = await client.getHeartRate(date);
    if (hr?.restingHeartRate && hr.restingHeartRate > 20) {
      row.restingHR = hr.restingHeartRate;
    }
  } catch { /* day unavailable */ }

  // ── VFC nocturna: bulk map first (fast), then per-day fallbacks ───────────
  const bulkHrv = hrvMap?.get(dateStr);
  if (bulkHrv) {
    row.hrv = bulkHrv.hrv;
    if (bulkHrv.hrvStatus) row.hrvStatus = bulkHrv.hrvStatus;
    if (bulkHrv.baseline)  row.baseline  = bulkHrv.baseline;
  }

  // Estrategia 1: getSleepData() — also grabs restingHR if missing
  if (!row.hrv) {
    try {
      const sleep = await client.getSleepData(date);
      if (sleep?.avgOvernightHrv > 0) {
        row.hrv = sleep.avgOvernightHrv;
        if (sleep.hrvStatus) row.hrvStatus = sleep.hrvStatus;
      }
      if (!row.restingHR && sleep?.restingHeartRate > 20) {
        row.restingHR = sleep.restingHeartRate;
      }
    } catch { /* no sleep data this day */ }
  }

  // Estrategia 2: /hrv-service/hrv/{date} directo (último recurso)
  if (!row.hrv) {
    try {
      const body = await client.client.get(
        `https://connectapi.garmin.com/hrv-service/hrv/${dateStr}`
      );
      const lastNight = body?.hrvSummary?.lastNight ?? body?.lastNight ?? null;
      if (lastNight > 0) {
        row.hrv = lastNight;
        const status = body?.hrvSummary?.status ?? body?.status ?? null;
        if (status) row.hrvStatus = status;
      }
    } catch { /* hrv-service unavailable */ }
  }

  // ── Body Battery ──────────────────────────────────────────────────────────
  const bb = bbMap?.get(dateStr);
  if (bb) {
    if (bb.bbLow  != null) row.bbLow  = bb.bbLow;
    if (bb.bbHigh != null) row.bbHigh = bb.bbHigh;
  }

  return (row.restingHR || row.hrv || row.bbHigh) ? row : null;
}

// ---------------------------------------------------------------------------
// GET /api/garmin/data  — load stored data from JSON file
// ---------------------------------------------------------------------------
app.get('/api/garmin/data', async (_req, res) => {
  const db = await loadDB();
  res.json(db);
});

// ---------------------------------------------------------------------------
// POST /api/garmin/data  — merge + persist data sent from client
// ---------------------------------------------------------------------------
app.post('/api/garmin/data', async (req, res) => {
  const { data, lastSync } = req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: 'data must be an array' });

  const db = await loadDB();
  db.data = mergeData(db.data, data);
  db.lastSync = lastSync ?? new Date().toISOString();
  await saveDB(db);
  res.json({ ok: true, total: db.data.length });
});

// ---------------------------------------------------------------------------
// DELETE /api/garmin/data  — wipe the JSON file
// ---------------------------------------------------------------------------
app.delete('/api/garmin/data', async (_req, res) => {
  await saveDB({ data: [], lastSync: null });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/garmin/debug  — inspect raw Garmin response for one date
// ---------------------------------------------------------------------------
app.post('/api/garmin/debug', async (req, res) => {
  const { username, password, date } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credenciales requeridas' });
  const dateStr = date ?? toDateStr(new Date());
  try {
    const client = await getClient(username, password);
    const out = { dateStr, hr: null, hrv_service: null, sleep: null };

    try { out.hr = await client.getHeartRate(new Date(dateStr)); } catch (e) { out.hr = { error: e.message }; }
    try {
      const r = await client.client.get(`https://connectapi.garmin.com/hrv-service/hrv/${dateStr}`);
      out.hrv_service = r?.data ?? r;
    } catch (e) { out.hrv_service = { error: e.message }; }
    try { out.sleep = await client.getSleepData(new Date(dateStr)); } catch (e) { out.sleep = { error: e.message }; }

    res.json(out);
  } catch (e) {
    gc = null;
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/garmin/login
// ---------------------------------------------------------------------------
app.post('/api/garmin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credenciales requeridas' });
  try {
    await getClient(username, password);
    res.json({ ok: true });
  } catch (e) {
    gc = null;
    res.status(401).json({ error: 'Login fallido: ' + e.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/garmin/health/stream  — streaming NDJSON for long periods
// ---------------------------------------------------------------------------
app.post('/api/garmin/health/stream', async (req, res) => {
  const { username, password, days = 365 } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credenciales requeridas' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const fmt = (d) => { const dt = new Date(d); return `${MONTHS_ES[dt.getMonth()]} ${dt.getFullYear()}`; };

  try {
    const client = await getClient(username, password);
    const cappedDays = Math.min(days, 1825);
    const chunks = threeMonthChunks(cappedDays);
    const totalChunks = chunks.length;
    let accumulated = [];

    // Bulk calls before the day-by-day loop
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

    // Persist to JSON file
    const db = await loadDB();
    db.data = mergeData(db.data, accumulated);
    db.sleepData = mergeSleepData(db.sleepData, sleepRows);
    db.lastSync = new Date().toISOString();
    await saveDB(db);

    send({ type: 'done', total: db.data.length, sleepData: db.sleepData });
    res.end();
  } catch (e) {
    gc = null;
    send({ type: 'error', error: e.message });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// POST /api/garmin/health/recent  — últimos N días sin streaming (máx 90)
// ---------------------------------------------------------------------------
app.post('/api/garmin/health/recent', async (req, res) => {
  const { username, password, days = 30 } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Credenciales requeridas' });

  try {
    const client = await getClient(username, password);
    const totalDays = Math.min(days, 90);
    const today = new Date();

    // Bulk calls before the day-by-day loop
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

    // Merge + persist to JSON file
    const db = await loadDB();
    db.data = mergeData(db.data, results);
    db.sleepData = mergeSleepData(db.sleepData, sleepRows);
    db.lastSync = new Date().toISOString();
    await saveDB(db);

    res.json({ data: results, sleepData: db.sleepData, total: db.data.length });
  } catch (e) {
    gc = null;
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Garmin proxy running on http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
