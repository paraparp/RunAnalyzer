import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftIcon, ChatBubbleLeftRightIcon, MagnifyingGlassIcon, ArrowTrendingUpIcon,
  ArrowTrendingDownIcon, EqualsIcon, QuestionMarkCircleIcon, BoltIcon, HeartIcon,
  ArrowsUpDownIcon, MapIcon, PencilSquareIcon,
} from '@heroicons/react/24/outline';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import {
  compareRows, compareVerdict, formChange, sessionMatch, deltaTone, splitSeries, kmWinner, KM_METRICS,
  compareCandidates, compareToText,
} from '../lib/sessionCompare';
import { formatPaceFromSecPerKm } from '../lib/timeFormat';
import { AXIS_TICK } from '../lib/palette';

// A = la sesión desde la que se llega (teal), B = la elegida (naranja). Los dos
// colores se repiten en todo para que "cuál es cuál" no haya que leerlo.
const COLOR_A = 'rgb(var(--accent))';
const COLOR_B = 'rgb(var(--accent-2))';

const OUTCOME = {
  better: { Icon: ArrowTrendingUpIcon, box: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-400/10 dark:border-emerald-300/25', icon: 'bg-emerald-500' },
  worse: { Icon: ArrowTrendingDownIcon, box: 'bg-amber-50 border-amber-200 dark:bg-amber-400/10 dark:border-amber-300/25', icon: 'bg-amber-500' },
  same: { Icon: EqualsIcon, box: 'bg-slate-50 border-slate-200 dark:bg-white/[0.04] dark:border-white/10', icon: 'bg-slate-500' },
  unknown: { Icon: QuestionMarkCircleIcon, box: 'bg-slate-50 border-slate-200 dark:bg-white/[0.04] dark:border-white/10', icon: 'bg-slate-400' },
};
const FACT_ICON = {
  faster: BoltIcon, slower: BoltIcon, same_pace: BoltIcon,
  lower_hr: HeartIcon, higher_hr: HeartIcon, same_hr: HeartIcon,
  more_elev: ArrowsUpDownIcon, less_elev: ArrowsUpDownIcon,
  longer: MapIcon, shorter: MapIcon,
};
const FACT_TONE = { faster: 'good', lower_hr: 'good', slower: 'bad', higher_hr: 'bad' };
const BADGE = {
  good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300',
  bad: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-white/60',
};
// Coincidencia: verde si son de verdad comparables, ámbar si a medias, gris si no.
const MATCH_TONE = (pct) => (pct >= 75
  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300'
  : pct >= 50
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300'
    : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-white/50');

// Celda de la tabla: el valor mejor en verde y el peor en ámbar (con fondo, no
// solo texto, para que se vea de un golpe). Neutro si no hay "mejor" o empate.
const CELL = {
  good: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-400/10',
  bad: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-400/10',
  neutral: 'text-slate-950 dark:text-white',
};
// Cifras de la tabla, por orden de importancia. Pulso y eficiencia primero: son
// las que dicen si el cuerpo responde mejor, que es lo que interesa comparar.
const BAR_KEYS = ['avg_hr', 'pace', 'gap', 'decoupling', 'distance', 'elevation'];
// Gráfico km a km: pulso por defecto, luego eficiencia; el ritmo queda tercero.
const CHART_METRICS = ['hr', 'eff', 'pace'];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Comparativa de dos sesiones (/compare/:id?with=otroId), compacta y de un
 * vistazo: veredicto en una línea, cifras como pares de barras y el gráfico
 * km a km centrado en pulso y eficiencia.
 */
export default function SessionCompare({ aId, activities, hrParams, onBack, onOpenActivity, onAskCoach }) {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const bId = params.get('with');
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [metric, setMetric] = useState('hr');

  const byId = useMemo(() => new Map(activities.map((x) => [String(x.id), x])), [activities]);
  const a = byId.get(String(aId)) ?? null;
  const b = bId ? byId.get(String(bId)) ?? null : null;

  const candidates = useMemo(() => compareCandidates(a, activities).map((c) => c.activity), [a, activities]);
  const searchHits = useMemo(() => {
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return activities
      .filter((x) => x.id !== a?.id && x.distance > 0)
      .filter((x) => {
        const hay = norm(`${x.name} ${String(x.start_date_local || x.start_date).slice(0, 10)}`);
        return tokens.every((tok) => hay.includes(tok));
      })
      .sort((x, y) => String(y.start_date).localeCompare(String(x.start_date)))
      .slice(0, 8);
  }, [query, activities, a]);

  const rows = useMemo(() => (a && b ? compareRows(a, b) : []), [a, b]);
  const match = useMemo(() => (a && b ? sessionMatch(a, b) : null), [a, b]);
  // "¿Estoy mejor o peor?" se responde en el tiempo: la sesión ANTERIOR es la
  // base y la RECIENTE la que se juzga, sea A o B. La tabla sigue en A | B.
  const [older, newer] = useMemo(() => {
    if (!a || !b) return [null, null];
    return Date.parse(a.start_date) <= Date.parse(b.start_date) ? [a, b] : [b, a];
  }, [a, b]);
  const form = useMemo(() => (older ? formChange(older, newer, { hrrest: hrParams?.hrrest }) : null), [older, newer, hrParams?.hrrest]);
  const verdict = useMemo(() => (older ? compareVerdict(compareRows(older, newer), form) : null), [older, newer, form]);
  const series = useMemo(() => (a && b ? splitSeries(a, b) : []), [a, b]);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: '2-digit' }), [i18n.language]);
  const when = (x) => dateFmt.format(new Date(x.start_date_local || x.start_date));
  const pick = (id) => { setParams({ with: String(id) }, { replace: true }); setQuery(''); setPicking(false); };

  if (!a) {
    return (
      <div className="card rounded-md p-4">
        <p className="text-sm text-slate-500 dark:text-white/55 mb-2">{t('session.not_found')}</p>
        <button type="button" onClick={onBack} className="text-sm font-bold text-accent hover:underline">{t('session.back')}</button>
      </div>
    );
  }

  const label = (key) => t(`compare.rows.${key}`);
  const ask = () => onAskCoach?.({
    blocks: { compare: compareToText(a, b, rows, Object.fromEntries(rows.map((r) => [r.key, label(r.key)]))) },
    ask: t('compare.coach_ask'),
  });

  // ── Piezas ───────────────────────────────────────────────────────────────
  const tag = (letter, color) => (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white" style={{ background: color }}>
      {letter}
    </span>
  );

  // Una línea por sesión: letra, nombre (abre la ficha), fecha y km.
  const sessionLine = (x, letter, color) => (
    <div className="flex min-w-0 items-center gap-2">
      {tag(letter, color)}
      <button type="button" onClick={() => onOpenActivity?.(x.id)} className="min-w-0 truncate text-sm font-semibold text-slate-950 dark:text-white hover:underline">
        {x.name}
      </button>
      <span className="shrink-0 text-xs text-slate-500 dark:text-white/50 tabular-nums">{when(x)} · {(x.distance / 1000).toFixed(1)} km</span>
    </div>
  );

  const picker = (
    <div className="card rounded-md p-3 space-y-2">
      <label className="flex items-center gap-2 h-9 px-2.5 rounded-sm border border-slate-200 dark:border-white/15">
        <MagnifyingGlassIcon className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('compare.search')}
          aria-label={t('compare.search')}
          className="flex-1 min-w-0 border-0 bg-transparent dark:bg-transparent p-0 text-sm focus:ring-0"
        />
      </label>
      {(() => {
        const list = query.trim() ? searchHits : candidates;
        if (!list.length) return <p className="text-xs text-slate-500 dark:text-white/55">{query.trim() ? t('palette.empty') : t('compare.no_candidates')}</p>;
        return (
          <>
            {!query.trim() && <p className="text-xs text-slate-500 dark:text-white/50">{t('compare.similar_hint')}</p>}
            <ul className="grid gap-1 sm:grid-cols-2 max-h-72 overflow-y-auto pr-1">
              {list.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => pick(x.id)}
                    aria-pressed={String(x.id) === String(bId)}
                    className={`w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05] ${String(x.id) === String(bId) ? 'bg-accent2/10' : ''}`}
                  >
                    {(() => {
                      const m = sessionMatch(a, x);
                      return m && (
                        <span title={t('compare.match.title')} className={`shrink-0 w-10 text-center rounded-sm text-[11px] font-bold tabular-nums ${MATCH_TONE(m.pct)}`}>
                          {m.pct}%
                        </span>
                      );
                    })()}
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-900 dark:text-white/90">{x.name}</span>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-white/50 tabular-nums">{(x.distance / 1000).toFixed(1)} km · {when(x)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        );
      })()}
    </div>
  );

  const header = (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label={t('session.back')} className="p-1 -ml-1 rounded-sm text-slate-500 hover:text-slate-950 dark:text-white/60 dark:hover:text-white">
        <ArrowLeftIcon className="w-5 h-5" />
      </button>
      <h2 className="h-display text-lg sm:text-xl">{t('compare.title')}</h2>
    </div>
  );

  // ── Sin B: elegir con qué comparar ─────────────────────────────────────────
  if (!b) {
    return (
      <div className="space-y-3">
        {header}
        <div className="card rounded-md px-3 py-2.5">{sessionLine(a, 'A', COLOR_A)}</div>
        <p className="text-sm font-semibold text-slate-800 dark:text-white/85">{t('compare.pick')}</p>
        {picker}
      </div>
    );
  }

  const o = OUTCOME[verdict.outcome];
  const barRows = BAR_KEYS.map((k) => rows.find((r) => r.key === k)).filter((r) => r && (r.a != null || r.b != null));

  // Km a km para la métrica elegida. Si la elegida no tiene datos en ninguna
  // de las dos (p. ej. sin pulsómetro), se cae a la siguiente que sí.
  const has = (m) => series.some((p) => p[KM_METRICS[m].a] != null) && series.some((p) => p[KM_METRICS[m].b] != null);
  const available = CHART_METRICS.filter(has);
  const active = available.includes(metric) ? metric : available[0];
  const km = active ? series.filter((p) => p[KM_METRICS[active].a] != null && p[KM_METRICS[active].b] != null) : [];
  const winsB = km.filter((p) => kmWinner(p, active) === 'B').length;
  const winsA = km.filter((p) => kmWinner(p, active) === 'A').length;
  const fmtVal = (m, v) => (v == null ? '—' : m === 'pace' ? formatPaceFromSecPerKm(v) : m === 'eff' ? v.toFixed(2) : String(Math.round(v)));
  const unit = { hr: 'ppm', eff: 'm/lat', pace: '/km' };

  return (
    <div className="space-y-3">
      {header}

      {/* A y B en dos líneas */}
      <div className="card rounded-md px-3 py-2.5 space-y-1.5">
        {sessionLine(a, 'A', COLOR_A)}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">{sessionLine(b, 'B', COLOR_B)}</div>
          <button type="button" onClick={() => setPicking((p) => !p)} className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-950 dark:text-white/55 dark:hover:text-white">
            <PencilSquareIcon className="w-3.5 h-3.5" /> {t('compare.change')}
          </button>
        </div>
      </div>
      {picking && picker}

      {/* Veredicto */}
      <section className={`rounded-md border px-3 py-3 ${o.box}`}>
        <div className="flex items-center gap-3">
          {form ? (
            // La cifra de forma, grande: es la respuesta a "¿estoy mejor o peor?".
            <div className="shrink-0 text-center">
              <p className={`text-2xl sm:text-3xl font-black tabular-nums leading-none ${verdict.outcome === 'better' ? 'text-emerald-600 dark:text-emerald-400' : verdict.outcome === 'worse' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-white/80'}`}>
                {form.pct > 0 ? '+' : form.pct < 0 ? '−' : ''}{Math.abs(form.pct)}%
              </p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-white/50">{t('compare.form.label')}</p>
            </div>
          ) : (
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${o.icon}`}>
              <o.Icon className="w-5 h-5" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-black tracking-tight leading-tight text-slate-950 dark:text-white">
              {form && verdict.outcome !== 'unknown'
                ? t(`compare.form.trend_${verdict.outcome}`, { pct: Math.abs(form.pct), date: when(older) })
                : t(`compare.verdict.${verdict.outcome}`)}
            </h3>
            <p className="text-xs sm:text-sm text-slate-700 dark:text-white/75">
              {form
                ? t(form.netHr ? 'compare.form.how_rest' : 'compare.form.how_plain', {
                  speed: t(form.useGap ? 'compare.form.speed_gap' : 'compare.form.speed_raw'),
                  rest: Math.round(hrParams?.hrrest ?? 0),
                })
                : verdict.basis
                  ? t(`compare.verdict.why_${verdict.basis}_${verdict.outcome}`)
                  : t('compare.verdict.why_unknown')}
            </p>
            {form && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
                <span className="font-semibold">{t(`compare.form.confidence_${form.confidence}`)}</span>
                {form.reasons.length > 0 && <> · {form.reasons.map((x) => t(`compare.form.reason_${x}`)).join(' · ')}</>}
              </p>
            )}
          </div>
        </div>
        {(verdict.facts.length > 0 || match) && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {match && (
              <li
                title={t('compare.match.detail', match.parts)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${MATCH_TONE(match.pct)}`}
              >
                {t('compare.match.chip', { pct: match.pct })}
              </li>
            )}
            {verdict.facts.map((f) => {
              const Icon = FACT_ICON[f.key];
              return (
                <li key={f.key} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[FACT_TONE[f.key] ?? 'neutral']}`}>
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  {t(`compare.facts.${f.key}`, f.params)}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2 items-start">
        {/* Gráfico km a km: pulso / eficiencia / ritmo */}
        <section className="card rounded-md p-3 lg:order-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="text-sm font-bold text-slate-950 dark:text-white">{t('compare.splits_title')}</h3>
            {km.length > 0 && (
              <p className="flex-1 min-w-[10rem] text-xs text-slate-600 dark:text-white/65">
                {t(`compare.km_summary_${active}`, { b: winsB, a: winsA, n: km.length })}
              </p>
            )}
            {available.length > 1 && (
              <div role="tablist" aria-label={t('compare.splits_title')} className="inline-flex rounded-sm bg-slate-100 dark:bg-white/[0.06] p-0.5">
                {available.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={active === m}
                    onClick={() => setMetric(m)}
                    className={`px-2.5 py-1 rounded-sm text-xs font-semibold transition-colors ${active === m
                      ? 'bg-white text-slate-950 shadow-sm dark:bg-white/15 dark:text-white'
                      : 'text-slate-500 hover:text-slate-950 dark:text-white/55 dark:hover:text-white'}`}
                  >
                    {t(`compare.metric_${m}`)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {km.length ? (
            <>
              <div className="mt-2 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--c-hairline)" vertical={false} />
                    <XAxis dataKey="km" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    {/* Arriba = mejor en las tres: pulso y ritmo van invertidos. */}
                    <YAxis
                      reversed={KM_METRICS[active].lowerIsBetter}
                      domain={active === 'eff' ? ['dataMin - 0.05', 'dataMax + 0.05'] : ['dataMin - 4', 'dataMax + 4']}
                      tick={AXIS_TICK} tickLine={false} axisLine={false} width={44}
                      tickFormatter={(v) => fmtVal(active, v)}
                    />
                    <RechartsTooltip
                      contentStyle={{ background: 'var(--c-paper)', border: '1px solid var(--c-hairline)', fontSize: 12 }}
                      labelFormatter={(k) => `km ${k}`}
                      formatter={(v, name) => [`${fmtVal(active, v)} ${unit[active]}`, name]}
                    />
                    <Line dataKey={KM_METRICS[active].a} name="A" stroke={COLOR_A} strokeWidth={2.5} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
                    <Line dataKey={KM_METRICS[active].b} name="B" stroke={COLOR_B} strokeWidth={2.5} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Quién ganó cada km: una celda por km, del color del ganador. */}
              <ol className="mt-2 flex gap-0.5" aria-label={t('compare.km_strip')}>
                {km.map((p) => {
                  const w = kmWinner(p, active);
                  return (
                    <li
                      key={p.km}
                      title={`km ${p.km} · A ${fmtVal(active, p[KM_METRICS[active].a])} · B ${fmtVal(active, p[KM_METRICS[active].b])} ${unit[active]}`}
                      className={`flex-1 min-w-0 h-5 rounded-[2px] flex items-center justify-center text-[10px] font-black text-white ${w ? '' : 'bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-white/40'}`}
                      style={w ? { background: w === 'B' ? COLOR_B : COLOR_A } : undefined}
                    >
                      {km.length <= 25 ? (w ?? '=') : ''}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{t(`compare.chart_hint_${active}`)}</p>
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-500 dark:text-white/55">{t('compare.no_splits')}</p>
          )}
        </section>

        {/* Cifra a cifra: una fila por métrica, A | B | diferencia */}
        <section className="card rounded-md p-3 lg:order-1">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('compare.numbers_title')}</caption>
            <thead>
              <tr className="text-label font-bold uppercase text-slate-500 dark:text-white/45">
                <th scope="col" className="text-left font-bold pb-1.5">{t('compare.numbers_title')}</th>
                <th scope="col" className="text-right font-bold pb-1.5 px-2"><span className="inline-flex justify-end">{tag('A', COLOR_A)}</span></th>
                <th scope="col" className="text-right font-bold pb-1.5 px-2"><span className="inline-flex justify-end">{tag('B', COLOR_B)}</span></th>
                <th scope="col" className="pb-1.5"><span className="sr-only">{t('compare.delta')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/5 dark:divide-white/5">
              {barRows.map((r) => {
                const tone = deltaTone(r);
                const pct = Math.abs(r.deltaPct ?? 0);
                const isPace = r.key === 'pace' || r.key === 'gap';
                const badge = r.delta == null ? null
                  : r.key === 'decoupling' ? (tone === 'neutral' && Math.abs(r.delta) < 0.5 ? t('compare.same') : `${r.delta > 0 ? '+' : '−'}${Math.abs(r.delta).toFixed(1)} pts`)
                  : !r.better ? (pct < 0.5 ? null : `${r.delta > 0 ? '+' : '−'}${pct}%`)
                    : tone === 'neutral' ? t('compare.same')
                      : isPace ? t(r.delta > 0 ? 'compare.faster' : 'compare.slower', { pct })
                        : `${r.delta > 0 ? '+' : '−'}${pct}%`;
                return (
                  <tr key={r.key}>
                    <th scope="row" className="text-left py-1.5 pr-2 font-medium text-slate-700 dark:text-white/80">
                      {label(r.key)}{r.unit ? <span className="text-xs font-normal text-slate-400 dark:text-white/40"> {r.unit}</span> : null}
                    </th>
                    <td className={`text-right py-1.5 px-2 tabular-nums font-semibold ${CELL[tone === 'good' ? 'bad' : tone === 'bad' ? 'good' : 'neutral']}`}>{r.aLabel}</td>
                    <td className={`text-right py-1.5 px-2 tabular-nums font-semibold ${CELL[tone]}`}>{r.bLabel}</td>
                    <td className="text-right py-1.5 pl-1 w-px whitespace-nowrap">
                      {badge && <span className={`rounded-full px-2 py-px text-[11px] font-bold ${BADGE[tone]}`}>{badge}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      {onAskCoach && (
        <button type="button" onClick={ask} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
          <ChatBubbleLeftRightIcon className="w-4 h-4" /> {t('compare.coach')}
        </button>
      )}
    </div>
  );
}
