# Reestructuración de secciones — arquitectura de información

> Auditoría de la navegación a fecha de **2026-09-13**: 19 ítems de menú en 5 categorías,
> 47 componentes. El problema no es el cálculo —eso lo cerró
> [AUDITORIA_DUPLICACION.md](AUDITORIA_DUPLICACION.md), y sigue cerrado: `computeCriticalSpeed`
> delega en `criticalSpeed.js`, `loadCalibration` es único, el GAP tiene un solo punto de entrada—
> sino **dónde se pinta**: hay números con cuatro dueños, ajustes globales escondidos en la cuarta
> subsección de una vista de análisis, y categorías agrupadas por tipo de artefacto ("mapas", "ia")
> en vez de por la pregunta que responden.
>
> **Estado:** fase 1 (reagrupación del menú) aplicada. Fases 2-5 pendientes.

---

## 1. Inventario real

Lo que de verdad contiene cada ítem, no lo que promete su nombre.

### Categoría `analytics` — 7 ítems, el cajón de sastre

| Ítem | Contenido real |
|---|---|
| `dashboard` | Inline en [App.jsx:989-1528](../src/App.jsx#L989). Filtro de año **duplicado** ([:957](../src/App.jsx#L957) en la topbar y [:1001](../src/App.jsx#L1001) en el cuerpo, mismo `selectedYear`) · 6 StatCards (km, nº, tiempo, ritmo, GAP, desnivel) · `NextRaceBanner` · **`AIInsights` entero** (807 líneas, 4 zonas) · `PersonalBests` horizontal · `MonthlyChart` (km/tiempo/desnivel/carga × semana/mes/año) · tabla paginada de actividades con `ActivitySplits` desplegables |
| `status` | [StatusSnapshot.jsx](../src/components/StatusSnapshot.jsx), 1256 l. **Ya es un hub de 4 tabs**: *Estado* (4 hero cards + tabla comparativa ahora/año/histórico de 8 métricas + gráfico CTL/ATL + panel del día + **bloque Garmin de FC reposo / HRV / Body Battery**, [:1025](../src/components/StatusSnapshot.jsx#L1025)), *PMC* → `FitnessFatigue`, *Semanal* → `WeeklyProgression`, *Riesgo Lesión* → `InjuryRisk` |
| `hranalysis` | [HRAnalysis.jsx](../src/components/HRAnalysis.jsx), 1323 l., **5 tabs propios**: *overview* (FC media por sesión + **Volumen Mensual km** + **Carga Acumulada**, [:731-747](../src/components/HRAnalysis.jsx#L731)), *scatter* (FC vs GAP), *drift* (dinámica intra-sesión), *efficiency* (eficiencia cardíaca + ritmo a 150 bpm), *diagnosis* |
| `zones` | [TrainingZones.jsx](../src/components/TrainingZones.jsx). **1. Calibración: los inputs de FCmax / FCreposo / LTHR** ([:230](../src/components/TrainingZones.jsx#L230)) · 2. selector de modelo (`seiler` / `karvonen`) + tabla de zonas · 3. tiempo en zonas · 4. evolución · 5. polarización Seiler |
| `technique` | Un solo gráfico: ritmo vs cadencia, con filtro de llano y de años |
| `consistency` | Heatmap anual por métrica |
| `gear` | Garaje de zapatillas: km por par + vida útil con override manual |

### Categoría `maps` — 3 ítems

`heatmap` (mapa global, 3 modos de color, 3 mapas base) · `gallery` (tarjetas de ruta con tema) ·
`geozones` (1311 l.: KPIs + lista de lugares geocodificados + mapa + tabs temporada/dormidas +
merge y reset de zonas).

### Categoría `ai` — 3 ítems

`planner` (plan IA contra carrera objetivo + push a Garmin) · `predictor` (`predictRaces` + ajuste
del coach + **`NextRaceBanner` otra vez**, [RacePredictor.jsx:177](../src/components/RacePredictor.jsx#L177)
+ comparativa de ritmos) · `qa` (chat; su layout especial obliga a cinco `currentView === 'qa'`
repartidos por `App.jsx`).

### Categoría `performance` — 5 ítems

| Ítem | Contenido real |
|---|---|
| `targets` | Lista / formulario / calendario de carreras objetivo + planes guardados (790 l.) |
| `racehistory` | Carreras detectadas + progresión por distancia |
| `criticalspeed` | Curva mean-max + CS/D′/r² + **predicciones** ([:241](../src/components/CriticalSpeed.jsx#L241)) + esfuerzos usados |
| `fitness` | Hub de 3 tabs: *VDOT* (VDOT + evolución + **ritmos de entrenamiento** + **predicciones**) · *VO2max* (1064 l.: hero + 6 tiles + **historial de FC reposo Garmin** + VO2 submáximo + semanal + **Eficiencia Aeróbica** + ACSM) · *Umbrales* (LT1/LT2 + **bloque Critical Speed completo**, [:215](../src/components/LactateThreshold.jsx#L215) + **ritmos de entrenamiento** + cruce con FC) |
| `health` | Hub de 3 tabs: *Resumen Vital* (6 tiles: HRV, FC reposo, VO2 submáx, carga, eficiencia, desacople) · *Monitor Cardíaco* (2356 l., incluye **el login y el sync de Garmin, el import/export de JSON**, readiness, tendencias cardíacas, índice de adaptación **y la sección de Sueño**) · *Desacople* |

### Categoría `system` — 1 ítem

`export` (DataExporter: filtros, selección de campos, formatos, preview).

---

## 2. Lo que el inventario destapa

### 2.1 Duplicación de presentación

El cálculo está centralizado; lo que está replicado es el **gráfico y el número en pantalla**, y
eso hace que la misma verdad parezca cuatro temas distintos.

| Número | Veces | Dónde |
|---|---|---|
| Eficiencia aeróbica | **4** | `HRAnalysis` *efficiency* · `VitalsOverview:662` · `VO2MaxTracker:934` · `StatusSnapshot:695` |
| FC reposo / HRV histórico | **4** | `StatusSnapshot:1025` · `GarminCardiac:1637` · `VO2MaxTracker:775` · `VitalsOverview:600-615` |
| Deriva / desacople | **4** | `HRAnalysis` *drift* · `CardiacDecoupling` · `VO2MaxTracker` (`driftRatePerHour`) · `VitalsOverview:680` |
| Volumen / carga agregada | **5** | `MonthlyChart` · `HRAnalysis:731-747` · `FitnessFatigue` *weekly_load* · `WeeklyProgression` · `VitalsOverview:647` |
| Curva mean-max + CS | **3** | `CriticalSpeed` · `LactateThreshold:215` · `VO2MaxTracker` (`buildMeanMaxCurve` + `vdotFromCurve`) |
| Predicciones de carrera | **3** | `CriticalSpeed:241` · `VDOTEstimator:444` · `RacePredictor` |
| Ritmos de entrenamiento | **3** | `VDOTEstimator:388` · `LactateThreshold:265` · `TrainingZones` (tabla de zonas) |
| ACWR | **3** | `StatusSnapshot:790` · `FitnessFatigue:568` · `InjuryRisk` |

### 2.2 Colocaciones imposibles

1. **Los inputs de calibración de FC viven dentro de `zones`**
   ([TrainingZones.jsx:230](../src/components/TrainingZones.jsx#L230)), pero mueven el PMC, los
   umbrales, las zonas y el prompt del coach de toda la app a través de `OVERRIDES_EVENT`. Es el
   ajuste más global de la aplicación, escondido en la cuarta subsección de una categoría.
2. **El login y el sync de Garmin viven dentro de `health › Monitor Cardíaco`**, y
   [UserMenu.jsx:240](../src/components/UserMenu.jsx#L240) dice literalmente *"Garmin no conectado ·
   Haz clic para vincular en Salud Cardiaca"*: el menú de configuración manda al usuario a una vista
   de análisis para configurar una conexión.
3. **Dos sistemas de zonas distintos y ambos llamados "polarizado"**: `HRZonesCard` deriva 3 zonas
   de LT1/LT2 (lo que ve el coach IA), `TrainingZones` usa `seilerBounds` desde LTHR o
   `karvonenBounds` desde FCmax/FCreposo. Dan cortes distintos para el mismo concepto.

### 2.3 Ficheros que mezclan temas

`StatusSnapshot` (1256 l.) es un hub con tiles prestados de otras cuatro vistas ·
`GarminCardiac` (2356 l.) mezcla integración, readiness, tendencias cardíacas, adaptación y sueño ·
`HRAnalysis` (1323 l.) mezcla volumen, respuesta cardíaca y eficiencia ·
`VO2MaxTracker` (1064 l.) mezcla VO2, curva mean-max, VDOT, deriva y FC reposo ·
`App.jsx` (89 KB) lleva el dashboard entero inline.

---

## 3. Estructura objetivo

El criterio que sale del inventario: **agrupar por la pregunta que responde, con un horizonte
temporal por área**. La navegación ya es de dos niveles (categoría en el sidebar → ítems en la
topbar, [App.jsx:912-942](../src/App.jsx#L912)), así que esto no necesita UI nueva.

```
HOY             hoy              · una vista: AIInsights (01-04) + NextRaceBanner
                                   + 4 hero cards (CTL/TSB/vol. semanal/mejor ritmo) + readiness
ENTRENAMIENTOS  pasado           · Sesiones (tabla + splits)  · Volumen (MonthlyChart)
                                 · Consistencia  · Mapas (global | galería | lugares)  · Material
CARGA           4-12 semanas     · PMC  · Semanal (regla del 10 %)  · Riesgo de lesión
FISIOLOGÍA      meses            · Umbrales y zonas  · Respuesta cardíaca  · Eficiencia
                                 · VO2max  · Técnica
RENDIMIENTO     qué puedo dar    · Curva y capacidad (mean-max → CS + D′ + VDOT)
                                 · Predicciones  · Marcas  · Carreras
OBJETIVOS       futuro           · Carreras objetivo + calendario  · Plan
SALUD           día a día        · Vitales (HRV / FC reposo / Body Battery)  · Sueño  · Adaptación
```

Fuera del menú de análisis:

- **Chat** (`RunQA`) como panel transversal abrible desde cualquier vista —el gesto ya existe en
  [AIInsights.jsx:184](../src/components/AIInsights.jsx#L184)—, lo que elimina los cinco
  `currentView === 'qa'` del layout.
- **Ajustes** con lo que hoy está disperso: calibración de FC, conexiones Strava/Garmin + sync +
  import/export, exportador de datos, y el modelo de IA e idioma que ya están en `UserMenu`.

## 4. Dueño único por número

Esto es lo que de verdad quita la sensación de mezcla. Extiende al plano de la UI el criterio 1 de
la auditoría ("un cálculo, un punto de entrada"): **un número, una vista dueña**. Las demás lo
enlazan o lo muestran como valor suelto etiquetado, nunca con su propio gráfico.

| Número | Vista dueña | Se borra de |
|---|---|---|
| Volumen y carga agregada | Entrenamientos › Volumen | `HRAnalysis:731-747`, `VitalsOverview:647`, `FitnessFatigue` *weekly_load* |
| CTL / ATL / TSB | Carga › PMC | tiles de Hoy sólo como valor, sin gráfico |
| ACWR | Carga › Riesgo de lesión | `StatusSnapshot:790`, `FitnessFatigue:568` |
| Zonas y umbrales (**un solo modelo**) | Fisiología › Umbrales y zonas | `HRZonesCard` pasa a leer de ahí; VDOT y LT dejan de publicar sus propios ritmos |
| Eficiencia aeróbica | Fisiología › Eficiencia | `VO2MaxTracker:934`, `VitalsOverview`, `HRAnalysis` |
| Deriva / desacople | Fisiología › Respuesta cardíaca | `VO2MaxTracker`, `VitalsOverview`, `CardiacDecoupling` (se fusiona) |
| Curva mean-max, CS, D′, VDOT | Rendimiento › Curva y capacidad | `LactateThreshold:215`, `VO2MaxTracker` |
| Predicciones de carrera | Rendimiento › Predicciones (`predictRaces`) | `CriticalSpeed:241`, `VDOTEstimator:444` |
| HRV / FC reposo / Body Battery | Salud › Vitales | `StatusSnapshot:1025`, `VO2MaxTracker:775`, `GarminCardiac` |
| Marcas personales | Rendimiento › Marcas | dashboard (sólo las últimas, enlazadas) |

---

## 5. Plan por fases

### Fase 1 — reagrupar el menú ✅ HECHO (2026-09-13)

Sólo `NAV_CATEGORIES` en [App.jsx:104](../src/App.jsx#L104) y las claves `nav.categories.*` de
[i18n.js](../src/i18n.js) (en + es). Cero cambios en componentes, cero cambios en rutas —las
categorías no viajan en la URL, el `view` sí—. Las 8 categorías nuevas, en orden temporal:

| Categoría | Ítems |
|---|---|
| `today` Hoy | `dashboard`, `qa` |
| `training` Entrenamientos | `consistency`, `heatmap`, `gallery`, `geozones`, `gear` |
| `load` Carga | `status` |
| `physiology` Fisiología | `zones`, `hranalysis`, `technique`, `fitness` |
| `performance` Rendimiento | `criticalspeed`, `predictor`, `racehistory` |
| `goals` Objetivos | `targets`, `planner` |
| `health` Salud | `health` |
| `settings` Ajustes | `export` |

Dos decisiones de nombre tomadas aquí para evitar que una categoría y su único ítem se llamen casi
igual: la categoría de fisiología se llama **Fisiología** (no "Motor", que choca con el ítem
`fitness` = "Motor Aeróbico") y el ítem `health` pasa a llamarse **Vitales y recuperación**, que es
lo que contiene, dentro de la categoría **Salud**.

`qa` se queda provisionalmente en *Hoy* —es donde lo lanza `AIInsights`— hasta que la fase 2 lo
convierta en panel. `status` es el único ítem de *Carga* hasta que la fase 3 lo parta en tres.

### Fase 2 — sacar lo que no es análisis

- Chat → panel transversal; fuera los cinco `currentView === 'qa'`.
- Calibración de FC y login/sync de Garmin → Ajustes. **Es el paso más rentable de todos**: son los
  dos sitios donde hoy el usuario no puede encontrar lo que busca.

### Fase 3 — partir los ficheros mezclados

Sin reescribir lógica, sólo separando bloques ya existentes:

- `StatusSnapshot` **se disuelve**: hero cards → Hoy · tabla comparativa + gráfico CTL/ATL →
  Carga › PMC · bloque Garmin → Salud › Vitales · sus tabs dejan de ser tabs y pasan a ser ítems.
- `GarminCardiac` → *Sueño* + *Adaptación y tendencias*, con el login/sync fuera (fase 2).
- `HRAnalysis` → *Respuesta cardíaca* + *Eficiencia*; el volumen se tira (ya está en Entrenamientos).
- `VO2MaxTracker` cede curva, VDOT, FC reposo y eficiencia; se queda en VO2.

### Fase 4 — vaciar `App.jsx`

El dashboard sale a `TodayView.jsx` + `ActivityLog.jsx`. `App.jsx` se queda como shell, navegación
y carga de datos.

### Fase 5 — fusionar curva + CS + VDOT

Una vista, una curva, tres lecturas. Es el paso con más código y el que más duplicación mata;
va al final, cuando el sitio donde vive ya existe.

La suite (851 tests / 43 ficheros, en verde tras la fase 1) debe correr entre fase y fase a partir de la 3.

---

## 6. Decisiones abiertas

1. **¿Qué sistema de zonas gana?** Recomendación: el de LT1/LT2 (`HRZonesCard` / el del coach),
   porque es el que ya se usa para prescribir y no depende de estimar LTHR desde FCmax.
   `seilerBounds` / `karvonenBounds` se quedan como vista alternativa dentro de Umbrales, no como
   modelo paralelo.
2. **¿Mapas es área propia o subsección de Entrenamientos?** Aplicado como subsección ("dónde he
   corrido" es una pregunta sobre el pasado), aunque `GeoZones` aguantaría como área por volumen
   (1311 l. con tabs propios).
3. **¿Material es Entrenamientos o Ajustes?** Aplicado en Entrenamientos: los km por zapatilla se
   derivan del registro. Su override de vida útil es lo único que tira hacia Ajustes.
