import TabbedHub from './TabbedHub';
import VitalsOverview from './VitalsOverview';
import GarminCardiac from './GarminCardiac';
import CardiacDecoupling from './CardiacDecoupling';
import AerobicForm from './AerobicForm';
import GarminSleep from './GarminSleep';

// Agrupa las vistas de salud cardiaca (resumen vital, monitor Garmin, desacople
// FC/ritmo y forma aeróbica) en una sola sección con tabs — antes eran tres
// entradas del menú que repetían los mismos datos de FC/HRV.
//
// "Forma aeróbica" va aquí y no en FitnessHub a propósito: lo que mide es FC a
// esfuerzo fijo, la misma familia que el desacople, y las dos se leen juntas.
const HealthHub = ({ activities, onOpenConnections }) => (
  <TabbedHub tabs={[
    { id: 'resumen', labelKey: 'hubs.vitals', label: 'Resumen Vital', render: () => <VitalsOverview activities={activities} /> },
    { id: 'cardiaco', labelKey: 'hubs.cardiac_monitor', label: 'Monitor Cardiaco', render: () => <GarminCardiac onOpenConnections={onOpenConnections} /> },
    { id: 'desacople', labelKey: 'hubs.decoupling', label: 'Desacople', render: () => <CardiacDecoupling activities={activities} /> },
    { id: 'forma', labelKey: 'hubs.aerobic_form', label: 'Forma aeróbica', render: () => <AerobicForm activities={activities} /> },
    { id: 'sueno', labelKey: 'hubs.sleep', label: 'Sueño', render: () => <GarminSleep /> },
  ]} />
);

export default HealthHub;
