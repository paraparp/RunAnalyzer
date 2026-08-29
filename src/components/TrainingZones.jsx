import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import { Card, Title, Text, Badge, Callout } from '@tremor/react';
import {
  seilerBounds, karvonenBounds, estimateLTHR, classifyHR,
  SEILER_TARGETS, HR_LIMITS,
} from '../lib/hrZones';

// ─── Scientific References ────────────────────────────────────────────────────
// [1] Karvonen et al. (1957) Ann Med Exp Biol Fenn — Heart Rate Reserve: %HRR ≈ %VO2R
// [2] Seiler & Kjerland (2006) Scand J Med Sci Sports — Polarized 3-zone model
// [3] Stöggl & Sperlich (2014) Front Physiol — Polarized > threshold/HVT in trained athletes
// [4] Friel (2009) The Triathlete's Training Bible — LTHR estimation fallback
// [5] Tanaka et al. (2001) J Am Coll Cardiol — HRmax = 208 − 0.7 × age (meta-analysis n=351)
// [6] Kindermann et al. (1979) Int J Sports Med — LT1/LT2 physiological basis
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtBucket = (key, groupBy, lang = 'en') => {
    if (groupBy === 'week') {
        const d = new Date(key + 'T00:00:00');
        return `${d.getDate()}/${d.getMonth() + 1}`;
    }
    const [y, m] = key.split('-');
    return new Date(+y, +m - 1).toLocaleDateString(lang, { month: 'short', year: '2-digit' });
};

// Per-segment HR samples ({ hr, time }) for time-in-zone accounting. Classifying
// a whole run by its single average HR collapses it into ONE zone — a month of
// easy-ish runs then reads as 100% Z2, which is physically impossible (every run
// has warm-up in Z1, hills/surges into Z3+). The per-km splits (or laps) recover
// the real spread. Falls back to the activity average only when no per-segment HR
// exists (older runs whose splits haven't been enriched yet).
const hrSegments = (a) => {
    const src = (a.splits_metric?.length > 1 && a.splits_metric)
             || (a.laps?.length > 1 && a.laps)
             || null;
    if (src) {
        const segs = src
            .filter(s => s.average_heartrate && (s.moving_time || s.elapsed_time))
            .map(s => ({ hr: s.average_heartrate, time: s.moving_time || s.elapsed_time }));
        if (segs.length) return segs;
    }
    return a.average_heartrate && a.moving_time
        ? [{ hr: a.average_heartrate, time: a.moving_time }]
        : [];
};

// ── Zone models ───────────────────────────────────────────────────────────────
const MODELS = {
  seiler: {
    shortName: 'Seiler',
    name: 'Seiler 3-Zonas  ·  Modelo Polarizado',
    ref: 'Seiler & Kjerland, 2006 · Stöggl & Sperlich, 2014',
    desc: 'El modelo más respaldado por evidencia científica para atletas de resistencia. Divide en fácil / umbral / intenso. Base del entrenamiento 80/20.',
    zones: [
      { id: 0, name: 'Z1', label: 'Base Aeróbica',    desc: 'Conversacional, oxidación de grasas, desarrollo mitocondrial.', color: '#4ade80', bg: 'rgba(74,222,128,0.10)', target: SEILER_TARGETS.z1 },
      { id: 1, name: 'Z2', label: 'Zona Umbral',       desc: '"Zona gris" — fisiológicamente costosa pero sin las adaptaciones de Z1 o Z3.', color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', target: SEILER_TARGETS.z2 },
      { id: 2, name: 'Z3', label: 'Alta Intensidad',   desc: 'Intervalos, VO2max, anaeróbico. Adaptaciones neuromusculares y cardíacas.', color: '#f87171', bg: 'rgba(248,113,113,0.10)', target: SEILER_TARGETS.z3 },
    ],
    getBounds: seilerBounds,
  },

  karvonen: {
    shortName: 'Karvonen',
    name: 'Karvonen 5-Zonas  ·  Heart Rate Reserve',
    ref: 'Karvonen et al., 1957 · cortes 10% HRR (estándar Garmin/Polar)',
    desc: 'Usa la Reserva de FC (FCmax − FCreposo). Más preciso que %FCmax porque incorpora tu condición física base. %HRR ≈ %VO2R [1].',
    zones: [
      { id: 0, name: 'Z1', label: 'Recuperación',     desc: '<60% HRR. Trote muy suave, recuperación activa, < 2 mmol/L lactato.', color: '#94a3b8', bg: 'rgba(148,163,184,0.10)' },
      { id: 1, name: 'Z2', label: 'Base Aeróbica',    desc: '60–70% HRR. Fondo fácil, LT1, oxidación de grasas.',                  color: '#38bdf8', bg: 'rgba(56,189,248,0.10)'   },
      { id: 2, name: 'Z3', label: 'Aeróbico Intenso', desc: '70–80% HRR. Fondo medio, tempo suave.',                               color: '#4ade80', bg: 'rgba(74,222,128,0.10)'   },
      { id: 3, name: 'Z4', label: 'Umbral Lactato',   desc: '80–90% HRR. Tempo, LT2, ~4 mmol/L lactato.',                          color: '#fb923c', bg: 'rgba(251,146,60,0.10)'    },
      { id: 4, name: 'Z5', label: 'VO2max / Sprint',  desc: '>90% HRR. Anaeróbico, capacidad máxima, sprints.',                    color: '#f87171', bg: 'rgba(248,113,113,0.10)'   },
    ],
    getBounds: karvonenBounds,
  },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function TrainingZones({ activities, hrParams }) {
  const { t, i18n } = useTranslation();
  const [modelKey,  setModelKey]  = useState('seiler');
  const [groupBy,   setGroupBy]   = useState('month');
  const [evoMode,   setEvoMode]   = useState('hours');

  // ── Calibration (FCmax / FCreposo / LTHR) comes from useHrParams, shared with
  //    the splits table so no view can drift into its own idea of the zones. ──
  const {
    hrmax, hrrest, lthr, hrr,
    autoMax, autoRest, lthrResult, recentActivities,
    userMax, setUserMax, userRest, setUserRest, userLTHR, setUserLTHR,
    maxOv, restOv, lthrOv, invalidMax, invalidRest, invalidLTHR,
  } = hrParams;

  const translatedModels = useMemo(() => ({
    seiler: {
        ...MODELS.seiler,
        name: t('zones.seiler_name'),
        desc: t('zones.seiler_desc'),
        zones: MODELS.seiler.zones.map(z => ({
            ...z,
            label: t(`zones.polar_labels.${z.name.toLowerCase()}`),
            desc: t(`hr_analysis.${z.name.toLowerCase()}_desc`, z.desc) 
        }))
    },
    karvonen: {
        ...MODELS.karvonen,
        name: t('zones.karvonen_name'),
        desc: t('zones.karvonen_desc'),
        zones: MODELS.karvonen.zones.map(z => ({
            ...z,
            label: t(`zones.karvonen_zones.z${z.id + 1}.label`, z.label),
            desc: t(`zones.karvonen_zones.z${z.id + 1}.desc`, z.desc)
        }))
    },
  }), [t]);

  const model  = translatedModels[modelKey];
  const bounds = useMemo(() => model.getBounds({ lthr, hrmax, hrrest }), [model, lthr, hrmax, hrrest]);

  // ── Time-in-zones distribution ──
  const zoneStats = useMemo(() => {
    if (!recentActivities?.length) return [];
    const times = new Array(bounds.length).fill(0);
    let total = 0;
    recentActivities.forEach(a => {
      for (const seg of hrSegments(a)) {
        const z = classifyHR(seg.hr, bounds);
        if (z >= 0) { times[z] += seg.time; total += seg.time; }
      }
    });
    if (!total) return [];
    return model.zones.map((z, i) => ({
      ...z, ...bounds[i],
      hours: +(times[i] / 3600).toFixed(1),
      pct:   +((times[i] / total) * 100).toFixed(1),
    }));
  }, [recentActivities, bounds, model]);

  // ── Weekly / Monthly evolution (full history — the 2-month window only applies
  //    to calibration and time-in-zones, otherwise "monthly" would never show >3 bars) ──
  const evolutionData = useMemo(() => {
    if (!activities?.length) return [];
    const buckets = {};
    activities.forEach(a => {
      const segs = hrSegments(a);
      if (!segs.length) return;
      const d = new Date(a.start_date);
      let key;
      if (groupBy === 'week') {
        const w = new Date(d);
        const day = w.getDay();
        w.setDate(w.getDate() - day + (day === 0 ? -6 : 1));
        // Local-date key (toISOString would shift Monday-night activities to the
        // previous week for timezones ahead of UTC)
        key = `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`;
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      if (!buckets[key]) buckets[key] = { key, zones: new Array(bounds.length).fill(0) };
      for (const seg of segs) {
        const z = classifyHR(seg.hr, bounds);
        if (z >= 0) buckets[key].zones[z] += seg.time;
      }
    });
    const sorted = Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
    return (groupBy === 'week' ? sorted.slice(-16) : sorted.slice(-12)).map(b => {
      const row = { name: fmtBucket(b.key, groupBy, i18n.language) };
      const total = b.zones.reduce((s, v) => s + v, 0);
      model.zones.forEach((z, i) => {
        row[z.name] = evoMode === 'pct'
          ? +(total ? (b.zones[i] / total) * 100 : 0).toFixed(1)
          : +(b.zones[i] / 3600).toFixed(2);
      });
      return row;
    });
  }, [activities, bounds, model, groupBy, evoMode, i18n.language]);

  // ── Seiler polarization analysis (thresholds derived from SEILER_TARGETS ±tolerance) ──
  const polarization = useMemo(() => {
    if (modelKey !== 'seiler' || zoneStats.length < 3) return null;
    const z1 = zoneStats[0]?.pct ?? 0;
    const z2 = zoneStats[1]?.pct ?? 0;
    const z3 = zoneStats[2]?.pct ?? 0;

    let status, tip, color;
    if (z1 >= SEILER_TARGETS.z1 - 5 && z2 <= SEILER_TARGETS.z2 + 5) {
      status = t('zones.seiler_status.ok'); color = 'emerald';
      tip = t('hr_analysis.polarized_tip', { z1: z1.toFixed(0), z2: z2.toFixed(0), z3: z3.toFixed(0), hi: bounds[0]?.hi });
    } else if (z2 > SEILER_TARGETS.z2 + 10) {
      status = t('zones.seiler_status.gray'); color = 'amber';
      tip = t('hr_analysis.gray_zone_tip', { z1: z1.toFixed(0), z2: z2.toFixed(0), z3: z3.toFixed(0), hi: bounds[0]?.hi, lo: bounds[2]?.lo });
    } else if (z3 < SEILER_TARGETS.z3 / 2) {
      status = t('zones.seiler_status.low'); color = 'sky';
      tip = t('hr_analysis.low_intensity_tip', { z3: z3.toFixed(0), lo: bounds[2]?.lo });
    } else {
      status = t('zones.seiler_status.mod'); color = 'indigo';
      tip = t('hr_analysis.moderate_tip', { z1: z1.toFixed(0), z2: z2.toFixed(0), z3: z3.toFixed(0) });
    }
    return { z1, z2, z3, status, tip, color };
  }, [modelKey, zoneStats, bounds, t]);

  // ── Confidence labels ──
  const confColor = lthrResult.confidence >= 70 ? 'emerald' : lthrResult.confidence >= 40 ? 'amber' : 'rose';
  const methodText = {
    segment: t('zones.method_segment', { n: lthrResult.n }),
    field:   t('zones.method_field', { n: lthrResult.n }),
    race:    t('zones.method_race', { n: lthrResult.n }),
    formula: t('zones.method_formula'),
    none:    t('zones.method_none'),
  }[lthrResult.method];

  const activitiesWithHR = recentActivities?.filter(a => a.average_heartrate)?.length ?? 0;

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
          <Title className="text-slate-800 font-bold">{t('zones.title')}</Title>
          <Text className="text-slate-500 text-sm mt-0.5">
            {t('zones.subtitle', { count: activitiesWithHR })}
          </Text>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* HRmax */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('zones.fc_max')}</p>
              <Badge color={maxOv ? 'violet' : 'sky'} size="xs">{maxOv ? t('zones.manual') : t('zones.auto')}</Badge>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{hrmax}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{t('zones.bpm')} · {maxOv ? t('zones.manual').toLowerCase() : t('zones.detected').toLowerCase()}</p>
            <input
              type="number" placeholder={`${autoMax.value} (auto)`} value={userMax}
              onChange={e => setUserMax(e.target.value)}
              className={`mt-3 w-full px-2.5 py-1.5 text-xs bg-white border rounded-lg focus:outline-none focus:ring-2 tabular-nums text-center font-semibold ${
                invalidMax ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-400' : 'border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-300'
              }`}
            />
            {invalidMax && <p className="text-[9px] text-rose-500 mt-1">{t('zones.out_of_range', { lo: HR_LIMITS.maxLo, hi: HR_LIMITS.maxHi })}</p>}
            <p className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">{t('zones.hrmax_desc')}</p>
          </div>

          {/* HRrest */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('zones.fc_rest')}</p>
              <Badge color={restOv ? 'violet' : autoRest.source === 'garmin' ? 'sky' : 'slate'} size="xs">
                {restOv ? t('zones.manual') : autoRest.source === 'garmin' ? 'Garmin' : t('zones.default_val')}
              </Badge>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{hrrest}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{t('zones.bpm')} · {restOv ? t('zones.manual').toLowerCase() : autoRest.source === 'garmin' ? t('zones.detected').toLowerCase() : t('zones.default_val').toLowerCase()}</p>
            <input
              type="number" placeholder={`${autoRest.value}`} value={userRest}
              onChange={e => setUserRest(e.target.value)}
              className={`mt-3 w-full px-2.5 py-1.5 text-xs bg-white border rounded-lg focus:outline-none focus:ring-2 tabular-nums text-center font-semibold ${
                invalidRest ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-400' : 'border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-300'
              }`}
            />
            {invalidRest && <p className="text-[9px] text-rose-500 mt-1">{t('zones.out_of_range', { lo: HR_LIMITS.restLo, hi: Math.min(HR_LIMITS.restHi, hrmax - 20) })}</p>}
            <p className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">{t('zones.hrrest_desc')}</p>
          </div>

          {/* LTHR */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('zones.lthr')}</p>
              <Badge color={lthrOv ? 'violet' : confColor} size="xs">
                {lthrOv ? t('zones.manual') : `${lthrResult.confidence}% ${t('zones.conf')}`}
              </Badge>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{lthr}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{lthrOv ? t('zones.manual') : methodText}</p>
            <input
              type="number" placeholder={`${lthrResult.lthr ?? estimateLTHR(hrmax)} (auto)`} value={userLTHR}
              onChange={e => setUserLTHR(e.target.value)}
              className={`mt-3 w-full px-2.5 py-1.5 text-xs bg-white border rounded-lg focus:outline-none focus:ring-2 tabular-nums text-center font-semibold ${
                invalidLTHR ? 'border-rose-300 focus:ring-rose-500/20 focus:border-rose-400' : 'border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-300'
              }`}
            />
            {invalidLTHR && <p className="text-[9px] text-rose-500 mt-1">{t('zones.out_of_range', { lo: hrrest + 10, hi: hrmax })}</p>}
            <p className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">{t('zones.lthr_desc')}</p>
          </div>
        </div>

        {/* Derived stats row */}
        <div className="mt-4 flex gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">HRR</span>
            <span className="text-sm font-bold text-indigo-700 tabular-nums">{hrr} {t('zones.bpm')}</span>
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
          <Title className="text-slate-800 font-bold">{t('zones.time_in_zones')}</Title>
          <Text className="text-slate-500 text-sm">
            {t('zones.time_in_zones_desc')}
            {modelKey === 'seiler' && ` · ${t('hr_analysis.bars_obj_8020')}`}
          </Text>
        </div>

        {zoneStats.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">{t('hr_analysis.no_data')}</div>
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
                          {t('zones.target_label')} {z.target}%
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
            <Title className="text-slate-800 font-bold">{t('zones.evolution')}</Title>
            <Text className="text-slate-500 text-sm">{t('zones.evolution_desc')}</Text>
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
                {g === 'month' ? t('zones.monthly') : t('zones.weekly')}
              </button>
            ))}
            <div className="w-px bg-slate-200 mx-1" />
            {['hours', 'pct'].map(m => (
              <button
                key={m}
                onClick={() => setEvoMode(m)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                  evoMode === m
                    ? 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                }`}
              >
                {m === 'hours' ? 'h' : '%'}
              </button>
            ))}
          </div>
        </div>

        {evolutionData.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">{t('hr_analysis.no_data')}</div>
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
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} unit={evoMode === 'pct' ? '%' : 'h'} domain={evoMode === 'pct' ? [0, 100] : undefined} />
                  <RechartsTooltip
                    contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: 11, boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                    formatter={(v, name) => [`${v}${evoMode === 'pct' ? '%' : 'h'}`, name]}
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
          <Title className="text-slate-800 font-bold mb-5">{t('zones.polarization_title')}</Title>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: t('zones.polar_labels.z1'), val: polarization.z1, color: '#16a34a', bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.30)', target: `≥${SEILER_TARGETS.z1}%` },
              { label: t('zones.polar_labels.z2'), val: polarization.z2, color: '#d97706', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.30)', target: `≤${SEILER_TARGETS.z2}%` },
              { label: t('zones.polar_labels.z3'), val: polarization.z3, color: '#dc2626', bg: 'rgba(248,113,113,0.10)',border: 'rgba(248,113,113,0.30)',target: `~${SEILER_TARGETS.z3}%` },
            ].map(row => (
              <div key={row.label} className="text-center p-4 rounded-xl" style={{ background: row.bg, border: `1px solid ${row.border}` }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: row.color }}>{row.label}</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: row.color }}>{row.val.toFixed(0)}%</p>
                <p className="text-[10px] mt-0.5 text-slate-400">{t('zones.target_label')} {row.target}</p>
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
              <span className="font-semibold text-slate-500">{t('zones.scientific_base')}:</span>{' '}
              {t('hr_analysis.seiler_scientific_base')}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
