import TabbedHub from './TabbedHub';
import VitalsOverview from './VitalsOverview';
import GarminCardiac from './GarminCardiac';
import CardiacDecoupling from './CardiacDecoupling';

// Agrupa las vistas de salud cardiaca (resumen vital, monitor Garmin y
// desacople FC/ritmo) en una sola sección con tabs — antes eran tres entradas
// del menú que repetían los mismos datos de FC/HRV.
const HealthHub = ({ activities, onEnrichActivity }) => (
  <TabbedHub tabs={[
    { id: 'resumen', labelKey: 'hubs.vitals', label: 'Resumen Vital', render: () => <VitalsOverview activities={activities} /> },
    { id: 'cardiaco', labelKey: 'hubs.cardiac_monitor', label: 'Monitor Cardiaco', render: () => <GarminCardiac /> },
    { id: 'desacople', labelKey: 'hubs.decoupling', label: 'Desacople', render: () => <CardiacDecoupling activities={activities} onEnrichActivity={onEnrichActivity} /> },
  ]} />
);

export default HealthHub;
