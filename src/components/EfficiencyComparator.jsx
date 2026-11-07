import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchSelect, SearchSelectItem } from '@tremor/react';
import {
  ComposedChart, LineChart, Line, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import { XMarkIcon } from '@heroicons/react/20/solid';
import CollapsibleSection from './CollapsibleSection';
import ExpandableChart from './ExpandableChart';
import { readStoredGarminActivities } from '../lib/garminActivitiesSync';
import { matchGarminByStart, parseHrSourcePolicy, resolveActivityHrSource } from '../lib/hrSource';
import { normalizeWeatherTemps, wbgtFromCelsius } from '../lib/weather';
import { gapFactor } from '../lib/gap';
import cloudStorage from '../lib/cloudStorage';
import { scopeFromISO } from '../lib/timeScope';
import useTimeScope from '../hooks/useTimeScope';
import useTheme from '../hooks/useTheme';
import { COLORS, AXIS_TICK } from '../lib/palette';
import { formatPaceFromSecPerKm } from '../lib/timeFormat';
import {
  sessionPoint, selectGroup, compareEfficiency, modelLine, DISTANCE_FAMILIES, secPerKm,
} from '../lib/efficiencyCompare';
import { epochAdjusters } from '../lib/driftAdjust';

// Identidad de las tiradas elegidas para el cara a cara: orden FIJO (el color sigue a
// la tirada, no a su puesto) y validado con el script de dataviz en claro y oscuro
// (CVD ΔE ≥ 18, contraste ≥ 3:1 contra la superficie).
const PICK_LIGHT = ['#2563eb', '#ea580c', '#7c3aed', '#0d9488'];
const PICK_DARK = ['#3b82f6', '#ea580c', '#8b5cf6', '#0d9488'];
const MAX_PICK = 4;

const pace = (s) => formatPaceFromSecPerKm(s);
const fmtDate = (d, locale) => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: '2-digit' });
const mpbFmt = (v) => (Number.isFinite(v) ? v.toFixed(3) : '—');
const signed = (v, d = 0) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`);
// Tono secuencial de un solo color: más antiguo = más claro.
const recencyFill = (f) => `color-mix(in oklab, ${COLORS.signal} ${Math.round(45 + 55 * f)}%, ${COLORS.paper})`;

const wbgtOfGarmin = (g) => {
  const w = g?.weather;
  if (!w) return null;
  const { temp_c } = normalizeWeatherTemps(w.temp_c, w.dew_point_c, w.humidity_pct);
  return wbgtFromCelsius(temp_c, w.humidity_pct);
};

const Card = ({ children, className = '' }) => (
  <div className={`bg-white dark:bg-white/[0.03] rounded-xl border border-slate-200 dark:border-white/10 p-4 ${className}`}>{children}</div>
);

function Kpi({ label, value, sub }) {
  return (
    <Card>
      <p className="text-label font-bold uppercase text-slate-500 dark:text-white/55 mb-1">{label}</p>
      <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-white/55 mt-0.5">{sub}</p>}
    </Card>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
            value === o.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 dark:text-white/55 hover:text-slate-800 dark:hover:text-white'
          }`}
        >
          {o.label}{o.count != null && <span className="ml-1 opacity-60 tabular-nums">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

function SessionTooltip({ active, payload, metric, model, t, locale }) {
  if (!active || !payload?.length) return null;
  const s = payload.find((p) => p.payload?.id != null)?.payload;
  if (!s) return null;
  return (
    <div className="bg-white dark:bg-[#0c0e12] border border-slate-200 dark:border-white/10 rounded-lg shadow-lg p-3 text-xs max-w-[240px]">
      <p className="font-bold text-slate-800 dark:text-white truncate">{s.name}</p>
      <p className="text-slate-500 dark:text-white/55 mb-1">{fmtDate(s.date, locale)} · {(s.distance_m / 1000).toFixed(1)} km</p>
      <p className="text-slate-900 dark:text-white font-semibold tabular-nums">
        {metric === 'pace'
          ? t('eff_cmp.tt_pace', { pace: pace(s.pace_at_ref_s), hr: Math.round(model.ref_hr) })
          : t('eff_cmp.tt_hr', { hr: s.hr_at_ref.toFixed(1), pace: pace(model.ref_pace_s) })}
      </p>
      <p className="text-slate-500 dark:text-white/55 tabular-nums">
        {Number.isFinite(s.mpb_10k)
          ? t('eff_cmp.tt_mpb', { raw: mpbFmt(s.mpb_raw), eq: mpbFmt(s.mpb_10k) })
          : `${mpbFmt(s.ef)} m/lat`}
      </p>
      <p className="text-slate-500 dark:text-white/55 tabular-nums">
        {t('eff_cmp.tt_raw', { pace: pace(secPerKm(s.effort)), hr: Math.round(s.hr) })}
      </p>
      <p className="text-slate-500 dark:text-white/55 tabular-nums">
        {t('eff_cmp.vs_median')}: {signed(s.delta_pace_s)} s/km · #{s.rank}/{model.n}
        {Number.isFinite(s.wbgt) && ` · WBGT ${s.wbgt.toFixed(0)} °C`}
      </p>
      <p className="text-slate-400 dark:text-white/40 mt-1">{t(`eff_cmp.src_${s.source}`)}</p>
    </div>
  );
}

// ── Cara a cara: parciales por km superpuestos ──────────────────────────────

function splitSeries(activity) {
  const out = [];
  let d = 0;
  for (const s of activity?.splits_metric || []) {
    d += (s.distance || 0) / 1000;
    if ((s.distance || 0) < 300 || !(s.average_speed > 0)) continue;
    const gap = s.average_speed * gapFactor((s.elevation_difference || 0) / s.distance);
    out.push({ km: Math.round(d * 10) / 10, gap_s: secPerKm(gap), hr: s.average_heartrate || null });
  }
  return out;
}

function OverlayChart({ picks, colors, field, unit, reversed, fmt, t }) {
  // Una fila por km con una columna por tirada: así el tooltip compara en el mismo km.
  const rows = useMemo(() => {
    const byKm = new Map();
    picks.forEach((p, i) => {
      for (const r of p.splits) {
        const k = Math.round(r.km);
        if (!byKm.has(k)) byKm.set(k, { km: k });
        byKm.get(k)[`s${i}`] = r[field];
      }
    });
    return [...byKm.values()].sort((a, b) => a.km - b.km);
  }, [picks, field]);
  if (!rows.length) return <p className="text-xs text-slate-500 dark:text-white/55">{t('eff_cmp.no_splits')}</p>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.hairline} vertical={false} />
        <XAxis dataKey="km" tick={AXIS_TICK} tickFormatter={(v) => `${v}`} unit=" km" />
        <YAxis
          reversed={reversed} width={44} tick={AXIS_TICK} tickFormatter={fmt}
          domain={[(min) => Math.floor(min * 0.98), (max) => Math.ceil(max * 1.02)]}
        />
        <RechartsTooltip
          formatter={(v, name) => [`${fmt(v)} ${unit}`, picks[Number(name.slice(1))]?.label]}
          labelFormatter={(k) => `km ${k}`}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        {picks.map((p, i) => (
          <Line
            key={p.id} dataKey={`s${i}`} name={`s${i}`} stroke={colors[i]} strokeWidth={2}
            dot={{ r: 3, fill: colors[i], stroke: COLORS.paper, strokeWidth: 1.5 }}
            connectNulls isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function HeadToHead({ picks, colors, model, refPace10k, onRemove, t, locale }) {
  const best = (key, lower) => {
    const vals = picks.map((p) => p[key]).filter(Number.isFinite);
    if (vals.length < 2) return null;
    return lower ? Math.min(...vals) : Math.max(...vals);
  };
  const rows = [
    { key: 'distance_km', label: t('eff_cmp.h_distance'), fmt: (v) => `${v.toFixed(2)} km` },
    { key: 'pace_raw_s', label: t('eff_cmp.h_pace'), fmt: (v) => `${pace(v)}/km` },
    { key: 'gap_s', label: t('eff_cmp.h_gap'), fmt: (v) => `${pace(v)}/km` },
    { key: 'avg_hr', label: t('eff_cmp.h_hr'), fmt: (v) => `${Math.round(v)} ppm` },
    { key: 'elev_per_km', label: t('eff_cmp.h_elev'), fmt: (v) => `${v.toFixed(0)} m/km` },
    { key: 'wbgt', label: 'WBGT', fmt: (v) => `${v.toFixed(0)} °C` },
    { key: 'mpb_raw', label: t('eff_cmp.h_mpb_raw'), fmt: mpbFmt },
    { key: 'adj_grade', label: t('eff_cmp.h_adj_grade'), fmt: (v) => signed(v, 3), sub: true },
    { key: 'adj_distance', label: t('eff_cmp.h_adj_distance'), fmt: (v) => signed(v, 3), sub: true },
    { key: 'adj_pace', label: t('eff_cmp.h_adj_pace', { pace: pace(refPace10k) }), fmt: (v) => signed(v, 3), sub: true },
    { key: 'mpb_10k', label: t('eff_cmp.h_mpb_10k'), fmt: mpbFmt, better: 'high', strong: true },
    { key: 'hr_at_ref', label: t('eff_cmp.h_hr_at_ref', { pace: pace(model.ref_pace_s) }), fmt: (v) => `${v.toFixed(1)} ppm`, better: 'low' },
    { key: 'pace_at_ref_s', label: t('eff_cmp.h_pace_at_ref', { hr: Math.round(model.ref_hr) }), fmt: (v) => `${pace(v)}/km`, better: 'low', strong: true },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {picks.map((p, i) => (
          <span key={p.id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-white/10 pl-2 pr-1 py-1 text-xs text-slate-700 dark:text-white/80">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: colors[i] }} />
            <span className="max-w-[200px] truncate">{p.label}</span>
            <button type="button" onClick={() => onRemove(p.id)} className="p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/10" aria-label={t('eff_cmp.remove')}>
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-slate-500 dark:text-white/55">
              <th className="py-2 pr-3 font-semibold" />
              {picks.map((p, i) => (
                <th key={p.id} className="py-2 px-2 text-right font-semibold whitespace-nowrap">
                  <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: colors[i] }} />
                  {fmtDate(p.date, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const b = r.better ? best(r.key, r.better === 'low') : null;
              return (
                <tr key={r.key} className="border-t border-slate-100 dark:border-white/10">
                  <td className={`py-2 pr-3 ${r.strong ? 'font-bold text-slate-800 dark:text-white' : r.sub ? 'pl-4 text-slate-500 dark:text-white/55' : 'text-slate-600 dark:text-white/70'}`}>{r.label}</td>
                  {picks.map((p) => {
                    const v = p[r.key];
                    const isBest = b != null && v === b;
                    return (
                      <td key={p.id} className={`py-2 px-2 text-right ${isBest ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-white/70'}`}>
                        {Number.isFinite(v) ? r.fmt(v) : '—'}{isBest && ' ★'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 dark:text-white/55 mt-2">{t('eff_cmp.h2h_hint')}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-bold text-slate-700 dark:text-white/80 mb-1">{t('eff_cmp.chart_gap_km')}</p>
          <OverlayChart picks={picks} colors={colors} field="gap_s" unit="/km" reversed fmt={(v) => pace(v)} t={t} />
        </div>
        <div>
          <p className="text-xs font-bold text-slate-700 dark:text-white/80 mb-1">{t('eff_cmp.chart_hr_km')}</p>
          <OverlayChart picks={picks} colors={colors} field="hr" unit="ppm" fmt={(v) => Math.round(v)} t={t} />
        </div>
      </div>
    </div>
  );
}

// ── Ajustadores por época: cómo cambian la deriva y el coste del ritmo ──────

function EpochMini({ data, dataKey, title, fmt, locale }) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-700 dark:text-white/80 mb-1">{title}</p>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.hairline} vertical={false} />
          <XAxis
            dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={AXIS_TICK} minTickGap={30}
            tickFormatter={(v) => new Date(v).toLocaleDateString(locale, { month: 'short' })}
          />
          <YAxis width={36} tick={AXIS_TICK} tickFormatter={fmt} domain={[0, (max) => Math.ceil(max * 1.2 * 10) / 10]} />
          <RechartsTooltip
            formatter={(v) => [fmt(v), title]}
            labelFormatter={(v) => new Date(v).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Line dataKey={dataKey} stroke={COLORS.signal} strokeWidth={2} dot={{ r: 3, fill: COLORS.signal, stroke: COLORS.paper, strokeWidth: 1.5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EpochAdjusters({ adjusters, from, t, locale }) {
  // Se AJUSTAN con todo el histórico (la ventana de ±6 semanas necesita vecinas),
  // pero se ENSEÑAN solo los meses del período elegido en la barra superior.
  const fromTs = from ? new Date(from).getTime() : -Infinity;
  const epochs = adjusters.epochs.filter((e) => e.ts >= fromTs);
  if (!epochs.length) return null;
  const last = epochs[epochs.length - 1];
  const f1 = (v) => v.toFixed(1);
  return (
    <Card>
      <p className="text-sm font-bold text-slate-800 dark:text-white">{t('eff_cmp.adj_title')}</p>
      <p className="text-xs text-slate-500 dark:text-white/55 mb-3 max-w-3xl">
        {t('eff_cmp.adj_sub', { pace: pace(adjusters.ref_pace_s) })}
      </p>
      <div className="grid md:grid-cols-3 gap-4">
        <EpochMini data={epochs} dataKey="drift" title={t('eff_cmp.adj_drift')} fmt={f1} locale={locale} />
        <EpochMini data={epochs} dataKey="drift_after" title={t('eff_cmp.adj_drift_long')} fmt={f1} locale={locale} />
        <EpochMini data={epochs} dataKey="pace_per_10s" title={t('eff_cmp.adj_pace')} fmt={f1} locale={locale} />
      </div>
      <p className="text-xs text-slate-600 dark:text-white/70 mt-3 max-w-3xl">
        {t('eff_cmp.adj_now', {
          drift: f1(last.drift), long: f1(last.drift_after), cost: f1(last.pace_per_10s), n: last.n_runs,
        })}
        {last.drift_long_source === 'prior' && ` ${t('eff_cmp.adj_long_prior')}`}
      </p>
    </Card>
  );
}

// ── Componente principal ────────────────────────────────────────────────────

export default function EfficiencyComparator({ activities, onOpenActivity }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { isDark } = useTheme();
  const PICK = isDark ? PICK_DARK : PICK_LIGHT;
  const [scope] = useTimeScope();

  const [mode, setMode] = useState('family');
  const [family, setFamily] = useState('medium');
  const [terrain, setTerrain] = useState('any');
  const [refId, setRefId] = useState('');
  const [metric, setMetric] = useState('ef10');
  const [sortBy, setSortBy] = useState('date');
  const [picked, setPicked] = useState([]);

  const byId = useMemo(() => new Map((activities || []).map((a) => [String(a.id), a])), [activities]);

  // Origen de FC y WBGT viven en Garmin: se emparejan aquí, como en Forma aeróbica.
  const points = useMemo(() => {
    const list = Array.isArray(activities) ? activities : [];
    const paired = matchGarminByStart(list, readStoredGarminActivities());
    const policy = parseHrSourcePolicy(cloudStorage.getItem('hr_strap_since'));
    return list.map((a) => {
      const g = paired.get(a.id);
      return sessionPoint({ ...a, _hr: resolveActivityHrSource(a, g, policy), _wbgt: wbgtOfGarmin(g) });
    });
  }, [activities]);

  const from = scopeFromISO(scope);
  const familyCounts = useMemo(() => Object.fromEntries(DISTANCE_FAMILIES.map((f) => [
    f.id, selectGroup(points, { mode: 'family', family: f.id, terrain, from }).points.length,
  ])), [points, terrain, from]);

  const group = useMemo(() => selectGroup(points, {
    mode, family, terrain, refId, from,
  }), [points, mode, family, terrain, refId, from]);
  const model = useMemo(() => compareEfficiency(group.points), [group]);

  // Ajustadores de deriva/ritmo por época: se ajustan sobre TODAS las tiradas (no solo
  // el grupo) porque la deriva por km se estima mejor con más tiradas de la época.
  const adjusters = useMemo(() => epochAdjusters(activities), [activities]);
  const sessions = useMemo(() => (model.ok ? model.sessions.map((s) => {
    const a = adjusters.byId.get(String(s.id));
    return a ? {
      ...s, mpb_10k: a.mpb_10k, mpb_raw: a.mpb_raw,
      adj_grade: a.adj.grade, adj_distance: a.adj.distance, adj_pace: a.adj.pace,
    } : s;
  }) : []), [model, adjusters]);

  const refOptions = useMemo(() => points
    .filter((p) => p.ok && p.distance_m >= 3000 && (!from || String(p.date).slice(0, 10) >= from))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 400), [points, from]);

  // Ids del grupo actual: la selección que ya no pertenece al grupo se ignora.
  const groupIds = useMemo(() => new Set(model.ok ? model.sessions.map((s) => String(s.id)) : []), [model]);
  const selectedIds = picked.filter((id) => groupIds.has(id));
  const colorOf = (id) => {
    const i = selectedIds.indexOf(String(id));
    return i >= 0 ? PICK[i] : null;
  };
  const toggle = (id) => {
    const k = String(id);
    setPicked((prev) => (prev.includes(k)
      ? prev.filter((x) => x !== k)
      : [...prev.filter((x) => groupIds.has(x)), k].slice(-MAX_PICK)));
  };

  const compareWithSimilar = (id) => {
    setMode('similar');
    setRefId(String(id));
    setPicked([String(id)]);
  };

  // ── Datos de las gráficas ──
  const tsMin = model.ok ? model.sessions[0].ts : 0;
  const tsMax = model.ok ? model.sessions[model.sessions.length - 1].ts : 1;
  const isEf = metric === 'ef10' || metric === 'ef';
  const evo = useMemo(() => {
    const valueOf = (s) => (metric === 'pace' ? s.pace_at_ref_s
      : metric === 'hr' ? s.hr_at_ref
        : metric === 'ef10' ? (s.mpb_10k ?? null) : s.ef);
    const rows = sessions.map((s) => ({ ...s, value: valueOf(s) })).filter((r) => Number.isFinite(r.value));
    // Mediana móvil de 5 tiradas sobre los puntos que SÍ tienen valor.
    return rows.map((r, i) => {
      const w = rows.slice(Math.max(0, i - 2), i + 3).map((x) => x.value).sort((a, b) => a - b);
      return { ...r, rolling: w.length >= 3 ? w[Math.floor(w.length / 2)] : null };
    });
  }, [sessions, metric]);
  const median = useMemo(() => {
    const v = evo.map((r) => r.value).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }, [evo]);

  const scatter = useMemo(() => sessions.map((s) => ({ ...s, x: secPerKm(s.effort), y: s.hr })), [sessions]);
  const line = useMemo(() => {
    if (!model.ok) return [];
    const sp = model.sessions.map((s) => s.effort);
    const lo = Math.min(...sp), hi = Math.max(...sp);
    return modelLine(model, [lo, hi]).map((p) => ({ x: secPerKm(p.effort), y: p.hr }));
  }, [model]);

  const picks = selectedIds.map((id) => {
    const s = sessions.find((x) => String(x.id) === id);
    const a = byId.get(id);
    return {
      ...s,
      id,
      label: `${fmtDate(s.date, locale)} · ${s.name}`,
      distance_km: s.distance_m / 1000,
      pace_raw_s: secPerKm(s.speed_ms),
      gap_s: secPerKm(s.gap_ms),
      splits: splitSeries(a),
    };
  });

  const tableRows = model.ok
    ? [...sessions].sort((a, b) => (sortBy === 'date' ? b.ts - a.ts : a.pace_at_ref_s - b.pace_at_ref_s))
    : [];

  const dot = (props) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const c = colorOf(payload.id);
    const f = tsMax > tsMin ? (payload.ts - tsMin) / (tsMax - tsMin) : 1;
    const isRef = mode === 'similar' && String(payload.id) === String(refId);
    return (
      <g style={{ cursor: 'pointer' }} onClick={() => toggle(payload.id)}>
        <circle cx={cx} cy={cy} r={12} fill="transparent" />
        <circle
          cx={cx} cy={cy} r={c ? 6.5 : 4.5}
          style={{ fill: c || recencyFill(f) }}
          stroke={COLORS.paper} strokeWidth={2}
        />
        {isRef && <circle cx={cx} cy={cy} r={10} fill="none" stroke={COLORS.ink} strokeWidth={1.5} strokeDasharray="2 2" />}
      </g>
    );
  };

  // ── Controles ──
  const controls = (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-center">
        <Segmented value={mode} onChange={setMode} options={[
          { id: 'family', label: t('eff_cmp.mode_family') },
          { id: 'similar', label: t('eff_cmp.mode_similar') },
        ]} />
        <Segmented value={terrain} onChange={setTerrain} options={['any', 'flat', 'rolling', 'hilly'].map((id) => ({ id, label: t(`eff_cmp.terrain_${id}`) }))} />
      </div>
      {mode === 'family' ? (
        <Segmented value={family} onChange={setFamily} options={DISTANCE_FAMILIES.map((f) => ({
          id: f.id, label: t(`eff_cmp.fam_${f.id}`), count: familyCounts[f.id],
        }))} />
      ) : (
        <SearchSelect value={refId} onValueChange={(v) => { setRefId(v); setPicked(v ? [v] : []); }} placeholder={t('eff_cmp.pick_ref')} className="max-w-lg">
          {refOptions.map((p) => (
            <SearchSelectItem key={p.id} value={String(p.id)}>
              {`${fmtDate(p.date, locale)} · ${(p.distance_m / 1000).toFixed(1)} km · ${p.name}`}
            </SearchSelectItem>
          ))}
        </SearchSelect>
      )}
    </div>
  );

  const header = (
    <div>
      <h3 className="text-sm font-bold text-slate-800 dark:text-white">{t('eff_cmp.title')}</h3>
      <p className="text-xs text-slate-500 dark:text-white/55 mt-1 max-w-3xl">{t('eff_cmp.subtitle')}</p>
    </div>
  );

  if (!model.ok) {
    return (
      <div className="space-y-6">
        {header}
        {controls}
        <div className="text-center py-10 text-sm text-slate-500 dark:text-white/55">
          {mode === 'similar' && !refId ? t('eff_cmp.need_ref') : t('eff_cmp.few', { n: group.points.length })}
        </div>
      </div>
    );
  }

  const trend = model.trend;
  const dropped = group.dropped || {};
  const droppedTotal = (dropped.races || 0) + (dropped.variable || 0) + (dropped.sensor || 0);
  const refHr = Math.round(model.ref_hr);

  return (
    <div className="space-y-6">
      {header}
      {controls}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label={t('eff_cmp.k_sessions')}
          value={model.n}
          sub={droppedTotal ? t('eff_cmp.k_dropped', { n: droppedTotal }) : (group.hr_source ? t(`eff_cmp.hrsrc_${group.hr_source}`) : null)}
        />
        <Kpi
          label={t('eff_cmp.k_pace_at', { hr: refHr })}
          value={`${pace(model.median_pace_s)}/km`}
          sub={t('eff_cmp.k_pace_at_sub', { sd: model.residual_sd_pace_s.toFixed(0) })}
        />
        <Kpi
          label={t('eff_cmp.k_trend')}
          value={trend ? `${signed(trend.pace_s_per_month, 1)} s` : '—'}
          sub={trend
            ? (trend.significant
              ? t(trend.pace_s_per_month < 0 ? 'eff_cmp.k_trend_better' : 'eff_cmp.k_trend_worse', { lo: trend.ci95[0].toFixed(1), hi: trend.ci95[1].toFixed(1) })
              : t('eff_cmp.k_trend_flat', { lo: trend.ci95[0].toFixed(1), hi: trend.ci95[1].toFixed(1) }))
            : t('eff_cmp.k_trend_na')}
        />
        <Kpi
          label={t('eff_cmp.k_recent')}
          value={`${signed(model.recent_vs_median_s)} s/km`}
          sub={model.recent_vs_median_s != null && Math.abs(model.recent_vs_median_s) > model.residual_sd_pace_s
            ? t(model.recent_vs_median_s < 0 ? 'eff_cmp.k_recent_better' : 'eff_cmp.k_recent_worse')
            : t('eff_cmp.k_recent_noise')}
        />
      </div>

      {/* Evolución: cada tirada llevada a la misma FC (o al mismo ritmo). */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-white">{t('eff_cmp.evo_title')}</p>
            <p className="text-xs text-slate-500 dark:text-white/55">
              {metric === 'pace'
                ? t('eff_cmp.evo_sub_pace', { hr: refHr })
                : metric === 'hr'
                  ? t('eff_cmp.evo_sub_hr', { pace: pace(model.ref_pace_s) })
                  : metric === 'ef10'
                    ? t('eff_cmp.evo_sub_ef10', { pace: pace(adjusters.ref_pace_s) })
                    : t('eff_cmp.evo_sub_ef')}
            </p>
          </div>
          <Segmented value={metric} onChange={setMetric} options={[
            ...(adjusters.ref_speed ? [{ id: 'ef10', label: t('eff_cmp.metric_ef10') }] : []),
            { id: 'pace', label: t('eff_cmp.metric_pace', { hr: refHr }) },
            { id: 'hr', label: t('eff_cmp.metric_hr', { pace: pace(model.ref_pace_s) }) },
            { id: 'ef', label: t('eff_cmp.metric_ef') },
          ]} />
        </div>
        <ExpandableChart className="h-[300px]" title={t('eff_cmp.evo_title')}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={evo} margin={{ top: 10, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.hairline} vertical={false} />
              <XAxis
                dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']}
                tickFormatter={(v) => new Date(v).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                tick={AXIS_TICK} minTickGap={36}
              />
              {/* Mejor = arriba siempre: ritmo y FC van invertidos (menos es mejor), m/latido no. */}
              <YAxis
                reversed={!isEf} width={isEf ? 52 : 48} tick={AXIS_TICK} allowDecimals={isEf}
                domain={metric === 'pace'
                  ? [(min) => Math.floor((min - 3) / 10) * 10, (max) => Math.ceil((max + 3) / 10) * 10]
                  : metric === 'hr'
                    ? [(min) => Math.floor(min - 2), (max) => Math.ceil(max + 2)]
                    : [(min) => Math.floor((min - 0.02) * 50) / 50, (max) => Math.ceil((max + 0.02) * 50) / 50]}
                tickFormatter={(v) => (metric === 'pace' ? pace(v) : isEf ? v.toFixed(2) : Math.round(v))}
              />
              <RechartsTooltip content={<SessionTooltip metric={metric} model={model} t={t} locale={locale} />} cursor={{ stroke: COLORS.hairlineStrong }} />
              {median != null && <ReferenceLine y={median} stroke={COLORS.inkFaint} strokeDasharray="4 4" label={{ value: t('eff_cmp.median'), position: 'insideTopRight', fontSize: 10, fill: COLORS.inkMuted }} />}
              <Line dataKey="rolling" stroke={COLORS.signal} strokeWidth={2} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
              <Scatter dataKey="value" shape={dot} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ExpandableChart>
        <p className="text-xs text-slate-500 dark:text-white/55 mt-2">{t('eff_cmp.evo_hint')}</p>
        {metric === 'ef' && (
          <p className="text-xs bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-300/25 text-amber-700 dark:text-amber-300 rounded-lg px-3 py-2 mt-2">
            {t('eff_cmp.ef_warn')}
          </p>
        )}
      </Card>

      {adjusters.epochs.length > 0 && (
        <EpochAdjusters adjusters={adjusters} from={from} t={t} locale={locale} />
      )}

      {/* Nube ritmo-FC con la recta del grupo: debajo de la recta = más eficiente. */}
      <Card>
        <p className="text-sm font-bold text-slate-800 dark:text-white">{t('eff_cmp.map_title')}</p>
        <p className="text-xs text-slate-500 dark:text-white/55 mb-3">{t('eff_cmp.map_sub', { slope: model.slope_s_per_bpm.toFixed(1) })}</p>
        <ExpandableChart className="h-[300px]" title={t('eff_cmp.map_title')}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.hairline} />
              <XAxis
                dataKey="x" type="number" reversed tick={AXIS_TICK} tickFormatter={pace} allowDecimals={false}
                domain={[(min) => Math.floor((min - 5) / 10) * 10, (max) => Math.ceil((max + 5) / 10) * 10]}
                label={{ value: t('eff_cmp.map_x'), position: 'insideBottomRight', offset: -2, fontSize: 10, fill: COLORS.inkMuted }}
              />
              <YAxis
                dataKey="y" type="number" width={44} tick={AXIS_TICK}
                domain={[(min) => Math.floor(min - 3), (max) => Math.ceil(max + 3)]}
                label={{ value: 'ppm', angle: -90, position: 'insideLeft', fontSize: 11, fill: COLORS.inkMuted }}
              />
              <RechartsTooltip content={<SessionTooltip metric="pace" model={model} t={t} locale={locale} />} />
              <Line data={line} dataKey="y" stroke={COLORS.inkMuted} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false} isAnimationActive={false} legendType="none" />
              <Scatter data={scatter} shape={dot} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ExpandableChart>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-white/55 mt-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: recencyFill(0.1) }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: recencyFill(1) }} />
            {t('eff_cmp.legend_recency')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-5 border-t-2 border-dashed" style={{ borderColor: COLORS.inkMuted }} />
            {t('eff_cmp.legend_line')}
          </span>
        </div>
      </Card>

      {/* Cara a cara */}
      <Card>
        <p className="text-sm font-bold text-slate-800 dark:text-white mb-1">{t('eff_cmp.h2h_title')}</p>
        {picks.length < 2 ? (
          <p className="text-xs text-slate-500 dark:text-white/55">{t('eff_cmp.h2h_empty', { max: MAX_PICK })}</p>
        ) : (
          <HeadToHead picks={picks} colors={PICK} model={model} refPace10k={adjusters.ref_pace_s} onRemove={toggle} t={t} locale={locale} />
        )}
      </Card>

      {/* Tabla */}
      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
          <p className="text-sm font-bold text-slate-800 dark:text-white">{t('eff_cmp.table_title')}</p>
          <Segmented value={sortBy} onChange={setSortBy} options={[
            { id: 'date', label: t('eff_cmp.sort_date') },
            { id: 'eff', label: t('eff_cmp.sort_eff') },
          ]} />
        </div>
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-white dark:bg-[#0c0e12]">
              <tr className="text-left text-slate-500 dark:text-white/55">
                <th className="py-2 pl-4 pr-2 w-8" />
                <th className="py-2 px-2">{t('eff_cmp.c_date')}</th>
                <th className="py-2 px-2">{t('eff_cmp.c_name')}</th>
                <th className="py-2 px-2 text-right">km</th>
                <th className="py-2 px-2 text-right">GAP</th>
                <th className="py-2 px-2 text-right">{t('eff_cmp.c_hr')}</th>
                <th className="py-2 px-2 text-right">WBGT</th>
                <th className="py-2 px-2 text-right">{t('eff_cmp.c_mpb10')}</th>
                <th className="py-2 px-2 text-right">{t('eff_cmp.c_pace_at', { hr: refHr })}</th>
                <th className="py-2 px-2 text-right">{t('eff_cmp.c_delta')}</th>
                <th className="py-2 px-2 text-right">#</th>
                <th className="py-2 pl-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {tableRows.map((s) => {
                const c = colorOf(s.id);
                const notable = Math.abs(s.delta_pace_s) > model.residual_sd_pace_s;
                return (
                  <tr key={s.id} className={`border-t border-slate-100 dark:border-white/10 ${c ? 'bg-slate-50 dark:bg-white/[0.04]' : ''}`}>
                    <td className="py-1.5 pl-4 pr-2">
                      <button
                        type="button" onClick={() => toggle(s.id)} aria-pressed={!!c}
                        aria-label={t('eff_cmp.select')}
                        className="w-4 h-4 rounded border border-slate-300 dark:border-white/30 flex items-center justify-center"
                        style={c ? { background: c, borderColor: c } : undefined}
                      >
                        {c && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </button>
                    </td>
                    <td className="py-1.5 px-2 whitespace-nowrap text-slate-600 dark:text-white/70">{fmtDate(s.date, locale)}</td>
                    <td className="py-1.5 px-2 max-w-[220px] truncate">
                      {onOpenActivity ? (
                        <button type="button" onClick={() => onOpenActivity(s.id)} className="text-slate-800 dark:text-white hover:underline truncate max-w-full text-left">{s.name}</button>
                      ) : <span className="text-slate-800 dark:text-white">{s.name}</span>}
                      {s.source !== 'window' && <span className="ml-1 text-slate-400 dark:text-white/35" title={t(`eff_cmp.src_${s.source}`)}>°</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right text-slate-600 dark:text-white/70">{(s.distance_m / 1000).toFixed(1)}</td>
                    <td className="py-1.5 px-2 text-right text-slate-600 dark:text-white/70">{pace(secPerKm(s.effort))}</td>
                    <td className="py-1.5 px-2 text-right text-slate-600 dark:text-white/70">{Math.round(s.hr)}</td>
                    <td className="py-1.5 px-2 text-right text-slate-500 dark:text-white/55">{Number.isFinite(s.wbgt) ? s.wbgt.toFixed(0) : '—'}</td>
                    <td className="py-1.5 px-2 text-right font-bold text-slate-900 dark:text-white">{mpbFmt(s.mpb_10k)}</td>
                    <td className="py-1.5 px-2 text-right font-semibold text-slate-700 dark:text-white/80">{pace(s.pace_at_ref_s)}</td>
                    <td className={`py-1.5 px-2 text-right ${notable ? 'font-semibold text-slate-800 dark:text-white' : 'text-slate-500 dark:text-white/55'}`}>
                      {notable && (s.delta_pace_s < 0 ? '▲ ' : '▼ ')}{signed(s.delta_pace_s)} s
                    </td>
                    <td className="py-1.5 px-2 text-right text-slate-500 dark:text-white/55">{s.rank}</td>
                    <td className="py-1.5 pl-2 pr-4 text-right">
                      {mode === 'family' && (
                        <button type="button" onClick={() => compareWithSimilar(s.id)} className="text-signal-blue dark:text-blue-300 hover:underline whitespace-nowrap">
                          {t('eff_cmp.similar_to')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 dark:text-white/55 px-4 py-3">{t('eff_cmp.table_hint')}</p>
      </Card>

      <CollapsibleSection title={t('eff_cmp.method_title')} defaultOpen={false}>
        <div className="text-xs text-slate-600 dark:text-white/70 space-y-2 max-w-3xl">
          <p>{t('eff_cmp.method_1')}</p>
          <p>{t('eff_cmp.method_2', {
            slope: model.slope.toFixed(1),
            src: t(`eff_cmp.slope_${model.slope_source}`),
            s10: (model.slope * (model.ref_effort - 1000 / (model.ref_pace_s + 10))).toFixed(1),
          })}</p>
          <p>{model.heat_coef != null
            ? t('eff_cmp.method_heat', { c: model.heat_coef.toFixed(2), w: model.wbgt_ref.toFixed(0) })
            : t('eff_cmp.method_noheat')}</p>
          <p>{t('eff_cmp.method_3', { sd: model.residual_sd.toFixed(1), sdp: model.residual_sd_pace_s.toFixed(0) })}</p>
          {droppedTotal > 0 && (
            <p>{t('eff_cmp.method_dropped', { races: dropped.races, variable: dropped.variable, sensor: dropped.sensor })}</p>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
