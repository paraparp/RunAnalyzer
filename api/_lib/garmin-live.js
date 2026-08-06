// ============================================================================
// garmin-live — lecturas EN VIVO de Garmin para el MCP (Fase 2 del roadmap).
//
// A diferencia de las tools que leen el cache de Supabase, estas consultan Garmin
// en el momento con las credenciales guardadas del usuario. Así el sueño diario,
// el peso, la readiness y el estado de forma funcionan sin re-sincronizar la app.
// ============================================================================
import { getGarminClientFor } from './garmin-session.js';

const round = (n, d = 1) => (n == null ? null : parseFloat(Number(n).toFixed(d)));
const secToMin = (s) => (s == null ? null : Math.round(s / 60));

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

/** Sueño noche a noche: fases, score, estrés nocturno, respiración, HRV. */
export async function getSleepDaily(userId, { from, to } = {}) {
  const client = await getGarminClientFor(userId);
  const dates = dateRange(from, to, from ? 31 : 14); // por defecto 14 días; rango explícito hasta 31
  const nights = [];
  for (const date of dates) {
    try {
      const s = await client.getSleepData(new Date(date + 'T12:00:00'));
      const dto = s?.dailySleepDTO;
      if (!dto || !dto.sleepTimeSeconds) continue;
      nights.push({
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
      });
    } catch { /* noche sin datos */ }
  }
  return { count: nights.length, nights };
}

/** Peso y composición corporal (báscula) en un rango. */
export async function getWeightRange(userId, { from, to } = {}) {
  const client = await getGarminClientFor(userId);
  const dates = dateRange(from, to, from ? 31 : 14); // por defecto 14 días; rango explícito hasta 31
  const rows = [];
  for (const date of dates) {
    try {
      const w = await client.getDailyWeightData(new Date(date + 'T12:00:00'));
      const d = w?.dateWeightList?.[0];
      if (!d || d.weight == null) continue;
      rows.push({
        date: d.calendarDate || date,
        weight_kg: round(d.weight / 1000, 2),   // Garmin devuelve gramos
        bmi: d.bmi ?? null,
        body_fat_pct: d.bodyFat ?? null,
        muscle_mass_kg: d.muscleMass != null ? round(d.muscleMass / 1000, 2) : null,
        body_water_pct: d.bodyWater ?? null,
        source: d.sourceType ?? null,
      });
    } catch { /* día sin pesada */ }
  }
  return { count: rows.length, weights: rows };
}
