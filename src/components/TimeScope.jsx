import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import cloudStorage from '../lib/cloudStorage';
import { DEFAULT_TIME_SCOPE, TIME_SCOPES, TIME_SCOPE_KEY, isTimeScope } from '../lib/timeScope';
import { TimeScopeContext } from '../lib/timeScopeContext';
import useTimeScope from '../hooks/useTimeScope';

/** Proveedor del período compartido; recuerda la elección entre sesiones. */
export function TimeScopeProvider({ children }) {
  const [scope, setScopeState] = useState(() => {
    const saved = cloudStorage.getItem(TIME_SCOPE_KEY);
    return isTimeScope(saved) ? saved : DEFAULT_TIME_SCOPE;
  });
  const setScope = useCallback((id) => {
    if (!isTimeScope(id)) return;
    setScopeState(id);
    cloudStorage.setItem(TIME_SCOPE_KEY, id);
  }, []);
  const value = useMemo(() => [scope, setScope], [scope, setScope]);
  return <TimeScopeContext.Provider value={value}>{children}</TimeScopeContext.Provider>;
}

/**
 * EL control de período. Es el mismo en todas las vistas y cambiarlo en una lo
 * cambia en todas: el tooltip lo dice, para que no sorprenda al cambiar de pestaña.
 */
export function TimeScopeSelector({ className = '' }) {
  const { t } = useTranslation();
  const [scope, setScope] = useTimeScope();
  return (
    <div
      role="group"
      aria-label={t('time_scope.label')}
      title={t('time_scope.shared_hint')}
      className={`inline-flex items-center gap-0.5 rounded-xl bg-slate-100 p-1 ${className}`}
    >
      {TIME_SCOPES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setScope(s.id)}
          aria-pressed={scope === s.id}
          className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${scope === s.id
            ? 'bg-white text-blue-600 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'}`}
        >
          {t(`time_scope.options.${s.id}`)}
        </button>
      ))}
    </div>
  );
}
