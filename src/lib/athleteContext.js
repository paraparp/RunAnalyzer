import { computeLactateModel, formatPace, LT1_HRR_PCT, LT2_HRR_PCT } from './lactateThreshold';
import { detectMaxHR, detectRestHR, detectLTHR, estimateLTHR } from './hrZones';

// ── Scientific helpers ───────────────────────────────────────────────────────
const mean = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// M:SS desde min/km decimal, redondeando sobre segundos TOTALES: el patrón
// `Math.round((p % 1) * 60)` produce "5:60" cuando los decimales rozan el minuto.
const fmtMinKm = (minPerKm) => {
  const t = Math.round(minPerKm * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Per-session training load (TRIMP proxy). Prefers Strava's suffer_score
 * (Banister-derived), then a HR-weighted minutes model, then distance.
 * Mirrors FitnessFatigue.jsx so the whole app shares one load definition.
 */
function estimateLoad(a) {
  const mins = (a.moving_time || 0) / 60;
  if (a.suffer_score) return a.suffer_score;
  if (a.average_heartrate) return mins * (a.average_heartrate / 180) * 1.92;
  if (a.distance) return (a.distance / 1000) * 0.8;
  return mins * 0.4;
}

/**
 * Banister / Coggan Performance Management Chart (TrainingPeaks standard).
 * CTL = 42-day EWMA (Fitness), ATL = 7-day EWMA (Fatigue),
 * TSB = CTL − ATL (Form), ACWR = ATL/CTL (acute:chronic, Gabbett injury model),
 * ramp = CTL change per week. Uses ALL sports (cardiovascular load is global).
 */
function computePMC(activities) {
  if (!activities?.length) return null;
  const daily = {};
  let minTs = Infinity;
  for (const a of activities) {
    const ds = a.start_date?.slice(0, 10);
    if (!ds) continue;
    const ts = new Date(ds).getTime();
    if (ts < minTs) minTs = ts;
    daily[ds] = (daily[ds] || 0) + estimateLoad(a);
  }
  if (minTs === Infinity) return null;

  const kC = Math.exp(-1 / 42), kA = Math.exp(-1 / 7);
  let ctl = 0, atl = 0, peak = 0;
  const ctlSeries = [];
  for (let ts = minTs; ts <= Date.now(); ts += 86400000) {
    const ds = new Date(ts).toISOString().slice(0, 10);
    const load = daily[ds] || 0;
    ctl = ctl * kC + load * (1 - kC);
    atl = atl * kA + load * (1 - kA);
    if (ctl > peak) peak = ctl;
    ctlSeries.push(ctl);
  }
  const n = ctlSeries.length;
  const ctl28 = n > 28 ? ctlSeries[n - 29] : 0;
  const ctl7 = n > 7 ? ctlSeries[n - 8] : 0;
  const ramp = n > 28 ? (ctl - ctl28) / 4 : (ctl - ctl7);
  return {
    ctl: Math.round(ctl),
    atl: Math.round(atl),
    tsb: Math.round(ctl - atl),
    acwr: ctl > 0 ? +(atl / ctl).toFixed(2) : null,
    ramp: Math.round(ramp * 10) / 10,
    peak: Math.round(peak),
    pctPeak: peak > 0 ? Math.round((ctl / peak) * 100) : 0,
  };
}

/**
 * HRV (rMSSD) analysis vs the athlete's PERSONAL baseline range.
 * Following Plews/Buchheit HRV-guided training: a single night means little,
 * what matters is position vs your own balanced range + the 7-day trend + the
 * coefficient of variation (rising CV = poor adaptation / accumulating fatigue).
 */
function analyzeHRV(garmin, now) {
  if (!garmin?.length) return null;
  const sorted = [...garmin].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted.find(d => d.hrv);
  if (!latest) return null;
  const w7 = new Date(now); w7.setDate(now.getDate() - 7);
  const w14 = new Date(now); w14.setDate(now.getDate() - 14);
  const w28 = new Date(now); w28.setDate(now.getDate() - 28);
  const vals7 = sorted.filter(d => new Date(d.date) >= w7 && d.hrv).map(d => d.hrv);
  const hrv7 = mean(vals7);
  const hrv28 = mean(sorted.filter(d => new Date(d.date) >= w28 && d.hrv).map(d => d.hrv));
  const prev7 = mean(sorted.filter(d => { const x = new Date(d.date); return x >= w14 && x < w7 && d.hrv; }).map(d => d.hrv));
  let cv = null;
  if (vals7.length >= 3 && hrv7) {
    const sd = Math.sqrt(mean(vals7.map(v => (v - hrv7) ** 2)));
    cv = +(sd / hrv7 * 100).toFixed(1);
  }
  return { latest: latest.hrv, status: latest.hrvStatus, baseline: latest.baseline, hrv7, hrv28, prev7, cv };
}

/**
 * Composite recovery readiness 0–100 (deterministic, NOT LLM-generated).
 * Evidence-weighted blend: HRV-vs-baseline 30% · Body Battery 20% · sleep 20%
 * · resting-HR trend 15% · TSB/form 15%. This is the number the athlete can
 * trust blindly; the LLM is told to align its prescription to it.
 */
function computeReadiness({ hrv, rhr, bb, sleep, pmc }) {
  const parts = [];
  if (hrv) {
    let s = 70;
    const b = hrv.baseline;
    if (b?.balancedLow && b?.balancedUpper) {
      if (hrv.latest >= b.balancedUpper) s = 95;
      else if (hrv.latest >= b.balancedLow) s = 70 + (hrv.latest - b.balancedLow) / (b.balancedUpper - b.balancedLow) * 20;
      else s = clamp(70 * (hrv.latest / b.balancedLow), 20, 70);
    } else if (hrv.status) {
      const map = { BALANCED: 82, LOW: 38, UNBALANCED: 45, POOR: 30, GOOD: 88 };
      s = map[hrv.status] ?? 70;
    }
    parts.push([clamp(s, 10, 100), 0.30]);
  }
  if (bb?.high != null) parts.push([clamp(bb.high, 5, 100), 0.20]);
  if (sleep?.score != null) parts.push([clamp(sleep.score, 20, 100), 0.20]);
  if (rhr?.r7 && rhr?.r28) {
    const delta = (rhr.r7 - rhr.r28) / rhr.r28;      // >0 = elevated = worse
    parts.push([clamp(78 - delta * 100 * 3.5, 15, 100), 0.15]);
  }
  if (pmc) parts.push([clamp(62 + pmc.tsb * 1.1, 15, 100), 0.15]);
  if (!parts.length) return null;
  const wsum = parts.reduce((s, [, w]) => s + w, 0);
  const score = Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / wsum);
  let label, band;
  if (score >= 80) { label = 'Óptimo · listo para calidad'; band = 'high'; }
  else if (score >= 62) { label = 'Bueno · entreno normal'; band = 'good'; }
  else if (score >= 45) { label = 'Moderado · precaución, baja carga'; band = 'mod'; }
  else { label = 'Bajo · prioriza recuperación'; band = 'low'; }
  return { score, label, band };
}

/**
 * Fallback plano: listado simple de las actividades de los últimos 3 meses.
 * Solo se usa si buildPrompt falla (contexto científico no disponible); lo
 * comparten el planificador y el predictor para no duplicar formatos.
 */
export const buildPlainActivityLog = (activities) => {
  if (!activities?.length) return '';
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  return activities
    .filter(a => new Date(a.start_date) >= cutoff)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
    .map(a => {
      const km = (a.distance / 1000).toFixed(2);
      const min = ((a.moving_time || 0) / 60).toFixed(1);
      // Ritmo en M:SS/km — el formato decimal (5.32) se presta a leerse como 5:32.
      const pace = a.distance > 0 && a.moving_time > 0
        ? (() => {
            // Redondeo sobre los segundos totales para no producir "4:60".
            const total = Math.round(a.moving_time / (a.distance / 1000));
            return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} min/km`;
          })()
        : 'ritmo n/d';
      const date = new Date(a.start_date).toLocaleDateString('es-ES');
      const hr = a.average_heartrate ? `FC media: ${Math.round(a.average_heartrate)}ppm` : 'sin FC';
      return `- ${date}: ${km}km en ${min}min (${pace}). ${hr}. Desnivel: +${Math.round(a.total_elevation_gain || 0)}m.`;
    })
    .join('\n');
};

// ── Prompt builder ───────────────────────────────────────────────────────────
export const buildPrompt = (activities, garminData, sleepData, weeklyTarget, goal) => {
  const now = new Date();
  const yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const twoMonthsAgo = new Date(now); twoMonthsAgo.setMonth(now.getMonth() - 2);
  const week4 = new Date(now); week4.setDate(now.getDate() - 28);
  const week8 = new Date(now); week8.setDate(now.getDate() - 56);

  const yearActs = activities.filter(a => new Date(a.start_date) >= yearAgo);
  if (!yearActs.length) return null;

  const isRunning = (a) => ['Run', 'TrailRun', 'VirtualRun'].includes(a.type);
  const isCycling = (a) => ['Ride', 'VirtualRide'].includes(a.type);
  const isSwimming = (a) => ['Swim'].includes(a.type);

  const runningYearActs = yearActs.filter(isRunning);

  // ── Personal bests per canonical distance (ALL-TIME ceiling) ───────────────
  // The athlete's "tope": fastest valid effort per distance. Gives the model a
  // realistic performance ceiling to calibrate target paces and 4-6w goals.
  const PB_RANGES = [
    { id: '5K', min: 4900, max: 5200 },
    { id: '10K', min: 9900, max: 10500 },
    { id: 'Media maratón', min: 21000, max: 21500 },
    { id: 'Maratón', min: 42000, max: 43000 },
  ];
  const fmtPbTime = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${x.toString().padStart(2, '0')}` : `${m}:${x.toString().padStart(2, '0')}`;
  };
  const pbLines = PB_RANGES.map(r => {
    const best = activities
      .filter(a => isRunning(a) && a.distance >= r.min && a.distance <= r.max && (a.elapsed_time || a.moving_time) > 0)
      .sort((a, b) => (a.elapsed_time || a.moving_time) / a.distance - (b.elapsed_time || b.moving_time) / b.distance)[0];
    if (!best) return null;
    const t = best.elapsed_time || best.moving_time;
    const pace = t / (best.distance / 1000);
    const pm = Math.floor(pace / 60), ps = Math.round(pace % 60).toString().padStart(2, '0');
    return `${r.id}: ${fmtPbTime(t)} @${pm}:${ps}/km (${new Date(best.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })})`;
  }).filter(Boolean);
  const pbSection = pbLines.length ? pbLines.join('\n') : null;

  // ── Weekly training availability/intent (athlete-selected) ─────────────────
  const dispoLine = weeklyTarget
    ? `DISPONIBILIDAD / OBJETIVO: quieres entrenar ${weeklyTarget} sesión(es) de CARRERA por semana. Ajusta el volumen semanal de la tendencia/objetivo y la cadencia de sesiones a esa frecuencia: no propongas más carreras de las que puedes asumir, y reparte calidad vs. fácil respetando el 80/20 DENTRO de ese número de sesiones.`
    : '';

  // ── Race goal (athlete-selected target distance + optional pace + date) ────
  const GOAL_KM = { '5K': 5, '10K': 10, '21K': 21.0975, '42K': 42.195 };
  let goalLine = '';
  if (goal?.distance && GOAL_KM[goal.distance]) {
    const km = GOAL_KM[goal.distance];
    let extra;
    if (goal.pace && /^\d{1,2}:\d{2}$/.test(goal.pace.trim())) {
      const [pm, ps] = goal.pace.trim().split(':').map(Number);
      const finish = fmtPbTime(Math.round((pm * 60 + ps) * km));
      extra = ` con RITMO OBJETIVO ${goal.pace.trim()}/km (tiempo meta ≈ ${finish})`;
    } else {
      extra = ' (sin ritmo objetivo fijado: propón uno realista según mis marcas personales y mi forma actual)';
    }
    // Time-to-race: drives the periodization horizon (base → build → taper).
    let when = '';
    if (goal.date) {
      const raceTs = new Date(goal.date + 'T00:00:00');
      if (!isNaN(raceTs)) {
        const days = Math.round((raceTs - new Date(now.toDateString())) / 86400000);
        const dateStr = raceTs.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        if (days < 0) when = ` La fecha objetivo (${dateStr}) YA PASÓ: pide al atleta fijar una nueva o trátalo como mantenimiento.`;
        else {
          const weeks = (days / 7).toFixed(1);
          const phase = days <= 10 ? 'TAPER/afinamiento (baja volumen, mantén intensidad específica)'
            : days <= 28 ? 'fase específica/pico (trabajo a ritmo objetivo)'
            : days <= 56 ? 'fase de construcción (sube carga y mete calidad)'
            : 'fase de base aeróbica (construye volumen, poca intensidad)';
          when = ` Fecha: ${dateStr} → faltan ${days} días (${weeks} semanas). Periodiza en consecuencia: ahora estás en ${phase}. Ajusta la rampa de CTL para llegar en forma y descansado (TSB positivo el día de la carrera) sin superar +5 CTL/sem.`;
        }
      }
    }
    goalLine = `OBJETIVO DE CARRERA: estás preparando un ${goal.distance}${extra}.${when} Orienta la rampa de carga (tendencia) y las sesiones de calidad/ritmo (próximo entrenamiento) HACIA este objetivo: deriva los ritmos de tempo/intervalos del ritmo objetivo y de tus marcas. En la tendencia indica explícitamente si el objetivo es realista, ambicioso o conservador dado tu tope (marcas personales), tu CTL/forma actuales y el tiempo disponible, y qué falta para alcanzarlo.`;
  }

  // ── Banister PMC over ALL sports (cardiovascular load is global) ───────────
  const pmc = computePMC(activities.filter(a => new Date(a.start_date) >= yearAgo));

  // ── Weekly breakdown (4 weeks) ────────────────────────────────────────────
  const byWeek = [0, 1, 2, 3].map(w => {
    const wStart = new Date(now); wStart.setDate(now.getDate() - (w + 1) * 7);
    const wEnd = new Date(now); wEnd.setDate(now.getDate() - w * 7);
    const runs = runningYearActs.filter(a => { const d = new Date(a.start_date); return d >= wStart && d < wEnd; });
    return {
      week: w === 0 ? 'Sem actual' : `Sem -${w}`,
      km: runs.reduce((s, a) => s + a.distance / 1000, 0).toFixed(0),
      sessions: runs.length,
    };
  }).reverse();

  // ── Monthly volume (last 2 months for current fitness) ────────────────────
  const twoMonthActs = runningYearActs.filter(a => new Date(a.start_date) >= twoMonthsAgo);
  const byM = {};
  for (const a of twoMonthActs) {
    const k = a.start_date.slice(0, 7);
    if (!byM[k]) byM[k] = { km: 0, n: 0 };
    byM[k].km += a.distance / 1000; byM[k].n++;
  }
  const monthHistory = Object.entries(byM)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, s]) => `${m.slice(5)}:${s.km.toFixed(0)}km/${s.n}s`)
    .join(' ');

  // ── Recent running volume (4w vs prior 4w) ────────────────────────────────
  const recentRuns = runningYearActs.filter(a => new Date(a.start_date) >= week4);
  const prevRuns = runningYearActs.filter(a => { const d = new Date(a.start_date); return d >= week8 && d < week4; });
  const recentKm = recentRuns.reduce((s, a) => s + a.distance / 1000, 0);
  const prevKm = prevRuns.reduce((s, a) => s + a.distance / 1000, 0);
  const loadDelta = prevKm > 0 ? ((recentKm - prevKm) / prevKm * 100).toFixed(0) : null;

  const recentMin = recentRuns.reduce((s, a) => s + (a.moving_time || 0) / 60, 0);
  const avgPace = recentKm > 0 ? fmtMinKm(recentMin / recentKm) : null;
  const withHR = recentRuns.filter(a => a.average_heartrate);
  const avgHR = withHR.length ? Math.round(withHR.reduce((s, a) => s + a.average_heartrate, 0) / withHR.length) : null;

  // ── FCmax / FC reposo / LTHR — heurísticas centralizadas en src/lib/hrZones
  // (mismas funciones que la pestaña de Zonas: un solo criterio en toda la app) ─
  const fcmax   = detectMaxHR(activities).value;
  const restDet = detectRestHR(garminData);
  const fcRest  = restDet.value;

  // LTHR sobre los últimos 2 meses (estado de forma actual). minFieldRuns=2:
  // para el prompt del coach aceptamos algo menos de evidencia que en la UI.
  const ltDet = detectLTHR(twoMonthActs, fcmax, { minFieldRuns: 2 });
  const lthr = ltDet.lthr ?? estimateLTHR(fcmax);
  const lthrMethod = {
    field:   `campo (${ltDet.n} esfuerzos umbral detectados)`,
    race:    `competición (p75 de ${ltDet.n} carrera(s) × 0.97)`,
    formula: 'Friel approx (87.5% FCmax)',
    none:    'Friel approx (87.5% FCmax)',
  }[ltDet.method];
  const lthrIsEstimate = ltDet.method !== 'field';

  // ── Lactate-threshold model (LT1/LT2) — fuente centralizada (src/lib/lactateThreshold) ─
  // El modelo de Critical Speed da el LT2 anclado a RENDIMIENTO (ritmo), y el
  // cross-check de FC da los ritmos LT1/LT2 mensuales. Lo reutilizamos aquí para
  // que el coach IA y la pestaña de Umbral de Lactato hablen el MISMO idioma.
  // LTHR (FC umbral, LT2) sigue siendo el detectado de campo arriba. El LT1 en FC
  // prioriza la MEDICIÓN por decoupling FC–ritmo (lt.lt1HrMethod==='decoupling');
  // si no hay señal suficiente, se deriva de LT2 vía %FCR (Karvonen):
  // LT1 = FCreposo + (65/85)·(LTHR − FCreposo). Fallback a ratio %FCmax sin reposo.
  const lt = computeLactateModel(activities, 12, { hrrest: fcRest });
  const lt1Measured = lt?.lt1HrMethod === 'decoupling' && lt.lt1Hr;
  const lt1Hr = lt1Measured
    ? lt.lt1Hr
    : (fcRest && lthr > fcRest
        ? Math.round(fcRest + (LT1_HRR_PCT / LT2_HRR_PCT) * (lthr - fcRest))
        : Math.round(lthr * (0.75 / 0.875)));
  const lt1Method = lt1Measured
    ? `decoupling FC–ritmo, ${lt.decoupling.n} rodajes, R²=${lt.decoupling.r2.toFixed(2)}`
    : 'derivado de LT2 (%FCR)';
  const lt2PaceStr = lt?.lt2Pace ? formatPace(lt.lt2Pace) : null;
  const lt1PaceStr = lt?.lt1Pace ? formatPace(lt.lt1Pace) : null;
  const ltTrend = lt?.trendDelta != null
    ? (lt.trendDelta > 5 ? 'mejorando' : lt.trendDelta < -5 ? 'empeorando' : 'estable')
    : null;

  // ── HR zones — UN SOLO sistema coherente, derivado de TUS LT1/LT2. Antes se
  // mezclaban Seiler + Karvonen, que daban topes contradictorios entre sí y con
  // la FC fácil real (Karvonen subestimaba). Ahora las zonas salen de los umbrales. ─
  const hrZonesSummary = [
    `FCmax=${fcmax}ppm (mediana top 5% histórico)`,
    `FC reposo=${fcRest}ppm (${restDet.source === 'garmin' ? 'Garmin más reciente' : 'valor por defecto, sin medición'})`,
    `LT1 (umbral aeróbico, TECHO del rodaje fácil)=${lt1Hr}ppm${lt1PaceStr ? ` · ritmo ≈${lt1PaceStr}/km` : ''} [método FC: ${lt1Method}]`,
    `LT2 (umbral de lactato/anaeróbico = LTHR)=${lthr}ppm${lt2PaceStr ? ` · ritmo ≈${lt2PaceStr}/km${lt?.csValid ? ' (Critical Speed ≈LT2, ligeramente ≥ MLSS)' : ' (cross-check FC)'}` : ''}${ltTrend ? ` · tendencia del RITMO umbral (serie mensual de ritmo sostenido a FC umbral; NO deriva del ppm estimado): ${ltTrend}` : ''} [método FC: ${lthrMethod}]${lthrIsEstimate ? ' (FC ESTIMADA por fórmula, sin umbral de campo detectado → límites de zona aproximados)' : ''}`,
    `ZONAS (derivadas de tus LT1/LT2 — sistema teórico de referencia; si un dato observado choca con él, manda la regla de PRECEDENCIA):`,
    `· Z1 fácil/base — aquí va el 80% del volumen: <${lt1Hr}ppm (por debajo de LT1)`,
    `· Z2 gris (entre umbrales; solo tempo suave o progresión): ${lt1Hr}-${lthr - 1}ppm`,
    `· Z3 umbral+/calidad (tempo, series, intervalos): ≥${lthr}ppm (desde LT2)`,
    avgHR ? `FC media real de rodaje fácil (4 sem) = ${avgHR}ppm (${Math.round(avgHR / fcmax * 100)}% FCmax): centro REAL de tu zona fácil. NO frenes los rodajes por debajo de esta FC observada (ya eran fáciles).` : null,
    // Precedencia explícita cuando el techo teórico (LT1) y la FC fácil observada
    // chocan: sin ella el modelo debe elegir a ciegas entre ambos anclajes.
    avgHR && avgHR >= lt1Hr
      ? `⚠ PRECEDENCIA: tu FC fácil observada (${avgHR}ppm) alcanza o supera el techo teórico LT1 (${lt1Hr}ppm). MANDA LA OBSERVADA: usa ${avgHR - 4}-${avgHR + 6}ppm (= FC fácil observada ${avgHR}ppm −4/+6) como banda fáctica de rodaje fácil; LT1 es orientativo${lt1Measured ? '' : ' (estimado por fórmula, no medido)'}. A efectos del 80/20, esta banda CUENTA como volumen fácil/Z1: NO la señales como "zona gris".`
      : avgHR ? `Techo del rodaje fácil: LT1 (${lt1Hr}ppm), coherente con tu FC fácil observada (${avgHR}ppm).` : null,
  ].filter(Boolean).join('\n');

  // Ancla del ritmo de rodaje FÁCIL: media de las carreras recientes hechas bajo
  // umbral (FC media < LTHR). Evita que un ritmo medio lento (que mezcla todas las
  // carreras) empuje la prescripción de base a un ritmo MÁS lento que el ya fácil.
  let easyPaceSec = null;
  const easyRuns = recentRuns.filter(a => a.average_heartrate && a.average_heartrate < lthr && a.distance > 0 && a.moving_time);
  if (easyRuns.length) {
    const ekm = easyRuns.reduce((s, a) => s + a.distance / 1000, 0);
    const emin = easyRuns.reduce((s, a) => s + a.moving_time / 60, 0);
    if (ekm > 0) easyPaceSec = (emin * 60) / ekm;
  }

  // Ritmos de referencia (no inventar): los ritmos FÁCILES se anclan a tu ritmo
  // fácil real; los de CALIDAD (tempo/umbral/series) se anclan a tu LT2 y a tus
  // marcas, NO a "fácil − offset" (ese modelo se rompe si estás desentrenado y tu
  // ritmo fácil está lejísimos de tu umbral → prescribiría tempos absurdamente lentos).
  let paceRefs = 'No disponible (sin km/ritmo reciente suficiente).';
  if (avgPace) {
    const [m, s] = avgPace.split(':').map(Number);
    const pSec = m * 60 + s; // segundos por km del ritmo medio 4 sem
    const baseSec = easyPaceSec ?? pSec; // ancla fisiológica del rodaje fácil
    // Redondeo sobre segundos totales para no producir "5:60".
    const fmt = (sec) => {
      const t = Math.round(sec);
      return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    };
    // lt.lt2Pace viene en MIN/km decimal (paceFromSpeed) → a segundos. Guarda de
    // cordura: un umbral fuera de 2:00-8:00/km es dato corrupto, no se usa como ancla.
    const lt2SecRaw = lt?.lt2Pace ? lt.lt2Pace * 60 : null;
    const lt2Sec = lt2SecRaw != null && lt2SecRaw >= 120 && lt2SecRaw <= 480 ? lt2SecRaw : null;
    let goalSec = null;
    if (goal?.pace) {
      const [gm, gs] = String(goal.pace).split(':').map(Number);
      if (Number.isFinite(gm) && Number.isFinite(gs)) goalSec = gm * 60 + gs;
    }
    const lines = [
      `Ritmo medio real 4 sem = ${avgPace}/km (mezcla TODAS las carreras; solo referencia)`,
      `Ritmo de rodaje fácil real (carreras bajo umbral) = ${fmt(baseSec)}/km (ESTA es tu ancla para base/fácil)`,
      `Regenerativo (≈ +0:20/+0:40 sobre fácil): ${fmt(baseSec + 20)}-${fmt(baseSec + 40)}/km`,
      `Aeróbico base (≈ -0:05/+0:15 sobre fácil): ${fmt(baseSec - 5)}-${fmt(baseSec + 15)}/km`,
    ];
    if (lt2Sec) {
      // Tempo/umbral ≈ LT2 (un pelín más suave); series/intervalos por debajo del umbral.
      lines.push(`Tempo/umbral (ANCLADO A TU LT2 ${fmt(lt2Sec)}/km, NO al ritmo fácil): ${fmt(lt2Sec)}-${fmt(lt2Sec + 8)}/km`);
      lines.push(`Intervalos/series (más rápido que el umbral, coherente con tus MARCAS 5K/10K): ${fmt(lt2Sec - 28)}-${fmt(lt2Sec - 12)}/km`);
      lines.push(`AVISO: tu ritmo fácil (${fmt(baseSec)}) está lejos de tu umbral (${fmt(lt2Sec)}) porque estás en fase base/desentrenado. NUNCA derives tempo/series restando segundos al fácil; usa el ancla LT2 y tus marcas.`);
    } else {
      if (lt2SecRaw != null) {
        lines.push(`AVISO: el ritmo umbral calculado (LT2) es inválido (dato corrupto) y se ha descartado; los rangos de tempo salen del ritmo fácil.`);
      }
      lines.push(`Tempo/umbral (≈ -0:25/-0:10 sobre fácil): ${fmt(baseSec - 25)}-${fmt(baseSec - 10)}/km`);
    }
    if (goalSec) {
      lines.push(`Ritmo objetivo de carrera = ${fmt(goalSec)}/km. GUARDARRAÍL: el tempo/umbral NUNCA debe ser MÁS LENTO que este ritmo (el ritmo de carrera no puede ser más rápido que tu tempo).`);
    }
    lines.push(`REGLA: NO prescribas el rodaje fácil más lento que tu último rodaje si éste fue a ≤75% FCmax (ya era fácil; frenar más es contraproducente).`);
    paceRefs = lines.join('\n');
  }

  // ── Garmin: HRV (vs baseline), resting-HR trend, Body Battery, day-by-day ──
  const hrv = analyzeHRV(garminData, now);
  let rhr = null, bb = null, garminLog = '';
  if (garminData?.length) {
    const sorted = [...garminData].sort((a, b) => b.date.localeCompare(a.date));
    const w14 = new Date(now); w14.setDate(now.getDate() - 14);
    const w7 = new Date(now); w7.setDate(now.getDate() - 7);
    const w28 = new Date(now); w28.setDate(now.getDate() - 28);
    // Daily detail only for the acute window (last 7d): the trend beyond that is
    // already captured by the 7/14/28d RHR means, the HRV baseline range and the
    // readiness score — dumping 30 raw rows just burns output budget.
    const rec7 = sorted.filter(d => new Date(d.date) >= w7);

    rhr = {
      latest: sorted.find(d => d.restingHR)?.restingHR ?? null,
      r7: mean(sorted.filter(d => new Date(d.date) >= w7 && d.restingHR).map(d => d.restingHR)),
      r14: mean(sorted.filter(d => new Date(d.date) >= w14 && d.restingHR).map(d => d.restingHR)),
      r28: mean(sorted.filter(d => new Date(d.date) >= w28 && d.restingHR).map(d => d.restingHR)),
    };
    // Body Battery (Firstbeat): peak charge reached today/yesterday = recovery state
    const latestBB = sorted.find(d => d.bbHigh != null);
    if (latestBB) bb = { high: latestBB.bbHigh, low: latestBB.bbLow ?? null };

    garminLog = rec7.map(d => {
      const parts = [d.date.slice(5)];
      if (d.hrv) parts.push(`VFC=${d.hrv}ms`);
      if (d.hrvStatus) parts.push(`[${d.hrvStatus}]`);
      if (d.restingHR) parts.push(`RHR=${d.restingHR}ppm`);
      if (d.bbHigh != null) parts.push(`BB=${d.bbLow ?? '?'}→${d.bbHigh}`);
      return parts.join(' ');
    }).join('\n');
  }

  // ── Sleep (weekly, Garmin sleep-service) ──────────────────────────────────
  let sleep = null;
  if (sleepData?.length) {
    const sortedS = [...sleepData].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    const last = sortedS.find(w => w.score != null) ?? sortedS[0];
    if (last) {
      sleep = {
        score: last.score ?? null,
        quality: last.quality ?? null,
        durationMin: last.durationMin ?? null,
        needMin: last.needMin ?? null,
        deepMin: last.deepMin ?? null,
        remMin: last.remMin ?? null,
        weekStart: last.weekStart,
      };
    }
  }

  // ── Composite readiness score (deterministic) ─────────────────────────────
  const readiness = computeReadiness({ hrv, rhr, bb, sleep, pmc });

  // ── Data-availability flags (for graceful degradation in the prompt) ──────
  const hasWearable = !!(garminData?.length);
  const missing = [];
  if (!hasWearable) missing.push('VFC/FC-reposo/Body Battery (sin Garmin)');
  if (!sleep) missing.push('sueño');
  if (!readiness) missing.push('readiness score');
  if (!avgHR) missing.push('FC en carrera (carreras sin pulsómetro)');
  if (lthrIsEstimate) missing.push('LTHR de campo (usando estimación por fórmula)');

  // ── Parciales (splits_metric) SOLO para las carreras más rápidas ──────────
  // Regla: enviar parciales si el ritmo medio de la carrera está en el percentil
  // 80 de las carreras enviadas, es decir, entre el 20% MÁS RÁPIDAS (menor min/km).
  // Así el modelo analiza la distribución del esfuerzo en los esfuerzos que importan
  // sin inflar tokens ni la cuota de Strava con los rodajes fáciles.
  const runPaceMinKm = (a) => (a.distance > 0 && a.moving_time > 0 && isRunning(a))
    ? (a.moving_time / 60) / (a.distance / 1000)
    : null;
  const sentRunPaces = yearActs
    .filter(a => new Date(a.start_date) >= week8)
    .map(runPaceMinKm)
    .filter(p => p != null)
    .sort((x, y) => x - y);
  const topCount = sentRunPaces.length ? Math.max(1, Math.round(sentRunPaces.length * 0.2)) : 0;
  const fastPaceThreshold = topCount ? sentRunPaces[topCount - 1] : null;
  const isFastRun = (a) => {
    const p = runPaceMinKm(a);
    return p != null && fastPaceThreshold != null && p <= fastPaceThreshold + 1e-6;
  };
  const splitPace = (sp) => {
    const dkm = (sp.distance || 0) / 1000;
    const t = sp.moving_time || sp.elapsed_time || 0;
    if (dkm <= 0 || t <= 0) return null;
    return fmtMinKm((t / 60) / dkm);
  };
  // Desnivel del parcial: solo si es relevante (≥2 m), con signo. Un parcial lento
  // en subida NO es desfallecimiento → el desnivel es imprescindible para leerlo bien.
  const splitElev = (sp) => {
    const e = sp.elevation_difference;
    return (e != null && Math.abs(e) >= 2) ? `${e > 0 ? '+' : ''}${Math.round(e)}m` : null;
  };
  // Formato compacto para el log (BLOQUE 2): ritmo/FC/±desnivel por km.
  const compactSplits = (splits) => {
    if (!Array.isArray(splits) || splits.length < 2) return null;
    const cs = splits.map(sp => {
      const pace = splitPace(sp);
      if (!pace) return null;
      const hr = sp.average_heartrate ? `/${Math.round(sp.average_heartrate)}` : '';
      const el = splitElev(sp) ? `/${splitElev(sp)}` : '';
      return `${pace}${hr}${el}`;
    }).filter(Boolean);
    return cs.length >= 2 ? cs.join('·') : null;
  };
  // Formato detallado para el último entreno (BLOQUE 4): ritmo · FC · desnivel.
  const detailedSplits = (splits) => {
    if (!Array.isArray(splits) || splits.length < 2) return null;
    const ds = splits.map((sp, i) => {
      const pace = splitPace(sp);
      if (!pace) return null;
      const hr = sp.average_heartrate ? ` ${Math.round(sp.average_heartrate)}ppm` : '';
      const el = splitElev(sp) ? ` ${splitElev(sp)}` : '';
      return `k${i + 1} ${pace}${hr}${el}`;
    }).filter(Boolean);
    return ds.length >= 2 ? ds.join(' · ') : null;
  };

  // ── Activity log (56d individual, to ground the 2-month trend in BLOQUE 2) ─
  const actLog = yearActs
    .filter(a => new Date(a.start_date) >= week8)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map(a => {
      const kmNum = a.distance / 1000;
      const km = kmNum.toFixed(1);
      const min = (a.moving_time || 0) / 60;

      let typeLabel = '[Otro]';
      let performance = '';

      if (isRunning(a)) {
        // Strava workout_type for runs: 1=race, 2=long run, 3=workout/quality
        const wt = { 1: '🏁OFICIAL', 2: 'tirada-larga', 3: 'calidad' }[a.workout_type];
        typeLabel = wt ? `[Carrera·${wt}]` : '[Carrera]';
        if (kmNum > 0 && min > 0) {
          performance = `@${fmtMinKm(min / kmNum)}/km`;
        }
      } else if (isCycling(a)) {
        typeLabel = '[Ciclismo]';
        if (kmNum > 0 && min > 0) {
          const speed = kmNum / (min / 60);
          performance = `@${speed.toFixed(1)}km/h`;
        }
      } else if (isSwimming(a)) {
        typeLabel = '[Natación]';
        if (kmNum > 0 && min > 0) {
          performance = `@${fmtMinKm(min / (a.distance / 100))}/100m`;
        }
      } else if (a.type === 'Walk' || a.type === 'Hike') {
        typeLabel = `[Caminata]`;
        if (kmNum > 0 && min > 0) {
          performance = `@${fmtMinKm(min / kmNum)}/km`;
        }
      } else if (a.type === 'WeightTraining') {
        typeLabel = '[Fuerza]';
      } else if (a.type === 'Yoga') {
        typeLabel = '[Yoga]';
      } else {
        typeLabel = `[${a.type || 'Actividad'}]`;
      }

      const parts = [a.start_date.slice(5, 10), typeLabel];
      if (a.distance > 0) parts.push(`${km}km`);
      if (performance) parts.push(performance);
      if (a.average_heartrate) parts.push(`FC=${Math.round(a.average_heartrate)}ppm`);
      if (a.total_elevation_gain > 0) parts.push(`+${Math.round(a.total_elevation_gain)}m`);
      if (min > 0) parts.push(`${Math.round(min)}min`);
      if (a.suffer_score) parts.push(`sufr=${a.suffer_score}`);
      if (isRunning(a) && isFastRun(a) && a.splits_metric) {
        const cs = compactSplits(a.splits_metric);
        if (cs) parts.push(`parciales/km:[${cs}]`);
      }
      return parts.join(' ');
    }).join('\n');

  // ── Sections ─────────────────────────────────────────────────────────────
  const weekTable = byWeek.map(w => `${w.week}: ${w.km}km (${w.sessions} carreras)`).join(' | ');

  // ── Intensity distribution (Seiler 3-zone polarized model) ────────────────
  // Classifies last-4-week runs by avg HR vs LTHR into easy/threshold/hard and
  // computes the % of TIME in each. Endurance science target: ≈80% easy.
  let polarized = null;
  const hrRuns4w = recentRuns.filter(a => a.average_heartrate && a.moving_time);
  if (hrRuns4w.length >= 3) {
    let easy = 0, thr = 0, hard = 0;
    for (const a of hrRuns4w) {
      const r = a.average_heartrate / lthr;
      const t = a.moving_time;
      if (r < 0.92) easy += t; else if (r < 1.0) thr += t; else hard += t;
    }
    const tot = easy + thr + hard;
    if (tot > 0) polarized = {
      easy: Math.round(easy / tot * 100),
      thr: Math.round(thr / tot * 100),
      hard: Math.round(hard / tot * 100),
    };
  }

  const physioSection = [
    rhr?.latest != null ? `FC reposo HOY=${rhr.latest}ppm` : null,
    hrv ? `VFC HOY=${hrv.latest}ms${hrv.status ? ` [estado Garmin: ${hrv.status}]` : ''}` : null,
    hrv?.baseline?.balancedLow != null
      ? `Baseline VFC personal: ${hrv.baseline.balancedLow}-${hrv.baseline.balancedUpper}ms (rango equilibrado) → ${hrv.latest < hrv.baseline.balancedLow ? '⚠ POR DEBAJO (carga parasimpática suprimida)' : hrv.latest > hrv.baseline.balancedUpper ? '↑ por encima (muy recuperado)' : 'dentro de rango'}`
      : null,
    hrv?.hrv7 != null ? `VFC media 7d=${hrv.hrv7.toFixed(1)}ms${hrv.prev7 != null ? ` (${hrv.hrv7 >= hrv.prev7 ? '↑ mejorando' : '↓ bajando'} vs 7d previos)` : ''}` : null,
    hrv?.cv != null ? `Coef. variación VFC 7d=${hrv.cv}% (${hrv.cv > 10 ? 'alto → adaptación pobre/fatiga' : 'estable → buena adaptación'})` : null,
    rhr?.r7 != null && rhr?.r28 != null ? `FC reposo 7d=${rhr.r7.toFixed(0)}ppm vs 28d=${rhr.r28.toFixed(0)}ppm (${rhr.r7 <= rhr.r28 * 1.03 ? 'estable' : '⚠ elevada → fatiga/estrés'})` : null,
    bb?.high != null ? `Body Battery: recarga máx=${bb.high}/100${bb.low != null ? `, mín=${bb.low}` : ''} (${bb.high >= 70 ? 'bien recuperado' : bb.high >= 40 ? 'recuperación parcial' : 'reservas bajas'})` : null,
    sleep?.score != null ? `Sueño (media semana): score=${sleep.score}/100${sleep.durationMin ? `, ${(sleep.durationMin / 60).toFixed(1)}h` : ''}${sleep.needMin && sleep.durationMin ? ` vs necesidad ${(sleep.needMin / 60).toFixed(1)}h` : ''}${sleep.deepMin ? `, profundo ${sleep.deepMin}min` : ''}` : null,
  ].filter(Boolean).join('\n');

  const pmcSection = pmc ? [
    `Fitness (CTL, EWMA 42d)=${pmc.ctl} · ${pmc.pctPeak}% de tu pico histórico (${pmc.peak})`,
    `Fatiga (ATL, EWMA 7d)=${pmc.atl}`,
    `Forma (TSB=CTL−ATL)=${pmc.tsb > 0 ? '+' : ''}${pmc.tsb} (${pmc.tsb > 15 ? 'muy fresco/desentrenando' : pmc.tsb > 5 ? 'fresco' : pmc.tsb >= -10 ? 'óptimo' : pmc.tsb >= -20 ? 'cargado' : 'sobrecargado'})`,
    `ACWR (agudo:crónico, Gabbett)=${pmc.acwr} (óptimo 0.8–1.3; >1.5 riesgo alto lesión)`,
    `Rampa CTL=${pmc.ramp > 0 ? '+' : ''}${pmc.ramp}/sem (no superar +5/sem)`,
  ].join('\n') : 'Sin datos suficientes para el modelo PMC.';

  const trainingSection = [
    `Total 4 sem (carrera): ${recentKm.toFixed(0)}km en ${recentRuns.length} sesiones`,
    avgPace ? `ritmo medio ${avgPace}min/km` : null,
    avgHR ? `FC media carrera ${avgHR}ppm (=${avgHR ? Math.round(avgHR / fcmax * 100) : '?'}% FCmax)` : null,
    loadDelta != null ? `Carga km vs 4 sem previas: ${loadDelta > 0 ? '+' : ''}${loadDelta}%` : null,
    polarized ? `Distribución de intensidad 4 sem (SOLO carrera, tiempo): fácil ${polarized.easy}% / umbral ${polarized.thr}% / duro ${polarized.hard}% (la regla 80/20 se aplica sobre carga TOTAL, ver reglas de "sesion")` : null,
  ].filter(Boolean).join(', ');

  // ── High-intensity cross-training in the last 4 weeks (covers the "hard"
  // bucket that the running-only polarized % can't see — e.g. football/soccer) ─
  const crossActs = activities.filter(a => { const d = new Date(a.start_date); return d >= week4 && !isRunning(a); });
  const crossIntense = crossActs.filter(a => (a.suffer_score && a.suffer_score >= 40) || (a.average_heartrate && fcmax && a.average_heartrate / fcmax > 0.85));
  const crossNote = crossIntense.length
    ? `AVISO CRUZADO: en las últimas 4 sem hiciste ${crossIntense.length} sesión(es) de cruzado de ALTA intensidad (${crossIntense.map(a => `${a.type} sufr=${a.suffer_score ?? '?'}`).join(', ')}). Esa intensidad cuenta como la parte DURA del 80/20 total y suma fatiga/riesgo de lesión.`
    : null;

  // ── Last training session (detailed micro-analysis for BLOQUE 4) ──────────
  const lastAct = [...yearActs].sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  let lastSection = '';
  if (lastAct) {
    const kmNum = lastAct.distance / 1000;
    const min = (lastAct.moving_time || 0) / 60;
    const ln = [
      `Fecha: ${new Date(lastAct.start_date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}`,
      lastAct.name ? `Nombre: "${lastAct.name}"` : null,
      `Tipo: ${lastAct.type}`,
      kmNum > 0 ? `Distancia: ${kmNum.toFixed(2)}km` : null,
      min > 0 ? `Duración: ${Math.round(min)}min` : null,
    ];
    if (kmNum > 0 && min > 0 && isRunning(lastAct)) {
      ln.push(`Ritmo: ${fmtMinKm(min / kmNum)}/km (ritmo medio 4 sem: ${avgPace ?? '?'}/km)`);
    } else if (kmNum > 0 && min > 0 && isCycling(lastAct)) {
      ln.push(`Velocidad: ${(kmNum / (min / 60)).toFixed(1)}km/h`);
    }
    if (lastAct.average_heartrate) ln.push(`FC media: ${Math.round(lastAct.average_heartrate)}ppm (${Math.round(lastAct.average_heartrate / fcmax * 100)}% FCmax · ${Math.round(lastAct.average_heartrate / lthr * 100)}% LTHR${avgHR ? ` · media 4 sem ${avgHR}ppm` : ''})`);
    if (lastAct.max_heartrate) ln.push(`FC máx: ${Math.round(lastAct.max_heartrate)}ppm`);
    if (lastAct.total_elevation_gain) ln.push(`Desnivel: +${Math.round(lastAct.total_elevation_gain)}m`);
    if (lastAct.suffer_score) ln.push(`Esfuerzo Strava: ${lastAct.suffer_score}`);
    ln.push(`Carga estimada (TRIMP): ${Math.round(estimateLoad(lastAct))}`);
    if (isRunning(lastAct) && isFastRun(lastAct) && lastAct.splits_metric) {
      const ds = detailedSplits(lastAct.splits_metric);
      if (ds) ln.push(`Parciales por km (formato: ritmo · FC · desnivel). Analiza la distribución del esfuerzo (positive/negative split, desfallecimiento, ritmo parejo, descontrol inicial), pero AJUSTA por desnivel: un parcial lento EN SUBIDA o rápido EN BAJADA no es un error de ejecución: ${ds}`);
    }
    lastSection = ln.filter(Boolean).join('\n');
  }
  const lastIsRun = lastAct ? isRunning(lastAct) : true;

  // Fresh-by-detraining guard: a high readiness on top of a LOW chronic load
  // (small CTL / ACWR<0.8) is freshness from under-training, not supercompensation.
  const lowChronicReasons = [];
  if (pmc && pmc.ctl < 25) lowChronicReasons.push(`CTL bajo (${pmc.ctl})`);
  if (pmc && pmc.acwr != null && pmc.acwr < 0.8) lowChronicReasons.push(`ACWR<0.8 (${pmc.acwr})`);
  const lowChronic = lowChronicReasons.length > 0;
  const lowChronicNote = lowChronic
    ? ` MATIZ CRÍTICO: tu carga crónica es BAJA (${lowChronicReasons.join(' · ')}). Aquí un readiness alto significa que estás fresco por FALTA de entrenamiento acumulado, NO por supercompensación. Prioriza CONSTRUIR BASE AERÓBICA y subir volumen de forma progresiva y segura ANTES que sesiones de calidad/intervalos, aunque el score las permita. Forzar intensidad sobre una base baja dispara el riesgo de lesión.`
    : '';
  const readinessLine = readiness
    ? `READINESS SCORE (0-100, calculado de forma determinista combinando VFC-vs-baseline, Body Battery, sueño, FC-reposo y forma TSB): ${readiness.score}/100 → "${readiness.label}". ESTE SCORE ES AUTORITATIVO: tu prescripción del próximo entrenamiento DEBE ser coherente con él (≥80 permite calidad/intervalos; 62-79 entreno normal; 45-61 baja la carga; <45 solo regenerativo o descanso).${lowChronicNote}`
    : 'READINESS SCORE: no disponible (faltan datos de wearable) — sé MÁS CONSERVADOR: por defecto prescribe base aeróbica/rodaje fácil, no intervalos, y declara explícitamente que la recomendación es prudente por falta de datos de recuperación.';

  // Temporal context: anchor "today" + staleness of last run (avoids the model
  // guessing the current date from the most recent Garmin row).
  const lastRunAct = [...runningYearActs].sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  const daysSinceRun = lastRunAct ? Math.floor((now - new Date(lastRunAct.start_date)) / 86400000) : null;
  const contextoTemporal = `CONTEXTO TEMPORAL: Hoy es ${now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.${daysSinceRun != null ? ` Han pasado ${daysSinceRun} día(s) desde tu última carrera${daysSinceRun >= 4 ? ' (gap notable: tenlo en cuenta para la frescura y la prioridad de volver a rodar)' : ''}.` : ''}`;

  const dataGaps = missing.length
    ? `DATOS AUSENTES (NO los inventes; ajústate y, si afectan a una conclusión, dilo brevemente): ${missing.join('; ')}.`
    : 'COBERTURA DE DATOS: completa (wearable + sueño + LTHR de campo).';

  // Reusable athlete data context (shared with the training planner). Holds the
  // computed science — PMC, HR zones, reference paces, PBs, physiology, weekly/
  // monthly breakdown — without any feature-specific instructions.
  const athleteContext = `DATOS DEL ATLETA:
${contextoTemporal}
${dispoLine}
${goalLine}
${dataGaps}
${readinessLine}

${pbSection ? `MARCAS PERSONALES (tu tope actual por distancia — referencia de potencial para calibrar ritmos objetivo y objetivos realistas):\n${pbSection}` : ''}

ZONAS DE FC CALCULADAS:
${hrZonesSummary}

RITMOS DE REFERENCIA:
${paceRefs}

MODELO DE CARGA (Banister PMC):
${pmcSection}

${physioSection ? `FISIOLOGÍA (wearable Garmin):\n${physioSection}` : 'Sin datos de wearable.'}
${garminLog ? `Garmin día a día (últimos 7d · ventana aguda; tendencia previa ya resumida en medias 7/14/28d):\n${garminLog}` : ''}
ENTRENAMIENTO (resumen 4 sem): ${trainingSection}
${crossNote ?? ''}
${lastSection ? `ÚLTIMO ENTRENAMIENTO (sesión más reciente):\n${lastSection}` : ''}
${actLog ? `Actividades últimas 8 semanas (más reciente primero; etiquetas: tipo de deporte y, en carreras, 🏁OFICIAL/tirada-larga/calidad según Strava; +Xm = desnivel; parciales/km:[ritmo/FC/±desnivel por km] solo en las carreras más rápidas):\n${actLog}` : ''}
Desglose semanal (carrera): ${weekTable}
Historial mensual de carrera (últimos 2 meses): ${monthHistory}`;

  const prompt = `Eres un entrenador de running y fisiólogo deportivo de élite que aplica EXCLUSIVAMENTE modelos validados por la ciencia del entrenamiento actual: el modelo de impulso-respuesta de Banister (CTL/ATL/TSB, estándar de TrainingPeaks), el modelo polarizado 80/20 de Seiler, el entrenamiento guiado por VFC de Plews & Buchheit, el ratio agudo:crónico de Gabbett para riesgo de lesión, y el umbral de lactato de Friel. Tu objetivo es un diagnóstico ACCIONABLE y FIABLE en el que el atleta pueda confiar a ciegas, no describir datos. El atleta hace entrenamiento cruzado además de correr: considera su carga cardiovascular y fatiga al evaluar el estado, pero prescribe el próximo entrenamiento enfocado EXCLUSIVAMENTE en carrera a pie.

Devuelve el objeto estructurado que exige el esquema. Reglas de CONTENIDO por campo:

"diagnostico" — DIAGNÓSTICO DE ESTA SEMANA:
Sintetiza el READINESS SCORE, la VFC vs tu baseline personal, la forma (TSB), el ACWR y el Body Battery/sueño para determinar el estado real (recuperado, fatigado, sobreentrenado, en forma). Da una recomendación semanal concreta coherente con el score.

"tendencia" — TENDENCIA Y PATRÓN (ÚLTIMOS 2 MESES):
Cruza el historial mensual con la evolución de CTL/forma para detectar progresión, estancamiento, pico-caída o lesión encubierta. Señala el mejor y peor período y si la rampa de carga es segura. Fija una recomendación de objetivo 4-6 semanas REALISTA según tus MARCAS PERSONALES (tope) y la DISPONIBILIDAD semanal.

"sesion" — PRÓXIMO ENTRENAMIENTO RECOMENDADO:
Diseña la sesión de running más adecuada para los próximos 1-2 días, COHERENTE con el READINESS SCORE y la forma actual. Los campos numéricos (zona, fcMin, fcMax) y el ritmo salen EXCLUSIVAMENTE de "ZONAS DE FC CALCULADAS" y "RITMOS DE REFERENCIA"; PROHIBIDO inventar cifras fuera de esos anclajes. En "instrucciones":
- Estructura de la sesión (calentamiento, bloques/series, vuelta a la calma) si aplica.
- Una condición fisiológica de seguridad concreta (ej: "para si FC>{valor}ppm", "si VFC sigue bajo baseline mañana, pásalo a regenerativo").
- Distribución de intensidad: cuenta el cruzado (fútbol, etc.) como la parte DURA del 80/20. Si tu carrera ya es 100% fácil y el cruzado cubre la intensidad, NO añadas calidad en carrera "para rellenar" el 0% de umbral. Con CTL bajo, el limitante es el VOLUMEN: prioriza progresar la tirada larga / km semanales, no frenar aún más el ritmo.

"ultimoEntreno" — ANÁLISIS DEL ÚLTIMO ENTRENAMIENTO:
${lastIsRun
  ? `Evalúa la sesión más reciente (datos abajo en "ÚLTIMO ENTRENAMIENTO"). Determina qué estímulo fue (regenerativo, aeróbico base, umbral/tempo, calidad/intervalos) según su %LTHR y %FCmax, si la ejecución fue coherente (ritmo acorde a la FC y al tipo de sesión, ajustado al desnivel), y si encaja con tu estado de forma actual. Si la sesión ya fue fácil (FC media en Z1/Z2), NO la penalices por serlo ni pidas ir aún más lento; un pico breve de FCmax por una cuesta o repecho en un rodaje fácil es NORMAL, no un error de ejecución. Si hay "Parciales por km", analiza la DISTRIBUCIÓN del esfuerzo (positive/negative split, desfallecimiento final, ritmo parejo o descontrol inicial) y refléjalo en el acierto/ajuste. Reparto de bullets: 1º estímulo real y ejecución, 2º el acierto, 3º el ajuste accionable (relacionado con tu fatiga/recuperación de hoy).`
  : `La sesión más reciente (datos abajo en "ÚLTIMO ENTRENAMIENTO") es ENTRENAMIENTO CRUZADO, no carrera: NO evalúes ejecución técnica de carrera (parciales, splits, ritmo/km). Evalúa su rol como carga cardiovascular complementaria: qué aporta al 80/20 total, cuánta fatiga suma (TRIMP, %FCmax) y si interfiere con la próxima sesión de carrera (frescura para calidad, riesgo de acumular dureza). Reparto de bullets: 1º rol/carga e interferencia, 2º el acierto, 3º el ajuste accionable (relacionado con tu fatiga/recuperación de hoy).`}

"estado" y "tendenciaClave":
Resumen para máquina, DEBEN ser coherentes con "diagnostico", "tendencia" y "sesion" (mismo diagnóstico, mismo patrón).

${athleteContext}

(En ZONAS DE FC y RITMOS DE REFERENCIA: usa esas cifras EXACTAS en "sesion", NO inventes.)

REGLAS ESTRICTAS DE SALIDA:
- Sin introducción. Sin "el atleta". Habla directamente en segunda persona.
- Cada bullet empieza con el concepto en **negrita** (única marca permitida; nada de títulos ni listas anidadas).
- Cantidad y longitud: "diagnostico" y "ultimoEntreno" = 2-3 bullets; "tendencia" = 3-4 bullets (pide más elementos: patrón, mejor/peor período, rampa, veredicto del objetivo). Todos de máx 22 palabras. "sesion.instrucciones" = 2-3 bullets de máx 30 palabras (necesitan datos concretos).
- PROHIBIDO inventar cifras: usa SOLO los ppm de "ZONAS DE FC CALCULADAS" y los ritmos de "RITMOS DE REFERENCIA". Si un dato no está disponible, dilo, no lo estimes. Si un ritmo de referencia es manifiestamente inválido (negativo, formato imposible), es DATO CORRUPTO: decláralo y no lo uses.
- Si faltan datos de wearable / readiness, sé conservador y prioriza base aeróbica.
- No repitas datos sin interpretarlos.
- COHERENCIA OBLIGATORIA: la prescripción de "sesion" debe ser coherente con el diagnóstico y la tendencia. No prescribas bajar el ritmo de un rodaje que ya fue fácil.`;

  return {
    prompt,
    athleteContext,
    sci: {
      readiness, pmc, hrv, rhr, bb, sleep, polarized, fcmax, fcRest, lthr,
      lt: {
        lt1Hr, lt2Hr: lthr,
        lt1Pace: lt?.lt1Pace ?? null, lt2Pace: lt?.lt2Pace ?? null,
        csValid: !!lt?.csValid, trend: ltTrend, trendDelta: lt?.trendDelta ?? null,
        lthrIsEstimate,
      },
    },
  };
};
