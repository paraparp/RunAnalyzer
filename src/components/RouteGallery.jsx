import React, { useMemo, useState } from 'react';
import { Card, Text, Select, SelectItem } from '@tremor/react';
import polyline from '@mapbox/polyline';
import { useTranslation } from 'react-i18next';
import { RectangleGroupIcon, SwatchIcon } from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

const THEMES = {
    light: {
        id: 'light',
        name: 'Classic Print',
        bg: 'bg-white',
        border: 'border-slate-200',
        textTitle: 'text-slate-900',
        textData: 'text-slate-800',
        textMeta: 'text-slate-400',
        dot: 'bg-slate-300',
        stroke: '#0f172a', // very dark slate
        backdrop: '#f8fafc',
        shadow: 'shadow-xl shadow-slate-200/50',
    },
    dark: {
        id: 'dark',
        name: 'Midnight Slate',
        bg: 'bg-[#0f172a]',
        border: 'border-slate-800',
        textTitle: 'text-white',
        textData: 'text-slate-200',
        textMeta: 'text-slate-500',
        dot: 'bg-slate-600',
        stroke: '#38bdf8', // sky-400
        backdrop: '#1e293b',
        shadow: 'shadow-2xl shadow-black/40',
    },
    neon: {
        id: 'neon',
        name: 'Neon Tokyo',
        bg: 'bg-black',
        border: 'border-zinc-900',
        textTitle: 'text-fuchsia-400',
        textData: 'text-cyan-400',
        textMeta: 'text-zinc-600',
        dot: 'bg-zinc-800',
        stroke: '#e81cff', // neon pink/fuchsia
        backdrop: '#09090b',
        shadow: 'shadow-[0_0_30px_rgba(232,28,255,0.1)]',
        glow: true
    },
    strava: {
        id: 'strava',
        name: 'Orange Signature',
        bg: 'bg-white',
        border: 'border-orange-100',
        textTitle: 'text-slate-900',
        textData: 'text-slate-800',
        textMeta: 'text-orange-900/40',
        dot: 'bg-orange-200',
        stroke: '#fc4c02', // strava orange
        backdrop: '#fff7ed',
        shadow: 'shadow-xl shadow-orange-900/5',
    }
};

const SvgMap = ({ encodedPolyline, theme, delay }) => {
    const coords = useMemo(() => {
        if (!encodedPolyline) return [];
        try {
            return polyline.decode(encodedPolyline);
        } catch {
            return [];
        }
    }, [encodedPolyline]);

    if (coords.length === 0) return null;

    const lats = coords.map(c => c[0]);
    const lngs = coords.map(c => c[1]);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const midLat = (maxLat + minLat) / 2;
    const latFactor = Math.cos(midLat * Math.PI / 180);

    const w = (maxLng - minLng) * latFactor;
    const h = (maxLat - minLat);

    const size = 100;
    const padding = 12;
    const innerSize = size - 2 * padding;

    const scale = innerSize / Math.max(w || 1, h || 1);

    const pathData = coords.map((c, i) => {
        const x = padding + (c[1] - minLng) * latFactor * scale;
        const y = size - padding - (c[0] - minLat) * scale;
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    const cx = (size - (w * scale) - 2 * padding) / 2;
    const cy = (size - (h * scale) - 2 * padding) / 2;

    return (
        <svg viewBox="0 0 100 100" className="w-full h-full">
            {/* Soft circle backdrop */}
            <circle cx="50" cy="50" r="48" fill={theme.backdrop} />
            
            {/* Crosshairs for aesthetic map feel */}
            <path d="M 50 2 L 50 10 M 50 90 L 50 98 M 2 50 L 10 50 M 90 50 L 98 50" stroke={theme.stroke} opacity="0.1" strokeWidth="0.5" />
            
            <g transform={`translate(${cx}, ${cy})`}>
                <motion.path 
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 2.2, ease: "easeOut", delay: delay * 0.15 }}
                    d={pathData} 
                    fill="none" 
                    stroke={theme.stroke} 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    style={theme.glow ? { filter: `drop-shadow(0 0 4px ${theme.stroke})` } : {}}
                />
            </g>
        </svg>
    );
};

export default function RouteGallery({ activities }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('longest');
  const [activeTheme, setActiveTheme] = useState('dark');
  
  const posters = useMemo(() => {
    if (!activities) return [];
    
    // Filter out activities without map
    let valid = activities.filter(a => a.map && a.map.summary_polyline && a.type === 'Run');
    
    if (filter === 'longest') {
      valid.sort((a, b) => b.distance - a.distance);
    } else if (filter === 'recent') {
      valid.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    } else if (filter === 'fastest') {
      valid.sort((a, b) => b.average_speed - a.average_speed);
    }
    
    return valid.slice(0, 12);
  }, [activities, filter]);

  const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\//g, '.');
  };

  const getPaceStr = (speed) => {
    if (!speed) return '0:00/km';
    const mins = 1000 / (speed * 60);
    const m = Math.floor(mins);
    const s = Math.round((mins - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')}/km`;
  };

  const formatCoords = (latlng) => {
      if (!latlng || latlng.length < 2) return "0.0000°N 0.0000°W";
      const lat = latlng[0];
      const lng = latlng[1];
      return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
  };

  const theme = THEMES[activeTheme];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <Card className="shadow-xl border-slate-200 ring-1 ring-slate-100 rounded-3xl pb-10 overflow-hidden bg-slate-50/50">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10 px-2 mt-2">
          <div>
            <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <RectangleGroupIcon className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-3xl font-black tracking-tighter text-slate-900">{t('gallery.title', 'Galería de Rutas')}</h2>
            </div>
            <Text className="text-slate-500 text-sm max-w-xl">
              {t('gallery.subtitle', 'Tus rutas como auténticos pósters de diseño. Cambia el tema para una experiencia inmersiva.')}
            </Text>
          </div>
          
          <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-4 shrink-0">
            <div>
              <Text className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest flex items-center gap-1">
                <SwatchIcon className="w-3 h-3" /> Tema Original
              </Text>
              <Select value={activeTheme} onValueChange={setActiveTheme} enableClear={false} className="w-full sm:w-40 font-semibold shadow-sm">
                {Object.values(THEMES).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <Text className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">Mostrar</Text>
              <Select value={filter} onValueChange={setFilter} enableClear={false} className="w-full sm:w-40 font-semibold shadow-sm">
                <SelectItem value="longest">Distancia Máx</SelectItem>
                <SelectItem value="fastest">Velocidad Punta</SelectItem>
                <SelectItem value="recent">Últimas 12</SelectItem>
              </Select>
            </div>
          </div>
        </div>

           {posters.map((act, i) => (
               <a 
                   key={act.id} 
                   href={`https://www.strava.com/activities/${act.id}`}
                   target="_blank"
                   rel="noopener noreferrer"
                   title={`Ver ${act.name} en Strava`}
                   className={`${theme.bg} ${theme.border} ${theme.shadow} rounded-sm aspect-[3/4] p-4 flex flex-col hover:-translate-y-2 hover:scale-[1.02] transition-all duration-500 group border cursor-pointer relative`}
               >
                    {/* Link indicator icon on hover */}
                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
                        <svg className={`w-4 h-4 ${theme.textMeta}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                    </div>

                    {/* Header info / Map scale */}
                    <div className="flex justify-between items-start pb-2 border-b border-inherit mb-4 opacity-70">
                        <span className={`text-[8px] uppercase tracking-[0.2em] font-bold ${theme.textMeta}`}>
                            N. {i+1 < 10 ? '0'+(i+1) : i+1}
                        </span>
                        <span className={`text-[8px] uppercase tracking-[0.2em] font-bold ${theme.textMeta}`}>
                            GPS TRK
                        </span>
                    </div>

                    <div className="relative flex-1 w-full flex items-center justify-center px-4">
                       {/* Poster Art Map */}
                       <div className="w-full h-full group-hover:scale-105 transition-transform duration-[800ms] ease-out">
                         <SvgMap encodedPolyline={act.map.summary_polyline} theme={theme} delay={i} />
                       </div>
                    </div>

                    {/* Minimalist Data Block for Poster */}
                    <div className="mt-6 border-t border-inherit pt-4">
                        <h4 className={`text-xs font-black uppercase ${theme.textTitle} tracking-[0.15em] mb-2 leading-tight pr-4`}>
                            {act.name}
                        </h4>
                        
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                                <p className={`text-[7px] font-bold uppercase tracking-[0.2em] ${theme.textMeta} mb-0.5`}>DIST</p>
                                <p className={`text-sm font-black tracking-tight ${theme.textData}`}>{(act.distance / 1000).toFixed(2)}km</p>
                            </div>
                            <div>
                                <p className={`text-[7px] font-bold uppercase tracking-[0.2em] ${theme.textMeta} mb-0.5`}>PACE</p>
                                <p className={`text-sm font-black tracking-tight ${theme.textData}`}>{getPaceStr(act.average_speed)}</p>
                            </div>
                            {act.total_elevation_gain > 0 && (
                                <div>
                                    <p className={`text-[7px] font-bold uppercase tracking-[0.2em] ${theme.textMeta} mb-0.5`}>ELEV</p>
                                    <p className={`text-[10px] font-bold tracking-tight ${theme.textData}`}>+{act.total_elevation_gain}m</p>
                                </div>
                            )}
                            <div>
                                <p className={`text-[7px] font-bold uppercase tracking-[0.2em] ${theme.textMeta} mb-0.5`}>DATE</p>
                                <p className={`text-[10px] font-bold tracking-tight ${theme.textData}`}>{formatDate(act.start_date)}</p>
                            </div>
                        </div>

                        {/* Coordinates footer */}
                        <div className={`text-[7px] font-bold uppercase tracking-[0.3em] ${theme.textMeta} border-t border-inherit pt-2 opacity-60 flex justify-between`}>
                            <span>{act.start_latlng ? formatCoords(act.start_latlng) : 'TERRESTRIAL'}</span>
                        </div>
                    </div>
               </a>
           ))}
        </div>
      </Card>
    </div>
  );
}
