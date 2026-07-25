import { SparklesIcon } from '@heroicons/react/24/outline';

// Cabecera común de las herramientas IA (Coach, Predictor, Q&A) — mismo
// lenguaje visual que el módulo Coach IA del dashboard: banda kinetic-gradient,
// tile azul con icono y controles alineados a la derecha.
const AIToolHeader = ({ icon: Icon = SparklesIcon, title, subtitle, children }) => (
  <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm shrink-0">
    <div className="absolute inset-x-0 top-0 h-[3px] kinetic-gradient" />
    <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black uppercase tracking-tight text-slate-800 dark:text-slate-100 leading-tight truncate">{title}</p>
          {subtitle && <p className="text-[11px] text-slate-400 font-semibold mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>}
    </div>
  </div>
);

export default AIToolHeader;
