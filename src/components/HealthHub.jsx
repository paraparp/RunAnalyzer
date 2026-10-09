import {
  HeartIcon, SignalIcon, ArrowsRightLeftIcon, ArrowTrendingUpIcon, MoonIcon, ScaleIcon,
} from '@heroicons/react/24/outline';
import TabbedHub from './TabbedHub';
import VitalsOverview from './VitalsOverview';
import GarminCardiac from './GarminCardiac';
import CardiacDecoupling from './CardiacDecoupling';
import AerobicForm from './AerobicForm';
import GarminSleep from './GarminSleep';
import WeightTrend from './WeightTrend';

// Agrupa las vistas de salud cardiaca (resumen vital, monitor Garmin, desacople
// FC/ritmo y forma aeróbica) en una sola sección con tabs — antes eran tres
// entradas del menú que repetían los mismos datos de FC/HRV.
//
// "Forma aeróbica" va aquí y no en FitnessHub a propósito: lo que mide es FC a
// esfuerzo fijo, la misma familia que el desacople, y las dos se leen juntas.
// `tab` abre directamente una pestaña (ruta /health/<tab>, p. ej. desde la portada).
const HealthHub = ({ activities, onOpenConnections, tab }) => (
  <TabbedHub storageKey="health" initial={tab} tabs={[
    { id: 'resumen', labelKey: 'hubs.vitals', label: 'Resumen Vital', icon: HeartIcon, render: () => <VitalsOverview activities={activities} /> },
    { id: 'cardiaco', labelKey: 'hubs.cardiac_monitor', label: 'Monitor Cardiaco', icon: SignalIcon, render: () => <GarminCardiac onOpenConnections={onOpenConnections} /> },
    { id: 'desacople', labelKey: 'hubs.decoupling', label: 'Desacople', icon: ArrowsRightLeftIcon, render: () => <CardiacDecoupling activities={activities} /> },
    { id: 'forma', labelKey: 'hubs.aerobic_form', label: 'Forma aeróbica', icon: ArrowTrendingUpIcon, render: () => <AerobicForm activities={activities} /> },
    { id: 'sueno', labelKey: 'hubs.sleep', label: 'Sueño', icon: MoonIcon, render: () => <GarminSleep /> },
    { id: 'peso', labelKey: 'hubs.weight', label: 'Peso', icon: ScaleIcon, render: () => <WeightTrend activities={activities} onOpenConnections={onOpenConnections} /> },
  ]} />
);

export default HealthHub;
