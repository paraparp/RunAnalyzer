import cloudStorage from './cloudStorage';

// ============================================================================
// Sync de `garmin_activities` (las que llevan running dynamics y alimentan el MCP).
//
// Dos reglas que antes se incumplían y costaban datos:
//   1) NUNCA se sobrescribe con menos de lo que ya había. Un fallo de Garmin
//      devolvía [] y el `Array.isArray(...)` de turno lo guardaba tal cual,
//      dejando `list_running_dynamics` a cero aunque el histórico fuera bueno.
//   2) El resultado se MEZCLA con lo guardado. Cada respuesta trae solo las
//      últimas N actividades y solo enriquece unas pocas (hr_source, laps,
//      WBGT); reemplazar perdía el enriquecido acumulado de las anteriores.
// ============================================================================
const KEY = 'garmin_activities';

/** Actividades ya guardadas (array; [] si no hay o está corrupto). */
export function readStoredGarminActivities() {
  try {
    const parsed = JSON.parse(cloudStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** garmin_id de las que ya tienen detalle, para no volver a pedirlo. */
export function enrichedGarminIds(stored) {
  return stored.filter((a) => a?.hr_source != null).map((a) => String(a.garmin_id));
}

// Une la actividad guardada con la recién bajada. La nueva manda en los campos
// base, pero el enriquecido previo (hr_source, laps, weather, data_quality) se
// conserva si esta pasada no lo traía: solo se enriquecen unas pocas por sync.
function mergeActivity(prev, next) {
  if (!prev) return next;
  const merged = { ...prev, ...next };
  for (const k of ['hr_source', 'data_quality', 'laps', 'weather', 'gap_speed_ms']) {
    if (next[k] == null && prev[k] != null) merged[k] = prev[k];
  }
  merged.dynamics = { ...(prev.dynamics || {}), ...(next.dynamics || {}) };
  for (const [k, v] of Object.entries(prev.dynamics || {})) {
    if (merged.dynamics[k] == null && v != null) merged.dynamics[k] = v;
  }
  return merged;
}

/**
 * Baja las actividades de Garmin y las persiste mezcladas con las guardadas.
 * Devuelve el array resultante, o null si no se pudo sincronizar (en cuyo caso
 * lo almacenado queda intacto).
 */
export async function syncGarminActivities(username, password, { limit = 200 } = {}) {
  const stored = readStoredGarminActivities();
  try {
    const res = await fetch('/api/garmin/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username, password, limit,
        enrichedIds: enrichedGarminIds(stored),
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error del servidor');
    const incoming = Array.isArray(json.activities) ? json.activities : null;
    if (!incoming) throw new Error('Respuesta sin actividades');
    // Lista vacía con histórico guardado = respuesta sospechosa: no se toca nada.
    if (!incoming.length && stored.length) {
      console.warn('garmin_activities: Garmin devolvió 0 actividades; se conserva el histórico');
      return stored;
    }

    const byId = new Map(stored.map((a) => [String(a.garmin_id), a]));
    for (const a of incoming) {
      const id = String(a.garmin_id);
      byId.set(id, mergeActivity(byId.get(id), a));
    }
    const merged = [...byId.values()].sort(
      (a, b) => new Date(b.start_time) - new Date(a.start_time)
    );
    cloudStorage.setItem(KEY, JSON.stringify(merged));
    return merged;
  } catch (e) {
    console.warn('No se pudieron sincronizar las actividades de Garmin:', e.message);
    return null;
  }
}
