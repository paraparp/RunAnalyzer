import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import polyline from '@mapbox/polyline';
import { useTranslation } from 'react-i18next';
import { getLightMapTileUrl, getSatelliteMapTileUrl, getMapAttribution } from '../lib/mapTiles';
import { RouteShape } from './TodayVisuals';

const PAD = [24, 24];

// El contenedor cambia de tamaño con el layout (columna flexible): Leaflet no se
// entera solo, así que se recalcula el tamaño y se reencuadra el recorrido.
function FitRoute({ bounds }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: PAD });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map, bounds]);
  return null;
}

/** Recorrido de la sesión sobre mapa real; sin GPS decodificable, la silueta. */
export default function RouteMap({ encoded, className = '' }) {
  const { t } = useTranslation();
  const [layer, setLayer] = useState('map');
  const points = useMemo(() => {
    try { return encoded ? polyline.decode(encoded) : []; } catch { return []; }
  }, [encoded]);

  if (points.length < 2) return <RouteShape encoded={encoded} className={className} />;

  const start = points[0];
  const end = points[points.length - 1];
  return (
    // isolate: los paneles de Leaflet usan z-index 400+ y pisarían la barra fija.
    <div className={`isolate ${className}`}>
      <MapContainer
        bounds={points}
        boundsOptions={{ padding: PAD }}
        scrollWheelZoom={false}
        attributionControl
        className="w-full h-full"
        style={{ background: '#f1f5f9' }}
      >
        <TileLayer
          key={layer}
          url={layer === 'satellite' ? getSatelliteMapTileUrl() : getLightMapTileUrl()}
          attribution={getMapAttribution(layer === 'satellite' ? 'satellite' : 'light')}
        />
        {/* Halo blanco bajo la traza para que se lea sobre cualquier fondo */}
        <Polyline positions={points} pathOptions={{ color: '#ffffff', weight: 7, opacity: 0.9 }} />
        <Polyline positions={points} pathOptions={{ color: '#2563eb', weight: 3.5, opacity: 1 }} />
        <CircleMarker center={start} radius={6} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#10b981', fillOpacity: 1 }} />
        <CircleMarker center={end} radius={6} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0f172a', fillOpacity: 1 }} />
        <FitRoute bounds={points} />
      </MapContainer>
      <div className="absolute top-2 right-2 z-[1000] flex rounded-md bg-white/95 shadow-sm ring-1 ring-slate-200 p-0.5 text-[10px] font-semibold">
        {['map', 'satellite'].map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLayer(l)}
            className={`px-2 py-0.5 rounded ${layer === l ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
          >
            {t(`session.layer_${l}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
