# Roadmap — lo que falta en RunAnalyzer

> Solo lo pendiente. Lo hecho sale de aquí y queda en el historial de git.
>
> Lo que falta no es más ciencia: es **cerrar el bucle** — de dato → decisión → acción
> en el reloj — y las piezas de producto que hoy no existen.

---

## Por verificar contra cuentas reales

- **Enviar entrenos al reloj** (`api/garmin/workouts.js`, botones del TrainingPlanner):
  falta probarlo con Garmin conectado en la app.
- **Peso y composición** (Salud › Peso, `/api/garmin/metrics?kind=weight`): el formato de
  `weight-service/weight/range` no está comprobado con una báscula real.
- **Gráfico de streams** de la vista de sesión: falta probarlo con sesiones reales
  (largas, con pausas, sin GPS, de cinta).
- **Umbral de lactato de Garmin** (`get_lactate_threshold` y la línea de contraste en
  Umbrales): la unidad de `speed` de `biometric-service` se infiere (< 1 → décimas de m/s).
- **Plan adaptativo** (portada + Planificador › Semana real): probar con un plan real
  y una readiness baja, y el envío de la sesión adaptada al reloj.
- **Estrategia de carrera** (Carreras objetivo › Estrategia): GPX de una carrera
  real y la climatología de Open-Meteo para una fecha lejana.
- **Recorridos** (Sesiones › Recorridos): la agrupación con el histórico real
  (umbral de parecido 0.6 de `routeSimilarity`).
- **Diario de molestias** (Carga › Riesgo de lesión): el peso del 25 % en el índice
  y los umbrales de alarma son de práctica clínica, no ajustados.

---

## Tier 1 — máximo valor por esfuerzo

### 1. Ingesta de ficheros FIT / GPX / TCX
**Dependencias nuevas:** `@garmin/fitsdk` (o `fit-file-parser`) + `@tmcw/togeojson`.

Todo el dato entra por OAuth de Strava y Garmin. Sin esas dos cuentas no entra nada:
ni relojes Coros/Polar/Suunto, ni exports antiguos, ni sesiones de cinta, ni ficheros
que el usuario ya tiene en disco. Un *drop zone* que parsee FIT/GPX/TCX y lo normalice
al mismo shape que `stravaData.activities` abre la app a cualquier fuente.

### 2. PWA + notificaciones
**Dependencias nuevas:** `vite-plugin-pwa`, `web-push`.

No hay `manifest.json` ni service worker: el [OfflineBanner](../src/components/OfflineBanner.jsx)
avisa de que no hay red, pero no hay nada cacheado que enseñar. Y la tool
`get_health_alerts` detecta la firma de infección/sobrecarga (Body Battery bajo, o
VFC↓ con FC reposo↑) **sin que nadie se entere** salvo que se pregunte a Claude.

- Instalable en móvil, datos consultables sin conexión.
- Push de alertas: "VFC baja y FC en reposo alta 3 días seguidos".
- Recordatorio del entreno del día.

---

## Tier 2 — funcionalidad que falta de verdad

### 3. Fuerza y cross-training dentro de la carga
Casi todas las vistas filtran a `runningActivities`: bici, gym, elíptica y natación
no suman a CTL/ATL, así que el modelo de carga infraestima a cualquiera que haga algo
más que correr. Falta además un registro de sesiones de fuerza (series, peso, RPE).

---

## MCP

### 4. Nutrición
Diario de calorías/macros de Garmin (o del origen que se use). Esfuerzo medio,
prioridad baja: no bloquea el análisis de carrera.

### 5. Trazar rutas (courses) sobre OSM — `create_garmin_route`
`course-service/course` (POST) con geometría; routing sobre OSM (OSRM/BRouter).
Esfuerzo alto (routing + geometría).

---

## Tier 3 — producto e infraestructura

| Punto | Estado | Acción |
|---|---|---|
| **TypeScript** | Cero tipos en un proyecto ya grande. `zod` ya está para validar los bordes. | Migración incremental (`allowJs`), empezando por `src/lib`. |
| **Observabilidad** | Ningún reporte de errores en producción. | Sentry (o similar) en cliente y en las funciones de Vercel. |
| **Compartir informes** | jsPDF exporta a fichero, pero no hay link. | Informe/plan publicable por URL. |
| **Calendario** | `RaceCalendar` es interno. | Suscripción iCal / Google Calendar para carreras y sesiones. |
| **Más fuentes** | Solo Strava + Garmin. | Coros, Polar, Apple Health, import de intervals.icu. |

---

## Decisiones abiertas

- **¿Mapas es área propia o subsección de Sesiones?** Hoy es subsección ("dónde he
  corrido" es una pregunta sobre el pasado), aunque `GeoZones` aguantaría como área.
- **¿Material es Sesiones o Ajustes?** Hoy en Sesiones: los km por zapatilla se derivan
  del registro. Su override de vida útil es lo único que tira hacia Ajustes.
