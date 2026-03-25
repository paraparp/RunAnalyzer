import { Card, Title, Text, ProgressBar, Badge } from '@tremor/react';
import { useMemo, useState, useEffect } from 'react';
import { getAthleteProfile } from '../services/strava';

export default function GearTracker({ activities, stravaData, setStravaData }) {
  const [shoeNames, setShoeNames] = useState({});

  useEffect(() => {
    const fetchShoes = async () => {
      // Si ya las tenemos decodificadas previamente
      if (stravaData?.athlete?.shoes) {
        const names = {};
        stravaData.athlete.shoes.forEach(s => names[s.id] = s.name);
        setShoeNames(names);
        return;
      }

      // Si no, recabamos el perfil detallado usando el token
      if (stravaData?.accessToken) {
        try {
          const profile = await getAthleteProfile(stravaData.accessToken);
          if (profile && profile.shoes) {
            const names = {};
            profile.shoes.forEach(s => names[s.id] = s.name);
            setShoeNames(names);

            if (setStravaData) {
              setStravaData(prev => {
                const updated = { ...prev, athlete: { ...prev.athlete, ...profile } };
                localStorage.setItem('stravaData', JSON.stringify(updated));
                return updated;
              });
            }
          }
        } catch (err) {
          console.error("Error fetching athlete profile for shoes:", err);
        }
      }
    };

    fetchShoes();
  }, [stravaData, setStravaData]);

  const gearStats = useMemo(() => {
    if (!activities) return [];

    const stats = {};

    activities.forEach(a => {
      if (a.gear_id) {
        if (!stats[a.gear_id]) {
          stats[a.gear_id] = {
            id: a.gear_id,
            name: shoeNames[a.gear_id] || a.gear?.name || `Zapatilla (${a.gear_id})`,
            distance: 0,
            moving_time: 0,
            count: 0,
            lastUsed: new Date(0),
            maxDistance: 0,
            fastestSpeed: 0
          };
        }
        stats[a.gear_id].distance += a.distance;
        stats[a.gear_id].moving_time += a.moving_time;
        stats[a.gear_id].count += 1;

        const actDate = new Date(a.start_date);
        if (actDate > stats[a.gear_id].lastUsed) {
          stats[a.gear_id].lastUsed = actDate;
        }
        if (a.distance > stats[a.gear_id].maxDistance) {
          stats[a.gear_id].maxDistance = a.distance;
        }
        const speed = a.moving_time > 0 ? a.distance / a.moving_time : 0;
        if (speed > stats[a.gear_id].fastestSpeed) {
          stats[a.gear_id].fastestSpeed = speed;
        }
      }
    });

    return Object.values(stats)
      .map(gear => {
        const distKm = gear.distance / 1000;
        const avgSpeed = gear.moving_time > 0 ? (gear.distance / gear.moving_time) : 0;
        
        const formatPace = (speedMps) => {
            if (!speedMps) return '-';
            const pace = 16.6667 / speedMps;
            const m = Math.floor(pace);
            const s = Math.round((pace - m) * 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };

        const today = new Date();
        const diffTime = Math.abs(today - gear.lastUsed);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const lastUsedStr = diffDays <= 1 ? 'Hoy' : diffDays === 2 ? 'Ayer' : `Hace ${diffDays} d`;

        return {
          ...gear,
          distanceKm: distKm,
          paceFormatted: formatPace(avgSpeed),
          fastestPaceFormatted: formatPace(gear.fastestSpeed),
          maxDistanceKm: (gear.maxDistance / 1000).toFixed(1),
          lastUsedStr: gear.lastUsed.getTime() === 0 ? '?' : lastUsedStr,
          maxLife: 800 // Vida utíl base (se recomienda escalar)
        };
      })
      .sort((a, b) => b.distanceKm - a.distanceKm);
  }, [activities, shoeNames]);

  if (gearStats.length === 0) {
    return (
      <Card className="shadow-sm border-transparent bg-surface-container-lowest">
        <Title className="text-on-surface font-bold mb-2">Garaje de Zapatillas</Title>
        <Text className="text-on-surface-variant mb-6">Analiza el uso y rendimiento de tu equipamiento.</Text>
        <div className="bg-surface-container-low rounded-xl p-8 border border-dashed border-outline-variant flex flex-col items-center justify-center text-center">
            <span className="text-4xl mb-3">👟</span>
            <p className="text-sm font-semibold text-on-surface">No hay zapatillas registradas</p>
            <p className="text-xs text-on-surface-variant mt-1 max-w-sm">Si añades tus zapatillas dentro de tus actividades de Strava, aparecerán aquí agrupadas automáticamente.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-sm border-transparent bg-surface-container-lowest">
        <Title className="text-on-surface font-bold mb-2">Garaje de Zapatillas</Title>
        <Text className="text-on-surface-variant mb-6">
          Lleva el control de kilómetros y rendimiento. Unas zapatillas suelen perder su amortiguación óptima entre los 600 y 800 km.
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
              <div key={gear.id} className="bg-surface-container-lowest rounded-xl border border-surface-container-high p-5 shadow-sm hover:shadow-md transition-all">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-on-surface">{gear.name}</h3>
                    <p className="text-xs text-on-surface-variant mt-0.5">{gear.count} usos • {gear.lastUsedStr}</p>
                  </div>
                  <Badge color={color} size="xs">{statusText}</Badge>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                  {/* Ritmo Medio */}
                  <div className="bg-surface-container-low rounded-xl p-4 flex flex-col items-start border border-transparent">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center mb-3">
                      <span className="material-symbols-outlined text-blue-500 text-[18px]" data-icon="speed">speed</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-1">Ritmo Medio</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-black text-on-surface tabular-nums leading-none">{gear.paceFormatted}</span>
                      <span className="text-[10px] font-medium text-on-surface-variant">/km</span>
                    </div>
                  </div>
                  {/* Media Km/Salida */}
                  <div className="bg-surface-container-low rounded-xl p-4 flex flex-col items-start border border-transparent">
                    <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center mb-3">
                      <span className="material-symbols-outlined text-sky-500 text-[18px]" data-icon="avg_time">avg_pace</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-1">Media / Salida</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-black text-on-surface tabular-nums leading-none">{(gear.distanceKm / gear.count).toFixed(1)}</span>
                      <span className="text-[10px] font-medium text-on-surface-variant">km</span>
                    </div>
                  </div>
                  {/* Distancia Total */}
                  <div className="bg-surface-container-low rounded-xl p-4 flex flex-col items-start border border-transparent">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center mb-3">
                      <span className="material-symbols-outlined text-emerald-500 text-[18px]" data-icon="route">route</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant block mb-1">Dist. Total</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-black text-on-surface tabular-nums leading-none">{Math.round(gear.distanceKm)}</span>
                      <span className="text-[10px] font-medium text-on-surface-variant">km</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider">
                    <span className="text-on-surface-variant">Desgaste</span>
                    <span className="text-on-surface">{Math.round(gear.distanceKm)} / {gear.maxLife} km</span>
                  </div>
                  <ProgressBar value={pct} color={color} className="mt-2 h-2" />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
