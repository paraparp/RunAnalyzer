import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import { Card, Title, Text, Badge, Callout } from '@tremor/react';

// ─── Scientific References ────────────────────────────────────────────────────
// [1] Karvonen et al. (1957) Ann Med Exp Biol Fenn — Heart Rate Reserve: %HRR ≈ %VO2R
// [2] Seiler & Kjerland (2006) Scand J Med Sci Sports — Polarized 3-zone model
// [3] Stöggl & Sperlich (2014) Front Physiol — Polarized > threshold/HVT in trained athletes
// [4] Friel (2009) The Triathlete's Training Bible — LTHR 7-zone system
// [5] Tanaka et al. (2001) J Am Coll Cardiol — HRmax = 208 − 0.7 × age (meta-analysis n=351)
// [6] ACSM Guidelines 10th ed. — %HRmax 5-zone classification
// [7] Kindermann et al. (1979) Int J Sports Med — LT1/LT2 physiological basis
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtBucket = (key, groupBy) => {
  if (groupBy === 'week') {
    const d = new Date(key + 'T00:00:00');
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1).toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
};

// ── Zone models ───────────────────────────────────────────────────────────────
const MODELS = {
  seiler: {
    shortName: 'Seiler',
    name: 'Seiler 3-Zonas  ·  Modelo Polarizado',
    ref: 'Seiler & Kjerland, 2006 · Stöggl & Sperlich, 2014',
    desc: 'El modelo más respaldado por evidencia científica para atletas de resistencia. Divide en fácil / umbral / intenso. Base del entrenamiento 80/20.',
    zones: [
      { id: 0, name: 'Z1', label: 'Base Aeróbica',    desc: 'Conversacional, oxidación de grasas, desarrollo mitocondrial.', color: '#4ade80', bg: 'rgba(74,222,128,0.10)', target: 75 },
      { id: 1, name: 'Z2', label: 'Zona Umbral',       desc: '"Zona gris" — fisiológicamente costosa pero sin las adaptaciones de Z1 o Z3.', color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', target: 5 },
      { id: 2, name: 'Z3', label: 'Alta Intensidad',   desc: 'Intervalos, VO2max, anaeróbico. Adaptaciones neuromusculares y cardíacas.', color: '#f87171', bg: 'rgba(248,113,113,0.10)', target: 20 },
    ],
    getBounds: ({ lthr }) => [
      { lo: 0,                         hi: Math.round(lthr * 0.925) - 1 },
      { lo: Math.round(lthr * 0.925),  hi: lthr - 1                     },
      { lo: lthr,                       hi: 999                          },
    ],
  },

  karvonen: {
    shortName: 'Karvonen',
    name: 'Karvonen 5-Zonas  ·  Heart Rate Reserve',
    ref: 'Karvonen et al., 1957',
    desc: 'Usa la Reserva de FC (FCmax − FCreposo). Más preciso que %FCmax porque incorpora tu condición física base. %HRR ≈ %VO2R [1].',
    zones: [
      { id: 0, name: 'Z1', label: 'Regeneración',    desc: '<50% HRR. Recuperación activa, < 2 mmol/L lactato.',       color: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
      { id: 1, name: 'Z2', label: 'Base Aeróbica',   desc: '50–60% HRR. Base resistencia, LT1, oxidación de grasas.',  color: '#38bdf8', bg: 'rgba(56,189,248,0.10)'   },
      { id: 2, name: 'Z3', label: 'Aeróbico Intenso',desc: '60–70% HRR. Fondo largo, acumulación leve de lactato.',    color: '#4ade80', bg: 'rgba(74,222,128,0.10)'   },
      { id: 3, name: 'Z4', label: 'Umbral Lactato',   desc: '70–85% HRR. Tempo, LT2, ~4 mmol/L lactato.',             color: '#fb923c', bg: 'rgba(251,146,60,0.10)'    },
      { id: 4, name: 'Z5', label: 'VO2max / Sprint',  desc: '>85% HRR. Anaeróbico, capacidad máxima, sprints.',        color: '#f87171', bg: 'rgba(248,113,113,0.10)'   },
    ],
    getBounds: ({ hrmax, hrrest }) => {
      const hrr = hrmax - hrrest;
      const b = (p) => Math.round(hrrest + p * hrr);
      return [
        { lo: 0,       hi: b(0.50) - 1 },
        { lo: b(0.50), hi: b(0.60) - 1 },
        { lo: b(0.60), hi: b(0.70) - 1 },
        { lo: b(0.70), hi: b(0.85) - 1 },
        { lo: b(0.85), hi: 999          },
      ];
    },
  },

  friel: {
    shortName: 'Friel',
    name: 'Friel 7-Zonas  ·  LTHR',
    ref: 'Friel, 2009 — The Triathlete\'s Training Bible',
    desc: 'Sistema basado en LTHR (FC en el umbral de lactato). Muy utilizado por triatletas y ciclistas de élite para prescribir cargas de entrenamiento con precisión.',
    zones: [
      { id: 0, name: 'Z1',  label: 'Recuperación',        desc: '<85% LTHR. Esfuerzo muy ligero, recuperación.', color: '#a3e635', bg: 'rgba(163,230,53,0.10)'     },
      { id: 1, name: 'Z2',  label: 'Aeróbico Extensivo',  desc: '85–89% LTHR. Fácil-moderado, fondo largo.',   color: '#34d399', bg: 'rgba(52,211,153,0.10)'     },
      { id: 2, name: 'Z3',  label: 'Aeróbico Intensivo',  desc: '90–94% LTHR. Tempo suave, fondo medio.',      color: '#38bdf8', bg: 'rgba(56,189,248,0.10)'     },
      { id: 3, name: 'Z4',  label: 'Umbral Anaeróbico',   desc: '95–99% LTHR. Ritmo de carrera objetivo.',     color: '#fbbf24', bg: 'rgba(251,191,36,0.10)'     },
      { id: 4, name: 'Z5a', label: 'Sub-Anaeróbico',      desc: '100–102% LTHR. Justo sobre el umbral.',       color: '#fb923c', bg: 'rgba(251,146,60,0.10)'     },
      { id: 5, name: 'Z5b', label: 'Anaeróbico',          desc: '103–106% LTHR. Alta acumulación de lactato.', color: '#f87171', bg: 'rgba(248,113,113,0.10)'    },
      { id: 6, name: 'Z5c', label: 'Pico Neuromuscular',  desc: '>106% LTHR. Sprints y arranques máximos.',    color: '#e879f9', bg: 'rgba(232,121,249,0.10)'    },
    ],
    getBounds: ({ lthr }) => {
      const z = (p) => Math.round(lthr * p);
      return [
        { lo: 0,       hi: z(0.85) - 1 },
        { lo: z(0.85), hi: z(0.90) - 1 },
        { lo: z(0.90), hi: z(0.95) - 1 },
        { lo: z(0.95), hi: z(1.00) - 1 },
        { lo: z(1.00), hi: z(1.03) - 1 },
        { lo: z(1.03), hi: z(1.06) - 1 },
        { lo: z(1.06), hi: 999          },
      ];
    },
  },

  acsm: {
    shortName: 'ACSM',
    name: 'ACSM 5-Zonas  ·  % FCmax',
    ref: 'ACSM Guidelines for Exercise Testing and Prescription, 10th ed.',
    desc: 'Estándar del Colegio Americano de Medicina Deportiva. El más simple al no requerir FCreposo ni LTHR. Adecuado como punto de partida.',
    zones: [
      { id: 0, name: 'Z1', label: 'Muy Ligero',   desc: '<57% FCmax. Calentamiento, recuperación activa.',  color: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
      { id: 1, name: 'Z2', label: 'Ligero',        desc: '57–63% FCmax. Quema grasas, baja intensidad.',    color: '#60a5fa', bg: 'rgba(96,165,250,0.10)'   },
      { id: 2, name: 'Z3', label: 'Moderado',      desc: '64–76% FCmax. Aeróbico, fondo, LT1.',             color: '#34d399', bg: 'rgba(52,211,153,0.10)'   },
      { id: 3, name: 'Z4', label: 'Vigoroso',      desc: '77–95% FCmax. Umbral de lactato, esfuerzo alto.', color: '#fb923c', bg: 'rgba(251,146,60,0.10)'   },
      { id: 4, name: 'Z5', label: 'Muy Vigoroso',  desc: '>95% FCmax. Anaeróbico, pico absoluto.',          color: '#ef4444', bg: 'rgba(239,68,68,0.10)'    },
    ],
    getBounds: ({ hrmax }) => {
      const z = (p) => Math.round(hrmax * p);
      return [
        { lo: 0,       hi: z(0.57) - 1 },
        { lo: z(0.57), hi: z(0.64) - 1 },
        { lo: z(0.64), hi: z(0.77) - 1 },
        { lo: z(0.77), hi: z(0.95) - 1 },
        { lo: z(0.95), hi: 999          },
      ];
    },
  },
};

// ── Auto-calibration ──────────────────────────────────────────────────────────

// Detect LTHR from training data using threshold-run heuristics.
// Strategy 1 (field, highest confidence): sustained hard efforts 18–70 min
//   • avg HR > 82% HRmax  →  genuinely hard
//   • avg/max HR ratio > 0.92  →  sustained (not a spiked effort)
//   → median of qualifying runs' average HR = LTHR estimate
// Strategy 2 (race): workout_type===1 or high suffer_score
//   → p75 of race avg HR × 0.97 (races are ~3% above LTHR, Friel)
// Strategy 3 (formula): Friel's approximation LTHR ≈ 87.5% HRmax
function detectLTHR(activities, maxHR) {
  if (!activities?.length || !maxHR) return { lthr: null, confidence: 0, method: 'none', n: 0 };

  const thresholdRuns = activities.filter(a => {
    if (!a.average_heartrate || !a.max_heartrate || !a.moving_time) return false;
    const mins   = a.moving_time / 60;
    const avgPct = a.average_heartrate / maxHR;
    const sustain= a.average_heartrate / a.max_heartrate;
    return mins >= 18 && mins <= 70 && avgPct >= 0.82 && avgPct < 0.97 && sustain >= 0.92;
  });

  if (thresholdRuns.length >= 3) {
    const hrs = thresholdRuns.map(a => a.average_heartrate).sort((a, b) => a - b);
    const median = hrs[Math.floor(hrs.length / 2)];
    const conf   = Math.min(92, 40 + thresholdRuns.length * 7);
    return { lthr: Math.round(median), confidence: conf, method: 'field', n: thresholdRuns.length };
  }

  const raceRuns = activities.filter(a =>
    a.average_heartrate && (a.workout_type === 1 || (a.suffer_score && a.suffer_score > 150))
  );
  if (raceRuns.length >= 1) {
    const hrs = raceRuns.map(a => a.average_heartrate).sort((a, b) => a - b);
    const p75  = hrs[Math.floor(hrs.length * 0.75)] ?? hrs[hrs.length - 1];
    return { lthr: Math.round(p75 * 0.97), confidence: 45, method: 'race', n: raceRuns.length };
  }

  return { lthr: Math.round(maxHR * 0.875), confidence: 25, method: 'formula', n: 0 };
}

// Estimate resting HR from easy long runs (15th percentile HR × 0.56)
function detectRestHR(activities) {
  if (!activities?.length) return 60;
  const hrs = activities
    .filter(a => a.average_heartrate && a.moving_time > 2400)
    .map(a => a.average_heartrate)
    .sort((a, b) => a - b);
  if (!hrs.length) return 60;
  const easy = hrs[Math.floor(hrs.length * 0.15)];
  return Math.max(38, Math.min(78, Math.round(easy * 0.56)));
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TrainingZones({ activities }) {
  const [modelKey,  setModelKey]  = useState('seiler');
  const [groupBy,   setGroupBy]   = useState('month');
  const [userMax,   setUserMax]   = useState('');
  const [userRest,  setUserRest]  = useState('');
  const [userLTHR,  setUserLTHR]  = useState('');

  // ── Auto-detected parameters ──
  const autoMaxHR = useMemo(() => {
    if (!activities?.length) return 185;
    const hrs = activities.filter(a => a.max_heartrate).map(a => a.max_heartrate);
    return hrs.length ? Math.max(...hrs) : 185;
  }, [activities]);

  const autoRestHR = useMemo(() => detectRestHR(activities ?? []), [activities]);

  const lthrResult = useMemo(() => detectLTHR(activities ?? [], autoMaxHR), [activities, autoMaxHR]);

  // ── Effective parameters (manual overrides take priority) ──
  const hrmax  = userMax  ? +userMax  : autoMaxHR;
  const hrrest = userRest ? +userRest : autoRestHR;
  const lthr   = userLTHR ? +userLTHR : (lthrResult.lthr ?? Math.round(hrmax * 0.875));
  const hrr    = hrmax - hrrest;

  const model  = MODELS[modelKey];
  const bounds = useMemo(() => model.getBounds({ lthr, hrmax, hrrest }), [model, lthr, hrmax, hrrest]);

  // ── Classify HR → zone index (inline, no closure dependency issue) ──
  const classifyHR = (hr, bds) => {
    if (!hr) return -1;
    for (let i = bds.length - 1; i >= 0; i--)
      if (hr >= bds[i].lo) return i;
    return 0;
  };

  // ── Time-in-zones distribution ──
  const zoneStats = useMemo(() => {
    if (!activities?.length) return [];
    const times = new Array(bounds.length).fill(0);
    let total = 0;
    activities.forEach(a => {
      if (!a.average_heartrate || !a.moving_time) return;
      const z = classifyHR(a.average_heartrate, bounds);
      if (z >= 0) { times[z] += a.moving_time; total += a.moving_time; }
    });
    if (!total) return [];
    return model.zones.map((z, i) => ({
      ...z, ...bounds[i],
      hours: +(times[i] / 3600).toFixed(1),
      pct:   +((times[i] / total) * 100).toFixed(1),
    }));
  }, [activities, bounds, model]);

  // ── Weekly / Monthly evolution ──
  const evolutionData = useMemo(() => {
    if (!activities?.length) return [];
    const buckets = {};
    activities.forEach(a => {
      if (!a.average_heartrate || !a.moving_time) return;
      const d = new Date(a.start_date);
      let key;
      if (groupBy === 'week') {
        const w = new Date(d);
        const day = w.getDay();
        w.setDate(w.getDate() - day + (day === 0 ? -6 : 1));
        key = w.toISOString().split('T')[0];
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      if (!buckets[key]) buckets[key] = { key, zones: new Array(bounds.length).fill(0) };
      const z = classifyHR(a.average_heartrate, bounds);
      if (z >= 0) buckets[key].zones[z] += a.moving_time;
    });
    const sorted = Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
    return (groupBy === 'week' ? sorted.slice(-16) : sorted.slice(-12)).map(b => {
      const row = { name: fmtBucket(b.key, groupBy) };
      model.zones.forEach((z, i) => { row[z.name] = +(b.zones[i] / 3600).toFixed(2); });
      return row;
    });
  }, [activities, bounds, model, groupBy]);

  // ── Seiler polarization analysis ──
  const polarization = useMemo(() => {
    if (modelKey !== 'seiler' || zoneStats.length < 3) return null;
    const z1 = zoneStats[0]?.pct ?? 0;
    const z2 = zoneStats[1]?.pct ?? 0;
    const z3 = zoneStats[2]?.pct ?? 0;

    let status, tip, color;
    if (z1 >= 70 && z2 <= 15) {
      status = 'Distribución Polarizada ✅'; color = 'emerald';
      tip = `${z1.toFixed(0)}% Z1 / ${z2.toFixed(0)}% Z2 / ${z3.toFixed(0)}% Z3 — Excelente adherencia al modelo 80/20. ` +
        `Stöggl & Sperlich (2014) demostraron que la distribución polarizada supera al entrenamiento en umbral en mejoras de VO2max, velocidad en umbral y rendimiento en carrera. Mantén los días fáciles verdaderamente fáciles (<${bounds[0]?.hi} bpm).`;
    } else if (z2 > 20) {
      status = 'Trampa de la Zona Gris ⚠️'; color = 'amber';
      tip = `Un ${z2.toFixed(0)}% del tiempo en Z2 (zona umbral). Seiler denomina Z2 la "zona gris": es fisiológicamente costosa para recuperarse pero no genera las adaptaciones aeróbicas de Z1 (mitocondrias, densidad capilar) ni las neuromusculares/VO2max de Z3. ` +
        `Convierte ese tiempo en Z1 más suave (<${bounds[0]?.hi} bpm) o en intervalos Z3 estructurados (>${bounds[2]?.lo} bpm).`;
    } else if (z3 < 10) {
      status = 'Falta Estímulo de Alta Intensidad ⚠️'; color = 'sky';
      tip = `Solo ${z3.toFixed(0)}% en Z3. Los estímulos de alta intensidad (intervalos, repeticiones) son imprescindibles para progresar el VO2max y la economía de carrera. ` +
        `Añade 1–2 sesiones/semana por encima de ${bounds[2]?.lo} bpm (intervalos 3–5 min, repeticiones de colina, fartlek).`;
    } else {
      status = 'Distribución Moderada 📊'; color = 'indigo';
      tip = `Distribución actual ${z1.toFixed(0)} / ${z2.toFixed(0)} / ${z3.toFixed(0)} % (Z1/Z2/Z3). El objetivo polarizado es ~75 / 5 / 20. ` +
        `Intenta desplazar el tiempo de Z2 hacia Z1 (días de recuperación más lentos) o hacia Z3 (sesiones específicas de calidad).`;
    }
    return { z1, z2, z3, status, tip, color };
  }, [modelKey, zoneStats, bounds]);

  // ── Confidence labels ──
  const confColor = lthrResult.confidence >= 70 ? 'emerald' : lthrResult.confidence >= 40 ? 'amber' : 'rose';
  const methodText = {
    field:   `Auto-detectado de ${lthrResult.n} entrenam. umbral`,
    race:    `Estimado de ${lthrResult.n} competición(es)`,
    formula: '87.5% FCmax  (Friel, apróx.)',
    none:    'Sin datos suficientes',
  }[lthrResult.method];

  const activitiesWithHR = activities?.filter(a => a.average_heartrate)?.length ?? 0;

  // ── BPM range string ──
  const bpmRange = (lo, hi) =>
    lo <= 0 ? `< ${hi} bpm` : hi >= 999 ? `≥ ${lo} bpm` : `${lo}–${hi} bpm`;

  const pctMaxRange = (lo, hi) => {
    if (!hrmax) return '';
    const loP = lo > 0  ? Math.round((lo / hrmax) * 100) : 0;
    const hiP = hi < 999? Math.round((hi / hrmax) * 100) : null;
    return hiP ? `${loP}–${hiP}% FCmax` : `≥${loP}% FCmax`;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── 1. Calibration ──────────────────────────────────────────────────── */}
      <Card className="shadow-lg border-slate-200">
        <div className="mb-5">
          <Title className="text-slate-800 font-bold">Zonas de Frecuencia Cardíaca</Title>
          <Text className="text-slate-500 text-sm mt-0.5">
            Calibración de parámetros fisiológicos individuales · {activitiesWithHR} actividades con datos de FC
          </Text>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* HRmax */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">FC Máxima</p>
              <Badge color={userMax ? 'violet' : 'sky'} size="xs">{userMax ? 'Manual' : 'Auto'}</Badge>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{hrmax}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">bpm {userMax ? 'introducidos' : 'detectados'}</p>
            <input
              type="number" placeholder={`${autoMaxHR} (auto)`} value={userMax}
              onChange={e => setUserMax(e.target.value)}
              className="mt-3 w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 tabular-nums text-center font-semibold"
            />
            <p className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">Máx. observada en todos los entrenamientos. Tanaka (2001): 208 − 0.7 × edad.</p>
          </div>

          {/* HRrest */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">FC Reposo</p>
              <Badge color={userRest ? 'violet' : 'slate'} size="xs">{userRest ? 'Manual' : 'Estimada'}</Badge>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{hrrest}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">bpm {userRest ? 'introducidos' : 'estimados'}</p>
            <input
              type="number" placeholder={`${autoRestHR} (estimada)`} value={userRest}
              onChange={e => setUserRest(e.target.value)}
              className="mt-3 w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 tabular-nums text-center font-semibold"
            />
            <p className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">Usada por Karvonen (HRR = FCmax − FCreposo). Mídela antes de levantarte por la mañana.</p>
          </div>

          {/* LTHR */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">LTHR (Umbral)</p>
              <Badge color={userLTHR ? 'violet' : confColor} size="xs">
                {userLTHR ? 'Manual' : `${lthrResult.confidence}% conf.`}
              </Badge>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{lthr}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{methodText}</p>
            <input
              type="number" placeholder={`${lthr} (auto)`} value={userLTHR}
              onChange={e => setUserLTHR(e.target.value)}
              className="mt-3 w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 tabular-nums text-center font-semibold"
            />
            <p className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">Test: FC media en los últimos 20 min de un esfuerzo máximo sostenido de 30 min (Friel, 2009).</p>
          </div>
        </div>

        {/* Derived stats row */}
        <div className="mt-4 flex gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">HRR</span>
            <span className="text-sm font-bold text-indigo-700 tabular-nums">{hrr} bpm</span>
            <span className="text-[10px] text-indigo-400">({hrmax} − {hrrest})</span>
          </div>
          <div className="flex items-center gap-1.5 bg-violet-50 border border-violet-100 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">LTHR / FCmax</span>
            <span className="text-sm font-bold text-violet-700 tabular-nums">{((lthr / hrmax) * 100).toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">LTHR / HRR</span>
            <span className="text-sm font-bold text-emerald-700 tabular-nums">{hrr > 0 ? (((lthr - hrrest) / hrr) * 100).toFixed(1) : '–'}%</span>
          </div>
        </div>
      </Card>

      {/* ── 2. Model selector + Zone table ──────────────────────────────────── */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div className="flex-1 min-w-0">
            <Title className="text-slate-800 font-bold">{model.name}</Title>
            <Text className="text-slate-400 text-[11px] mt-0.5 font-medium">{model.ref}</Text>
            <Text className="text-slate-500 text-sm mt-1">{model.desc}</Text>
          </div>
          <div className="flex gap-1.5 flex-wrap shrink-0">
            {Object.entries(MODELS).map(([key, m]) => (
              <button
                key={key}
                onClick={() => setModelKey(key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  modelKey === key
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                {m.shortName}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {model.zones.map((z, i) => (
            <div
              key={z.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: z.bg }}
            >
              <div className="w-1.5 self-stretch rounded-full shrink-0" style={{ background: z.color }} />
              <div className="w-10 shrink-0">
                <span className="text-xs font-bold text-slate-700">{z.name}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700">{z.label}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{z.desc}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold text-slate-700 tabular-nums">{bpmRange(bounds[i]?.lo ?? 0, bounds[i]?.hi ?? 999)}</p>
                <p className="text-[10px] text-slate-400 tabular-nums mt-0.5">{pctMaxRange(bounds[i]?.lo ?? 0, bounds[i]?.hi ?? 999)}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── 3. Time in zones ────────────────────────────────────────────────── */}
      <Card className="shadow-lg border-slate-200">
        <div className="mb-5">
          <Title className="text-slate-800 font-bold">Tiempo en Zonas</Title>
          <Text className="text-slate-500 text-sm">
            Distribución por FC media por actividad
            {modelKey === 'seiler' && ' · Las barras verticales indican el objetivo del modelo 80/20'}
          </Text>
        </div>

        {zoneStats.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">Sin actividades con datos de FC</div>
        ) : (
          <div className="space-y-4">
            {zoneStats.map((z) => {
              const overTarget = z.target && z.pct > z.target * 1.35;
              const underTarget = z.target && z.pct < z.target * 0.5 && z.target > 15;
              return (
                <div key={z.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: z.color }} />
                      <span className="text-xs font-bold text-slate-700">{z.name}</span>
                      <span className="text-xs text-slate-500">{z.label}</span>
                      <span className="text-[10px] text-slate-400 tabular-nums">{bpmRange(z.lo ?? 0, z.hi ?? 999)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {z.target && (
                        <span className={`text-[10px] font-semibold ${overTarget ? 'text-rose-500' : underTarget ? 'text-amber-500' : 'text-slate-400'}`}>
                          obj {z.target}%
                        </span>
                      )}
                      <span className="text-xs font-bold text-slate-700 tabular-nums w-10 text-right">{z.pct}%</span>
                      <span className="text-xs text-slate-400 tabular-nums w-10 text-right">{z.hours}h</span>
                    </div>
                  </div>
                  <div className="relative h-7 bg-slate-100 rounded-lg overflow-hidden">
                    {z.target && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-slate-500/40 z-10"
                        style={{ left: `${Math.min(z.target, 99)}%` }}
                      />
                    )}
                    <div
                      className="absolute inset-y-0 left-0 rounded-lg flex items-center px-2.5 transition-all duration-500"
                      style={{ width: `${Math.max(z.pct, 1)}%`, background: z.color }}
                    >
                      {z.pct > 7 && (
                        <span className="text-[11px] font-bold text-white whitespace-nowrap">{z.pct}%</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── 4. Evolution chart ──────────────────────────────────────────────── */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <Title className="text-slate-800 font-bold">Evolución Temporal</Title>
            <Text className="text-slate-500 text-sm">Horas en cada zona por período</Text>
          </div>
          <div className="flex gap-1.5">
            {['month', 'week'].map(g => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  groupBy === g
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                }`}
              >
                {g === 'month' ? 'Mensual' : 'Semanal'}
              </button>
            ))}
          </div>
        </div>

        {evolutionData.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">Sin datos</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              {model.zones.map(z => (
                <div key={z.name} className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: z.color }} />
                  <span className="text-[10px] text-slate-500 font-medium">{z.name} {z.label}</span>
                </div>
              ))}
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={evolutionData} barSize={groupBy === 'week' ? 9 : 18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} unit="h" />
                  <RechartsTooltip
                    contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: 11, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                    formatter={(v, name) => [`${v}h`, name]}
                  />
                  {model.zones.map(z => (
                    <Bar key={z.name} dataKey={z.name} stackId="a" fill={z.color} radius={0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Card>

      {/* ── 5. Seiler Polarization ───────────────────────────────────────────── */}
      {polarization && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-5">Análisis de Polarización — Modelo Seiler 80/20</Title>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Z1 · Base Aeróbica', val: polarization.z1, color: '#16a34a', bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.30)', target: '≥75%' },
              { label: 'Z2 · Zona Gris',     val: polarization.z2, color: '#d97706', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.30)', target: '≤10%' },
              { label: 'Z3 · Alta Intensidad',val: polarization.z3, color: '#dc2626', bg: 'rgba(248,113,113,0.10)',border: 'rgba(248,113,113,0.30)',target: '~20%' },
            ].map(row => (
              <div key={row.label} className="text-center p-4 rounded-xl" style={{ background: row.bg, border: `1px solid ${row.border}` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: row.color }}>{row.label}</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: row.color }}>{row.val.toFixed(0)}%</p>
                <p className="text-[10px] mt-0.5 text-slate-400">Objetivo {row.target}</p>
              </div>
            ))}
          </div>

          {/* Distribution bar */}
          <div className="h-5 rounded-full overflow-hidden flex mb-5">
            <div style={{ width: `${polarization.z1}%`, background: '#4ade80' }} />
            <div style={{ width: `${polarization.z2}%`, background: '#fbbf24' }} />
            <div style={{ width: `${polarization.z3}%`, background: '#f87171' }} />
          </div>

          <Callout title={polarization.status} color={polarization.color} className="text-sm">
            {polarization.tip}
          </Callout>

          {/* Reference note */}
          <div className="mt-4 p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <p className="text-[10px] text-slate-400 leading-relaxed">
              <span className="font-semibold text-slate-500">Base científica:</span>{' '}
              Seiler & Kjerland (2006) analizaron a esquiadores de élite y descubrieron que el 75–80% del volumen se realizaba en Z1.
              Stöggl & Sperlich (2014) compararon en ensayo controlado 4 modelos de distribución (HIT, umbral, HVT, polarizado) y concluyeron que el entrenamiento polarizado producía las mayores mejoras en VO2max, velocidad en umbral de lactato y rendimiento en carrera.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
