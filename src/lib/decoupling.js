// ============================================================================
// decoupling — deriva cardíaca (Pa:HR) a partir de los parciales de una sesión.
//
// Definición ÚNICA, compartida por la pestaña Deriva Cardíaca, el panel de
// Constantes y la tool MCP. Antes había tres: dos copias en el front y otra en
// `mcp-store.js` con distinto criterio, así que la misma sesión daba cifras
// distintas —y de signo distinto— según dónde se mirara.
//
// El ratio es FC / VELOCIDAD (no FC / ritmo). Es el detalle que estaba mal en el
// front: FC/ritmo es proporcional a FC·velocidad, así que al aflojar el ritmo
// BAJA, y una sesión que se desmorona salía con deriva NEGATIVA —clasificada
// como "excelente"—. Con FC/velocidad, aflojar sube el ratio y la deriva sale
// positiva, que es lo que esperan los umbrales (<5% = buena durabilidad).
//   Refs: Coggan (Pw:HR / aerobic decoupling); Friel, The Triathlete's Bible.
//
// El ratio de cada ventana se pondera por TIEMPO, no por número de parciales:
// promediar un km a 4:00 y otro a 6:00 como si pesaran igual falsea la media.
// ============================================================================

/** Un parcial sirve si tiene FC, velocidad y longitud suficiente para no ser ruido. */
const MIN_SPLIT_DIST_M = 500;
const isUsable = (s) =>
  s && s.average_speed > 0 && s.average_heartrate > 0 && (s.distance || 0) > MIN_SPLIT_DIST_M;

/** FC y velocidad medias de un tramo, ponderadas por tiempo. null si no hay datos. */
function segmentRatio(splits) {
  let hrTime = 0, hrSum = 0, dist = 0, time = 0;
  for (const s of splits) {
    const t = s.moving_time || s.elapsed_time || 0;
    if (!t) continue;
    hrSum += s.average_heartrate * t;
    hrTime += t;
    dist += s.distance || 0;
    time += t;
  }
  if (!hrTime || !time || !dist) return null;
  const hr = hrSum / hrTime;
  const speed = dist / time;              // m/s
  if (!(speed > 0)) return null;
  return { hr, speed, ratio: hr / speed };
}

/**
 * Ventanas comparadas. Miden cosas distintas y por eso se eligen a mano:
 *   halves     — primera mitad vs segunda mitad. Sirve para cualquier sesión con
 *                parciales; es la lectura general de "¿se me fue la FC?".
 *   durability — km 5–10 vs último 25%. Descarta el calentamiento, que infla la
 *                deriva de forma artificial, así que solo vale en tiradas largas.
 *                Es el corte que mejor predice el maratón.
 */
export const DECOUPLING_WINDOWS = {
  halves: {
    minSplits: 4,
    split(valid) {
      const mid = Math.floor(valid.length / 2);
      return {
        initial: { label: '1ª mitad', splits: valid.slice(0, mid) },
        final: { label: '2ª mitad', splits: valid.slice(mid) },
      };
    },
  },
  durability: {
    minSplits: 10,
    split(valid) {
      const finalCount = Math.max(1, Math.ceil(valid.length * 0.25));
      return {
        initial: { label: 'km 5–10', splits: valid.filter((s) => s.split >= 5 && s.split <= 10) },
        final: { label: `último 25% (${finalCount} km)`, splits: valid.slice(valid.length - finalCount) },
      };
    },
  },
};

/**
 * Deriva cardíaca de una sesión, en %. Positivo = el ratio FC/velocidad empeora
 * a lo largo de la sesión (pierdes acoplamiento aeróbico).
 *
 * Devuelve `{ pct, initial, final, reason }`. Cuando no se puede calcular, `pct`
 * es null y `reason` dice POR QUÉ: un null mudo no distingue "roto" de "no
 * aplica", y esa diferencia importa al presentarlo.
 */
export function computeSplitDecoupling(splits, { window = 'halves' } = {}) {
  const spec = DECOUPLING_WINDOWS[window];
  if (!spec) throw new Error(`Ventana de deriva desconocida: ${window}`);
  if (!Array.isArray(splits) || !splits.length) return { pct: null, reason: 'no_splits' };

  const valid = splits.filter(isUsable);
  if (valid.length < spec.minSplits) return { pct: null, reason: 'few_splits' };

  const { initial, final } = spec.split(valid);
  const a = segmentRatio(initial.splits);
  const b = segmentRatio(final.splits);
  if (!a || !b) return { pct: null, reason: 'no_hr_in_windows' };

  return {
    pct: (b.ratio / a.ratio - 1) * 100,
    initial: { window: initial.label, avg_hr: a.hr, avg_speed_ms: a.speed },
    final: { window: final.label, avg_hr: b.hr, avg_speed_ms: b.speed },
    reason: null,
  };
}

/** Atajo para la UI, que solo quiere el número (null si no se puede calcular). */
export const decouplingPct = (splits, opts) => computeSplitDecoupling(splits, opts).pct;
