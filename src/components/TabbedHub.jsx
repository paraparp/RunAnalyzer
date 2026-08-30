import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Shell de tabs compartido por los hubs de secciones (motor aeróbico, salud
 * cardiaca). Antes FitnessHub y HealthHub eran el mismo componente copiado, con
 * las etiquetas hardcodeadas en español pese a que el resto de la navegación sí
 * estaba traducida.
 *
 * @param {{id: string, labelKey: string, label: string, render: () => JSX.Element}[]} tabs
 *   `labelKey` es la clave i18n y `label` el texto español de respaldo. `render`
 *   es una función para que solo se monte el panel activo, como antes.
 * @param {string} [initial] id de la pestaña inicial (por defecto, la primera).
 */
const TabbedHub = ({ tabs, initial }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState(initial ?? tabs[0]?.id);
  const active = tabs.find((x) => x.id === tab) ?? tabs[0];
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1">
        {tabs.map(({ id, labelKey, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
              tab === id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
            }`}>
            {t(labelKey, label)}
          </button>
        ))}
      </div>
      {active?.render()}
    </div>
  );
};

export default TabbedHub;
