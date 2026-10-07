import { useMemo, useState } from 'react';
import { ArrowPathIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import cloudStorage from '../lib/cloudStorage';
import { AI_PLAN_KEY } from '../lib/todaySession';
import { toISODate } from '../lib/planSchedule';
import { replanWeek, applyReplan, readChoice, readAdaptedSession } from '../lib/adaptivePlan';

// Semana del plan frente a lo corrido de verdad, y la replanificación de lo que
// falta (lib/adaptivePlan). No guarda nada sin que el atleta pulse "Aplicar".

const STATUS = {
  done: { label: 'Hecho', cls: 'bg-emerald-50 text-emerald-700' },
  missed: { label: 'Fallado', cls: 'bg-rose-50 text-rose-700' },
  postponed: { label: 'Aplazado hoy', cls: 'bg-amber-50 text-amber-700' },
  today: { label: 'Hoy', cls: 'bg-blue-50 text-blue-700' },
  upcoming: { label: 'Pendiente', cls: 'bg-slate-100 text-slate-600' },
  rest: { label: 'Descanso', cls: 'bg-slate-50 text-slate-400' },
};
const KIND = { long: 'Tirada larga', hard: 'Calidad', easy: 'Suave', rest: 'Descanso' };

const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });

const readSaved = () => {
  try { return JSON.parse(cloudStorage.getItem(AI_PLAN_KEY) || 'null'); } catch { return null; }
};

// `plan` solo sirve de dependencia: cada plan nuevo (generado o aplicado) se
// relee del almacén, que es donde está `generated_at`.
export default function PlanWeekReview({ plan, activities, onApplied }) {
  const todayISO = toISODate(new Date());
  const saved = useMemo(() => (plan ? readSaved() : null), [plan]);
  const [applied, setApplied] = useState(false);

  const result = useMemo(() => {
    if (!saved?.plan) return null;
    const postponedToday = readChoice(cloudStorage, todayISO) === 'adapted';
    return replanWeek(saved, activities, todayISO, {
      postponedToday,
      todayReplacement: postponedToday ? readAdaptedSession(cloudStorage, todayISO) : null,
    });
  }, [saved, activities, todayISO]);

  if (!result?.review.length) return null;
  const { review, moves, dropped, schedule } = result;
  const hasChanges = moves.length > 0 || dropped.length > 0;

  const apply = () => {
    const next = applyReplan(saved, schedule, todayISO);
    cloudStorage.setItem(AI_PLAN_KEY, JSON.stringify(next));
    setApplied(true);
    onApplied?.(next.plan);
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-black text-slate-900">Semana real frente al plan</h2>
        {saved.replanned_at && <span className="text-xs text-slate-500">Replanificada el {fmtDate(saved.replanned_at)}</span>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {review.map((e) => (
          <div key={`${e.date}-${e.index}`} className="rounded-xl border border-slate-100 p-2.5">
            <p className="text-xs font-bold text-slate-500 capitalize">{fmtDate(e.date)}</p>
            <p className="text-sm font-semibold text-slate-800 truncate" title={e.day.type}>{e.day.type}</p>
            <p className="text-[11px] text-slate-500">{KIND[e.kind]}{e.day.moved_from ? ` · movida del ${e.day.moved_from.toLowerCase()}` : ''}</p>
            <span className={`inline-block mt-1.5 px-1.5 py-0.5 rounded text-[11px] font-bold ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span>
          </div>
        ))}
      </div>

      {applied && (
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <CheckCircleIcon className="w-5 h-5" /> Semana replanificada. La portada ya usa el plan nuevo; si tenías sesiones en Garmin, vuelve a enviarlas.
        </p>
      )}

      {!applied && hasChanges && (
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-2">
          <p className="text-sm font-bold text-slate-800">Propuesta para lo que queda de semana</p>
          <ul className="space-y-1.5 text-sm">
            {moves.map(({ from, to }) => (
              <li key={from.index} className="flex items-start gap-2 text-slate-700">
                <ArrowPathIcon className="w-4 h-4 mt-0.5 text-blue-600 shrink-0" />
                <span>
                  <span className="font-semibold">{from.day.type}</span> ({from.status === 'postponed' ? 'aplazada hoy' : `fallada el ${fmtDate(from.date)}`})
                  {' → '}<span className="font-semibold capitalize">{fmtDate(to.date)}</span>
                  {to.day ? `, en lugar de "${to.day.type}"` : ''}.
                </span>
              </li>
            ))}
            {dropped.map(({ entry, reason }) => (
              <li key={entry.index} className="flex items-start gap-2 text-slate-500">
                <XCircleIcon className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">{entry.day.type}</span> del {fmtDate(entry.date)}:{' '}
                  {reason === 'easy'
                    ? 'no se recupera — el volumen fácil perdido no se compensa amontonando kilómetros.'
                    : 'no cabe sin juntar dos días duros; se descarta esta semana.'}
                </span>
              </li>
            ))}
          </ul>
          {schedule && (
            <button type="button" onClick={apply} className="mt-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
              Aplicar a mi plan
            </button>
          )}
        </div>
      )}
    </div>
  );
}
