---
target: "http://localhost:5173/activity/20485026877"
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:D:\\Projects\\RunAnalyzer\\src\\components\\SessionView.jsx"
target_fingerprint: "sha256:c8a44efe159402f46f6b34417bc672fe417ca57d9acfbca63a98d267ec5ba618"
target_path: "D:\\Projects\\RunAnalyzer\\src\\components\\SessionView.jsx"
timestamp: 2026-10-07T11-47-51Z
slug: src-components-sessionview-jsx
---
# Crítica: SessionView (/activity/:id)

Method: dual-agent (A: revisión de diseño · B: detector). Revisión sobre código; no se renderizó la página (sin navegador automatizable, requiere sesión).

## Puntuación (20/40, Aceptable)
| # | Heurística | Nota | Problema |
|---|---|---|---|
| 1 | Estado del sistema | 2 | "Aún no hay parciales" mientras se descargan; el índice fijo no marca sección activa |
| 2 | Lenguaje del usuario | 2 | ppm, m/lat, "% HR" (humedad) en la UI inglesa |
| 3 | Control y libertad | 2 | Esc en el modal lo cierra y además vuelve a la bitácora |
| 4 | Consistencia | 2 | Chip Carrera en ámbar; GAP en tres fuentes; etiquetas del modal en slate-400 |
| 5 | Prevención de errores | 2 | Las teclas atraviesan el modal |
| 6 | Reconocer, no recordar | 2 | La explicación del veredicto solo está en title; "#2 de 11" ambiguo |
| 7 | Flexibilidad | 3 | ← →, Esc, zoom por tramo; tramo solo con ratón |
| 8 | Estética | 2 | Dos mapas; la FC media en cuatro sitios |
| 9 | Recuperación de errores | 1 | e.message crudo en streams, sin reintentar |
| 10 | Ayuda | 2 | Sin recuadro "Cómo leer" para deriva y EF |

## Especificidad
Núcleo propio (barra de FC Karvonen, desacoplamiento, EF frente a similares, calor escalado). Capa exterior genérica: tres StatGroups iguales tipo Strava dominan; el veredicto queda en la columna lateral a menor tamaño.
Detector: 0 hallazgos. Grep: slate-400 en las etiquetas del modal (SessionView:461,478,495,516); slate-300 en la tabla de parciales (ActivitySplits:275,289,300); focus-visible ausente en varios botones (SessionView:351,445,542,926; ActivitySplits:469; SessionStreams:86,90,177,189; RouteMap:65); Volver en móvil sin aria-label (:784); valores por defecto en español en t() (ActivitySplits:331-332).

## Problemas prioritarios
- [P0] Esc y las flechas atraviesan el modal (SessionView:382-394 y :657-667). Arreglo: ignorar teclas con isModalOpen; atrapar el foco y devolverlo. Comando: harden.
- [P1] El veredicto queda bajo los totales y la página no lleva a ninguna decisión. Arreglo: frase de veredicto visible, indicadores en la fila principal, totales compactos, bloque final "Siguiente". Comando: layout + clarify.
- [P1] Colores de estado que mienten: flecha de mejora sin delta, EF negativa en rosa sin margen de ruido, "normal" en ámbar, Carrera en ámbar. Comando: colorize (reducir).
- [P1] El móvil tras entrenar no funciona: tramo solo con ratón, parciales solo con hover, explicaciones en title, dos mapas. Comando: adapt.
- [P2] Unidades y textos en inglés (ppm, m/lat, % HR, valores por defecto en español, "Chart", "Grey"). Comando: clarify.

## Personas
Alex: tres GAP sin dueño; dos derivas distintas con casi el mismo nombre; los filtros del modal no vuelven a la tarjeta.
Sam: sin aria-pressed; el modal no atrapa ni devuelve el foco; puntos y columnas sin teclado; texto en slate-300/400.
Corredor en el móvil: el veredicto queda bajo el mapa; no hay parciales la primera vez; no puede elegir tramo; dos mapas; ningún siguiente paso.

## Menores
animate-pulse sin movimiento reducido; carrera sin tarjeta que sustituya a similares; calor a ritmo de competición visible en rodajes; tabla de parciales plegada; cabecera desequilibrada sin mapa ni indicadores.

## Preguntas
1. ¿Qué frase única sobre la sesión, y por qué está en un title?
2. ¿Quién es dueño de la deriva: la cabecera o el tramo?
3. ¿Y si la página terminara en "mañana" en vez de en "clima"?
