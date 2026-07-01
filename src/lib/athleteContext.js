import { seilerBounds, karvonenBounds } from './hrZones';
import { computeLactateModel, formatPace } from './lactateThreshold';

// ── Scientific helpers ───────────────────────────────────────────────────────
const mean = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
    ? `DISPONIBILIDAD / OBJETIVO: quieres entrenar ${weeklyTarget} sesión(es) de CARRERA por semana. Ajusta el volumen semanal del BLOQUE 2 y la cadencia de sesiones a esa frecuencia: no propongas más carreras de las que puedes asumir, y reparte calidad vs. fácil respetando el 80/20 DENTRO de ese número de sesiones.`
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
    goalLine = `OBJETIVO DE CARRERA: estás preparando un ${goal.distance}${extra}.${when} Orienta la rampa de carga (BLOQUE 2) y las sesiones de calidad/ritmo (BLOQUE 3) HACIA este objetivo: deriva los ritmos de tempo/intervalos del ritmo objetivo y de tus marcas. En el BLOQUE 2 indica explícitamente si el objetivo es realista, ambicioso o conservador dado tu tope (marcas personales), tu CTL/forma actuales y el tiempo disponible, y qué falta para alcanzarlo.`;
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
  const avgPace = recentKm > 0
    ? (() => { const p = recentMin / recentKm; return `${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}`; })()
    : null;
  const withHR = recentRuns.filter(a => a.average_heartrate);
  const avgHR = withHR.length ? Math.round(withHR.reduce((s, a) => s + a.average_heartrate, 0) / withHR.length) : null;

  // ── Robust FCmax detection (all-time, median of top 5%) ───────────────────
  // Using all activities (not just recent) since FCmax is a stable physiological trait.
  // We filter <140 and >215 to eliminate sensor glitches, then take the median of the
  // top 5% of peaks to resist cadence-lock false spikes from optical sensors.
  const allMaxHRs = activities
    .filter(a => a.max_heartrate > 140 && a.max_heartrate < 215)
    .map(a => a.max_heartrate)
    .sort((a, b) => b - a);
  let fcmax = 185;
  if (allMaxHRs.length > 0) {
    const sampleSize = Math.min(allMaxHRs.length, Math.max(5, Math.floor(allMaxHRs.length * 0.05)));
    const peaks = allMaxHRs.slice(0, sampleSize);
    fcmax = Math.round(peaks[Math.floor(peaks.length / 2)]);
  }

  // ── Resting HR: prefer latest Garmin reading, fallback to activity estimate ─
  let fcRest = 60;
  if (garminData?.length) {
    const sortedG = [...garminData].sort((a, b) => b.date.localeCompare(a.date));
    const recentRHR = sortedG.find(d => d.restingHR);
    if (recentRHR) fcRest = recentRHR.restingHR;
  } else {
    const easyRunHRs = runningYearActs
      .filter(a => a.average_heartrate && a.moving_time > 2400)
      .map(a => a.average_heartrate)
      .sort((a, b) => a - b);
    if (easyRunHRs.length) {
      const easy = easyRunHRs[Math.floor(easyRunHRs.length * 0.15)];
      fcRest = Math.max(38, Math.min(78, Math.round(easy * 0.56)));
    }
  }

  // ── LTHR detection (last 2 months for current fitness state) ─────────────
  // Strategy 1: sustained hard efforts 18-70min where avg HR > 82% FCmax and
  //   avg/max ratio > 0.92 (to confirm effort was sustained, not a spike).
  //   → median of qualifying runs' avg HR = LTHR estimate
  // Strategy 2: fall back to Friel's approximation: LTHR ≈ 87.5% FCmax
  let lthr = Math.round(fcmax * 0.875);
  let lthrMethod = 'Friel approx (87.5% FCmax)';
  let lthrIsEstimate = true;
  const thresholdRuns2m = twoMonthActs.filter(a => {
    if (!a.average_heartrate || !a.max_heartrate || !a.moving_time) return false;
    const mins = a.moving_time / 60;
    const avgPct = a.average_heartrate / fcmax;
    const sustain = a.average_heartrate / a.max_heartrate;
    return mins >= 18 && mins <= 70 && avgPct >= 0.82 && avgPct < 0.97 && sustain >= 0.92;
  });
  if (thresholdRuns2m.length >= 2) {
    const hrs = thresholdRuns2m.map(a => a.average_heartrate).sort((a, b) => a - b);
    lthr = Math.round(hrs[Math.floor(hrs.length / 2)]);
    lthrMethod = `campo (${thresholdRuns2m.length} esfuerzos umbral detectados)`;
    lthrIsEstimate = false;
  }

  // ── Lactate-threshold model (LT1/LT2) — fuente centralizada (src/lib/lactateThreshold) ─
  // El modelo de Critical Speed da el LT2 anclado a RENDIMIENTO (ritmo), y el
  // cross-check de FC da los ritmos LT1/LT2 mensuales. Lo reutilizamos aquí para
  // que el coach IA y la pestaña de Umbral de Lactato hablen el MISMO idioma.
  // LTHR (FC umbral, LT2) sigue siendo el detectado de campo arriba. El LT1 en FC
  // se deriva del ratio LT1/LT2 (≈0.77/0.87 del %FCmax → ~0.885·LTHR), porque el
  // resumen de Strava no expone la FC sostenida de campo a intensidad LT1.
  const lt = computeLactateModel(activities, 12);
  const lt1Hr = Math.round(lthr * (0.77 / 0.87));
  const lt2PaceStr = lt?.lt2Pace ? formatPace(lt.lt2Pace) : null;
  const lt1PaceStr = lt?.lt1Pace ? formatPace(lt.lt1Pace) : null;
  const ltTrend = lt?.trendDelta != null
    ? (lt.trendDelta > 5 ? 'mejorando' : lt.trendDelta < -5 ? 'empeorando' : 'estable')
    : null;

  // ── HR zones (shared formulas with the TrainingZones tab — src/lib/hrZones) ─
  // Seiler polarized (LTHR-based) = primary anchor for the polarized 80/20 call.
  const [, sZ2, sZ3] = seilerBounds({ lthr });
  // Karvonen (HRR-based) supplementary — for the session-prescription ppm ranges.
  const [, kZ2, kZ3, kZ4] = karvonenBounds({ hrmax: fcmax, hrrest: fcRest });

  const hrZonesSummary = [
    `FCmax=${fcmax}ppm (mediana top 5% histórico)`,
    `FC reposo=${fcRest}ppm (Garmin más reciente)`,
    `LT1 (umbral aeróbico, techo del rodaje FÁCIL)=${lt1Hr}ppm${lt1PaceStr ? ` · ritmo ≈${lt1PaceStr}/km` : ''} → corre el 80% del volumen POR DEBAJO de esta FC`,
    `LT2 (umbral de lactato/anaeróbico = LTHR)=${lthr}ppm${lt2PaceStr ? ` · ritmo ≈${lt2PaceStr}/km${lt?.csValid ? ' (Critical Speed)' : ' (cross-check FC)'}` : ''}${ltTrend ? ` · tendencia LT2: ${ltTrend}` : ''} [método FC: ${lthrMethod}]${lthrIsEstimate ? ' (FC ESTIMADA por fórmula, sin umbral de campo detectado → límites de zona aproximados)' : ''}`,
    `Z1 aeróbica base (regenerativo/rodaje fácil): <${sZ2.lo}ppm`,
    `Z2 zona umbral baja (gris): ${sZ2.lo}-${sZ2.hi}ppm`,
    `Z3 alta intensidad (umbral+): ≥${sZ3.lo}ppm`,
    `Karvonen Z2 (base): ${kZ2.lo}-${kZ2.hi}ppm | Z3 (aeróbico intenso): ${kZ3.lo}-${kZ3.hi}ppm | Z4 (umbral/tempo): ${kZ4.lo}-${kZ4.hi}ppm`,
    avgHR ? `FC media real de rodaje fácil (4 sem) = ${avgHR}ppm (${Math.round(avgHR / fcmax * 100)}% FCmax). ÚSALA como centro de la zona fácil/base: las fórmulas Karvonen/Friel son aproximadas y aquí subestiman tu FC real. El tope de seguridad del rodaje fácil debe ir POR ENCIMA de esta FC observada (≈ +8/+12ppm), NUNCA por debajo.` : null,
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

  // Ritmos de referencia anclados al ritmo fácil real (no inventar):
  // Da al modelo anclas concretas para no alucinar ritmos.
  let paceRefs = 'No disponible (sin km/ritmo reciente suficiente).';
  if (avgPace) {
    const [m, s] = avgPace.split(':').map(Number);
    const pSec = m * 60 + s; // segundos por km del ritmo medio 4 sem
    const baseSec = easyPaceSec ?? pSec; // ancla fisiológica del rodaje fácil
    const fmt = (sec) => `${Math.floor(sec / 60)}:${Math.round(sec % 60).toString().padStart(2, '0')}`;
    paceRefs = [
      `Ritmo medio real 4 sem = ${avgPace}/km (mezcla TODAS las carreras; solo referencia)`,
      `Ritmo de rodaje fácil real (carreras bajo umbral) = ${fmt(baseSec)}/km (ESTA es tu ancla para base/fácil)`,
      `Regenerativo (≈ +0:20/+0:40 sobre fácil): ${fmt(baseSec + 20)}-${fmt(baseSec + 40)}/km`,
      `Aeróbico base (≈ -0:05/+0:15 sobre fácil): ${fmt(baseSec - 5)}-${fmt(baseSec + 15)}/km`,
      `Tempo/umbral (≈ -0:25/-0:10 sobre fácil): ${fmt(baseSec - 25)}-${fmt(baseSec - 10)}/km`,
      `REGLA: NO prescribas el rodaje fácil más lento que tu último rodaje si éste fue a ≤75% FCmax (ya era fácil; frenar más es contraproducente).`,
    ].join('\n');
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
    const p = (t / 60) / dkm;
    return `${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}`;
  };
  const compactSplits = (splits) => {
    if (!Array.isArray(splits) || splits.length < 2) return null;
    const cs = splits.map(splitPace).filter(Boolean);
    return cs.length >= 2 ? cs.join('·') : null;
  };
  const detailedSplits = (splits) => {
    if (!Array.isArray(splits) || splits.length < 2) return null;
    const ds = splits.map((sp, i) => {
      const pace = splitPace(sp);
      if (!pace) return null;
      const hr = sp.average_heartrate ? ` ${Math.round(sp.average_heartrate)}ppm` : '';
      return `k${i + 1} ${pace}${hr}`;
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
          const p = min / kmNum;
          performance = `@${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`;
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
          const pace100m = min / (a.distance / 100);
          const paceMin = Math.floor(pace100m);
          const paceSec = Math.round((pace100m % 1) * 60).toString().padStart(2, '0');
          performance = `@${paceMin}:${paceSec}/100m`;
        }
      } else if (a.type === 'Walk' || a.type === 'Hike') {
        typeLabel = `[Caminata]`;
        if (kmNum > 0 && min > 0) {
          const p = min / kmNum;
          performance = `@${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`;
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
    polarized ? `Distribución de intensidad 4 sem (SOLO carrera, tiempo): fácil ${polarized.easy}% / umbral ${polarized.thr}% / duro ${polarized.hard}%. CLAVE: el 80/20 de Seiler se mide sobre la carga TOTAL (carrera + cruzado), NO solo carrera. Si el cruzado ya aporta intensidad y tu base (CTL) es baja, un 100% fácil EN CARRERA es CORRECTO, no un déficit que corregir. Tu limitante real es el VOLUMEN/frecuencia de carrera, no la falta de intensidad.` : null,
  ].filter(Boolean).join(', ');

  // ── High-intensity cross-training in the last 4 weeks (covers the "hard"
  // bucket that the running-only polarized % can't see — e.g. football/soccer) ─
  const crossActs = activities.filter(a => { const d = new Date(a.start_date); return d >= week4 && !isRunning(a); });
  const crossIntense = crossActs.filter(a => (a.suffer_score && a.suffer_score >= 40) || (a.average_heartrate && fcmax && a.average_heartrate / fcmax > 0.85));
  const crossNote = crossIntense.length
    ? `AVISO CRUZADO: en las últimas 4 sem hiciste ${crossIntense.length} sesión(es) de cruzado de ALTA intensidad (${crossIntense.map(a => `${a.type} sufr=${a.suffer_score ?? '?'}`).join(', ')}). Tu carrera es 100% fácil PERO ya acumulas intensidad ahí: NO prescribas intervalos solo para "rellenar" el 0% de umbral en carrera; computa esa carga dura en la fatiga y el riesgo de lesión.`
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
      const p = min / kmNum;
      ln.push(`Ritmo: ${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km (ritmo medio 4 sem: ${avgPace ?? '?'}/km)`);
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
      if (ds) ln.push(`Parciales por km (analiza la distribución del esfuerzo — salida rápida y desfallecimiento, ritmo parejo o negative split): ${ds}`);
    }
    lastSection = ln.filter(Boolean).join('\n');
  }

  // Fresh-by-detraining guard: a high readiness on top of a LOW chronic load
  // (small CTL / ACWR<0.8) is freshness from under-training, not supercompensation.
  const lowChronic = pmc && (pmc.ctl < 25 || (pmc.acwr != null && pmc.acwr < 0.8));
  const readinessLine = readiness
    ? `READINESS SCORE (0-100, calculado de forma determinista combinando VFC-vs-baseline, Body Battery, sueño, FC-reposo y forma TSB): ${readiness.score}/100 → "${readiness.label}". ESTE SCORE ES AUTORITATIVO: tu prescripción del BLOQUE 3 DEBE ser coherente con él (≥80 permite calidad/intervalos; 62-79 entreno normal; 45-61 baja la carga; <45 solo regenerativo o descanso).${lowChronic ? ' MATIZ CRÍTICO: tu carga crónica es BAJA (CTL reducido y/o ACWR<0.8). Aquí un readiness alto significa que estás fresco por FALTA de entrenamiento acumulado, NO por supercompensación. Prioriza CONSTRUIR BASE AERÓBICA y subir volumen de forma progresiva y segura ANTES que sesiones de calidad/intervalos, aunque el score las permita. Forzar intensidad sobre una base baja dispara el riesgo de lesión.' : ''}`
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
${actLog ? `Actividades últimas 8 semanas (más reciente primero; etiquetas: tipo de deporte y, en carreras, 🏁OFICIAL/tirada-larga/calidad según Strava; +Xm = desnivel):\n${actLog}` : ''}
Desglose semanal (carrera): ${weekTable}
Historial mensual de carrera (últimos 2 meses): ${monthHistory}`;

  const prompt = `Eres un entrenador de running y fisiólogo deportivo de élite que aplica EXCLUSIVAMENTE modelos validados por la ciencia del entrenamiento actual: el modelo de impulso-respuesta de Banister (CTL/ATL/TSB, estándar de TrainingPeaks), el modelo polarizado 80/20 de Seiler, el entrenamiento guiado por VFC de Plews & Buchheit, el ratio agudo:crónico de Gabbett para riesgo de lesión, y el umbral de lactato de Friel. Tu objetivo es un diagnóstico ACCIONABLE y FIABLE en el que el atleta pueda confiar a ciegas, no describir datos. El atleta hace entrenamiento cruzado además de correr: considera su carga cardiovascular y fatiga al evaluar el estado, pero prescribe el próximo entrenamiento enfocado EXCLUSIVAMENTE en carrera a pie.

Devuelve EXACTAMENTE cuatro bloques separados por "|||", sin ningún texto fuera de ellos.

BLOQUE 1 — DIAGNÓSTICO DE ESTA SEMANA:
Sintetiza el READINESS SCORE, la VFC vs tu baseline personal, la forma (TSB), el ACWR y el Body Battery/sueño para determinar el estado real (recuperado, fatigado, sobreentrenado, en forma). Da una recomendación semanal concreta coherente con el score. Máx 3 bullets, máx 16 palabras por bullet. Usa **negrita** para el diagnóstico clave.

|||

BLOQUE 2 — TENDENCIA Y PATRÓN (ÚLTIMOS 2 MESES):
Cruza el historial mensual con la evolución de CTL/forma para detectar progresión, estancamiento, pico-caída o lesión encubierta. Señala el mejor y peor período y si la rampa de carga es segura. Fija una recomendación de objetivo 4-6 semanas REALISTA según tus MARCAS PERSONALES (tope) y la DISPONIBILIDAD semanal. Máx 3 bullets, máx 16 palabras por bullet. Usa **negrita** para el patrón detectado.

|||

BLOQUE 3 — PRÓXIMO ENTRENAMIENTO RECOMENDADO:
Diseña la sesión de running más adecuada para los próximos 1-2 días, COHERENTE con el READINESS SCORE y la forma actual.

EL PRIMER BULLET DEBE SEGUIR ESTA PLANTILLA LITERAL EXACTA (para parseo automático), con esos cuatro campos en negrita y separados por " · ":
**{Tipo}** · **{X-Y km}** · **{M:SS-M:SS min/km}** · **Zona {N} · {ppm-ppm ppm}**
Ejemplo válido: **Tempo** · **8-10 km** · **4:45-5:00 min/km** · **Zona 3 · 158-168 ppm**
Donde {Tipo} es UNO de: Regenerativo, Aeróbico base, Tempo, Intervalos, Series, Rodaje largo. Usa SOLO rangos de ppm de "ZONAS DE FC CALCULADAS" y ritmos coherentes con "RITMOS DE REFERENCIA"; PROHIBIDO inventar cifras fuera de esos anclajes.

Después, 2-3 bullets adicionales (máx 30 palabras cada uno) con:
- Estructura de la sesión (calentamiento, bloques/series, vuelta a la calma) si aplica.
- Una condición fisiológica de seguridad concreta (ej: "para si FC>{valor}ppm", "si VFC sigue bajo baseline mañana, pásalo a regenerativo").
- Distribución de intensidad: cuenta el cruzado (fútbol, etc.) como la parte DURA del 80/20. Si tu carrera ya es 100% fácil y el cruzado cubre la intensidad, NO añadas calidad en carrera "para rellenar" el 0% de umbral. Con CTL bajo, el limitante es el VOLUMEN: prioriza progresar la tirada larga / km semanales, no frenar aún más el ritmo.
Usa **negrita** para el dato clave de cada bullet.

|||

BLOQUE 4 — ANÁLISIS DEL ÚLTIMO ENTRENAMIENTO:
Evalúa la sesión más reciente (datos abajo en "ÚLTIMO ENTRENAMIENTO"). Determina qué estímulo fue (regenerativo, aeróbico base, umbral/tempo, calidad/intervalos) según su %LTHR y %FCmax, si la ejecución fue coherente (ritmo acorde a la FC y al tipo de sesión, ajustado al desnivel), y si encaja con tu estado de forma actual y la distribución polarizada 80/20 (medida sobre carga TOTAL: carrera + cruzado). Si la sesión ya fue fácil (FC media en Z1/Z2), NO la penalices por serlo ni pidas ir aún más lento; un pico breve de FCmax por una cuesta o repecho en un rodaje fácil es NORMAL, no un error de ejecución. Si hay "Parciales por km", analiza la DISTRIBUCIÓN del esfuerzo (positive/negative split, desfallecimiento final, ritmo parejo o descontrol inicial) y refléjalo en el acierto/ajuste. Da exactamente 1 acierto y 1 ajuste accionable, y relaciónalo con tu fatiga/recuperación de hoy. Máx 3 bullets, máx 16 palabras por bullet. Usa **negrita** para el veredicto clave de cada bullet.

${athleteContext}

(En ZONAS DE FC y RITMOS DE REFERENCIA: usa esas cifras EXACTAS en el bloque 3, NO inventes.)

REGLAS ESTRICTAS DE SALIDA:
- NO escribas el encabezado "BLOQUE N — …" de cada bloque: es solo una instrucción para ti. Empieza cada bloque DIRECTAMENTE por su primer bullet.
- Sin introducción. Sin "el atleta". Habla directamente en segunda persona.
- Cada bullet empieza con el concepto en **negrita**.
- Límites de longitud: BLOQUES 1, 2 y 4 = máx 16 palabras por bullet. BLOQUE 3 = máx 30 palabras por bullet (necesita datos concretos).
- PROHIBIDO inventar cifras: usa SOLO los ppm de "ZONAS DE FC CALCULADAS" y los ritmos de "RITMOS DE REFERENCIA". Si un dato no está disponible, dilo, no lo estimes.
- Si faltan datos de wearable / readiness, sé conservador y prioriza base aeróbica.
- No repitas datos sin interpretarlos.
- COHERENCIA OBLIGATORIA: la prescripción del BLOQUE 3 debe ser coherente con el diagnóstico de los BLOQUES 1-2. Si el limitante es el bajo VOLUMEN y tu intensidad ya es correcta, la sesión recomendada debe CONSTRUIR volumen (rodaje más largo o tirada larga progresiva), nunca presentarse como "otro rodaje aún más lento/suave". No prescribas bajar el ritmo de un rodaje que ya fue fácil.
- Respeta EXACTAMENTE el formato de plantilla del primer bullet del BLOQUE 3.`;

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
