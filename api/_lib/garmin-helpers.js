import pkg from 'garmin-connect';
const { GarminConnect } = pkg;

export function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

export function mergeData(existing, newRows) {
  const byDate = {};
  [...existing, ...newRows].forEach(r => {
    byDate[r.date] = { ...byDate[r.date], ...r };
  });
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

export function mergeSleepData(existing = [], newRows = []) {
  const byWeek = {};
  [...existing, ...newRows].forEach(r => { byWeek[r.weekStart] = r; });
  return Object.values(byWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export async function createClient(username, password) {
  const gc = new GarminConnect({ username, password });
  await gc.login(username, password);
  return gc;
}

// Split a range of N days into 3-month chunks, oldest first
export function threeMonthChunks(totalDays) {
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

export async function fetchHrvBulk(client, startDate, endDate) {
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
      console.warn(`HRV bulk chunk failed:`, e.message);
    }

    cursor.setDate(cursor.getDate() + CHUNK_DAYS);
  }
  return map;
}

export async function fetchBodyBatteryBulk(client, startDate, endDate) {
  const map = new Map();
  const CHUNK_DAYS = 28;
  const start = new Date(startDate);
  const end = new Date(endDate);

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
      console.warn(`Body Battery chunk failed:`, e.message);
    }

    cursor.setDate(cursor.getDate() + CHUNK_DAYS);
  }
  return map;
}

export async function fetchSleepBulk(client, numWeeks) {
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
        weekStart:   s.weekStartDate,
        weekEnd:     s.weekEndDate,
        score:       s.values.averageSleepScore ?? null,
        quality:     s.values.sleepScoreQuality ?? null,
        durationMin: s.values.averageSleepSeconds != null ? Math.round(s.values.averageSleepSeconds / 60) : null,
        remMin:      s.values.remTime   != null ? Math.round(s.values.remTime   / 60) : null,
        deepMin:     s.values.deepTime  != null ? Math.round(s.values.deepTime  / 60) : null,
        lightMin:    s.values.lightTime != null ? Math.round(s.values.lightTime / 60) : null,
        awakeMin:    s.values.awakeTime != null ? Math.round(s.values.awakeTime / 60) : null,
        needMin:     s.values.averageSleepNeed ?? null,
        daysCount:   s.values.sleepDataDaysCount ?? null,
      }));
      allRows.push(...rows);
    } catch (e) {
      console.warn(`Sleep bulk fetch failed:`, e.message);
    }

    currentStart.setDate(currentStart.getDate() + fetchWeeks * 7);
    weeksRemaining -= fetchWeeks;
  }
  return allRows;
}

// ── Actividades con running dynamics (todo lo que mide la banda) ─────────────
const gnum = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
const g1 = (v) => (gnum(v) == null ? null : Math.round(v * 10) / 10);

/** Normaliza un item del activitylist-service de Garmin al shape que guardamos. */
export function normalizeGarminActivity(a) {
  if (!a?.activityId) return null;
  const gmt = a.startTimeGMT || null;
  // "2026-07-15 06:00:00" (UTC, sin zona) → ISO con Z para poder correlacionar.
  const start_time = gmt ? gmt.replace(' ', 'T').replace(/\.\d+$/, '') + (gmt.endsWith('Z') ? '' : 'Z') : null;
  return {
    garmin_id: a.activityId,
    name: a.activityName ?? null,
    type: a.activityType?.typeKey ?? null,
    start_time,
    distance_m: gnum(a.distance),
    duration_s: gnum(a.duration),
    avg_hr: gnum(a.averageHR),
    max_hr: gnum(a.maxHR),
    calories: gnum(a.calories),
    steps: gnum(a.steps),
    dynamics: {
      cadence_spm: g1(a.averageRunningCadenceInStepsPerMinute),
      max_cadence_spm: g1(a.maxRunningCadenceInStepsPerMinute),
      ground_contact_ms: g1(a.avgGroundContactTime),
      gct_balance_pct: g1(a.avgGroundContactBalance),
      stride_length_cm: g1(a.avgStrideLength),
      vertical_oscillation_cm: g1(a.avgVerticalOscillation),
      vertical_ratio_pct: g1(a.avgVerticalRatio),
    },
    power: { avg_w: gnum(a.avgPower), max_w: gnum(a.maxPower), norm_w: gnum(a.normPower) },
    training: {
      aerobic_te: g1(a.aerobicTrainingEffect),
      anaerobic_te: g1(a.anaerobicTrainingEffect),
      training_load: g1(a.activityTrainingLoad),
      vo2max: g1(a.vO2MaxValue),
    },
  };
}

/** Lista las últimas `limit` actividades de Garmin con sus running dynamics. */
export async function fetchGarminActivities(client, limit = 100) {
  const cap = Math.min(Math.max(limit, 1), 300);
  let raw = [];
  try {
    raw = await client.client.get(
      `https://connectapi.garmin.com/activitylist-service/activities/search/activities?start=0&limit=${cap}`
    );
  } catch (e) {
    console.warn('garmin activities fetch failed:', e.message);
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeGarminActivity).filter((a) => a && a.start_time);
}

export async function fetchDayData(client, dateStr, hrvMap = null, bbMap = null) {
  const row = { date: dateStr };
  const date = new Date(dateStr);

  try {
    const hr = await client.getHeartRate(date);
    if (hr?.restingHeartRate && hr.restingHeartRate > 20) {
      row.restingHR = hr.restingHeartRate;
    }
  } catch { /* day unavailable */ }

  const bulkHrv = hrvMap?.get(dateStr);
  if (bulkHrv) {
    row.hrv = bulkHrv.hrv;
    if (bulkHrv.hrvStatus) row.hrvStatus = bulkHrv.hrvStatus;
    if (bulkHrv.baseline)  row.baseline  = bulkHrv.baseline;
  }

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
    } catch { /* no sleep data */ }
  }

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

  const bb = bbMap?.get(dateStr);
  if (bb) {
    if (bb.bbLow  != null) row.bbLow  = bb.bbLow;
    if (bb.bbHigh != null) row.bbHigh = bb.bbHigh;
  }

  return (row.restingHR || row.hrv || row.bbHigh) ? row : null;
}
