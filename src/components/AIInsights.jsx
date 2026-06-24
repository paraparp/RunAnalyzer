import { useState, useEffect, useCallback, useRef } from 'react';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { streamText } from 'ai';
import {
  SparklesIcon,
  ArrowPathIcon,
  HeartIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  BoltIcon,
  MoonIcon,
  FireIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { seilerBounds, karvonenBounds } from '../lib/hrZones';

// ── Inline markdown renderer (bold + bullet lists) ──────────────────────────
const MD = ({ text, accent }) => {
  if (!text) return null;
  const inline = (str) => {
    const parts = []; let rem = str, k = 0;
    while (rem) {
      const m = rem.match(/\*\*(.+?)\*\*/);
      if (m?.index !== undefined) {
        if (m.index > 0) parts.push(<span key={k++}>{rem.slice(0, m.index)}</span>);
        parts.push(<strong key={k++} className="font-semibold text-slate-800">{m[1]}</strong>);
        rem = rem.slice(m.index + m[0].length); continue;
      }
      parts.push(<span key={k++}>{rem}</span>); break;
    }
    return parts;
  };
  return (
    <ul className="space-y-1.5">
      {text.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => (
        <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-slate-600">
          <span className={`shrink-0 mt-[3px] font-bold text-[10px] ${accent}`}>▸</span>
          <span>{inline(l.replace(/^[-•*]\s+/, ''))}</span>
        </li>
      ))}
    </ul>
  );
};

// ── Skeleton loading ─────────────────────────────────────────────────────────
const Pulse = () => (
  <div className="space-y-2 animate-pulse mt-2">
    <div className="h-2.5 bg-slate-100 rounded-full w-3/4" />
    <div className="h-2.5 bg-slate-100 rounded-full w-full" />
    <div className="h-2.5 bg-slate-100 rounded-full w-5/6" />
  </div>
);

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
const buildPrompt = (activities, garminData, sleepData, weeklyTarget, goal) => {
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

  // ── HR zones (shared formulas with the TrainingZones tab — src/lib/hrZones) ─
  // Seiler polarized (LTHR-based) = primary anchor for the polarized 80/20 call.
  const [, sZ2, sZ3] = seilerBounds({ lthr });
  // Karvonen (HRR-based) supplementary — for the session-prescription ppm ranges.
  const [, kZ2, kZ3, kZ4] = karvonenBounds({ hrmax: fcmax, hrrest: fcRest });

  const hrZonesSummary = [
    `FCmax=${fcmax}ppm (mediana top 5% histórico)`,
    `FC reposo=${fcRest}ppm (Garmin más reciente)`,
    `LTHR=${lthr}ppm [método: ${lthrMethod}]${lthrIsEstimate ? ' (ESTIMADO por fórmula, sin umbral de campo detectado → trata los límites de zona como aproximados, no absolutos)' : ''}`,
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
Evalúa la sesión más reciente (datos abajo en "ÚLTIMO ENTRENAMIENTO"). Determina qué estímulo fue (regenerativo, aeróbico base, umbral/tempo, calidad/intervalos) según su %LTHR y %FCmax, si la ejecución fue coherente (ritmo acorde a la FC y al tipo de sesión, ajustado al desnivel), y si encaja con tu estado de forma actual y la distribución polarizada 80/20 (medida sobre carga TOTAL: carrera + cruzado). Si la sesión ya fue fácil (FC media en Z1/Z2), NO la penalices por serlo ni pidas ir aún más lento; un pico breve de FCmax por una cuesta o repecho en un rodaje fácil es NORMAL, no un error de ejecución. Da exactamente 1 acierto y 1 ajuste accionable, y relaciónalo con tu fatiga/recuperación de hoy. Máx 3 bullets, máx 16 palabras por bullet. Usa **negrita** para el veredicto clave de cada bullet.

DATOS DEL ATLETA:
${contextoTemporal}
${dispoLine}
${goalLine}
${dataGaps}
${readinessLine}

${pbSection ? `MARCAS PERSONALES (tu tope actual por distancia — referencia de potencial para calibrar ritmos objetivo y objetivos realistas):\n${pbSection}` : ''}

ZONAS DE FC CALCULADAS (usa estas referencias exactas de ppm en el bloque 3):
${hrZonesSummary}

RITMOS DE REFERENCIA (usa estas anclas para el ritmo del bloque 3, NO inventes):
${paceRefs}

MODELO DE CARGA (Banister PMC):
${pmcSection}

${physioSection ? `FISIOLOGÍA (wearable Garmin):\n${physioSection}` : 'Sin datos de wearable.'}
${garminLog ? `Garmin día a día (últimos 7d · ventana aguda; tendencia previa ya resumida en medias 7/14/28d):\n${garminLog}` : ''}
ENTRENAMIENTO (resumen 4 sem): ${trainingSection}
${crossNote ?? ''}
${lastSection ? `ÚLTIMO ENTRENAMIENTO (sesión más reciente, analízala en el BLOQUE 4):\n${lastSection}` : ''}
${actLog ? `Actividades últimas 8 semanas (más reciente primero; etiquetas: tipo de deporte y, en carreras, 🏁OFICIAL/tirada-larga/calidad según Strava; +Xm = desnivel):\n${actLog}` : ''}
Desglose semanal (carrera): ${weekTable}
Historial mensual de carrera (últimos 2 meses): ${monthHistory}

REGLAS ESTRICTAS DE SALIDA:
- Sin introducción. Sin "el atleta". Habla directamente en segunda persona.
- Cada bullet empieza con el concepto en **negrita**.
- Límites de longitud: BLOQUES 1, 2 y 4 = máx 16 palabras por bullet. BLOQUE 3 = máx 30 palabras por bullet (necesita datos concretos).
- PROHIBIDO inventar cifras: usa SOLO los ppm de "ZONAS DE FC CALCULADAS" y los ritmos de "RITMOS DE REFERENCIA". Si un dato no está disponible, dilo, no lo estimes.
- Si faltan datos de wearable / readiness, sé conservador y prioriza base aeróbica.
- No repitas datos sin interpretarlos.
- COHERENCIA OBLIGATORIA: la prescripción del BLOQUE 3 debe ser coherente con el diagnóstico de los BLOQUES 1-2. Si el limitante es el bajo VOLUMEN y tu intensidad ya es correcta, la sesión recomendada debe CONSTRUIR volumen (rodaje más largo o tirada larga progresiva), nunca presentarse como "otro rodaje aún más lento/suave". No prescribas bajar el ritmo de un rodaje que ya fue fácil.
- Respeta EXACTAMENTE el formato de plantilla del primer bullet del BLOQUE 3.`;

  return { prompt, sci: { readiness, pmc, hrv, rhr, bb, sleep, polarized, fcmax, fcRest, lthr } };
};


// ── Timestamp formatter ──────────────────────────────────────────────────────
const formatTs = (ts) => {
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

// ── Data-freshness formatter (whole-day granularity) ─────────────────────────
const formatDataDate = (input) => {
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

// ── Available Gemini models ──────────────────────────────────────────────────
const GEMINI_MODELS = [
  { id: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite · menos tokens' },
  { id: 'gemini-3.5-flash', label: '3.5 Flash · mejor calidad' },
  { id: 'gemini-2.5-flash', label: '2.5 Flash · equilibrado' },
];
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

// ── Main component ───────────────────────────────────────────────────────────
const AIInsights = ({ activities, onOpenChat }) => {
  const [cur, setCur] = useState('');
  const [trend, setTrend] = useState('');
  const [nextWork, setNextWork] = useState('');
  const [lastWork, setLastWork] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [garmin, setGarmin] = useState(undefined);
  const [sleep, setSleep] = useState(undefined);
  const [stravaFetch, setStravaFetch] = useState(null);
  const [sci, setSci] = useState(null);
  const [cacheTs, setCacheTs] = useState(null);
  const [restoreWarning, setRestoreWarning] = useState(false);
  const [providerLabel, setProviderLabel] = useState('');
  const [usedProvider, setUsedProvider] = useState('');
  const [isFallback, setIsFallback] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('ai_insights_model') || DEFAULT_MODEL
  );
  const [weeklyTarget, setWeeklyTarget] = useState(
    () => localStorage.getItem('ai_weekly_target') || '2'
  );
  // Defaults: 42K @ 5:30/km, Zurich Maratón de San Sebastián (47ª ed., dom 22 nov 2026).
  const [goalDist, setGoalDist] = useState(() => localStorage.getItem('ai_goal_distance') ?? '42K');
  const [goalPace, setGoalPace] = useState(() => localStorage.getItem('ai_goal_pace') ?? '5:30');
  const [goalDate, setGoalDate] = useState(() => localStorage.getItem('ai_goal_date') ?? '2026-11-22');
  // Local, uncommitted text for the pace field — committed to goalPace on blur/Enter
  // so typing doesn't fire a recompute (and a streaming API call) per keystroke.
  const [paceInput, setPaceInput] = useState(() => localStorage.getItem('ai_goal_pace') ?? '5:30');
  // Model list — starts with the hardcoded fallback, replaced by the live
  // ListModels response when the API key is available.
  const [availableModels, setAvailableModels] = useState(GEMINI_MODELS);

  // Fetch the real list of Gemini models for this API key (ListModels endpoint).
  useEffect(() => {
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) return;
    const ctrl = new AbortController();
    fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        // Exclude non-chat variants: robotics, TTS, image gen (Nano Banana),
        // audio, embeddings, vision-only, etc.
        const EXCLUDE = /robotics|tts|image|audio|embedding|aqa|vision|nano|gemma|learnlm/i;
        const models = (j?.models ?? [])
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .filter(m => m.name?.includes('gemini'))
          .filter(m => !EXCLUDE.test(m.name) && !EXCLUDE.test(m.displayName || ''))
          .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name.replace('models/', '') }))
          .sort((a, b) => b.id.localeCompare(a.id));
        if (models.length) setAvailableModels(models);
      })
      .catch(() => { /* keep hardcoded fallback */ });
    return () => ctrl.abort();
  }, []);

  // Ref to always-current state for backup/restore inside run (avoids stale closure)
  const stateRef = useRef({ cur, trend, nextWork, lastWork, cacheTs });
  useEffect(() => { stateRef.current = { cur, trend, nextWork, lastWork, cacheTs }; }, [cur, trend, nextWork, lastWork, cacheTs]);

  // Ref to abort ongoing stream on unmount or new run
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Load Garmin cardiac (HRV/RHR/Body Battery) + weekly sleep data
  const loadGarminData = () => {
    try {
      const s = localStorage.getItem('garmin_cardiac_data');
      if (s) { setGarmin(JSON.parse(s)); }
      else {
        fetch('/garmin_data.json')
          .then(r => r.ok ? r.json() : null)
          .then(j => setGarmin(j?.data ?? null))
          .catch(() => setGarmin(null));
      }
    } catch { setGarmin(null); }

    try {
      const sl = localStorage.getItem('garmin_sleep_data');
      setSleep(sl ? JSON.parse(sl) : null);
    } catch { setSleep(null); }

    try {
      const sd = localStorage.getItem('stravaData');
      setStravaFetch(sd ? (JSON.parse(sd).lastFetchDate ?? null) : null);
    } catch { setStravaFetch(null); }
  };

  useEffect(() => {
    loadGarminData();
    window.addEventListener('garmin_sync_complete', loadGarminData);
    return () => window.removeEventListener('garmin_sync_complete', loadGarminData);
  }, []);

  const run = useCallback(async (force = false) => {
    if (!activities?.length || activities.length < 3) return;
    const built = buildPrompt(activities, garmin, sleep, weeklyTarget, { distance: goalDist, pace: goalPace, date: goalDate });
    if (!built) return;
    const { prompt, sci: builtSci } = built;
    setSci(builtSci);

    // Check cache — key includes model so switching models bypasses cache
    if (!force) {
      try {
        const cached = localStorage.getItem('ai_insights_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.prompt === prompt && parsed.model === selectedModel && parsed.cur && parsed.trend) {
            setCur(parsed.cur);
            setTrend(parsed.trend);
            if (parsed.nextWork) setNextWork(parsed.nextWork);
            if (parsed.lastWork) setLastWork(parsed.lastWork);
            setCacheTs(parsed.timestamp);
            setUsedProvider(parsed.provider ?? '');
            setLoaded(true);
            return;
          }
        }
      } catch (e) {
        console.warn('Cache read error', e);
      }
    }

    // Build provider chain from available keys
    const providers = [
      {
        name: GEMINI_MODELS.find(m => m.id === selectedModel)?.label.split(' ·')[0] ?? 'Gemini',
        key: import.meta.env.VITE_GEMINI_API_KEY,
        getModel: (k) => createGoogleGenerativeAI({ apiKey: k })(selectedModel),
      },
      {
        name: 'Groq Llama',
        key: import.meta.env.VITE_GROQ_API_KEY,
        getModel: (k) => createGroq({ apiKey: k })('llama-3.3-70b-versatile'),
      },
    ].filter(p => p.key);

    if (!providers.length) {
      setCur('**Sin API Key configurada** · Añade `VITE_GEMINI_API_KEY` o `VITE_GROQ_API_KEY` en tu `.env`.');
      setTrend('');
      setLoaded(true);
      return;
    }

    // Snapshot current state via ref (avoids stale closure)
    const { cur: prevCur, trend: prevTrend, nextWork: prevNextWork, lastWork: prevLastWork, cacheTs: prevTs } = stateRef.current;
    try {
      localStorage.setItem('ai_insights_backup', JSON.stringify({
        cur: prevCur, trend: prevTrend, nextWork: prevNextWork, lastWork: prevLastWork, timestamp: prevTs,
      }));
    } catch { }

    // Abort any previous in-flight stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true); setCur(''); setTrend(''); setNextWork(''); setLastWork(''); setUsedProvider(''); setIsFallback(false);

    let succeeded = false;
    try {
      for (let i = 0; i < providers.length; i++) {
        if (controller.signal.aborted) break;
        const provider = providers[i];
        setIsFallback(i > 0);
        setProviderLabel(i === 0
          ? `Consultando ${provider.name}…`
          : `${providers[i - 1].name} falló · probando ${provider.name}…`
        );
        try {
          const res = streamText({
            model: provider.getModel(provider.key),
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.4,
            maxRetries: 0,
            abortSignal: controller.signal,
          });
          let full = '';
          for await (const chunk of res.textStream) {
            full += chunk;
            const parts = full.split('|||');
            if (parts.length >= 1) setCur(parts[0].trim());
            if (parts.length >= 2) setTrend(parts[1].trim());
            if (parts.length >= 3) setNextWork(parts[2].trim());
            if (parts.length >= 4) setLastWork(parts[3].trim());
          }
          setUsedProvider(provider.name);
          const parts = full.split('|||');
          const ts = Date.now();
          setCacheTs(ts);
          localStorage.setItem('ai_insights_cache', JSON.stringify({
            prompt,
            model: selectedModel,
            cur: (parts[0] ?? '').trim(),
            trend: (parts[1] ?? '').trim(),
            nextWork: (parts[2] ?? '').trim(),
            lastWork: (parts[3] ?? '').trim(),
            timestamp: ts,
            provider: provider.name,
          }));
          localStorage.removeItem('ai_insights_backup');
          succeeded = true;
          break;
        } catch (e) {
          if (controller.signal.aborted) break;
          console.warn(`[AIInsights] ${provider.name} falló:`, e);
          setCur(''); setTrend(''); setNextWork(''); setLastWork('');
        }
      }

      if (!succeeded && !controller.signal.aborted) {
        if (prevCur) {
          setCur(prevCur); setTrend(prevTrend); setNextWork(prevNextWork); setLastWork(prevLastWork); setCacheTs(prevTs);
          setRestoreWarning(true);
          setTimeout(() => setRestoreWarning(false), 6000);
        } else {
          setCur('**Sin respuesta de ningún modelo** · Puede ser rate-limit (429). Cambia de modelo en el selector o añade `VITE_GROQ_API_KEY` para activar el fallback.');
          setTrend(''); setNextWork(''); setLastWork('');
        }
      }
    } finally {
      setProviderLabel('');
      setLoading(false);
      setLoaded(true);
    }
  }, [activities, garmin, sleep, selectedModel, weeklyTarget, goalDist, goalPace, goalDate]);

  useEffect(() => {
    if (activities?.length >= 3 && garmin !== undefined && sleep !== undefined) run(false);
  }, [activities, garmin, sleep, run]);

  if (!activities || activities.length < 3) return null;

  const hasGarmin = garmin?.length > 0;

  // ── Data freshness (last sync of each source) ───────────────────────────────
  const garminDataDate = hasGarmin
    ? [...garmin].sort((a, b) => b.date.localeCompare(a.date))[0]?.date
    : null;
  const stravaFresh = formatDataDate(stravaFetch);
  const garminFresh = formatDataDate(garminDataDate);

  // ── Workout parser for the premium prescription ticket ──────────────────────
  // El BLOQUE 3 ahora emite un primer bullet con plantilla fija:
  //   **{Tipo}** · **{X-Y km}** · **{M:SS-M:SS min/km}** · **Zona {N} · {ppm-ppm ppm}**
  // Parseamos PRIMERO esa línea estructurada (alta confianza). Si no aparece
  // (modelo de fallback que no respeta formato), caemos a heurísticas laxas.
  const parseWorkout = (text) => {
    if (!text) return null;

    const result = { type: null, distance: null, pace: null, hrZone: null };

    // ── 1) Plantilla estructurada: localizar la línea con ≥2 separadores " · "
    //        y al menos una unidad km o ppm → es el bullet de prescripción.
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const ticketLine = lines.find(l => {
      const sepCount = (l.match(/·/g) || []).length;
      return sepCount >= 2 && /km/i.test(l) && /(ppm|zona)/i.test(l);
    });

    const stripBold = (s) => s.replace(/\*\*/g, '').trim();

    if (ticketLine) {
      // Quitar viñeta inicial y partir por " · "
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
      // La zona puede haber quedado en el último campo combinada con ppm:
      if (!result.hrZone) {
        const zAll = clean.match(/Zona\s*\d+(?:\s*·?\s*[0-9]+-[0-9]+\s*ppm)?/i);
        if (zAll) result.hrZone = zAll[0].replace(/\s+/g, ' ').trim();
      }
    }

    // ── 2) Fallback heurístico sobre todo el texto para campos que falten ────
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

    // Normaliza defaults sólo en el render (mantén null aquí para distinguir).
    return {
      type: result.type || 'Base Aeróbica',
      distance: result.distance,
      pace: result.pace,
      hrZone: result.hrZone,
    };
  };

  // Pasa el análisis actual al chat (RunQA) como contexto para preguntas de seguimiento.
  const openInChat = () => {
    try {
      const seed = {
        ts: Date.now(),
        blocks: { cur, trend, nextWork, lastWork },
        sci: sci ? {
          readiness: sci.readiness?.score ?? null,
          readinessLabel: sci.readiness?.label ?? null,
          ctl: sci.pmc?.ctl ?? null,
          atl: sci.pmc?.atl ?? null,
          tsb: sci.pmc?.tsb ?? null,
          acwr: sci.pmc?.acwr ?? null,
          fcmax: sci.fcmax ?? null,
          fcRest: sci.fcRest ?? null,
          lthr: sci.lthr ?? null,
        } : null,
      };
      localStorage.setItem('runqa_seed', JSON.stringify(seed));
    } catch { /* ignore quota/serialization errors */ }
    onOpenChat?.();
  };

  return (
    <div className="bg-white/70 backdrop-blur-3xl shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-slate-100 rounded-3xl overflow-hidden transition-all duration-300 relative">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100/60 bg-white/40">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-50/80 text-blue-600 shadow-sm">
            <SparklesIcon className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 leading-tight">Diagnóstico IA</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
              {hasGarmin ? 'Wearable VFC & Pulso · Carga de Entrenamiento' : 'Carga & Ritmos de Actividad Strava'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {cacheTs && !loading && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] text-slate-400 font-semibold">
              <ClockIcon className="w-3.5 h-3.5" />
              {formatTs(cacheTs)}
            </span>
          )}
          <select
            value={weeklyTarget}
            disabled={loading}
            title="Sesiones de carrera por semana que quieres hacer"
            onChange={e => {
              const v = e.target.value;
              localStorage.setItem('ai_weekly_target', v);
              setWeeklyTarget(v);
              setLoaded(false);
            }}
            className="text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 pr-7 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none shadow-sm"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {[2, 3, 4, 5, 6].map(n => (
              <option key={n} value={String(n)}>{n}×/sem</option>
            ))}
          </select>
          <select
            value={goalDist}
            disabled={loading}
            title="Objetivo de carrera"
            onChange={e => {
              const v = e.target.value;
              localStorage.setItem('ai_goal_distance', v);
              setGoalDist(v);
              setLoaded(false);
            }}
            className="text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 pr-7 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none shadow-sm"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            <option value="">Sin objetivo</option>
            {['5K', '10K', '21K', '42K'].map(d => (
              <option key={d} value={d}>Obj {d}</option>
            ))}
          </select>
          {goalDist && (
            <input
              type="text"
              inputMode="numeric"
              value={paceInput}
              disabled={loading}
              placeholder="4:30"
              title="Ritmo objetivo (min/km) — opcional, Enter para aplicar"
              onChange={e => setPaceInput(e.target.value)}
              onBlur={() => {
                const v = paceInput.trim();
                if (v === goalPace) return;
                localStorage.setItem('ai_goal_pace', v);
                setGoalPace(v);
                setLoaded(false);
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className="w-[58px] text-[11px] text-slate-600 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 font-bold text-center hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors shadow-sm placeholder:text-slate-300 placeholder:font-medium"
            />
          )}
          {goalDist && (
            <input
              type="date"
              value={goalDate}
              disabled={loading}
              title="Fecha de la carrera objetivo"
              onChange={e => {
                const v = e.target.value;
                localStorage.setItem('ai_goal_date', v);
                setGoalDate(v);
                setLoaded(false);
              }}
              className="text-[11px] text-slate-600 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors shadow-sm cursor-pointer"
            />
          )}
          <select
            value={selectedModel}
            disabled={loading}
            onChange={e => {
              const m = e.target.value;
              localStorage.setItem('ai_insights_model', m);
              setSelectedModel(m);
              setLoaded(false);
            }}
            className="text-[11px] text-slate-500 bg-white/80 border border-slate-200/80 rounded-xl px-2.5 py-1.5 pr-7 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 disabled:opacity-30 transition-colors cursor-pointer appearance-none shadow-sm"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {availableModels.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button
            onClick={() => { setLoaded(false); run(true); }}
            disabled={loading}
            title="Recalcular diagnóstico"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 disabled:opacity-30 transition-all border border-transparent hover:border-blue-100"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Analizando…' : 'Recalcular'}</span>
          </button>
        </div>
      </div>

      {/* ── Scientific readiness panel ── */}
      {sci?.readiness && (() => {
        const { score, label, band } = sci.readiness;
        const ring = band === 'high' ? 'text-emerald-600' : band === 'good' ? 'text-blue-600' : band === 'mod' ? 'text-amber-600' : 'text-rose-600';
        const ringBg = band === 'high' ? 'stroke-emerald-500' : band === 'good' ? 'stroke-blue-500' : band === 'mod' ? 'stroke-amber-500' : 'stroke-rose-500';
        const chips = [];
        const h = sci.hrv;
        if (h) {
          const inBase = h.baseline?.balancedLow != null
            ? (h.latest < h.baseline.balancedLow ? 'bajo baseline' : h.latest > h.baseline.balancedUpper ? 'sobre baseline' : 'en rango')
            : (h.status || '');
          chips.push({ k: 'VFC', v: `${h.latest}ms`, s: inBase });
        }
        if (sci.bb?.high != null) chips.push({ k: 'Body Battery', v: `${sci.bb.high}/100`, s: sci.bb.high >= 70 ? 'recuperado' : sci.bb.high >= 40 ? 'parcial' : 'bajo' });
        if (sci.sleep?.score != null) chips.push({ k: 'Sueño', v: `${sci.sleep.score}/100`, s: sci.sleep.durationMin ? `${(sci.sleep.durationMin / 60).toFixed(1)}h` : '' });
        if (sci.pmc) chips.push({ k: 'Forma TSB', v: `${sci.pmc.tsb > 0 ? '+' : ''}${sci.pmc.tsb}`, s: `ACWR ${sci.pmc.acwr ?? '—'}` });
        const R = 22, C = 2 * Math.PI * R, off = C * (1 - score / 100);
        return (
          <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-100/60 bg-gradient-to-r from-slate-50/40 to-white/20">
            <div className="relative shrink-0 w-[58px] h-[58px]">
              <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
                <circle cx="28" cy="28" r={R} className="stroke-slate-100" strokeWidth="5" fill="none" />
                <circle cx="28" cy="28" r={R} className={ringBg} strokeWidth="5" fill="none"
                  strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off}
                  style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
              </svg>
              <div className={`absolute inset-0 flex items-center justify-center font-black text-base tabular-nums ${ring}`}>{score}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">Readiness</span>
                <span className={`text-[10px] font-bold ${ring}`}>{label}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {chips.map(c => (
                  <span key={c.k} className="text-[10px] text-slate-400 font-medium">
                    {c.k} <span className="font-bold text-slate-600 tabular-nums">{c.v}</span>{c.s ? ` · ${c.s}` : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Loading status banner ── */}
      {loading && providerLabel && (
        <div className={`flex items-center gap-2 px-5 py-2.5 border-b text-[11px] font-bold ${isFallback
          ? 'bg-amber-50/70 border-amber-100 text-amber-700'
          : 'bg-blue-50/70 border-blue-100 text-blue-600'
          }`}>
          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin shrink-0" />
          {providerLabel}
        </div>
      )}

      {/* ── Restore warning banner ── */}
      {restoreWarning && (
        <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-50/70 border-b border-amber-100 text-[11px] text-amber-700 font-bold">
          <span className="shrink-0">⚠</span>
          Falló la actualización — mostrando la recomendación anterior guardada.
          <button
            onClick={() => setRestoreWarning(false)}
            className="ml-auto text-amber-400 hover:text-amber-600 transition-colors font-bold leading-none"
          >✕</button>
        </div>
      )}

      {/* ── Últimas actividades analizadas ── */}
      <div className="px-5 py-2.5 border-b border-slate-100/60 bg-slate-50/30 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0 flex items-center gap-1.5">
          <ClockIcon className="w-3.5 h-3.5" />
          Últimas 5 actividades
        </span>
        <div className="flex flex-wrap gap-2">
          {[...activities].sort((a, b) => new Date(b.start_date) - new Date(a.start_date)).slice(0, 5).map(a => {
            const tooltipParts = [];
            if (a.name) tooltipParts.push(a.name);
            tooltipParts.push(new Date(a.start_date).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
            if (a.total_elevation_gain) tooltipParts.push(`Desnivel: +${Math.round(a.total_elevation_gain)}m`);
            if (a.average_heartrate) tooltipParts.push(`FC Media: ${Math.round(a.average_heartrate)} ppm`);
            if (a.suffer_score) tooltipParts.push(`Esfuerzo: ${a.suffer_score}`);

            return (
              <div key={a.id} title={tooltipParts.join('\n')} className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200/80 rounded-md shadow-[0_1px_2px_rgba(0,0,0,0.02)] cursor-help hover:bg-slate-50 transition-colors">
                <span className="text-[9px] text-slate-400 font-medium border-r border-slate-100 pr-1.5">
                  {new Date(a.start_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                </span>
                <span className="text-[10px] font-bold text-slate-700 flex items-center gap-1">
                  <span>
                    {a.type === 'Ride' || a.type === 'VirtualRide' ? '🚴' :
                      a.type === 'Run' || a.type === 'TrailRun' || a.type === 'VirtualRun' ? '🏃' :
                        a.type === 'Swim' ? '🏊' :
                          a.type === 'Walk' || a.type === 'Hike' ? '🚶' :
                            a.type === 'WeightTraining' ? '🏋️' :
                              a.type === 'Yoga' ? '🧘' : '👟'}
                  </span>
                  {a.distance > 0 ? `${(a.distance / 1000).toFixed(1)}k` : `${Math.round((a.moving_time || 0) / 60)}min`}
                </span>
                {a.moving_time > 0 && a.distance > 0 && ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'].includes(a.type) && (
                  <span className="text-[9px] text-slate-400 font-medium border-l border-slate-100 pl-1.5">
                    {(() => {
                      const p = (a.moving_time / 60) / (a.distance / 1000);
                      return `${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`;
                    })()}
                  </span>
                )}
                {a.moving_time > 0 && a.distance > 0 && ['Ride', 'VirtualRide'].includes(a.type) && (
                  <span className="text-[9px] text-slate-400 font-medium border-l border-slate-100 pl-1.5">
                    {((a.distance / 1000) / (a.moving_time / 3600)).toFixed(1)} km/h
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {(stravaFresh || garminFresh) && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {stravaFresh && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400" title="Última actualización de datos de Strava">
                <ArrowPathIcon className="w-3 h-3 text-orange-400" />
                <span className="text-slate-500">Strava</span>
                <span className="text-slate-400 font-medium">{stravaFresh}</span>
              </span>
            )}
            {garminFresh && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400" title="Datos de Garmin disponibles hasta esta fecha">
                <ArrowPathIcon className="w-3 h-3 text-blue-400" />
                <span className="text-slate-500">Garmin</span>
                <span className="text-slate-400 font-medium">{garminFresh}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Análisis del último entrenamiento ── */}
      {(lastWork || (loading && cur)) && (() => {
        const last = [...activities].sort((a, b) => new Date(b.start_date) - new Date(a.start_date))[0];
        if (!last) return null;
        const km = last.distance / 1000;
        const min = (last.moving_time || 0) / 60;
        const isRun = ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'].includes(last.type);
        const meta = [];
        if (km > 0) meta.push(`${km.toFixed(1)} km`);
        if (min > 0) meta.push(`${Math.round(min)} min`);
        if (km > 0 && min > 0 && isRun) {
          const p = min / km;
          meta.push(`${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, '0')}/km`);
        } else if (km > 0 && min > 0 && ['Ride', 'VirtualRide'].includes(last.type)) {
          meta.push(`${(km / (min / 60)).toFixed(1)} km/h`);
        }
        if (last.average_heartrate) meta.push(`${Math.round(last.average_heartrate)} ppm`);
        if (last.total_elevation_gain) meta.push(`+${Math.round(last.total_elevation_gain)} m`);
        const icon = last.type === 'Ride' || last.type === 'VirtualRide' ? '🚴'
          : last.type === 'Swim' ? '🏊'
            : last.type === 'Walk' || last.type === 'Hike' ? '🚶'
              : last.type === 'WeightTraining' ? '🏋️'
                : last.type === 'Yoga' ? '🧘'
                  : isRun ? '🏃' : '👟';
        return (
          <div className="border-b border-slate-100/60 bg-gradient-to-r from-amber-50/20 to-rose-50/10 px-5 py-4">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="p-1.5 rounded-xl bg-amber-50 text-amber-600 shadow-sm border border-amber-100/40">
                <FireIcon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">Análisis del último entrenamiento</span>
                <span className="text-[10px] text-slate-400 font-semibold truncate block">
                  {icon} {last.name ? `${last.name} · ` : ''}{new Date(last.start_date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })}
                  {meta.length ? ` · ${meta.join(' · ')}` : ''}
                </span>
              </div>
            </div>
            <div className="bg-white/60 rounded-2xl p-4 border border-slate-100/60">
              {loading && !lastWork ? <Pulse /> : <MD text={lastWork} accent="text-amber-500" />}
            </div>
          </div>
        );
      })()}

      {/* ── Content grid: Diagnosis + Trend ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100/60">

        {/* Block 1: Current state */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HeartIcon className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Estado actual</span>
              <span className="text-[10px] text-slate-400 font-medium">· últimas 4 semanas</span>
            </div>
            {cur && (() => {
              const text = cur.toLowerCase();
              let badge = { text: 'Adaptativo 📈', color: 'bg-slate-50 text-slate-600 border-slate-200' };
              if (text.includes('fatig') || text.includes('cansad')) {
                badge = { text: 'Fatiga acumulada ⚠️', color: 'bg-orange-50 text-orange-700 border-orange-200' };
              } else if (text.includes('recuperad') || text.includes('estable')) {
                badge = { text: 'Recuperado ✅', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
              } else if (text.includes('sobreentren')) {
                badge = { text: 'Sobreentrenamiento 🚨', color: 'bg-rose-50 text-rose-700 border-rose-200' };
              } else if (text.includes('forma') || text.includes('óptim') || text.includes('fuerte')) {
                badge = { text: 'En forma ⚡', color: 'bg-blue-50 text-blue-700 border-blue-200' };
              }
              return (
                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${badge.color}`}>
                  {badge.text}
                </span>
              );
            })()}
          </div>

          <div className="bg-slate-50/40 rounded-2xl p-4 border border-slate-100/50 hover:bg-slate-50/70 transition-colors duration-300">
            {loading && !cur ? <Pulse /> : <MD text={cur} accent="text-blue-500" />}
          </div>
        </div>

        {/* Block 2: Annual trend */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowTrendingUpIcon className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Tendencia y patrón</span>
              <span className="text-[10px] text-slate-400 font-medium">· últimos 2 meses</span>
            </div>
            {trend && (() => {
              const text = trend.toLowerCase();
              let badge = { text: 'Estacional 📅', color: 'bg-slate-50 text-slate-600 border-slate-200' };
              // Prioridad: riesgo > meseta/interrumpida > progresión. Evita que
              // "progresión interrumpida/estancada" se etiquete como progresión real.
              const negated = /interrump|estanc|meseta|estabil|caíd|caid|pérdida|perdida|insuficien|frena|detien/.test(text);
              if (text.includes('lesi') || text.includes('dolor') || text.includes('riesgo')) {
                badge = { text: 'Riesgo de lesión ⚠️', color: 'bg-rose-50 text-rose-700 border-rose-200' };
              } else if (text.includes('estanc') || text.includes('meseta') || text.includes('estabil') || text.includes('interrump') || text.includes('insuficien')) {
                badge = { text: 'Meseta / Estable 📊', color: 'bg-amber-50 text-amber-700 border-amber-200' };
              } else if ((text.includes('progres') || text.includes('mejor')) && !negated) {
                badge = { text: 'Progresión constante 📈', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
              }
              return (
                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${badge.color}`}>
                  {badge.text}
                </span>
              );
            })()}
          </div>

          <div className="bg-slate-50/40 rounded-2xl p-4 border border-slate-100/50 hover:bg-slate-50/70 transition-colors duration-300">
            {loading && !trend ? <Pulse /> : <MD text={trend} accent="text-indigo-500" />}
          </div>
        </div>
      </div>

      {/* ── Block 3: Next workout ── */}
      {(nextWork || (loading && cur && trend && !nextWork)) && (
        <div className="border-t border-slate-100/60 bg-gradient-to-r from-blue-50/10 to-indigo-50/10 p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="p-1.5 rounded-xl bg-blue-50 text-blue-600 shadow-sm border border-blue-100/40">
              <BoltIcon className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">Sesión Recomendada</span>
              <span className="text-[10px] text-slate-400 font-semibold">Prescripción de running sugerida para tus próximos 1-2 días</span>
            </div>
          </div>

          {loading && !nextWork ? (
            <Pulse />
          ) : (
            <div className="flex flex-col lg:flex-row gap-5 items-stretch">
              {/* Prescription Ticket Badge */}
              {(() => {
                const w = parseWorkout(nextWork);
                return (
                  <>
                    <div className="flex-1 bg-white border border-slate-100/70 rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col justify-between relative overflow-hidden">
                      <div className="absolute right-0 top-0 w-24 h-24 rounded-full bg-blue-500/5 blur-2xl pointer-events-none" />

                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Prescripción IA</span>
                          <span className={`inline-flex items-center px-3 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${w?.type?.toLowerCase().includes('regen') ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/60' :
                            w?.type?.toLowerCase().includes('tempo') ? 'bg-amber-50 text-amber-700 border border-amber-100/60' :
                              w?.type?.toLowerCase().includes('interv') || w?.type?.toLowerCase().includes('seri') ? 'bg-rose-50 text-rose-700 border border-rose-100/60' :
                                'bg-blue-50 text-blue-700 border border-blue-100/60'
                            }`}>
                            {w?.type || 'Sesión Base'}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100/30 text-center">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider mb-1">Distancia</span>
                            <span className="text-xs font-black text-slate-800 truncate block">
                              {w?.distance || 'Varía'}
                            </span>
                          </div>
                          <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100/30 text-center">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider mb-1">Ritmo Objetivo</span>
                            <span className="text-xs font-black text-slate-800 truncate block">
                              {w?.pace || 'Aeróbico'}
                            </span>
                          </div>
                          <div className="bg-slate-50/50 rounded-2xl p-3 border border-slate-100/30 text-center">
                            <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider mb-1">Intensidad</span>
                            <span className="text-xs font-black text-slate-800 truncate block">
                              {w?.hrZone || 'Zona 2'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100/60 flex items-center gap-2 text-[10px] text-slate-400 font-semibold">
                        <span className="text-xs">💡</span>
                        <span>Sigue las pautas de ritmo y mantente hidratado.</span>
                      </div>
                    </div>

                    {/* Full guidelines list */}
                    <div className="flex-1 bg-white/40 border border-slate-100/70 rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col justify-center">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-3">Guías de Ejecución</span>
                      <MD text={nextWork} accent="text-blue-600" />
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── Footer badge ── */}
      <div className="px-5 py-2.5 bg-slate-50/60 border-t border-slate-100/60 flex items-center justify-between gap-2 bg-white/40">
        <div className="flex items-center gap-1.5 min-w-0">
          <SparklesIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-[10px] text-slate-400 font-semibold truncate">
            {usedProvider || 'IA'} · Recomendación inteligente · Basada en tu carga de entrenamiento
          </span>
        </div>
        {onOpenChat && (cur || trend || nextWork) && (
          <button
            onClick={openInChat}
            title="Abrir el chat con este análisis como contexto"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 transition-colors"
          >
            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
            Seguir preguntando en el chat
          </button>
        )}
      </div>
    </div>
  );
};

export default AIInsights;