// Forma aeróbica: FC a un esfuerzo FIJO, por periodos.
//
// LA PREGUNTA: "¿estoy mejor que en marzo?". Lo que hay que comparar es la FC que
// cuesta correr a un esfuerzo DADO, no un cociente. Y no se puede comparar sin más
// la FC media de las sesiones, porque cada día se corrió a un esfuerzo distinto.
//
// EL MÉTODO. Una regresión sobre las sesiones del rango:
//
//     FC = b0 + b1·(esfuerzo − esfuerzo_ref) + Σ d_p·periodo_p [+ c·(WBGT − WBGT_medio)]
//
// y se lee la FC PREDICHA en el esfuerzo de referencia, que es donde el término de
// la pendiente vale cero: la FC a esfuerzo fijo del periodo p es simplemente
// b0 + d_p, con su error estándar. Eso es lo que hace comparables dos meses en los
// que no se corrió al mismo ritmo.
//
// POR QUÉ NO UN COCIENTE (m/latido, W/ppm): la recta tiene INTERCEPTO. Un cociente
// FC/esfuerzo mezcla la pendiente con el intercepto, así que sube solo con bajar la
// intensidad. Y POR QUÉ NO FILTRAR POR BANDA DE FC: eso condiciona sobre la
// variable resultado —si solo miras sesiones a 145-155 ppm, la mejora "a FC dada"
// se borra por construcción—. Los dos errores se probaron antes de esto y los dos
// daban "eficiencia plana" sobre datos donde la mejora era de ~8 ppm.
//
// DOS EJES DE ESFUERZO, a elegir (`axis`):
//   · 'gap'   — velocidad equivalente en llano (m/s), calculada en casa
//               (`hrEffortWindow.js` + el modelo de `gap.js`). Cubre TODO el
//               histórico, incluidas las actividades sin potencia, y es auditable.
//   · 'power' — la potencia de Garmin/Strava. Es un MODELO de velocidad + pendiente,
//               no un potenciómetro: mide lo mismo que el GAP con otra escala, no
//               la economía de carrera. Se ofrece porque es la cifra que el atleta
//               ve en el reloj, pero falta en buena parte del histórico.
// No se mezclan NUNCA en la misma serie: son dos modelos de terreno distintos.
//
// QUÉ NO MIDE ESTO: economía de carrera. Ni el GAP ni la potencia de Garmin salen
// de un sensor de fuerza; los dos son el ritmo corregido por terreno. Lo que se
// mide es cuánta FC cuesta ese ritmo corregido — forma cardiovascular — y eso
// también se mueve con el calor, el sueño, la fatiga acumulada y la cafeína.
// Por eso la ventana se limpia, el WBGT entra como covariable y se publican n y SE.

import { hasHrEffort, BIN_S } from './hrEffortWindow.js';

// Ventana por defecto (minutos desde el inicio): fuera queda la subida de FC del
// principio —donde la FC va por debajo del esfuerzo— y la deriva cardiaca del
// final, donde va por encima. Es la misma ventana con la que se validó el método.
export const DEFAULT_WINDOW_MIN = [15, 45];

// Tiempo útil mínimo dentro de la ventana. Menos de esto es una media de dos
// bloques que puede caer entera en un tramo atípico de la sesión.
const MIN_WINDOW_S = 900;

// Inestabilidad máxima del esfuerzo dentro de la ventana. Por encima no es un
// rodaje continuo sino cuestas o cambios de ritmo, y ahí la FC va con retraso
// respecto al esfuerzo: el par (esfuerzo, FC) de la sesión mide el retraso, no la
// forma.
//
// 8 % y no el 6 % del análisis manual A PROPÓSITO: aquel 6 % era el CV de la
// potencia MEDIA POR LAP, y este es el de la serie suavizada muestra a muestra, que
// es un estadístico distinto y más alto — un rodaje ondulado normal (±3 % de
// pendiente) da 5 %, así que a 6 % el umbral estaba rozando el caso bueno y echaba
// una de cada cuatro sesiones sanas. Medido sobre datos simulados con ruido de GPS
// realista, subir a 8 % recupera 5 de 20 sesiones y MEJORA la precisión del modelo
// (DE residual 0,18 → 0,14 ppm), porque lo que entra son sesiones válidas.
//
// Lo que este umbral NO tiene que atrapar son series y cuestas: esas ya caen antes,
// en el filtro de picos de `hrEffortWindow.js`, que las deja sin bloques.
const DEFAULT_MAX_CV = 0.08;

// Un periodo con una sola sesión no es una medida: consume un grado de libertad,
// su residuo es cero por construcción y su punto es el ruido de ese día.
const DEFAULT_MIN_SESSIONS = 2;

// Multiplicadores de la pendiente estimada para el análisis de sensibilidad. Si la
// conclusión cambia al mover la pendiente a la mitad o al doble, la conclusión es
// de la pendiente y no de los datos.
const SENSITIVITY_FACTORS = [0.5, 1, 1.5];

const round = (v, d = 0) => {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Periodo al que pertenece una fecha ISO.
 * 'month' → un punto por mes; 'block' → bimestres (ene-feb, mar-abr…), para
 * cuando hay pocas sesiones al mes y el mensual sale todo error estándar.
 */
export const periodOf = (dateIso, granularity = 'month') => {
  const y = String(dateIso).slice(0, 4);
  const m = Number(String(dateIso).slice(5, 7));
  if (!y || !(m >= 1 && m <= 12)) return null;
  if (granularity === 'block') {
    const first = m % 2 === 1 ? m : m - 1; // bimestres anclados a enero
    return {
      key: `${y}-B${String(first).padStart(2, '0')}`,
      label: `${MONTHS_ES[first - 1]}-${MONTHS_ES[first]} ${y}`,
      sort: `${y}-${String(first).padStart(2, '0')}`,
    };
  }
  return {
    key: `${y}-${String(m).padStart(2, '0')}`,
    label: `${MONTHS_ES[m - 1]} ${y}`,
    sort: `${y}-${String(m).padStart(2, '0')}`,
  };
};

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

// ── Ventana de una sesión ────────────────────────────────────────────────────

const effortOf = (bin, axis) => (axis === 'power' ? bin.w : bin.gap);
const effortCvOf = (bin, axis) => (axis === 'power' ? bin.w_cv : bin.gap_cv);

/**
 * Colapsa los bloques de `hr_effort` que caen dentro de la ventana en un solo par
 * (esfuerzo, FC) por sesión, ponderando por el tiempo útil de cada bloque.
 *
 * El CV que devuelve es el de la VENTANA ENTERA, no el medio de los bloques: suma
 * la varianza de dentro de cada bloque y la que hay ENTRE bloques (ley de varianza
 * total). Sin el segundo término, una sesión que va acelerando bloque a bloque
 * —cada uno estable por dentro— pasaría el filtro de estabilidad.
 *
 * Devuelve null con `reason` cuando la sesión no es utilizable.
 */
export const sessionWindow = (activity, {
  axis = 'gap',
  window_min = DEFAULT_WINDOW_MIN,
  min_window_s = MIN_WINDOW_S,
} = {}) => {
  const he = activity?.hr_effort;
  if (!hasHrEffort(he)) return { ok: false, reason: he?.reason || 'sin-perfil' };

  const [w0, w1] = [window_min[0] * 60, window_min[1] * 60];
  // Un bloque entra si cabe ENTERO en la ventana: medio bloque asomando por el
  // borde metería dentro justo la fase que la ventana quería dejar fuera.
  const inWindow = he.bins.filter((b) => b.t0 >= w0 && b.t0 + BIN_S <= w1);
  const usable = inWindow.filter((b) => b.s > 0 && b.hr > 0 && effortOf(b, axis) > 0);
  if (!usable.length) {
    return { ok: false, reason: axis === 'power' && inWindow.length ? 'sin-potencia' : 'sin-ventana' };
  }

  const w = usable.reduce((a, b) => a + b.s, 0);
  if (w < min_window_s) return { ok: false, reason: 'ventana-corta', seconds: w };

  const hr = usable.reduce((a, b) => a + b.hr * b.s, 0) / w;
  const eff = usable.reduce((a, b) => a + effortOf(b, axis) * b.s, 0) / w;

  // Ley de varianza total: E[σ²_dentro] + Var(μ_entre).
  const within = usable.reduce((a, b) => {
    const cv = effortCvOf(b, axis) || 0;
    const sd = cv * effortOf(b, axis);
    return a + sd * sd * b.s;
  }, 0) / w;
  const between = usable.reduce((a, b) => {
    const d = effortOf(b, axis) - eff;
    return a + d * d * b.s;
  }, 0) / w;
  const cv = eff > 0 ? Math.sqrt(Math.max(0, within + between)) / eff : null;

  // Deriva dentro de la ventana, solo informativa: si la FC del último tercio se
  // dispara respecto al primero con el mismo esfuerzo, esa sesión llevaba calor o
  // fatiga y su punto está alto por una razón que no es la forma.
  const third = Math.max(1, Math.floor(usable.length / 3));
  const head = usable.slice(0, third);
  const tail = usable.slice(-third);
  const drift = usable.length >= 3
    ? mean(tail.map((b) => b.hr)) - mean(head.map((b) => b.hr))
    : null;

  return {
    ok: true,
    hr,
    effort: eff,
    effort_cv: cv,
    seconds: w,
    bins: usable.length,
    drift_bpm: drift,
    grade_abs: usable.reduce((a, b) => a + (b.grade_abs || 0) * b.s, 0) / w,
  };
};

// ── Mínimos cuadrados con errores estándar ───────────────────────────────────

/** Inversa por Gauss-Jordan con pivoteo parcial. p es pequeño (≤ ~30). */
const invert = (A) => {
  const p = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-10) return null; // columnas colineales: modelo mal planteado
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * p; j++) M[c][j] /= d;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * p; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row.slice(p));
};

/**
 * OLS por ecuaciones normales. Devuelve los coeficientes, la (X'X)⁻¹ —necesaria
 * para el error estándar de CUALQUIER combinación lineal, que es justo lo que es
 * "la FC del periodo p a esfuerzo de referencia"— y la varianza residual.
 */
export const fitOls = (X, y) => {
  const n = X.length;
  const p = X[0]?.length || 0;
  if (!n || !p || n <= p) return null;
  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      xty[a] += X[i][a] * y[i];
      for (let b = a; b < p; b++) xtx[a][b] += X[i][a] * X[i][b];
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];

  const inv = invert(xtx);
  if (!inv) return null;
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));

  let rss = 0;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  let tss = 0;
  for (let i = 0; i < n; i++) {
    const fit = X[i].reduce((s, v, j) => s + v * beta[j], 0);
    rss += (y[i] - fit) ** 2;
    tss += (y[i] - ybar) ** 2;
  }
  const df = n - p;
  return { beta, inv, sigma2: rss / df, df, n, p, r2: tss > 0 ? 1 - rss / tss : null };
};

/** Error estándar de la combinación lineal c'β. */
const seOf = (fit, c) => {
  let q = 0;
  for (let a = 0; a < c.length; a++) {
    if (c[a] === 0) continue;
    for (let b = 0; b < c.length; b++) {
      if (c[b] === 0) continue;
      q += c[a] * fit.inv[a][b] * c[b];
    }
  }
  return q > 0 ? Math.sqrt(fit.sigma2 * q) : 0;
};

// ── Modelo completo ──────────────────────────────────────────────────────────

const AXIS_UNITS = { gap: 'm/s (GAP)', power: 'W' };

/**
 * FC a esfuerzo fijo por periodo.
 *
 * `activities` son actividades de Strava con `hr_effort` ya cacheado. Lo que esta
 * función NO sabe resolver por sí misma se pasa por accesores, porque el origen de
 * FC y el WBGT viven en sitios distintos en el servidor y en el front:
 *   · `hrSourceOf(a)` → 'strap' | 'wrist' | 'unknown'
 *   · `wbgtOf(a)`     → °C WBGT o null
 *
 * Opciones: axis, from, to, granularity, ref_effort, window_min, max_cv,
 * min_sessions, hr_source (por defecto 'strap'), include_races, use_wbgt.
 */
export const hrAtFixedEffort = (activities, {
  axis = 'gap',
  from,
  to,
  granularity = 'month',
  ref_effort,
  window_min = DEFAULT_WINDOW_MIN,
  max_cv = DEFAULT_MAX_CV,
  min_sessions = DEFAULT_MIN_SESSIONS,
  hr_source = 'strap',
  include_races = false,
  use_wbgt = true,
  hrSourceOf = (a) => a?._hr?.hr_source ?? a?.hr_source ?? 'unknown',
  wbgtOf = (a) => a?._wbgt ?? null,
} = {}) => {
  // Un "no se puede" viaja con TRES cosas: el código (para que la UI lo traduzca),
  // el texto (para el MCP, que no tiene diccionario) y las sesiones descartadas CON
  // SU MOTIVO. Lo tercero es lo que importa: cuando no sale un modelo, lo que hay
  // que responder no es "no hay datos" sino "faltan 340 por enriquecer" o "todas
  // eran de muñeca".
  const empty = (code, error, dropped = []) => ({
    axis, unit: AXIS_UNITS[axis], error_code: code, error,
    periods: [], included: [], excluded: dropped,
  });
  if (!Array.isArray(activities)) return empty('no-activities', 'Sin actividades.');

  // ── Paso 1: un punto por sesión, apuntando el motivo de cada descarte ──────
  const rows = [];
  const excluded = [];
  const drop = (a, reason, extra) => excluded.push({
    id: a.id, date: a.start_date, name: a.name, reason, ...extra,
  });

  for (const a of activities) {
    const day = String(a.start_date_local || a.start_date || '').slice(0, 10);
    if (!day) continue;
    if (from && day < from) continue;
    if (to && day > to) continue;
    if (!a.hr_effort) { drop(a, 'sin-enriquecer'); continue; }
    // Las COMPETICIONES no son sesiones equivalentes: van a tope, con la FC pegada
    // al máximo y una relación FC-esfuerzo que se aplana arriba.
    if (!include_races && a.workout_type === 1) { drop(a, 'carrera'); continue; }
    // El origen de FC es determinante: banda y muñeca no miden lo mismo, y un
    // cambio de sensor entre periodos se leería como un cambio de forma.
    const src = hrSourceOf(a);
    if (hr_source && src !== hr_source) { drop(a, 'origen-fc', { hr_source: src }); continue; }

    const win = sessionWindow(a, { axis, window_min });
    if (!win.ok) { drop(a, win.reason); continue; }
    if (max_cv != null && win.effort_cv != null && win.effort_cv > max_cv) {
      drop(a, 'esfuerzo-inestable', { effort_cv: round(win.effort_cv, 3) });
      continue;
    }
    const period = periodOf(day, granularity);
    if (!period) { drop(a, 'fecha-invalida'); continue; }
    rows.push({
      id: a.id,
      date: a.start_date,
      name: a.name,
      period: period.key,
      period_label: period.label,
      period_sort: period.sort,
      hr: win.hr,
      effort: win.effort,
      effort_cv: win.effort_cv,
      minutes: win.seconds / 60,
      drift_bpm: win.drift_bpm,
      grade_abs: win.grade_abs,
      wbgt: wbgtOf(a),
    });
  }
  if (rows.length < 4) {
    return empty('few-sessions', 'Hacen falta al menos 4 sesiones utilizables.', excluded);
  }

  // ── Paso 2: periodos con muy pocas sesiones fuera ──────────────────────────
  const byPeriod = new Map();
  for (const r of rows) {
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
    byPeriod.get(r.period).push(r);
  }
  const thin = new Set([...byPeriod.entries()].filter(([, v]) => v.length < min_sessions).map(([k]) => k));
  for (const r of rows) {
    if (thin.has(r.period)) {
      excluded.push({ id: r.id, date: r.date, name: r.name, reason: 'periodo-con-pocas-sesiones' });
    }
  }
  const used = rows.filter((r) => !thin.has(r.period));
  const periods = [...new Set(used.map((r) => r.period))]
    .sort((a, b) => {
      const pa = used.find((r) => r.period === a).period_sort;
      const pb = used.find((r) => r.period === b).period_sort;
      return pa.localeCompare(pb);
    });
  if (!used.length || !periods.length) {
    return empty('no-periods', 'Ningún periodo reúne suficientes sesiones.', excluded);
  }

  // ── Paso 3: esfuerzo de referencia ────────────────────────────────────────
  // Por defecto la MEDIANA del propio atleta en el rango: leer la recta lejos de
  // la nube de datos infla el error estándar y extrapola el modelo.
  const ref = ref_effort ?? median(used.map((r) => r.effort));

  // ── Paso 4: diseño ────────────────────────────────────────────────────────
  // El esfuerzo va CENTRADO en la referencia: así el término de la pendiente vale
  // cero en el punto de lectura y la FC a esfuerzo fijo del periodo p es b0 + d_p,
  // con su SE saliendo directo de (X'X)⁻¹ sin propagar la incertidumbre de b1.
  // El WBGT va centrado en su media por lo mismo: se lee a calor medio.
  const wbgtRows = used.filter((r) => typeof r.wbgt === 'number');
  const withWbgt = use_wbgt && wbgtRows.length >= used.length * 0.8 && used.length > periods.length + 3;
  const wbgtMean = withWbgt ? mean(wbgtRows.map((r) => r.wbgt)) : null;

  const dummies = periods.slice(1);
  const design = (heat) => (r) => {
    const x = [1, r.effort - ref];
    if (heat) x.push((r.wbgt ?? wbgtMean) - wbgtMean);
    for (const p of dummies) x.push(r.period === p ? 1 : 0);
    return x;
  };
  const y = used.map((r) => r.hr);
  // Si el WBGT no varía DENTRO de los periodos, su columna es una combinación de
  // las dummies y el sistema es singular: el calor y el periodo serían la misma
  // variable y no hay forma de repartirles el efecto. Se reintenta sin él en vez
  // de devolver un error, porque el modelo sin calor sigue siendo informativo (y
  // `wbgt_adjusted: false` avisa de que la comparación no está corregida).
  let heat = withWbgt;
  let fit = fitOls(used.map(design(heat)), y);
  if (!fit && heat) { heat = false; fit = fitOls(used.map(design(heat)), y); }
  if (!fit) return empty('singular', 'No hay variación suficiente para ajustar el modelo.', excluded);

  const slope = fit.beta[1];
  const slopeSe = seOf(fit, fit.beta.map((_, i) => (i === 1 ? 1 : 0)));

  // ── Paso 5: lectura por periodo + sensibilidad a la pendiente ─────────────
  // La sensibilidad NO es adorno: con esfuerzos medios distintos entre periodos, la
  // pendiente es lo que traduce esa diferencia a FC. Si al moverla la conclusión
  // cambia, la conclusión es del modelo y no de los datos.
  // Las claves son el FACTOR ('x0.5', 'x1', 'x1.5'), no el valor de la pendiente:
  // una columna titulada "41.9564" no le dice nada a nadie, y el valor concreto ya
  // viaja en `sensitivity_slopes`.
  const slopes = Object.fromEntries(SENSITIVITY_FACTORS.map((f) => [`x${f}`, slope * f]));
  const atSlope = (rowsP, s) => mean(rowsP.map((r) => r.hr - s * (r.effort - ref)));
  const out = periods.map((p, i) => {
    const rowsP = used.filter((r) => r.period === p);
    const c = new Array(fit.p).fill(0);
    c[0] = 1;
    if (i > 0) c[2 + (heat ? 1 : 0) + (i - 1)] = 1;
    const hrAtRef = fit.beta.reduce((s, b, j) => s + b * c[j], 0);
    const sensitivity = Object.fromEntries(
      Object.entries(slopes).map(([k, s]) => [k, round(atSlope(rowsP, s), 1)]),
    );
    return {
      period: p,
      label: rowsP[0].period_label,
      n: rowsP.length,
      hr_at_ref: round(hrAtRef, 1),
      se: round(seOf(fit, c), 2),
      hr_mean: round(mean(rowsP.map((r) => r.hr)), 1),
      effort_mean: round(mean(rowsP.map((r) => r.effort)), axis === 'power' ? 1 : 3),
      wbgt_mean: round(mean(rowsP.filter((r) => typeof r.wbgt === 'number').map((r) => r.wbgt)), 1),
      drift_mean: round(mean(rowsP.filter((r) => r.drift_bpm != null).map((r) => r.drift_bpm)), 1),
      sensitivity,
    };
  });

  // El cambio entre extremos se calcula con los valores SIN redondear: hacerlo sobre
  // los publicados (una décima cada uno) metía dos décimas de error en la cifra que
  // más se mira.
  const exact = periods.map((p, i) => {
    const c = new Array(fit.p).fill(0);
    c[0] = 1;
    if (i > 0) c[2 + (heat ? 1 : 0) + (i - 1)] = 1;
    return fit.beta.reduce((s, b, j) => s + b * c[j], 0);
  });
  // ¿La CONCLUSIÓN depende de la pendiente? Cuando los periodos se corrieron a
  // esfuerzos distintos, la pendiente es lo que traduce esa diferencia a FC, y con
  // pocas sesiones se estima mal. Si al moverla a la mitad o al doble el cambio
  // cambia de SIGNO, el "he mejorado" es del modelo y no de los datos: hay que
  // decirlo donde se lee la cifra, no enterrarlo en una columna.
  const firstRows = used.filter((r) => r.period === periods[0]);
  const lastRows = used.filter((r) => r.period === periods[periods.length - 1]);
  const change_sensitivity = periods.length > 1
    ? Object.fromEntries(Object.entries(slopes).map(([k, s]) => [
      k, round(atSlope(lastRows, s) - atSlope(firstRows, s), 1),
    ]))
    : {};
  const changes = Object.values(change_sensitivity);
  const change_robust = changes.length > 1
    ? changes.every((v) => v > 0) || changes.every((v) => v < 0)
    : null;

  // Traducción de la pendiente a algo legible en el eje GAP: cuánta FC cuesta
  // apretar 10 s/km desde la referencia. "41,9 ppm por m/s" no lo interpreta nadie.
  const slopePer10s = axis === 'gap' && ref > 0
    ? slope * (ref - 1000 / (1000 / ref + 10))
    : null;

  return {
    axis,
    unit: AXIS_UNITS[axis],
    ref_effort: round(ref, axis === 'power' ? 1 : 3),
    ref_pace_per_km: axis === 'gap' ? paceFromSpeed(ref) : null,
    granularity,
    window_min,
    max_cv,
    hr_source,
    wbgt_adjusted: heat,
    wbgt_ref_c: heat ? round(wbgtMean, 1) : null,
    // La pendiente es el propio modelo: una pendiente negativa (más esfuerzo, menos
    // FC) significa que el diseño no se sostiene con estos datos y que no hay que
    // leer los periodos sin mirar antes la sensibilidad.
    slope_bpm_per_unit: round(slope, 3),
    slope_se: round(slopeSe, 3),
    slope_ok: slope > 0,
    slope_bpm_per_10s_per_km: round(slopePer10s, 2),
    sensitivity_slopes: Object.fromEntries(
      Object.entries(slopes).map(([k, v]) => [k, round(v, 3)]),
    ),
    r2: round(fit.r2, 3),
    residual_sd_bpm: round(Math.sqrt(fit.sigma2), 2),
    n_sessions: used.length,
    periods: out,
    change_bpm: exact.length > 1 ? round(exact[exact.length - 1] - exact[0], 1) : null,
    // El mismo cambio leído con la pendiente a la mitad y al doble, y si los tres
    // coinciden en signo. `change_robust: false` = no concluyas nada del cambio.
    change_sensitivity,
    change_robust,
    included: used.map((r) => ({
      id: r.id,
      date: r.date,
      name: r.name,
      period: r.period,
      hr: round(r.hr, 1),
      effort: round(r.effort, axis === 'power' ? 1 : 3),
      effort_cv: round(r.effort_cv, 3),
      minutes: round(r.minutes, 1),
      drift_bpm: round(r.drift_bpm, 1),
      wbgt_c: round(r.wbgt, 1),
    })),
    excluded,
  };
};

/** mm:ss por km desde una velocidad en m/s (para mostrar el GAP como ritmo). */
export const paceFromSpeed = (ms) => {
  if (!(ms > 0)) return null;
  const s = 1000 / ms;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
};
