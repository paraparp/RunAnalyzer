// Sesión PLANIFICADA de hoy en la portada (lib/todaySession): la del calendario de
// Garmin o el día del plan del Entrenador IA. La propuesta automática sigue
// pintándose en TodayView; esto sustituye a esa tarjeta cuando hay plan.
//
// Plan adaptativo (lib/adaptivePlan): si la sesión es dura y el estado pide
// descargar, se enseña por defecto la versión regenerativa (`adapted`), con
// opción de volver a la original y de mandar la adaptada al reloj.
import { workoutBlocks } from '../lib/todaySession';
import { isRestWorkout } from '../lib/planActuals';
import WorkoutCard from './WorkoutCard';

// Color por intensidad (1-5) del bloque, de suave a máximo.
const INTENSITY_CLS = {
  1: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200',
  2: 'bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100',
  3: 'bg-blue-500 text-white',
  4: 'bg-orange-500 text-white',
  5: 'bg-rose-600 text-white',
};

const SOURCE_LABEL = { garmin: 'Garmin', ai_plan: 'Plan del Entrenador IA', training_plan: 'Plan de entrenamiento' };

const sourceLabel = (session) => (
  session.source === 'training_plan' && session.planName ? `Plan «${session.planName}»` : SOURCE_LABEL[session.source]
);

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** La semana del plan (lunes-domingo) con hoy marcado: deja ver de un vistazo que hoy es hueco. */
function WeekStrip({ week, todayISO }) {
  if (!Array.isArray(week) || !week.length) return null;
  return (
    <div className="grid grid-cols-7 gap-1">
      {week.map((d, i) => {
        const w = d.workouts.find((x) => x.status !== 'skipped') ?? d.workouts[0];
        const isToday = d.date === todayISO;
        const rest = !w || w.status === 'skipped' || isRestWorkout(w);
        const tone = !w
          ? 'bg-slate-50 text-slate-400 dark:bg-slate-800/40 dark:text-slate-500'
          : w.status === 'done'
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            : rest
              ? 'bg-slate-50 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400'
              : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300';
        return (
          <div
            key={d.date}
            title={w ? `${w.type}${w.summary ? ` — ${w.summary}` : ''}` : 'Descanso'}
            className={`flex flex-col items-center gap-0.5 px-1 py-1.5 rounded text-center ${tone} ${isToday ? 'ring-2 ring-blue-500' : ''}`}
          >
            <span className="text-label font-bold uppercase">{WEEKDAYS[i]}</span>
            <span className="text-[10px] font-semibold leading-tight truncate w-full">
              {w ? (w.status === 'done' ? '✓' : rest ? '—' : (Number.isFinite(w.distance_km) ? `${w.distance_km}k` : w.type)) : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CoachNote({ note }) {
  if (!note) return null;
  return (
    <div className="p-3 rounded bg-amber-50 border border-amber-200 text-xs text-amber-900 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200">
      <span className="font-bold">Nota del coach: </span>{note}
    </div>
  );
}

function Card({ children }) {
  return (
    <div className="lg:col-span-7 flex flex-col gap-4 p-5 sm:p-6 rounded border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {children}
    </div>
  );
}

function Header({ session, day, action }) {
  const title = session.skipped
    ? 'Sesión de hoy saltada'
    : session.rest ? 'Hoy toca descanso'
      : session.isRace ? 'Hoy compites'
        : session.done ? 'Sesión de hoy hecha' : 'Sesión planificada para hoy';
  return (
    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center">
          <span className="material-symbols-outlined text-[20px]">{session.rest ? 'bedtime' : session.isRace ? 'flag' : session.done ? 'task_alt' : 'event_available'}</span>
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          <span className="block text-xs text-slate-500">{day} • {sourceLabel(session)}</span>
        </div>
      </div>
      {action}
    </div>
  );
}

function Conflict({ session, adapted }) {
  if (!session.conflict || adapted) return null;
  return (
    <div className="p-3 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200">
      <span className="font-bold">Tu estado pide descargar</span> (readiness baja o TSB en sobrecarga) y
      {session.isRace ? ' hoy tienes una carrera' : ' la sesión de hoy es de intensidad alta'}.
      {session.isRace ? ' Sal más conservador de lo previsto.' : ' Valora cambiarla por un rodaje regenerativo y moverla a otro día.'}
    </div>
  );
}

function PlanBody({ session }) {
  return (
    <>
      {session.rest ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {session.skipped
            ? 'La sesión de hoy está marcada como saltada en tu plan.'
            : session.summary || 'Tu plan no tiene sesión para hoy. Descansar también es entrenar: es cuando se asimila la carga.'}
        </p>
      ) : (
        <>
          <div>
            <p className="text-lg font-black text-slate-900 dark:text-slate-100">{session.type}</p>
            {session.summary && <p className="text-xs text-slate-500 dark:text-slate-400">{session.summary}</p>}
          </div>

          {(session.dist || session.time || session.totalMin > 0) && (
            <div className="grid grid-cols-2 gap-2 p-3 rounded bg-slate-50 dark:bg-slate-800/60 text-center border border-slate-100 dark:border-slate-800">
              <div className="flex flex-col">
                <span className="text-label font-bold uppercase text-slate-500">Distancia</span>
                <span className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">{session.dist ?? '—'}</span>
              </div>
              <div className="flex flex-col border-l border-slate-200 dark:border-slate-700">
                <span className="text-label font-bold uppercase text-slate-500">Duración</span>
                <span className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">
                  {session.time ?? (session.totalMin > 0 ? `${session.totalMin} min` : '—')}
                </span>
              </div>
            </div>
          )}

          {session.blocks.length > 0 && session.totalMin > 0 && (
            <div className="flex flex-col gap-2">
              {/* Anchos = proporción REAL de cada bloque (repeticiones incluidas) */}
              <div className="h-10 w-full rounded overflow-hidden flex shadow-inner border border-slate-200/60 dark:border-slate-700">
                {session.blocks.map((b, i) => b.totalMin > 0 && (
                  <div
                    key={i}
                    title={`${b.phase} · ${b.totalMin} min`}
                    className={`h-full flex items-center justify-center px-1 text-label font-bold uppercase truncate ${INTENSITY_CLS[b.intensity] ?? INTENSITY_CLS[2]}`}
                    style={{ width: `${(b.totalMin / session.totalMin) * 100}%` }}
                  >
                    {b.totalMin / session.totalMin > 0.12 ? b.phase : ''}
                  </div>
                ))}
              </div>
              <ul className="space-y-1.5">
                {session.blocks.map((b, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {b.reps ? `${b.reps} × ${b.duration_min}′ ` : `${b.duration_min}′ `}{b.phase}
                      {b.recovery && <span className="font-normal text-slate-500"> · rec. {b.recovery}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                      {[b.pace, b.hr && `${b.hr} ppm`].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {session.hrvGuidance && (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">{session.hrvGuidance}</p>
          )}
        </>
      )}
    </>
  );
}

function AdaptedBanner({ session, showing, onToggle, onSend, sendState }) {
  const original = session.source === 'garmin' ? session.title : session.type;
  return (
    <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200 flex flex-col gap-2">
      <p>
        <span className="font-bold">{showing ? 'Sesión adaptada a tu estado.' : 'Tu estado pide descargar.'}</span>{' '}
        {showing
          ? <>La readiness o el TSB desaconsejan <span className="font-semibold">{original}</span> hoy: toca regenerativo. La original se puede reprogramar desde el Planificador.</>
          : <>Hay una versión regenerativa de <span className="font-semibold">{original}</span> lista.</>}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onToggle} className="px-2.5 py-1 rounded border border-emerald-300 bg-white font-semibold hover:bg-emerald-100 dark:bg-transparent">
          {showing ? 'Ver la original' : 'Usar la adaptada'}
        </button>
        {showing && onSend && (
          <button
            type="button" onClick={onSend} disabled={sendState === 'sending' || sendState === 'sent'}
            className="px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60"
          >
            {sendState === 'sending' ? 'Enviando…' : sendState === 'sent' ? 'En el reloj ✓' : 'Enviar al reloj'}
          </button>
        )}
        {sendState && sendState.startsWith?.('error:') && <span className="self-center text-rose-600">{sendState.slice(6)}</span>}
      </div>
    </div>
  );
}

/** Día del plan → lo que pinta `PlanBody`. */
function bodyFromPlanDay(day) {
  const { blocks, totalMin } = workoutBlocks(day.structured_workout);
  return {
    rest: false, type: day.type, summary: day.summary,
    dist: day.daily_stats?.dist ?? null, time: day.daily_stats?.time ?? null,
    blocks, totalMin, hrvGuidance: null,
  };
}

export default function TodayPlannedSession({ session, day, todayISO, action, adapted = null, showingAdapted = false, onToggleAdapted, onSendAdapted, sendState }) {
  const banner = adapted && (
    <AdaptedBanner session={session} showing={showingAdapted} onToggle={onToggleAdapted} onSend={onSendAdapted} sendState={sendState} />
  );

  if (showingAdapted && adapted) {
    return (
      <Card>
        <Header session={{ ...session, isRace: false, rest: false }} day={day} action={action} />
        <PlanBody session={bodyFromPlanDay(adapted)} />
        {banner}
      </Card>
    );
  }

  if (session.source === 'garmin') {
    return (
      <Card>
        <Header session={session} day={day} action={action} />
        <div>
          <p className="text-lg font-black text-slate-900 dark:text-slate-100">{session.title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Agendado en tu calendario de Garmin
            {session.extra > 0 ? ` (y ${session.extra} más para hoy)` : ''}. La estructura y los objetivos los tienes en el reloj.
          </p>
        </div>
        <Conflict session={session} adapted={adapted} />
        {banner}
      </Card>
    );
  }

  // Plan de entrenamiento o plan del Entrenador IA
  return (
    <Card>
      <Header session={session} day={day} action={action} />
      {session.source === 'training_plan' && session.workout ? (
        <>
          <div>
            <p className="text-lg font-black text-slate-900 dark:text-slate-100">{session.type}</p>
            {session.summary && <p className="text-xs text-slate-500 dark:text-slate-400">{session.summary}</p>}
            {(session.dist || session.time) && (
              <p className="text-xs font-mono text-slate-500 mt-0.5">{[session.dist, session.time].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          {(session.workout.structured_workout?.length > 0 || session.workout.key_rule) && (
            <WorkoutCard workout={session.workout} showHeader={false} />
          )}
        </>
      ) : (
        <PlanBody session={session} />
      )}
      {session.source === 'training_plan' && <CoachNote note={session.coachNote} />}
      <Conflict session={session} adapted={adapted} />
      {banner}
      {session.source === 'training_plan' && <WeekStrip week={session.week} todayISO={todayISO} />}
    </Card>
  );
}
