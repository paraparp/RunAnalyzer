---
name: RunAnalyzer
description: Análisis de entrenamiento de running con rigor fisiológico, de Strava y Garmin al reloj.
colors:
  signal-blue: "#2563eb"
  signal-blue-deep: "#1d4ed8"
  signal-blue-bright: "#3b82f6"
  signal-blue-light: "#60a5fa"
  signal-blue-pale: "#93c5fd"
  signal-blue-wash: "#eff6ff"
  kinetic-blue: "#004be2"
  kinetic-blue-soft: "#809bff"
  status-good: "#10b981"
  status-good-bright: "#22c55e"
  status-good-deep: "#059669"
  status-caution: "#f59e0b"
  status-caution-light: "#fbbf24"
  status-caution-deep: "#d97706"
  status-elevated: "#f97316"
  status-risk: "#f43f5e"
  status-risk-light: "#f87171"
  status-risk-deep: "#e11d48"
  series-indigo: "#6366f1"
  series-violet: "#8b5cf6"
  series-sky: "#0ea5e9"
  series-cyan: "#0891b2"
  strava: "#fc4c02"
  ink: "#0f172a"
  ink-secondary: "#475569"
  ink-muted: "#64748b"
  ink-faint: "#94a3b8"
  hairline-strong: "#cbd5e1"
  hairline: "#e2e8f0"
  hairline-soft: "#f1f5f9"
  paper: "#ffffff"
  canvas: "#f4f6fb"
  sunken: "#f8fafc"
  zone-1: "#94a3b8"
  zone-2: "#38bdf8"
  zone-3: "#4ade80"
  zone-4: "#fb923c"
  zone-5: "#f87171"
  zone-2-text: "#0369a1"
  zone-3-text: "#15803d"
  zone-4-text: "#c2410c"
  zone-5-text: "#b91c1c"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, Inter, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.33
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.06em"
rounded:
  base: "2px"
  pill: "0.75rem"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  page-lg: "32px"
components:
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.base}"
    padding: "16px"
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.base}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.signal-blue-deep}"
    textColor: "{colors.paper}"
  input:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.base}"
    padding: "8px 12px"
  input-focus:
    backgroundColor: "{colors.paper}"
  nav-item:
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    padding: "12px 16px"
  nav-item-active:
    backgroundColor: "{colors.signal-blue-wash}"
    textColor: "{colors.signal-blue-deep}"
  chip-status:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.base}"
    padding: "2px 6px"
---

# Design System: RunAnalyzer

## Overview

**Creative North Star: "El cuaderno de laboratorio"**

RunAnalyzer se presenta como el cuaderno de un fisiólogo: hojas blancas sobre una mesa gris azulada, cifras escritas con decisión y anotaciones pequeñas y precisas al margen. La interfaz no compite con el dato; lo enmarca. Cada pantalla es una página de registro: una cabecera con la pregunta, el número que la responde y el contexto mínimo para fiarse de él.

La densidad es alta, como corresponde a una herramienta de análisis que el atleta consulta a diario, pero ordenada: superficies planas con borde fino, esquinas casi rectas (2px) y una sola tinta de acento, el azul señal. El color se gana: aparece cuando significa algo (zona de FC, estado bueno/precaución/riesgo, acción principal) y no como decoración.

El sistema rechaza el brillo de producto genérico: degradados en el texto, resplandores de color, tarjetas de cristal translúcido y adornos que no dicen nada sobre el entrenamiento.

**Key Characteristics:**
- Hojas planas blancas con borde fino sobre lienzo gris azulado.
- Esquinas de 2px en todo: afilado, técnico, de instrumento.
- Cifras protagonistas en peso máximo con números tabulares; etiquetas pequeñas en versales.
- Un acento (azul señal) para acción y selección; tres colores de estado y cinco de zona con significado fijo.
- Bandas oscuras puntuales (tinta) para el veredicto del día, nunca como tema general.

## Colors

Paleta de laboratorio: neutros fríos de pizarra, un azul de señal para actuar y colores semánticos que nunca cambian de significado.

### Primary
- **Azul señal** (signal-blue): botón principal, enlace, elemento seleccionado, serie principal de una gráfica. Es la única tinta de acción.
- **Azul señal profundo** (signal-blue-deep): hover del botón principal y texto del elemento activo de navegación; también el `theme-color` del navegador.
- **Lavado azul** (signal-blue-wash): fondo del elemento seleccionado y de los recuadros explicativos («Cómo leer»).
- **Azul cinético** (kinetic-blue → kinetic-blue-soft): solo en la banda de 3px que corona las cabeceras de las herramientas de IA (`kinetic-gradient`) y como color de marca de Tremor. Marca «aquí habla la IA».

### Secondary
Cada estado tiene un tono base (relleno de gráfica, punto, barra), uno claro (escalón intermedio o relleno suave) y uno profundo (texto sobre blanco o sobre su lavado).
- **Verde estado** (status-good / -bright / -deep): mejora, forma fresca, objetivo cumplido, delta favorable. El tono brillante es el segundo escalón de una escala de categorías (VO2max «excelente» frente a «superior»).
- **Ámbar precaución** (status-caution / -light / -deep): zona de vigilancia (ACWR alto, fatiga moderada, dato incompleto).
- **Naranja elevado** (status-elevated): escalón entre precaución y riesgo en las escalas de gravedad de cuatro o más niveles (riesgo de lesión «alto», VO2max «bajo»). No se usa fuera de esas escalas.
- **Rosa riesgo** (status-risk / -light / -deep): riesgo de lesión, sobrecarga, delta desfavorable, acción destructiva. Es el único rojo del sistema: no se usa `#ef4444`.

### Tertiary
- **Zonas de FC** (zone-1 … zone-5): pizarra, cielo, verde, naranja y rojo para Z1–Z5. Definidas una sola vez en `src/lib/zoneColors.js` y compartidas por parciales, sesión, zonas y la vista de Hoy. Cada zona tiene un tono de relleno (estos) y un tono de texto -700 para cumplir contraste.
- **Series de gráfica** (series-indigo, series-violet, series-sky, series-cyan): métricas distintas en una misma gráfica que no son estado ni zona (VFC, sueño, FC en reposo). Diferencian, no califican.
- **Strava** (strava): solo para lo que remite a Strava (enlace a la actividad, conexión). Es color de marca externa, no del sistema.

### En código
Todo color que no puede ser una clase de Tailwind (Recharts, Leaflet, SVG, estilos en línea) sale de `src/lib/palette.js` (`COLORS`, con los mismos nombres en camelCase) o de `src/lib/zoneColors.js` (`ZONES`). Los ejes de Recharts usan `AXIS_TICK`. No se escriben hexadecimales nuevos en los componentes.

### Neutral
- **Tinta** (ink): cifras, titulares y fondo de las bandas oscuras de veredicto.
- **Tinta secundaria** (ink-secondary): texto de cuerpo y párrafos explicativos.
- **Tinta tenue** (ink-muted): etiquetas, unidades, metadatos y ejes de gráfica. Es el gris más claro permitido para texto sobre blanco.
- **Tinta débil** (ink-faint): iconos decorativos, series neutras y áreas de referencia en gráficas. Nunca texto.
- **Línea fuerte** (hairline-strong), **línea** (hairline) y **línea suave** (hairline-soft): bordes de tarjeta, cuadrícula de gráfica, divisores de tabla, separadores.
- **Papel** (paper): superficie de toda tarjeta.
- **Lienzo** (canvas): fondo de la aplicación, detrás de las hojas.
- **Hundido** (sunken): campos de formulario, filas alternas, pistas de barras vacías.

### Named Rules
**The Earned Color Rule.** El color significa algo o no aparece. Azul es acción o selección; verde, ámbar y rosa son estado; las zonas son zonas. Un color no se usa «para dar vida».

**The Ink Floor Rule.** Ningún texto sobre blanco por debajo de la tinta tenue (4.8:1). Los grises más claros son para iconos decorativos, bordes y estados desactivados.

**The Fixed Meaning Rule.** Un color de zona o de estado significa lo mismo en todas las pantallas. Z3 no puede ser verde en una vista y ámbar en otra.

## Typography

**Display Font:** Plus Jakarta Sans (con Inter de respaldo)
**Body Font:** Inter (con ui-sans-serif, system-ui)

**Character:** Inter hace todo el trabajo de instrumento: neutra, legible a tamaños pequeños, con números tabulares. Plus Jakarta Sans aparece solo en las cifras grandes de la vista de Hoy, donde el dato del día merece una voz algo más cálida.

### Hierarchy
- **Display** (800, 2.25rem, 1.1): cifra principal de la vista de Hoy (km de la semana, valor del día). Siempre con números tabulares.
- **Headline** (900, 1.5rem, 1.2): cifras clave de tarjeta y titulares de sección. El peso máximo se reserva para dato y titular.
- **Title** (700, 15px, 1.4): título de tarjeta (también el de Tremor).
- **Body** (400–500, 14px, 1.43): texto de cuerpo, explicaciones, recuadros «Cómo leer», mensajes del chat, celdas de tabla. Los párrafos explicativos no pasan de unos 75 caracteres por línea. No hay un tamaño intermedio de 13px.
- **Caption** (500, 12px): metadatos, unidades, pistas bajo un valor, leyendas. Es el tamaño mínimo para texto en minúscula.
- **Label** (700, 11px, 0.06em, MAYÚSCULAS): cabecera de dato, chip de estado, encabezado de tabla. Es la clase `text-label` de Tailwind y el tamaño mínimo absoluto de la interfaz.

### Named Rules
**The Eleven Floor Rule.** Nada por debajo de 11px, y 11px solo en versales. En minúscula el suelo es 12px. La excepción es el póster exportable de `RouteGallery`, que es un objeto impreso y no interfaz.

**The Heavy Is Data Rule.** El peso 900 es para cifras y titulares. Las etiquetas van en 700; si todo pesa lo mismo, nada destaca.

**The Tabular Rule.** Toda cifra que se compara con otra (tablas, parciales, series) usa números tabulares.

## Layout

La aplicación es un shell de dos columnas: barra lateral fija de 260px a la izquierda (cajón deslizante por debajo de `lg`) y una zona principal con scroll propio. El contenido se centra con un ancho máximo de 1400px (2200px en el panel principal, que es una cuadrícula ancha), con 16px de margen lateral en móvil y 32px desde `lg`.

El ritmo vertical entre bloques es de 24px. Dentro de una tarjeta, los grupos se separan con 12–16px y los elementos relacionados con 4–8px. Las cuadrículas de métricas pasan de una columna en móvil a 2–4 columnas en `sm`/`lg`. `sm` y `lg` son los puntos de corte que más se usan; `md` es secundario.

**The Page-Of-Record Rule.** Cada vista abre con su cabecera (qué pregunta responde) y sigue con el dato. No hay heroes de marketing dentro de la aplicación.

## Elevation & Depth

Sistema plano con borde. La profundidad la da el contraste entre el lienzo gris azulado y la hoja blanca con su línea de 1px, no la sombra. Hay sombra mínima en reposo; las sombras grandes se reservan para lo que flota de verdad (menús, ventanas, tooltips, el panel lateral del chat).

### Shadow Vocabulary
- **Reposo de hoja** (`box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)`): tarjetas. Apenas separa la hoja del lienzo.
- **Flotante** (`box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)`): menús desplegables, tooltips de gráfica, popovers.
- **Superpuesto** (`box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25)`): ventanas y panel lateral del chat.

### Named Rules
**The Flat Sheet Rule.** Las tarjetas son hojas planas: blanco, línea de 1px y como mucho la sombra de reposo. Ni cristal translúcido ni sombras grandes en una tarjeta que no flota.

**The No Glow Rule.** Sin halos de color (sombras sin desplazamiento teñidas de azul, verde o rosa). La profundidad no se colorea.

## Shapes

Todas las esquinas de la escala de Tailwind (`rounded`, `-sm`, `-md`, `-lg`, `-xl`, `-2xl`, `-3xl`) están unificadas en 2px mediante `--radius`. Da un perfil afilado, de instrumento, aunque el código use nombres distintos. `rounded-full` está redefinido en 12px, así que píldoras y círculos salen como rectángulos de esquina suave. Los indicadores que deben ser circulares de verdad (puntos de leyenda, avatares) necesitan un radio explícito del 50%.

Los bordes son siempre de 1px en tono línea o línea suave. Las barras de gráfica usan esquina superior de 4px.

**The Two Pixel Rule.** Una forma nueva usa 2px. No se introducen radios grandes para «suavizar»: el carácter del sistema es la esquina recta.

## Components

### Buttons
Directos y compactos, como un interruptor de laboratorio.
- **Shape:** esquina recta (2px).
- **Primary:** azul señal, texto blanco en etiqueta de 12px a peso máximo en versales con espaciado ancho, 10px × 20px de relleno y sombra mínima.
- **Hover / Focus:** pasa a azul señal profundo; el foco de teclado muestra un anillo de 2px.
- **Secondary:** papel con línea de 1px y texto en tinta tenue; en hover, fondo hundido y texto en tinta.
- **Destructive (ghost):** como el secundario, pero en hover vira a lavado rosa con texto en rosa riesgo.
- **Icon-only:** cuadrado de 28–32px, icono en tinta tenue y, en hover, el color de su acción sobre su lavado.

### Chips
- **Status chip:** etiqueta de 11px en versales, relleno 2px × 6px, fondo en el lavado del estado (verde, ámbar, rosa, índigo) y texto en el tono -800 del mismo color.
- **Filter pill:** relleno 4px × 10px, texto de 12px a peso medio y línea de 1px. Seleccionado: fondo pizarra claro (#f1f5f9), línea más marcada (#cbd5e1) y texto en tinta secundaria. No seleccionado: solo la línea, con texto en tinta tenue.

### Cards / Containers
- **Corner Style:** esquina recta (2px).
- **Background:** papel sobre lienzo.
- **Shadow Strategy:** reposo de hoja (ver Elevation & Depth).
- **Border:** línea de 1px.
- **Internal Padding:** 16px por defecto, 20–24px en tarjetas de cabecera o de veredicto.
- **Explainer panel:** recuadro «Cómo leer» en lavado azul (o verde) con línea del mismo tono y texto teñido del color, nunca gris.

### Inputs / Fields
- **Style:** fondo hundido, línea de 1px, esquina recta, texto de 14px.
- **Focus:** el fondo pasa a papel, el borde a azul claro y aparece un anillo azul al 20%.
- **Error / Disabled:** borde y anillo en rosa riesgo; desactivado al 40% de opacidad.

### Navigation
- **Sidebar:** papel, 260px. Cabecera con logo y nombre; debajo, cinco categorías con icono de 20px y texto de 14px.
- **Default:** texto en tinta tenue a peso medio; en hover, azul señal sobre hundido.
- **Active:** texto en azul señal profundo a peso 700, fondo en lavado azul al 50% e indicador de 4px en el borde derecho. La categoría activa despliega sus subvistas sangradas.
- **Mobile:** la barra lateral se convierte en cajón con fondo oscurecido y desenfoque de 4px.

### Banda de veredicto (signature)
Bloque plano en tinta, sin degradado ni manchas de color, que abre la vista de Hoy. Da la respuesta de la mañana en dos mitades: el estado (anillo de 0 a 100 y su lectura en palabras) y «Hoy toca» (la sesión que manda hoy en una línea, con el aviso si el estado pide descargar). Debajo, las cuatro señales del reloj que forman el estado. Es la única superficie oscura grande de la aplicación y usa texto blanco y blanco al 60–80 %. Sin al menos dos señales del reloj no muestra un número: lo dice y se apoya en la forma. Sin ninguna señal del reloj, la banda se compacta: sin anillo ni casillas vacías, con una sola invitación a conectar Garmin. Mientras las cachés del reloj se leen, dice que está leyendo, no que faltan datos.

### Cabecera de herramienta IA (signature)
Tarjeta de papel coronada por la banda `kinetic-gradient` de 3px, con un recuadro de 36px en lavado azul que contiene el icono, título en versales y controles a la derecha. Marca todas las superficies donde habla la IA (Coach, Predictor, Preguntas).

## Do's and Don'ts

### Do:
- **Do** usar la tinta tenue (#64748b) como gris más claro para cualquier texto sobre blanco.
- **Do** usar `text-label` (11px, 700, versales, 0.06em) para cabeceras de dato y chips, y `text-xs` (12px) como mínimo para texto en minúscula.
- **Do** tomar los colores de zona de `src/lib/zoneColors.js` y no redefinirlos en el componente.
- **Do** construir tarjetas como hojas planas: papel, línea de 1px y sombra de reposo.
- **Do** reservar el azul señal para acción y selección, y verde, ámbar y rosa para estado.
- **Do** usar números tabulares en toda cifra comparable.

### Don't:
- **Don't** usar texto en degradado; el énfasis se da con peso y tamaño.
- **Don't** usar tarjetas de cristal translúcido (`bg-white/70` + `backdrop-blur`) ni halos de color (`glow-*`).
- **Don't** usar bordes laterales gruesos (más de 1px) de color en tarjetas, avisos o recuadros. El indicador de navegación activa es la única excepción establecida.
- **Don't** poner gris sobre un fondo de color; en un lavado, el texto se tiñe del mismo tono.
- **Don't** introducir radios grandes; la forma del sistema es la esquina de 2px.
- **Don't** escribir colores hexadecimales nuevos en un componente si ya existe el token.
