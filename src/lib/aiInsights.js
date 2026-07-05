// Lógica pura de AI Insights: parsing/validación de la respuesta del modelo,
// formateadores y derivación de badges. Sin React ni side-effects → testeable.

// ── Tipos de actividad ───────────────────────────────────────────────────────
export const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'];
export const RIDE_TYPES = ['Ride', 'VirtualRide'];

export const activityEmoji = (type) => {
  if (type === 'Ride' || type === 'VirtualRide') return '🚴';
  if (type === 'Run' || type === 'TrailRun' || type === 'VirtualRun') return '🏃';
  if (type === 'Swim') return '🏊';
  if (type === 'Walk' || type === 'Hike') return '🚶';
  if (type === 'WeightTraining') return '🏋️';
  if (type === 'Yoga') return '🧘';
  return '👟';
};

// ── Formateadores ────────────────────────────────────────────────────────────
// min/km → "M:SS" (redondeo por segundos totales: evita resultados tipo "5:60")
export const paceStr = (minPerKm) => {
  const total = Math.round(minPerKm * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const formatTs = (ts) => {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.round((now - d) / 60000);
  if (diffMin < 2) return 'ahora mismo';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

// Frescura de datos con granularidad de día completo
export const formatDataDate = (input) => {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d)) return null;
  const day0 = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const days = Math.round((day0(new Date()) - day0(d)) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days}d`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

// ── Protocolo de bloques "|||" ───────────────────────────────────────────────
// Durante el streaming un chunk puede cortar el delimitador por la mitad y el
// acumulado terminar en "|" o "||": se recorta antes de partir para que esos
// pipes no se pinten como texto del bloque.
export const stripPartialDelimiter = (acc) => acc.replace(/\|{1,2}$/, '');

export const splitBlocks = (text) => (text ?? '').split('|||').map(p => p.trim());

// Respuesta aceptable: al menos diagnóstico + tendencia con contenido real.
// Si el modelo (típicamente el fallback) no respeta el formato, se descarta
// y se prueba el siguiente proveedor en vez de cachear basura.
export const validateBlocks = (parts) =>
  Array.isArray(parts) && parts.length >= 3 && parts[0].length >= 15 && parts[1].length >= 15;

// BLOQUE 5: objeto JSON de metadatos (estado/tendencia/sesión). Tolera texto
// alrededor (```json, prosa) buscando el primer {...}. null si no hay o es inválido.
export const parseMeta = (parts) => {
  const raw = parts?.[4];
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
};

const metaStr = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// ── Workout parser para el ticket de prescripción ────────────────────────────
// Prioridad: 1) metadatos JSON del BLOQUE 5, 2) primer bullet con plantilla
// fija del BLOQUE 3 (**Tipo** · **X-Y km** · **M:SS-M:SS min/km** · **Zona N · ppm**),
// 3) heurísticas laxas sobre todo el texto (modelos que no respetan formato).
export const parseWorkout = (text, meta) => {
  if (!text && !meta?.sesion) return null;

  const result = { type: null, distance: null, pace: null, hrZone: null };

  const s = meta?.sesion;
  if (s) {
    result.type = metaStr(s.tipo);
    result.distance = metaStr(s.distancia);
    result.pace = metaStr(s.ritmo);
    result.hrZone = metaStr(s.zona);
  }

  const allFilled = result.type && result.distance && result.pace && result.hrZone;

  if (text && !allFilled) {
    // ── Plantilla estructurada: línea con ≥2 separadores " · " y unidades
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const ticketLine = lines.find(l => {
      const sepCount = (l.match(/·/g) || []).length;
      return sepCount >= 2 && /km/i.test(l) && /(ppm|zona)/i.test(l);
    });

    const stripBold = (str) => str.replace(/\*\*/g, '').trim();

    if (ticketLine) {
      const clean = ticketLine.replace(/^[-•*▸]\s*/, '');
      const fields = clean.split('·').map(f => stripBold(f));

      const TYPES = /(Regenerativo|Aeróbico base|Aerobico base|Tempo|Intervalos|Series|Rodaje largo|Fartlek|Base)/i;

      for (const f of fields) {
        if (!result.type && TYPES.test(f)) {
          result.type = f.match(TYPES)[1];
          continue;
        }
        if (!result.distance) {
          const dm = f.match(/[0-9]+(?:[.,][0-9]+)?(?:\s*-\s*[0-9]+(?:[.,][0-9]+)?)?\s*k?m\b/i);
          if (dm) { result.distance = dm[0].replace(/\s+/g, ' ').trim(); continue; }
        }
        if (!result.pace) {
          const pm = f.match(/[0-9]+:[0-9]{2}(?:\s*-\s*[0-9]+:[0-9]{2})?\s*(?:min\/km)?/i);
          if (pm && /min\/km|:/.test(f)) { result.pace = pm[0].replace(/\s+/g, ' ').trim(); continue; }
        }
        if (!result.hrZone) {
          const zm = f.match(/Zona\s*\d+(?:\s*·?\s*[0-9]+-[0-9]+\s*ppm)?/i)
            || f.match(/[0-9]+-[0-9]+\s*ppm/i);
          if (zm) { result.hrZone = zm[0].replace(/\s+/g, ' ').trim(); continue; }
        }
      }
      // La zona lleva el separador "·" dentro ("Zona 3 · 158-168 ppm"), así
      // que el split la parte en dos campos y se pierden los ppm: se recompone
      // desde la línea completa si falta o quedó sin rango de pulsaciones.
      if (!result.hrZone || !/ppm/i.test(result.hrZone)) {
        const zAll = clean.match(/Zona\s*\d+(?:\s*·?\s*[0-9]+-[0-9]+\s*ppm)?/i);
        if (zAll) result.hrZone = zAll[0].replace(/\s+/g, ' ').trim();
      }
    }

    // ── Fallback heurístico sobre todo el texto para campos que falten
    if (!result.type) {
      const tm = text.match(/\*\*(Regenerativo|Aeróbico base|Tempo|Intervalos|Rodaje largo|Fartlek|Series|Base)\*\*/i)
        || text.match(/(Regenerativo|Aeróbico base|Tempo|Intervalos|Rodaje largo|Fartlek|Series|Base)/i);
      if (tm) result.type = tm[1];
    }
    if (!result.distance) {
      const dm = text.match(/\*\*([0-9]+(?:[.,][0-9]+)?(?:\s*-\s*[0-9]+(?:[.,][0-9]+)?)?\s*k?m)\*\*/i)
        || text.match(/([0-9]+(?:[.,][0-9]+)?(?:\s*-\s*[0-9]+(?:[.,][0-9]+)?)?\s*km)\b/i);
      if (dm) result.distance = dm[1].replace(/\s+/g, ' ').trim();
    }
    if (!result.pace) {
      const pm = text.match(/\*\*([0-9]+:[0-9]{2}(?:\s*-\s*[0-9]+:[0-9]{2})?\s*min\/km)\*\*/i)
        || text.match(/([0-9]+:[0-9]{2}(?:\s*-\s*[0-9]+:[0-9]{2})?\s*min\/km)/i)
        || text.match(/([0-9]+:[0-9]{2}(?:\s*-\s*[0-9]+:[0-9]{2}))/i);
      if (pm) result.pace = pm[1].replace(/\s+/g, ' ').trim();
    }
    if (!result.hrZone) {
      const hm = text.match(/\*\*(Zona \d+(?:\s*·\s*[0-9]+-[0-9]+\s*ppm)?)\*\*/i)
        || text.match(/(Zona \d+\s*·?\s*[0-9]+-[0-9]+\s*ppm)/i)
        || text.match(/(Zona \d+)/i)
        || text.match(/([0-9]+-[0-9]+\s*ppm)/i);
      if (hm) result.hrZone = hm[1].replace(/\s+/g, ' ').trim();
    }
  }

  return {
    type: result.type || 'Base Aeróbica',
    distance: result.distance,
    pace: result.pace,
    hrZone: result.hrZone,
  };
};

// ── Badges de estado/tendencia ───────────────────────────────────────────────
// Prioridad: metadatos JSON del modelo; si faltan, heurística por keywords.
const META_STATUS = {
  recuperado: 'recuperado',
  fatigado: 'fatiga',
  sobreentrenado: 'sobreentrenamiento',
  en_forma: 'forma',
  adaptativo: 'adaptativo',
};

export const deriveStatusKey = (cur, meta) => {
  const fromMeta = META_STATUS[metaStr(meta?.estado)?.toLowerCase()];
  if (fromMeta) return fromMeta;
  if (!cur) return null;
  const text = cur.toLowerCase();
  if (text.includes('fatig') || text.includes('cansad')) return 'fatiga';
  if (text.includes('recuperad') || text.includes('estable')) return 'recuperado';
  if (text.includes('sobreentren')) return 'sobreentrenamiento';
  if (text.includes('forma') || text.includes('óptim') || text.includes('fuerte')) return 'forma';
  return 'adaptativo';
};

const META_TREND = ['progresion', 'estable', 'riesgo', 'estacional'];

export const deriveTrendKey = (trend, meta) => {
  const fromMeta = metaStr(meta?.tendencia)?.toLowerCase();
  if (META_TREND.includes(fromMeta)) return fromMeta;
  if (!trend) return null;
  const text = trend.toLowerCase();
  const negated = /interrump|estanc|meseta|estabil|caíd|caid|pérdida|perdida|insuficien|frena|detien/.test(text);
  if (text.includes('lesi') || text.includes('dolor') || text.includes('riesgo')) return 'riesgo';
  if (text.includes('estanc') || text.includes('meseta') || text.includes('estabil') || text.includes('interrump') || text.includes('insuficien')) return 'estable';
  if ((text.includes('progres') || text.includes('mejor')) && !negated) return 'progresion';
  return 'estacional';
};
