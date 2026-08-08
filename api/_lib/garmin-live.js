// ============================================================================
// garmin-live — lecturas EN VIVO de Garmin para el MCP (Fase 2 del roadmap).
//
// A diferencia de las tools que leen el cache de Supabase, estas consultan Garmin
// en el momento con las credenciales guardadas del usuario. Así el sueño diario,
// el peso, la readiness y el estado de forma funcionan sin re-sincronizar la app.
// ============================================================================
import { getGarminClientFor } from './garmin-session.js';

const API = 'https://connectapi.garmin.com';
const round = (n, d = 1) => (n == null ? null : parseFloat(Number(n).toFixed(d)));
const secToMin = (s) => (s == null ? null : Math.round(s / 60));
const todayISO = () => new Date().toISOString().slice(0, 10);
// Los DTO de Garmin vienen indexados por deviceId (clave dinámica): coge el primero.
const firstDevice = (map) => (map && typeof map === 'object' ? Object.values(map)[0] : null);
// "PRODUCTIVE_6" → "PRODUCTIVE"
const cleanPhrase = (p) => (p ? String(p).replace(/_\d+$/, '') : null);

// Genera las fechas YYYY-MM-DD del rango [from, to] (máx. `cap` días, recientes primero).
function dateRange(from, to, cap = 31) {
  const end = to ? new Date(to + 'T00:00:00') : new Date();
  const start = from ? new Date(from + 'T00:00:00') : new Date(end.getTime() - (cap - 1) * 86400000);
  const out = [];
  for (let d = new Date(end); d >= start && out.length < cap; d.setDate(d.getDate() - 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

// map con concurrencia limitada que conserva el orden de entrada. Cada día es una
// request independiente a Garmin: lanzarlas en serie encadena decenas de llamadas
// (riesgo de timeout con maxDuration=60); con concurrencia acotada van en paralelo
// sin saturar Garmin.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return results;
}

/** Sueño noche a noche: fases, score, estrés nocturno, respiración, HRV. */
export async function getSleepDaily(userId, { from, to } = {}) {
  const client = await getGarminClientFor(userId);
  const dates = dateRange(from, to, from ? 62 : 14); // por defecto 14 días; rango explícito hasta 62
  const nights = (await mapLimit(dates, 5, async (date) => {
    try {
      const s = await client.getSleepData(new Date(date + 'T12:00:00'));
      const dto = s?.dailySleepDTO;
      if (!dto || !dto.sleepTimeSeconds) return null;
      return {
        date: dto.calendarDate || date,
        score: s?.dailySleepDTO?.sleepScores?.overall?.value ?? null,
        duration_min: secToMin(dto.sleepTimeSeconds),
        deep_min: secToMin(dto.deepSleepSeconds),
        rem_min: secToMin(dto.remSleepSeconds),
        light_min: secToMin(dto.lightSleepSeconds),
        awake_min: secToMin(dto.awakeSleepSeconds),
        avg_stress: dto.avgSleepStress ?? null,
        avg_respiration: round(dto.averageRespirationValue),
        avg_overnight_hrv: round(s?.avgOvernightHrv),
        hrv_status: s?.hrvStatus ?? null,
        resting_hr: s?.restingHeartRate ?? null,
        body_battery_change: s?.bodyBatteryChange ?? null,
        feedback: dto.sleepScoreFeedback ?? null,
      };
    } catch { return null; /* noche sin datos */ }
  })).filter(Boolean);
  return { count: nights.length, nights };
}

/** Peso y composición corporal (báscula) en un rango. */
export async function getWeightRange(userId, { from, to } = {}) {
  const client = await getGarminClientFor(userId);
  const dates = dateRange(from, to, from ? 62 : 14); // por defecto 14 días; rango explícito hasta 62
  const rows = (await mapLimit(dates, 5, async (date) => {
    try {
      const w = await client.getDailyWeightData(new Date(date + 'T12:00:00'));
      const d = w?.dateWeightList?.[0];
      if (!d || d.weight == null) return null;
      return {
        date: d.calendarDate || date,
        weight_kg: round(d.weight / 1000, 2),   // Garmin devuelve gramos
        bmi: d.bmi ?? null,
        body_fat_pct: d.bodyFat ?? null,
        muscle_mass_kg: d.muscleMass != null ? round(d.muscleMass / 1000, 2) : null,
        body_water_pct: d.bodyWater ?? null,
        source: d.sourceType ?? null,
      };
    } catch { return null; /* día sin pesada */ }
  })).filter(Boolean);
  return {
    count: rows.length,
    weights: rows,
    ...(rows.length ? {} : { note: `Sin pesadas en el rango (${dates.length} días consultados). Si nunca devuelve datos, revisa que haya una báscula Garmin/compatible vinculada a la cuenta.` }),
  };
}

/** Training readiness: score, nivel y factores (sueño, recuperación, ACWR, VFC). */
export async function getTrainingReadiness(userId, { date } = {}) {
  const client = await getGarminClientFor(userId);
  const d = date || todayISO();
  const arr = await client.client.get(`${API}/metrics-service/metrics/trainingreadiness/${d}`);
  const r = Array.isArray(arr) && arr.length ? arr[0] : null; // más reciente del día
  if (!r) return { date: d, readiness: null };
  return {
    date: r.calendarDate || d,
    readiness: {
      score: r.score ?? null,
      level: r.level ?? null,                          // LOW / MODERATE / HIGH …
      feedback: r.feedbackShort ?? null,
      recovery_time_h: r.recoveryTime != null ? round(r.recoveryTime / 60, 1) : null,
      acute_load: r.acuteLoad ?? null,
      hrv_weekly_avg: r.hrvWeeklyAverage ?? null,
      sleep_score: r.sleepScore ?? null,
      factors: {
        sleep: r.sleepScoreFactorFeedback ?? null,
        recovery: r.recoveryTimeFactorFeedback ?? null,
        acwr: r.acwrFactorFeedback ?? null,
        hrv: r.hrvFactorFeedback ?? null,
        stress: r.stressHistoryFactorFeedback ?? null,
      },
    },
  };
}

/** Estado de forma: VO2max carrera/ciclismo, training status, carga aguda/crónica y ACWR. */
export async function getFitnessStatus(userId, { date } = {}) {
  const client = await getGarminClientFor(userId);
  const d = date || todayISO();
  const ts = await client.client.get(`${API}/metrics-service/metrics/trainingstatus/aggregated/${d}`);
  const status = firstDevice(ts?.mostRecentTrainingStatus?.latestTrainingStatusData);
  const acute = status?.acuteTrainingLoadDTO;
  const balance = firstDevice(ts?.mostRecentTrainingLoadBalance?.metricsTrainingLoadBalanceDTOMap);
  const vo2 = ts?.mostRecentVO2Max;
  let endurance = null, hill = null;
  try {
    const e = await client.client.get(`${API}/metrics-service/metrics/endurancescore?calendarDate=${d}`);
    if (e?.overallScore != null) endurance = { score: e.overallScore, classification: e.classification ?? null };
  } catch { /* sin endurance score */ }
  try {
    const h = await client.client.get(`${API}/metrics-service/metrics/hillscore?calendarDate=${d}`);
    if (h?.overallScore != null) hill = { score: h.overallScore, strength: h.strengthScore ?? null, endurance: h.enduranceScore ?? null };
  } catch { /* sin hill score */ }
  return {
    date: d,
    vo2max_running: vo2?.generic?.vo2MaxPreciseValue ?? null,
    vo2max_cycling: vo2?.cycling?.vo2MaxPreciseValue ?? null,
    fitness_age: vo2?.generic?.fitnessAge ?? null,
    training_status: cleanPhrase(status?.trainingStatusFeedbackPhrase),
    training_status_code: status?.trainingStatus ?? null,
    acute_load: acute?.dailyTrainingLoadAcute ?? null,
    chronic_load: acute?.dailyTrainingLoadChronic ?? null,
    acwr: acute?.dailyAcuteChronicWorkloadRatio ?? null,        // ratio agudo/crónico
    acwr_status: acute?.acwrStatus ?? null,
    load_balance: balance ? {
      aerobic_low: round(balance.monthlyLoadAerobicLow, 0),
      aerobic_high: round(balance.monthlyLoadAerobicHigh, 0),
      anaerobic: round(balance.monthlyLoadAnaerobic, 0),
      feedback: balance.trainingBalanceFeedbackPhrase ?? null,
    } : null,
    heat_acclimation_pct: vo2?.heatAltitudeAcclimation?.heatAcclimationPercentage ?? null,
    endurance_score: endurance,
    hill_score: hill,
  };
}

/** Entrenos planificados y carreras del calendario (próximos `months` meses). */
export async function getPlannedWorkouts(userId, { months = 3 } = {}) {
  const client = await getGarminClientFor(userId);
  const now = new Date();
  const items = [];
  for (let i = 0; i < Math.min(Math.max(months, 1), 6); i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() + i, 1);
    try {
      const cal = await client.client.get(`${API}/calendar-service/year/${dt.getFullYear()}/month/${dt.getMonth()}`);
      for (const it of cal?.calendarItems || []) {
        if (it.itemType === 'workout' || it.isRace) {
          items.push({
            date: it.date,
            title: it.title,
            type: it.itemType,
            sport: it.sportTypeKey ?? null,
            is_race: !!it.isRace,
            workout_id: it.workoutId ?? null,
            calendar_id: it.id ?? null,
            course: it.courseName ?? null,
          });
        }
      }
    } catch { /* mes sin calendario */ }
  }
  const today = todayISO();
  const upcoming = items.filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return { count: upcoming.length, planned: upcoming };
}
