// Histórico de pesadas guardado en `user_storage`. Lo escribe el servidor (sync y
// /api/garmin/metrics) y lo leen la app y el MCP, sin depender de que Garmin responda.

export const WEIGHT_KEY = 'garmin_weight_data';

/**
 * Mezcla por día y ordenada: la pesada nueva manda, campo a campo. Una respuesta
 * vacía no borra nada, porque un Garmin caído no significa que no haya pesadas.
 */
export function mergeWeights(prev, next) {
  const byDate = {};
  for (const r of [...(Array.isArray(prev) ? prev : []), ...(Array.isArray(next) ? next : [])]) {
    if (!r?.date) continue;
    byDate[r.date] = { ...byDate[r.date], ...r };
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}
