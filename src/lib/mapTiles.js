/**
 * Configuración centralizada de teselas de mapas para Leaflet.
 *
 * CARTO ahora requiere una API key gratuita (https://carto.com/basemaps/apikey).
 * Si no se proporciona en VITE_CARTO_API_KEY, estampa la marca de agua
 * "API KEY REQUIRED".
 *
 * Para solucionarlo:
 * 1. Si el usuario define VITE_CARTO_API_KEY en su archivo .env, se usa CARTO oficial.
 * 2. Si no hay clave definida, se usa Stadia Maps (Alidade Smooth Dark / Light),
 *    que en localhost es 100% libre, sin marcas de agua y de altísima calidad visual.
 */

const CARTO_KEY = import.meta.env.VITE_CARTO_API_KEY || '';

export function getDarkMapTileUrl() {
  if (CARTO_KEY) {
    return `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=${CARTO_KEY}`;
  }
  // Stadia Alidade Smooth Dark: idéntico estilo dark minimalista sin marcas de agua
  return 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png';
}

export function getLightMapTileUrl() {
  if (CARTO_KEY) {
    return `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?api_key=${CARTO_KEY}`;
  }
  return 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png';
}

export function getSatelliteMapTileUrl() {
  return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
}

export function getMapAttribution(type = 'dark') {
  if (type === 'satellite') {
    return '&copy; <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a>, Earthstar Geographics';
  }
  if (CARTO_KEY) {
    return '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/" target="_blank" rel="noreferrer">CARTO</a>';
  }
  return '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noreferrer">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OSM</a>';
}
