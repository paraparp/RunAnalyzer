// ── Nombres de lugar desde coordenadas ───────────────────────────────────────
// Un cúmulo de geoZones es un par de coordenadas: sabe DÓNDE, no CÓMO SE LLAMA.
// Nominatim (el geocodificador de OpenStreetMap) traduce lo uno en lo otro.
//
// Por qué es asumible: se pregunta UNA VEZ POR CÚMULO, no por actividad. Aunque
// haya miles de carreras, los sitios son decenas.
//
// Condiciones de uso de Nominatim (nominatim.org/release-docs/latest/api/Reverse):
// servicio gratuito sin clave, máximo 1 petición por segundo y nada de descargas
// masivas. De ahí `MIN_INTERVAL_MS` y que la llamada la dispare el atleta con un
// botón — no se geocodifica solo al abrir la pestaña.
//
// Y el aviso que importa: esto MANDA TUS COORDENADAS a un servidor de terceros.
// Por eso es explícito y opcional, nunca automático.

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

/** Mínimo entre peticiones (política de uso: 1 req/s; damos margen). */
export const MIN_INTERVAL_MS = 1100;

// zoom=14 ≈ barrio / pueblo: el nivel al que se reconoce una "zona de
// entrenamiento". Más fino devuelve nombres de calle; más grueso, la provincia.
const ZOOM = 14;

// De más específico a más general. El primero que exista es el nombre local del
// sitio; `AREA_FIELDS` da el contexto con el que desambiguar si dos cúmulos
// distintos acaban resolviendo al mismo nombre.
const LOCAL_FIELDS = [
  'neighbourhood', 'suburb', 'quarter', 'city_district', 'borough',
  'village', 'hamlet', 'town', 'municipality',
];
const AREA_FIELDS = ['city', 'town', 'municipality', 'county', 'state'];

// Jerarquía administrativa para la línea de contexto, de dentro a fuera. "Chamberí"
// a secas no ubica a nadie que no sea de Madrid; "Madrid, Comunidad de Madrid" sí.
const CONTEXT_FIELDS = ['city', 'town', 'municipality', 'county', 'state', 'country'];
const CONTEXT_MAX_PARTS = 3;

/**
 * Extrae { local, area, context } de una respuesta de Nominatim.
 *   local   — el nombre del sitio, lo más específico que haya (el barrio).
 *   area    — el siguiente escalón, para desambiguar dos "Centro" distintos.
 *   context — la jerarquía administrativa completa, para enseñarla bajo el
 *             nombre: es lo que permite reconocer un cúmulo sin abrir el mapa.
 * Puro: la parte que merece test está aquí, la red se queda fuera.
 */
export function pickPlaceName(json) {
  const addr = json?.address;
  if (!addr) return { local: null, area: null, context: null };

  const local = LOCAL_FIELDS.map(f => addr[f]).find(Boolean) ?? null;
  const area  = AREA_FIELDS.map(f => addr[f]).find(v => v && v !== local) ?? null;
  // Si no hubo nada específico, el área hace de nombre y no queda desambiguador.
  const name = local ?? area;

  // Contexto: la jerarquía sin repetir el propio nombre ni escalones duplicados
  // (en un municipio pequeño city, town y county traen la misma cadena).
  const seen = new Set(name ? [name] : []);
  const parts = [];
  for (const f of CONTEXT_FIELDS) {
    const v = addr[f];
    if (!v || seen.has(v)) continue;
    seen.add(v);
    parts.push(v);
    if (parts.length === CONTEXT_MAX_PARTS) break;
  }

  return {
    local: name,
    area: local ? area : null,
    context: parts.length ? parts.join(', ') : null,
  };
}

/**
 * Resuelve los nombres a etiquetas ÚNICAS. Dos cúmulos del mismo barrio
 * devuelven el mismo `local`; sin esto quedarían dos filas llamadas igual y no
 * habría forma de saber cuál es cuál. Al repetido se le añade el área y, si aún
 * choca, un ordinal. Puro y determinista.
 *
 * entries: [{ key, local, area }] → { [key]: nombre }
 */
export function uniqueLabels(entries) {
  const counts = new Map();
  for (const e of entries) {
    if (e.local) counts.set(e.local, (counts.get(e.local) ?? 0) + 1);
  }
  const used = new Set();
  const out = {};
  for (const e of entries) {
    if (!e.local) continue;
    let name = e.local;
    if (counts.get(e.local) > 1 && e.area) name = `${e.local} (${e.area})`;
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name} ${n}`)) n++;
      name = `${name} ${n}`;
    }
    used.add(name);
    out[e.key] = name;
  }
  return out;
}

/** Una consulta de reverse geocoding. Devuelve { local, area, context }. */
export async function reverseGeocode([lat, lng], { lang = 'es', signal } = {}) {
  const url = `${NOMINATIM_URL}?format=jsonv2&zoom=${ZOOM}`
            + `&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`
            + `&accept-language=${encodeURIComponent(lang)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return pickPlaceName(await res.json());
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); reject(signal.reason); }, { once: true });
});

/**
 * Geocodifica una lista de puntos respetando el límite de 1 req/s.
 * `onProgress(done, total)` permite pintar el avance; un fallo suelto no aborta
 * el lote (se salta ese punto), pero un abort sí lo corta.
 *
 * points: [{ key, centroid }] → [{ key, local, area, context }]
 */
export async function reverseGeocodeBatch(points, { lang = 'es', signal, onProgress } = {}) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0) await sleep(MIN_INTERVAL_MS, signal);
    try {
      const { local, area, context } = await reverseGeocode(points[i].centroid, { lang, signal });
      if (local) out.push({ key: points[i].key, local, area, context });
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
      // Un 429/500 puntual no debe tirar el lote entero: ese cúmulo se queda sin
      // nombre y el atleta lo escribe a mano, que es el camino por defecto.
    }
    onProgress?.(i + 1, points.length);
  }
  return out;
}
