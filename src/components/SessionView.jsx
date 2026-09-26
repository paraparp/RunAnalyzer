import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import ActivitySplits from './ActivitySplits';
import { karvonenBounds } from '../lib/hrZones';
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

const fmt1 = (v) => (v == null ? '—' : v.toFixed(1));
const signed = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);

function Card({ title, children, className = '' }) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200 shadow-sm p-5 ${className}`}>
      {title && <h3 className="text-sm font-bold text-slate-800 mb-3">{title}</h3>}
      {children}
    </section>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
      <div className="text-xl font-black tabular-nums text-slate-900 truncate">{value}</div>
      {hint && <div className="text-[11px] text-slate-400 truncate">{hint}</div>}
    </div>
  );
}

function Empty({ children }) {
  return <p className="text-xs italic text-slate-400">{children}</p>;
}

function ZonesBlock({ zones, t }) {
  if (!zones) return <Empty>{t('session.no_hr')}</Empty>;
  return (
    <>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {zones.pct.map((p, i) => p > 0 && (
          <div key={i} style={{ width: `${p}%`, background: ZONES[i + 1].color }} title={`${ZONES[i + 1].label} ${p}%`} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {zones.pct.map((p, i) => (
          <div key={i} className="text-center">
            <div className="text-[10px] font-black" style={{ color: ZONES[i + 1].text }}>{ZONES[i + 1].label}</div>
            <div className="text-sm font-bold tabular-nums text-slate-800">{Math.round(p)}%</div>
            <div className="text-[10px] tabular-nums text-slate-400">{formatDuration(zones.times[i])}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {t('session.polarized', {
          low: Math.round(zones.groups.low), mod: Math.round(zones.groups.mod), high: Math.round(zones.groups.high),
        })}
      </p>
      {zones.resolution === 'average' && (
        <p className="mt-1 text-[11px] text-amber-600">{t('session.zones_average_only')}</p>
      )}
    </>
  );
}

function DecouplingRow({ label, d, t }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        {d.pct != null && (
          <div className="text-[11px] text-slate-400 truncate">
            {d.initial.window}: {Math.round(d.initial.avg_hr)} ppm @ {formatPaceFromSpeed(d.initial.avg_speed_ms)}
            {' → '}
            {d.final.window}: {Math.round(d.final.avg_hr)} ppm @ {formatPaceFromSpeed(d.final.avg_speed_ms)}
          </div>
        )}
      </div>
      {d.pct != null ? (
        <div className="text-right shrink-0">
          <div className={`text-lg font-black tabular-nums ${LEVEL_TONE[d.level]}`}>{signed(d.pct)}%</div>
          <div className={`text-[10px] font-bold uppercase ${LEVEL_TONE[d.level]}`}>{t(`decoupling.levels.${d.level}`)}</div>
        </div>
      ) : (
        <span className="text-[11px] italic text-slate-400 text-right">{t(`session.decoupling_reason.${d.reason}`)}</span>
      )}
    </div>
  );
}

function WeatherBlock({ weather, t }) {
  if (!weather) return <Empty>{t('session.no_weather')}</Empty>;
  if (!weather.wbgt_plausible) return <Empty>{t('session.weather_implausible')}</Empty>;
  return (
    <div className="grid grid-cols-2 gap-4">
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

function SimilarBlock({ similar, onOpenActivity, t, locale }) {
  if (!similar || similar.n === 0) return <Empty>{t('session.no_similar')}</Empty>;
  return (
    <>
      <p className="text-xs text-slate-500 mb-3">
        {t('session.similar_criteria', {
          n: similar.n,
          dist: similar.criteria.distance_tol_pct,
          hr: similar.criteria.hr_tol_bpm ?? '—',
        })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-slate-400">
              <th className="text-left font-bold py-1.5">{t('session.col_date')}</th>
              <th className="text-left font-bold py-1.5">{t('session.col_name')}</th>
              <th className="text-right font-bold py-1.5">km</th>
              <th className="text-right font-bold py-1.5">{t('session.col_pace')}</th>
              <th className="text-right font-bold py-1.5">GAP</th>
              <th className="text-right font-bold py-1.5">{t('session.col_hr')}</th>
              <th className="text-right font-bold py-1.5">m/lat</th>
            </tr>
          </thead>
          <tbody>
            {similar.sessions.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => onOpenActivity(s.id)}>
                <td className="py-1.5 tabular-nums text-slate-500 whitespace-nowrap">{new Date(s.date).toLocaleDateString(locale)}</td>
                <td className="py-1.5 text-slate-700 truncate max-w-[180px]">{s.name}</td>
                <td className="py-1.5 text-right tabular-nums">{(s.distance_m / 1000).toFixed(1)}</td>
                <td className="py-1.5 text-right tabular-nums">{formatPaceFromSpeed(s.speed_ms)}</td>
                <td className="py-1.5 text-right tabular-nums">{s.gap_speed_ms ? formatPaceFromSpeed(s.gap_speed_ms) : '—'}</td>
                <td className="py-1.5 text-right tabular-nums">{s.avg_hr ? Math.round(s.avg_hr) : '—'}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold">{s.efficiency != null ? s.efficiency.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function SessionView({ activityId, activities, hrParams, onBack, onOpenActivity, onEnrichActivity }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const activity = useMemo(
    () => activities.find((a) => String(a.id) === String(activityId)) ?? null,
    [activities, activityId],
  );

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
  // Sin vueltas del reloj se cae a los parciales por km, que no traen `lap_index`.
  const splits = activity.laps?.length
    ? activity.laps
    : activity.splits_metric?.map((s) => ({ ...s, lap_index: s.split }));

  return (
    <div className="space-y-6">
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <Card>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <button onClick={onBack} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-blue-600 mb-2">
              <ArrowLeftIcon className="w-3.5 h-3.5" /> {t('session.back')}
            </button>
            <h1 className="text-xl font-black text-slate-900 truncate">
              {activity.name}
              {isRace(activity) && <span className="ml-2 align-middle px-1.5 py-px rounded text-[10px] font-bold bg-amber-400 text-white uppercase">Race</span>}
            </h1>
            <p className="text-xs text-slate-500">
              {new Date(activity.start_date).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' })}
            </p>
          </div>
          <a
            href={`https://www.strava.com/activities/${activity.id}`} target="_blank" rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-[#fc4c02] hover:underline"
          >
            Strava <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Kpi label={t('session.distance')} value={`${(activity.distance / 1000).toFixed(2)} km`} />
          <Kpi label={t('session.moving_time')} value={formatDuration(moving)}
            hint={activity.elapsed_time && activity.elapsed_time - moving > 60 ? `${t('session.elapsed')} ${formatDuration(activity.elapsed_time)}` : null} />
          <Kpi label={t('session.pace')} value={`${formatPaceFromSpeed(speed)}/km`} />
          <Kpi label="GAP" value={gap ? `${formatPaceFromSpeed(gap.speed_ms)}/km` : '—'}
            hint={gap ? t(`session.gap_source.${gap.source}`) : null} />
          <Kpi label={t('session.avg_hr')} value={activity.average_heartrate ? `${Math.round(activity.average_heartrate)} ppm` : '—'}
            hint={activity.max_heartrate ? `${t('session.max')} ${Math.round(activity.max_heartrate)}` : null} />
          <Kpi label={t('session.elevation')} value={`${Math.round(activity.total_elevation_gain || 0)} m`} />
        </div>
      </Card>

      {/* ── Veredicto: una frase derivada, no generada (§6.3) ───────────── */}
      {(similar?.ef_delta_pct != null || decoupling.halves.pct != null) && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-5 py-3 text-sm text-slate-700 space-y-1">
          {similar?.ef_delta_pct != null && (
            <p>
              {t('session.verdict_efficiency', {
                delta: signed(similar.ef_delta_pct),
                n: similar.n,
                rank: similar.rank,
                total: similar.n + 1,
              })}
            </p>
          )}
          {decoupling.halves.pct != null && (
            <p>
              {t('session.verdict_decoupling', {
                pct: signed(decoupling.halves.pct),
                level: t(`decoupling.levels.${decoupling.halves.level}`).toLowerCase(),
              })}
            </p>
          )}
          {weather?.wbgt_plausible && weather.heat_penalty_session_pct != null && weather.heat_penalty_session_pct >= 0.5 && (
            <p>{t('session.verdict_heat', { wbgt: fmt1(weather.wbgt_c), pct: fmt1(weather.heat_penalty_session_pct) })}</p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('session.zones_title')}>
          <ZonesBlock zones={zones} t={t} />
        </Card>

        <Card title={t('session.decoupling_title')}>
          <DecouplingRow label={t('session.decoupling_halves')} d={decoupling.halves} t={t} />
          <DecouplingRow label={t('session.decoupling_durability')} d={decoupling.durability} t={t} />
        </Card>

        <Card title={t('session.efficiency_title')}>
          <div className="grid grid-cols-2 gap-4">
            <Kpi label={t('session.ef_whole')} value={efficiency.whole != null ? `${efficiency.whole.toFixed(2)} m/lat` : '—'}
              hint={similar?.median_ef ? `${t('session.median_similar')} ${similar.median_ef.toFixed(2)}` : null} />
            <Kpi label={t('session.ef_aerobic')} value={efficiency.aerobic != null ? `${efficiency.aerobic.toFixed(2)} m/lat` : '—'}
              hint={efficiency.aerobic == null ? t('session.ef_aerobic_na') : t('session.ef_aerobic_hint')} />
          </div>
        </Card>

        <Card title={t('session.weather_title')}>
          <WeatherBlock weather={weather} t={t} />
        </Card>
      </div>

      <Card title={t('session.splits_title')}>
        {splits?.length
          ? <ActivitySplits splits={splits} hrParams={hrParams} bestEfforts={activity.best_efforts}
              similarActivities={activity.similar_activities} splitsMetric={activity.splits_metric} />
          : <Empty>{t('session.no_splits')}</Empty>}
      </Card>

      {!isRace(activity) && (
        <Card title={t('session.similar_title')}>
          <SimilarBlock similar={similar} onOpenActivity={onOpenActivity} t={t} locale={locale} />
        </Card>
      )}
    </div>
  );
}
