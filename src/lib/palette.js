// Paleta de RunAnalyzer: la fuente única de los colores de DESIGN.md para todo lo que
// no puede usar clases de Tailwind (Recharts, Leaflet, SVG, estilos en línea).
// Los nombres siguen los tokens de DESIGN.md; las zonas viven en zoneColors.js.

export const COLORS = {
  // Tinta y superficies
  ink: '#0f172a',
  inkSecondary: '#475569',
  inkMuted: '#64748b',      // gris más claro permitido para texto sobre blanco
  inkFaint: '#94a3b8',      // solo iconos, series neutras y áreas de referencia
  hairlineStrong: '#cbd5e1',
  hairline: '#e2e8f0',
  hairlineSoft: '#f1f5f9',
  sunken: '#f8fafc',
  paper: '#ffffff',

  // Azul señal: acción, selección, serie principal
  signal: '#2563eb',
  signalDeep: '#1d4ed8',
  signalBright: '#3b82f6',
  signalLight: '#60a5fa',
  signalPale: '#93c5fd',
  signalWash: '#eff6ff',

  // Estado, de mejor a peor. Elevated es el escalón entre precaución y riesgo.
  good: '#10b981',
  goodBright: '#22c55e',
  goodDeep: '#059669',
  caution: '#f59e0b',
  cautionLight: '#fbbf24',
  cautionDeep: '#d97706',
  elevated: '#f97316',
  risk: '#f43f5e',
  riskLight: '#f87171',
  riskDeep: '#e11d48',

  // Series categóricas de gráfica: métricas distintas que no son estado
  seriesIndigo: '#6366f1',
  seriesViolet: '#8b5cf6',
  seriesSky: '#0ea5e9',
  seriesCyan: '#0891b2',

  // Marca externa
  strava: '#fc4c02',
};

// Estilos compartidos de Recharts.
export const AXIS_TICK = { fontSize: 11, fill: COLORS.inkMuted };
