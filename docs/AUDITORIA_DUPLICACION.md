# Auditoría de duplicación, código muerto y cálculos

> Documento **vivo**: solo contiene lo que sigue abierto. Los bloques `A`–`F` de la revisión del
> 2026-08-30 (cálculos incorrectos, duplicación viva, ventanas temporales, código muerto,
> cobertura de tests y fórmulas mejorables) quedaron **todos cerrados** y se han borrado de aquí
> tras verificarlos uno a uno contra el código el **2026-08-31**; su registro queda en el
> historial de git (commit `261ca35` y anteriores).
>
> Estado de la suite en la última verificación (**2026-09-06**): **745 tests / 38 ficheros en
> verde**, comprobada además bajo `TZ=America/New_York` (los husos al oeste de Greenwich son los que destapan las
> claves de día en UTC).
>
> Lo que queda abierto es el bloque `G` (menos `G1`–`G5`, `G7` y `G9`, ya cerrados y borrados): varios de aquellos
> arreglos se hicieron en el componente donde se detectó el síntoma y no en sus hermanos, que
> hacen el mismo cálculo con el mismo defecto.

## Índice

| # | Bloque | Impacto | Coste | Estado |
|---|---|---|---|---|
| **G** | [Segunda pasada: arreglos que no llegaron a las vistas hermanas](#g-segunda-pasada-arreglos-que-no-llegaron-a-las-vistas-hermanas) | | | ⬜ Abierto |
| G6 | [`api/_lib` sin tests: solo queda `garmin-helpers`](#g6-apilib-sin-tests-solo-queda-garmin-helpers) | 🟠 Medio | Medio | 🟨 Parcial |
| G8 | [Superficie de export excesiva (heredado del bloque `D`)](#g8-superficie-de-export-excesiva-heredado-de-d) | 🟡 Bajo | Bajo | ⬜ |

---

# G. Segunda pasada: arreglos que no llegaron a las vistas hermanas

> Revisión del **2026-08-31** sobre el árbol de trabajo (112 ficheros: los 106 de la pasada
> anterior más `geoZones`, `routeSimilarity`, `reverseGeocode`, `streamProfile`, `shoeLife` y
> `GeoZones.jsx`). Suite en verde: **657 tests / 32 ficheros**. Los bloques `A`–`F` se han
> comprobado uno a uno contra el código y **todos siguen cerrados**; `G1`–`G5`, `G7` y `G9` también, y por eso
> ya no aparecen aquí (`VitalsOverview` consume `useHrParams` y su panel se titula ya
> "VO₂max submáximo"; `WeeklyProgression` marca la semana en curso como parcial y comparte con
> `InjuryRisk` la regla del 10 % de `src/lib/weeklyVolume.js`; las claves de día y de semana de
> `ConsistencyHeatmap`, `StatusSnapshot`, `VDOTEstimator`, `WeeklyProgression` y `VO2MaxTracker`
> salen ya de `activityDayKey`/`dayKey` + `isoWeek`, y estos resuelven en LOCAL las claves
> "YYYY-MM-DD" que antes reinterpretaban como medianoche UTC; y `activityGapSpeed` es ya el
> punto de entrada único al GAP en `trainingLoad.js`, `HRAnalysis`, `VO2MaxTracker` y la
> tarjeta de cabecera del dashboard, de modo que ninguna vista puede dar dos GAP de la misma
> sesión).
>
> `G7` se cerró el **2026-09-05**: la app y la superficie MCP ya predicen con el MISMO modelo.
> `predictRaces` está expuesta como herramienta `predict_races` (`getRacePrediction` en
> `api/_lib/mcp-store.js` es solo presentación: redondeos, tiempos formateados y cada modelo por
> separado), y `critical_speed` —descripción de la tool y `note` de la respuesta— remite a ella
> para media y maratón, donde el CS a secas es cota inferior y no pronóstico. Cinco casos nuevos
> en `mcp-store.test.js` fijan justo lo que puede volver a divergir: que los tiempos de la tool
> son los de `predictRaces` sobre las mismas actividades, que CS no entra en el maratón, que los
> ritmos salen monótonos, que sin esfuerzos aprovechables hay error explicado y no una predicción
> vacía, y que la ventana pedida se respeta.
>
> `G9` se cerró el **2026-09-05**: los trece tooltips que `CardiacDecoupling`, `FitnessFatigue`,
> `TechniqueAnalysis`, `VDOTEstimator`, `VO2MaxTracker` y `WeeklyProgression` declaraban dentro
> del cuerpo del componente están ya a nivel de módulo (los que necesitaban `t`/`i18n` llaman a
> `useTranslation` por su cuenta en vez de cerrar sobre el del padre), y las dos memoizaciones
> que el compilador no podía preservar dependían del mismo `MONTH_SHORT` recreado en cada
> render: ahora sale de `src/lib/monthLabels.js`, que devuelve la misma referencia por idioma y
> es por tanto estable como dependencia de `useMemo`. De paso desaparece la tercera copia de las
> abreviaturas de mes, la de `FitnessFatigue`, que además estaba sin traducir. El React Compiler
> ya no reporta ningún `Cannot create components during render` ni `Compilation Skipped` en
> `src/`.
>
> El patrón de lo que queda es uno solo, y merece nombrarse: cada arreglo se aplicó **donde se
> detectó el síntoma**, no en todos los sitios que hacen ese cálculo. `B6` unificó las claves de
> semana y dejó las de DÍA (eso era `G3`, ya cerrado); `C` migró las
> ventanas de `lactateThreshold` y dejó cuatro fuera (eso era `G4`, cerrado el 2026-08-31 con
> `activityWithinMonths` y con `daysAgoISO` para las móviles). No son regresiones —nunca
> estuvieron arreglados— pero sí el mismo defecto vivo en la pestaña de al lado, que es
> exactamente lo que estas auditorías vienen cerrando.

## G6. `api/_lib` sin tests: solo queda `garmin-helpers`

**Cerrado el 2026-08-31 para `mcp-store.js`.** `api/_lib/mcp-store.test.js` (46 casos) cubre su
capa propia —la que no heredaba nada de los tests de `src/lib/`— por la puerta pública, sin ampliar
la superficie de export (ver `G8`): `calcPace`, `isRunning`, `shapeSummary`, `filterActivities`,
`summarizeActivities`, `computeDecoupling` y `shapeFull`; `shapeWeather` y `lapConsistency` se
ejercitan a través de `shapeFull`, y `attachGarmin` / `resolveHrSource` a través de `getActivities`
con `@supabase/supabase-js` sustituido por un almacén en memoria.

Lo que queda pinchado es justo el contrato que un LLM lee sin poder verificar: `hr_source` nunca
null (`unknown`/`missing` en vez de null), `hr_source_origin` con sus tres orígenes y la política
`hr_strap_since` en sus dos formas; las dos cifras de calor (tabla vs sesión) y la renormalización
de unidades de las filas viejas del cache; los límites de `from`/`to` como fechas de calendario
—verificados también bajo `TZ=America/New_York`—; y los alias `hr_min`/`hr_max` de
`list_activities`.

**Un defecto destapado al escribirlos**, ya corregido en `filterActivities`: `avg_hr_max` dejaba
pasar las sesiones **sin** FC media, porque `null <= 200` es `true` por coerción. Es decir,
"sesiones con FC media por debajo de X" devolvía también aquellas de las que no se sabe la FC —
mismo patrón que `hr_source: null`: confundir "no lo sé" con "cumple". El filtro por cota inferior
nunca tuvo el problema (`null >= 100` es `false`), así que la asimetría vivía dentro de la misma
función. Ahora, con cualquiera de las dos cotas puesta, una sesión sin FC media queda fuera.

### Lo que sigue abierto

| Módulo | Líneas | Qué alimenta | Tests |
|---|---|---|---|
| `api/_lib/mcp-store.js` | 2.369 | **todas** las herramientas MCP que lee el coach | ✅ 46 casos |
| `api/_lib/garmin-write.js` | 273 | **escribe** entrenos en la cuenta del atleta | ✅ 26 casos |
| `api/_lib/mcp-sync.js` | 618 | el enriquecido y el backlog de streams | ✅ 19 casos |
| `api/_lib/garmin-helpers.js` | 599 | normalización de Garmin, calor, dinámica | ❌ (de rebote, vía `shapeFull`) |

**Cerrado el 2026-09-06 para `garmin-write.js`**, que era el que más pesaba pese a ser el más
corto: es el único que **escribe** en la cuenta del atleta. `api/_lib/garmin-write.test.js` (26
casos) sustituye `getGarminClientFor` por un doble que registra las llamadas y fija justo lo que
solo se veía llegando al reloj: los enums del workout-service (`heart.rate` → `heart.rate.zone`,
no el `heart.rate` a secas que caía a `no.target` y dejaba los objetivos de FC sin efecto), las
unidades (km → metros con `unitKey: 'kilometer'`, min → segundos), la conversión ritmo↔velocidad
en los dos sentidos con el orden `one ≤ two` que exige Garmin, los `stepId` locales a cada build
(el contador global hacía que dos builds concurrentes en el mismo proceso caliente se pisaran los
ids), el anidado de los `repeat`, y las validaciones que deben cortar ANTES de tocar la cuenta
(sin `workout_id`, con `date` que no sea YYYY-MM-DD). Del lado de las operaciones: que un fallo al
agendar no invalida la creación, que sin `workoutId` devuelto no se intenta agendar, que el update
manda el id dentro del cuerpo además de en la URL, que el `limit` se acota a [1, 100], y que el
427 —lanzado o empaquetado en el cuerpo como `{ error: { 'status-code' } }`— se traduce a un
mensaje accionable en vez de pasar por lista vacía. El ida y vuelta `buildRunningWorkout` →
`getWorkout` se prueba sobre la misma spec, que es donde reaparecería la divergencia.

**Cerrado el 2026-09-06 para `mcp-sync.js`.** `api/_lib/mcp-sync.test.js` (19 casos) lo ejercita
por la puerta pública —`ensureFresh`, `runFullSync`, `listSyncableUsers`, sin ampliar exports— con
`user_storage` en un Map, Garmin en un doble y Strava en un router de `fetch`. Fija las tres
garantías que el módulo promete en su cabecera y que hasta ahora nadie comprobaba: que el carril de
request cuesta **0 I/O** cuando no toca (segunda llamada dentro del TTL: ni una lectura, ni una
escritura, ni una petición) y que sin novedades el sondeo no llega a abrir el blob multi-MB; que
**ningún proveedor caído sobrescribe un histórico bueno** (respuesta vacía de Garmin con histórico
guardado, 429/500 de Strava, login de Garmin fallido —que no impide que el pase de Strava guarde lo
suyo—); y que **las mezclas por id no pierden el enriquecido** (`hr_source`, `laps`, `weather` y
`dynamics` previos sobreviven a una respuesta que trae esos campos a null). Además: el corte de
paginación al primer solape, que una actividad sin cambios de resumen no ensucie el blob y una
renombrada sí, que el detalle se pida solo a las carreras nuevas con distancia, la rotación de
token persistida en el blob y en el estado, el lock entre instancias (y su liberación aunque falle
todo), los días de salud calculados desde el último registro en vez de 30 fijos, y el backlog
guardando `flat_efforts` versionado para no volver a pedir esos streams.

**Un defecto destapado al escribirlos**, ya corregido: el blob de Strava tiene **dos formas vivas**
—el objeto `{ activities, tokens… }` de hoy y el ARRAY pelado del formato viejo, que `syncStrava`
sigue aceptando al leer— pero la escritura hacía `{ ...blob, activities }`. Sobre un array eso lo
esparce como `{ "0": …, "1": …, activities }`: una tercera forma que no lee nadie, con el histórico
duplicado dentro. Es alcanzable en cuanto el token viene cacheado en el estado del sync (si no, el
pase aborta antes por `sin-token`, que es justo lo que lo mantenía escondido). Ahora las dos
escrituras normalizan con `asBlobObject`. Mismo patrón que el `avg_hr_max` de `mcp-store`: leer una
forma que luego no se sabe escribir.

Queda `garmin-helpers.js`, cubierto de rebote en su parte de
calor (`normalizeWeatherTemps`, `wbgtFromCelsius`, `heatPenaltyPct`, `heatIntensityFactor`) por los
casos de `shapeFull`, pero no en la normalización de laps ni de dinámica.

En `src/` quedan tres módulos sin test directo: `src/hooks/useHrParams.js` (resuelve FCmax,
FCreposo y LTHR para cinco vistas: es en hooks lo que `hrZones` es en `lib/`; probarlo pide un
renderer de hooks, que hoy no es dependencia del proyecto, o extraer la resolución a una función
pura), `src/lib/streamProfile.js` (cubierto de rebote por `flatEfforts` y `streamGap`) y
`src/lib/cloudStorage.js`.

## G8. Superficie de export excesiva (heredado de `D`)

Los dos últimos párrafos de `D` siguen abiertos y sin cambios: ~30 símbolos exportados con un único
consumidor dentro de su propio módulo, el grueso en `lactateThreshold.js` y `mcp-store.js`. No es
código muerto y no rompe nada hoy; es la puerta por la que vuelve a entrar la divergencia que estas
auditorías cierran. Conviene tratarlo cuando se toque cada módulo, no como tarea propia.

---

# Orden de ataque sugerido

| Paso | Qué | Por qué en ese orden | Coste |
|---|---|---|---|
| 1 | **G6** — lo que queda: la normalización de laps y dinámica de `garmin-helpers`, y `useHrParams` | Sin ellos, el lado servidor se toca a ciegas | Bajo |
| 2 | **G8** | Limpieza, sin prisa: se trata al tocar cada módulo | Bajo |

> Los dos pasos son independientes entre sí: ninguno bloquea a otro.
