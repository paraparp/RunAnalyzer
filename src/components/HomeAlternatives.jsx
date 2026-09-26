import StatusHero from './StatusHero';
import TodayBalance from './TodayBalance';

// ── Comparativa TEMPORAL de la portada (H6 de docs/AUDITORIA_DUPLICACION.md) ──
// `StatusHero` y `TodayBalance` se quedaron sin montar cuando `TodayView` pasó a
// pintar el estado y el reparto en línea. Antes de borrar a ninguno de los dos
// dueños, se enseñan aquí con los datos reales para elegir cuál se queda.
// Decidido eso, este fichero y su montaje en App.jsx se borran.
export default function HomeAlternatives({ activities, runningActivities, hrParams, onNavigate }) {
  return (
    <section className="space-y-4 rounded-2xl border-2 border-dashed border-slate-300 p-4">
      <div>
        <h2 className="text-sm font-bold text-slate-700">Versiones anteriores de la portada (para comparar)</h2>
        <p className="text-xs text-slate-500">
          Los mismos datos que arriba, con los paneles que usaba la portada antes. Decide con cuál te
          quedas y el otro se borra.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">A · StatusHero (estado)</h3>
        <StatusHero activities={activities} />
      </div>

      <div className="space-y-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">B · TodayBalance (zonas y carga)</h3>
        <TodayBalance
          activities={activities}
          runActivities={runningActivities}
          hrParams={hrParams}
          onOpenZones={() => onNavigate('zones')}
          onOpenLoad={() => onNavigate('pmc')}
        />
      </div>
    </section>
  );
}
