import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, ArrowTopRightOnSquareIcon, ChevronLeftIcon, ChevronRightIcon,
  ArrowTrendingUpIcon, ArrowTrendingDownIcon, HeartIcon, SunIcon, MapIcon, BoltIcon,
} from '@heroicons/react/24/outline';
import { activityNeighbors } from '../lib/activityNeighbors';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import ActivitySplits from './ActivitySplits';
import RouteMap from './RouteMap';
import { karvonenBounds, classifyHR } from '../lib/hrZones';
import { ZONES } from '../lib/zoneColors';
import { formatDuration, formatPaceFromSpeed } from '../lib/timeFormat';
import { readStoredGarminActivities } from '../lib/garminActivitiesSync';
import { matchGarminByStart } from '../lib/hrSource';
import {
  findSimilarSessions, isRace, sessionDecoupling, sessionEfficiency, sessionGap, sessionWeather, sessionZones,
} from '../lib/sessionAnalysis';

// Vista de sesión (/activity/:id): "¿qué pasó en este entreno?" en una página.
// Todos los números salen de lib/sessionAnalysis, que a su vez delega en el módulo
// dueño de cada uno: aquí no se calcula nada, solo se presenta.

const LEVEL_TONE = {
  excellent: 'text-emerald-600',
  good: 'text-emerald-600',
  normal: 'text-amber-600',
  high: 'text-orange-600',
  very_high: 'text-rose-600',
};

// Mismo semáforo que LEVEL_TONE, en versión pastilla para los veredictos.
const LEVEL_PILL = {
  excellent: 'bg-emerald-50 text-emerald-600',
  good: 'bg-emerald-50 text-emerald-600',
  normal: 'bg-amber-50 text-amber-600',
  high: 'bg-orange-50 text-orange-600',
  very_high: 'bg-rose-50 text-rose-600',
};

const fmt1 = (v) => (v == null ? '—' : v.toFixed(1));
const signed = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);
// Strava da la cadencia de carrera por pierna; Garmin, por minuto de ambas.
const spm = (c) => (c ? Math.round(c < 120 ? c * 2 : c) : null);

function Card({ id, title, aside, children, className = '', flush = false }) {
  return (
    <section id={id} className={`scroll-mt-20 bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-5 h-11 border-b border-slate-100">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{title}</h3>
          {aside}
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

/** Bloque temático de la cabecera: una cifra protagonista y sus secundarias. */
function StatGroup({ Icon, accent, label, value, unit, caption, items, children }) {
  return (
    <div className="min-w-0 bg-white px-5 py-4 flex flex-col">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${accent}`}><Icon className="w-3.5 h-3.5" /></span>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5 tabular-nums">
        <span className="text-[32px] leading-none font-bold tracking-tight text-slate-900">{value}</span>
        {unit && <span className="text-sm font-semibold text-slate-500">{unit}</span>}
        {caption && <span className="text-[11px] text-slate-500 truncate">{caption}</span>}
      </div>
      {children}
      <dl className="mt-auto pt-3 grid grid-cols-2 gap-3">
        {items.map((it) => (
          <div key={it.label} className="min-w-0" title={it.title}>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 truncate">{it.label}</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-800 truncate">
              {it.value}{it.unit && <span className="ml-0.5 text-[11px] font-medium text-slate-500">{it.unit}</span>}
            </dd>
            {it.hint && <dd className="text-[10px] text-slate-500 truncate">{it.hint}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * FC media y máxima sobre las cinco zonas del atleta (mismos límites Karvonen que
 * el resto de la app). La escala arranca en el 50% de la reserva: por debajo no hay
 * nada que leer en una sesión de carrera.
 */
function HrStrip({ avg, max, hrmax, hrrest, t }) {
  if (!avg || !hrmax || !hrrest) return null;
  const bounds = karvonenBounds({ hrmax, hrrest });
  const lo = Math.round(hrrest + 0.5 * (hrmax - hrrest));
  const hi = Math.max(hrmax, max || 0);
  const pos = (hr) => `${Math.max(0, Math.min(100, ((hr - lo) / (hi - lo)) * 100))}%`;
  const edges = [lo, ...bounds.slice(1).map((b) => b.lo), hi];
  const zone = ZONES[classifyHR(avg, bounds) + 1];
  return (
    <div className="mt-3">
      <div className="relative h-2">
        <div className="absolute inset-0 flex rounded-full overflow-hidden">
          {[1, 2, 3, 4, 5].map((z, i) => (
            <div key={z} style={{ width: `${((edges[i + 1] - edges[i]) / (hi - lo)) * 100}%`, background: ZONES[z].color, opacity: 0.35 }} />
          ))}
        </div>
        {max && (
          <span className="absolute top-1/2 w-0.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-500" style={{ left: pos(max) }} title={`${t('session.max')} ${Math.round(max)}`} />
        )}
        <span className="absolute top-1/2 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: pos(avg), background: zone.color }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-semibold">
        {[1, 2, 3, 4, 5].map((z) => (
          <span key={z} style={{ color: ZONES[z].text, opacity: z === classifyHR(avg, bounds) + 1 ? 1 : 0.45 }}>{ZONES[z].label}</span>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, size = 'md' }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`font-black tabular-nums text-slate-900 truncate ${size === 'lg' ? 'text-3xl leading-tight' : 'text-lg'}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500 truncate" title={hint}>{hint}</div>}
    </div>
  );
}

function Empty({ children }) {
  return <p className="text-xs italic text-slate-500">{children}</p>;
}

function ZonesBlock({ zones, t }) {
  if (!zones) return <Empty>{t('session.no_hr')}</Empty>;
  const top = Math.max(...zones.pct);
  const groups = [
    { key: 'low', cls: 'bg-sky-50 text-sky-700' },
    { key: 'mod', cls: 'bg-amber-50 text-amber-700' },
    { key: 'high', cls: 'bg-rose-50 text-rose-700' },
  ];
  return (
    <>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {zones.pct.map((p, i) => p > 0 && (
          <div key={i} style={{ width: `${p}%`, background: ZONES[i + 1].color }} title={`${ZONES[i + 1].label} ${Math.round(p)}%`} />
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {zones.pct.map((p, i) => {
          const dominant = p > 0 && p === top;
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="w-7 shrink-0 text-[11px] font-black" style={{ color: ZONES[i + 1].text }}>{ZONES[i + 1].label}</span>
              <div className="relative h-5 flex-1 rounded bg-slate-50">
                <div
                  className="absolute inset-y-0 left-0 rounded transition-[width] duration-500"
                  style={{ width: `${Math.max(p, p > 0 ? 1 : 0)}%`, background: ZONES[i + 1].color, opacity: dominant ? 1 : 0.7 }}
                />
              </div>
              <span className={`w-10 shrink-0 text-right text-sm tabular-nums ${dominant ? 'font-black text-slate-900' : 'font-semibold text-slate-600'}`}>
                {Math.round(p)}%
              </span>
              <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{formatDuration(zones.times[i])}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {groups.map(({ key, cls }) => (
          <span key={key} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${cls}`}>
            {t(`session.group_${key}`)} {Math.round(zones.groups[key])}%
          </span>
        ))}
      </div>
      {zones.resolution === 'average' && (
        <p className="mt-2 text-[11px] text-amber-600">{t('session.zones_average_only')}</p>
      )}
    </>
  );
}

function WeatherBlock({ weather, t }) {
  if (!weather) return <Empty>{t('session.no_weather')}</Empty>;
  if (!weather.wbgt_plausible) return <Empty>{t('session.weather_implausible')}</Empty>;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-5">
      <Kpi label={t('session.temp')} value={`${fmt1(weather.temp_c)} °C`} hint={weather.humidity_pct != null ? `${Math.round(weather.humidity_pct)}% HR` : null} />
      <Kpi label="WBGT" value={`${fmt1(weather.wbgt_c)} °C`} hint={weather.dew_point_c != null ? `${t('session.dew_point')} ${fmt1(weather.dew_point_c)} °C` : null} />
      <Kpi
        label={t('session.heat_session')}
        value={weather.heat_penalty_session_pct != null ? `${fmt1(weather.heat_penalty_session_pct)}%` : '—'}
        hint={t('session.heat_session_hint')}
      />
      <Kpi
        label={t('session.heat_race')}
        value={weather.heat_penalty_pct != null ? `${fmt1(weather.heat_penalty_pct)}%` : '—'}
        hint={t('session.heat_race_hint')}
      />
    </div>
  );
}

// La sesión abierta se pinta en azul; el resto del grupo en gris: lo que se lee es
// dónde cae ESTA sesión dentro de su historia, no las otras entre sí.
const OWN = '#2563eb';
const PEER = '#94a3b8';

/** La sesión abierta con la misma forma que las del grupo, para mezclarla con ellas. */
function ownRow(activity, gap, ownEf) {
  const moving = activity.moving_time || activity.elapsed_time || 0;
  return {
    id: activity.id,
    date: activity.start_date,
    name: activity.name,
    distance_m: activity.distance,
    speed_ms: moving > 0 ? activity.distance / moving : null,
    gap_speed_ms: gap?.speed_ms ?? null,
    avg_hr: activity.average_heartrate ?? null,
    efficiency: ownEf,
    current: true,
  };
}

function SimilarTooltip({ active, payload, t, locale }) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold text-slate-700 truncate max-w-[220px]">{s.current ? t('session.this_session') : s.name}</p>
      <p className="text-slate-500 mb-1">{new Date(s.date).toLocaleDateString(locale, { dateStyle: 'medium' })}</p>
      <p className="font-semibold tabular-nums text-slate-900">{s.efficiency.toFixed(2)} m/lat</p>
      <p className="tabular-nums text-slate-500">
        {formatPaceFromSpeed(s.speed_ms)}/km{s.avg_hr ? ` · ${Math.round(s.avg_hr)} ppm` : ''}
      </p>
    </div>
  );
}

function SimilarChart({ points, median, onOpenActivity, t, locale }) {
  const dot = ({ cx, cy, payload }) => (
    <circle
      key={payload.id}
      cx={cx} cy={cy}
      r={payload.current ? 6 : 3.5}
      fill={payload.current ? OWN : PEER}
      stroke="#fff" strokeWidth={2}
      style={{ cursor: payload.current ? 'default' : 'pointer' }}
      onClick={() => !payload.current && onOpenActivity(payload.id)}
    />
  );
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
          tickFormatter={(v) => new Date(v).toLocaleDateString(locale, { month: 'short', year: '2-digit' })}
          tick={{ fontSize: 10, fill: '#64748b' }} minTickGap={24}
        />
        <YAxis
          domain={[(min) => Math.floor((min - 0.05) * 10) / 10, (max) => Math.ceil((max + 0.05) * 10) / 10]}
          tickFormatter={(v) => v.toFixed(1)}
          width={32} tick={{ fontSize: 10, fill: '#64748b' }}
        />
        <RechartsTooltip content={<SimilarTooltip t={t} locale={locale} />} />
        {median != null && <ReferenceLine y={median} stroke={PEER} strokeDasharray="4 4" />}
        <Line
          type="linear" dataKey="efficiency" stroke="#cbd5e1" strokeWidth={1.5}
          dot={dot} activeDot={false} isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function SimilarRow({ s, onOpenActivity, t, locale }) {
  const base = 'group flex items-center gap-3 px-3 py-2 rounded-lg';
  const Tag = s.current ? 'div' : 'button';
  return (
    <Tag
      {...(s.current ? {} : { type: 'button', onClick: () => onOpenActivity(s.id) })}
      className={`${base} w-full text-left ${s.current ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500'}`}
    >
      <span className={`w-14 shrink-0 text-[11px] tabular-nums ${s.current ? 'font-bold text-blue-700' : 'text-slate-500'}`}>
        {new Date(s.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: '2-digit' })}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-semibold ${s.current ? 'text-blue-800' : 'text-slate-700 group-hover:text-blue-700'}`}>
          {s.current ? t('session.this_session') : s.name}
        </span>
        <span className="block truncate text-[11px] tabular-nums text-slate-500">
          {(s.distance_m / 1000).toFixed(1)} km · {formatPaceFromSpeed(s.speed_ms)}/km
          {s.gap_speed_ms ? ` · GAP ${formatPaceFromSpeed(s.gap_speed_ms)}` : ''}
          {s.avg_hr ? ` · ${Math.round(s.avg_hr)} ppm` : ''}
        </span>
      </span>
      <span className={`shrink-0 text-right text-sm font-black tabular-nums ${s.current ? 'text-blue-700' : 'text-slate-800'}`}>
        {s.efficiency != null ? s.efficiency.toFixed(2) : '—'}
        <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500">m/lat</span>
      </span>
      {!s.current && <ChevronRightIcon className="w-3.5 h-3.5 shrink-0 text-slate-300 group-hover:text-blue-500" />}
    </Tag>
  );
}

function SimilarBlock({ similar, activity, gap, onOpenActivity, t, locale }) {
  if (!similar || similar.n === 0) return <Empty>{t('session.no_similar')}</Empty>;
  const own = ownRow(activity, gap, similar.own_ef);
  const points = [...similar.history, own]
    .filter((s) => s.efficiency != null)
    .map((s) => ({ ...s, t: new Date(s.date).getTime() }))
    .sort((a, b) => a.t - b.t);
  // La sesión abierta va en la lista en su sitio cronológico, entre las demás.
  const rows = [...similar.sessions, own].sort((a, b) => new Date(b.date) - new Date(a.date));
  return (
    <>
      <p className="text-xs text-slate-500 mb-4">
        {t('session.similar_criteria', {
          n: similar.n,
          dist: similar.criteria.distance_tol_pct,
          hr: similar.criteria.hr_tol_bpm ?? '—',
        })}
      </p>
      <div className="grid gap-6 lg:grid-cols-5">
        {points.length >= 2 && (
          <div className="lg:col-span-3">
            <SimilarChart points={points} median={similar.median_ef} onOpenActivity={onOpenActivity} t={t} locale={locale} />
            <p className="text-[11px] text-slate-500 mt-1">{t('session.similar_chart_hint')}</p>
          </div>
        )}
        <div className={points.length >= 2 ? 'lg:col-span-2' : 'lg:col-span-5'}>
          <div className="space-y-0.5 lg:max-h-[260px] lg:overflow-y-auto lg:pr-1">
            {rows.map((s) => <SimilarRow key={s.id} s={s} onOpenActivity={onOpenActivity} t={t} locale={locale} />)}
          </div>
          {similar.n > similar.sessions.length && (
            <p className="text-[11px] text-slate-500 mt-2">
              {t('session.similar_more', { shown: similar.sessions.length, n: similar.n })}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/** Indicador compacto del veredicto: cifra + lectura; lleva a su sección. */
function Insight({ Icon, tone, valueTone, label, value, sub, extra, title, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      title={title}
      className={`flex items-start gap-3 bg-white px-5 py-3 text-left ${onClick ? 'hover:bg-slate-50 transition-colors' : ''}`}
    >
      <span className={`mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${tone}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 truncate">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className={`text-lg font-bold tabular-nums ${valueTone}`}>{value}</span>
          <span className="text-xs font-medium text-slate-600 truncate first-letter:uppercase">{sub}</span>
        </span>
        {extra && <span className="block text-[11px] tabular-nums text-slate-500 truncate">{extra}</span>}
      </span>
    </Tag>
  );
}

function StepButton({ target, label, dir, onStep, locale }) {
  const Icon = dir === 'prev' ? ChevronLeftIcon : ChevronRightIcon;
  const key = dir === 'prev' ? '←' : '→';
  return (
    <button
      type="button"
      disabled={!target}
      onClick={() => target && onStep?.(target.id)}
      aria-label={label}
      title={target
        ? `${label} (${key}): ${target.name} · ${new Date(target.start_date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : label}
      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-600 transition-colors"
    >
      {dir === 'prev' && <Icon className="w-3.5 h-3.5" />}
      <span className="hidden md:inline">{label}</span>
      {dir === 'next' && <Icon className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function SessionView({ activityId, activities, hrParams, onBack, onOpenActivity, onStepActivity, onEnrichActivity }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const rootRef = useRef(null);
  const activity = useMemo(
    () => activities.find((a) => String(a.id) === String(activityId)) ?? null,
    [activities, activityId],
  );

  // El componente se monta de nuevo en cada sesión (key=id): al pasar a la
  // siguiente se vuelve arriba en lugar de aterrizar a media página.
  useEffect(() => {
    rootRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, []);

  // Anterior / siguiente en el tiempo, sin volver a la bitácora. También con ← →.
  const { prev, next } = useMemo(() => activityNeighbors(activity, activities), [activity, activities]);
  const step = onStepActivity ?? onOpenActivity;
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape') { onBack?.(); return; }
      const target = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : null;
      if (target) step?.(target.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, step, onBack]);

  // Trae el detalle (vueltas, parciales, mejores esfuerzos) si aún no está: lo mismo
  // que hace la bitácora al desplegar una fila. Es idempotente.
  useEffect(() => {
    if (activity) onEnrichActivity?.(activity.id);
    // Solo al cambiar de sesión: la identidad de la función cambia en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.id]);

  const { hrmax, hrrest } = hrParams ?? {};
  const model = useMemo(() => {
    if (!activity) return null;
    const bounds = hrmax && hrrest ? karvonenBounds({ hrmax, hrrest }) : null;
    const garmin = matchGarminByStart([activity], readStoredGarminActivities()).get(activity.id) ?? null;
    return {
      gap: sessionGap(activity),
      zones: sessionZones(activity, bounds),
      decoupling: sessionDecoupling(activity),
      efficiency: sessionEfficiency(activity, { maxObservedHr: hrmax }),
      weather: sessionWeather(garmin, activity, { hrMax: hrmax }),
      similar: isRace(activity) ? null : findSimilarSessions(activity, activities),
    };
  }, [activity, activities, hrmax, hrrest]);

  if (!activity) {
    return (
      <Card>
        <p className="text-sm text-slate-500 mb-3">{t('session.not_found')}</p>
        <button onClick={onBack} className="text-sm font-bold text-blue-600 hover:underline">{t('session.back')}</button>
      </Card>
    );
  }

  const moving = activity.moving_time || activity.elapsed_time || 0;
  const speed = moving > 0 ? activity.distance / moving : 0;
  const { gap, zones, decoupling, efficiency, weather, similar } = model;
  const race = isRace(activity);
  // Sin vueltas del reloj se cae a los parciales por km, que no traen `lap_index`.
  const splits = activity.laps?.length
    ? activity.laps
    : activity.splits_metric?.map((s) => ({ ...s, lap_index: s.split }));
  const polyline = activity.map?.summary_polyline || activity.map?.polyline || null;
  const start = new Date(activity.start_date);
  const cadence = spm(activity.average_cadence);

  const showHeat = weather?.wbgt_plausible && weather.heat_penalty_session_pct != null && weather.heat_penalty_session_pct >= 0.5;
  const stoppedLong = activity.elapsed_time && activity.elapsed_time - moving > 60;

  // Veredicto (§6.3): cada indicador es la cifra y su lectura; la frase completa
  // va en el title y el clic lleva a la sección que lo explica.
  const efDelta = similar?.ef_delta_pct;
  const decH = decoupling.halves;
  const decD = decoupling.durability;
  const windows = (d) => (d.pct != null
    ? `${d.initial.window}: ${Math.round(d.initial.avg_hr)} ppm @ ${formatPaceFromSpeed(d.initial.avg_speed_ms)} → ${d.final.window}: ${Math.round(d.final.avg_hr)} ppm @ ${formatPaceFromSpeed(d.final.avg_speed_ms)}`
    : t(`session.decoupling_reason.${d.reason}`));
  const insights = [
    efficiency.whole != null && {
      key: 'ef',
      Icon: efDelta == null || efDelta >= 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon,
      tone: efDelta == null ? 'bg-slate-50 text-slate-600' : efDelta >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
      valueTone: efDelta == null ? 'text-slate-900' : efDelta >= 0 ? 'text-emerald-600' : 'text-rose-600',
      label: t('session.efficiency_title'),
      value: efDelta != null ? `${signed(efDelta)}%` : `${efficiency.whole.toFixed(2)}`,
      sub: efDelta != null ? t('session.insight_vs_similar', { rank: similar.rank, total: similar.n + 1 }) : 'm/lat',
      extra: [
        efDelta != null && `EF ${efficiency.whole.toFixed(2)} m/lat`,
        efficiency.aerobic != null && `${t('session.ef_aerobic_short')} ${efficiency.aerobic.toFixed(2)}`,
        similar?.median_ef && `${t('session.median_short')} ${similar.median_ef.toFixed(2)}`,
      ].filter(Boolean).join(' · ') || null,
      title: efDelta != null
        ? t('session.verdict_efficiency', { delta: signed(efDelta), n: similar.n, rank: similar.rank, total: similar.n + 1 })
        : t('session.ef_aerobic_hint'),
      target: efDelta != null ? 'similar' : null,
    },
    {
      key: 'dec',
      Icon: HeartIcon,
      tone: LEVEL_PILL[decH.level] ?? 'bg-slate-50 text-slate-600',
      valueTone: LEVEL_TONE[decH.level] ?? 'text-slate-500',
      label: t('session.decoupling_title'),
      value: decH.pct != null ? `${signed(decH.pct)}%` : '—',
      sub: decH.pct != null ? t(`decoupling.levels.${decH.level}`) : t(`session.decoupling_reason.${decH.reason}`),
      extra: decD.pct != null
        ? `${t('session.durability_short')} ${signed(decD.pct)}% · ${t(`decoupling.levels.${decD.level}`).toLowerCase()}`
        : null,
      title: `${t('session.decoupling_halves')}: ${windows(decH)}\n${t('session.decoupling_durability')}: ${windows(decD)}`,
      target: null,
    },
    showHeat && {
      key: 'heat',
      Icon: SunIcon,
      tone: 'bg-amber-50 text-amber-600',
      valueTone: 'text-amber-600',
      label: t('session.insight_heat'),
      value: `${fmt1(weather.heat_penalty_session_pct)}%`,
      sub: `WBGT ${fmt1(weather.wbgt_c)} °C`,
      title: t('session.verdict_heat', { wbgt: fmt1(weather.wbgt_c), pct: fmt1(weather.heat_penalty_session_pct) }),
      target: 'weather',
    },
  ].filter(Boolean);
  const INSIGHT_COLS = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' };

  // Orden del índice = orden de lectura: columna principal y luego lateral.
  const sections = [
    { id: 'pace', label: t('session.pace_title') },
    { id: 'hr', label: t('session.hr_title') },
    ...(race ? [] : [{ id: 'similar', label: t('session.similar_title') }]),
    { id: 'weather', label: t('session.weather_title') },
  ];
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div ref={rootRef} className="space-y-5">
      {/* ── Barra fija: volver, secciones y anterior/siguiente ─────────────── */}
      <nav className="sticky top-0 z-30 -mx-4 lg:-mx-8 -mt-4 lg:-mt-8 px-4 lg:px-8 py-2.5 bg-[#f4f6fb]/85 backdrop-blur-md border-b border-slate-200/70">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            title={`${t('session.back')} (Esc)`}
            className="inline-flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-lg text-xs font-semibold text-slate-600 hover:bg-white hover:text-blue-600 transition-colors shrink-0"
          >
            <ArrowLeftIcon className="w-4 h-4" /> <span className="hidden sm:inline">{t('session.back')}</span>
          </button>
          <span className="hidden sm:block w-px h-5 bg-slate-200 shrink-0" />
          <div className="flex-1 min-w-0 flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => jump(s.id)}
                className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-500 hover:bg-white hover:text-slate-900 transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <StepButton target={prev} label={t('session.prev')} dir="prev" onStep={step} locale={locale} />
            <StepButton target={next} label={t('session.next')} dir="next" onStep={step} locale={locale} />
          </div>
        </div>
      </nav>

      {/* ── Cabecera: identidad, cifras, veredicto y recorrido ─────────────── */}
      <section className="flex flex-col lg:flex-row bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span className="first-letter:uppercase">
                  {start.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                {race && (
                  <span className="px-1.5 py-px rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800">{t('session.race')}</span>
                )}
              </div>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 break-words">{activity.name}</h1>
            </div>
            <a
              href={`https://www.strava.com/activities/${activity.id}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:border-[#fc4c02] hover:text-[#fc4c02] transition-colors shrink-0"
            >
              {t('session.open_strava')} <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* gap-px sobre fondo gris dibuja los separadores entre bloques */}
          <div className="grid sm:grid-cols-3 gap-px bg-slate-100 border-t border-slate-100">
            <StatGroup
              Icon={MapIcon} accent="bg-blue-50 text-blue-600" label={t('session.grp_volume')}
              value={(activity.distance / 1000).toFixed(2)} unit="km"
              items={[
                { label: t('session.moving_time'), value: formatDuration(moving),
                  hint: stoppedLong ? `${t('session.elapsed')} ${formatDuration(activity.elapsed_time)}` : null },
                { label: t('session.elevation'), value: Math.round(activity.total_elevation_gain || 0), unit: 'm' },
              ]}
            />
            <StatGroup
              Icon={BoltIcon} accent="bg-violet-50 text-violet-600" label={t('session.grp_pace')}
              value={formatPaceFromSpeed(speed)} unit="/km"
              items={[
                { label: 'GAP', value: gap ? formatPaceFromSpeed(gap.speed_ms) : '—', unit: gap ? '/km' : null,
                  title: gap ? t(`session.gap_source.${gap.source}`) : undefined },
                { label: t('session.cadence'), value: cadence ?? '—', unit: cadence ? 'spm' : null },
              ]}
            />
            <StatGroup
              Icon={HeartIcon} accent="bg-rose-50 text-rose-600" label={t('session.grp_effort')}
              value={activity.average_heartrate ? Math.round(activity.average_heartrate) : '—'}
              unit={activity.average_heartrate ? 'ppm' : null}
              caption={activity.average_heartrate ? t('session.avg_word') : null}
              items={[
                { label: t('session.hr_max'), value: activity.max_heartrate ? Math.round(activity.max_heartrate) : '—', unit: activity.max_heartrate ? 'ppm' : null },
                { label: t('session.calories'), value: activity.calories ? Math.round(activity.calories) : '—', unit: activity.calories ? 'kcal' : null },
              ]}
            >
              <HrStrip avg={activity.average_heartrate} max={activity.max_heartrate} hrmax={hrmax} hrrest={hrrest} t={t} />
            </StatGroup>
          </div>
        </div>

        {/* Columna derecha: recorrido y, debajo, el veredicto apilado */}
        {(polyline || insights.length > 0) && (
          <div className="flex flex-col lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-100">
            {polyline && (
              <RouteMap encoded={polyline} className="relative h-64 lg:h-auto lg:flex-1 lg:min-h-[240px] bg-slate-50" />
            )}
            {insights.length > 0 && (
              <div className={`grid gap-px bg-slate-100 border-t border-slate-100 ${INSIGHT_COLS[insights.length]} lg:grid-cols-1 ${polyline ? '' : 'lg:border-t-0 lg:flex-1'}`}>
                {insights.map(({ key, target, ...rest }) => (
                  <Insight key={key} {...rest} onClick={target ? () => jump(target) : undefined} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Ritmo: parciales, tabla y mejores esfuerzos ─────────────────── */}
      <Card id="pace" title={t('session.pace_title')}>
        {splits?.length
          ? <ActivitySplits mode="pace" splits={splits} hrParams={hrParams} bestEfforts={activity.best_efforts}
              similarActivities={activity.similar_activities} splitsMetric={activity.splits_metric} />
          : <Empty>{t('session.no_splits')}</Empty>}
      </Card>

      {/* ── Frecuencia cardíaca: FC por parcial y tiempo en zona ────────── */}
      <Card id="hr" title={t('session.hr_title')}>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 min-w-0">
            {splits?.length
              ? <ActivitySplits mode="hr" splits={splits} hrParams={hrParams} splitsMetric={activity.splits_metric} />
              : <Empty>{t('session.no_splits')}</Empty>}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 mb-3">{t('session.zones_title')}</p>
            <ZonesBlock zones={zones} t={t} />
          </div>
        </div>
      </Card>

      {/* ── Contexto: con qué se compara y en qué condiciones ───────────── */}
      <div className="grid gap-5 lg:grid-cols-3 items-start">
        {!race && (
          <Card id="similar" title={t('session.similar_title')} className="lg:col-span-2 min-w-0">
            <SimilarBlock similar={similar} activity={activity} gap={gap} onOpenActivity={onOpenActivity} t={t} locale={locale} />
          </Card>
        )}
        <Card id="weather" title={t('session.weather_title')} className="min-w-0">
          <WeatherBlock weather={weather} t={t} />
        </Card>
      </div>

      <p className="hidden lg:block text-center text-[11px] text-slate-500">{t('session.keys_hint')}</p>
    </div>
  );
}
