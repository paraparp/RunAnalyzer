import { useTranslation } from 'react-i18next';
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';
import useTheme from '../hooks/useTheme';

/**
 * Selector claro/oscuro de la cabecera: dos botones con el activo resaltado.
 * «Sistema» vive en el menú de usuario; aquí se elige explícitamente.
 */
export default function ThemeToggle({ className = '' }) {
  const { t } = useTranslation();
  const { isDark, setTheme } = useTheme();
  const options = [
    { id: 'light', Icon: SunIcon, label: t('user_menu.theme_light', 'Claro'), active: !isDark },
    { id: 'dark', Icon: MoonIcon, label: t('user_menu.theme_dark', 'Oscuro'), active: isDark },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t('user_menu.theme', 'Tema')}
      className={`inline-flex items-center p-0.5 rounded-sm border border-slate-900/15 bg-slate-900/[0.04] dark:border-white/20 dark:bg-white/[0.04] ${className}`}
    >
      {options.map(({ id, Icon, label, active }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => setTheme(id)}
          title={label}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-bold transition-colors ${
            active
              ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
              : 'text-slate-500 hover:text-slate-950 dark:text-white/55 dark:hover:text-white'
          }`}
        >
          <Icon className="w-4 h-4" />
          <span className="hidden xl:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
