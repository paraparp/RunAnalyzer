# Roadmap de funcionalidades — qué le falta a RunAnalyzer

> Auditoría del estado actual (2026-09-06): 47 componentes en `src/components`,
> ~65 módulos en `src/lib`, 30 tools MCP, ingesta Strava + Garmin.
>
> **Conclusión:** el análisis fisiológico ya está por encima de la media del mercado
> (desacoplamiento, GAP muestra a muestra, CS/D′, WBGT, origen de FC, CTL/ATL/TSB).
> Lo que falta no es más ciencia: es **cerrar el bucle** — de dato → decisión → acción
> en el reloj — y las piezas de producto que hoy no existen.

---

## Tier 1 — máximo valor por esfuerzo

### 1. ~~Enviar entrenos al reloj desde la UI~~ ✅ HECHO
**Dependencias nuevas:** ninguna.

`api/_lib/garmin-write.js` ya creaba, editaba y borraba entrenos estructurados en
Garmin, pero **solo lo consumía el MCP**: el [TrainingPlanner](../src/components/TrainingPlanner.jsx)
generaba `structured_workout`, lo pintaba en pantalla y ahí moría.

Implementado:

- [api/_lib/plan-to-garmin.js](../api/_lib/plan-to-garmin.js) — traduce una sesión
  del plan de la IA a la spec de `buildRunningWorkout`: fases → stepType, ritmos y
  FC en texto → objetivos numéricos, `reps` + `recovery` → grupo de repeticiones.
- [api/garmin/workouts.js](../api/garmin/workouts.js) — `GET` lista, `POST {days}`
  crea y agenda hasta 7 sesiones (secuencial, un resultado por día), `DELETE`
  deshace. Identidad por sesión de Supabase; las credenciales de Garmin siguen sin
  salir del servidor.
- [src/lib/planSchedule.js](../src/lib/planSchedule.js) — el día en texto
  ("Miércoles", "Wed") → fecha real del calendario.
- [src/services/garminWorkouts.js](../src/services/garminWorkouts.js) + botones
  "Programar semana en Garmin" y "Enviar al reloj" por sesión en el planner.

Pendiente de comprobar contra una cuenta real (requiere Garmin conectado en la app).

### 2. Vista de detalle de actividad con streams
**Dependencias nuevas:** ninguna (recharts ya está).

Hoy una sesión son splits en una fila expandible de la tabla del dashboard
([ActivitySplits](../src/components/ActivitySplits.jsx)). Falta la pantalla que
cualquiera espera de una app de running:

- FC / ritmo / altitud / cadencia / potencia sincronizados en un gráfico con zoom.
- **Selección de tramo → estadísticas de ese tramo** (ritmo, GAP, FC media, deriva).
- Mapa enlazado al gráfico (hover en el gráfico = punto en el mapa).

Los streams ya se procesan en `src/lib/streamGap.js` y `src/lib/streamProfile.js`:
solo falta la UI.

### 3. Ingesta de ficheros FIT / GPX / TCX
**Dependencias nuevas:** `@garmin/fitsdk` (o `fit-file-parser`) + `@tmcw/togeojson`.

Todo el dato entra por OAuth de Strava y Garmin. Sin esas dos cuentas no entra nada:
ni relojes Coros/Polar/Suunto, ni exports antiguos, ni sesiones de cinta, ni ficheros
que el usuario ya tiene en disco. Un *drop zone* que parsee FIT/GPX/TCX y lo normalice
al mismo shape que `stravaData.activities` abre la app a cualquier fuente.

### 4. PWA + notificaciones
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

### 5. Plan adaptativo diario
Hay readiness, sueño, HRV, Body Battery y TSB… y el plan sigue siendo estático.
Falta el lazo de realimentación: *"hoy tocaban series, tu readiness es 32 → pasa a
rodaje suave"*, y re-planificación automática cuando se fallan sesiones de la semana.

### 6. Estrategia de carrera (race day)
`src/lib/racePrediction.js` y `criticalSpeed.js` dan **el tiempo**; falta el **cómo**:

- Subir el GPX del recorrido objetivo → plan de ritmo km a km ajustado por GAP.
- Previsión de calor (WBGT) el día de la carrera y penalización esperada.
- Fade esperado según el histórico de tiradas largas.
- Pauta de hidratación y geles por hora.

### 7. Progresión sobre el mismo recorrido
`src/lib/routeSimilarity.js` y [GeoZones](../src/components/GeoZones.jsx) ya
identifican recorridos repetidos, pero no existe la vista *"este circuito, 14 veces,
ritmo vs FC en el tiempo"*: el equivalente a los segmentos de Strava, pero con GAP y
eficiencia (m/latido) en lugar de tiempo bruto.

### 8. Fuerza y cross-training dentro de la carga
Casi todas las vistas filtran a `runningActivities`: bici, gym, elíptica y natación
no suman a CTL/ATL, así que el modelo de carga infraestima a cualquiera que haga algo
más que correr. Falta además un registro de sesiones de fuerza (series, peso, RPE).

### 9. Diario de molestias
[InjuryRisk](../src/components/InjuryRisk.jsx) predice a partir de volumen y rampa,
pero sin input subjetivo va ciego a la mitad de la señal. Falta registro diario de
dolor por zona (mapa corporal), RPE de la sesión y ánimo/estrés, alimentando el modelo.

### 10. Peso y composición corporal en la app
El MCP tiene `list_weight` (peso, IMC, % grasa, masa muscular, % agua, en vivo desde
Garmin), pero la app no lo muestra en ninguna pantalla. La correlación
peso ↔ ritmo ↔ eficiencia sale directa de lo que ya se está leyendo.

---

## Tier 3 — producto e infraestructura

| Punto | Estado | Acción |
|---|---|---|
| **CI** | Solo `.github/workflows/sync.yml`. ~40 ficheros de test escritos que nunca corren en PR. | Workflow con `npm run lint` + `npm test`. |
| **TypeScript** | Cero tipos en un proyecto ya grande. `zod` ya está para validar los bordes. | Migración incremental (`allowJs`), empezando por `src/lib`. |
| **`src/App.jsx`** | 1671 líneas haciendo de router, estado global y dashboard a la vez. | Partir en `routes/`, extraer el dashboard y el estado a contexto/hook. |
| **Observabilidad** | Ningún reporte de errores en producción. | Sentry (o similar) en cliente y en las funciones de Vercel. |
| **Compartir informes** | jsPDF exporta a fichero, pero no hay link. | Informe/plan publicable por URL. |
| **Calendario** | `RaceCalendar` es interno. | Suscripción iCal / Google Calendar para carreras y sesiones. |
| **Más fuentes** | Solo Strava + Garmin. | Coros, Polar, Apple Health, import de intervals.icu. |

---

## Si hubiera que elegir tres

**1 (enviar entrenos), 2 (detalle con streams) y 4 (PWA + push).**

El punto 1 es el más barato de todos: endpoint + botón sobre código que ya está
probado contra Garmin end-to-end.
