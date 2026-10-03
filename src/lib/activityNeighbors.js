// Sesión anterior y siguiente en orden cronológico, para pasar de una a otra
// desde la ficha. Dentro de la misma familia de deporte: desde una carrera se
// salta a la carrera anterior, no al gimnasio de en medio.

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

const sportOf = (a) => a.sport_type || a.type;
const familyOf = (a) => (RUNNING_TYPES.includes(sportOf(a)) ? 'run' : sportOf(a));

export function activityNeighbors(activity, activities) {
  if (!activity || !activities?.length) return { prev: null, next: null };
  const family = familyOf(activity);
  const t0 = new Date(activity.start_date).getTime();
  let prev = null, next = null, prevT = -Infinity, nextT = Infinity;
  for (const a of activities) {
    if (a.id === activity.id || familyOf(a) !== family) continue;
    const t = new Date(a.start_date).getTime();
    // Empate de hora (dos sesiones con el mismo inicio): desempata el id, para
    // que ir y volver sea simétrico y ninguna quede inalcanzable.
    const before = t < t0 || (t === t0 && String(a.id) < String(activity.id));
    if (before && (t > prevT || (t === prevT && String(a.id) > String(prev.id)))) { prev = a; prevT = t; }
    if (!before && (t < nextT || (t === nextT && String(a.id) < String(next.id)))) { next = a; nextT = t; }
  }
  return { prev, next };
}
