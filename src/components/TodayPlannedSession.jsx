// Sesión PLANIFICADA de hoy en la portada (lib/todaySession): la del calendario de
// Garmin o el día del plan del Entrenador IA. La propuesta automática sigue
// pintándose en TodayView; esto sustituye a esa tarjeta cuando hay plan.

// Color por intensidad (1-5) del bloque, de suave a máximo.
const INTENSITY_CLS = {
  1: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200',
  2: 'bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100',
  3: 'bg-blue-500 text-white',
  4: 'bg-orange-500 text-white',
  5: 'bg-rose-600 text-white',
};

const SOURCE_LABEL = { garmin: 'Garmin', ai_plan: 'Plan del Entrenador IA' };

function Card({ children }) {
  return (
    <div className="lg:col-span-7 flex flex-col gap-4 p-5 sm:p-6 rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {children}
    </div>
  );
}

function Header({ session, day, action }) {
  const title = session.rest ? 'Hoy toca descanso' : session.isRace ? 'Hoy compites' : 'Sesión planificada para hoy';
  return (
    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center">
          <span className="material-symbols-outlined text-[20px]">{session.rest ? 'bedtime' : session.isRace ? 'flag' : 'event_available'}</span>
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          <span className="block text-xs text-slate-400">{day} • {SOURCE_LABEL[session.source]}</span>
        </div>
      </div>
      {action}
    </div>
  );
}

function Conflict({ session }) {
  if (!session.conflict) return null;
  return (
    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200">
      <span className="font-bold">Tu estado pide descargar</span> (readiness baja o TSB en sobrecarga) y
      {session.isRace ? ' hoy tienes una carrera' : ' la sesión de hoy es de intensidad alta'}.
      {session.isRace ? ' Sal más conservador de lo previsto.' : ' Valora cambiarla por un rodaje regenerativo y moverla a otro día.'}
    </div>
  );
}

export default function TodayPlannedSession({ session, day, action }) {
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
        <Conflict session={session} />
      </Card>
    );
  }

  // Plan del Entrenador IA
  return (
    <Card>
      <Header session={session} day={day} action={action} />
      {session.rest ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {session.summary || 'Tu plan no tiene sesión para hoy. Descansar también es entrenar: es cuando se asimila la carga.'}
        </p>
      ) : (
        <>
          <div>
            <p className="text-lg font-black text-slate-900 dark:text-slate-100">{session.type}</p>
            {session.summary && <p className="text-xs text-slate-500 dark:text-slate-400">{session.summary}</p>}
          </div>

          {(session.dist || session.time || session.totalMin > 0) && (
            <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-center border border-slate-100 dark:border-slate-800">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Distancia</span>
                <span className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">{session.dist ?? '—'}</span>
              </div>
              <div className="flex flex-col border-l border-slate-200 dark:border-slate-700">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Duración</span>
                <span className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">
                  {session.time ?? (session.totalMin > 0 ? `${session.totalMin} min` : '—')}
                </span>
              </div>
            </div>
          )}

          {session.blocks.length > 0 && session.totalMin > 0 && (
            <div className="flex flex-col gap-2">
              {/* Anchos = proporción REAL de cada bloque (repeticiones incluidas) */}
              <div className="h-10 w-full rounded-xl overflow-hidden flex shadow-inner border border-slate-200/60 dark:border-slate-700">
                {session.blocks.map((b, i) => b.totalMin > 0 && (
                  <div
                    key={i}
                    title={`${b.phase} · ${b.totalMin} min`}
                    className={`h-full flex items-center justify-center px-1 text-[9px] font-bold uppercase truncate ${INTENSITY_CLS[b.intensity] ?? INTENSITY_CLS[2]}`}
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
                      {b.recovery && <span className="font-normal text-slate-400"> · rec. {b.recovery}</span>}
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
            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">{session.hrvGuidance}</p>
          )}
        </>
      )}
      <Conflict session={session} />
    </Card>
  );
}
