import { useState } from 'react';
import { ClipboardDocumentListIcon, PlusIcon } from '@heroicons/react/24/outline';
import cloudStorage from '../lib/cloudStorage';
import { toISODate } from '../lib/planSchedule';
import { BODY_ZONES } from '../lib/wellnessDiary';
import {
  INJURY_EVENT, readInjuries, saveInjury, deleteInjury, injuryLabel, injuryDays, injuryStats, injuryTimeline,
} from '../lib/injuryLog';

// Histórico de lesiones (lib/injuryLog): cuándo empezó y acabó cada una. El diario
// de al lado es el día a día; esto es lo que queda.

const FIELD = 'w-full text-sm bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5';
const LABEL = 'block text-xs font-semibold text-slate-600 dark:text-white/75 mb-1';
const LINK = 'text-xs font-semibold text-slate-600 dark:text-white/75 hover:text-slate-900 dark:hover:text-white';

const blank = (todayISO) => ({ zone: '', side: '', title: '', start_date: todayISO, end_date: '', note: '' });
const toForm = (i) => ({ ...i, zone: i.zone ?? '', side: i.side ?? '', title: i.title ?? '', end_date: i.end_date ?? '', note: i.note ?? '' });

const FILTERS = [
  { id: 'all', label: 'Todas', match: () => true },
  { id: 'active', label: 'Activas', match: (i) => !i.end_date },
  { id: 'ended', label: 'Terminadas', match: (i) => !!i.end_date },
];

const asDate = (iso) => new Date(`${iso}T00:00:00Z`);
const fmtDay = (iso) => asDate(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtTick = (iso, withYear) => asDate(iso).toLocaleDateString('es-ES', { month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function summaryOf(s) {
  return [
    plural(s.total, 'lesión', 'lesiones'),
    s.active ? plural(s.active, 'activa', 'activas') : 'ninguna activa',
    `${plural(s.daysInjured, 'día', 'días')} con alguna lesión`,
    s.repeated && `más repetida: ${s.repeated.label} (${s.repeated.count})`,
  ].filter(Boolean).join(' · ');
}

// Una fila por zona: así una recaída se ve al lado del episodio anterior.
function Timeline({ timeline, titleOf, onPick }) {
  const yearly = timeline.ticks.length > 1 && timeline.ticks[0].iso.slice(5, 7) === timeline.ticks[1].iso.slice(5, 7);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-x-3">
      {timeline.rows.map((row) => (
        <div key={row.label} className="contents">
          <p className="text-xs font-semibold text-slate-700 dark:text-white/75 truncate pt-1 sm:py-1.5" title={row.label}>{row.label}</p>
          <div className="relative h-6 mb-1 sm:mb-0 sm:h-auto border-b border-slate-100 dark:border-white/10">
            {timeline.ticks.map((tick) => (
              <span key={tick.iso} className="absolute inset-y-0 w-px bg-slate-100 dark:bg-white/10" style={{ left: `${tick.left}%` }} />
            ))}
            {row.episodes.map((e) => (
              <button
                key={e.id} type="button" onClick={() => onPick(e.id)} title={titleOf(e.id)} aria-label={`Ver ${titleOf(e.id)}`}
                className={`absolute top-1.5 bottom-1.5 min-w-1.5 rounded-sm transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600 dark:focus-visible:outline-teal-300 ${e.active ? 'bg-rose-500' : 'bg-slate-400 dark:bg-white/45'}`}
                style={{ left: `${e.left}%`, width: `${e.width}%` }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="hidden sm:block" />
      <div className="relative h-5 mt-1 text-[11px] text-slate-500 dark:text-white/55 tabular-nums">
        {timeline.ticks.map((tick) => (
          <span key={tick.iso} className="absolute" style={{ left: `${tick.left}%` }}>{fmtTick(tick.iso, yearly)}</span>
        ))}
        <span className="absolute right-0 font-semibold">hoy</span>
      </div>
    </div>
  );
}

export default function InjuryLog() {
  const todayISO = toISODate(new Date());
  const [injuries, setInjuries] = useState(() => readInjuries(cloudStorage));
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState(null);

  const stats = injuryStats(injuries, todayISO);
  const timeline = injuryTimeline(injuries, todayISO);
  const visible = injuries.filter(FILTERS.find((f) => f.id === filter).match);
  const titleOf = (id) => {
    const i = injuries.find((x) => x.id === id);
    return `${injuryLabel(i)}: ${fmtDay(i.start_date)} – ${i.end_date ? fmtDay(i.end_date) : 'hoy'}`;
  };
  // La barra lleva a su ficha; si el filtro la oculta, se quita el filtro.
  const pick = (id) => {
    setFilter('all');
    setPicked(id);
    requestAnimationFrame(() => document.getElementById(`injury-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const set =(k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const bilateral = BODY_ZONES.find((z) => z.id === form?.zone)?.bilateral;
  const publish = (list) => {
    setInjuries(list);
    window.dispatchEvent(new Event(INJURY_EVENT));
  };
  const open = (next) => { setForm(next); setError(null); setConfirmDelete(null); };

  const save = (e) => {
    e.preventDefault();
    try {
      publish(saveInjury(cloudStorage, form).list);
      setForm(null);
    } catch (err) {
      setError(err.message);
    }
  };
  const endToday = (i) => publish(saveInjury(cloudStorage, { ...i, end_date: todayISO }).list);
  const remove = (id) => {
    publish(deleteInjury(cloudStorage, id));
    setConfirmDelete(null);
  };

  return (
    <div className="bg-white dark:bg-white/[0.03] rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardDocumentListIcon className="w-5 h-5 text-slate-500 dark:text-white/55" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Histórico de lesiones</h3>
        </div>
        {!form && (
          <button type="button" onClick={() => open(blank(todayISO))} className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950 text-sm font-bold hover:bg-slate-800 dark:hover:bg-white/90">
            <PlusIcon className="w-4 h-4" /> Añadir lesión
          </button>
        )}
      </div>

      {form && (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 rounded-xl border border-slate-200 dark:border-white/10 p-4">
          <div className="sm:col-span-2">
            <label htmlFor="injury-title" className={LABEL}>Nombre o diagnóstico</label>
            <input id="injury-title" value={form.title} onChange={set('title')} maxLength={120} placeholder="Tendinopatía glútea" className={FIELD} />
          </div>
          <div>
            <label htmlFor="injury-zone" className={LABEL}>Zona</label>
            <select id="injury-zone" value={form.zone} onChange={set('zone')} className={FIELD}>
              <option value="">Sin zona</option>
              {BODY_ZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="injury-side" className={LABEL}>Lado</label>
            <select id="injury-side" value={form.side} onChange={set('side')} disabled={!bilateral} className={`${FIELD} disabled:opacity-50`}>
              <option value="">Sin indicar</option>
              <option value="L">Izquierdo</option>
              <option value="R">Derecho</option>
            </select>
          </div>
          <div>
            <label htmlFor="injury-start" className={LABEL}>Inicio</label>
            <input id="injury-start" type="date" required value={form.start_date} max={todayISO} onChange={set('start_date')} className={FIELD} />
          </div>
          <div>
            <label htmlFor="injury-end" className={LABEL}>Fin (vacío si sigue activa)</label>
            <input id="injury-end" type="date" value={form.end_date} min={form.start_date} max={todayISO} onChange={set('end_date')} className={FIELD} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="injury-note" className={LABEL}>Notas</label>
            <textarea id="injury-note" value={form.note} onChange={set('note')} rows={2} maxLength={1000} placeholder="Tratamiento, pautas del fisio, evolución…" className={FIELD} />
          </div>
          {error && <p role="alert" className="sm:col-span-2 text-sm font-semibold text-rose-600 dark:text-rose-300">{error}</p>}
          <div className="sm:col-span-2 flex items-center gap-3">
            <button type="submit" className="px-4 py-2 rounded-xl bg-slate-950 text-white dark:bg-white dark:text-slate-950 text-sm font-bold hover:bg-slate-800 dark:hover:bg-white/90">Guardar</button>
            <button type="button" onClick={() => setForm(null)} className={LINK}>Cancelar</button>
          </div>
        </form>
      )}

      {injuries.length === 0 && !form && (
        <p className="text-sm text-slate-500 dark:text-white/55">Aún no hay lesiones registradas. Añade cada una con su fecha de inicio y ciérrala cuando termine. Si recae, regístrala como una nueva para conservar las fechas de la anterior.</p>
      )}

      {injuries.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600 dark:text-white/75 tabular-nums">{summaryOf(stats)}</p>
          <Timeline timeline={timeline} titleOf={titleOf} onPick={pick} />
        </div>
      )}

      {injuries.length > 0 && (
        <div role="group" aria-label="Filtrar lesiones" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
              className={`min-w-8 px-2 py-1 rounded-md text-xs font-semibold border tabular-nums ${filter === f.id ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-950 dark:border-white' : 'bg-white dark:bg-white/[0.03] text-slate-600 dark:text-white/75 border-slate-200 dark:border-white/10 hover:border-slate-400'}`}
            >{f.label} {injuries.filter(f.match).length}</button>
          ))}
        </div>
      )}

      {injuries.length > 0 && visible.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-white/55">{filter === 'active' ? 'Ninguna lesión activa.' : 'Ninguna lesión terminada todavía.'}</p>
      )}

      {visible.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-white/10">
          {visible.map((i) => (
            <li key={i.id} id={`injury-${i.id}`} className={`py-3 px-2 -mx-2 rounded-md flex flex-col sm:flex-row sm:items-start sm:justify-between gap-x-4 gap-y-2 ${picked === i.id ? 'bg-slate-50 dark:bg-white/[0.05]' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {injuryLabel(i)}
                  {!i.end_date && <span className="ml-2 px-1.5 py-0.5 rounded-md text-xs font-bold bg-rose-50 dark:bg-rose-400/10 text-rose-600 dark:text-rose-300">Activa</span>}
                </p>
                <p className="text-xs text-slate-500 dark:text-white/55 tabular-nums mt-0.5">
                  {fmtDay(i.start_date)} – {i.end_date ? fmtDay(i.end_date) : 'hoy'} · {plural(injuryDays(i, todayISO), 'día', 'días')}
                </p>
                {i.note && <p className="text-xs text-slate-600 dark:text-white/75 mt-1 whitespace-pre-line">{i.note}</p>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {confirmDelete === i.id ? (
                  <>
                    <button type="button" onClick={() => remove(i.id)} className="text-xs font-bold text-rose-600 dark:text-rose-300">Confirmar borrado</button>
                    <button type="button" onClick={() => setConfirmDelete(null)} className={LINK}>Cancelar</button>
                  </>
                ) : (
                  <>
                    {!i.end_date && <button type="button" onClick={() => endToday(i)} className={LINK}>Terminar hoy</button>}
                    <button type="button" onClick={() => open(toForm(i))} className={LINK}>Editar</button>
                    <button type="button" onClick={() => setConfirmDelete(i.id)} className={LINK}>Borrar</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
