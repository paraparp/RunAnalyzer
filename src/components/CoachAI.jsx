// ============================================================================
// Piezas de UI del Coach IA, compartidas por la portada (TodayView) y el pie
// del análisis (AIInsights). El estado vive en `useAIInsights`, que se llama
// UNA vez en la portada: si cada componente lo llamara, se pediría el análisis
// dos veces.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  Cog6ToothIcon,
  ShieldExclamationIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

// ── Markdown en línea (negritas + viñetas), el formato que devuelve el coach ─
export const CoachMD = ({ text, accent = 'text-blue-500', isDark = false, lg = false }) => {
  if (!text) return null;
  const inline = (str) => {
    const parts = []; let rem = str, k = 0;
    while (rem) {
      const m = rem.match(/\*\*(.+?)\*\*/);
      if (m?.index !== undefined) {
        if (m.index > 0) parts.push(<span key={k++}>{rem.slice(0, m.index)}</span>);
        parts.push(
          <strong key={k++} className={`font-semibold ${isDark ? 'text-white font-extrabold' : 'text-slate-800 dark:text-slate-200'}`}>
            {m[1]}
          </strong>
        );
        rem = rem.slice(m.index + m[0].length); continue;
      }
      parts.push(<span key={k++}>{rem}</span>); break;
    }
    return parts;
  };
  const dot = accent.replace('text-', 'bg-');
  return (
    <ul className={lg ? 'space-y-2.5' : 'space-y-2'}>
      {text.split('\n').map(l => l.trim()).filter(l => l && !/^\**bloque\s*\d+/i.test(l)).map((l, i) => (
        <li key={i} className={`flex gap-2.5 ${lg ? 'text-[13px]' : 'text-[12px]'} leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600 dark:text-slate-400'}`}>
          <span className={`shrink-0 ${lg ? 'mt-[7px]' : 'mt-[6px]'} w-1.5 h-1.5 rounded-full ${dot}`} />
          <span>{inline(l.replace(/^[-•*]\s+/, ''))}</span>
        </li>
      ))}
    </ul>
  );
};

// ── Disclosure: lo que es referencia o detalle largo no compite con el foco ──
export const CoachDisclosure = ({ label, children, className = '' }) => (
  <details className={`group rounded-xl border border-slate-200/65 dark:border-slate-800/65 bg-slate-50/50 dark:bg-slate-800/10 ${className}`}>
    <summary className="flex items-center gap-1.5 px-3.5 py-2 cursor-pointer list-none text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
      <span className="transition-transform group-open:rotate-90 text-slate-300 dark:text-slate-600">▸</span>
      {label}
    </summary>
    <div className="px-3.5 pb-3.5">{children}</div>
  </details>
);

// ── Skeleton mientras el coach responde ─────────────────────────────────────
export const CoachPulse = () => (
  <div className="space-y-2 animate-pulse mt-2">
    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full w-3/4" />
    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full w-full" />
    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full w-5/6" />
  </div>
);

// Badge sobrio: punto de color en lugar de emoji (mapas en lib/aiInsights)
export const CoachBadge = ({ badge, className = '' }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold border ${badge.color} ${className}`}>
    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 shrink-0" />
    {badge.text}
  </span>
);

/**
 * Texto del coach con su estado: skeleton mientras carga, el análisis si lo
 * hay y, si no, el `fallback` determinista que la portada ya sabía calcular.
 */
export const CoachText = ({ ai, text, accent, lg = false, fallback = null }) => {
  if (ai.loading && !text) return <CoachPulse />;
  if (text) return <CoachMD text={text} accent={accent} lg={lg} />;
  return fallback;
};

const SELECT_ARROW = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
};

/**
 * Ajustes del análisis (sesiones/semana, objetivo) y copia del prompt. El
 * botón de recalcular lo pone quien lo usa: en la portada es el mismo que
 * sincroniza Strava y Garmin.
 */
export function CoachSettings({ ai }) {
  const { loading, weeklyTarget, changeWeeklyTarget, goal, lastPrompt } = ai;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copyPrompt = async () => {
    if (!lastPrompt) return;
    try {
      await navigator.clipboard.writeText(lastPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard no disponible */ }
  };

  return (
    <div className="flex items-center gap-2">
      {lastPrompt && (
        <button
          type="button"
          onClick={copyPrompt}
          title="Copiar el prompt enviado a la IA"
          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
        </button>
      )}
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          disabled={loading}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${open ? 'text-blue-600 bg-blue-50/50 border-blue-200' : 'text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50'}`}
        >
          <Cog6ToothIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-45' : ''}`} />
          <span>{weeklyTarget}×/sem</span>
          {goal && <span className="text-slate-300">·</span>}
          {goal && <span>🎯 {goal.distance}</span>}
        </button>

        {open && (
          <div role="dialog" aria-label="Ajustes del análisis IA" className="absolute right-0 top-full mt-2 w-60 z-30 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-md p-4 space-y-3">
            <div>
              <label htmlFor="ai-weekly-target" className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Correr / semana</label>
              <select
                id="ai-weekly-target"
                value={weeklyTarget}
                disabled={loading}
                onChange={e => changeWeeklyTarget(e.target.value)}
                className="w-full text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 pr-8 font-bold hover:border-blue-300 focus:outline-none focus:border-blue-400 transition-colors cursor-pointer appearance-none"
                style={SELECT_ARROW}
              >
                {[2, 3, 4, 5, 6].map(n => (
                  <option key={n} value={String(n)}>{n}×/sem</option>
                ))}
              </select>
            </div>
            <p className="text-[9px] text-slate-400 font-semibold leading-snug">
              Los cambios se aplican al pulsar «Recalcular».
            </p>
            {goal && (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold pt-2 border-t border-slate-100 dark:border-slate-800">
                🎯 Objetivo:&nbsp;<span className="font-bold text-slate-700 dark:text-slate-300">{goal.distance}{goal.pace ? ` · ${goal.pace}` : ''}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Estado de la petición: proveedor en curso, restauración y avisos de coherencia. */
export function CoachBanners({ ai }) {
  const { loading, providerLabel, isFallback, restoreWarning, dismissRestoreWarning, warnings } = ai;
  return (
    <>
      {loading && providerLabel && (
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-[11px] font-semibold ${isFallback
          ? 'bg-amber-50 border-amber-200/50 text-amber-800 dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400'
          : 'bg-blue-50 border-blue-200/50 text-blue-800 dark:bg-blue-950/20 dark:border-blue-900/50 dark:text-blue-400'
          }`}>
          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>{providerLabel}</span>
        </div>
      )}

      {restoreWarning && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200/50 rounded-xl text-[11px] text-amber-800 font-semibold dark:bg-amber-950/20 dark:border-amber-900/50 dark:text-amber-400">
          <span className="shrink-0 text-sm">⚠️</span>
          <span>Falló la actualización — mostrando la recomendación anterior guardada.</span>
          <button
            type="button"
            onClick={dismissRestoreWarning}
            className="ml-auto text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors font-bold leading-none cursor-pointer"
          >✕</button>
        </div>
      )}

      {/* La prescripción de la IA se valida post-hoc contra la readiness y las
          zonas de FC calculadas (sci). */}
      {!loading && warnings?.length > 0 && (
        <div className="rounded-xl border border-amber-200/70 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldExclamationIcon className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-amber-700 dark:text-amber-400">
              Revisa la prescripción
            </span>
          </div>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300/90">
                <span className="shrink-0 mt-[5px] w-1 h-1 rounded-full bg-amber-500" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
