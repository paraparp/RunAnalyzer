# Reestructuración de secciones — arquitectura de información

> Auditoría de la navegación a fecha de **2026-09-13**: 19 ítems de menú en 5 categorías,
> 47 componentes. El problema no es el cálculo —eso lo cerró
> [AUDITORIA_DUPLICACION.md](AUDITORIA_DUPLICACION.md), y sigue cerrado: `computeCriticalSpeed`
> delega en `criticalSpeed.js`, `loadCalibration` es único, el GAP tiene un solo punto de entrada—
> sino **dónde se pinta**: hay números con cuatro dueños, ajustes globales escondidos en la cuarta
> subsección de una vista de análisis, y categorías agrupadas por tipo de artefacto ("mapas", "ia")
> en vez de por la pregunta que responden.
>
> **Estado (2026-09-19):** **fases 1 a 5 completas**, con la estructura de 8 categorías de la
> primera pasada revisada a 5 el mismo día (fase 1b, §5). **Pendientes**: las dos que salieron de la
> segunda revisión (§6) — el scope temporal único (fase 6) y la vista de sesión (fase 7) — y las
> filas de §2.1 que siguen abiertas: volumen agregado, desacople y ritmos de entrenamiento.

---

## 1. Inventario real

Lo que de verdad contiene cada ítem, no lo que promete su nombre.

### Categoría `analytics` — 7 ítems, el cajón de sastre

| Ítem | Contenido real |
|---|---|
| `dashboard` | Inline en [App.jsx:989-1528](../src/App.jsx#L989). Filtro de año **duplicado** ([:957](../src/App.jsx#L957) en la topbar y [:1001](../src/App.jsx#L1001) en el cuerpo, mismo `selectedYear`) · 6 StatCards (km, nº, tiempo, ritmo, GAP, desnivel) · `NextRaceBanner` · **`AIInsights` entero** (807 líneas, 4 zonas) · `PersonalBests` horizontal · `MonthlyChart` (km/tiempo/desnivel/carga × semana/mes/año) · tabla paginada de actividades con `ActivitySplits` desplegables |
| `status` | ~~`StatusSnapshot.jsx`, 1256 l.~~ **disuelto en la fase 3a**. Era un hub de 4 tabs: *Estado* (4 hero cards + tabla comparativa ahora/año/histórico de 8 métricas + gráfico CTL/ATL + panel del día + **bloque Garmin de FC reposo / HRV / Body Battery**, en el tab Estado), *PMC* → `FitnessFatigue`, *Semanal* → `WeeklyProgression`, *Riesgo Lesión* → `InjuryRisk` |
| `hranalysis` | [HRAnalysis.jsx](../src/components/HRAnalysis.jsx), 1323 l., **5 tabs propios**: *overview* (FC media por sesión + **Volumen Mensual km** + **Carga Acumulada**, [:731-747](../src/components/HRAnalysis.jsx#L731)), *scatter* (FC vs GAP), *drift* (dinámica intra-sesión), *efficiency* (eficiencia cardíaca + ritmo a 150 bpm), *diagnosis* |
| `zones` | [TrainingZones.jsx](../src/components/TrainingZones.jsx). ~~**1. Calibración: los inputs de FCmax / FCreposo / LTHR**~~ (movidos a Ajustes en la fase 2; queda en solo lectura) · 2. selector de modelo (`seiler` / `karvonen`) + tabla de zonas · 3. tiempo en zonas · 4. evolución · 5. polarización Seiler |
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
| `health` | Hub de 3 tabs: *Resumen Vital* (6 tiles: HRV, FC reposo, VO2 submáx, carga, eficiencia, desacople) · *Monitor Cardíaco* (2356 l., incluye ~~**el login y el sync de Garmin, el import/export de JSON**~~ (movidos a Ajustes en la fase 2), readiness, tendencias cardíacas, índice de adaptación **y la sección de Sueño**) · *Desacople* |

### Categoría `system` — 1 ítem

`export` (DataExporter: filtros, selección de campos, formatos, preview).

---

## 2. Lo que el inventario destapa

### 2.1 Duplicación de presentación

El cálculo está centralizado; lo que estaba replicado era el **gráfico y el número en pantalla**, y
eso hacía que la misma verdad pareciera cuatro temas distintos.

La columna **Estado** es el recuento *verificado contra el código* a 2026-09-19, no el de la
auditoría de partida: las fases 3 a 5 fueron cerrando filas.

| Número | Sitios | Estado |
|---|---|---|
| Predicciones de carrera | 3 → **1** ✅ | Dueño: `RacePredictor`. Fuera las tablas de `CriticalSpeed` y `VDOTEstimator` (fase 5) |
| Curva mean-max en pantalla | 3 → **1** ✅ | Dueño: *Capacidad* (`CriticalSpeed`). `LactateThreshold` conserva el cálculo pero ya no pinta la curva (fase 5); `VO2MaxTracker` la usa para anclar el VO2, no la dibuja |
| FC reposo / HRV histórico | 4 → **2** ✅ | Dueño: *Vitales* (`VitalsOverview`). `GarminCardiac` mantiene sus *Tendencias cardíacas*, que es otra lectura (correlación y adaptación). Fuera `StatusSnapshot` (3b) y `VO2MaxTracker` (3c) |
| Eficiencia aeróbica | 4 → **2** ✅ | `HRAnalysis` *efficiency* (dueño) y el tile de `VitalsOverview`. Fuera `VO2MaxTracker` (3c) y `StatusSnapshot` (3b) |
| ACWR | 3 → **2** ✅ | `InjuryRisk` (dueño) y la tarjeta de estado de `FitnessFatigue`. Fuera `StatusSnapshot` (3a/3b) |
| Volumen / carga agregada | 5 → **4** ⚠️ | Sigue abierto: `ActivityLog` (`MonthlyChart`), `FitnessFatigue` *weekly_load*, `WeeklyProgression` y el tile *carga acumulada* de `VitalsOverview`. Solo se cerró `HRAnalysis` (3c) |
| Deriva / desacople | 4 → **3** ⚠️ | Sigue abierto: `HRAnalysis` *drift*, `CardiacDecoupling` y el tile de `VitalsOverview`. `VO2MaxTracker` usa `driftRatePerHour` para **corregir** el VO2, que es un uso legítimo, no una cuarta pantalla |
| Ritmos de entrenamiento | **3** ⚠️ | Abierto a propósito: Daniels (`VDOTEstimator`), LT1/LT2 (`LactateThreshold`) y la tabla de zonas (`TrainingZones`). Son tres sistemas de prescripción, y cuál gana es la decisión 1 de §7 |

### 2.2 Colocaciones imposibles

1. **Los inputs de calibración de FC viven dentro de `zones`**
   ([TrainingZones.jsx:230](../src/components/TrainingZones.jsx#L230)), pero mueven el PMC, los
   umbrales, las zonas y el prompt del coach de toda la app a través de `OVERRIDES_EVENT`. Es el
   ajuste más global de la aplicación, escondido en la cuarta subsección de una categoría.
   **✅ Resuelto en la fase 2**: los inputs viven en Ajustes › Calibración FC y Zonas los muestra en
   solo lectura.
2. **El login y el sync de Garmin viven dentro de `health › Monitor Cardíaco`**, y
   [UserMenu.jsx:240](../src/components/UserMenu.jsx#L240) dice literalmente *"Garmin no conectado ·
   Haz clic para vincular en Salud Cardiaca"*: el menú de configuración manda al usuario a una vista
   de análisis para configurar una conexión.
   **✅ Resuelto en la fase 2**: la conexión es de Ajustes › Conexiones y el chip del menú lleva ahí.
3. **Dos sistemas de zonas distintos y ambos llamados "polarizado"**: `HRZonesCard` deriva 3 zonas
   de LT1/LT2 (lo que ve el coach IA), `TrainingZones` usa `seilerBounds` desde LTHR o
   `karvonenBounds` desde FCmax/FCreposo. Dan cortes distintos para el mismo concepto.

### 2.3 Ficheros que mezclan temas

`StatusSnapshot` (1256 l.) es un hub con tiles prestados de otras cuatro vistas ·
`GarminCardiac` (2356 l.) mezcla integración, readiness, tendencias cardíacas, adaptación y sueño ·
`HRAnalysis` (1323 l.) mezcla volumen, respuesta cardíaca y eficiencia ·
`VO2MaxTracker` (1064 l.) mezcla VO2, curva mean-max, VDOT, deriva y FC reposo ·
~~`App.jsx` (89 KB) lleva el dashboard entero inline.~~ (fase 4)

---

## 3. Estructura objetivo

El criterio que sale del inventario: **agrupar por la pregunta que responde**, con un horizonte
temporal por área y **ninguna área con un solo ítem**. La navegación ya es de dos niveles (categoría
en el sidebar → ítems en la topbar, [App.jsx](../src/App.jsx)), así que esto no necesita UI nueva.

```
HOY          hoy            · una vista: AIInsights (01-04) + próxima carrera
                              + 4 hero cards (CTL/TSB/vol. semanal/mejor ritmo) + readiness
SESIONES     pasado         · Bitácora (tabla + filtros)  · Detalle de sesión*
                            · Volumen  · Mapas (global | galería | lugares)  · Material
CARGA        4-12 semanas   · PMC  · Semanal (regla del 10 %)  · Consistencia  · Riesgo de lesión
MOTOR        meses          · Capacidad   (curva mean-max → CS + D′, VDOT, VO2max, umbrales y zonas)
                            · Adaptación  (eficiencia, desacople, FC a ritmo fijo, técnica, vitales)
COMPETICIÓN  futuro/pasado  · Carrera objetivo + calendario  · Plan  · Predicciones
                            · Marcas e historial
─────────────
AJUSTES                     · Calibración FC  · Conexiones  · Exportar
CHAT                        · panel transversal, no sección

* vista nueva: hoy no existe (§6.2)
```

Los dos cortes que deshacen las fronteras discutibles de la primera pasada: **las predicciones y el
historial son de Competición** —hablan de correr una carrera, no de fisiología— y **el motor no se
parte en "fisiología" y "rendimiento"** sino en *capacidad* (el techo de hoy) y *adaptación* (cómo
responde en el tiempo), que es el corte que los datos sí soportan: CS, VDOT y VO2max son lo mismo
medido de tres maneras, y eficiencia, desacople y FC a ritmo fijo son tendencias, no techos.

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

Sólo `NAV_CATEGORIES` en [App.jsx](../src/App.jsx) y las claves `nav.categories.*` de
[i18n.js](../src/i18n.js) (en + es). Cero cambios en componentes, cero cambios en rutas —las
categorías no viajan en la URL, el `view` sí—.

La primera pasada hizo 8 categorías en orden temporal. Al usarla salieron tres defectos, y **las
tres los arregla la misma revisión**:

1. **Dos categorías con un solo ítem** (*Carga* → `status`, *Salud* → `health`). Una categoría que
   al abrirse da una sola cosa es un clic de peaje, no jerarquía.
2. **Los nombres prometían una lógica que los componentes aún no cumplen**: *Hoy* contenía el
   dashboard, que es KPIs + IA + marcas + gráfico + tabla paginada. Se renombraron las estanterías
   antes de mover los libros.
3. **La frontera Fisiología / Rendimiento era del desarrollador, no del atleta**: CS, VDOT y VO2max
   caían a ambos lados (de ahí que hubiera que partir el hub `fitness`), y *Fisiología* con 5
   subsecciones volvía a ser un cajón.

### Fase 1b — bajar a 5 áreas ✅ HECHO (2026-09-13)

| Categoría | Ítems |
|---|---|
| `today` Hoy | `dashboard` |
| `sessions` Sesiones | `heatmap`, `gallery`, `geozones`, `gear` → con la fase 4: `log` primero |
| `load` Carga | tras las fases 3a/3b: `pmc`, `weekly`, `injury`, `consistency` |
| `engine` Motor | `criticalspeed`, `fitness`, `zones` · `hranalysis`, `technique`, `health` |
| `racing` Competición | `targets`, `planner`, `predictor`, `racehistory` |
| `settings` Ajustes | `calibration`, `connections`, `export` |

Las dos fronteras se resuelven a propósito: **las predicciones y el historial son de Competición**
(hablan de correr una carrera, no de fisiología) y **todo lo que mide el motor vive junto**, ordenado
por los dos ejes en los que las fases 3-5 lo van a fundir: *capacidad* (el techo: curva → CS/D′,
VDOT, VO2max, umbrales) y *adaptación* (la tendencia: respuesta cardíaca, técnica, vitales). *Salud*
desaparece como área: el readiness del día es de Hoy y sus tendencias son adaptación.

Dos renombrados para que ninguna categoría compita con su propio ítem: el ítem `fitness` pasa de
"Motor Aeróbico" a **Capacidad Aeróbica** (que es lo que contiene: VDOT, VO2max y umbrales) y el
ítem `health`, ya renombrado en la fase 1, se queda como **Vitales y Recuperación**.

*Sesiones* todavía no tiene la bitácora ni el volumen: viven dentro del dashboard hasta la fase 4.
*Hoy* queda con un solo ítem **a propósito** —es la portada, la entrada del sidebar ES la vista—, y
la sub-navegación de la topbar ya no se pinta cuando la categoría tiene un solo ítem: con una sola
pestaña no hay nada que elegir.

### Fase 2 — sacar lo que no es análisis ✅ HECHO (2026-09-13)

**Ajustes ✅ HECHO (2026-09-13).** Ajustes pasa de una categoría con un solo ítem a tres, y las dos
colocaciones imposibles de §2.2 desaparecen:

- **Ajustes › Calibración FC** — [HrCalibration.jsx](../src/components/HrCalibration.jsx), los
  inputs de FCmax / FCreposo / LTHR extraídos de la vista de Zonas. `TrainingZones` conserva un
  bloque de **solo lectura** con los tres valores, su origen (manual / detectado / Garmin) y un
  botón a Ajustes: sigue diciendo con qué está calibrado lo que pinta, pero ya no es quien lo edita.
- **Ajustes › Conexiones** — [Connections.jsx](../src/components/Connections.jsx): estado de Strava
  y, de Garmin, el formulario de vinculación, el sync con período, el import/export del JSON y la
  desconexión. La lógica vive en [useGarminConnection.js](../src/hooks/useGarminConnection.js), un
  hook nuevo que es el dueño único de la conexión y que reaprovecha `garminHealthStore` (la misma
  mezcla, la misma marca de `garmin_last_sync`) que usa el sync global de `syncAll`.
- **`GarminCardiac` pasa de 2353 a 1898 líneas** y solo LEE lo guardado: sin credenciales, sin
  fetch, sin import/export. Sin datos enseña un estado vacío que lleva a Conexiones; con datos, un
  botón *Gestionar conexión*. Se repinta con `SYNC_COMPLETE_EVENT`, que ahora también emite la
  escritura manual y la desconexión (antes solo `syncAll`), y de ahí que el listener ya no guarde el
  valor nuevo antes de aplicarlo: al desconectar, `null` es exactamente lo que hay que reflejar.
- El chip de Garmin del menú de usuario, cuando **no** está conectado, lleva a Ajustes › Conexiones
  en vez de a una pantalla de métricas.
- Humo nuevo de las dos vistas en
  [SettingsViews.test.jsx](../src/components/SettingsViews.test.jsx) (6 casos): los tres números
  resueltos y sus derivados, manual vs detectado, fuera de rango que no contamina el resuelto, y los
  dos estados de cada conexión. Suite en verde: **883 tests / 46 ficheros**.

**Chat ✅ HECHO (2026-09-13).** `RunQA` deja de ser una sección y pasa a panel transversal:
lanzador flotante, panel lateral y la conversación viva mientras no se recargue. Preguntar se hace
DESDE donde estés —mirando el PMC, un entreno, una predicción—, no yéndote a otro sitio; como ítem
del menú obligaba a abandonar justo la vista sobre la que ibas a preguntar.

- Fuera los cuatro `currentView === 'qa'` del shell: el `<main>` y su contenedor vuelven a tener un
  solo layout en vez de uno especial para el chat.
- El panel se monta al abrirlo y se **oculta** al cerrar, así la conversación sobrevive a cerrarlo.
  `chatSeedKey` lo remonta cuando llega semilla nueva desde `AIInsights`, que es lo que relanza la
  lectura de `runqa_seed` —un `useEffect` de montaje— y con ella el "Ampliar en el chat".
- `/qa` estaba en la URL y puede estar en un marcador: ahora abre el panel y limpia la ruta, en vez
  de caer en silencio al dashboard.

### Fase 3 — partir los ficheros mezclados ✅ HECHO (3a/3b: 2026-09-13 · 3c: 2026-09-19)

Sin reescribir lógica, sólo separando bloques ya existentes.

**3a — `StatusSnapshot` se disuelve ✅ HECHO (2026-09-13).** El fichero de 1256 líneas que era a la
vez hub de cuatro pestañas, dueño de dos cálculos y de tres vistas **ya no existe**:

| Sale a | Qué se lleva |
|---|---|
| [lib/statusStats.js](../src/lib/statusStats.js) | `computeStats` y `computeGarminStats`, puros, con **`now` inyectable** |
| [StatusCards.jsx](../src/components/StatusCards.jsx) | los átomos compartidos: `PhaseBanner`, `HeroCard`, `MiniSparkline`, `PctPill`, `RangeSelector` |
| [StatusHero.jsx](../src/components/StatusHero.jsx) → **Hoy** | la fase + los 4 números de "¿cómo voy?": fitness, forma, volumen semanal y mejor ritmo reciente |
| [StatusOverview.jsx](../src/components/StatusOverview.jsx) → **Carga › Mi Estado** | la comparativa ahora/año/histórico, el PMC día a día con zonas de pico y panel del día, y las tendencias de Garmin |
| ítems del menú | *PMC*, *Semanal* y *Riesgo de Lesión* dejan de ser pestañas escondidas y son tres entradas de Carga |

Dos cosas que el corte destapó y que van más allá de mover bloques:

- **El reloj se inyecta.** Los dos cálculos leían `new Date()` por su cuenta, y las ventanas de
  7/28/365 días son justo el corazón de lo que calculan: no se podían fijar en un test ni eran
  estables entre repintados. Ahora `now` es un parámetro, y de ahí salen los
  [15 tests](../src/lib/statusStats.test.js) que esta matemática **no tenía** — incluido uno que
  comprueba que mover el "ahora" mete y saca la misma sesión de la ventana de 7 días.
- **`allActivities` se memoiza** en `App.jsx` por el mismo motivo que `runningActivities`: el modelo
  de carga consume todos los deportes, y una identidad nueva por render le hacía recalcular el PMC
  entero en cada repintado. Los tres ítems nuevos reciben **todas** las actividades, que es lo que
  recibían dentro de `StatusSnapshot`: pasarles sólo running les habría quitado la carga de la bici
  del CTL/ATL/ACWR sin decirlo.

**Lo que el corte rompió, y el guardia que lo tapa.** `StatusCards.jsx` salió sin el import de
`Card`/`Text` de Tremor y reventó al renderizar. Ni el lint ni `vite build` lo vieron, y el motivo
importa: **`no-undef` no mira los nombres de las etiquetas JSX**, así que un `<Card>` sin importar
es válido para los dos. Arreglado con el import, y con dos guardias para que la clase entera de
error no vuelva a llegar al navegador:

- [eslint.config.js](../eslint.config.js) activa `react/jsx-no-undef` (probado: con el import roto a
  propósito, el lint lo señala).
- [StatusViews.test.jsx](../src/components/StatusViews.test.jsx) monta las dos vistas con datos de
  verdad y el PMC mockeado — 5 casos que cubren justo lo que el lint no puede ver: que el árbol
  entero se pinta.

*Mi Estado* quedó como zona de paso, y la fase 3b la vació.

**3b — fundir lo que quedó duplicado ✅ HECHO (2026-09-19).** *Mi Estado* **ya no existe**: cada
uno de sus tres bloques se fue con su dueño, y lo que se conservó es sólo lo que el dueño no tenía.

| Bloque | Dueño | Qué se portó / qué se tiró |
|---|---|---|
| Gráfico CTL/ATL | [FitnessFatigue.jsx](../src/components/FitnessFatigue.jsx) | **Portado**: las franjas y líneas de pico (histórico y del año) y el **panel del día fijado** al pinchar la carga diaria, con enlace a Strava. **Tirado**: el gráfico entero — el dueño ya tenía tres paneles sincronizados (CTL/ATL, carga, TSB con zonas) con rango y paginación. |
| Tarjetas + gráfico de Garmin | [VitalsOverview.jsx](../src/components/VitalsOverview.jsx) | **Portado**: las medias de 7/28 días y los récords histórico y del año de FC reposo y recuperación (`computeGarminStats`), que es contra lo que se compara el valor de hoy. **Tirado**: el gráfico de doble eje — era el mismo dato que los paneles de VFC y FC reposo, con otro color y sin suavizado. |
| Comparativa ahora/año/histórico | [StatusHero.jsx](../src/components/StatusHero.jsx) → **Hoy** | Entera, dentro de un `CollapsibleSection` **plegado**: la portada contesta "¿cómo voy?" con los cuatro números de arriba, y esto es para cuando quieres saber respecto a qué. Tremor desmonta el cuerpo mientras está plegado, así que la portada no paga ni el render ni los sparklines de una tabla que nadie ha abierto. |

El pico de CTL se calcula sobre la serie **completa**, no sobre el rango visible: el máximo
histórico no puede cambiar porque estés mirando los últimos tres meses.

Carga queda en **PMC · Semanal · Riesgo · Consistencia**, y el ítem `status` desaparece del menú y
de las traducciones.

**3c — el resto de los ficheros mezclados ✅ HECHO (2026-09-19).** Aquí lo que había que hacer era
sobre todo **borrar**, no mover: los bloques ya tenían dueño en otra vista.

| Fichero | Qué sale | A dónde |
|---|---|---|
| `HRAnalysis` 1323 → **1240** | *Volumen Mensual (km)* y *Carga Acumulada* — con su `monthlyMap`, su `monthlyVolume` y su tooltip | **Borrados**: el volumen es del gráfico de Sesiones y la carga, del PMC |
| `VO2MaxTracker` 1064 → **948** | *Historial de FC Reposo (Garmin)* y *Eficiencia Aeróbica*, con sus dos cálculos | **Borrados**: FC reposo es de Salud › Vitales y la eficiencia, de la pestaña de Eficiencia |
| `GarminCardiac` 1898 → **1713** | la sección de sueño entera | **Movida** a [GarminSleep.jsx](../src/components/GarminSleep.jsx), nueva pestaña *Sueño* de Salud |

`GarminSleep` lee del almacén y se repinta con `SYNC_COMPLETE_EVENT`, igual que sus hermanas desde
la fase 2, y enseña a dónde ir cuando no hay datos (Ajustes › Conexiones) en vez de quedarse vacía.

**`react/jsx-no-undef` se ganó el sueldo a la primera**: al mover el sueño, `StatCard` se quedó en
el fichero de origen y el lint lo marcó en las cuatro etiquetas antes de tocar el navegador. Es
exactamente el error que en la fase 3a llegó a producción.

**Lo que NO se hizo, y por qué.** El plan pedía además partir `HRAnalysis` en dos vistas de menú
(*Respuesta cardíaca* y *Eficiencia*). Sus cinco pestañas ya separan bien los temas y funcionan;
convertirlas en dos entradas de menú añade un clic sin añadir claridad. Se queda como una vista con
pestañas, y §2.1 pierde igualmente sus filas de volumen y eficiencia.

### Fase 4 — vaciar `App.jsx` ✅ HECHO (2026-09-19)

`App.jsx` pasa de **1585 a 741 líneas** y vuelve a ser lo que dice su nombre: shell, navegación,
carga de datos y el panel del chat.

| Sale a | Qué se lleva |
|---|---|
| [TodayView.jsx](../src/components/TodayView.jsx) (74 l.) → **Hoy** | carrera objetivo, `StatusHero`, `TodayBalance`, el análisis de la IA y las marcas |
| [ActivityLog.jsx](../src/components/ActivityLog.jsx) (821 l.) → **Sesiones › Bitácora** | filtros de año y deporte, los seis totales del período, el gráfico de volumen y la tabla con parciales — con su estado (orden, búsqueda, rangos, paginación, filas abiertas) y sus derivaciones |

Con esto *Sesiones* deja de ser "mapas y zapatillas" y tiene por fin su listado, que es lo que la
fase 1b dejó pendiente.

Dos cambios de comportamiento que van con la mudanza:

- **El filtro de año sale de la barra superior.** Estaba en el shell de TODA la app pero solo
  gobernaba el dashboard (aparecía y desaparecía con `currentView === 'dashboard'`, y encima
  duplicado con el selector móvil del cuerpo). Ahora vive dentro de la bitácora, que es lo único que
  filtra.
- **Las marcas de Hoy son de todo el histórico.** Antes colgaban de ese filtro de año: con el
  selector puesto en 2024, "marcas personales" enseñaba las marcas de 2024. Un récord personal es
  histórico por definición; la vista filtrable es la bitácora.

`TodayView` va en el bundle inicial (es la portada) y `ActivityLog` bajo demanda, como el resto de
vistas secundarias.

### Fase 5 — fusionar curva + CS + VDOT ✅ HECHO (2026-09-19)

Una curva, tres lecturas, y las predicciones con un solo dueño.

- **[CriticalSpeed.jsx](../src/components/CriticalSpeed.jsx) pasa a llamarse *Capacidad*** y añade
  el **VDOT sacado de la MISMA curva** que ya construía (`vdotFromCurve` sobre sus propios puntos
  mean-max, con el esfuerzo que lo ancla como pista). Ya no se recalcula la curva en otra vista con
  otra ventana: CS y D′ describen la asíntota y la reserva, el VDOT pone ese mismo esfuerzo en una
  escala comparable entre corredores.
- **Las predicciones de carrera tienen un dueño: Competición › Predicciones** (`predictRaces`, que
  usa toda la evidencia y no sólo un modelo). Fuera la tabla de `CriticalSpeed` y la de
  `VDOTEstimator`: de **tres** sitios a **uno**.
- **`LactateThreshold` deja de repetir el gráfico de CS**. Su cálculo se queda —de ahí salen sus
  ritmos y el contraste con la FC— pero el gráfico entero se sustituye por una línea con el número
  y un puntero a Capacidad. De **tres** curvas mean-max en pantalla a **una**.
- El hub de VDOT pasa a llamarse **Ritmos Daniels**, que es lo que le queda y lo que de verdad
  aporta: la prescripción de Daniels.

**Lo que NO se borró, y por qué.** Los ritmos de Daniels conviven con los de LT1/LT2 de Umbrales.
Son dos sistemas de prescripción distintos, no el mismo número dos veces, y la decisión 1 de §7
—cuál gana— sigue abierta: borrar uno de los dos es una decisión de método, no de arquitectura de
información. Los dos siguen ahí, cada uno en su vista, y ninguno predice carreras.

| Fichero | Antes | Después |
|---|---|---|
| `CriticalSpeed` | 312 | **265** |
| `LactateThreshold` | 397 | **330** |
| `VDOTEstimator` | 499 | **464** |

### Fase 6 — un solo scope temporal ⏳ PENDIENTE

Sustituir los **18 controles de período** de §6.1 por un control compartido con un vocabulario y un
default coherente. Es, de todo lo que queda, lo que más cambia la sensación de que la app está
descosida.

### Fase 7 — vista de sesión ⏳ PENDIENTE

`/activity/:id`: los parciales con su zona, el desacople y la eficiencia de ESA sesión, el GAP, el
clima y la comparación con sesiones similares. Hoy no existe (§6.2).

La suite (930 tests / 51 ficheros, en verde tras la fase 4) debe correr entre fase y fase a partir de la 3.

---

## 6. Segunda revisión: lo que pesa más que el menú

Reagrupar era la parte barata. Al recorrer las vistas ya colocadas salieron tres problemas que
ninguna reagrupación arregla, y que explican mejor la sensación de incoherencia: el tiempo se mide
con seis varas distintas, la pregunta más frecuente no tiene página, y ninguna área concluye nada.

### 6.1 Dieciocho controles de período, seis vocabularios

| Vocabulario | Dónde |
|---|---|
| meses como string `'6'` / `'12'` | `CardiacDecoupling:50`, `LactateThreshold:35`, `VO2MaxTracker:324`, `WeeklyProgression:42`, `FitnessFatigue:134` (+ `offsetMonths`) |
| días `'365'` | `CriticalSpeed:40` (`windowId`) |
| etiquetas `90d/6m/1y/all` | `StatusSnapshot:557` |
| `'all'` | `VDOTEstimator:106` |
| año natural | `App:350`, `ConsistencyHeatmap:35`, `HRAnalysis:139`, `TechniqueAnalysis:84` (`pickedYears`) |
| últimas N sesiones | `HRAnalysis:138` (`lastNRuns`) |
| granularidad `day/week/month/year` | `VitalsOverview:336`, `GarminCardiac:244`, `StatusSnapshot:561`, `TrainingZones:89`, `App:150` |

Y los **defaults no coinciden**: el desacople mira 6 meses, el VO2max 12, la velocidad crítica 365
días, el PMC 12 meses, Mi Estado 90 días y el VDOT todo el histórico. El mismo atleta recibe dos
veredictos distintos sobre el mismo cuerpo según la pestaña en la que esté, y nada en pantalla lo
avisa. Es el mismo error que §2.1 pero en el eje del tiempo: no es que se pinte dos veces, es que se
pinta sobre ventanas distintas sin decirlo.

### 6.2 No hay vista de sesión

La ruta es `/:view?/:raceId?` y el único detalle de una actividad es la fila que se despliega en la
tabla del dashboard (`ActivitySplits`). La pregunta más frecuente de un corredor —*¿qué pasó en este
entreno?*— no tiene página: hay que cruzar a mano la tabla, Zonas, Desacople y Eficiencia. Es el
hueco más grande de la app, y es de contenido, no de navegación.

### 6.3 Cada vista da gráficos, no conclusiones

`AIInsights` concluye, pero sólo para hoy. En Carga o en Motor el veredicto lo tiene que sacar el
usuario cruzando cuatro pestañas. Una frase de estado por área —derivada, no generada— valdría más
que varios gráficos nuevos.

---

## 7. Decisiones abiertas

1. ~~**¿Qué sistema de zonas gana?**~~ **Resuelto: Karvonen** (2026-09-19). Es el único modelo de
   zonas de la app: `seilerBounds` ya no existe y la vista de Zonas perdió su selector de modelo
   —dos modelos elegibles significaba que los mismos kilómetros salían Z2 o Z3 según el botón
   pulsado—. La lectura polarizada **no se pierde**: sale de agrupar las cinco zonas
   (`lib/zoneMix` › `polarizedGroups`, Z1+Z2 fácil / Z3 gris / Z4+Z5 duro), así que el veredicto
   80/20 y el modelo de zonas dejan de ser dos cálculos distintos.
   **También el coach** (2026-09-19): `athleteContext` daba al prompt 3 zonas propias derivadas de
   LT1/LT2 y `HRZonesCard` las pintaba, así que "Z2" significaba una cosa en el consejo y otra en la
   app. Las dos leen ahora `karvonenBounds`, y la distribución de intensidad del prompt la cuenta
   `zoneMix` —parcial a parcial— en vez de clasificar cada sesión entera por su FC media contra
   ratios de LTHR. LT1 y LT2 siguen en el contexto como **anclas de ritmo**, que es lo que de verdad
   prescriben. `coachCoherenceWarnings` valida contra el mismo techo (fin de Z2) que recibe el coach.
2. **¿Mapas es área propia o subsección de Sesiones?** Aplicado como subsección ("dónde he corrido"
   es una pregunta sobre el pasado), aunque `GeoZones` aguantaría como área por volumen (1311 l. con
   tabs propios).
3. **¿Material es Sesiones o Ajustes?** Aplicado en Sesiones: los km por zapatilla se derivan del
   registro. Su override de vida útil es lo único que tira hacia Ajustes.
4. **¿Cuál es el scope temporal por defecto?** La fase 6 necesita elegir uno —y justificarlo— para
   las ventanas que hoy van de 90 días a "todo el histórico" (§6.1).
