import { useState } from 'react';
import VitalsOverview from './VitalsOverview';
import GarminCardiac from './GarminCardiac';
import CardiacDecoupling from './CardiacDecoupling';

// Agrupa las vistas de salud cardiaca (resumen vital, monitor Garmin y
// desacople FC/ritmo) en una sola sección con tabs — antes eran tres entradas
// del menú que repetían los mismos datos de FC/HRV.
const TABS = [
  { id: 'resumen', label: 'Resumen Vital' },
  { id: 'cardiaco', label: 'Monitor Cardiaco' },
  { id: 'desacople', label: 'Desacople' },
];

const HealthHub = ({ activities, onEnrichActivity }) => {
  const [tab, setTab] = useState('resumen');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1">
        {TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
              tab === id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
            }`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'resumen' && <VitalsOverview activities={activities} />}
      {tab === 'cardiaco' && <GarminCardiac />}
      {tab === 'desacople' && <CardiacDecoupling activities={activities} onEnrichActivity={onEnrichActivity} />}
    </div>
  );
};

export default HealthHub;
