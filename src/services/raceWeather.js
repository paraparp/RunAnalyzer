// ============================================================================
// raceWeather — temperatura y humedad esperadas el día de la carrera.
//
// Open-Meteo (sin clave, CORS abierto):
//   · ≤ 16 días vista → previsión horaria (`source: 'forecast'`).
//   · más lejos → climatología: la misma fecha (±3 días) de los 3 años
//     anteriores a la hora de salida (`source: 'climate'`). No es una previsión;
//     es lo normal ese día en ese sitio, que para planificar basta.
// Se promedian las horas que dura la carrera desde la hora de salida.
// ============================================================================

const FORECAST_DAYS = 16;
const DAY_MS = 86400000;
const HOURLY = 'temperature_2m,relative_humidity_2m';

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (isoDate, days) => iso(new Date(Date.parse(isoDate + 'T12:00:00Z') + days * DAY_MS));

/**
 * Media de temperatura y humedad de `hourly` (respuesta de Open-Meteo con
 * timezone=auto) en las horas [startHour, startHour + hours) de las fechas dadas.
 */
export function averageHours(hourly, dates, startHour, hours) {
  const want = new Set(dates);
  const t = [], h = [];
  (hourly?.time || []).forEach((ts, i) => {
    const [d, hm] = ts.split('T');
    const hour = Number(hm.slice(0, 2));
    if (!want.has(d) || hour < startHour || hour >= startHour + Math.max(1, Math.ceil(hours))) return;
    const ti = hourly.temperature_2m?.[i];
    const hi = hourly.relative_humidity_2m?.[i];
    if (ti != null) t.push(ti);
    if (hi != null) h.push(hi);
  });
  if (!t.length || !h.length) return null;
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return { temp_c: mean(t), humidity_pct: mean(h), samples: t.length };
}

/**
 * `{ temp_c, humidity_pct, source }` o null. `date` YYYY-MM-DD, `startTime`
 * "HH:MM" (09:00 si no hay), `hours` duración prevista.
 */
export async function fetchRaceWeather({ lat, lng, date, startTime, hours = 2, now = Date.now(), signal }) {
  if (lat == null || lng == null || !date) return null;
  const startHour = Number((startTime || '09:00').slice(0, 2)) || 9;
  const daysAhead = (Date.parse(date + 'T12:00:00Z') - now) / DAY_MS;

  if (daysAhead >= -1 && daysAhead <= FORECAST_DAYS) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=${HOURLY}&start_date=${date}&end_date=${date}&timezone=auto`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const avg = averageHours((await res.json()).hourly, [date], startHour, hours);
      if (avg) return { ...avg, source: 'forecast' };
    }
  }

  // Climatología: misma ventana de fechas en los 3 años anteriores.
  const year = Number(date.slice(0, 4));
  const thisYear = new Date(now).getUTCFullYear();
  const dates = [];
  const ranges = [];
  for (let y = Math.min(year, thisYear) - 1; y >= Math.min(year, thisYear) - 3; y--) {
    const center = `${y}${date.slice(4)}`;
    ranges.push([shift(center, -3), shift(center, 3)]);
    for (let k = -3; k <= 3; k++) dates.push(shift(center, k));
  }
  const parts = await Promise.all(ranges.map(async ([a, b]) => {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&hourly=${HOURLY}&start_date=${a}&end_date=${b}&timezone=auto`;
    const res = await fetch(url, { signal });
    return res.ok ? (await res.json()).hourly : null;
  }));
  const merged = { time: [], temperature_2m: [], relative_humidity_2m: [] };
  for (const p of parts.filter(Boolean)) {
    merged.time.push(...p.time);
    merged.temperature_2m.push(...p.temperature_2m);
    merged.relative_humidity_2m.push(...p.relative_humidity_2m);
  }
  const avg = averageHours(merged, dates, startHour, hours);
  return avg ? { ...avg, source: 'climate' } : null;
}
