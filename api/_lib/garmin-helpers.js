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

// ── Enriquecido por actividad (detalle): origen de FC, laps reales, WBGT ──────
// El activitylist-service no trae estos campos; hay que pedir el detalle por id.

const HR_SENSOR_TYPES = new Set(['HEART_RATE', 'HEARTRATE', 'HRM']);

/** banda vs muñeca a partir de los sensores conectados (metadataDTO.sensors). */
export function deriveHrSource(metadataDTO, summaryDTO) {
  const sensors = Array.isArray(metadataDTO?.sensors) ? metadataDTO.sensors : [];
  const hasStrap = sensors.some((s) =>
    HR_SENSOR_TYPES.has(String(s.bleDeviceType || '').toUpperCase()) ||
    HR_SENSOR_TYPES.has(String(s.antDeviceType || '').toUpperCase()));
  if (hasStrap) return 'strap';
  if (summaryDTO?.averageHR != null) return 'wrist';
  return 'unknown';
}

/** Calidad de datos: origen de FC + si había medidor de potencia externo. */
export function deriveDataQuality(metadataDTO, summaryDTO) {
  const sensors = Array.isArray(metadataDTO?.sensors) ? metadataDTO.sensors : [];
  const asStr = (s) => `${s.bleDeviceType || ''} ${s.antDeviceType || ''} ${s.sku || ''}`.toUpperCase();
  return {
    hr_source: deriveHrSource(metadataDTO, summaryDTO),
    external_power_meter: sensors.some((s) => /POWER|STRYD/.test(asStr(s))),
    sensor_count: sensors.length,
  };
}

// Temperatura de Garmin: puede venir en °F (según ajustes de la cuenta). Heurística:
// por encima de 45 la tratamos como Fahrenheit (poco realista en °C para correr).
const toCelsius = (t) => (t == null ? null : t > 45 ? (t - 32) * 5 / 9 : t);

/** WBGT (aprox. sombra, fórmula BoM) y penalización de ritmo estimada por calor. */
export function computeWbgt(weather) {
  if (!weather || weather.temp == null || weather.relativeHumidity == null) return null;
  const ta = toCelsius(weather.temp);
  const rh = weather.relativeHumidity;
  if (ta == null) return null;
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * ta) / (237.7 + ta)); // presión de vapor (hPa)
  const wbgt = 0.567 * ta + 0.393 * e + 3.94;
  // Modelo lineal simple (estimación): sin coste por debajo de ~12 °C WBGT.
  const penalty = wbgt <= 12 ? 0 : Math.min(12, (wbgt - 12) * 0.65);
  return {
    temp_c: g1(ta),
    dew_point_c: g1(toCelsius(weather.dewPoint)),
    humidity_pct: rh,
    wbgt_c: g1(wbgt),
    heat_penalty_pct: g1(penalty),
    condition: weather.weatherTypeDTO?.desc ?? null,
  };
}

/** Lap real del reloj (splits.lapDTOs) → shape compacto con tipo e intensidad. */
export function normalizeGarminLap(l) {
  return {
    lap_index: l.lapIndex ?? null,
    intensity_type: l.intensityType ?? null, // INTERVAL / REST / RECOVERY / ACTIVE / WARMUP …
    distance_m: gnum(l.distance),
    duration_s: g1(l.duration),
    avg_speed_ms: gnum(l.averageSpeed),
    gap_speed_ms: gnum(l.avgGradeAdjustedSpeed),
    avg_hr: gnum(l.averageHR),
    max_hr: gnum(l.maxHR),
    cadence_spm: g1(l.averageRunCadence),
    avg_power_w: gnum(l.averagePower),
    norm_power_w: gnum(l.normalizedPower),
    gct_balance_pct: g1(l.groundContactBalanceLeft),
    elevation_gain_m: g1(l.elevationGain),
  };
}

// El activitylist-service omite parte de la dinámica en actividades antiguas (p.ej.
// `avgGroundContactBalance` llega null aunque la banda sí lo grabó). El detalle
// (summaryDTO) sí la trae, así que al enriquecer rellenamos los huecos. Mapea
// nuestro campo → claves candidatas en summaryDTO (Garmin ha usado varias).
const DYNAMICS_FROM_SUMMARY = {
  cadence_spm: ['averageRunningCadenceInStepsPerMinute', 'averageRunCadence'],
  max_cadence_spm: ['maxRunningCadenceInStepsPerMinute', 'maxRunCadence'],
  ground_contact_ms: ['avgGroundContactTime', 'groundContactTime'],
  gct_balance_pct: ['avgGroundContactBalance', 'groundContactBalanceLeft'],
  stride_length_cm: ['avgStrideLength', 'strideLength'],
  vertical_oscillation_cm: ['avgVerticalOscillation', 'verticalOscillation'],
  vertical_ratio_pct: ['avgVerticalRatio', 'verticalRatio'],
};

/** Rellena los huecos de `dynamics` desde summaryDTO (no pisa lo que ya hay). */
function backfillDynamicsFromSummary(base, summaryDTO) {
  if (!summaryDTO || !base.dynamics) return;
  for (const [field, keys] of Object.entries(DYNAMICS_FROM_SUMMARY)) {
    if (base.dynamics[field] != null) continue;
    for (const k of keys) {
      const v = g1(summaryDTO[k]);
      if (v != null) { base.dynamics[field] = v; break; }
    }
  }
}

// Último recurso para el equilibrio GCT: media de los laps ponderada por duración.
// Garmin lo publica por lap (`groundContactBalanceLeft`) incluso en actividades cuyo
// agregado viene vacío, así que reconstruirlo aquí recupera sesiones antiguas.
function backfillGctBalanceFromLaps(base, laps) {
  if (base.dynamics?.gct_balance_pct != null) return;
  let num = 0, den = 0;
  for (const l of laps) {
    if (l.gct_balance_pct == null) continue;
    const w = l.duration_s || 1;
    num += l.gct_balance_pct * w; den += w;
  }
  if (den > 0) {
    base.dynamics.gct_balance_pct = g1(num / den);
    base.dynamics.gct_balance_source = 'laps'; // reconstruido, no agregado de Garmin
  }
}

/** Pide el detalle de una actividad y le añade hr_source, data_quality, laps y weather. */
export async function enrichGarminActivity(client, base) {
  const id = base.garmin_id;
  try {
    const summary = await client.client.get(
      `https://connectapi.garmin.com/activity-service/activity/${id}`
    );
    base.hr_source = deriveHrSource(summary?.metadataDTO, summary?.summaryDTO);
    base.data_quality = deriveDataQuality(summary?.metadataDTO, summary?.summaryDTO);
    backfillDynamicsFromSummary(base, summary?.summaryDTO);
    if (summary?.summaryDTO?.avgGradeAdjustedSpeed != null) {
      base.gap_speed_ms = gnum(summary.summaryDTO.avgGradeAdjustedSpeed);
    }
  } catch (e) { console.warn(`enrich summary ${id}:`, e.message); }
  try {
    const splits = await client.client.get(
      `https://connectapi.garmin.com/activity-service/activity/${id}/splits`
    );
    const laps = Array.isArray(splits?.lapDTOs) ? splits.lapDTOs.map(normalizeGarminLap) : [];
    if (laps.length) { base.laps = laps; backfillGctBalanceFromLaps(base, laps); }
  } catch (e) { console.warn(`enrich splits ${id}:`, e.message); }
  try {
    const weather = await client.client.get(
      `https://connectapi.garmin.com/activity-service/activity/${id}/weather`
    );
    const w = computeWbgt(weather);
    if (w) base.weather = w;
  } catch (e) { console.warn(`enrich weather ${id}:`, e.message); }
  return base;
}

/** map con concurrencia limitada (para no saturar Garmin al enriquecer). */
async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  });
  await Promise.all(workers);
}

// Plazas del presupuesto de enriquecido reservadas a las carreras más recientes.
const RECENT_ENRICH_SLOTS = 10;

/**
 * Lista las últimas `limit` actividades de Garmin con running dynamics y enriquece
 * carreras con el detalle (origen FC, laps reales, WBGT, dinámica que falte).
 *
 * El enriquecido es INCREMENTAL: `alreadyEnriched` trae los garmin_id que ya tienen
 * detalle guardado y se saltan, de modo que cada sync gasta su presupuesto en las
 * carreras que aún no lo tienen. Antes se enriquecían siempre las 20 más recientes,
 * así que `hr_source` solo existía en una ventana móvil y el histórico nunca se
 * completaba por mucho que se sincronizara.
 *
 * Un fallo al listar LANZA en vez de devolver []: quien llama no puede distinguir
 * "Garmin caído" de "no hay actividades", y guardar ese [] borraba el histórico.
 */
export async function fetchGarminActivities(
  client, limit = 100, { enrichRuns = 40, alreadyEnriched = null } = {}
) {
  const cap = Math.min(Math.max(limit, 1), 300);
  let raw;
  try {
    raw = await client.client.get(
      `https://connectapi.garmin.com/activitylist-service/activities/search/activities?start=0&limit=${cap}`
    );
  } catch (e) {
    throw new Error(`No se pudo listar actividades de Garmin: ${e.message}`);
  }
  if (!Array.isArray(raw)) throw new Error('Respuesta inesperada del activitylist-service de Garmin');
  const normalized = raw.map(normalizeGarminActivity).filter((a) => a && a.start_time);
  if (enrichRuns > 0) {
    const done = alreadyEnriched instanceof Set ? alreadyEnriched
      : new Set(Array.isArray(alreadyEnriched) ? alreadyEnriched.map(String) : []);
    // Presupuesto repartido: primero las carreras recientes pendientes (para que un
    // entreno de hoy tenga hr_source ya en este sync) y el resto hacia atrás en el
    // tiempo, de modo que los syncs sucesivos completen el histórico. Solo hacia
    // atrás dejaría lo nuevo sin enriquecer hasta vaciar el backlog.
    const pending = normalized
      .filter((a) => (a.type || '').includes('run') && !done.has(String(a.garmin_id)))
      .sort((x, y) => new Date(y.start_time) - new Date(x.start_time)); // reciente primero
    const recent = pending.slice(0, Math.min(RECENT_ENRICH_SLOTS, enrichRuns));
    const backfill = pending.slice(recent.length).reverse()             // antigua primero
      .slice(0, enrichRuns - recent.length);
    const runs = [...recent, ...backfill];
    try {
      await mapLimit(runs, 4, (a) => enrichGarminActivity(client, a));
    } catch (e) {
      console.warn('garmin enrich phase failed:', e.message);
    }
  }
  return normalized;
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
