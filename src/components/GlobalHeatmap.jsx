import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, Title, Text, Select, SelectItem } from '@tremor/react';
import polyline from '@mapbox/polyline';

export default function GlobalHeatmap({ activities }) {
  const [filterType, setFilterType] = useState('all');

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

  return (
    <div className="space-y-6">
      <Card className="shadow-lg border-slate-200">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <Title className="text-slate-800 font-bold mb-2">Mapa de Calor Global</Title>
            <Text className="text-slate-500 text-sm max-w-xl">
              Explora todas tus rutas en un solo mapa interactivo. Las zonas que más transitas resaltarán visualmente.
            </Text>
          </div>
          <div className="w-full sm:w-auto">
            <Text className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Filtrar por</Text>
            <Select value={filterType} onValueChange={setFilterType} enableClear={false} className="w-full sm:w-48">
              <SelectItem value="all">Todas las carreras</SelectItem>
              <SelectItem value="run">Solo Asfalto</SelectItem>
              <SelectItem value="trail">Solo Trail / Montaña</SelectItem>
              <SelectItem value="long">Tiradas Largas (+20km)</SelectItem>
            </Select>
          </div>
        </div>

        <div className="h-[75vh] min-h-[600px] w-full rounded-2xl overflow-hidden shadow-inner border border-slate-300 relative bg-slate-800">
          <MapContainer 
            center={center} 
            zoom={12} 
            className="w-full h-full" 
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            {lines.map(line => (
              <Polyline 
                key={line.id} 
                positions={line.positions} 
                color="#f97316" // orange-500
                weight={2} 
                opacity={0.35}
                smoothFactor={1}
              />
            ))}
          </MapContainer>
        </div>
        
        <div className="mt-4 flex items-center gap-2 justify-end">
          <span className="text-xs text-slate-400 font-medium">Mostrando {lines.length} rutas</span>
        </div>
      </Card>
    </div>
  );
}
