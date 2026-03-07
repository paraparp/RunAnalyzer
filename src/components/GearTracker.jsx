import { Card, Title, Text, ProgressBar, Badge } from '@tremor/react';
import { useMemo } from 'react';

export default function GearTracker({ activities }) {
  const gearStats = useMemo(() => {
    if (!activities) return [];

    const stats = {};

    activities.forEach(a => {
      // Strava gear logic. Activities have gear_id.
      // Since we might not have fetched equipment details explicitly, we can group by gear_id 
      // It's common that if no gear is provided it returns null or undefined
      if (a.gear_id) {
        if (!stats[a.gear_id]) {
          stats[a.gear_id] = {
            id: a.gear_id,
            name: a.gear?.name || `Zapatilla (${a.gear_id})`,
            distance: 0,
            moving_time: 0,
            count: 0
          };
        }
        stats[a.gear_id].distance += a.distance;
        stats[a.gear_id].moving_time += a.moving_time;
        stats[a.gear_id].count += 1;
      }
    });

    return Object.values(stats)
      .map(gear => {
        const distKm = gear.distance / 1000;
        const speed = gear.moving_time > 0 ? (gear.distance / gear.moving_time) : 0;
        const paceStr = speed > 0 ? (16.6667 / speed) : 0;
        const m = Math.floor(paceStr);
        const s = Math.round((paceStr - m) * 60);

        return {
          ...gear,
          distanceKm: distKm,
          paceFormatted: paceStr > 0 ? `${m}:${s.toString().padStart(2, '0')}` : '-',
          maxLife: 800 // Assumed default max life of shoe in km
        };
      })
      .sort((a, b) => b.distanceKm - a.distanceKm); // Sort by most used
  }, [activities]);

  if (gearStats.length === 0) {
    return (
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-2">Garaje de Zapatillas</Title>
        <Text className="text-slate-500 mb-6">Analiza el uso y desgaste de tu equipamiento.</Text>
        <div className="bg-slate-50 rounded-xl p-8 border border-dashed border-slate-200 flex flex-col items-center justify-center text-center">
            <span className="text-4xl mb-3">👟</span>
            <p className="text-sm font-semibold text-slate-700">No hay zapatillas registradas</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">Si añades tus zapatillas dentro de tus actividades de Strava, aparecerán aquí agrupadas automáticamente.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-lg border-slate-200">
        <Title className="text-slate-800 font-bold mb-2">Garaje de Zapatillas</Title>
        <Text className="text-slate-500 mb-6">
          Lleva el control de kilómetros de tu calzado para prevenir lesiones. 
          Unas zapatillas de running suelen perder su amortiguación óptima entre los 600 y 800 km.
        </Text>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {gearStats.map(gear => {
            const pct = Math.min((gear.distanceKm / gear.maxLife) * 100, 100);
            let color = "emerald";
            if (pct > 60) color = "amber";
            if (pct > 85) color = "rose";

            let statusText = "Buen estado";
            if (pct > 60) statusText = "Desgaste medio";
            if (pct > 85) statusText = "Considera cambiarlas";

            return (
              <div key={gear.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-slate-800">{gear.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{gear.count} usos</p>
                  </div>
                  <Badge color={color} size="xs">{statusText}</Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-slate-50 rounded-lg p-2.5">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Ritmo Medio</p>
                    <p className="font-semibold text-slate-900">{gear.paceFormatted} <span className="text-xs font-medium text-slate-400">/km</span></p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Distancia</p>
                    <p className="font-semibold text-slate-900">{Math.round(gear.distanceKm)} <span className="text-xs font-medium text-slate-400">km</span></p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-500">Desgaste</span>
                    <span className="text-slate-900">{Math.round(gear.distanceKm)} / {gear.maxLife} km</span>
                  </div>
                  <ProgressBar value={pct} color={color} className="mt-2" />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
