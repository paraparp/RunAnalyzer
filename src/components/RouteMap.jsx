import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import polyline from '@mapbox/polyline';
import { useTranslation } from 'react-i18next';
import { getLightMapTileUrl, getDarkMapTileUrl, getSatelliteMapTileUrl, getMapAttribution } from '../lib/mapTiles';
import { RouteShape } from './TodayVisuals';
import { COLORS } from '../lib/palette';

const PAD = [24, 24];
// Miniatura estática: recuadro mucho más ajustado, la ruta es el contenido,
// no un detalle perdido en una ficha de mapa.
const PAD_THUMB = [6, 6];

// El contenedor cambia de tamaño con el layout (columna flexible): Leaflet no se
// entera solo, así que se recalcula el tamaño y se reencuadra el recorrido.
function FitRoute({ bounds, padding }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map, bounds, padding]);
  return null;
}

/**
 * Recorrido de la sesión sobre mapa real; sin GPS decodificable, la silueta.
 *
 * `interactive=false` lo convierte en una miniatura estática: sin arrastre, sin
 * zoom, sin controles ni selector de capa — pensado para tarjetas donde el clic
 * entero navega a la sesión. `theme` fija la tesela cuando no es interactivo
 * ('light' | 'dark'); en modo interactivo manda el selector Mapa/Satélite de
 * siempre.
 */
export default function RouteMap({ encoded, className = '', interactive = true, theme = 'light' }) {
  const { t } = useTranslation();
  const [layer, setLayer] = useState('map');
  const points = useMemo(() => {
    try { return encoded ? polyline.decode(encoded) : []; } catch { return []; }
  }, [encoded]);

  if (points.length < 2) return <RouteShape encoded={encoded} className={className} />;

  const start = points[0];
  const end = points[points.length - 1];
  const effectiveLayer = interactive ? layer : theme;
  const tileUrl = effectiveLayer === 'satellite' ? getSatelliteMapTileUrl()
    : effectiveLayer === 'dark' ? getDarkMapTileUrl()
    : getLightMapTileUrl();
  // En oscuro, la traza va al estilo del Mapa de Calor Global: línea naranja
  // sobre la tesela dark, sin halo ni marcadores — un trazo, no una ficha.
  const heat = effectiveLayer === 'dark';
  const pad = interactive ? PAD : PAD_THUMB;
  return (
    // isolate: los paneles de Leaflet usan z-index 400+ y pisarían la barra fija.
    <div className={`isolate ${className}`}>
      <MapContainer
        bounds={points}
        boundsOptions={{ padding: pad }}
        scrollWheelZoom={false}
        dragging={interactive}
        touchZoom={interactive}
        doubleClickZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
        zoomControl={interactive}
        attributionControl={interactive}
        className="w-full h-full"
        style={{ background: COLORS.hairlineSoft }}
      >
        <TileLayer
          key={effectiveLayer}
          url={tileUrl}
          attribution={getMapAttribution(effectiveLayer === 'satellite' ? 'satellite' : 'light')}
        />
        {heat ? (
          <Polyline
            positions={points}
            pathOptions={{ color: COLORS.elevated, weight: 2.5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
          />
        ) : (
          <>
            {/* Halo blanco bajo la traza para que se lea sobre cualquier fondo claro */}
            <Polyline positions={points} pathOptions={{ color: COLORS.paper, weight: 7, opacity: 0.9 }} />
            <Polyline positions={points} pathOptions={{ color: COLORS.signal, weight: 3.5, opacity: 1 }} />
            <CircleMarker center={start} radius={6} pathOptions={{ color: COLORS.paper, weight: 2, fillColor: COLORS.good, fillOpacity: 1 }} />
            <CircleMarker center={end} radius={6} pathOptions={{ color: COLORS.paper, weight: 2, fillColor: COLORS.ink, fillOpacity: 1 }} />
          </>
        )}
        <FitRoute bounds={points} padding={pad} />
      </MapContainer>
      {interactive && (
        <div role="group" className="absolute top-2 right-2 z-[1000] flex rounded bg-white shadow-sm ring-1 ring-slate-200 p-0.5 text-xs font-semibold">
          {['map', 'satellite'].map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={layer === l}
              onClick={(e) => { e.stopPropagation(); setLayer(l); }}
              className={`px-2 py-0.5 rounded focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ${layer === l ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
            >
              {t(`session.layer_${l}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
