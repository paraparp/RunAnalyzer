# Auditoría de duplicación, código muerto y cálculos

> Documento **vivo**: solo contiene lo que sigue abierto. Los bloques `A`–`F` de la revisión del
> 2026-08-30 (cálculos incorrectos, duplicación viva, ventanas temporales, código muerto,
> cobertura de tests y fórmulas mejorables) quedaron **todos cerrados** y se han borrado de aquí
> tras verificarlos uno a uno contra el código el **2026-08-31**; su registro queda en el
> historial de git (commit `261ca35` y anteriores).
>
> Estado de la suite en la última verificación: **634 tests / 30 ficheros en verde**, comprobada
> además bajo `TZ=America/New_York` (los husos al oeste de Greenwich son los que destapan las
> claves de día en UTC).
>
> Lo que queda abierto es el bloque `G` (menos `G1`, `G2`, `G3`, `G4` y `G5`, ya cerrados y borrados): varios de aquellos
> arreglos se hicieron en el componente donde se detectó el síntoma y no en sus hermanos, que
> hacen el mismo cálculo con el mismo defecto.

## Índice

| # | Bloque | Impacto | Coste | Estado |
|---|---|---|---|---|
| **G** | [Segunda pasada: arreglos que no llegaron a las vistas hermanas](#g-segunda-pasada-arreglos-que-no-llegaron-a-las-vistas-hermanas) | | | ⬜ Abierto |
| G6 | [`api/_lib` sin tests: cerrado en `mcp-store`, abierto en el resto](#g6-apilib-sin-tests-cerrado-en-mcp-store-abierto-en-el-resto) | 🟠 Medio | Medio | 🟨 Parcial |
| G7 | [La superficie MCP y la app no predicen con el mismo modelo](#g7-la-superficie-mcp-y-la-app-no-predicen-con-el-mismo-modelo) | 🟡 Bajo | Bajo | ⬜ |
| G8 | [Superficie de export excesiva (heredado del bloque `D`)](#g8-superficie-de-export-excesiva-heredado-de-d) | 🟡 Bajo | Bajo | ⬜ |
| G9 | [Componentes definidos dentro del render (destapado al cerrar `G4`)](#g9-componentes-definidos-dentro-del-render-destapado-al-cerrar-g4) | 🟡 Bajo | Bajo | ⬜ |

---

# G. Segunda pasada: arreglos que no llegaron a las vistas hermanas

> Revisión del **2026-08-31** sobre el árbol de trabajo (112 ficheros: los 106 de la pasada
> anterior más `geoZones`, `routeSimilarity`, `reverseGeocode`, `streamProfile`, `shoeLife` y
> `GeoZones.jsx`). Suite en verde: **634 tests / 30 ficheros**. Los bloques `A`–`F` se han
> comprobado uno a uno contra el código y **todos siguen cerrados**; `G1`, `G2`, `G3`, `G4` y `G5` también, y por eso
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
> El patrón de lo que queda es uno solo, y merece nombrarse: cada arreglo se aplicó **donde se
> detectó el síntoma**, no en todos los sitios que hacen ese cálculo. `B6` unificó las claves de
> semana y dejó las de DÍA (eso era `G3`, ya cerrado); `C` migró las
> ventanas de `lactateThreshold` y dejó cuatro fuera (eso era `G4`, cerrado el 2026-08-31 con
> `activityWithinMonths` y con `daysAgoISO` para las móviles). No son regresiones —nunca
> estuvieron arreglados— pero sí el mismo defecto vivo en la pestaña de al lado, que es
> exactamente lo que estas auditorías vienen cerrando.

## G6. `api/_lib` sin tests: cerrado en `mcp-store`, abierto en el resto

**Cerrado el 2026-08-31 para `mcp-store.js`.** `api/_lib/mcp-store.test.js` (41 casos) cubre su
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
| `api/_lib/mcp-store.js` | 2.138 | **todas** las herramientas MCP que lee el coach | ✅ 41 casos |
| `api/_lib/mcp-sync.js` | 612 | el enriquecido y el backlog de streams | ❌ |
| `api/_lib/garmin-helpers.js` | 577 | normalización de Garmin, calor, dinámica | ❌ (de rebote, vía `shapeFull`) |
| `api/_lib/garmin-write.js` | 273 | **escribe** entrenos en la cuenta del atleta | ❌ |

De los tres, `garmin-write.js` es el que más pesa pese a ser el más corto: es el único que
**escribe** en la cuenta del atleta. `garmin-helpers.js` queda cubierto de rebote en su parte de
calor (`normalizeWeatherTemps`, `wbgtFromCelsius`, `heatPenaltyPct`, `heatIntensityFactor`) por los
casos de `shapeFull`, pero no en la normalización de laps ni de dinámica.

En `src/` quedan tres módulos sin test directo: `src/hooks/useHrParams.js` (resuelve FCmax,
FCreposo y LTHR para cinco vistas: es en hooks lo que `hrZones` es en `lib/`; probarlo pide un
renderer de hooks, que hoy no es dependencia del proyecto, o extraer la resolución a una función
pura), `src/lib/streamProfile.js` (cubierto de rebote por `flatEfforts` y `streamGap`) y
`src/lib/cloudStorage.js`.

## G7. La superficie MCP y la app no predicen con el mismo modelo

`F1` dejó `predictRaces` (`src/lib/racePrediction.js`) como predictor de la app: media de VDOT,
CS/D′ dentro de su ventana y Riegel individualizado, con monotonía impuesta. La herramienta
`critical_speed` del MCP (`api/_lib/mcp-store.js:2090`) sigue publicando las predicciones del
modelo de CS **a secas** —con su aviso de cota inferior, eso sí— y `predictRaces` no está expuesta
como herramienta.

Consecuencia práctica: a "¿qué maratón puedo hacer?" la app responde con el ensemble y el coach por
MCP con el CS, que es el más optimista de los tres y el que el propio `racePrediction` descarta a
esa distancia. La bandera y el `caveat` avisan, pero el aviso no evita que sean dos números.
Lo barato es exponer `predictRaces` como herramienta; lo mínimo, que el texto de `critical_speed`
remita a ella para maratón y media.

## G8. Superficie de export excesiva (heredado de `D`)

Los dos últimos párrafos de `D` siguen abiertos y sin cambios: ~30 símbolos exportados con un único
consumidor dentro de su propio módulo, el grueso en `lactateThreshold.js` y `mcp-store.js`. No es
código muerto y no rompe nada hoy; es la puerta por la que vuelve a entrar la divergencia que estas
auditorías cierran. Conviene tratarlo cuando se toque cada módulo, no como tarea propia.

---

## G9. Componentes definidos dentro del render (destapado al cerrar `G4`)

Al quitar los `Date.now()` de los `useMemo` de `CardiacDecoupling`, `WeeklyProgression`,
`VO2MaxTracker` y `HRAnalysis`, el React Compiler dejó de abortar en el primer
`Cannot call impure function during render` y llegó hasta el final del fichero. Lo de detrás no
lo introdujo `G4` —estaba tapado por ese bailout—: seis `Cannot create components during render`
(los tooltips de Recharts se declaran como funciones dentro del cuerpo del componente, así que
son un tipo nuevo en cada render y el subárbol se remonta entero) y dos
`Compilation Skipped: Existing memoization could not be preserved`.

No cambia ningún número ni rompe nada visible: es coste de render y memoización perdida. Se
arregla sacando cada tooltip fuera del componente. Mismo criterio que `G8`: cuando se toque
cada vista.

---

# Orden de ataque sugerido

| Paso | Qué | Por qué en ese orden | Coste |
|---|---|---|---|
| 1 | **G6** — lo que queda: `garmin-write` (escribe en la cuenta), `mcp-sync` y `useHrParams` | Sin ellos, el lado servidor se toca a ciegas | Medio |
| 2 | **G7**, **G8**, **G9** | Limpieza y coherencia entre superficies, sin prisa | Bajo |

> Los dos pasos son independientes entre sí: ninguno bloquea a otro.
