// ============================================================================
// trainingLoad — modelo ÚNICO de carga de entrenamiento y PMC para toda la app.
//
// Antes cada vista implementaba su propio bucle CTL/ATL con su propia definición
// de carga diaria (StatusSnapshot e InjuryRisk usaban `(min/60)*0.5`; el resto un
// `estimateLoad` distinto), así que la misma sesión producía un CTL en "Estado" y
// otro en "Motor Aeróbico" y un tercero en el prompt del coach. Este módulo es la
// única fuente: funciones puras, sin UI ni I/O.
//
// ── Escala ───────────────────────────────────────────────────────────────────
// Toda carga se expresa en la escala TSS de TrainingPeaks: **100 = 1 hora al
// umbral de lactato**. Es la escala para la que están calibrados los umbrales que
// ya usa la UI (TSB > +15 "muy fresco", ACWR 0.8–1.3, rampa CTL ≤ +5/sem), así que
// el modelo cambia pero las lecturas siguen significando lo mismo.
// OJO: los umbrales de *strain* de InjuryRisk NO venían de esta escala — eran los de
// Foster sobre session-RPE y no disparaban nunca con TSS. Recalibrados allí a
// 1000/1500/2200; si se toca esta escala hay que revisarlos.
//
// ── Intensidad: TRIMP de Banister, normalizado ──────────────────────────────
// La intensidad se pondera con el TRIMP exponencial de Banister sobre la reserva
// de frecuencia cardiaca (HRR), no sobre %FCmax:
//
//     TRIMP = t_min · HRR · k₁ · e^(k₂ · HRR)        HRR = (FC − FCrep)/(FCmax − FCrep)
//
// con k₁/k₂ = 0.64/1.92 (hombre) y 0.86/1.67 (mujer). La ponderación exponencial
// es lo que hace que el modelo distinga una serie de un rodaje: un promedio lineal
// no lo hace.
//
// Se normaliza dividiendo por el TRIMP de 1 h al umbral y multiplicando por 100.
// Esto tiene una propiedad útil: **k₁ se cancela por completo** en el cociente, y
// k₂ solo sobrevive como e^(k₂·(HRR − HRR_umbral)), es decir, actúa sobre la
// DISTANCIA al umbral, no sobre el valor absoluto. Por eso no conocer el sexo del
// atleta (Strava no lo expone aquí) es un efecto de segundo orden y no invalida
// la serie. Ver TRIMP_COEF más abajo.
//
// ── Por qué NO se usa `suffer_score` de Strava ──────────────────────────────
// El Relative Effort de Strava es TRIMP-like pero vive en OTRA escala y se calcula
// con las zonas de Strava (que suelen arrastrar una FCmax por defecto). El código
// anterior lo prefería cuando existía y caía al modelo propio cuando no, mezclando
// dos escalas en la misma serie temporal: eso distorsiona el EWMA en los tramos
// donde alternan. Aquí se calcula SIEMPRE con el mismo modelo, y la calibración
// (FCmax/FCreposo/LTHR) sale de `hrZones.js`, que ya es la fuente única de zonas.
//
// ── Cadena de métodos (de mejor a peor) ─────────────────────────────────────
//   'hrtss_splits' — TRIMP por kilómetro sobre `splits_metric` y suma. Recupera la
//                    variación intra-sesión que el promedio aplasta: en una sesión
//                    de series, la FC media miente y este método no.
//   'hrtss'        — TRIMP sobre la FC media de la sesión.
//   'rtss'         — sin FC: TSS por ritmo (Coggan): duración_h · IF² · 100, con
//                    IF = velocidad ajustada por pendiente / velocidad umbral.
//   'duration'     — sin FC ni velocidad: se asume IF = 0.70 (rodaje suave).
//
// ── PMC ─────────────────────────────────────────────────────────────────────
// CTL = EWMA 42 d (Fitness), ATL = EWMA 7 d (Fatiga), TSB = CTL − ATL (Forma),
// según el modelo impulso-respuesta de Banister en la implementación de Coggan.
// Se usa la forma exponencial exp(−1/τ) (Banister), no la aritmética 1 − 1/τ de
// TrainingPeaks; difieren en <0.03 % y la exponencial es la del artículo original.
// TSB se reporta como CTL(d) − ATL(d) del mismo día (convención de GoldenCheetah).
// TrainingPeaks usa el TSB de la víspera; la diferencia es un día de desfase.
//
// ── ACWR ────────────────────────────────────────────────────────────────────
// El ratio agudo:crónico NO se calcula como ATL/CTL. La crónica de Gabbett son
// 28 días, no los 42 del CTL, y la formulación validada es la EWMA de Williams
// et al. (2017), no la media móvil plana del artículo original. Usar ATL/CTL(42)
// —lo que hacía el código anterior— infla sistemáticamente el ratio.
//
// Advertencia deliberada: desde Impellizzeri et al. (2020) el ACWR está bajo
// crítica metodológica seria (artefactos de acoplamiento matemático, sensibilidad
// a la ventana). Se mantiene porque la UI lo muestra, pero trátalo como señal
// blanda, nunca como predictor de lesión.
//
// Referencias:
//   [Banister 1991]     Banister — Modeling elite athletic performance.
//   [Morton 1990]       Morton, Fitz-Clarke & Banister, J Appl Physiol 69(3).
//   [Coggan/Allen 2010] Training and Racing with a Power Meter — TSS/CTL/ATL/TSB.
//   [Williams 2017]     Williams et al., Br J Sports Med 51(3) — ACWR por EWMA.
//   [Impellizzeri 2020] Impellizzeri et al., Int J Sports Physiol Perform — crítica ACWR.
//   [Minetti 2002]      Minetti et al., J Appl Physiol 93(3) — coste energético vs pendiente.
// ============================================================================
// Extensiones explícitas: este módulo lo importa también `api/_lib/mcp-store.js`,
// que corre en Node ESM (sin bundler) y ahí un import extensionless no resuelve.
import { detectMaxHR, detectRestHR, estimateLTHR, DEFAULT_REST_HR } from './hrZones.js';
import { gapSpeedFromGain } from './gap.js';

// ── Constantes del modelo ────────────────────────────────────────────────────

/** Constantes de tiempo (días) del PMC de Banister/Coggan. */
export const TAU_CTL = 42;
export const TAU_ATL = 7;

/** Ventanas del ACWR de Gabbett en formulación EWMA (Williams 2017). */
export const TAU_ACWR_ACUTE = 7;
export const TAU_ACWR_CHRONIC = 28;

/**
 * Coeficientes del TRIMP de Banister. k₁ se cancela al normalizar; k₂ solo pesa
 * sobre la distancia al umbral. Por defecto 'male' porque es el conjunto original
 * de Banister y Strava no expone el sexo del atleta en los datos que guardamos.
 */
export const TRIMP_COEF = {
  male:   { k1: 0.64, k2: 1.92 },
  female: { k1: 0.86, k2: 1.67 },
};

/** Intensidad asumida cuando no hay ni FC ni velocidad (rodaje suave). */
const FALLBACK_IF = 0.70;

/** Techo de HRR: una lectura por encima de FCmax es ruido, no un esfuerzo sobrehumano. */
const HRR_MAX = 1.05;

/** Un split necesita tiempo y FC creíbles para contar como muestra. */
const MIN_SPLIT_SEC = 30;
const MIN_SPLIT_HR = 60;

// ── Utilidades de fecha ──────────────────────────────────────────────────────

/**
 * Clave de día LOCAL (YYYY-MM-DD). Se usa `start_date_local` cuando existe: el
 * día de entrenamiento es el del atleta, no el UTC. Iterar días sumando 86400000 ms
 * —lo que hacían las cuatro copias anteriores— salta o repite un día en los
 * cambios de horario; aquí se avanza con setDate sobre una fecha local.
 */
export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Día local de una actividad, preferiendo la hora local de Strava. */
export function activityDayKey(a) {
  const raw = a?.start_date_local || a?.start_date;
  if (!raw) return null;
  // `start_date_local` ya viene desplazado a la zona del atleta: leer solo la
  // parte de fecha evita que el parseo lo vuelva a mover.
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : dayKey(raw);
}

const keyToDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// ── Ajuste por pendiente ─────────────────────────────────────────────────────
// El modelo vive en lib/gap (Minetti amortiguado), compartido con la tabla del
// dashboard, los parciales y el backend. Aquí solo se conoce el D+ acumulado de la
// actividad, así que se usa la variante de perfil ondulado.

/** Velocidad equivalente en llano (m/s) a partir del D+ acumulado. */
function gradeAdjustedSpeed(speedMs, distanceM, elevGainM) {
  if (!(speedMs > 0)) return null;
  return gapSpeedFromGain(speedMs, distanceM, elevGainM);
}

// ── Calibración ──────────────────────────────────────────────────────────────

/**
 * Velocidad umbral (m/s) estimada del propio historial: el mejor esfuerzo
 * sostenido en llano entre 25 y 70 min. Es la duración en la que un corredor
 * entrenado rinde cerca de su umbral, así que sirve de proxy razonable.
 * Solo se usa en la rama 'rtss' (sesiones sin FC), nunca cuando hay pulso.
 */
export function estimateThresholdSpeed(activities) {
  let best = 0;
  for (const a of activities ?? []) {
    const t = a.moving_time || 0;
    const d = a.distance || 0;
    if (t < 25 * 60 || t > 70 * 60 || d <= 0) continue;
    const elev = a.total_elevation_gain || 0;
    if (elev / d > 0.02) continue; // demasiada pendiente para comparar ritmos
    const v = gradeAdjustedSpeed(a.average_speed || d / t, d, elev);
    if (v > best) best = v;
  }
  return best > 0 ? best : null;
}

/**
 * Parámetros de calibración del modelo. Todo es opcional: lo que no venga dado
 * se detecta del historial con los detectores de `hrZones.js` (los mismos que
 * alimentan la pestaña de Zonas y el prompt del coach, así que no puede haber
 * dos FCmax distintas conviviendo).
 *
 * @param {Array} activities
 * @param {{hrmax?:number, hrrest?:number, lthr?:number, thresholdSpeed?:number,
 *          sex?:'male'|'female', garmin?:Array}} [opts]
 */
export function buildLoadParams(activities, opts = {}) {
  const list = activities ?? [];
  const hrmax = opts.hrmax || detectMaxHR(list).value;
  const hrrest = opts.hrrest
    || Math.min(opts.garmin ? detectRestHR(opts.garmin).value : DEFAULT_REST_HR, hrmax - 20);
  const lthr = opts.lthr || estimateLTHR(hrmax);
  const { k1, k2 } = TRIMP_COEF[opts.sex] ?? TRIMP_COEF.male;

  const hrr = Math.max(1, hrmax - hrrest);
  // HRR al umbral: el denominador que fija la escala (1 h aquí = 100).
  const hrrThreshold = Math.min(HRR_MAX, Math.max(0.05, (lthr - hrrest) / hrr));
  const refTrimp = rawTrimp(60, hrrThreshold, k1, k2);

  return {
    hrmax,
    hrrest,
    lthr,
    hrr,
    k1,
    k2,
    hrrThreshold,
    refTrimp,
    thresholdSpeed: opts.thresholdSpeed ?? estimateThresholdSpeed(list),
  };
}

// ── Carga por sesión ─────────────────────────────────────────────────────────

/** TRIMP crudo de Banister (unidades arbitrarias; se normaliza después). */
function rawTrimp(minutes, hrrFraction, k1, k2) {
  return minutes * hrrFraction * k1 * Math.exp(k2 * hrrFraction);
}

const hrrOf = (hr, params) =>
  Math.min(HRR_MAX, Math.max(0, (hr - params.hrrest) / params.hrr));

/**
 * Carga de una sesión en escala TSS (100 = 1 h al umbral).
 * Devuelve `{ load, method }`; `load` nunca es negativo.
 *
 * @param {object} a         actividad de Strava (o Garmin normalizada)
 * @param {object} params    salida de buildLoadParams()
 */
export function sessionLoad(a, params) {
  const seconds = a?.moving_time || a?.elapsed_time || 0;
  if (!a || seconds <= 0) return { load: 0, method: 'none' };

  const toTss = (trimp) => (params.refTrimp > 0 ? (100 * trimp) / params.refTrimp : 0);

  // 1) TRIMP por splits — recupera la estructura interna de la sesión.
  const splits = Array.isArray(a.splits_metric) ? a.splits_metric : null;
  if (splits?.length) {
    let trimp = 0;
    let covered = 0;
    for (const s of splits) {
      const t = s.moving_time || s.elapsed_time || 0;
      const hr = s.average_heartrate;
      if (t < MIN_SPLIT_SEC || !(hr > MIN_SPLIT_HR)) continue;
      trimp += rawTrimp(t / 60, hrrOf(hr, params), params.k1, params.k2);
      covered += t;
    }
    // Se exige cubrir la mitad de la sesión: con menos, los splits sin FC
    // (calentamiento con la banda aún sin enganchar) subestimarían la carga.
    if (covered >= seconds * 0.5) {
      return { load: toTss(trimp), method: 'hrtss_splits' };
    }
  }

  // 2) TRIMP sobre la FC media.
  if (a.average_heartrate > MIN_SPLIT_HR) {
    const trimp = rawTrimp(seconds / 60, hrrOf(a.average_heartrate, params), params.k1, params.k2);
    return { load: toTss(trimp), method: 'hrtss' };
  }

  // 3) Sin FC: TSS por ritmo (Coggan) — duración_h · IF² · 100.
  const distance = a.distance || 0;
  if (params.thresholdSpeed > 0 && distance > 0) {
    const speed = gradeAdjustedSpeed(
      a.average_speed || distance / seconds, distance, a.total_elevation_gain || 0,
    );
    if (speed > 0) {
      // IF acotado: un GPS con deriva puede fabricar un 3:00/km imposible.
      const intensity = Math.min(1.3, speed / params.thresholdSpeed);
      return { load: (seconds / 3600) * intensity ** 2 * 100, method: 'rtss' };
    }
  }

  // 4) Último recurso: solo duración, a intensidad de rodaje.
  return { load: (seconds / 3600) * FALLBACK_IF ** 2 * 100, method: 'duration' };
}

// ── Agregación diaria ────────────────────────────────────────────────────────

/**
 * Carga por día local. Devuelve un Map dateKey → { load, activities, methods }.
 * `activities` conserva las referencias originales para que las vistas puedan
 * pintar el detalle del día sin volver a recorrer el historial.
 */
export function dailyLoad(activities, params) {
  const byDay = new Map();
  for (const a of activities ?? []) {
    const key = activityDayKey(a);
    if (!key) continue;
    const { load, method } = sessionLoad(a, params);
    const entry = byDay.get(key) ?? { load: 0, activities: [], methods: [] };
    entry.load += load;
    entry.activities.push(a);
    entry.methods.push(method);
    byDay.set(key, entry);
  }
  return byDay;
}

// ── PMC ──────────────────────────────────────────────────────────────────────

const ewmaStep = (prev, value, tau) => {
  const k = Math.exp(-1 / tau);
  return prev * k + value * (1 - k);
};

/**
 * Performance Management Chart completo.
 *
 * @param {Array} activities
 * @param {object} [opts]  se pasa tal cual a buildLoadParams; además:
 *   @param {Date|number} [opts.until]  último día de la serie (por defecto hoy)
 *   @param {object}      [opts.params] calibración ya construida (evita re-detectar)
 *
 * @returns {null | {
 *   params, series: Array<{date,load,ctl,atl,tsb,activities}>,
 *   current: {ctl,atl,tsb,acwr,ramp,peak,peakDate,pctPeak,lowestTsb,
 *             ctlTrend7,ctlTrend28,maxDayLoad}
 * }}
 */
export function computePMC(activities, opts = {}) {
  const list = activities ?? [];
  if (!list.length) return null;

  const params = opts.params ?? buildLoadParams(list, opts);
  const byDay = dailyLoad(list, params);
  if (!byDay.size) return null;

  const firstKey = [...byDay.keys()].sort()[0];
  const cursor = keyToDate(firstKey);
  const end = opts.until ? new Date(opts.until) : new Date();
  end.setHours(0, 0, 0, 0);

  let ctl = 0;
  let atl = 0;
  let acuteE = 0;
  let chronicE = 0;
  let peak = 0;
  let peakDate = firstKey;
  let lowestTsb = Infinity;
  let maxDayLoad = 0;
  const series = [];

  // Avance día a día con setDate: inmune a los cambios de horario.
  for (; cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dayKey(cursor);
    const day = byDay.get(key);
    const load = day?.load ?? 0;

    ctl = ewmaStep(ctl, load, TAU_CTL);
    atl = ewmaStep(atl, load, TAU_ATL);
    acuteE = ewmaStep(acuteE, load, TAU_ACWR_ACUTE);
    chronicE = ewmaStep(chronicE, load, TAU_ACWR_CHRONIC);

    const tsb = ctl - atl;
    if (ctl > peak) { peak = ctl; peakDate = key; }
    if (tsb < lowestTsb) lowestTsb = tsb;
    if (load > maxDayLoad) maxDayLoad = load;

    series.push({
      date: key,
      load,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      activities: day?.activities ?? [],
    });
  }

  const n = series.length;
  const ctl7ago = n > 7 ? series[n - 8].ctl : 0;
  const ctl28ago = n > 28 ? series[n - 29].ctl : 0;
  // Rampa semanal: sobre 28 días cuando hay historial (menos ruidosa), si no 7.
  const ramp = n > 28 ? (ctl - ctl28ago) / 4 : ctl - ctl7ago;

  return {
    params,
    series,
    current: {
      ctl,
      atl,
      tsb: ctl - atl,
      // ACWR EWMA 7:28 (Williams 2017), NO atl/ctl.
      acwr: chronicE > 0 ? acuteE / chronicE : null,
      ramp,
      peak,
      peakDate,
      pctPeak: peak > 0 ? Math.round((ctl / peak) * 100) : 0,
      lowestTsb: Number.isFinite(lowestTsb) ? lowestTsb : 0,
      ctlTrend7: ctl - ctl7ago,
      ctlTrend28: ctl - ctl28ago,
      maxDayLoad,
    },
  };
}

export default computePMC;
