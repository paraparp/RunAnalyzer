# Modo oscuro y claro con el estilo de la landing

Plan para que toda la app tenga dos temas, oscuro y claro, con el lenguaje visual de la landing ([LandingPage.jsx](../src/components/LandingPage.jsx)): negro `#07090d`, acentos teal y naranja, bordes finos translúcidos y titulares `font-black tracking-tighter`.

## Punto de partida (octubre 2026)

- Tailwind ya usa `darkMode: 'class'` ([tailwind.config.js](../tailwind.config.js)). Cualquier `dark:` se activa si un ancestro tiene la clase `dark`.
- Hoy la clase `dark` **no está en `<html>`**: se pone a mano en trozos concretos.
  - Barra lateral, cabecera y pantalla «Conecta Strava» ([App.jsx](../src/App.jsx)): siempre oscuras.
  - `<main>` solo cuando `currentView === 'dashboard'`.
- Componentes del dashboard con variantes `dark:` ya ajustadas a la landing: `TodayView`, `TodayVisuals`, `TodayPlannedSession`, `CoachAI`, `UserMenu`, `TimeScope`.
- Solo 18 de unos 80 componentes tienen alguna variante `dark:`. El resto usa colores claros fijos (`bg-white`, `text-slate-900`, `border-slate-200`…).
- [index.css](../src/index.css) fuerza a Tremor estilos claros con `!important` (`.tremor-Card-root { background: #ffffff }`, títulos `#0f172a`…).
- [DESIGN.md](../DESIGN.md) describe el sistema claro anterior: azul señal y nada de cristal ni resplandores. Choca con el estilo de la landing.

## Decisión previa

Hay que elegir qué hace el **marco** (barra lateral y cabecera) en modo claro:

- **A. Siempre oscuro (recomendado).** Es la identidad de la landing. Solo el contenido cambia de tema y no hay que tocar el marco.
- **B. Sigue al tema.** Más coherente en modo claro, pero hay que quitar el `dark` fijo de `<aside>`/`<header>` y darles variantes claras.

## 1. Tokens de color semánticos

En lugar de repetir `bg-white dark:bg-white/[0.03]` en cada componente, definir variables CSS que cambian con el tema y exponerlas en Tailwind.

`src/index.css`:

```css
:root {
  --bg:            246 247 249;  /* fondo de página */
  --surface:       255 255 255;  /* tarjeta */
  --surface-2:     241 243 246;  /* hundido / hover */
  --line:          15 23 42;     /* bordes: se usa con alfa, p. ej. /10 */
  --ink:           10 12 16;
  --ink-muted:     71 85 105;
  --accent:        13 148 136;   /* teal-600: legible sobre blanco */
  --accent-2:      234 88 12;    /* orange-600 */
}
.dark {
  --bg:            7 9 13;       /* #07090d, el de la landing */
  --surface:       255 255 255;  /* se usa con alfa 0.03–0.06 */
  --surface-2:     255 255 255;
  --line:          255 255 255;
  --ink:           255 255 255;
  --ink-muted:     255 255 255;  /* con alfa /55 */
  --accent:        94 234 212;   /* teal-300 */
  --accent-2:      253 186 116;  /* orange-300 */
}
```

`tailwind.config.js` → `theme.extend.colors`:

```js
bg:       'rgb(var(--bg) / <alpha-value>)',
surface:  'rgb(var(--surface) / <alpha-value>)',
line:     'rgb(var(--line) / <alpha-value>)',
ink:      'rgb(var(--ink) / <alpha-value>)',
accent:   'rgb(var(--accent) / <alpha-value>)',
accent2:  'rgb(var(--accent-2) / <alpha-value>)',
```

Las superficies translúcidas del modo oscuro (`white/[0.03]`) no tienen equivalente en claro (blanco opaco). Para ellas hay que crear clases de componente en `@layer components`:

```css
.card    { @apply bg-white border border-slate-900/10 dark:bg-white/[0.03] dark:border-white/10; }
.card-hi { @apply bg-white border border-slate-900/10 dark:bg-white/[0.06] dark:border-white/15; }
.h-display { @apply font-black tracking-tighter text-ink; }
```

**Ojo con el teal:** `teal-300` y `orange-300` solo se leen sobre fondo oscuro. En claro, el texto de acento tiene que ser `teal-700` u `orange-700` (contraste ≥ 4,5:1). Por eso `--accent` cambia de valor según el tema.

## 2. Activar el tema globalmente

1. Crear `src/hooks/useTheme.js`:
   - Estado `'light' | 'dark' | 'system'`, guardado en `localStorage` (`app_theme`) dentro de try/catch.
   - Si es `system`, seguir `matchMedia('(prefers-color-scheme: dark)')` y escuchar sus cambios.
   - Aplicar con `document.documentElement.classList.toggle('dark', isDark)`.
2. En `index.html`, añadir un script en línea **antes** del bundle que aplique la clase leyendo `localStorage`. Así se evita el destello claro al cargar.
3. Poner el selector de tema en `UserMenu`, junto al de idioma.
4. Actualizar `<meta name="theme-color">` según el tema.
5. Quitar los `dark` locales:
   - En `<main>` de `App.jsx`, el condicional `currentView === 'dashboard' ? 'dark …'` ya no hace falta: el fondo pasa a `bg-bg`.
   - Con la opción A se mantiene `dark` en `<aside>` y `<header>`. Con la B se quita.

## 3. Migrar los componentes

Unos 60 componentes no tienen variantes oscuras. Para migrarlos, mejor un codemod con tabla de equivalencias que hacerlo a mano. Un script en `scripts/` con reemplazos por regex **solo para clases completas** (sin sufijo `/NN`; si lo tienen, se revisan a mano):

| Ahora | Pasa a |
|---|---|
| `bg-white` (tarjeta) | `card` o `bg-white dark:bg-white/[0.03]` |
| `bg-slate-50`, `bg-slate-100` | `bg-slate-50 dark:bg-white/[0.04]` |
| `border-slate-200`, `border-slate-100` | `border-slate-200 dark:border-white/10` |
| `text-slate-900`, `text-slate-800` | `text-slate-900 dark:text-white` |
| `text-slate-700`, `text-slate-600` | `… dark:text-white/75` |
| `text-slate-500` | `text-slate-500 dark:text-white/55` |
| `text-slate-400` | `text-slate-400 dark:text-white/40` |
| `text-blue-600` (acento) | `text-teal-700 dark:text-teal-300` |
| `bg-blue-600` (botón principal) | `bg-slate-950 text-white dark:bg-white dark:text-slate-950` |
| `bg-amber-50 text-amber-900` (avisos) | añadir `dark:bg-amber-400/10 dark:text-amber-200` |
| `hover:bg-slate-50` | `… dark:hover:bg-white/[0.05]` |

Orden propuesto, por uso:

1. `TabbedHub`, `CollapsibleSection`, `ExpandableChart`, `AIToolHeader`, `MetricChart` (contenedores compartidos: arreglan muchas vistas a la vez).
2. `ActivityLog`, `SessionView`, `ActivitySplits`, `SessionStreams`.
3. Rendimiento: `FitnessFatigue`, `FitnessHub`, `WeeklyProgression`, `HRAnalysis`, `TrainingZones`, `RacePredictor`…
4. Salud: `HealthHub`, `VitalsOverview`, `GarminSleep`, `WeightTrend`…
5. Ajustes: `Connections`, `HrCalibration`, `DataExporter`, `AdminPanel`.

## 4. Tremor

- En `index.css`, mover los overrides de `.tremor-Card-root`, `.tremor-Title-root`, `.tremor-Text-root` y de las tablas a las variables (`rgb(var(--surface))`…) o duplicarlos bajo `.dark`.
- En `tailwind.config.js`, alinear `dark-tremor` con la landing: `background.DEFAULT: '#0c0e12'`, `border.DEFAULT: 'rgba(255,255,255,0.1)'`, `brand.DEFAULT: '#5eead4'`, `content.emphasis: '#ffffff'`, `content.DEFAULT: 'rgba(255,255,255,0.55)'`.

## 5. Gráficos y mapas

- `src/lib/palette.js` (`COLORS`) tiene la tinta y las superficies en hexadecimal fijo. Añadir un `darkColors` o una función `themeColors(isDark)`, y que los gráficos la lean con `useTheme()`. Afecta a ejes, rejilla, tooltips y líneas de referencia.
- Los colores de **zona de FC** y de **estado** (bueno/precaución/riesgo) no cambian de significado. Hay que comprobar que se leen sobre `#07090d`, sobre todo los más oscuros.
- Mapas: `RouteMap`, `GlobalHeatmap` y `GeoZones` ya tienen fondo oscuro. Basta con elegir `dark`/`light` por defecto según el tema.
- Los SVG con `fill`/`stroke` fijos (`TodayVisuals`, `ConsistencyHeatmap`) deben usar `currentColor` o variables.

## 6. Documentación del sistema

Actualizar [DESIGN.md](../DESIGN.md):

- El acento pasa de «azul señal» a teal y naranja.
- Se permiten superficies translúcidas y halos en el modo oscuro (`.shell-glow`), que el documento hoy prohíbe.
- Añadir los tokens del punto 1 y las dos variantes de contraste del acento.

Después, regenerar el sidecar con `/impeccable document`.

## 7. Comprobaciones

- [ ] Recorrer cada vista en claro y oscuro (también móvil a 375 px).
- [ ] Contraste ≥ 4,5:1 en texto normal y ≥ 3:1 en gráficos (texto `white/55` sobre `#07090d` cumple; `white/40` solo vale para etiquetas grandes).
- [ ] Sin destello del tema contrario al recargar.
- [ ] `system` sigue el cambio del sistema operativo sin recargar.
- [ ] Tooltips, menús, modales (`ShoePhotoModal`) y el panel de chat, en ambos temas.
- [ ] `npx vitest run` y `npx vite build` limpios.
