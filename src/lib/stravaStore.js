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
const ENRICHED_FIELDS = ['splits_metric', 'laps', 'best_efforts', 'flat_efforts', 'stream_gap'];

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
