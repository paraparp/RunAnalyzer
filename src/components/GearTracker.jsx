import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getAthleteProfile } from '../services/strava';
import { 
  SparklesIcon, 
  ClockIcon, 
  MapPinIcon, 
  BoltIcon, 
  ArrowsRightLeftIcon,
  CheckBadgeIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

export default function GearTracker({ activities, stravaData, setStravaData }) {
  const { t } = useTranslation();
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
      <div className="bg-white rounded-3xl border border-slate-100 p-12 text-center shadow-sm">
        <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
           <MapPinIcon className="w-10 h-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-2">{t('gear.empty_title', 'Garaje Vacío')}</h3>
        <p className="text-slate-500 max-w-sm mx-auto font-medium">
           {t('gear.empty_desc', 'Si añades tus zapatillas dentro de tus actividades de Strava, aparecerán aquí agrupadas automáticamente.')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-100 p-8 shadow-xl shadow-slate-200/50">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
               <div className="bg-slate-900 text-white p-1 rounded-lg">
                  <SparklesIcon className="w-4 h-4" />
               </div>
               <h3 className="text-slate-900 font-black text-xl uppercase tracking-tight">{t('gear.title')}</h3>
            </div>
            <p className="text-slate-500 text-sm font-medium leading-relaxed max-w-2xl">
              {t('gear.subtitle')}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {gearStats.map((gear, idx) => {
            const pct = Math.min((gear.distanceKm / gear.maxLife) * 100, 100);
            let color = "bg-emerald-500";
            let textColor = "text-emerald-600";
            let bgColor = "bg-emerald-50";
            let borderColor = "border-emerald-100";
            let icon = CheckBadgeIcon;
            let statusText = t('gear.status.good');

            if (pct > 60) {
              color = "bg-amber-500";
              textColor = "text-amber-600";
              bgColor = "bg-amber-50";
              borderColor = "border-amber-100";
              icon = ExclamationTriangleIcon;
              statusText = t('gear.status.medium');
            }
            if (pct > 85) {
              color = "bg-rose-500";
              textColor = "text-rose-600";
              bgColor = "bg-rose-50";
              borderColor = "border-rose-100";
              icon = ExclamationCircleIcon;
              statusText = t('gear.status.replacement');
            }

            return (
              <motion.div 
                key={gear.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="group bg-white rounded-2xl border border-slate-100 p-5 hover:border-slate-200 hover:shadow-lg transition-all"
              >
                <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-10">
                  {/* Shoe Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                       <h4 className="font-black text-slate-900 truncate uppercase tracking-tight">{gear.name}</h4>
                       <div className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${bgColor} ${textColor} border ${borderColor}`}>
                          {statusText}
                       </div>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                       <span className="flex items-center gap-1"><ArrowsRightLeftIcon className="w-3 h-3" /> {gear.count} {t('dashboard.activities').toLowerCase()}</span>
                       <span>•</span>
                       <span className="flex items-center gap-1"><ClockIcon className="w-3 h-3" /> {gear.lastUsedStr}</span>
                    </div>
                  </div>

                  {/* Perf Stats */}
                  <div className="grid grid-cols-2 gap-8 shrink-0 border-l border-slate-50 pl-8 hidden sm:grid">
                     <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('gear.stats.avg_pace')}</p>
                        <p className="text-lg font-black text-slate-900 tabular-nums leading-none">
                           {gear.paceFormatted} <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">/km</span>
                        </p>
                     </div>
                     <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('gear.stats.km_per_run')}</p>
                        <p className="text-lg font-black text-slate-900 tabular-nums leading-none">
                           {(gear.distanceKm / gear.count).toFixed(1)} <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">km</span>
                        </p>
                     </div>
                  </div>

                  {/* Wear Progress */}
                  <div className="w-full lg:w-64 xl:w-80 shrink-0">
                    <div className="flex justify-between items-end mb-2">
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('dashboard.desgaste', 'Desgaste Acumulado')}</p>
                       <p className="text-xs font-black text-slate-900 tabular-nums">{Math.round(gear.distanceKm)} <span className="text-[10px] text-slate-400 font-bold">/ {gear.maxLife} km</span></p>
                    </div>
                    <div className="h-2.5 bg-slate-50 rounded-full overflow-hidden border border-slate-100 relative">
                       <motion.div 
                          className={`h-full rounded-full ${color} shadow-[0_0_10px_rgba(0,0,0,0.1)]`}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                       />
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
