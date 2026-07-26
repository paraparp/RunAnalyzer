import React from 'react';
import { HeartIcon } from '@heroicons/react/24/solid';

// Tarjeta compacta de zonas de FC para el dashboard. Usa el MISMO sistema que
// el coach IA (zonas derivadas de tus umbrales LT1/LT2, no Karvonen genérico):
// un solo criterio en toda la app evita topes contradictorios. Los datos vienen
// del objeto `sci` que ya calcula athleteContext (FCmax, FC reposo, LT1, LT2 y
// tu FC fácil observada), así que la tarjeta y la prescripción nunca discrepan.
//
// Zonas:
//   Z1 Fácil    — por debajo de LT1 · aquí va el ~80% del volumen
//   Z2 Umbral—   — entre LT1 y LT2 · tempo suave / progresión (zona "gris")
//   Z3 Calidad   — desde LT2 · tempo fuerte, series, intervalos

const ZONES = [
  {
    key: 'z1',
    name: 'Z1 · Fácil / Base',
    role: 'El 80% de tu volumen. Rodajes cómodos, hablando sin ahogo.',
    bar: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    tint: 'bg-emerald-50/70 dark:bg-emerald-950/20',
  },
  {
    key: 'z2',
    name: 'Z2 · Umbral bajo (gris)',
    role: 'Solo tempo suave o progresión. Ni fácil ni calidad: úsala con criterio.',
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    tint: 'bg-amber-50/70 dark:bg-amber-950/20',
  },
  {
    key: 'z3',
    name: 'Z3 · Umbral+ / Calidad',
    role: 'Tempo fuerte, series e intervalos. El 20% duro del 80/20.',
    bar: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
    tint: 'bg-rose-50/70 dark:bg-rose-950/20',
  },
];

const HRZonesCard = ({ sci }) => {
  const fcmax = sci?.fcmax;
  const fcRest = sci?.fcRest;
  const lt1 = sci?.lt?.lt1Hr;
  const lt2 = sci?.lt?.lt2Hr ?? sci?.lthr;
  if (!fcmax || !lt1 || !lt2 || lt1 >= lt2) return null;

  const lt1Pace = sci?.lt?.lt1Pace;
  const lt2Pace = sci?.lt?.lt2Pace;
  const easyHr = sci?.easyHr;
  const isEstimate = sci?.lt?.lthrIsEstimate;

  // Rangos de cada zona en ppm (coherentes con el prompt del coach).
  const ranges = {
    z1: { lo: fcRest || null, hi: lt1 - 1, ppm: `< ${lt1}`, pace: lt1Pace ? `≥ ${lt1Pace}/km` : null },
    z2: { lo: lt1, hi: lt2 - 1, ppm: `${lt1}–${lt2 - 1}`, pace: lt1Pace && lt2Pace ? `${lt2Pace}–${lt1Pace}/km` : null },
    z3: { lo: lt2, hi: fcmax, ppm: `≥ ${lt2}`, pace: lt2Pace ? `≤ ${lt2Pace}/km` : null },
  };

  return (
    <section>
      <div className="flex items-center gap-2.5 mb-3 px-0.5">
        <span className="w-2 h-2 rounded-[3px] shrink-0 bg-rose-500" />
        <span className="font-mono text-[10px] font-bold text-slate-300 dark:text-slate-600 tabular-nums shrink-0">FC</span>
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-slate-200 shrink-0">
          Zonas de Entrenamiento
        </span>
        <span className="flex-1 h-px bg-slate-200/80 dark:bg-slate-800" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
          Según tus umbrales
        </span>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-5">
        {/* Anclajes fisiológicos */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[10px] font-mono text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <HeartIcon className="w-3 h-3 text-rose-400" />
            <span className="font-bold uppercase tracking-wider text-slate-400">FCmax</span> {fcmax} ppm
          </span>
          {fcRest && <span><span className="font-bold uppercase tracking-wider text-slate-400">Reposo</span> {fcRest} ppm</span>}
          <span className="text-sky-600 dark:text-sky-400"><span className="font-bold uppercase tracking-wider mr-0.5">LT1</span> {lt1} ppm</span>
          <span className="text-rose-500 dark:text-rose-400"><span className="font-bold uppercase tracking-wider mr-0.5">LT2</span> {lt2} ppm</span>
        </div>

        {/* Zonas */}
        <div className="space-y-1.5">
          {ZONES.map(z => {
            const r = ranges[z.key];
            return (
              <div key={z.key} className={`flex items-stretch gap-3 rounded-lg ${z.tint} p-2.5`}>
                <span className={`w-1 rounded-full shrink-0 ${z.bar}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className={`text-[11px] font-black ${z.text}`}>{z.name}</span>
                    <span className="font-mono text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
                      {r.ppm} <span className="text-[9px] font-medium text-slate-400">ppm</span>
                      {r.pace && <span className="ml-2 text-[10px] font-medium text-slate-400">{r.pace}</span>}
                    </span>
                  </div>
                  <p className="text-[10px] leading-snug text-slate-500 dark:text-slate-400 mt-0.5">{z.role}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Banda fáctica: la FC fácil observada manda sobre el techo teórico */}
        {easyHr != null && (
          <p className="mt-3 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
            <span className="font-bold text-emerald-600 dark:text-emerald-400">Tu rodaje fácil real</span> promedia{' '}
            <span className="font-mono font-bold">{easyHr} ppm</span>
            {easyHr >= lt1
              ? ` — roza o supera tu LT1 teórico, así que tu banda fáctica de Z1 es ≈ ${easyHr - 4}–${easyHr + 6} ppm. No frenes por debajo: ya es fácil.`
              : ` — dentro de tu Z1, coherente con el techo LT1 (${lt1} ppm).`}
          </p>
        )}

        {isEstimate && (
          <p className="mt-2 text-[9px] leading-snug text-amber-600 dark:text-amber-400">
            ⚠ LT2 estimado por fórmula (sin esfuerzo umbral de campo detectado): límites de zona aproximados.
          </p>
        )}
      </div>
    </section>
  );
};

export default HRZonesCard;
