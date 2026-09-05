// ============================================================================
// shoeLife — vida útil esperada de una zapatilla, por TIPO y con override manual.
//
// `GearTracker` pintaba una barra de desgaste contra un `maxLife: 800` fijo,
// comentado en el propio código como "se recomienda escalar". 800 km es la cifra
// de una zapatilla de rodaje: aplicada a una de placa de carbono (~250 km) la
// barra dice "buen estado" con el par ya muerto, y aplicada a una de trail
// infravalora la suela. Como encima la barra se lee como recomendación, el número
// tenía que dejar de ser uno solo.
//
// Dos capas, en este orden:
//   1) OVERRIDE del atleta por par (lo que él sabe de sus zapatillas manda).
//   2) TIPO detectado del nombre de Strava ("Nike Vaporfly 3" → placa de carbono).
//   3) Por defecto, el rodaje de siempre (800 km) — que es lo que había.
//
// ── Procedencia de las cifras ────────────────────────────────────────────────
// NO son medidas: son las ventanas de recambio que publican los fabricantes y la
// prensa especializada, que es exactamente el nivel de evidencia que hay aquí
// (no existe un estudio que fije la vida de una media suela por modelo). Por eso
// el número es EDITABLE y por eso `source` viaja con él: la UI puede decir si lo
// puso el atleta o lo dedujo la app, en vez de presentar una estimación como dato.
// Rangos de referencia: placa de carbono 160-320 km · voladora sin placa 300-500
// · entreno con placa/tempo 400-600 · trail 500-700 · rodaje 600-900.
// ============================================================================

/** Vida por defecto cuando no se reconoce el tipo (la de una zapatilla de rodaje). */
export const DEFAULT_SHOE_LIFE_KM = 800;

/** Límites de un override manual creíble. Fuera de esto es un dedazo, no un dato. */
export const MIN_SHOE_LIFE_KM = 50;
export const MAX_SHOE_LIFE_KM = 2000;

/**
 * Categorías, de la MÁS específica a la más general: se devuelve la primera que
 * casa. El orden importa — "Adizero Adios Pro" es placa de carbono y "Adizero
 * Adios" a secas es voladora, así que la placa tiene que mirarse antes.
 */
export const SHOE_CATEGORIES = [
  {
    id: 'plated_racer',
    lifeKm: 250,
    // Placa de carbono. La espuma supercrítica pierde retorno mucho antes de que
    // la suela se vea gastada, así que el kilometraje manda sobre el aspecto.
    patterns: [
      /vaporfly/, /alphafly/, /streakfly\s*pro/, /adios\s*pro/, /pro\s*evo/, /prime\s*x/,
      /takumi\s*sen/, /metaspeed/, /magic\s*speed/, /endorphin\s*(elite|pro)/,
      /cielo\s*x/, /rocket\s*x/, /deviate\s*elite/, /fast[-\s]?r/, /nitro\s*elite/,
      /vectiv\s*pro/, /carbon\s*x/, /pwrrun\s*pb\s*pro/, /placa\s*de\s*carbono/, /carbon\s*plate/,
    ],
  },
  {
    id: 'racing_flat',
    lifeKm: 400,
    // Voladora ligera sin placa rígida: poca media suela que degradar.
    patterns: [
      /streakfly/, /adizero\s*(adios|rc|takumi)/, /hyperion(?!\s*max)/, /rebel/,
      /cielo\s*(?!x)/, /type\s*a/, /mach\s*nitro/, /zoom\s*fly/, /tarther/,
    ],
  },
  {
    id: 'tempo_trainer',
    lifeKm: 500,
    // Entrenamiento rápido con placa flexible (nylon/pebax) o espuma agresiva.
    patterns: [
      /endorphin\s*speed/, /tempo\s*next/, /boston/, /mach\s*x/, /superblast/,
      /deviate\s*nitro/, /kinvara/, /evo\s*sl/, /hyperion\s*max/, /tempo/,
    ],
  },
  {
    id: 'trail',
    lifeKm: 600,
    // Manda la suela, no la media suela; y el terreno la castiga de forma desigual.
    patterns: [
      /speedgoat/, /mafate/, /challenger/, /peregrine/, /xodus/, /cascadia/,
      /caldera/, /lone\s*peak/, /sense\s*ride/, /speedcross/, /genesis/, /pulsar\s*trail/,
      /catamount/, /agravic/, /terrex/, /vectiv/, /trabuco/, /fuji/, /akasha/, /bushido/,
      /mtl/, /\btrail\b/, /\bsalomon\b/, /\bla\s*sportiva\b/, /\bscarpa\b/, /\bmerrell\b/,
    ],
  },
  {
    id: 'daily_trainer',
    lifeKm: DEFAULT_SHOE_LIFE_KM,
    // Rodaje diario: la ventana clásica de 600-900 km, que es la que había fija.
    patterns: [
      /pegasus/, /clifton/, /bondi/, /arahi/, /gaviota/, /ghost/, /glycerin/, /adrenaline/,
      /nimbus/, /cumulus/, /kayano/, /novablast/, /\bride\b/, /triumph/, /guide/, /hurricane/,
      /cloudmonster/, /cloudsurfer/, /cloudflyer/, /velocity\s*nitro/, /vomero/, /invincible/,
      /structure/, /infinity\s*run/, /solar\s*(glide|boost)/, /ultraboost/, /supernova/,
      /levitate/, /launch/, /wave\s*rider/, /wave\s*sky/, /fresh\s*foam/, /880/, /1080/,
    ],
  },
];

const CATEGORY_BY_ID = Object.fromEntries(SHOE_CATEGORIES.map((c) => [c.id, c]));

/** Normaliza para casar patrones: minúsculas y sin acentos. */
function normalize(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Tipo de zapatilla deducido del nombre de Strava.
 * @returns {string|null} id de categoría, o null si el nombre no dice nada.
 */
export function detectShoeCategory(name) {
  const n = normalize(name);
  if (!n.trim()) return null;
  for (const cat of SHOE_CATEGORIES) {
    if (cat.patterns.some((re) => re.test(n))) return cat.id;
  }
  return null;
}

/** Vida de referencia de una categoría (o la de rodaje si el id no existe). */
export function categoryLifeKm(categoryId) {
  return CATEGORY_BY_ID[categoryId]?.lifeKm ?? DEFAULT_SHOE_LIFE_KM;
}

/**
 * ¿Es un override manual utilizable? Se acepta lo que venga como número o como
 * texto de un input, y se rechaza en silencio lo que no tenga sentido físico:
 * un 0 o un 100000 rompen la barra de desgaste sin avisar.
 */
export function isValidLifeKm(value) {
  const km = Number(value);
  return Number.isFinite(km) && km >= MIN_SHOE_LIFE_KM && km <= MAX_SHOE_LIFE_KM;
}

/**
 * Vida útil que debe usar la barra de desgaste de un par.
 *
 * @param {string} name         nombre del par en Strava
 * @param {number|string} [override] valor fijado por el atleta para ESTE par
 * @returns {{ km: number, source: 'override'|'category'|'default', category: string|null }}
 */
export function shoeLifeKm(name, override) {
  if (isValidLifeKm(override)) {
    return { km: Number(override), source: 'override', category: detectShoeCategory(name) };
  }
  const category = detectShoeCategory(name);
  if (category) return { km: categoryLifeKm(category), source: 'category', category };
  return { km: DEFAULT_SHOE_LIFE_KM, source: 'default', category: null };
}

/**
 * Limpia el mapa { gearId: km } que se persiste: descarta claves vacías y valores
 * fuera de rango, para que un JSON corrupto no envenene la vista entera.
 */
export function sanitizeLifeOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    if (id && isValidLifeKm(v)) out[id] = Number(v);
  }
  return out;
}

export default shoeLifeKm;
