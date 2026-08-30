import TabbedHub from './TabbedHub';
import VDOTEstimator from './VDOTEstimator';
import VO2MaxTracker from './VO2MaxTracker';
import LactateThreshold from './LactateThreshold';

// Agrupa las tres vistas del motor aeróbico (VDOT, VO2max y umbrales) en una
// sola sección con tabs — antes eran tres entradas del menú con datos solapados.
const FitnessHub = ({ activities }) => (
  <TabbedHub tabs={[
    { id: 'vdot', labelKey: 'hubs.vdot', label: 'VDOT', render: () => <VDOTEstimator activities={activities} /> },
    { id: 'vo2', labelKey: 'hubs.vo2', label: 'VO2max', render: () => <VO2MaxTracker activities={activities} /> },
    { id: 'umbrales', labelKey: 'hubs.thresholds', label: 'Umbrales', render: () => <LactateThreshold activities={activities} /> },
  ]} />
);

export default FitnessHub;
