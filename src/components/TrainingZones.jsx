import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import { Card, Title, Text, Badge, Callout } from '@tremor/react';
import { karvonenBounds, classifyHR, POLARIZED_TARGETS } from '../lib/hrZones';
import { hrSegments, zoneMix, polarizedGroups, polarizationStatus } from '../lib/zoneMix';
import { weekStartKey } from '../lib/isoWeek';
import { monthKey } from '../lib/trainingLoad';

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


// ── Zone model ────────────────────────────────────────────────────────────────
// Karvonen es el ÚNICO modelo de zonas de la app. Antes convivía con un Seiler
// de 3 zonas derivado del LTHR y el atleta podía elegir: los mismos kilómetros
// salían Z2 en un modelo y Z3 en el otro, y la app no tenía UNA respuesta a
// "¿en qué zona corrí?". La lectura polarizada no se pierde — se obtiene
// agrupando estas cinco zonas (lib/zoneMix › polarizedGroups).
const MODEL = {
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
};

// ── Ventanas de tiempo ────────────────────────────────────────────────────────
// El reparto por zonas depende por completo de la ventana que se mire: dos
// meses cuentan el bloque actual, tres años cuentan la carrera entera. Antes
// estaba clavado a los 2 meses que usa la calibración del LTHR y no había forma
// de ver si el 80/20 aguanta a lo largo de una temporada.
const PERIODS = [
  { id: '1w',  days: 7    },
  { id: '1m',  days: 30   },
  { id: '3m',  days: 91   },
  { id: '6m',  days: 183  },
  { id: '1y',  days: 365  },
  { id: '2y',  days: 730  },
  { id: '3y',  days: 1095 },
  { id: 'all', days: null },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function TrainingZones({ activities, hrParams, onOpenCalibration }) {
  const { t, i18n } = useTranslation();
  const [groupBy,   setGroupBy]   = useState('month');
  const [evoMode,   setEvoMode]   = useState('hours');
  const [period,    setPeriod]    = useState('3m');
  // Zonas ocultas en el gráfico de evolución. Todas visibles por defecto: apagar
  // una es para AISLAR la lectura (ver solo el volumen duro, p. ej.), no el estado
  // normal. Solo afecta al pintado — los % siguen siendo sobre el tiempo total,
  // no se recalculan sobre lo que queda visible, que sería un número inventado.
  const [hiddenZones, setHiddenZones] = useState(() => new Set());
  const toggleZone = (name) => setHiddenZones(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  // ── Calibration (FCmax / FCreposo / LTHR) comes from useHrParams, shared with
  //    the splits table so no view can drift into its own idea of the zones. Se
  //    EDITA en Ajustes › Calibración (`HrCalibration`); aquí solo se lee. ──
  const {
    hrmax, hrrest, lthr, hrr,
    autoRest, lthrResult,
    maxOv, restOv, lthrOv,
  } = hrParams;

  const model = useMemo(() => ({
    ...MODEL,
    name: t('zones.karvonen_name'),
    desc: t('zones.karvonen_desc'),
    zones: MODEL.zones.map(z => ({
      ...z,
      label: t(`zones.karvonen_zones.z${z.id + 1}.label`, z.label),
      desc:  t(`zones.karvonen_zones.z${z.id + 1}.desc`,  z.desc),
    })),
  }), [t]);

  const bounds = useMemo(() => karvonenBounds({ hrmax, hrrest }), [hrmax, hrrest]);

  // ── Actividades dentro de la ventana elegida ──
  // Se filtra sobre el historial completo, no sobre `recentActivities`: ese
  // array es la ventana de calibración del LTHR y toparía cualquier período
  // largo en dos meses.
  const periodActivities = useMemo(() => {
    const days = PERIODS.find(p => p.id === period)?.days;
    if (!days) return activities ?? [];
    const cutoff = Date.now() - days * 86400000;
    return (activities ?? []).filter(a => new Date(a.start_date).getTime() >= cutoff);
  }, [activities, period]);

  // ── Time-in-zones distribution ──
  // El reparto lo cuenta lib/zoneMix, el mismo que usa la portada: si se contara
  // aquí, Hoy y Zonas podrían discrepar sobre el mismo mes.
  const mix = useMemo(() => zoneMix(periodActivities, bounds), [periodActivities, bounds]);

  const zoneStats = useMemo(() => {
    if (!mix.hasData) return [];
    return model.zones.map((z, i) => ({
      ...z, ...bounds[i],
      hours: +(mix.times[i] / 3600).toFixed(1),
      pct:   mix.pct[i],
    }));
  }, [mix, bounds, model]);

  // ── Weekly / Monthly evolution (dentro del período elegido) ──
  const evolutionData = useMemo(() => {
    if (!periodActivities.length) return [];
    const buckets = {};
    periodActivities.forEach(a => {
      const segs = hrSegments(a);
      if (!segs.length) return;
      const d = new Date(a.start_date);
      // `weekStartKey` / `monthKey` resuelven la clave en hora LOCAL: toISOString
      // movería a la semana o al mes anterior las sesiones de madrugada.
      const key = groupBy === 'week' ? weekStartKey(d) : monthKey(d);
      if (!buckets[key]) buckets[key] = { key, zones: new Array(bounds.length).fill(0) };
      for (const seg of segs) {
        const z = classifyHR(seg.hr, bounds);
        if (z >= 0) buckets[key].zones[z] += seg.time;
      }
    });
    const sorted = Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
    // Los topes solo evitan una barra ilegible en históricos largos; la ventana
    // real la fija el selector de período.
    return (groupBy === 'week' ? sorted.slice(-52) : sorted.slice(-36)).map(b => {
      const row = { name: fmtBucket(b.key, groupBy, i18n.language) };
      const total = b.zones.reduce((s, v) => s + v, 0);
      model.zones.forEach((z, i) => {
        row[z.name] = evoMode === 'pct'
          ? +(total ? (b.zones[i] / total) * 100 : 0).toFixed(1)
          : +(b.zones[i] / 3600).toFixed(2);
      });
      return row;
    });
  }, [periodActivities, bounds, model, groupBy, evoMode, i18n.language]);

  // ── Lectura polarizada: las 5 zonas agrupadas en fácil / gris / duro ──
  // La doctrina 80/20 no necesita un modelo de zonas propio: sale de agrupar
  // las de Karvonen (Z1+Z2 por debajo de LT1, Z3 la franja gris, Z4+Z5 en
  // umbral o por encima). El agrupado y los cortes viven en lib/zoneMix; aquí
  // solo se traduce la clave a texto.
  const polarization = useMemo(() => {
    if (zoneStats.length < 5) return null;
    const { low, mod, high } = polarizedGroups(zoneStats.map(z => z.pct));
    const key = polarizationStatus(low, mod, high);
    const easyCeil  = bounds[1]?.hi;   // techo de Z2: hasta aquí es fácil
    const hardFloor = bounds[3]?.lo;   // suelo de Z4: desde aquí es duro
    const nums = { z1: low.toFixed(0), z2: mod.toFixed(0), z3: high.toFixed(0) };
    const COPY = {
      ok:   { status: t('zones.seiler_status.ok'),   color: 'emerald',
              tip: t('hr_analysis.polarized_tip',     { ...nums, hi: easyCeil }) },
      gray: { status: t('zones.seiler_status.gray'), color: 'amber',
              tip: t('hr_analysis.gray_zone_tip',     { ...nums, hi: easyCeil, lo: hardFloor }) },
      low:  { status: t('zones.seiler_status.low'),  color: 'sky',
              tip: t('hr_analysis.low_intensity_tip', { ...nums, lo: hardFloor }) },
      mod:  { status: t('zones.seiler_status.mod'),  color: 'indigo',
              tip: t('hr_analysis.moderate_tip',      { ...nums }) },
    };
    return { low, mod, high, ...COPY[key] };
  }, [zoneStats, bounds, t]);

  // ── Confidence labels ──
  const confColor = lthrResult.confidence >= 70 ? 'emerald' : lthrResult.confidence >= 40 ? 'amber' : 'rose';
  const methodText = {
    cs:      t('zones.method_cs', { n: lthrResult.n }),
    segment: t('zones.method_segment', { n: lthrResult.n }),
    field:   t('zones.method_field', { n: lthrResult.n }),
    race:    t('zones.method_race', { n: lthrResult.n }),
    formula: t('zones.method_formula'),
    none:    t('zones.method_none'),
  }[lthrResult.method];

  const activitiesWithHR = periodActivities.filter(a => a.average_heartrate).length;

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

      {/* ── 1. Calibración (solo lectura) ───────────────────────────────────
          Los inputs viven en Ajustes › Calibración: son los tres números que
          mueven el PMC, los umbrales, las zonas de cada lap y el prompt del
          coach, no un ajuste de esta vista. Aquí se muestra con qué está
          calibrado lo que se pinta debajo. ─────────────────────────────────── */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Title className="text-slate-800 font-bold">{t('zones.title')}</Title>
            <Text className="text-slate-500 text-sm mt-0.5">
              {t('zones.subtitle', { count: activitiesWithHR })}
            </Text>
          </div>
          {onOpenCalibration && (
            <button
              onClick={onOpenCalibration}
              className="h-8 px-3 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600 text-xs font-semibold transition-colors shrink-0"
            >
              {t('zones.edit_calibration')}
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('zones.fc_max')}</p>
              <Badge color={maxOv ? 'violet' : 'sky'} size="xs">{maxOv ? t('zones.manual') : t('zones.auto')}</Badge>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{hrmax} <span className="text-xs font-medium text-slate-400">{t('zones.bpm')}</span></p>
          </div>

          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('zones.fc_rest')}</p>
              <Badge color={restOv ? 'violet' : autoRest.source === 'garmin' ? 'sky' : 'slate'} size="xs">
                {restOv ? t('zones.manual') : autoRest.source === 'garmin' ? 'Garmin' : t('zones.default_val')}
              </Badge>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{hrrest} <span className="text-xs font-medium text-slate-400">{t('zones.bpm')}</span></p>
          </div>

          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('zones.lthr')}</p>
              <Badge color={lthrOv ? 'violet' : confColor} size="xs">
                {lthrOv ? t('zones.manual') : `${lthrResult.confidence}% ${t('zones.conf')}`}
              </Badge>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{lthr} <span className="text-xs font-medium text-slate-400">{t('zones.bpm')}</span></p>
            <p className="text-[10px] text-slate-400 mt-0.5 truncate">{lthrOv ? t('zones.manual') : methodText}</p>
          </div>
        </div>

        <div className="mt-3 flex gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">HRR</span>
            <span className="text-sm font-bold text-indigo-700 tabular-nums">{hrr} {t('zones.bpm')}</span>
            <span className="text-[10px] text-indigo-400">({hrmax} − {hrrest})</span>
          </div>
          <div className="flex items-center gap-1.5 bg-violet-50 border border-violet-100 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">LTHR / FCmax</span>
            <span className="text-sm font-bold text-violet-700 tabular-nums">{((lthr / hrmax) * 100).toFixed(1)}%</span>
          </div>
        </div>
      </Card>

      {/* ── 2. Zone table ──────────────────────────────────── */}
      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div className="flex-1 min-w-0">
            <Title className="text-slate-800 font-bold">{model.name}</Title>
            <Text className="text-slate-400 text-[11px] mt-0.5 font-medium">{model.ref}</Text>
            <Text className="text-slate-500 text-sm mt-1">{model.desc}</Text>
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

      {/* ── Selector de período ──────────────────────────────────────────────
          Manda sobre el reparto, la evolución y la lectura polarizada; la
          calibración de arriba no se toca (esa ventana la fija la detección del
          LTHR). ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">
          {t('zones.period_label')}
        </span>
        {PERIODS.map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
              period === p.id
                ? 'bg-slate-700 text-white border-slate-700'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
            }`}
          >
            {t(`zones.periods.${p.id}`)}
          </button>
        ))}
      </div>

      {/* ── 3. Time in zones ────────────────────────────────────────────────── */}
      <Card className="shadow-lg border-slate-200">
        <div className="mb-5">
          <Title className="text-slate-800 font-bold">{t('zones.time_in_zones')}</Title>
          <Text className="text-slate-500 text-sm">
            {t('zones.time_in_zones_desc')}
          </Text>
          {/* Resolución del dato: una sesión sin parciales entra con su FC media y
              colapsa en UNA zona, lo que infla Z2 y borra el Z1 del calentamiento.
              Decirlo es la diferencia entre un % medido y un % supuesto. */}
          {mix.hasData && (
            <p className={`text-[11px] mt-1.5 font-medium ${mix.avgOnlySessions ? 'text-amber-600' : 'text-slate-400'}`}>
              {mix.avgOnlySessions
                ? t('zones.resolution_partial', { avg: mix.avgOnlySessions, total: mix.sessions })
                : t('zones.resolution_full', { total: mix.sessions })}
            </p>
          )}
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
            <div className="flex flex-wrap gap-1.5 mb-3">
              {model.zones.map(z => {
                const on = !hiddenZones.has(z.name);
                return (
                  <button
                    key={z.name}
                    onClick={() => toggleZone(z.name)}
                    aria-pressed={on}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                      on ? 'bg-white border-slate-200 hover:border-slate-400' : 'bg-slate-50 border-slate-100'
                    }`}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ background: on ? z.color : 'transparent', border: `1.5px solid ${z.color}`, opacity: on ? 1 : 0.45 }}
                    />
                    <span className={`text-[10px] font-medium ${on ? 'text-slate-500' : 'text-slate-300 line-through'}`}>
                      {z.name} {z.label}
                    </span>
                  </button>
                );
              })}
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
                  {model.zones.filter(z => !hiddenZones.has(z.name)).map(z => (
                    <Bar key={z.name} dataKey={z.name} stackId="a" fill={z.color} radius={0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Card>

      {/* ── 5. Lectura polarizada (Z1+Z2 / Z3 / Z4+Z5) ───────────────────────────────────────────── */}
      {polarization && (
        <Card className="shadow-lg border-slate-200">
          <Title className="text-slate-800 font-bold mb-5">{t('zones.polarization_title')}</Title>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: t('zones.polar_labels.z1'), val: polarization.low,  color: '#16a34a', bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.30)', target: `≥${POLARIZED_TARGETS.low}%` },
              { label: t('zones.polar_labels.z2'), val: polarization.mod,  color: '#d97706', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.30)', target: `≤${POLARIZED_TARGETS.mod}%` },
              { label: t('zones.polar_labels.z3'), val: polarization.high, color: '#dc2626', bg: 'rgba(248,113,113,0.10)',border: 'rgba(248,113,113,0.30)',target: `~${POLARIZED_TARGETS.high}%` },
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
            <div style={{ width: `${polarization.low}%`,  background: '#4ade80' }} />
            <div style={{ width: `${polarization.mod}%`,  background: '#fbbf24' }} />
            <div style={{ width: `${polarization.high}%`, background: '#f87171' }} />
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
