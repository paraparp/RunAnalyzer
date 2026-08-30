# Auditoría de duplicación, código muerto y cálculos

> Revisión completa del 2026-08-30 sobre 106 archivos (~32.400 líneas de `src/` + `api/`).
> Sustituye a la auditoría anterior, cuyos bloques quedaron todos cerrados y verificados:
> `computeCriticalSpeed` (`src/lib/lactateThreshold.js:134`) delega ya en `criticalSpeed.js`,
> y la deriva cardíaca vive en `src/lib/decoupling.js`, consumida por `CardiacDecoupling`,
> `VitalsOverview` y —desde ayer— `api/_lib/mcp-store.js:376`.
>
> Esta pasada busca lo que aquella no cubría: **cálculos que están mal o que engañan**, no solo
> código repetido. Todos los números de línea están comprobados a esta fecha. Suite en verde:
> 176 tests / 13 ficheros.
>
> ## Estado de la remediación (2026-08-30)
>
> Los números de línea de los bloques ya cerrados son los de **antes** del arreglo y se conservan
> como registro de qué había; el estado real de cada uno va marcado en su propio encabezado.
>
> **Tanda 1** (build en verde, 182 tests): `A2`, `A3`, `A4`, `A5`, `A6`, `A7`, `A8` (la parte del
> ACSM), `D` completo, y las porciones baratas de `B2`, `B5` y `B6`.
>
> **Tanda 2** (build en verde, **254 tests / 16 ficheros**): `E` en sus dos módulos prioritarios
> (`hrZones` y `physiology`, 47 tests nuevos), `B2` + `F6` completos, y `B1` completo con
> `src/lib/efficiencyFactor.js` como fuente única (25 tests).
>
> **Sigue abierto**: `A1`, `A8` (procedencia de la mezcla y confianza inflada), `B3`, `B4`,
> el resto de `B5`/`B6`, `C`, el resto de `E` (`athleteContext`, `raceDistances`, `planFormat`,
> `garminActivitiesSync`) y el resto de `F`.

## Índice

| # | Bloque | Impacto | Coste | Estado |
|---|---|---|---|---|
| **A** | [Cálculos incorrectos o que engañan](#a-cálculos-incorrectos-o-que-engañan) | | | |
| A1 | [El VO2max mide la intensidad de la sesión, no la forma](#a1-el-vo2max-mide-la-intensidad-de-la-sesión-no-la-forma) | 🔴 Alto | Medio | ⬜ Abierto |
| A2 | [Una cuarta FCmax y una tercera FCreposo, solo en VO2max](#a2-una-cuarta-fcmax-y-una-tercera-fcreposo-solo-en-la-pestaña-vo2max) | 🔴 Alto | Bajo | ✅ Arreglado |
| A3 | [`pace150`: extrapolación proporcional sin ordenada](#a3-pace150-extrapola-por-regla-de-tres-cuando-la-recta-no-pasa-por-el-origen) | 🟠 Medio | Bajo | ✅ Arreglado |
| A4 | [El sparkline de "Km última semana" pinta TSS/1000](#a4-el-sparkline-de-km-última-semana-pinta-tss1000-siempre-0) | 🟠 Medio | Trivial | ✅ Arreglado |
| A5 | [`strain` con umbrales de otra escala: factor muerto](#a5-strain-usa-umbrales-de-foster-sobre-una-escala-tss-el-factor-no-dispara-nunca) | 🟠 Medio | Bajo | ✅ Arreglado |
| A6 | [Progresión de volumen: semana en curso vs semana completa](#a6-la-progresión-de-volumen-compara-una-semana-a-medias-con-una-completa) | 🟠 Medio | Bajo | ✅ Arreglado |
| A7 | [Bug `m:60` en nueve formateadores inline](#a7-bug-m60-en-nueve-formateadores-de-ritmo-inline) | 🟡 Bajo | Trivial | ✅ Arreglado |
| A8 | [ACSM alimentado con desnivel acumulado](#a8-la-ecuación-acsm-recibe-desnivel-acumulado-donde-espera-pendiente-neta) | 🟡 Bajo | Trivial | 🟨 Parcial |
| **B** | [Duplicación viva](#b-duplicación-viva) | | | |
| B1 | [Efficiency Factor en 5 sitios con 3 convenciones](#b1-efficiency-factor-cinco-sitios-tres-unidades-y-un-signo-invertido) | 🟠 Medio | Medio | ✅ Arreglado |
| B2 | [Dos estimadores de FCreposo que contradicen la política declarada](#b2-dos-estimadores-de-fcreposo-que-contradicen-la-política-escrita-en-hrzonesjs) | 🟠 Medio | Bajo | ✅ Arreglado |
| B3 | [Dos umbrales de FC en dos pestañas](#b3-dos-umbrales-de-frecuencia-cardiaca-en-dos-pestañas) | 🟠 Medio | Medio | ⬜ Abierto |
| B4 | [Cuarta implementación de deriva en `lactateThreshold`](#b4-queda-una-cuarta-implementación-de-deriva-en-lactatethreshold) | 🟡 Bajo | Bajo | ⬜ Abierto |
| B5 | [Catorce formateadores de tiempo/ritmo inline](#b5-catorce-formateadores-inline-con-timeformatjs-ya-escrito) | 🟡 Bajo | Bajo | 🟨 Parcial |
| B6 | [`isoWeekKey` y `dayKey` reimplementados](#b6-isoweekkey-y-daykey-reimplementados-en-ocho-sitios) | 🟡 Bajo | Bajo | 🟨 Parcial |
| **C** | [Ventanas temporales y zona horaria](#c-ventanas-temporales-y-zona-horaria) | 🟡 Bajo | Bajo | ⬜ Abierto |
| **D** | [Código muerto](#d-código-muerto) | 🟡 Bajo | Trivial | ✅ Arreglado |
| **E** | [Cobertura de tests](#e-cobertura-de-tests) | 🟠 Medio | Medio | 🟨 Parcial |
| **F** | [Fórmulas mejorables](#f-fórmulas-mejorables) | | | ⬜ Abierto |

---

# A. Cálculos incorrectos o que engañan

## A1. El VO2max mide la intensidad de la sesión, no la forma

`src/components/VO2MaxTracker.jsx:190` estima un VO2max **para cada carrera de ≥10 min con FC** y
luego promedia con media recortada, EWMA y pesos de confianza (`:386-420`). El problema no es el
suavizado: es que el estimador es sistemáticamente sensible a la intensidad de la sesión.

Mismo atleta (FCmax 190, FCrep 50), mismo día, por la vía HRR de `physiology.js`:

| Sesión | Ritmo | FC media | %HRR | VO2max estimado |
|---|---|---|---|---|
| Rodaje suave | 5:03/km | 130 | 0,57 | **68,6** |
| Tempo | 3:58/km | 172 | 0,87 | **59,0** |

**16 % de diferencia, y el rodaje suave sale más alto.** Un bloque de base con mucho rodaje hace
*subir* la curva; una semana de series la hace *bajar*. La media recortada trata esa dispersión
como ruido de medida cuando es señal — de otra cosa.

`vo2maxFromHRR` (`src/lib/physiology.js:66`) acota a 35–95 % HRR, que con esos parámetros son
99 ppm: no filtra nada. El corte útil sería 70–88 % HRR, la banda donde %HRR ≈ %VO2R aguanta
(Swain-Leutholtz), y aun así la vía por FC es la peor de las tres disponibles en el repo.

**Qué hacer.** La app ya construye la curva mean-max de mejores esfuerzos (`buildMeanMaxCurve`,
`src/lib/criticalSpeed.js:82`) y ya invierte Daniels-Gilbert (`VDOTEstimator.calculateVDOT:26`).
El VO2max debe anclarse en **rendimiento**, que es lo que hace el sistema VDOT y lo que hacen
Garmin/Firstbeat. Dos salidas:

1. **Mínimo**: restringir la estimación por FC a 70–88 % HRR y renombrar la serie a "VO2max
   submáximo (proxy de eficiencia)", que es lo que realmente es.
2. **Recomendado**: pasar la cifra de cabecera a VDOT sobre la curva mean-max y dejar la serie por
   FC como métrica secundaria. Hoy *VDOT* y *VO2max* son dos pestañas del mismo hub
   (`FitnessHub.jsx:10-12`) que dan dos números distintos de lo mismo, y el bueno es el de VDOT.

## A2. Una cuarta FCmax y una tercera FCreposo, solo en la pestaña VO2max

> ✅ **ARREGLADO.** `VO2MaxTracker` importa `detectMaxHR` / `detectRestHR` / `DEFAULT_REST_HR`
> de `hrZones.js`. Borrados: el bloque del "tercer máximo", el estimador local `estimateRestHR`
> (regresión + 0,32 × FCmax), las constantes `garminMaxHR` / `garminOfficialVO2` y sus ramas
> muertas, incluido el bloque JSX "Perfil Garmin" que nunca se pintaba. La FC en reposo pasa por
> la vía única: Garmin si hay medición, `DEFAULT_REST_HR` si no.

`src/lib/hrZones.js:34` `detectMaxHR` es la fuente única declarada: **mediana del 5 % superior**,
filtro 140–215. La usan zonas, modelo de lactato, PMC y el prompt del coach.

`src/components/VO2MaxTracker.jsx:333` no la llama:

```js
const detectedMaxHRFromSession = sortedMaxHR.length > 3 ? sortedMaxHR[2] : (sortedMaxHR[0] || 190);
```

**Tercer valor más alto**, filtro 100–220. Con histórico largo, la mediana del top 5 % y el tercer
máximo se separan con facilidad 4–8 ppm; y el VO2max va como `1/%HRR`, así que 5 ppm de FCmax
mueven el resultado ~2 unidades. Es la razón mecánica de que esta pestaña no cuadre con las demás.

Lo mismo con la FC en reposo (`:153`, ver B2) y, de propina, dos constantes muertas con sus ramas
muertas:

```js
const garminMaxHR = null;        // :318
const garminOfficialVO2 = null;  // :319
const activeMaxHR = garminMaxHR || detectedMaxHRFromSession;  // el `||` nunca se evalúa
```

**Arreglo**: `import { detectMaxHR, detectRestHR } from '../lib/hrZones'` y borrar los tres bloques
locales. Es la corrección más barata de la lista y la que más incoherencia visible elimina.

## A3. `pace150` extrapola por regla de tres cuando la recta no pasa por el origen

> ✅ **ARREGLADO.** `HRAnalysis` consume `useHrParams(activities)` y escala sobre la reserva:
> `avgSpeed * (150 - hrrest) / (avgHr - hrrest)`, descartando la sesión si alguno de los dos
> términos no es positivo. `hrrest` entra en las dependencias del `useMemo`.

`src/components/HRAnalysis.jsx:360`:

```js
const speed150 = avgSpeed * (150 / avgHr);
```

Esto asume que la velocidad es **proporcional** a la FC, es decir que a 0 ppm se corre a 0 m/s. La
relación real tiene ordenada: a velocidad cero la FC es la de reposo, no cero. La forma correcta
escala sobre la **reserva** (HRR):

```js
const speed150 = avgSpeed * (150 - hrRest) / (avgHr - hrRest);
```

Con FCrep 50, una carrera a 3,70 m/s y 160 ppm:

| Método | Velocidad a 150 ppm | Ritmo |
|---|---|---|
| Actual (proporcional) | 3,47 m/s | 4:48/km |
| Sobre HRR | 3,36 m/s | 4:57/km |

**9 s/km de sesgo**, y crece cuanto más lejos de 150 esté la FC media de la sesión. Como el sesgo
depende de la FC de cada carrera, contamina la *tendencia*, que es justo lo que la gráfica dice
seguir ("forma aeróbica sin deriva cardíaca"). La FCreposo ya está disponible en la vista vía
`useHrParams` / `detectRestHR`.

## A4. El sparkline de "Km última semana" pinta TSS/1000 (siempre 0)

> ✅ **ARREGLADO.** `volSparkData` suma la distancia real de las actividades de carrera adjuntas
> a cada día de la serie del PMC (`d.activities`, filtradas con `isRun`) y la pasa a km. El
> no-op `* (1/0.5) … * 0.5` desaparece con él.

`src/components/StatusSnapshot.jsx:581`:

```js
const km = slice.reduce((s, d) => s + d.load, 0) * (1 / 0.5) / 1000 * 0.5; // rough km proxy
```

Dos cosas:

- `* (1/0.5) … * 0.5` **es un no-op**: multiplica por 2 y divide por 2. Sobra desde que `load` dejó
  de ser `(min/60)*0.5` y pasó a ser TSS.
- Lo que queda es `Σ TSS / 1000`. Una semana normal son 300–700 TSS → 0,3–0,7 → `Math.round` →
  **0 o 1**. El sparkline de la fila "Km (última semana)" es una línea plana de ceros junto a una
  cifra correcta (`last7daysKm`, que sí sale de la distancia real).

**Arreglo**: sumar los kilómetros reales por semana desde `p.activities` de la serie del PMC, que
ya vienen adjuntos (`trainingLoad.js:364`).

## A5. `strain` usa umbrales de Foster sobre una escala TSS: el factor no dispara nunca

> ✅ **ARREGLADO.** Umbrales recalibrados a **1000 / 1500 / 2200** en `InjuryRisk.jsx`, con el
> porqué escrito al lado. Corregida además la afirmación falsa de la cabecera de
> `trainingLoad.js`: ya no dice que "strain > 3000" esté calibrado para la escala TSS, sino que
> esos umbrales eran los de Foster sobre session-RPE y que si se toca la escala hay que revisarlos.
> Pendiente (opcional, no trivial): normalizar el *strain* por el CTL del atleta.

`src/components/InjuryRisk.jsx:101-105`:

```js
const strain = weeklyLoadTotal * monotony;
if (strain > 3000) strainRisk = 70;
else if (strain > 2000) strainRisk = 40;
else if (strain > 1000) strainRisk = 15;
```

La monotonía y el *strain* de Foster están definidos sobre carga **session-RPE** (RPE 1–10 ×
minutos), donde una semana vale 1.500–4.000 UA. Aquí `weeklyLoadTotal` es **TSS** (100 = 1 h a
umbral): una semana seria son 300–700. Con monotonía típica 1,0–2,0 el *strain* sale 300–1.400, así
que el tramo `>3000` es inalcanzable y `>2000` casi. El factor aporta como mucho 15 × 0,15 =
**2,25 puntos sobre 100** al índice compuesto: es peso muerto.

La cabecera de `src/lib/trainingLoad.js:13-14` afirma que los umbrales de la UI —citando
literalmente "strain > 3000 en InjuryRisk"— están calibrados para la escala TSS. **Esa afirmación
es incorrecta**, y conviene corregirla junto con el código: es la que justifica no haber revisado
los umbrales al cambiar el modelo de carga.

La **monotonía** (`:92`) sí sobrevive el cambio de escala: es un cociente media/desviación, luego
adimensional. Sus umbrales (1,5 / 2,0) siguen valiendo.

**Arreglo**: recalibrar a ~1.000 / 1.500 / 2.200, o —mejor— normalizar el *strain* por el CTL del
atleta para que no dependa de su volumen absoluto.

## A6. La progresión de volumen compara una semana a medias con una completa

> ✅ **ARREGLADO.** `InjuryRisk` descarta la semana en curso (`weekKeys.filter(k => k < isoWeekKey(dayKey(new Date())))`)
> y compara las dos últimas semanas **cerradas**. El indicador y la "regla del 10 %" que se pinta
> al lado dejan de ser ruido de lunes a sábado.

`src/components/InjuryRisk.jsx:62-70`: `lastWeekKey` es la **semana en curso**, casi siempre
incompleta.

```js
const lastWeekKey = weekKeys[weekKeys.length - 1];   // semana EN CURSO
const weeklyChange = prevWeekKm > 0 ? ((lastWeekKm - prevWeekKm) / prevWeekKm) * 100 : 0;
```

Un martes con 12 km hechos frente a una semana anterior de 50 km da −76 %, y la vista lo publica
como "Volumen: −76 %" con `volumeRisk = 15` ("bajada brusca"). El indicador solo es legible los
domingos por la noche; el resto de la semana, la "regla del 10 %" que se muestra al lado es ruido.

**Arreglo**: comparar las dos últimas semanas **cerradas**, o proyectar la semana en curso por días
transcurridos y etiquetarla como parcial.

## A7. Bug `m:60` en nueve formateadores de ritmo inline

> ✅ **ARREGLADO.** Los nueve sitios usan ya `formatPaceFromMinPerKm` (o `formatPaceFromSpeed` en
> `RouteGallery`, que partía de m/s). Sobre la decisión pendiente de `PACE_LIMITS`: en la UI se
> hereda el comportamiento de la función compartida (`--:--` fuera de banda), que es el deseado;
> en `TrainingPlanner`, que alimenta el prompt, se pasa `null` como *fallback* para que un ritmo
> imposible no viaje al modelo como `--:--`. `athleteContext` sigue sin migrar (ver B5).

El patrón `Math.round((p - Math.floor(p)) * 60)` devuelve **60** cuando la parte fraccionaria supera
0,9917, produciendo ritmos como `4:60`:

| Archivo | Líneas |
|---|---|
| `src/components/TrainingPlanner.jsx` | 100 |
| `src/components/RouteGallery.jsx` | 163 |
| `src/components/TechniqueAnalysis.jsx` | 71, 107, 204 |
| `src/components/FitnessFatigue.jsx` | 254, 521 |
| `src/components/HRAnalysis.jsx` | 365, 1157 |

`src/lib/timeFormat.js:80-85` ya lo resuelve (`if (s === 60) { m += 1; s = 0; }`) y
`src/lib/athleteContext.js:12` **documenta el bug… en su propia reimplementación paralela**. El
arreglo es sustituir los nueve sitios por `formatPaceFromMinPerKm` (ver B5).

Una diferencia real a decidir al migrar: la función compartida aplica `PACE_LIMITS` (2–30 min/km) y
devuelve `--:--` fuera de banda. Es el comportamiento deseado en la UI; en el prompt del coach
(`athleteContext`) conviene decidirlo a conciencia, no heredarlo por accidente.

## A8. La ecuación ACSM recibe desnivel acumulado donde espera pendiente neta

> 🟨 **PARCIAL.** El error de la pendiente está corregido: el desnivel se paga vía
> `gapSpeedFromGain` (`gap.js`) y a `oxygenCostACSM` se le pasa `grade = 0`, que es el modelo de
> perfil ondulado del resto de la app. **Sigue abierto** el segundo párrafo: la mezcla
> `0.3·Daniels + 0.5·Léger + 0.2·ACSM` no tiene procedencia y la `confidence` está inflada porque
> los "tres métodos independientes" comparten entrada. Eso se resuelve con A1, no aquí.

`src/components/VO2MaxTracker.jsx:198-205`:

```js
const grade = activity.total_elevation_gain / activity.distance;   // siempre ≥ 0
const vo2ACSM = oxygenCostACSM(vMperMin, grade);
```

Es exactamente el error que documenta la cabecera de `src/lib/gap.js:12-16`:
`total_elevation_gain` es **desnivel positivo acumulado**, no pendiente neta. En un bucle que
vuelve al punto de salida la pendiente neta es 0, y aquí se cobra la subida entera sin acreditar la
bajada, así que el término `0.9 · S · G` infla el VO2 siempre.

Magnitud honesta: ACSM pesa 0,2 en la mezcla (`:208`), así que el sesgo del VO2max final es ~+0,8 %
en asfalto ondulado (100 m/10 km) y ~+3 % en trail (800 m/20 km). **Es pequeño**, por eso va al
final de la sección — pero es incorrecto y el arreglo es de una línea: usar `gapSpeedFromGain`
(`src/lib/gap.js:91`) y pasar `grade = 0`, que es el modelo de perfil ondulado que el resto de la
app ya aplica.

Segundo detalle del mismo bloque: la mezcla `0.3·Daniels + 0.5·Léger + 0.2·ACSM` (`:208`) no tiene
procedencia — no sale de ninguna de las referencias citadas en la cabecera del archivo. Y el método
A consume `vo2Avg` mientras el método C consume `vo2Leger` a secas (`:225`), así que los "tres
métodos independientes" cuyo acuerdo alimenta la `confidence` (`:243`) comparten entrada
parcialmente. **La confianza reportada está inflada por construcción.**

---

# B. Duplicación viva

## B1. Efficiency Factor: cinco sitios, tres unidades y un signo invertido

> ✅ **ARREGLADO.** La definición vive en **`src/lib/efficiencyFactor.js`** (25 tests), con la
> convención de TrainingPeaks / Jones —**m/latido, más es mejor**— y los filtros que la hacen
> significar algo: banda aeróbica 70-85 % FCmax con suelo de 185, tope de desnivel (1 % en crudo,
> 4 % con GAP), ventana de 75 min y mínimo de 3 km válidos. Los seis sitios quedan así:
>
> | Sitio | Antes | Ahora |
> |---|---|---|
> | `VitalsOverview` | la buena, pero local | `efficiencyFactorRun()` |
> | `HRAnalysis` `ratio` | `avgHr / gapSpeed` — **invertido** | borrado |
> | `HRAnalysis` `hre` | `avgHr × gapMinKm` | `toBeatsPerKm(ef)`, recíproco exacto del EF |
> | `HRAnalysis` `efficiency` | `speed / hr × 1000` | `efficiencyMPerBeat()` (`ef`) |
> | `VO2MaxTracker` `effIndex` | `speed / hr × 1000`, sin filtros | **borrado: era código muerto** (solo alimentaba `avgEff`, que no pintaba nadie) |
> | `mcp-store.js` `efficiencyIndex` | cuenta propia, ya en m/latido | delega en `efficiencyMPerBeat()` |
>
> El toggle de la pestaña de FC sigue existiendo, pero ya no ofrece dos métricas distintas: son
> **el mismo número en dos unidades** (lat/km y m/latido), derivadas la una de la otra. La
> tendencia de eficiencia del diagnóstico iba con el signo al revés respecto a la gráfica del
> resumen vital y ahora va con el EF, donde subir es mejorar.

| Sitio | Fórmula | Unidad | Filtros |
|---|---|---|---|
| `VitalsOverview.jsx:413-421` | m/latido por km aeróbico | m/latido | 70–85 % FCmax, GAP, 1.os 75 min |
| `HRAnalysis.jsx:337` | `avgHr / gapSpeed` | bpm/(m/s) | `<25 m/km`, GAP |
| `HRAnalysis.jsx:338` | `avgHr × gapMinKm` | latidos/km | ídem |
| `HRAnalysis.jsx:339` | `gapSpeed / avgHr × 1000` | ×1000 | ídem |
| `VO2MaxTracker.jsx:378` | `speed / hr × 1000` | ×1000 | **ninguno** |
| `api/_lib/mcp-store.js:762` | `efficiencyIndex(d, t, hr)` | — | — |

Seis expresiones, tres convenciones de unidad y una inversión de signo: `HRAnalysis:337` es el
**inverso** del EF de TrainingPeaks —ahí *menos es mejor*, en las demás *más es mejor*—. Ninguna
gráfica es comparable con otra, y la del VO2max mezcla series y rodajes sin filtro de intensidad,
que es justo lo que hace inútil un EF.

La implementación de `VitalsOverview` es la correcta: solo km aeróbicos, ajustada por desnivel, en
m/latido, que es la convención de TrainingPeaks / Jones. **Debería salir a `src/lib/` y ser la
única.**

## B2. Dos estimadores de FCreposo que contradicen la política escrita en `hrZones.js`

> ✅ **ARREGLADO** (con `F6`). Borrados los dos. `VO2MaxTracker` perdió la regresión FC↔VO2 y su
> *fallback* 0,32 × FCmax; `lactateThreshold.js` perdió `estimateRestingHR` (percentil 15 × 0,56)
> y `computeLactateModel` cae ahora a `DEFAULT_REST_HR` cuando el llamador no pasa una FCreposo
> plausible. `LactateThreshold.jsx` pasa la efectiva vía `useHrParams`, que es la misma que ven
> las zonas y el prompt del coach (`athleteContext` ya usaba `detectRestHR`). Queda **una** vía:
> Garmin → calibración manual → valor por defecto, y la política de la cabecera de `hrZones.js`
> describe por fin lo que hace el código. Los 27 tests de `hrZones` la fijan.

`src/lib/hrZones.js:23-26` declara la política del proyecto:

> Deliberadamente **NO** la estimamos desde la FC de actividad (no hay mapeo fiable de FC en
> ejercicio a FC en reposo real) — mejor un valor por defecto honesto que precisión falsa.

Y sin embargo hay dos estimadores que hacen exactamente eso:

- `src/lib/lactateThreshold.js:70` `estimateRestingHR` — percentil 15 de la FC media de rodajes
  largos **× 0,56**, acotado a 38–78.
- `src/components/VO2MaxTracker.jsx:153` `estimateRestHR` — regresión FC↔VO2 sobre todas las
  carreras extrapolada a VO₂ = 3,5, con *fallback* **0,32 × FCmax**.

Ni el 0,56 ni el 0,32 tienen referencia: no aparecen en ninguna de las fuentes citadas en las
cabeceras de ambos módulos. No son inocuos — la FCreposo entra en Karvonen y por tanto fija LT1/LT2
(`thresholdHRs:52`), las zonas y la carga TRIMP. La vía de la regresión puede devolver cualquier
cosa entre 40 y 80 (`VO2MaxTracker.jsx:184`).

**Arreglo**: una sola vía — Garmin si existe (`detectRestHR`), `DEFAULT_REST_HR` si no — y borrar
las dos heurísticas. Si se conserva alguna, que sea una, con su referencia, en `hrZones.js`, y que
la política de la cabecera diga lo que el código hace.

## B3. Dos umbrales de frecuencia cardiaca en dos pestañas

Sobreviven dos modelos independientes de FC de umbral, ambos con cascada de métodos:

| Módulo | Cascada | Consumidor |
|---|---|---|
| `src/lib/hrZones.js:93` `detectLTHR` | `segment` (bloques ≥8 min al 84–97 % FCmax en splits) → `field` (carreras 18–70 min) → `race` (p75 × 0,97) → `formula` (0,875 × FCmax) | pestaña *Zonas*, prompt del coach |
| `src/lib/lactateThreshold.js:347` `computeFieldLT2Hr` + `thresholdHRs:52` | `field` (FC mediana a ritmo de CS ±6 %) → `hrr` (85 % Karvonen) → `hrmax` (0,875) | *Motor Aeróbico › Umbrales* |

Comparten el ancla de *fallback* (`LTHR_FROM_HRMAX = 0.875`, importado correctamente en
`lactateThreshold.js:36`), así que cuando ambos caen al último escalón coinciden. En cuanto alguno
encuentra dato de campo, divergen: uno busca bloques definidos por %FCmax, el otro busca la FC al
ritmo de la velocidad crítica. **El usuario ve dos LTHR distintos en dos entradas del menú**, igual
que pasaba con la CS antes de la refactorización anterior.

De los dos, el bueno es `computeFieldLT2Hr`: anclar la FC de umbral a un **rendimiento medido** (la
CS) es más robusto que buscar bloques definidos por un %FCmax que es lo que se quiere averiguar —
el método `segment` es circular. Merece la pena unificar en esa dirección y dejar `detectLTHR` como
respaldo cuando no hay ajuste de CS válido.

## B4. Queda una cuarta implementación de deriva en `lactateThreshold`

Con `api/_lib/mcp-store.js:376` ya delegando en `computeSplitDecoupling`, sobrevive una
implementación aparte: `src/lib/lactateThreshold.js:269` `runDecoupling`.

| Sitio | Ventanas | Puertas | Entrada |
|---|---|---|---|
| `src/lib/decoupling.js:82` | `halves` / `durability` | ≥4 / ≥10 splits, split >500 m | `splits_metric` |
| `src/lib/lactateThreshold.js:269` | mitades | ≥4 laps, ≥35 min, llano, deriva de ritmo <8 % | **`laps`** |

Es más defendible que las anteriores —trabaja sobre `laps` y alimenta la regresión de LT1, no la
UI— pero sigue siendo una definición paralela del mismo concepto conviviendo con una biblioteca que
existe para evitarlo, y con su propio `segmentRatio` copiado (`:281-295`). Como mínimo debería
reusar `segmentRatio` de `decoupling.js` y documentar por qué la ventana es distinta.

## B5. Catorce formateadores inline con `timeFormat.js` ya escrito

> 🟨 **PARCIAL.** Migrados los nueve de A7 más `ActivitySplits.jsx` y `RunQA.jsx` (ambos a
> `formatDuration`). **Siguen abiertos** los cinco de `athleteContext.js`, que son la
> reimplementación completa del módulo dentro del generador de prompts.

Además de los nueve de A7, siguen sin migrar: `ActivitySplits.jsx:297`, `RunQA.jsx:150` y
`athleteContext.js:12, 123, 161, 170, 345`.

Los cinco de `athleteContext` son una reimplementación completa del módulo dentro del generador de
prompts. Migrarlos es mecánico salvo por la decisión sobre `PACE_LIMITS` mencionada en A7.

## B6. `isoWeekKey` y `dayKey` reimplementados en ocho sitios

> 🟨 **PARCIAL.** `WeeklyProgression.jsx` usa ya `isoWeekKey` en sus dos sitios (era el caso más
> descarado: tenía el módulo importado). **Siguen abiertos** `GarminCardiac`, `MonthlyChart`,
> `TrainingZones`, `StatusSnapshot`, `mcp-store.js` y `garmin-live.js`.

`src/lib/isoWeek.js:34` exporta `isoWeekKey`, y `src/lib/trainingLoad.js:121` exporta `dayKey` /
`activityDayKey` con la advertencia explícita de que iterar días sumando `86400000` ms rompe en los
cambios de horario.

| Sitio | Qué reimplementa |
|---|---|
| `WeeklyProgression.jsx:24, 45` | `${year}-W${pad(week)}` — literalmente `isoWeekKey`, teniendo `isoWeek` ya importado |
| `GarminCardiac.jsx:55` | función `isoWeek` local completa |
| `MonthlyChart.jsx:53` | `isoWeek` local que además **sombrea** el import de `weekStartDate` |
| `MonthlyChart.jsx:76`, `TrainingZones.jsx:161, 163`, `StatusSnapshot.jsx:1118` | clave de día/mes local |
| `api/_lib/mcp-store.js:1262`, `api/_lib/garmin-live.js:25` | `dayKey` — y el backend ya importa de `src/lib/`, así que no hay excusa de resolución de módulos |

---

# C. Ventanas temporales y zona horaria

Dentro de **una misma llamada** a `computeLactateModel` (`src/lib/lactateThreshold.js:378`) conviven
dos definiciones de "últimos N meses":

- `computeCriticalSpeed` → `monthsAgoISO(months)` (`criticalSpeed.js:132`): **meses de calendario**
  sobre el **día local** de la actividad (`dayOf:76` prefiere `start_date_local`).
- `computeLTMonthly:207`, `computeDecouplingLT1:301`, `computeFieldLT2Hr:349` →
  `months * 30 * 24 * 60 * 60 * 1000`: **meses de 30 días** sobre `new Date(a.start_date)` (**UTC**).

Para `months = 12` son 360 días frente a 365, y el corte cae en un instante UTC en vez de a
medianoche local. El impacto numérico es pequeño; el problema es que el modelo declara ajustar la CS
y su contraste por FC "sobre el mismo histórico" y no es cierto. Mismo patrón en
`VO2MaxTracker.jsx:317` y `:344`. `monthsAgoISO` + `activityDayKey` ya resuelven ambas cosas.

---

# D. Código muerto

> ✅ **ARREGLADO.** Borrados los cinco: `geminiKey()`, `resetFreshness()` (y con él el import
> ya huérfano de `invalidateKey`), `findRaceDistance()`, `heatPenaltyAtIntensity()` —con su
> referencia en el comentario de `HEAT_TABLE` reapuntada a `shapeWeather()` de `mcp-store.js`— y
> las constantes `garminMaxHR` / `garminOfficialVO2` de `VO2MaxTracker`. **Sigue abierta** la
> superficie de export excesiva de los dos últimos párrafos.

Sin ningún llamador en el repo (verificado con `grep -w` sobre `src/` y `api/`, excluyendo sus
propias definiciones y los tests):

| Símbolo | Ubicación |
|---|---|
| `geminiKey()` | `api/_lib/ai.js:16` — `resolveModel` cubre ya todos los proveedores |
| `resetFreshness()` | `api/_lib/mcp-sync.js:553` |
| `findRaceDistance()` | `src/lib/raceDistances.js:39` |
| `heatPenaltyAtIntensity()` | `api/_lib/garmin-helpers.js:340` — `mcp-store.js:217-227` recompone la misma cuenta a mano con `heatPenaltyPct` × `heatIntensityFactor`; o se usa la función o se borra |
| `garminMaxHR`, `garminOfficialVO2` | `VO2MaxTracker.jsx:318-319` — constantes `null` con sus ramas `||` muertas |

**Superficie de export excesiva** (no es código muerto, pero invita a la divergencia): ~30 símbolos
exportados que solo se consumen dentro de su propio módulo. El grupo mayor está en
`lactateThreshold.js` (`thresholdHRs`, `robustHRmax`, `computeCriticalSpeed`, `computeLTMonthly`,
`computeFieldLT2Hr`, `computeDecouplingLT1` y ocho constantes) y en `mcp-store.js`
(`computeDecoupling`, `computeGap`, `detectThresholdEffort`, `summarizeActivities`). Cada export
público es una invitación a que alguien lo llame con otros parámetros y reintroduzca justo el tipo
de divergencia que estas auditorías vienen cerrando.

---

# E. Cobertura de tests

> 🟨 **PARCIAL.** Los dos módulos prioritarios ya tienen tests: **`hrZones`** (27) y
> **`physiology`** (20), más **`efficiencyFactor`** (25) que nace con los suyos. La suite pasa de
> 176 a **254 tests en 16 ficheros**. Los de `hrZones` fijan la *política*, no solo los números:
> que `detectRestHR` NO estime desde la FC de actividad y que la cascada de `detectLTHR` degrade
> en el orden documentado bajando la confianza. Los de `physiology` contrastan las cuatro
> ecuaciones contra el valor de la fuente publicada, y uno de ellos deja fijado —para que el
> arreglo sea visible— el sesgo de intensidad que describe `A1`.
> **Siguen sin tests** `athleteContext.js`, `raceDistances.js`, `planFormat.js` y
> `garminActivitiesSync.js`.
13 ficheros, 176 tests, todos en verde — y `decoupling.test.js` / `flatEfforts.test.js` ya cubren
los dos módulos recién extraídos. Lo que queda sin **ningún** test son los módulos con más
consumidores:

| Módulo | Qué alimenta | Tests |
|---|---|---|
| `src/lib/hrZones.js` | zonas, la FCmax de TODA la app, LTHR, PMC, prompt del coach | ❌ |
| `src/lib/physiology.js` | VDOT, VO2max, resumen vital | ❌ |
| `src/lib/athleteContext.js` | todo el prompt del coach (755 líneas) | ❌ |
| `src/lib/raceDistances.js`, `planFormat.js`, `garminActivitiesSync.js` | tabla de distancias, formato de plan, sync | ❌ |

Prioridad clara: **`hrZones`** — un cambio ahí mueve cinco vistas a la vez, y es el módulo sobre el
que se apoyan los arreglos A2 y B2/B3. **`physiology`** después: sus cuatro ecuaciones son
verificables contra valores publicados en menos de treinta líneas de test.

---

# F. Fórmulas mejorables

Ninguna de estas es un error; son sitios donde existe un modelo mejor y los datos para usarlo.

### F1. Predicción de carrera: hay dos modelos deterministas sin usar

`src/components/RacePredictor.jsx` **delega la predicción entera a un LLM** y le pide de palabra que
aplique Riegel (`:160`: *"proyecta a las demás distancias con Riegel: T2 = T1 × (D2/D1)^1.06"*).
Después sanea la salida en cliente: descarta ritmos fuera de 2:30–12:00 y detecta inversiones
(`normalizePredictions:51-77`). Que haga falta ese saneamiento dice todo sobre la fiabilidad del
método.

En el mismo repo hay dos predictores deterministas ajustados sobre los datos reales del atleta:

- `criticalSpeed.predictTime` (`:199`) — `t = (d − D′) / CS` sobre el ajuste de dos parámetros, con
  la ventana de validez marcada (`optimistic`) y R² reportado.
- `VDOTEstimator.predictRaceTime` (`:43`) — inversión de Daniels-Gilbert por bisección.

Riegel con exponente fijo 1,06 es además el más flojo de los tres: infraestima el maratón de forma
conocida, y la práctica moderna individualiza el exponente por atleta (típicamente 1,06–1,10)
ajustándolo sobre sus propias marcas — cosa que aquí se puede hacer con la curva mean-max que ya
está construida.

**Recomendación**: calcular las predicciones con CS/D′ + VDOT y dejar al LLM lo que sabe hacer bien
— ajustar por contexto (CTL/TSB, volumen, calor, especificidad) y redactar el porqué. Es además más
barato y determinista.

### F2. GAP sobre desnivel neto por km: la solución ya está a mano

`api/_lib/mcp-store.js:399` `computeGap` documenta el problema (`:417-423`) y publica un `caveat`
cuando el desnivel bruto duplica al neto. Es la respuesta honesta, pero la solución real está a
mano: `src/lib/flatEfforts.js` **ya lee y cachea los streams de altitud y distancia** de la
actividad. Calcular el GAP muestra a muestra sobre esos streams elimina la cancelación
subida/bajada dentro del mismo kilómetro y convierte una cota inferior en una medida.

### F3. Corrección de deriva asumida al 3 %/h cuando la deriva se mide

`VO2MaxTracker.jsx:126-143` corrige la FC con un modelo lineal de 3 %/hora fijo, igual para un
rodaje que para una sesión de series. La app **mide** la deriva de cada sesión
(`src/lib/decoupling.js:82`). Usar el valor medido —o eliminar la corrección— es mejor que inventar
una constante, sobre todo cuando el resultado alimenta una regresión que luego se extrapola hasta
FCmax.

### F4. ACWR: la UI contradice la advertencia del propio modelo

`src/lib/trainingLoad.js:65-68` avisa, correctamente, de que desde Impellizzeri et al. (2020) el
ACWR está bajo crítica metodológica seria y de que hay que tratarlo "como señal blanda, nunca como
predictor de lesión".

`InjuryRisk.jsx:107` le da **el mayor peso del índice compuesto (30 %)**, y la vista lo presenta
como "riesgo de lesión" con recomendaciones imperativas (`:127`: *"Reduce la intensidad esta
semana"*). El código y su documentación dicen cosas opuestas.

Alternativas con mejor respaldo actual: rampa de CTL (que ya se calcula, `trainingLoad.js:372`),
volumen absoluto semanal y días consecutivos sin descanso. Como mínimo, bajar el peso del ACWR y
trasladar la advertencia del módulo a la UI.

### F5. Velocidad crítica: opcional pasar a 3 parámetros

El modelo de dos parámetros (`criticalSpeed.js:162`) está bien implementado y su cabecera es honesta
sobre el sesgo optimista fuera de 2–30 min. Si se quisiera predecir media y maratón con él, la
mejora natural es el **modelo de 3 parámetros de Morton** (añade la velocidad máxima instantánea) o
un decaimiento de CS con el tiempo. Hoy la bandera `optimistic` cumple, así que esto es opcional.

### F6. `estimateRestingHR` × 0,56: eliminar

> ✅ **ARREGLADO.** Borrada. Ver B2.

Ver B2. No es una fórmula mejorable, es una constante sin procedencia en la ruta crítica de
Karvonen. La mejora es borrarla.

### F7. `GearTracker`: vida útil del calzado fija en 800 km

`src/components/GearTracker.jsx:140` (`maxLife: 800`, comentado como "se recomienda escalar") es
igual para una zapatilla de placa de carbono (~250 km) que para una de rodaje (~800 km). Con la
barra de desgaste pintada encima (`:252`), el número se lee como una recomendación. Debería ser
configurable por par, o al menos por tipo.

---

# Orden de ataque sugerido

| Paso | Qué | Por qué en ese orden | Estado |
|---|---|---|---|
| 1 | **A2** — que `VO2MaxTracker` use `detectMaxHR`/`detectRestHR` | 15 min; quita la incoherencia más visible entre pestañas | ✅ |
| 2 | **A4**, **A7** | Bugs de presentación, arreglo trivial, resultado visible | ✅ |
| 3 | **E** — tests de `hrZones` y `physiology` | Sin esto, los pasos 4–8 se hacen a ciegas | ✅ |
| 4 | **B2** + **F6** — una sola vía de FCreposo | Está en la ruta crítica de zonas, umbrales y carga | ✅ |
| 5 | **A5**, **A6** — recalibrar `strain`, cerrar la semana | Devuelven sentido a dos de los cinco factores de lesión | ✅ |
| 6 | **B1** — extraer el EF de `VitalsOverview` a `lib/` | Seis expresiones → una | ✅ |
| 7 | **B3** — unificar LTHR en el método anclado a CS | Cierra el último "dos números para lo mismo" del menú | ⬜ **siguiente** |
| 8 | **A1** + **F1** — anclar VO2max y predicciones en rendimiento | El cambio de mayor valor y el de mayor coste | ⬜ |
| 9 | **D**, **C**, **B4**, **B5**, **B6**, **F7** | Limpieza, sin prisa | 🟨 hecho `D`; parcial `B5`/`B6` |

> Quedan los pasos 7 y 8, los dos de mayor calado: **B3** (dos LTHR en dos entradas del menú) y
> **A1 + F1** (anclar VO2max y predicciones en rendimiento en vez de en FC). Ambos se apoyan en
> los tests de `hrZones` y `physiology` que ya existen, así que dejan de hacerse a ciegas. El
> resto del paso 9 es limpieza sin prisa.
