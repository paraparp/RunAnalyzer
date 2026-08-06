# RunAnalyzer MCP — Roadmap de paridad (y ventaja) frente a FitMCP

Objetivo: llevar el MCP de RunAnalyzer a cubrir el ~90% de lo usado en análisis de
maratón y, en un par de puntos (origen del sensor y desacoplamiento), **ponerlo
por delante** de cualquier producto existente.

Este documento está pensado para aplicarse **poco a poco**. Cada punto lleva:
qué falta, **dónde se toca** (archivos reales), el **esfuerzo** y una casilla.

> **Progreso (2026-08-06)** — Hecho y verificado todo lo de **cálculo puro** (sin
> ingesta ni Garmin en vivo): quick win `training_load`, **1.2 desacoplamiento**,
> **1.3 GAP por desnivel**, **3.1 CTL/ATL/TSB**, **3.2 detección de test de umbral**,
> **3.3 alertas de patrón** y **3.4 comparador de sesiones**. Nuevas tools MCP:
> `get_training_load_model`, `get_health_alerts`, `detect_threshold_efforts`, y
> `list_activities` acepta `hr_min/hr_max/max_distance_km/flat_only`. `get_activity`
> ahora devuelve `decoupling` y `gap`.
> **Añadido con datos reales de Garmin (dump verificado):** 1.1 origen de FC (`hr_source` strap/wrist + filtro en `list_activities`), 1.4 WBGT y penalización por calor (del weather de Garmin), 2.4 laps reales con `intensity_type`, potencia y balance por lap. Requieren **re-sincronizar Garmin en la app** para poblar los nuevos campos.
>
> **Fase 2 (lectura en vivo):** 2.1 sueño noche a noche (`list_sleep_daily`) y 2.5 peso/composición (`list_weight`) — tools que consultan Garmin en el momento con las credenciales guardadas (no requieren re-sync). Campos exactos de los tipos de la librería.
>
> **Fase 4 (escritura) — decisión tomada:** el MCP usa `garmin_creds` (ya guardadas en `user_storage`) **server-side**; las credenciales nunca salen hacia el cliente/LLM. Sin cifrado extra ni cambios en la app. Tools: `list_garmin_workouts`, `create_garmin_workout` (estructurado, con repeticiones y objetivos), `update_garmin_workout` (mismo id), `delete_garmin_workout`. Constructor de JSON verificado; **falta un smoke test real** (crear un entreno de prueba, verlo en Garmin Connect, borrarlo) por si algún ID de enum necesita ajuste.
>
> Pendiente: 2.2 readiness, 2.3 estado de forma/VO2max/umbral, 2.6 nutrición, 2.7 carreras/planificados (esperando `garmin-fitness-dump.json`), y 4.4 rutas/courses.

---

## Cómo está montado (para no perderte)

El MCP **no habla con Garmin en vivo**. Lee lo que la app ya cacheó en Supabase
(`user_storage`), bajo estas claves:

| Clave `user_storage` | Qué contiene | La escribe |
|---|---|---|
| `stravaData` | actividades Strava (laps, splits, best/flat efforts, polyline) | app / Strava sync |
| `garmin_activities` | actividades Garmin con running dynamics, potencia, training effect | [api/garmin/activities.js](../api/garmin/activities.js) |
| `garmin_cardiac_data` | VFC + FC reposo + Body Battery por día | [api/garmin/health/*](../api/garmin/health/) |
| `garmin_sleep_data` | sueño **semanal** (agregado) | [api/_lib/garmin-helpers.js](../api/_lib/garmin-helpers.js) → `fetchSleepBulk` |

Por eso **cada dato nuevo** casi siempre son 4 pasos (patrón fijo):

1. **Ingesta**: nueva `fetch*` en [api/_lib/garmin-helpers.js](../api/_lib/garmin-helpers.js).
2. **Endpoint + guardado**: la app llama y persiste bajo una clave `user_storage` nueva.
3. **Lectura + shape**: nuevo `get*`/`shape*` en [api/_lib/mcp-store.js](../api/_lib/mcp-store.js).
4. **Tool**: entrada en `TOOLS` y un `case` en `runTool` de [api/mcp.js](../api/mcp.js).

Lo que **NO** sigue ese patrón:
- **Cálculos derivados** (desacoplamiento, CTL/ATL/TSB, detección de test): solo pasos 3–4, sin ingesta nueva. Son los de mejor relación valor/esfuerzo.
- **Escritura** (crear/editar/borrar entrenos, rutas): rompe el modelo read-only. Requiere credenciales Garmin en tiempo de llamada del MCP → decisión de seguridad aparte (ver Fase 4).

---

## Estado actual — lo que YA tienes (no lo reconstruyas)

Antes de añadir nada, ojo con esto, porque en tu lista pedías cosas que **ya están**:

- ✅ **Dinámica de carrera (tu punto 4)**: `normalizeGarminActivity` ya guarda GCT,
  `gct_balance_pct` (equilibrio L/D), oscilación vertical, ratio vertical y zancada.
  Se exponen en `get_activity` y `list_running_dynamics`. **Aquí ya vas por delante
  de FitMCP** — lo único que falta es el balance *por lap* (necesita laps de Garmin, ver #9).
- ✅ **Carga por sesión (tu punto 8)**: `training_load`, `aerobic_te`, `anaerobic_te`
  ya vienen en `a._garmin.training`. *Falta un detalle*: `training_load` no está en la
  fila de `list_running_dynamics` (sí `aerobic_te`/`anaerobic_te`/`vo2max`). Añadirlo es 1 línea.
- ✅ **Potencia de carrera por actividad (tu punto 10)**: `a._garmin.power` (avg/max/norm)
  ya se expone. Falta solo *por lap*.
- ✅ **VO2max de carrera (parte del 7)**: ya viene en `training.vo2max`.
- ✅ **Fases de sueño (parte del 5)**: ya tienes REM/profundo/ligero/despierto… pero
  **semanal**. Falta el desglose **noche a noche** (ver #5).

> Quick win inmediato: añade `training_load` a `shapeDynamicsRow` y a la lista de
> `METRICS` en [api/mcp.js](../api/mcp.js) para que salga en las medias. 2 líneas.

---

## FASE 1 — Los diferenciadores (máximo valor, cero o poca ingesta)

Estos son los que te frenaron de verdad y **casi nadie los expone**.

### 1.1 · Origen del sensor de FC  ⭐ (tu punto 1 — el más importante)
Evita el error de mezclar FC de muñeca con FC de banda.

- **Qué**: `hr_source: "wrist" | "strap" | "unknown"` por actividad, y un bloque
  `data_quality` general (potencia con/sin sensor, GPS mono/doble frecuencia).
- **De dónde**: `device_info` del detalle de actividad Garmin
  (`activity-service/activity/{id}/details` o el `deviceMetaDataDTO` / sensores del FIT).
  El `activitylist-service` que ya usas **no** lo trae → hay que pedir el detalle por actividad.
- **Dónde se toca**:
  - Ingesta: en [garmin-helpers.js](../api/_lib/garmin-helpers.js), extender
    `fetchGarminActivities` para, por cada actividad correr, pedir el detalle y sacar el
    perfil de sensores → `hr_source`. Cuidado con el rate-limit: hazlo solo para carreras y cachea.
  - Shape: añadir `hr_source` y `data_quality` en `normalizeGarminActivity` y exponerlo en
    `shapeFull`/`shapeDynamicsRow` ([mcp-store.js](../api/_lib/mcp-store.js)).
- **Esfuerzo**: medio (ingesta extra por actividad).
- [x] Implementado

### 1.2 · Desacoplamiento / durabilidad  ⭐ (tu punto 2 — mejor predictor de maratón)
**Cálculo puro sobre datos que ya tienes** (`splits_metric` con `average_heartrate` y `average_speed`).

```
ratio_inicial = FC_media(km 5–10) / velocidad_media(km 5–10)
ratio_final   = FC_media(último 25%) / velocidad_media(último 25%)
decoupling_%  = (ratio_final / ratio_inicial − 1) × 100
```

- **Qué**: en `get_activity`, para toda sesión >60 min, devolver `decoupling_pct`
  (+ los dos ratios y la ventana usada). Y una serie por split para ver la evolución.
- **Dónde se toca**: solo [mcp-store.js](../api/_lib/mcp-store.js) → nueva función
  `computeDecoupling(a)` que lea `a.splits_metric`; llamarla en `shapeFull`. Sin ingesta.
- **Esfuerzo**: bajo. **Máxima prioridad** por ratio valor/esfuerzo.
- [x] Implementado

### 1.3 · Ritmo ajustado por desnivel (GAP) agregado  (tu punto 3, parte 1)
Ya tienes `flat_efforts` y `grade_adjusted_speed` en el stream. Falta el **agregado**.

- **Qué**: `gap_pace` (ritmo equivalente en llano) por actividad y por split.
- **Dónde**: [mcp-store.js](../api/_lib/mcp-store.js), derivar de splits + desnivel
  (fórmula de Minetti o el GAP de Strava si está cacheado). Sin ingesta nueva.
- **Esfuerzo**: bajo-medio.
- [x] Implementado

### 1.4 · Ritmo ajustado por calor (WBGT)  (tu punto 3, parte 2)
- **Qué**: `wbgt` y `heat_adjusted_pace` con la penalización estimada.
- **De dónde**: **fuente meteo externa** (Open-Meteo *historical* es gratis y sin API key),
  cruzando el `start_date` + primer punto de la polyline de la actividad.
- **Dónde**: nueva `fetchWeatherForActivity` (helper propio, no Garmin) + cálculo WBGT en
  [mcp-store.js](../api/_lib/mcp-store.js). Cachear el resultado en la actividad para no repetir.
- **Esfuerzo**: medio (integración externa nueva, pero simple).
- [x] Implementado

---

## FASE 2 — Igualar a FitMCP en lectura de salud/forma

### 2.1 · Sueño noche a noche  ⭐ (tu punto 5 — top 5)
Hoy solo tienes semanal. Falta el diario.

- **Qué**: por noche → fases (profundo/REM/ligero/despierto), score, estrés medio nocturno,
  SpO2, frecuencia respiratoria.
- **De dónde**: `client.getSleepData(date)` (ya lo usas parcialmente en `fetchDayData`)
  o `wellness-service/wellness/dailySleepData/{user}?date=`.
- **Dónde**: nueva `fetchSleepDailyBulk` en [garmin-helpers.js](../api/_lib/garmin-helpers.js);
  guardar bajo `garmin_sleep_daily`; `getSleepDaily` + tool `list_sleep_daily` en
  [mcp-store.js](../api/_lib/mcp-store.js) + [api/mcp.js](../api/mcp.js).
- **Esfuerzo**: medio (patrón de 4 pasos completo).
- [x] Implementado

### 2.2 · Training Readiness  (tu punto 6)
- **Qué**: score + nivel diario.
- **De dónde**: `metrics-service/metrics/trainingreadiness/{date}`.
- **Dónde**: patrón 4 pasos → clave `garmin_readiness`, tool `list_training_readiness`.
  Se puede fusionar con `garmin_cardiac_data` (mismo eje: por día) para no crear otra tool.
- **Esfuerzo**: bajo-medio.
- [ ] Implementado

### 2.3 · Métricas de forma Garmin  (tu punto 7)
- **Qué**: VO2max carrera (ya) **y ciclismo**, umbral de lactato estimado, estado de
  entrenamiento (training status), carga aguda/crónica y su ratio.
- **De dónde**: `metrics-service/metrics/maxmet/...`, `training-status`, `lactate-threshold`.
- **Dónde**: patrón 4 pasos → clave `garmin_fitness`, tool `get_fitness_status`.
- **Esfuerzo**: medio.
- [ ] Implementado

### 2.4 · Laps reales de Garmin  ⭐ (tu punto 9 — top 5)
Hoy `get_activity` sirve los laps **de Strava** (sin tipo INTERVAL/REST). Para 4×8′ no valen los splits por km.

- **Qué**: laps tal cual los marcó el reloj, con su `intensity_type` (INTERVAL/REST/ACTIVE),
  FC, ritmo y **potencia por lap** (cierra tu punto 10) y **balance L/D por lap** (cierra el 4).
- **De dónde**: `activity-service/activity/{id}/splits` o `.../laps` de Garmin.
- **Dónde**: ingesta por actividad (junto con 1.1, misma llamada de detalle) → guardar
  `laps_garmin` en cada item de `garmin_activities`; exponer en `shapeFull` sustituyendo/
  complementando los laps de Strava cuando existan.
- **Esfuerzo**: medio (comparte llamada de detalle con #1.1 → hazlos juntos).
- [x] Implementado

### 2.5 · Peso y composición corporal  (tu punto 11)
- **De dónde**: `weight-service/weight/dateRange` o `getBodyComposition`.
- **Dónde**: patrón 4 pasos → clave `garmin_weight`, tool `list_weight`. Útil para vatios/kg.
- **Esfuerzo**: bajo.
- [x] Implementado

### 2.6 · Nutrición  (tu punto 12)
- **De dónde**: diario de calorías/macros de Garmin (o del origen que uses).
- **Esfuerzo**: medio. Prioridad baja (no bloquea análisis de carrera).
- [ ] Implementado

### 2.7 · Carreras/eventos y entrenos planificados  (tus puntos 13 y 14)
- **De dónde**: `calendar-service` (eventos) y `workout-service/workouts` (planificados).
- **Dónde**: dos tools de lectura → `list_races`, `list_planned_workouts`.
- **Esfuerzo**: bajo-medio. **Prerrequisito natural de la Fase 4** (para editar hay que leer primero).
- [ ] Implementado

---

## FASE 3 — Extras que te diferencian (cálculo puro, sin ingesta)

### 3.1 · Modelo de Banister: CTL / ATL / TSB  (tu punto 19)
- **Qué**: carga crónica (CTL, 42 d), aguda (ATL, 7 d), forma (TSB = CTL−ATL) y rampa semanal.
- **De dónde**: serie de `training_load` por actividad (ya la tienes en Garmin) o TRIMP desde FC.
  Medias móviles exponenciales sobre el historial.
- **Dónde**: nueva tool `get_training_load_model` en [mcp.js](../api/mcp.js) + cálculo en
  [mcp-store.js](../api/_lib/mcp-store.js). Sin ingesta.
- **Esfuerzo**: bajo-medio. Alto valor: hoy lo reconstruyes a mano.
- [x] Implementado

### 3.2 · Detección automática de esfuerzos de test  (tu punto 20)
- **Qué**: si una actividad tiene un bloque continuo de 20–40 min por encima del 88% de FCmax,
  márcala como estimación de umbral → devuelve LTHR y ritmo umbral **+ bandera de si la FC se
  estabilizó** (drift bajo). Esa bandera separa test válido de contaminado.
- **De dónde**: splits/laps + FCmax del atleta (ya en `athleteContext`). Idealmente stream de FC.
- **Dónde**: cálculo en [mcp-store.js](../api/_lib/mcp-store.js), exponer en `get_activity`
  o tool dedicada `detect_threshold_efforts`.
- **Esfuerzo**: medio.
- [x] Implementado

### 3.3 · Alertas de patrón (firma de infección)  (tu punto 21)
- **Qué**: Body Battery máx <55 dos noches seguidas, o VFC bajo baseline + FC reposo por
  encima de lo normal → bandera. Con 2 años de historial se adelantó 3 días a episodios.
- **De dónde**: `garmin_cardiac_data` (ya lo tienes) + `baseline` de VFC (ya se guarda).
- **Dónde**: cálculo puro → tool `get_health_alerts`. Sin ingesta.
- **Esfuerzo**: bajo. **Quick win de alto valor.**
- [x] Implementado

### 3.4 · Comparador de sesiones equivalentes  (tu punto 22)
- **Qué**: "todas mis salidas llanas de 10 km con FC entre 142 y 152".
- **Dónde**: ampliar `filterActivities` en [mcp-store.js](../api/_lib/mcp-store.js) con
  `hr_min/hr_max`, `max_distance_km`, `flat_only` (usa `flat_efforts`/desnivel), y exponer
  esos args en el `inputSchema` de `list_activities` en [mcp.js](../api/mcp.js).
- **Esfuerzo**: bajo. Habilita medir progreso de verdad.
- [x] Implementado

---

## FASE 4 — Escritura (lo único que sin FitMCP no puedes hacer)  ⭐

Tus puntos 15–18. **Rompe el modelo read-only actual** y es la decisión de arquitectura
más pesada, por eso va aparte.

### Decisión previa (bloqueante): credenciales
El MCP hoy **nunca** lee `garmin_creds` (está escrito así a propósito, ver [MCP.md](../MCP.md)).
Para escribir en Garmin necesitas credenciales/sesión en el momento de la llamada MCP. Opciones:

1. **Guardar la sesión Garmin cifrada** en `user_storage` y que el MCP la use solo para escribir.
   Requiere: cifrado en reposo, token de sesión Garmin renovable, y aceptar que el MCP deje de
   ser puramente read-only.
2. **Proxy a un endpoint de la app** (`/api/garmin/workout`) que sí tenga las creds, con el MCP
   como mero orquestador. Mantiene las creds fuera del MCP.

> Recomendación: opción **2** (proxy). Menos superficie de riesgo y encaja con
> `/api/garmin/*` que ya existe.

### 4.1 · Crear entreno estructurado en el calendario Garmin  (punto 15)
- **De dónde**: `workout-service/workout` (POST) + `schedule`.
- **Tool**: `create_garmin_workout` (bloques por tiempo/distancia, objetivo de zona/ritmo/potencia).
- [x] Implementado

### 4.2 · Modificar un entreno existente sin duplicarlo  (punto 16)
- **De dónde**: `workout-service/workout/{id}` (PUT). Prerrequisito: `list_planned_workouts` (#2.7).
- **Tool**: `update_garmin_workout`.
- [x] Implementado

### 4.3 · Borrar un entreno  (punto 17)
- **De dónde**: `workout-service/workout/{id}` (DELETE).
- **Tool**: `delete_garmin_workout`.
- [x] Implementado

### 4.4 · Trazar rutas (courses) sobre OSM  (punto 18)
- **De dónde**: `course-service/course` (POST) con geometría; routing sobre OSM (OSRM/BRouter).
- **Tool**: `create_garmin_route`.
- **Esfuerzo**: alto (routing + geometría).
- [ ] Implementado

---

## Secuencia recomendada (tus "5 imprescindibles" primero)

Ordenado por **desbloqueo real / esfuerzo**:

1. **1.2 Desacoplamiento** — cálculo puro, máximo valor, empieza por aquí.
2. **3.3 Alertas de patrón** + **3.4 Comparador** — cálculos puros, quick wins.
3. **1.1 Origen del sensor** + **2.4 Laps reales** — juntos (comparten la llamada de detalle Garmin).
4. **2.1 Sueño noche a noche** — el hueco más grande frente a FitMCP.
5. **Fase 4 (escritura)** — decide primero el modelo de credenciales; es lo único insustituible.

Con 1–4 hechos, RunAnalyzer iguala el 90% de lo usado. Con **1.1 + 1.2** queda **por delante**
de FitMCP en lo que más importa para maratón.

## Deuda mínima ya (2 líneas, hazlo hoy)
- [x] Añadir `training_load` a `shapeDynamicsRow` y al array `METRICS` de [api/mcp.js](../api/mcp.js).
