import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectItem } from '@tremor/react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import CollapsibleSection from './CollapsibleSection';
import { hrAtFixedEffort, paceFromSpeed } from '../lib/aerobicForm';
import { readStoredGarminActivities } from '../lib/garminActivitiesSync';
import { matchGarminByStart, parseHrSourcePolicy, resolveActivityHrSource } from '../lib/hrSource';
import { normalizeWeatherTemps, wbgtFromCelsius } from '../lib/weather';
import cloudStorage from '../lib/cloudStorage';

// Serie única y color único: lo que se compara es un mismo número consigo mismo a lo
// largo del tiempo, no varias entidades entre sí.
const LINE = '#2563eb';
const BAND = '#93c5fd';

const RANGES = { 6: 6, 12: 12, 24: 24 };

/** WBGT de una actividad de Garmin, con el mismo árbitro de unidades que el MCP. */
const wbgtOfGarmin = (g) => {
  const w = g?.weather;
  if (!w) return null;
  const { temp_c } = normalizeWeatherTemps(w.temp_c, w.dew_point_c, w.humidity_pct);
  return wbgtFromCelsius(temp_c, w.humidity_pct);
};

const isoMonthsAgo = (months) => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
};

// Reparto de descartes por motivo. Se enseña en los dos sitios donde hace falta: en
// el desplegable cuando hay modelo, y EN VEZ del modelo cuando no lo hay — que es
// cuando de verdad importa saber si falta enriquecido o es que no llevabas banda.
function ReasonList({ excluded, t }) {
  const counts = excluded.reduce((m, e) => { m[e.reason] = (m[e.reason] || 0) + 1; return m; }, {});
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {rows.map(([reason, count]) => (
        <li key={reason} className="flex justify-between border-b border-slate-100 py-1.5">
          <span className="text-slate-600">{t(`aerobic_form.reasons.${reason}`)}</span>
          <span className="text-slate-400 tabular-nums">{count}</span>
        </li>
      ))}
    </ul>
  );
}

function ChartTooltip({ active, payload, axis, t }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold text-slate-700 mb-1">{d.label}</p>
      <p className="text-slate-900 font-semibold tabular-nums">
        {d.hr_at_ref} ± {d.se} bpm
      </p>
      <p className="text-slate-500 tabular-nums">
        {d.n} {t('aerobic_form.sessions')} · {t('aerobic_form.effort_mean')}:{' '}
        {axis === 'power' ? `${d.effort_mean} W` : `${paceFromSpeed(d.effort_mean)}/km`}
      </p>
      {d.wbgt_mean != null && (
        <p className="text-slate-400 tabular-nums">WBGT {d.wbgt_mean} °C</p>
      )}
    </div>
  );
}

export default function AerobicForm({ activities }) {
  const { t } = useTranslation();
  const [axis, setAxis] = useState('gap');
  const [granularity, setGranularity] = useState('month');
  const [months, setMonths] = useState('12');

  // Origen de FC y WBGT no viven en la actividad de Strava: hay que emparejarla con
  // su registro de Garmin. Se hace aquí y no dentro de `aerobicForm.js` para que esa
  // capa siga siendo pura y sirva igual al servidor MCP, donde los datos vienen de
  // Supabase y no del navegador.
  const enriched = useMemo(() => {
    const list = Array.isArray(activities) ? activities : [];
    const garmin = readStoredGarminActivities();
    const paired = matchGarminByStart(list, garmin);
    const policy = parseHrSourcePolicy(cloudStorage.getItem('hr_strap_since'));
    return list.map((a) => {
      const g = paired.get(a.id);
      return {
        ...a,
        _hr: resolveActivityHrSource(a, g, policy),
        _wbgt: wbgtOfGarmin(g),
      };
    });
  }, [activities]);

  const result = useMemo(() => hrAtFixedEffort(enriched, {
    axis,
    granularity,
    from: isoMonthsAgo(RANGES[months] || 12),
  }), [enriched, axis, granularity, months]);

  const chartData = useMemo(() => (result.periods || []).map((p) => ({
    ...p,
    // Recharts dibuja una banda con un dataKey de dos valores: aquí es ±1 SE, que es
    // la incertidumbre del propio punto y lo que decide si dos periodos difieren.
    band: p.se != null ? [p.hr_at_ref - p.se, p.hr_at_ref + p.se] : null,
  })), [result]);

  const pending = useMemo(
    () => (result.excluded || []).filter((e) => e.reason === 'sin-enriquecer').length,
    [result],
  );

  const controls = (
    <div className="flex flex-wrap gap-3 items-center">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {['gap', 'power'].map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setAxis(id)}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
              axis === id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t(`aerobic_form.axis_${id}`)}
          </button>
        ))}
      </div>
      <Select value={granularity} onValueChange={setGranularity} className="w-36">
        <SelectItem value="month">{t('aerobic_form.by_month')}</SelectItem>
        <SelectItem value="block">{t('aerobic_form.by_block')}</SelectItem>
      </Select>
      <Select value={months} onValueChange={setMonths} className="w-32">
        <SelectItem value="6">{t('decoupling.months_6')}</SelectItem>
        <SelectItem value="12">{t('decoupling.months_12')}</SelectItem>
        <SelectItem value="24">{t('decoupling.months_24')}</SelectItem>
      </Select>
    </div>
  );

  if (result.error) {
    return (
      <div className="space-y-6">
        {controls}
        <div className="text-center py-10 text-slate-400">
          <p className="text-sm text-slate-500">{t(`aerobic_form.errors.${result.error_code}`)}</p>
          <p className="text-xs mt-2">
            {axis === 'power' ? t('aerobic_form.no_data_power') : t('aerobic_form.no_data_hint')}
          </p>
          {pending > 0 && (
            <p className="text-xs mt-2 text-slate-500">{t('aerobic_form.pending', { count: pending })}</p>
          )}
        </div>
        {result.excluded.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 max-w-md mx-auto">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              {t('aerobic_form.excluded', { count: result.excluded.length })}
            </p>
            <ReasonList excluded={result.excluded} t={t} />
          </div>
        )}
      </div>
    );
  }

  const last = result.periods[result.periods.length - 1];
  const improving = result.change_bpm != null && result.change_bpm < 0;
  const refLabel = axis === 'power'
    ? `${result.ref_effort} W`
    : `${result.ref_pace_per_km}/km`;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-slate-800">{t('aerobic_form.title')}</h3>
        <p className="text-xs text-slate-500 mt-1">{t('aerobic_form.subtitle', { effort: refLabel })}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
            {t('aerobic_form.current')}
          </p>
          <p className="text-2xl font-black text-slate-900 tabular-nums">{last.hr_at_ref}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">± {last.se} bpm · n={last.n}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
            {t('aerobic_form.change')}
          </p>
          <p className={`text-2xl font-black tabular-nums ${
            result.change_robust === false ? 'text-slate-400'
              : improving ? 'text-emerald-600' : 'text-amber-600'
          }`}>
            {result.change_bpm > 0 ? '+' : ''}{result.change_bpm ?? '—'}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {result.change_robust === false
              ? t('aerobic_form.not_robust')
              : improving ? t('aerobic_form.improving') : t('aerobic_form.worsening')}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
            {t('aerobic_form.reference')}
          </p>
          <p className="text-2xl font-black text-slate-700 tabular-nums">{refLabel}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{t('aerobic_form.reference_hint')}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
            {t('aerobic_form.sessions_used')}
          </p>
          <p className="text-2xl font-black text-slate-700 tabular-nums">{result.n_sessions}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {t('aerobic_form.residual', { sd: result.residual_sd_bpm })}
          </p>
        </div>
      </div>

      {controls}

      {/* Avisos: los dos supuestos que, si no se cumplen, invalidan la lectura. */}
      <div className="space-y-2">
        {!result.slope_ok && (
          <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
            {t('aerobic_form.warn_slope')}
          </p>
        )}
        {result.change_robust === false && (
          <p className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
            {t('aerobic_form.warn_fragile', {
              lo: Math.min(...Object.values(result.change_sensitivity)),
              hi: Math.max(...Object.values(result.change_sensitivity)),
            })}
          </p>
        )}
        {!result.wbgt_adjusted && (
          <p className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
            {t('aerobic_form.warn_heat')}
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
            {/* Dominio con funciones y enteros: en string ('dataMin - 3') Recharts
                repartía ticks como 149,99999998 y la etiqueta se salía del hueco. */}
            <YAxis
              domain={[(min) => Math.floor(min - 2), (max) => Math.ceil(max + 2)]}
              allowDecimals={false}
              width={44}
              tick={{ fontSize: 11, fill: '#64748b' }}
              label={{ value: 'bpm', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#94a3b8' }}
            />
            <RechartsTooltip content={<ChartTooltip axis={axis} t={t} />} />
            <Area
              dataKey="band"
              stroke="none"
              fill={BAND}
              fillOpacity={0.45}
              isAnimationActive={false}
              activeDot={false}
            />
            <Line
              type="monotone"
              dataKey="hr_at_ref"
              stroke={LINE}
              strokeWidth={2}
              dot={{ r: 4, fill: LINE, stroke: '#fff', strokeWidth: 2 }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-slate-400 mt-2">{t('aerobic_form.chart_hint')}</p>
      </div>

      <CollapsibleSection title={t('aerobic_form.detail')} defaultOpen={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="py-2">{t('aerobic_form.period')}</th>
                <th className="py-2 text-right">{t('aerobic_form.hr_at_ref')}</th>
                <th className="py-2 text-right">n</th>
                <th className="py-2 text-right">{t('aerobic_form.effort_mean')}</th>
                <th className="py-2 text-right">WBGT</th>
                <th className="py-2 text-right">{t('aerobic_form.drift')}</th>
                {Object.keys(result.periods[0].sensitivity).map((k) => (
                  <th key={k} className="py-2 text-right">
                    {t('aerobic_form.slope_short')} {k.replace('x', '×')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {result.periods.map((p) => (
                <tr key={p.period} className="border-t border-slate-100">
                  <td className="py-2 font-semibold text-slate-700">{p.label}</td>
                  <td className="py-2 text-right text-slate-900 font-bold">{p.hr_at_ref} ± {p.se}</td>
                  <td className="py-2 text-right text-slate-500">{p.n}</td>
                  <td className="py-2 text-right text-slate-500">
                    {axis === 'power' ? `${p.effort_mean} W` : `${paceFromSpeed(p.effort_mean)}/km`}
                  </td>
                  <td className="py-2 text-right text-slate-500">{p.wbgt_mean ?? '—'}</td>
                  <td className="py-2 text-right text-slate-500">{p.drift_mean ?? '—'}</td>
                  {Object.entries(p.sensitivity).map(([s, v]) => (
                    <td key={s} className="py-2 text-right text-slate-400">{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          {axis === 'gap'
            ? t('aerobic_form.slope_hint_gap', {
              bpm: result.slope_bpm_per_10s_per_km,
              slope: result.slope_bpm_per_unit,
              se: result.slope_se,
            })
            : t('aerobic_form.slope_hint_power', {
              slope: result.slope_bpm_per_unit,
              se: result.slope_se,
            })}
          {' '}
          {t('aerobic_form.sensitivity_hint')}
        </p>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('aerobic_form.excluded', { count: result.excluded.length })}
        defaultOpen={false}
      >
        <ReasonList excluded={result.excluded} t={t} />
        {pending > 0 && (
          <p className="text-[11px] text-slate-400 mt-3">{t('aerobic_form.pending', { count: pending })}</p>
        )}
      </CollapsibleSection>

      <p className="text-[11px] text-slate-400">{t('aerobic_form.caveat')}</p>
    </div>
  );
}
