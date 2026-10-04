import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const readTab = (key) => {
  try { return key ? localStorage.getItem(`hubTab:${key}`) : null; } catch { return null; }
};
const writeTab = (key, id) => {
  try { if (key) localStorage.setItem(`hubTab:${key}`, id); } catch { /* sin storage: no se recuerda */ }
};

/**
 * Shell de tabs compartido por los hubs de secciones (motor aeróbico, salud
 * cardiaca). Antes FitnessHub y HealthHub eran el mismo componente copiado, con
 * las etiquetas hardcodeadas en español pese a que el resto de la navegación sí
 * estaba traducida.
 *
 * @param {{id: string, labelKey: string, label: string, icon?: React.ComponentType, render: () => JSX.Element}[]} tabs
 *   `labelKey` es la clave i18n y `label` el texto español de respaldo. `render`
 *   es una función para que solo se monte el panel activo, como antes.
 * @param {string} [initial] id de la pestaña inicial (por defecto, la primera).
 * @param {string} [storageKey] si se da, recuerda la última pestaña abierta.
 */
const TabbedHub = ({ tabs, initial, storageKey }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState(() => {
    const saved = readTab(storageKey);
    return tabs.some((x) => x.id === saved) ? saved : (initial ?? tabs[0]?.id);
  });
  const active = tabs.find((x) => x.id === tab) ?? tabs[0];
  const select = (id) => { setTab(id); writeTab(storageKey, id); };

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(({ id, labelKey, label, icon: Icon }) => {
          const on = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={on}
              onClick={() => select(id)}
              className={`flex-1 min-w-max flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition-all ${
                on ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {Icon && <Icon className={`w-4 h-4 shrink-0 ${on ? 'text-white' : 'text-slate-400'}`} />}
              {t(labelKey, label)}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" key={active?.id}>
        {active?.render()}
      </div>
    </div>
  );
};

export default TabbedHub;
