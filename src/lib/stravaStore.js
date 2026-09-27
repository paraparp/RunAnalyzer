// ============================================================================
// stravaStore — la forma con la que `stravaData` vive en cloudStorage.
//
// Estaba dentro de App.jsx, y con ella la regla que de verdad importa: el
// listado de Strava devuelve SUMMARIES, así que refrescar sin mezclar BORRA el
// detalle (splits, laps, best_efforts, tramos llanos, GAP) que costó traer
// actividad por actividad. Vive aquí porque desde que el sync está centralizado
// en `syncAll.js` hay dos módulos que escriben esta clave, y el día que la
// mezcla exista por duplicado se pierde el enriquecido en uno de los dos.
// ============================================================================
import cloudStorage from './cloudStorage';

export const STRAVA_KEY = 'stravaData';

// Campos del detalle de Strava que no consumimos y que inflan la cuota: se
// recortan al guardar y conservamos solo lo que la app pinta (laps,
// splits_metric, best_efforts y el summary_polyline del mapa).
const HEAVY_DETAIL_FIELDS = [
  'segment_efforts', 'splits_standard', 'similar_activities',
  'description', 'photos', 'stats_visibility', 'available_zones', 'laps_raw',
];

export const slimActivity = (act, fallback = {}) => {
  const slim = { ...act };
  for (const k of HEAVY_DETAIL_FIELDS) delete slim[k];
  // Conservar solo el summary_polyline (heatmap/galería), descartar la polyline completa
  const summaryPolyline = act.map?.summary_polyline || fallback.map?.summary_polyline;
  if (act.map || summaryPolyline) {
    slim.map = { id: act.map?.id ?? fallback.map?.id, summary_polyline: summaryPolyline };
  }
  return slim;
};

// Al refrescar desde el listado, Strava devuelve SUMMARIES sin detalle (sin
// splits_metric, laps ni best_efforts). Este merge conserva el detalle ya
// enriquecido y persistido de cada actividad, de modo que el sync NO borre los
// parciales que costó traer. Clave para que el dato viva de forma estable en Supabase.
// `hr_effort` faltaba: cada refresco del listado lo borraba y el enriquecido en
// segundo plano volvía a bajar los streams de hasta 30 carreras para recalcularlo.
const ENRICHED_FIELDS = ['splits_metric', 'laps', 'best_efforts', 'flat_efforts', 'stream_gap', 'hr_effort'];

export const mergeEnrichedActivities = (fresh, existing) => {
  const byId = new Map((existing || []).map(a => [a.id, a]));
  return (fresh || []).map(f => {
    const old = byId.get(f.id);
    if (!old) return f;
    const merged = { ...f };
    for (const k of ENRICHED_FIELDS) {
      if (old[k] != null && merged[k] == null) merged[k] = old[k];
    }
    if (!merged.map?.summary_polyline && old.map?.summary_polyline) {
      merged.map = { ...(merged.map || {}), summary_polyline: old.map.summary_polyline };
    }
    return merged;
  });
};

// ¿Trae el summary nuevo algún valor distinto del guardado? `resource_state` y
// `map` no cuentan: el guardado puede ser el detalle (state 3, map recortado) y
// compararlos marcaría como cambiada cada actividad enriquecida.
const summaryDiffers = (fresh, old) => Object.keys(fresh).some(
  (k) => k !== 'resource_state' && k !== 'map' && JSON.stringify(fresh[k]) !== JSON.stringify(old[k])
);

/**
 * Sync incremental: mete en lo guardado las actividades recién bajadas (nuevas o
 * editadas) SIN tocar el resto. A diferencia de `mergeEnrichedActivities`, que
 * sustituye el listado entero, aquí lo que no viene se queda como estaba.
 *
 * La guardada manda en todo lo que el summary no trae (detalle, enriquecido); el
 * summary, en lo que sí trae (nombre editado, tipo…). Devuelve `changed`, cuántas
 * entraron o cambiaron, para no reescribir en Supabase el blob entero si es 0.
 */
export const upsertActivities = (fresh, existing, { limit = Infinity } = {}) => {
  const byId = new Map((existing || []).map(a => [a.id, a]));
  let changed = 0;
  for (const f of fresh || []) {
    const old = byId.get(f.id);
    if (old && !summaryDiffers(f, old)) continue;
    byId.set(f.id, old ? { ...old, ...slimActivity(f, old) } : f);
    changed++;
  }
  if (!changed) return { activities: existing || [], changed };
  const activities = [...byId.values()]
    .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
    .slice(0, limit);
  return { activities, changed };
};

/** Epoch (s) del inicio de la actividad más reciente guardada, o null. */
export const newestStartEpoch = (activities) => {
  let max = null;
  for (const a of activities || []) {
    const t = Date.parse(a?.start_date);
    if (Number.isFinite(t) && (max == null || t > max)) max = t;
  }
  return max == null ? null : Math.floor(max / 1000);
};

/** Guardado tolerante: si se excede la cuota, la app sigue con el dato en memoria. */
export const persistStravaData = (data) => {
  try {
    cloudStorage.setItem(STRAVA_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('No se pudo guardar stravaData en localStorage (cuota excedida). Se mantiene en memoria.', e);
  }
};

/** Lo guardado, o null si no hay nada o está corrupto (nunca lanza). */
export function readStravaData() {
  try {
    const raw = cloudStorage.getItem(STRAVA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Olvida la conexión de Strava (token muerto sin refresh posible). */
export function clearStravaData() {
  cloudStorage.removeItem(STRAVA_KEY);
}

/** Marca del día en que se bajó el listado; es la que decide si toca refrescar. */
export const todayStamp = () => new Date().toDateString();
