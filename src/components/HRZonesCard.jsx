import { HeartIcon } from '@heroicons/react/24/solid';
import { karvonenBounds, DEFAULT_REST_HR } from '../lib/hrZones';

// Tarjeta compacta de zonas de FC para el dashboard. Usa el MISMO sistema que
// todo lo demás: Karvonen sobre la reserva de FC (FCmax − FC reposo), que es lo
// que cuenta `zoneMix` en la vista de Zonas y en la portada, y lo que el coach
// recibe en su prompt (`athleteContext`). Antes esta tarjeta derivaba sus
// propias 3 zonas de LT1/LT2: el atleta leía "Z2" aquí y "Z2" en Zonas
// queriendo decir cosas distintas.
//
// LT1 y LT2 no desaparecen — siguen siendo los anclajes FISIOLÓGICOS que fijan
// los RITMOS de referencia; lo que ya no hacen es definir un sistema de zonas
// paralelo.

const ZONES = [
  {
    key: 'z1',
    name: 'Z1 · Recuperación',
    role: '<60% de tu reserva. Trote de descarga, nunca el grueso del volumen.',
    bar: 'bg-slate-400',
    text: 'text-slate-500 dark:text-slate-400',
    tint: 'bg-slate-50/70 dark:bg-slate-800/30',
  },
  {
    key: 'z2',
    name: 'Z2 · Base aeróbica',
    role: '60–70%. Aquí va el grueso del volumen: cómodo, hablando sin ahogo.',
    bar: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400',
    tint: 'bg-sky-50/70 dark:bg-sky-950/20',
  },
  {
    key: 'z3',
    name: 'Z3 · Aeróbico intenso (gris)',
    role: '70–80%. La zona gris: cansa sin dar el estímulo de Z2 ni el de Z4.',
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    tint: 'bg-amber-50/70 dark:bg-amber-950/20',
  },
  {
    key: 'z4',
    name: 'Z4 · Umbral de lactato',
    role: '80–90%. Tempo y series al umbral. Con Z5, el 20% duro del 80/20.',
    bar: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
    tint: 'bg-orange-50/70 dark:bg-orange-950/20',
  },
  {
    key: 'z5',
    name: 'Z5 · VO2max / anaeróbico',
    role: '>90%. Intervalos cortos y sprints. Poco volumen, mucha calidad.',
    bar: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
    tint: 'bg-rose-50/70 dark:bg-rose-950/20',
  },
];

const HRZonesCard = ({ sci }) => {
  const fcmax = sci?.fcmax;
  const fcRest = sci?.fcRest;
  if (!fcmax) return null;

  // Los cortes vienen resueltos en `sci` (athleteContext los calcula una vez para
  // el prompt); el respaldo es la misma función, no otra cuenta.
  const bounds = sci?.zones?.length === 5
    ? sci.zones
    : karvonenBounds({ hrmax: fcmax, hrrest: fcRest || DEFAULT_REST_HR });

  const lt1 = sci?.lt?.lt1Hr;
  const lt2 = sci?.lt?.lt2Hr ?? sci?.lthr;
  const lt1Pace = sci?.lt?.lt1Pace;
  const lt2Pace = sci?.lt?.lt2Pace;
  const easyHr = sci?.easyHr;
  const isEstimate = sci?.lt?.lthrIsEstimate;
  const easyCeil = bounds[1].hi;   // techo de Z2: hasta aquí es volumen fácil

  const ppm = (i) => (i === 0 ? `< ${bounds[1].lo}` : i === 4 ? `≥ ${bounds[4].lo}` : `${bounds[i].lo}–${bounds[i].hi}`);

  // Ritmos: no salen de las zonas (Karvonen es FC pura) sino de los umbrales, que
  // es de donde se prescribe. Solo se anota donde la equivalencia es honesta.
  const fmtPace = (p) => `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')}`;
  const pace = (i) => {
    if (i <= 1) return lt1Pace ? `≥ ${fmtPace(lt1Pace)}/km` : null;
    if (i === 2) return lt1Pace && lt2Pace ? `${fmtPace(lt2Pace)}–${fmtPace(lt1Pace)}/km` : null;
    if (i === 3) return lt2Pace ? `≈ ${fmtPace(lt2Pace)}/km` : null;
    return lt2Pace ? `< ${fmtPace(lt2Pace)}/km` : null;
  };

  // Material de referencia: se pliega por defecto para no competir con el
  // diagnóstico y la prescripción del día. Los umbrales viven solo aquí.
  return (
    <details className="group">
      <summary className="flex items-center gap-2.5 mb-3 px-0.5 cursor-pointer list-none">
        <span className="w-2 h-2 rounded-[3px] shrink-0 bg-rose-500" />
        <span className="font-mono text-[10px] font-bold text-slate-300 dark:text-slate-600 tabular-nums shrink-0">FC</span>
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-slate-200 shrink-0">
          Zonas de Entrenamiento
        </span>
        <span className="font-mono text-[10px] text-slate-400 shrink-0">
          <span className="text-slate-500 dark:text-slate-400">Karvonen</span>
          <span className="mx-1 text-slate-300 dark:text-slate-700">·</span>
          <span>reserva {fcmax - (fcRest || DEFAULT_REST_HR)} ppm</span>
        </span>
        <span className="flex-1 h-px bg-slate-200/80 dark:bg-slate-800" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 shrink-0 group-open:hidden">
          Ver zonas
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 shrink-0 hidden group-open:inline">
          Ocultar
        </span>
      </summary>

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-5">
        {/* Anclajes: FCmax y reposo definen las zonas; LT1/LT2 anclan los ritmos */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[10px] font-mono text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <HeartIcon className="w-3 h-3 text-rose-400" />
            <span className="font-bold uppercase tracking-wider text-slate-400">FCmax</span> {fcmax} ppm
          </span>
          {fcRest && <span><span className="font-bold uppercase tracking-wider text-slate-400">Reposo</span> {fcRest} ppm</span>}
          {lt1 && <span className="text-sky-600 dark:text-sky-400"><span className="font-bold uppercase tracking-wider opacity-70">LT1</span> {lt1} ppm</span>}
          {lt2 && <span className="text-rose-500 dark:text-rose-400"><span className="font-bold uppercase tracking-wider opacity-70">LT2</span> {lt2} ppm</span>}
        </div>

        {/* Zonas */}
        <div className="space-y-1.5">
          {ZONES.map((z, i) => {
            const p = pace(i);
            return (
              <div key={z.key} className={`flex items-stretch gap-3 rounded-lg ${z.tint} p-2.5`}>
                <span className={`w-1 rounded-full shrink-0 ${z.bar}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className={`text-[11px] font-black ${z.text}`}>{z.name}</span>
                    <span className="font-mono text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
                      {ppm(i)} <span className="text-[9px] font-medium text-slate-400">ppm</span>
                      {p && <span className="ml-2 text-[10px] font-medium text-slate-400">{p}</span>}
                    </span>
                  </div>
                  <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400 mt-0.5">{z.role}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Lectura polarizada: es la agrupación con la que se juzga el 80/20 */}
        <p className="mt-3 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
          <span className="font-bold text-slate-600 dark:text-slate-300">80/20</span> se cuenta agrupando:{' '}
          <span className="font-bold text-emerald-600 dark:text-emerald-400">fácil</span> = Z1+Z2 (≤{easyCeil} ppm) ·{' '}
          <span className="font-bold text-amber-600 dark:text-amber-400">gris</span> = Z3 ·{' '}
          <span className="font-bold text-rose-500 dark:text-rose-400">duro</span> = Z4+Z5 (≥{bounds[3].lo} ppm).
        </p>

        {/* Banda fáctica: la FC fácil observada manda sobre el techo teórico */}
        {easyHr != null && (
          <p className="mt-2 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
            <span className="font-bold text-emerald-600 dark:text-emerald-400">Tu rodaje fácil real</span> promedia{' '}
            <span className="font-mono font-bold">{easyHr} ppm</span>
            {easyHr > easyCeil
              ? ` — supera el techo de Z2, así que tu banda fáctica de fácil es ≈ ${easyHr - 4}–${easyHr + 6} ppm. No frenes por debajo: ya es fácil.`
              : ` — dentro de Z2, coherente con el techo de volumen fácil (${easyCeil} ppm).`}
          </p>
        )}

        {isEstimate && (
          <p className="mt-2 text-[9px] leading-snug text-amber-600 dark:text-amber-400">
            ⚠ LT2 estimado por fórmula (sin esfuerzo umbral de campo detectado): los RITMOS de referencia
            son aproximados. Las zonas no dependen de él — salen de FCmax y FC de reposo.
          </p>
        )}
      </div>
    </details>
  );
};

export default HRZonesCard;
