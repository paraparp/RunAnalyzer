import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, ArrowTopRightOnSquareIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon,
  ArrowTrendingUpIcon, ArrowTrendingDownIcon, ScaleIcon, HeartIcon, SunIcon,
  AdjustmentsHorizontalIcon, XMarkIcon, ChatBubbleLeftRightIcon, CalendarDaysIcon, ChartBarIcon, FlagIcon,
} from '@heroicons/react/24/outline';
import { activityNeighbors } from '../lib/activityNeighbors';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import ActivitySplits from './ActivitySplits';
import RouteMap from './RouteMap';
import SessionStreams from './SessionStreams';
import { karvonenBounds, classifyHR } from '../lib/hrZones';
import { ZONES } from '../lib/zoneColors';
import { formatDuration, formatPaceFromSpeed } from '../lib/timeFormat';
import { readStoredGarminActivities } from '../lib/garminActivitiesSync';
import { matchGarminByStart } from '../lib/hrSource';
import {
  findSimilarSessions, isRace, sessionDecoupling, sessionEfficiency, sessionGap, sessionWeather, sessionZones,
} from '../lib/sessionAnalysis';
import { COLORS, AXIS_TICK } from '../lib/palette';

// Vista de sesión (/activity/:id): "¿qué pasó en este entreno?" en una página.
// Todos los números salen de lib/sessionAnalysis, que a su vez delega en el módulo
// dueño de cada uno: aquí no se calcula nada, solo se presenta.
// Orden de lectura: veredicto → cifras de la sesión → perfil → ritmo → FC →
// contexto → qué hacer ahora.

// Semáforo del desacoplamiento. «Normal» es lo esperable, no un aviso: va en tinta.
const LEVEL_TONE = {
  excellent: 'text-emerald-700',
  good: 'text-emerald-700',
  normal: 'text-slate-900',
  high: 'text-orange-700',
  very_high: 'text-rose-700',
};

// Mismo semáforo, en versión pastilla para el icono del indicador.
const LEVEL_PILL = {
  excellent: 'bg-emerald-50 text-emerald-700',
  good: 'bg-emerald-50 text-emerald-700',
  normal: 'bg-slate-100 text-slate-600',
  high: 'bg-orange-50 text-orange-700',
  very_high: 'bg-rose-50 text-rose-700',
};

const NEUTRAL_PILL = 'bg-slate-100 text-slate-600';
// Por debajo de esta diferencia con la mediana del grupo, la eficiencia es ruido.
const EF_NOISE_PCT = 2;

const SHEET = 'bg-white rounded border border-slate-200 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';

const fmt1 = (v) => (v == null ? '—' : v.toFixed(1));
const signed = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);
// Strava da la cadencia de carrera por pierna; Garmin, por minuto de ambas.
const spm = (c) => (c ? Math.round(c < 120 ? c * 2 : c) : null);

function Card({ id, title, aside, children, className = '', flush = false }) {
  return (
    <section id={id} className={`scroll-mt-20 ${SHEET} ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-5 h-11 border-b border-slate-100">
          <h2 className="text-label font-bold uppercase text-slate-500">{title}</h2>
          {aside}
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

function Empty({ children }) {
  return <p className="text-xs italic text-slate-500">{children}</p>;
}

function Loading({ children }) {
  return (
    <div role="status" className="h-32 rounded bg-slate-50 motion-safe:animate-pulse flex items-center justify-center text-xs text-slate-500">
      {children}
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
  const avgZone = classifyHR(avg, bounds) + 1;
  const zone = ZONES[avgZone];
  const bpm = t('session.u_bpm');
  return (
    <figure className="mt-6">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-xs text-slate-500 tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[50%] border-2 border-white shadow" style={{ background: zone.color }} aria-hidden="true" />
          {t('session.avg_hr')} <b className="font-bold text-slate-800">{Math.round(avg)}</b> {bpm}
        </span>
        {max && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-0.5 h-3 bg-slate-500" aria-hidden="true" />
            {t('session.hr_max')} <b className="font-bold text-slate-800">{Math.round(max)}</b> {bpm}
          </span>
        )}
      </figcaption>
      <div className="relative h-2" aria-hidden="true">
        <div className="absolute inset-0 flex rounded-full overflow-hidden">
          {[1, 2, 3, 4, 5].map((z, i) => (
            <div key={z} style={{ width: `${((edges[i + 1] - edges[i]) / (hi - lo)) * 100}%`, background: ZONES[z].color, opacity: 0.35 }} />
          ))}
        </div>
        {max && (
          <span className="absolute top-1/2 w-0.5 h-3.5 -translate-x-1/2 -translate-y-1/2 bg-slate-500" style={{ left: pos(max) }} />
        )}
        <span className="absolute top-1/2 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-white shadow" style={{ left: pos(avg), background: zone.color }} />
      </div>
      <div className="mt-1 flex justify-between text-xs font-semibold" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((z) => (
          <span key={z} className={z === avgZone ? 'font-black' : 'text-slate-500'} style={z === avgZone ? { color: ZONES[z].text } : undefined}>{ZONES[z].label}</span>
        ))}
      </div>
    </figure>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <div className="min-w-0">
      <div className="text-label font-bold uppercase text-slate-500">{label}</div>
      <div className="text-xl leading-tight font-black tabular-nums text-slate-900 truncate">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function ZonesBlock({ zones, t }) {
  if (!zones) return <Empty>{t('session.no_hr')}</Empty>;
  const top = Math.max(...zones.pct);
  const groups = [
    { key: 'low', cls: 'bg-sky-50 text-sky-800' },
    { key: 'mod', cls: 'bg-amber-50 text-amber-800' },
    { key: 'high', cls: 'bg-rose-50 text-rose-800' },
  ];
  return (
    <>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {zones.pct.map((p, i) => p > 0 && (
          <div key={i} style={{ width: `${p}%`, background: ZONES[i + 1].color }} />
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {zones.pct.map((p, i) => {
          const dominant = p > 0 && p === top;
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="w-7 shrink-0 text-xs font-black" style={{ color: ZONES[i + 1].text }}>{ZONES[i + 1].label}</span>
              <div className="relative h-5 flex-1 rounded bg-slate-50" aria-hidden="true">
                <div
                  className="absolute inset-y-0 left-0 rounded motion-safe:transition-[width] motion-safe:duration-500"
                  style={{ width: `${Math.max(p, p > 0 ? 1 : 0)}%`, background: ZONES[i + 1].color, opacity: dominant ? 1 : 0.7 }}
                />
              </div>
              <span className={`w-10 shrink-0 text-right text-sm tabular-nums ${dominant ? 'font-black text-slate-900' : 'font-semibold text-slate-600'}`}>
                {Math.round(p)}%
              </span>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-500">{formatDuration(zones.times[i])}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {groups.map(({ key, cls }) => (
          <span key={key} className={`px-1.5 py-0.5 rounded text-label font-bold uppercase tabular-nums ${cls}`}>
            {t(`session.group_${key}`)} {Math.round(zones.groups[key])}%
          </span>
        ))}
      </div>
      {zones.resolution === 'average' && (
        <p className="mt-2 text-xs text-amber-800">{t('session.zones_average_only')}</p>
      )}
    </>
  );
}

function WeatherBlock({ weather, t }) {
  if (!weather) return <Empty>{t('session.no_weather')}</Empty>;
  if (!weather.wbgt_plausible) return <Empty>{t('session.weather_implausible')}</Empty>;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-5">
      <Kpi label={t('session.temp')} value={`${fmt1(weather.temp_c)} °C`} hint={weather.humidity_pct != null ? `${Math.round(weather.humidity_pct)}% ${t('session.u_rh')}` : null} />
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
const OWN = COLORS.signal;
const PEER = COLORS.inkFaint;

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
    elevation_gain_m: activity.total_elevation_gain ?? null,
    efficiency: ownEf,
    current: true,
  };
}

/** «12,4 km · 5:02/km · +85 m · 148 ppm»: la línea de resumen de una sesión. */
function sessionLine(s, t) {
  return [
    s.distance_m != null && `${(s.distance_m / 1000).toFixed(1)} km`,
    `${formatPaceFromSpeed(s.speed_ms)}/km`,
    s.elevation_gain_m != null && `+${Math.round(s.elevation_gain_m)} m`,
    s.avg_hr && `${Math.round(s.avg_hr)} ${t('session.u_bpm')}`,
  ].filter(Boolean).join(' · ');
}

function SimilarTooltip({ active, payload, t, locale }) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded shadow-lg p-3 text-xs">
      <p className="font-bold text-slate-700 truncate max-w-[220px]">{s.current ? t('session.this_session') : s.name}</p>
      <p className="text-slate-500 mb-1">{new Date(s.date).toLocaleDateString(locale, { dateStyle: 'medium' })}</p>
      <p className="font-semibold tabular-nums text-slate-900">{s.efficiency.toFixed(2)} {t('session.u_ef')}</p>
      <p className="tabular-nums text-slate-500">{sessionLine({ ...s, distance_m: null }, t)}</p>
    </div>
  );
}

// La gráfica es la lectura visual; la lista de al lado es la vía accesible (cada
// fila es un botón), así que los puntos no entran en el orden de tabulación.
function SimilarChart({ points, median, onOpenActivity, t, locale }) {
  const dot = ({ cx, cy, payload }) => (
    <circle
      key={payload.id}
      cx={cx} cy={cy}
      r={payload.current ? 6 : 3.5}
      fill={payload.current ? OWN : PEER}
      stroke={COLORS.paper} strokeWidth={2}
      style={{ cursor: payload.current ? 'default' : 'pointer' }}
      onClick={() => !payload.current && onOpenActivity(payload.id)}
    />
  );
  return (
    <div aria-hidden="true">
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.hairline} vertical={false} />
          <XAxis
            dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
            tickFormatter={(v) => new Date(v).toLocaleDateString(locale, { month: 'short', year: '2-digit' })}
            tick={AXIS_TICK} minTickGap={24}
          />
          <YAxis
            domain={[(min) => Math.floor((min - 0.05) * 10) / 10, (max) => Math.ceil((max + 0.05) * 10) / 10]}
            tickFormatter={(v) => v.toFixed(1)}
            width={32} tick={AXIS_TICK}
          />
          <RechartsTooltip content={<SimilarTooltip t={t} locale={locale} />} />
          {median != null && <ReferenceLine y={median} stroke={PEER} strokeDasharray="4 4" />}
          <Line
            type="linear" dataKey="efficiency" stroke={COLORS.hairlineStrong} strokeWidth={1.5}
            dot={dot} activeDot={false} isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function SimilarRow({ s, onOpenActivity, t, locale }) {
  const base = 'group flex items-center gap-3 px-3 py-2 rounded';
  const Tag = s.current ? 'div' : 'button';
  return (
    <Tag
      {...(s.current ? { 'aria-current': 'true' } : { type: 'button', onClick: () => onOpenActivity(s.id) })}
      className={`${base} w-full text-left ${s.current ? 'bg-blue-50 ring-1 ring-blue-200' : `hover:bg-slate-50 ${FOCUS}`}`}
    >
      <span className={`w-14 shrink-0 text-xs tabular-nums ${s.current ? 'font-bold text-blue-700' : 'text-slate-500'}`}>
        {new Date(s.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: '2-digit' })}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-semibold ${s.current ? 'text-blue-800' : 'text-slate-700 group-hover:text-blue-700'}`}>
          {s.current ? t('session.this_session') : s.name}
        </span>
        <span className="block truncate text-xs tabular-nums text-slate-500">{sessionLine(s, t)}</span>
      </span>
      <span className={`shrink-0 text-right text-sm font-black tabular-nums ${s.current ? 'text-blue-700' : 'text-slate-800'}`}>
        {s.efficiency != null ? s.efficiency.toFixed(2) : '—'}
        <span className="block text-label font-bold uppercase text-slate-500">{t('session.u_ef')}</span>
      </span>
      {!s.current && <ChevronRightIcon className="w-3.5 h-3.5 shrink-0 text-slate-400 group-hover:text-blue-500" aria-hidden="true" />}
    </Tag>
  );
}

function similarPoints(similar, own) {
  return [...similar.history, own]
    .filter((s) => s.efficiency != null)
    .map((s) => ({ ...s, t: new Date(s.date).getTime() }))
    .sort((a, b) => a.t - b.t);
}

function SimilarBlock({ similar, activity, gap, onOpenActivity, t, locale }) {
  if (!similar || similar.n === 0) return <Empty>{t('session.no_similar')}</Empty>;
  const own = ownRow(activity, gap, similar.own_ef);
  const points = similarPoints(similar, own);
  const rows = [...similar.sessions, own].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <>
      <p className="mb-4 text-xs text-slate-500">
        {t('session.similar_summary', {
          n: similar.n,
          dist: similar.criteria.distance_tol_pct,
          pace: similar.criteria.pace_tol_pct ?? 10,
        })}
      </p>

      <div className="grid gap-6 lg:grid-cols-5">
        {points.length >= 2 && (
          <div className="lg:col-span-3">
            <SimilarChart points={points} median={similar.median_ef} onOpenActivity={onOpenActivity} t={t} locale={locale} />
            <p className="mt-2 text-xs text-slate-500">{t('session.similar_chart_hint')}</p>
          </div>
        )}
        <div className={points.length >= 2 ? 'lg:col-span-2' : 'lg:col-span-5'}>
          <div className="space-y-0.5 lg:max-h-[260px] lg:overflow-y-auto lg:pr-1">
            {rows.map((s) => <SimilarRow key={s.id} s={s} onOpenActivity={onOpenActivity} t={t} locale={locale} />)}
          </div>
          {similar.n > similar.sessions.length && (
            <p className="mt-2 text-xs text-slate-500">
              {t('session.similar_more', { shown: similar.sessions.length, n: similar.n })}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

const DEFAULT_FILTERS = { distanceTolPct: 10, paceTolPct: 10, elevMode: 'similar', hrTolBpm: null };

function FilterGroup({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label}>
      <span className="block text-label font-bold uppercase text-slate-500 mb-1">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium tabular-nums transition-colors cursor-pointer ${FOCUS} ${
                active
                  ? 'bg-slate-100 border border-slate-300 text-slate-800'
                  : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SimilarModal({ isOpen, onClose, activity, activities, gap, onOpenActivity, t, locale }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  // Teclado del diálogo: Esc cierra, Tab no sale del diálogo y, al cerrar, el foco
  // vuelve al botón que lo abrió. Se escucha en captura y se detiene la
  // propagación: las teclas del modal no deben llegar a la vista de debajo.
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const items = dialogRef.current.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      // Las flechas cambian de sesión en la vista: con el modal abierto, no.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, [isOpen, onClose]);

  const modalSimilar = useMemo(() => {
    if (!isOpen || !activity) return null;
    return findSimilarSessions(activity, activities, { ...filters, limit: null });
  }, [isOpen, activity, activities, filters]);

  if (!isOpen) return null;

  const own = ownRow(activity, gap, modalSimilar?.own_ef);
  const points = modalSimilar ? similarPoints(modalSimilar, own) : [];
  const rows = modalSimilar
    ? [...modalSimilar.sessions, own].sort((a, b) => new Date(b.date) - new Date(a.date))
    : [];
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const bpm = t('session.u_bpm');
  const openAndClose = (id) => { onClose(); onOpenActivity(id); };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-3 sm:p-6 motion-safe:animate-[fadeIn_120ms_ease-out]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="similar-modal-title"
        className="flex flex-col w-full max-w-5xl h-[90vh] bg-white rounded shadow-2xl overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-6 py-3.5 border-b border-slate-100 bg-white shrink-0">
          <div className="min-w-0">
            <h2 id="similar-modal-title" className="text-base font-bold text-slate-900 truncate">
              {t('session.comparison_modal_title')}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate tabular-nums">
              {activity.name} · {sessionLine(own, t)}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 ${FOCUS}`}
            aria-label={t('session.close')}
            title={`${t('session.close')} (Esc)`}
          >
            <XMarkIcon className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 shrink-0 space-y-2.5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterGroup
              label={t('session.filter_pace')} value={filters.paceTolPct} onChange={set('paceTolPct')}
              options={[10, 20, null].map((v) => ({ value: v, label: v != null ? `±${v}%` : t('session.opt_any') }))}
            />
            <FilterGroup
              label={t('session.filter_dist')} value={filters.distanceTolPct} onChange={set('distanceTolPct')}
              options={[5, 10, 20].map((v) => ({ value: v, label: `±${v}%` }))}
            />
            <FilterGroup
              label={t('session.filter_elev')} value={filters.elevMode} onChange={set('elevMode')}
              options={[
                { value: 'similar', label: t('session.opt_similar') },
                { value: 'flat', label: t('session.opt_flat') },
                { value: 'any', label: t('session.opt_any') },
              ]}
            />
            <FilterGroup
              label={t('session.filter_hr')} value={filters.hrTolBpm} onChange={set('hrTolBpm')}
              options={[
                { value: null, label: t('session.opt_any') },
                { value: 5, label: `±5 ${bpm}` },
                { value: 10, label: `±10 ${bpm}` },
              ]}
            />
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-200 text-xs">
            <span className="text-slate-500 font-medium tabular-nums" role="status">
              {modalSimilar?.n
                ? t('session.modal_found', { count: modalSimilar.n, n: modalSimilar.n, median: modalSimilar.median_ef?.toFixed(2) ?? '—' })
                : t('session.no_similar')}
            </span>
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className={`rounded text-slate-500 hover:text-slate-800 hover:underline cursor-pointer ${FOCUS}`}
            >
              {t('session.reset_filters')}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {!modalSimilar || modalSimilar.n === 0 ? (
            <Empty>{t('session.no_similar')}</Empty>
          ) : (
            <div className="grid gap-6 lg:grid-cols-5 h-full">
              <div className="lg:col-span-3 flex flex-col">
                <SimilarChart points={points} median={modalSimilar.median_ef} onOpenActivity={openAndClose} t={t} locale={locale} />
                <p className="text-xs text-slate-500 mt-2">{t('session.similar_chart_hint')}</p>
              </div>
              <div className="lg:col-span-2 flex flex-col min-h-0">
                <p className="text-label font-bold uppercase text-slate-500 mb-2">{t('session.modal_all_sessions', { n: rows.length })}</p>
                <div className="space-y-1 overflow-y-auto pr-1 flex-1 max-h-[380px]">
                  {rows.map((s) => (
                    <SimilarRow key={s.id} s={s} onOpenActivity={openAndClose} t={t} locale={locale} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Indicador del veredicto: la cifra y su lectura; si tiene sección, lleva a ella. */
function Insight({ Icon, tone, valueTone, label, value, sub, extra, title, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      title={title}
      className={`flex items-start gap-3 bg-white px-5 py-4 text-left ${onClick ? `hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500 transition-colors` : ''}`}
    >
      <span className={`mt-1 inline-flex items-center justify-center w-8 h-8 rounded shrink-0 ${tone}`} aria-hidden="true">
        <Icon className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-label font-bold uppercase text-slate-500">{label}</span>
        <span className={`block text-2xl leading-tight font-black tabular-nums tracking-tight ${valueTone}`}>{value}</span>
        <span className="block text-xs font-medium text-slate-600 first-letter:uppercase">{sub}</span>
        {extra && <span className="block text-xs tabular-nums text-slate-500">{extra}</span>}
      </span>
    </Tag>
  );
}

/** Las cifras de la sesión, en una franja compacta: contexto del veredicto, no titular. */
function Totals({ items, cols }) {
  return (
    <dl className={`grid grid-cols-3 sm:grid-cols-5 ${cols} gap-x-4 gap-y-3 px-5 py-4`}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0" title={it.title}>
          <dt className="text-label font-bold uppercase text-slate-500 truncate">{it.label}</dt>
          <dd className="text-lg leading-tight font-black tabular-nums text-slate-900 truncate">
            {it.value}{it.unit && <span className="ml-0.5 text-xs font-semibold text-slate-500">{it.unit}</span>}
          </dd>
          {it.hint && <dd className="text-xs text-slate-500 truncate">{it.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** «Cómo leer»: qué significan eficiencia, deriva y durabilidad, sin depender del hover. */
function HowToRead({ t }) {
  return (
    <details className="group border-t border-slate-100">
      <summary className={`flex items-center gap-1.5 px-5 py-2.5 cursor-pointer list-none text-xs font-semibold text-blue-700 hover:bg-blue-50/60 [&::-webkit-details-marker]:hidden ${FOCUS}`}>
        <ChevronDownIcon className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
        {t('session.how_to_read')}
      </summary>
      <div className="mx-5 mb-4 rounded border border-blue-100 bg-blue-50 px-4 py-3 space-y-2 text-sm text-blue-900 max-w-[75ch]">
        <p>{t('session.how_ef')}</p>
        <p>{t('session.how_drift')}</p>
        <p>{t('session.how_durability')}</p>
      </div>
    </details>
  );
}

/** Cierre de la página: el dato lleva a una acción (coach, plan, carga u objetivo). */
function NextSteps({ actions }) {
  if (!actions.length) return null;
  return (
    <div className={`grid gap-px bg-slate-100 ${actions.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {actions.map(({ key, Icon, label, hint, onClick, primary }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          className={`group flex items-start gap-3 bg-white px-5 py-4 text-left hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-500`}
        >
          <span className={`mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded shrink-0 ${primary ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'}`} aria-hidden="true">
            <Icon className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-sm font-bold text-slate-900 group-hover:text-blue-700">
              {label} <ChevronRightIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </span>
            <span className="block text-xs text-slate-500">{hint}</span>
          </span>
        </button>
      ))}
    </div>
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
      className={`inline-flex items-center gap-1 h-8 px-2.5 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-600 transition-colors ${FOCUS}`}
    >
      {dir === 'prev' && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      <span className="hidden md:inline">{label}</span>
      {dir === 'next' && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
    </button>
  );
}

export default function SessionView({
  activityId, activities, hrParams, accessToken,
  onBack, onOpenActivity, onStepActivity, onEnrichActivity, onNavigate, onAskCoach,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const rootRef = useRef(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Identidad estable: el efecto de teclado y foco del modal depende de ella.
  const closeModal = useCallback(() => setIsModalOpen(false), []);
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
  // Con el modal abierto las teclas son suyas (además, él detiene la propagación).
  const { prev, next } = useMemo(() => activityNeighbors(activity, activities), [activity, activities]);
  const step = onStepActivity ?? onOpenActivity;
  useEffect(() => {
    if (isModalOpen) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (e.key === 'Escape') { onBack?.(); return; }
      const target = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : null;
      if (target) step?.(target.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, step, onBack, isModalOpen]);

  // Trae el detalle (vueltas, parciales, mejores esfuerzos) si aún no está: lo mismo
  // que hace la bitácora al desplegar una fila. Es idempotente. Mientras dura, los
  // parciales dicen que se están descargando, no que faltan.
  const [enriching, setEnriching] = useState(false);
  useEffect(() => {
    if (!activity || !onEnrichActivity) return undefined;
    let alive = true;
    setEnriching(true);
    Promise.resolve(onEnrichActivity(activity.id))
      .catch(() => {})
      .finally(() => alive && setEnriching(false));
    return () => { alive = false; };
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
      similar: isRace(activity) ? null : findSimilarSessions(activity, activities, {
        distanceTolPct: 10,
        paceTolPct: 10,
        elevMode: 'similar',
        limit: 10,
      }),
    };
  }, [activity, activities, hrmax, hrrest]);

  if (!activity) {
    return (
      <Card>
        <p className="text-sm text-slate-500 mb-3">{t('session.not_found')}</p>
        <button onClick={onBack} className={`rounded text-sm font-bold text-blue-600 hover:underline ${FOCUS}`}>{t('session.back')}</button>
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
  const bpm = t('session.u_bpm');
  const dateLabel = start.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const showHeat = weather?.wbgt_plausible && weather.heat_penalty_session_pct != null && weather.heat_penalty_session_pct >= 0.5;
  const stoppedLong = activity.elapsed_time && activity.elapsed_time - moving > 60;

  // ── Veredicto ───────────────────────────────────────────────────────────
  // Cada indicador es la cifra y su lectura; la frase de arriba los dice en
  // palabras para que nada dependa del hover.
  const efDelta = similar?.ef_delta_pct;
  const efNeutral = efDelta == null || Math.abs(efDelta) < EF_NOISE_PCT;
  const decH = decoupling.halves;
  const decD = decoupling.durability;
  const windows = (d) => (d.pct != null
    ? `${d.initial.window}: ${Math.round(d.initial.avg_hr)} ${bpm} @ ${formatPaceFromSpeed(d.initial.avg_speed_ms)} → ${d.final.window}: ${Math.round(d.final.avg_hr)} ${bpm} @ ${formatPaceFromSpeed(d.final.avg_speed_ms)}`
    : t(`session.decoupling_reason.${d.reason}`));

  const verdict = [
    efDelta != null && t('session.verdict_efficiency', { delta: signed(efDelta), n: similar.n, rank: similar.rank, total: similar.n + 1 }),
    decH.pct != null && t('session.verdict_decoupling', { pct: signed(decH.pct), level: t(`decoupling.levels.${decH.level}`).toLowerCase() }),
    showHeat && t('session.verdict_heat', { wbgt: fmt1(weather.wbgt_c), pct: fmt1(weather.heat_penalty_session_pct) }),
  ].filter(Boolean);

  const insights = [
    efficiency.whole != null && {
      key: 'ef',
      Icon: efNeutral ? ScaleIcon : efDelta > 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon,
      tone: efNeutral ? NEUTRAL_PILL : efDelta > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
      valueTone: efNeutral ? 'text-slate-900' : efDelta > 0 ? 'text-emerald-700' : 'text-rose-700',
      label: t('session.efficiency_title'),
      value: efDelta != null ? `${signed(efDelta)}%` : efficiency.whole.toFixed(2),
      sub: efDelta != null ? t('session.insight_vs_similar', { rank: similar.rank, total: similar.n + 1 }) : t('session.u_ef'),
      extra: [
        efDelta != null && efNeutral && t('session.ef_neutral'),
        efDelta != null && `EF ${efficiency.whole.toFixed(2)} ${t('session.u_ef')}`,
        efficiency.aerobic != null && `${t('session.ef_aerobic_short')} ${efficiency.aerobic.toFixed(2)}`,
        similar?.median_ef && `${t('session.median_short')} ${similar.median_ef.toFixed(2)}`,
      ].filter(Boolean).join(' · ') || null,
      title: efDelta == null ? t('session.ef_aerobic_hint') : undefined,
      target: efDelta != null ? 'similar' : null,
    },
    {
      key: 'dec',
      Icon: HeartIcon,
      tone: LEVEL_PILL[decH.level] ?? NEUTRAL_PILL,
      valueTone: LEVEL_TONE[decH.level] ?? 'text-slate-500',
      label: t('session.decoupling_title'),
      value: decH.pct != null ? `${signed(decH.pct)}%` : '—',
      sub: decH.pct != null ? t(`decoupling.levels.${decH.level}`) : t(`session.decoupling_reason.${decH.reason}`),
      extra: decD.pct != null
        ? `${t('session.durability_short')} ${signed(decD.pct)}% · ${t(`decoupling.levels.${decD.level}`).toLowerCase()}`
        : null,
      title: `${t('session.decoupling_halves')}: ${windows(decH)}\n${t('session.decoupling_durability')}: ${windows(decD)}`,
      target: 'hr',
    },
    showHeat && {
      key: 'heat',
      Icon: SunIcon,
      tone: 'bg-amber-50 text-amber-800',
      valueTone: 'text-amber-800',
      label: t('session.insight_heat'),
      value: `${fmt1(weather.heat_penalty_session_pct)}%`,
      sub: `WBGT ${fmt1(weather.wbgt_c)} °C`,
      target: 'weather',
    },
  ].filter(Boolean);
  const INSIGHT_COLS = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' };

  // El mapa de la cabecera solo cuando no hay streams: con ellos, el mapa vive en
  // el perfil de la sesión (enlazado al tramo) y no se repite.
  const headerMap = !accessToken && polyline;
  const totals = [
    { label: t('session.distance'), value: (activity.distance / 1000).toFixed(2), unit: 'km' },
    { label: t('session.moving_time'), value: formatDuration(moving),
      hint: stoppedLong ? `${t('session.elapsed')} ${formatDuration(activity.elapsed_time)}` : null },
    { label: t('session.pace'), value: formatPaceFromSpeed(speed), unit: '/km' },
    { label: 'GAP', value: gap ? formatPaceFromSpeed(gap.speed_ms) : '—', unit: gap ? '/km' : null,
      hint: gap ? t(`session.gap_source.${gap.source}`) : null },
    { label: t('session.avg_hr'), value: activity.average_heartrate ? Math.round(activity.average_heartrate) : '—', unit: activity.average_heartrate ? bpm : null },
    { label: t('session.hr_max'), value: activity.max_heartrate ? Math.round(activity.max_heartrate) : '—', unit: activity.max_heartrate ? bpm : null },
    { label: t('session.elevation'), value: Math.round(activity.total_elevation_gain || 0), unit: 'm' },
    { label: t('session.cadence'), value: cadence ?? '—', unit: cadence ? 'spm' : null },
    { label: t('session.calories'), value: activity.calories ? Math.round(activity.calories) : '—', unit: activity.calories ? 'kcal' : null },
  ];

  // ── Qué hacer ahora ─────────────────────────────────────────────────────
  // Cada acción lleva a la vista dueña de ese número; aquí no se repite.
  const askCoach = onAskCoach && (() => {
    const lastWork = [
      `${activity.name} · ${dateLabel}`,
      totals.filter((it) => it.value !== '—').map((it) => `${it.label}: ${it.value}${it.unit ? ` ${it.unit}` : ''}`).join(' · '),
      ...verdict,
    ].join('\n');
    onAskCoach({ blocks: { lastWork }, ask: t('session.next_coach_ask', { name: activity.name, date: dateLabel }) });
  });
  const actions = [
    askCoach && { key: 'coach', Icon: ChatBubbleLeftRightIcon, label: t('session.next_coach'), hint: t('session.next_coach_hint'), onClick: askCoach, primary: true },
    onNavigate && (race
      ? { key: 'race', Icon: FlagIcon, label: t('session.next_race'), hint: t('session.next_race_hint'), onClick: () => onNavigate('targets') }
      : { key: 'plan', Icon: CalendarDaysIcon, label: t('session.next_plan'), hint: t('session.next_plan_hint'), onClick: () => onNavigate('planner') }),
    onNavigate && { key: 'load', Icon: ChartBarIcon, label: t('session.next_load'), hint: t('session.next_load_hint'), onClick: () => onNavigate('pmc') },
  ].filter(Boolean);

  // Orden del índice = orden de lectura.
  const sections = [
    ...(accessToken ? [{ id: 'streams', label: t('session.streams_title') }] : []),
    { id: 'pace', label: t('session.pace_title') },
    { id: 'hr', label: t('session.hr_title') },
    ...(race ? [] : [{ id: 'similar', label: t('session.similar_title') }]),
    { id: 'weather', label: t('session.weather_title') },
    ...(actions.length ? [{ id: 'next', label: t('session.next_title') }] : []),
  ];
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const splitsBody = (content) => {
    if (splits?.length) return content;
    if (enriching) return <Loading>{t('session.splits_loading')}</Loading>;
    return <Empty>{t('session.splits_none')}</Empty>;
  };

  return (
    <div ref={rootRef} className="space-y-6">
      {/* ── Barra fija: volver, secciones y anterior/siguiente ─────────────── */}
      <nav aria-label={t('session.back')} className="sticky top-0 z-30 -mx-4 lg:-mx-8 -mt-4 lg:-mt-8 px-4 lg:px-8 py-2.5 bg-[var(--bg-main)] border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t('session.back')}
            title={`${t('session.back')} (Esc)`}
            className={`inline-flex items-center gap-1.5 h-8 pl-2 pr-3 rounded text-xs font-semibold text-slate-600 hover:bg-white hover:text-blue-600 transition-colors shrink-0 ${FOCUS}`}
          >
            <ArrowLeftIcon className="w-4 h-4" aria-hidden="true" /> <span className="hidden sm:inline">{t('session.back')}</span>
          </button>
          <span className="hidden sm:block w-px h-5 bg-slate-200 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0 flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => jump(s.id)}
                className={`shrink-0 px-2.5 py-1 rounded text-xs font-semibold text-slate-500 hover:bg-white hover:text-slate-900 transition-colors ${FOCUS}`}
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

      {/* ── Cabecera: identidad, veredicto y cifras de la sesión ────────────── */}
      <section className={`flex flex-col lg:flex-row overflow-hidden ${SHEET}`}>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span className="first-letter:uppercase">{dateLabel}</span>
                <span className="text-slate-400" aria-hidden="true">·</span>
                <span className="tabular-nums">{start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                {race && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-label font-bold uppercase bg-slate-100 text-slate-800 ring-1 ring-inset ring-slate-300">
                    <FlagIcon className="w-3 h-3" aria-hidden="true" />{t('session.race')}
                  </span>
                )}
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight leading-tight text-slate-900 text-balance break-words">{activity.name}</h1>
            </div>
            <a
              href={`https://www.strava.com/activities/${activity.id}`} target="_blank" rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded border border-slate-200 text-xs font-semibold text-slate-600 hover:border-[var(--strava)] hover:text-[var(--strava)] transition-colors shrink-0 ${FOCUS}`}
              style={{ '--strava': COLORS.strava }}
            >
              {t('session.open_strava')} <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </div>

          {/* La respuesta, en palabras: lo primero que se lee después del nombre. */}
          <p className="px-5 pt-2 pb-4 text-sm leading-relaxed text-slate-600 max-w-[75ch]">
            {verdict.length ? verdict.join(' ') : t('session.verdict_none')}
          </p>

          {insights.length > 0 && (
            <div className={`grid gap-px bg-slate-100 border-y border-slate-100 ${INSIGHT_COLS[insights.length]}`}>
              {insights.map(({ key, target, ...rest }) => (
                <Insight key={key} {...rest} onClick={target ? () => jump(target) : undefined} />
              ))}
            </div>
          )}
          {insights.length > 0 && <HowToRead t={t} />}

          <div className="border-t border-slate-100 bg-slate-50/60">
            <Totals items={totals} cols={headerMap ? '' : 'xl:grid-cols-9'} />
          </div>
        </div>

        {headerMap && (
          <div className="lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-100">
            <RouteMap encoded={polyline} className="relative h-64 lg:h-full lg:min-h-[280px] bg-slate-50" />
          </div>
        )}
      </section>

      {/* ── Perfil: métricas sincronizadas, tramo y mapa ─────────────────── */}
      {accessToken && (
        <Card id="streams" title={t('session.streams_title')}>
          <SessionStreams
            activityId={activity.id}
            accessToken={accessToken}
            fallback={polyline ? <RouteMap encoded={polyline} className="relative h-64 rounded overflow-hidden bg-slate-50" /> : null}
          />
        </Card>
      )}

      {/* ── Ritmo: parciales, tabla y mejores esfuerzos ─────────────────── */}
      <Card id="pace" title={t('session.pace_title')}>
        {splitsBody(
          <ActivitySplits mode="pace" splits={splits} hrParams={hrParams} bestEfforts={activity.best_efforts}
            similarActivities={activity.similar_activities} splitsMetric={activity.splits_metric} />,
        )}
      </Card>

      {/* ── Frecuencia cardíaca: FC por parcial, zonas y dónde cae la media ── */}
      <Card id="hr" title={t('session.hr_title')}>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 min-w-0">
            {splitsBody(<ActivitySplits mode="hr" splits={splits} hrParams={hrParams} splitsMetric={activity.splits_metric} />)}
          </div>
          <div className="min-w-0">
            <h3 className="text-label font-bold uppercase text-slate-500 mb-3">{t('session.zones_title')}</h3>
            <ZonesBlock zones={zones} t={t} />
            <HrStrip avg={activity.average_heartrate} max={activity.max_heartrate} hrmax={hrmax} hrrest={hrrest} t={t} />
          </div>
        </div>
      </Card>

      {/* ── Contexto: con qué se compara y en qué condiciones ───────────── */}
      <div className="grid gap-6 lg:grid-cols-3 items-start">
        {!race && (
          <Card
            id="similar"
            title={t('session.similar_title')}
            aside={
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className={`inline-flex items-center gap-1.5 rounded text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer ${FOCUS}`}
              >
                <AdjustmentsHorizontalIcon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t('session.open_comparison_modal')}</span>
              </button>
            }
            className="lg:col-span-2 min-w-0"
          >
            <SimilarBlock similar={similar} activity={activity} gap={gap} onOpenActivity={onOpenActivity} t={t} locale={locale} />
          </Card>
        )}
        <Card id="weather" title={t('session.weather_title')} className={race ? 'lg:col-span-3 min-w-0' : 'min-w-0'}>
          <WeatherBlock weather={weather} t={t} />
        </Card>
      </div>

      {/* ── Y ahora qué: el dato termina en una decisión ─────────────────── */}
      {actions.length > 0 && (
        <Card id="next" title={t('session.next_title')} flush>
          <NextSteps actions={actions} />
        </Card>
      )}

      {!race && (
        <SimilarModal
          isOpen={isModalOpen}
          onClose={closeModal}
          activity={activity}
          activities={activities}
          gap={gap}
          onOpenActivity={onOpenActivity}
          t={t}
          locale={locale}
        />
      )}

      <p className="hidden lg:block text-center text-xs text-slate-500">{t('session.keys_hint')}</p>
    </div>
  );
}
