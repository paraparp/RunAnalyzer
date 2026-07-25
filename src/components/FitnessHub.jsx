import { useState } from 'react';
import VDOTEstimator from './VDOTEstimator';
import VO2MaxTracker from './VO2MaxTracker';
import LactateThreshold from './LactateThreshold';

// Agrupa las tres vistas del motor aeróbico (VDOT, VO2max y umbrales) en una
// sola sección con tabs — antes eran tres entradas del menú con datos solapados.
const TABS = [
  { id: 'vdot', label: 'VDOT' },
  { id: 'vo2', label: 'VO2max' },
  { id: 'umbrales', label: 'Umbrales' },
];

const FitnessHub = ({ activities }) => {
  const [tab, setTab] = useState('vdot');
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
      {tab === 'vdot' && <VDOTEstimator activities={activities} />}
      {tab === 'vo2' && <VO2MaxTracker activities={activities} />}
      {tab === 'umbrales' && <LactateThreshold activities={activities} />}
    </div>
  );
};

export default FitnessHub;
