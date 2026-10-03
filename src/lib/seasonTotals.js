// ─────────────────────────────────────────────────────────────────────────────
// Totales de la temporada: del 1 de enero a hoy, frente al MISMO tramo del año
// anterior (1 de enero → misma fecha). Comparar contra el año anterior entero
// haría que cualquier temporada en curso pareciera un desplome.
// ─────────────────────────────────────────────────────────────────────────────

const WEEK_MS = 7 * 86400000;

function sumWindow(runs, from, to) {
  let count = 0, distM = 0, timeS = 0, elevM = 0;
  for (const a of runs) {
    const t = new Date(a.start_date);
    if (!(t >= from && t <= to)) continue;
    count += 1;
    distM += a.distance ?? 0;
    timeS += a.moving_time ?? 0;
    elevM += a.total_elevation_gain ?? 0;
  }
  const distKm = distM / 1000;
  return {
    count,
    distKm,
    timeH: timeS / 3600,
    elevM,
    paceSecKm: distKm > 0 ? timeS / distKm : null,
  };
}

export function seasonTotals(runs, now = new Date()) {
  const year = now.getFullYear();
  const from = new Date(year, 0, 1);
  const prevFrom = new Date(year - 1, 0, 1);
  const prevTo = new Date(year - 1, now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
  // Semanas transcurridas: las mismas para los dos tramos, así la media semanal
  // de uno y otro se puede comparar sin más.
  const weeks = Math.max(1, (now - from) / WEEK_MS);

  const cur = sumWindow(runs ?? [], from, now);
  const prev = sumWindow(runs ?? [], prevFrom, prevTo);
  return {
    year,
    weeks,
    cur: { ...cur, kmPerWeek: cur.distKm / weeks },
    prev: { ...prev, kmPerWeek: prev.distKm / weeks },
  };
}

// Variación relativa en %, redondeada; null si no hay base con la que comparar.
export function pctChange(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return Math.round((cur / prev - 1) * 100);
}
