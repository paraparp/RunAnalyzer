import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import polyline from '@mapbox/polyline';
import { useTranslation } from 'react-i18next';

export default function GlobalHeatmap({ activities }) {
  const { t } = useTranslation();
  const [filterType, setFilterType] = useState('all');
  const [colorMode, setColorMode] = useState('heatmap');
  const [baseMap, setBaseMap] = useState('dark');

  const lines = useMemo(() => {
    if (!activities) return [];
    
    let filtered = activities;
    if (filterType === 'run') {
      filtered = activities.filter(a => a.type === 'Run');
    } else if (filterType === 'trail') {
      filtered = activities.filter(a => a.sport_type === 'TrailRun');
    } else if (filterType === 'long') {
      filtered = activities.filter(a => a.distance >= 20000); // >= 20km
    }
    
    return filtered
      .filter(a => a.map && a.map.summary_polyline)
      .map(a => {
        const decoded = polyline.decode(a.map.summary_polyline);
        return {
          id: a.id,
          name: a.name,
          average_speed: a.average_speed,
          average_heartrate: a.average_heartrate,
          positions: decoded
        };
      });
  }, [activities, filterType]);

  const center = useMemo(() => {
    if (lines.length > 0 && lines[0].positions.length > 0) {
      return lines[0].positions[Math.floor(lines[0].positions.length / 2)];
    }
    return [40.4168, -3.7038]; // Madrid default if nowhere else
  }, [lines]);

  const getColor = (a) => {
    if (colorMode === 'heatmap') return '#fb923c'; // orange-400
    
    if (colorMode === 'pace') {
      const speed = a.average_speed; // in m/s
      if (!speed) return '#94a3b8'; // slate-400 fallback
      // Speed mappings: 3:30/km (4.76 m/s) -> Green (hue 120)
      //                 6:30/km (2.56 m/s) -> Red (hue 0)
      let v = (speed - 2.56) / (4.76 - 2.56);
      v = Math.max(0, Math.min(1, v));
      const hue = v * 120;
      return `hsl(${Math.round(hue)}, 100%, 50%)`;
    }

    if (colorMode === 'hr') {
      const hr = a.average_heartrate;
      if (!hr) return '#94a3b8'; // slate-400 fallback
      // HR mappings: 130bpm -> Green (hue 120)
      //              180bpm -> Red (hue 0)
      let v = (hr - 130) / (180 - 130);
      v = Math.max(0, Math.min(1, v));
      const hue = (1 - v) * 120; // Invert: High HR = Red
      return `hsl(${Math.round(hue)}, 100%, 50%)`;
    }
  };

  const getActiveBaseLayer = () => {
    if (baseMap === 'dark') return "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
    if (baseMap === 'light') return "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
    if (baseMap === 'satellite') return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  };

  const opacityConfig = {
    heatmap: 0.3,
    pace: 0.8,
    hr: 0.8
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <Card className="shadow-xl shadow-slate-200/50 border-slate-200 ring-1 ring-slate-100 rounded-3xl overflow-visible">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8 px-2">
          <div className="max-w-xl">
            <h2 className="text-2xl font-black tracking-tight text-slate-900 mb-2">{t('maps.title')}</h2>
            <Text className="text-slate-500 text-sm leading-relaxed">
              {t('maps.subtitle')}
            </Text>
          </div>
          
          <div className="w-full xl:w-auto grid grid-cols-1 sm:grid-cols-3 gap-4 shrink-0">
            <div>
              <Text className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">{t('maps.base_map')}</Text>
              <Select value={baseMap} onValueChange={setBaseMap} enableClear={false} className="w-full sm:w-40 font-medium shadow-sm">
                <SelectItem value="dark"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-slate-800"></span>{t('maps.dark')}</span></SelectItem>
                <SelectItem value="light"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-slate-200 border border-slate-300"></span>{t('maps.light')}</span></SelectItem>
                <SelectItem value="satellite"><span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-600"></span>{t('maps.satellite')}</span></SelectItem>
              </Select>
            </div>
            <div>
              <Text className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">{t('maps.filter')}</Text>
              <Select value={filterType} onValueChange={setFilterType} enableClear={false} className="w-full sm:w-44 font-medium shadow-sm">
                <SelectItem value="all">{t('maps.all')}</SelectItem>
                <SelectItem value="run">{t('maps.road')}</SelectItem>
                <SelectItem value="trail">{t('maps.trail')}</SelectItem>
                <SelectItem value="long">{t('maps.long')}</SelectItem>
              </Select>
            </div>
            <div>
              <Text className="text-[10px] font-bold text-slate-400 mb-1.5 uppercase tracking-widest">{t('maps.color_mode')}</Text>
              <Select value={colorMode} onValueChange={setColorMode} enableClear={false} className="w-full sm:w-44 font-medium shadow-sm">
                <SelectItem value="heatmap"><span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-orange-500"></div>{t('maps.density')}</span></SelectItem>
                <SelectItem value="pace"><span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-gradient-to-r from-green-500 to-red-500"></div>{t('maps.pace')}</span></SelectItem>
                <SelectItem value="hr"><span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-gradient-to-r from-green-500 to-red-500"></div>{t('maps.hr')}</span></SelectItem>
              </Select>
            </div>
          </div>
        </div>

        <div className={`h-[75vh] min-h-[600px] w-full rounded-2xl overflow-hidden shadow-inner border border-slate-200 relative ${baseMap === 'dark' ? 'bg-[#0f172a]' : 'bg-slate-100'}`}>
          <MapContainer 
            center={center} 
            zoom={12} 
            className="w-full h-full z-0" 
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; CARTO & ESA'
              url={getActiveBaseLayer()}
            />
            {lines.map((a) => (
              <Polyline 
                key={a.id} 
                positions={a.positions} 
                color={getColor(a)}
                weight={colorMode === 'heatmap' ? 2 : 3} 
                opacity={opacityConfig[colorMode]}
                smoothFactor={1}
                pathOptions={{ lineCap: 'round', lineJoin: 'round' }}
              />
            ))}
          </MapContainer>

          {/* Map Legend Overlay */}
          {colorMode !== 'heatmap' && (
            <div className="absolute bottom-6 left-6 z-[1000] bg-white/90 backdrop-blur-md px-4 py-3 rounded-xl border border-slate-200/60 shadow-lg shadow-black/5 flex flex-col gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                {colorMode === 'pace' ? t('maps.pace') : t('maps.hr')}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-700">{colorMode === 'hr' ? t('maps.legend_slow') : t('maps.legend_slow')}</span>
                <div className="w-24 h-2.5 rounded-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500"></div>
                <span className="text-xs font-semibold text-slate-700">{colorMode === 'hr' ? t('maps.legend_fast') : t('maps.legend_fast')}</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
             <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
             </span>
             <span className="text-xs text-slate-500 font-semibold">{t('maps.showing')} <strong className="text-blue-600 font-black">{lines.length}</strong> {t('maps.routes')}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
