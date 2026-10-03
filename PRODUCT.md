# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Corredores de cualquier nivel que registran sus entrenamientos en Strava y, muchos, también en un reloj Garmin. Es un producto público: cualquiera puede registrarse con Google y conectar sus cuentas. La portada tiene que convencer a gente que no conoce la app.

Cada atleta solo ve sus propios datos. Hay además un rol de administrador (`useIsAdmin`, `AdminPanel`) para gestionar la plataforma.

## Product Purpose

Convertir los datos crudos de Strava y Garmin en decisiones de entrenamiento: cómo salió una sesión, cómo está el cuerpo hoy, qué toca esta semana y cómo evoluciona la forma a lo largo de los meses. Una IA hace de entrenador (análisis, planes, preguntas libres).

La app funciona bien cuando el atleta entiende qué le dicen sus números y hace algo con ello: ajusta el plan, descansa, cambia de ritmo o manda la sesión al reloj.

## Positioning

Según `docs/ROADMAP_FUNCIONALIDADES.md`, el análisis fisiológico está por encima de lo habitual en el mercado: desacoplamiento cardiaco, GAP calculado muestra a muestra, velocidad crítica y D′, penalización por calor (WBGT) ajustada a la intensidad, origen de la FC (banda o muñeca) y modelo de carga CTL/ATL/TSB calibrado.

Lo que la diferencia es el rigor con los datos y cerrar el ciclo: dato → decisión → acción en el reloj (los entrenos del plan se mandan a Garmin desde la propia app).

## Operating Context

El atleta usa la app en cuatro momentos, todos confirmados:

- **Después de entrenar:** revisar la sesión (parciales, FC, deriva, si se cumplió lo planificado).
- **Por la mañana, antes de entrenar:** ver el estado del día (forma, fatiga, VFC, sueño) y la sesión que toca.
- **Al planificar la semana:** carga, ajuste del plan y envío de entrenos al reloj Garmin.
- **En el análisis a fondo:** tendencias de meses (umbral, forma aeróbica, marcas, predicción de carrera).

Fuera de la app, los mismos datos se pueden consultar desde Claude o ChatGPT a través del servidor MCP (`MCP.md`).

## Capabilities and Constraints

- **Stack:** React 19 + Vite, Tailwind con Tremor y Recharts, Leaflet para mapas. Funciones serverless en Vercel (`api/`), Supabase para identidad y almacenamiento.
- **Datos:** Strava (actividades, streams) y Garmin (FC reposo, VFC, sueño, peso, running dynamics, carga de entrenamiento, escritura de entrenos). Las credenciales de Garmin nunca salen del servidor.
- **IA:** varios proveedores (Anthropic, OpenAI, Google) con selector de modelo.
- **Idiomas:** inglés y español (i18next). El inglés es el idioma por defecto; buena parte del texto y de la documentación interna está en español.
- **Arquitectura de información:** 5 categorías de navegación. Cada número tiene una sola vista que lo muestra (`docs/REESTRUCTURACION_SECCIONES.md`).
- **Terminología:** FC, FCmax, FC reposo, LTHR, zonas de Karvonen y de Seiler, GAP, desacoplamiento, CTL/ATL/TSB, ACWR, VDOT, velocidad crítica (CS/D′), WBGT, VFC, parciales.

## Evidence on Hand

- **Datos reales del atleta**, vía Strava y Garmin: es el contenido principal de la app.
- **Logo:** `public/logo.png`.
- **No hay** cifras de uso, métricas de precisión, valoraciones ni testimonios reales. Las cifras de la portada (2.4K actividades, 98 % de precisión, 4.9 de valoración) y la sección «Lo que dicen los corredores» son relleno. No se deben inventar ni mantener como si fueran reales.

## Product Principles

1. **Honestidad con el dato.** Nunca se presenta un número inventado o de ejemplo como si fuera del atleta o de la app. Si un cálculo tiene límites (resolución del GAP, origen de FC desconocido, datos que no cuadran), se dice.
2. **Del dato a la acción.** Cada análisis debería llevar a una decisión: qué hacer hoy, qué cambiar en el plan o qué mandar al reloj.
3. **Un número, un sitio.** Cada métrica tiene una sola vista dueña; no se duplica entre pantallas.
4. **Rigor sin jerga gratuita.** La ciencia es la ventaja, pero el atleta tiene que entender qué significa cada métrica para él.
