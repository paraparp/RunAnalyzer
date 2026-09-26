// Origen de la FC (banda vs muñeca) y la política declarada por el atleta.
//
// `hr_source` solo existe en las actividades enriquecidas con el detalle de Garmin,
// así que el histórico venía `null` y era imposible distinguir "sin banda" de "no lo
// sé" — justo la diferencia que hace útil el filtro. Las reglas son:
//   · nunca se devuelve null: si no hay dato, es 'unknown';
//   · el atleta puede declarar desde cuándo lleva banda con la clave `hr_strap_since`
//     ("YYYY-MM-DD", o { since, before }), y las actividades sin dato a partir de esa
//     fecha se resuelven como 'strap';
//   · `hr_source_origin` dice siempre de dónde sale el valor: 'sensors' (leído de los
//     sensores de Garmin), 'cutoff' (inferido de la fecha declarada) o 'missing'.
//
// Vive en `src/lib` porque lo aplican los DOS lados: el servidor MCP sobre el cache de
// Supabase y la vista de forma aeróbica sobre el almacén del navegador. Es la misma
// pregunta — "¿qué sensor midió este pulso?" — y una segunda implementación acabaría
// respondiéndola distinto: la comparación entre periodos se sostiene justo sobre eso.
// No lee de ningún almacén: la política entra ya leída, que es lo que cambia de lado.

export const HR_SOURCES = new Set(['strap', 'wrist', 'unknown']);

/**
 * Normaliza lo que haya guardado en `hr_strap_since` a `{ since, before }`.
 * Admite la forma corta (la fecha suelta) y la larga con `before`, que es qué
 * asumir ANTES del corte (por defecto 'unknown': no lo sabemos).
 */
export const parseHrSourcePolicy = (raw) => {
  // El servidor la recibe ya deserializada de Supabase; el navegador la saca de
  // `cloudStorage`, que devuelve SIEMPRE strings (la forma larga viaja como JSON).
  let v = raw;
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try { v = JSON.parse(v); } catch { /* se queda como string y manda la fecha */ }
  }
  const cfg = typeof v === 'string' ? { since: v } : (v && typeof v === 'object' ? v : {});
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(cfg.since || '')) ? String(cfg.since) : null;
  return { since, before: HR_SOURCES.has(cfg.before) ? cfg.before : 'unknown' };
};

/** Resuelve hr_source/hr_source_origin de una actividad de GARMIN según la política. */
export const resolveHrSource = (g, policy) => {
  if (HR_SOURCES.has(g?.hr_source)) return { hr_source: g.hr_source, hr_source_origin: 'sensors' };
  const day = String(g?.start_time || '').slice(0, 10);
  if (policy?.since && day) {
    return { hr_source: day >= policy.since ? 'strap' : policy.before, hr_source_origin: 'cutoff' };
  }
  return { hr_source: 'unknown', hr_source_origin: 'missing' };
};

/**
 * Resuelve el origen de FC de una actividad de STRAVA, con su pareja de Garmin (si
 * la hay) en `garmin`.
 *
 * El agujero que cierra: la fecha de corte declarada solo se aplicaba a las
 * actividades correlacionadas con un registro de Garmin, así que una salida sin
 * pareja caía a 'unknown' aunque el atleta llevara banda ese día. La política no
 * depende del deporte ni de la correlación: es una propiedad del ATLETA en una fecha.
 *
 * Nada que reprocesar en el histórico: `hr_source` no se almacena, se deriva en cada
 * lectura del cache más la política, así que corregir aquí corrige el pasado.
 */
export const resolveActivityHrSource = (activity, garmin, policy) => {
  if (HR_SOURCES.has(garmin?.hr_source) && garmin.hr_source !== 'unknown') {
    return { hr_source: garmin.hr_source, hr_source_origin: 'sensors' };
  }
  // Sin FC no hay origen que atribuir: decir 'strap' de una actividad sin pulso sería
  // inventarse un sensor que no llegó a registrar nada.
  if (activity?.average_heartrate == null) return { hr_source: 'unknown', hr_source_origin: 'missing' };
  const day = String(activity.start_date_local || activity.start_date || '').slice(0, 10);
  if (policy?.since && day) {
    return { hr_source: day >= policy.since ? 'strap' : policy.before, hr_source_origin: 'cutoff' };
  }
  return { hr_source: 'unknown', hr_source_origin: 'missing' };
};

/**
 * Correlaciona actividades de Strava con registros de Garmin por hora de inicio
 * (tolerancia de ±3 min, que es lo que llegan a separarse el arranque del reloj y el
 * de la subida). Devuelve un Map por id de Strava.
 */
export const matchGarminByStart = (stravaList = [], garminList = []) => {
  const byMinute = new Map();
  for (const g of garminList) {
    const t = Date.parse(g?.start_time);
    if (!Number.isNaN(t)) byMinute.set(Math.round(t / 60000), g);
  }
  const out = new Map();
  for (const a of stravaList) {
    const t = Date.parse(a?.start_date);
    if (Number.isNaN(t)) continue;
    const base = Math.round(t / 60000);
    for (let d = 0; d <= 3; d++) {
      const g = byMinute.get(base + d) || byMinute.get(base - d);
      if (g) { out.set(a.id, g); break; }
    }
  }
  return out;
};
