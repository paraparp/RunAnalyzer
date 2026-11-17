import { useTranslation } from 'react-i18next';
import Logo from './Logo';

const BLOCK = 'rounded-md bg-slate-900/[0.06] dark:bg-white/[0.06]';

/**
 * Esqueleto de una vista mientras baja su chunk (todas las secundarias son lazy).
 * Tiene la forma típica de una vista —título, fila de cifras, gráfico— para que el
 * contenido no "salte" al llegar. Aparece con un pequeño retardo (`skeleton-delay`)
 * para no parpadear cuando el chunk ya está en caché.
 */
export default function ViewSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('common.loading', 'Cargando…')}
      className="skeleton-delay space-y-6"
    >
      <div className="space-y-2">
        <div className={`${BLOCK} h-6 w-48`} />
        <div className={`${BLOCK} h-4 w-72 max-w-full`} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${BLOCK} h-24`} />)}
      </div>
      <div className={`${BLOCK} h-72`} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${BLOCK} h-48`} />
        <div className={`${BLOCK} h-48`} />
      </div>
    </div>
  );
}

/** Pantalla completa de arranque: sesión resolviéndose o datos hidratándose. */
export function AppSplash({ label }) {
  return (
    <div role="status" className="min-h-screen flex items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <Logo className="w-12 h-12 rounded-md animate-pulse motion-reduce:animate-none" />
        {label && <span className="text-sm font-medium text-slate-500 dark:text-white/55">{label}</span>}
      </div>
    </div>
  );
}
