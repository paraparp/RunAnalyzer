# Auditoría de duplicación, código muerto y cálculos

> Documento **vivo**: solo contiene lo que sigue abierto. La revisión del 2026-08-30 se cerró
> entera el 2026-09-06; el **2026-09-19** apareció una duplicación nueva —las zonas de FC, §H— que
> se cerró el mismo día salvo un punto, `H6`, que sigue abierto.
>
> Los bloques `A`–`F` de la revisión del 2026-08-30 (cálculos incorrectos, duplicación viva,
> ventanas temporales, código muerto, cobertura de tests y fórmulas mejorables) se cerraron y
> verificaron uno a uno contra el código el 2026-08-31. El bloque `G` —la segunda pasada, la de los
> arreglos que se habían aplicado donde se detectó el síntoma pero no en las vistas hermanas que
> hacían el mismo cálculo— se cerró entre el 2026-08-31 y el **2026-09-06** con `G6` y `G8`, sus dos
> últimos puntos. El detalle de cada uno queda en el historial de git (este fichero, commits
> `261ca35` y posteriores).
>
> Estado de la suite en la verificación de cierre (**2026-09-06**): **821 tests / 41 ficheros en
> verde**, comprobada además bajo `TZ=America/New_York` (los husos al oeste de Greenwich son los
> que destapan las claves de día en UTC). `eslint` sin problemas nuevos y `vite build` correcto.

## Cierre de los dos últimos puntos

**`G8` — superficie de export excesiva (heredado de `D`).** Los **50 símbolos** que se exportaban
teniendo su único consumidor dentro de su propio módulo han dejado de ser públicos: los 14 de
`src/lib/lactateThreshold.js` (porcentajes y sigmas de LT1/LT2, la lambda del EWMA, los mínimos de
duración y de lap, `thresholdHRs`, `robustHRmax`, `computeLTMonthly`, los umbrales de desacople y
`computeDecouplingLT1`), los 5 de `api/_lib/mcp-store.js` (`invalidateKey`,
`getGarminActivitiesRaw`, `shapeDynamicsFromGarmin`, `computePersonalBests`,
`detectThresholdEffort`) y los 31 restantes, casi todos constantes de calibración repartidas por
`src/lib/` (`trainingLoad`, `physiology`, `criticalSpeed`, `efficiencyFactor`, `racePrediction`,
`decoupling`, `flatEfforts`, `hrZones`, `loadCalibration`, `reverseGeocode`, `routeSimilarity`,
`targetRaces`, `timeFormat`, `aiModel`) y por `api/_lib` (`auth.getUserFromReq`,
`garmin-helpers.dewPointC` y `computeWbgt`). Ninguno era código muerto —todos tienen consumidor
interno— y ningún test los importaba, así que la superficie pública quedó igual para quien la usa.
Un barrido sobre `src/lib/*.js` y `api/_lib/*.js` ya no encuentra ningún export sin consumidor
fuera de su fichero.

**`G6` — módulos sin tests.** Cerrado del todo con `src/hooks/useHrParams.test.js` (18 casos), que
era lo único que faltaba y lo que exigía la dependencia nueva: `@testing-library/react` + `jsdom`
como devDependencies, con el entorno declarado por fichero (`// @vitest-environment jsdom`) para no
mover del entorno de node los otros 40. Lo que fija es la capa que de verdad es del hook —la
RESOLUCIÓN vive en `src/lib/loadCalibration.js` y ya tenía los suyos—: que el estado arranca sembrado
de lo guardado (y que un JSON roto no rompe el montaje), que se persisten solo las claves con valor
y que borrar el último override **borra la clave** en vez de dejar un `{}`, la ida y vuelta a través
de un montaje nuevo, y sobre todo el `OVERRIDES_EVENT`, que es el que despierta al PMC de las otras
vistas: sin él, ajustar el LTHR a mano no movía el CTL hasta recargar la página. Del lado de la
validación: que un valor fuera de rango se marca inválido y **no contamina el número resuelto** —el
mismo patrón de "no lo sé" ≠ "cumple" que ya apareció en `filterActivities` y en `hr_source`—, que
el campo vacío no es un valor inválido, y que la FC de reposo de Garmin llega al resultado pero
cede ante el override manual. No apareció ningún defecto nuevo al escribirlos.

## `H` — las zonas de FC (2026-09-19)

La auditoría cerró en su día los cálculos de **carga, ritmo y umbrales**, pero no miró las **zonas
de frecuencia cardíaca**, y ahí estaba la misma enfermedad en su forma más cara: no dos vistas
pintando el mismo número, sino **tres modelos distintos contestando a "¿en qué zona corrí?"** y
**tres formas de contar el tiempo en cada una**. Salió al añadir el reparto por zonas a la portada:
no había de dónde pedirlo.

**`H1` — tres modelos de zonas. ✅** `TrainingZones` dejaba **elegir** entre Seiler (3 zonas desde el
LTHR) y Karvonen (5 desde la reserva de FC) —los mismos kilómetros salían Z2 o Z3 según el botón
pulsado—, y `HRZonesCard` más `athleteContext` usaban un tercero, 3 zonas derivadas de LT1/LT2, que
era con el que **prescribía el coach**. Gana **Karvonen**, único en toda la app: `seilerBounds`
borrado, selector de modelo fuera, y la tarjeta y el prompt leyendo `karvonenBounds`. LT1 y LT2 no
se pierden: quedan como **anclas de ritmo**, que es lo que de verdad prescriben.

**`H2` — tres contadores de tiempo en zona. ✅** El bucle vivía dentro de `TrainingZones` (con su
`hrSegments` local), y `athleteContext` tenía el suyo: clasificaba **cada sesión entera por su FC
media** contra ratios de LTHR (`<0,92` / `<1,0`), que colapsa un rodaje con calentamiento y repechos
en una sola zona. Ahora hay uno, [`lib/zoneMix.js`](../src/lib/zoneMix.js) —`hrSegments`, el reparto
parcial a parcial, `polarizedGroups` y `polarizationStatus`—, y lo consumen Zonas, la portada y el
coach. El 80/20 deja de necesitar un modelo propio: sale de agrupar las cinco (Z1+Z2 / Z3 / Z4+Z5).

**`H3` — la fase de entrenamiento, escrita dentro de un JSX. ✅** Los cortes del TSB (`>5` en forma,
`≥0` acumulando, `≥-10` cargando) estaban en el cuerpo de `PhaseBanner`. Copiarlos para la portada
habría dejado dos escalas para la misma palabra; se extrajeron a `statusStats.loadPhase`, que
devuelve clave + texto y deja el color a quien pinta.

**`H4` — un validador midiendo contra otro techo. ✅** `coachCoherenceWarnings` comprobaba el tope de
FC de una sesión fácil contra **LT1** mientras el prompt le daba al coach el fin de Z2: podía avisar
de una prescripción que cumplía el prompt al pie de la letra. Los dos usan ya el mismo número.

**`H5` — una traducción que nunca existió. ✅** `hr_analysis.gray_zone_tip` no estaba en `i18n.js`:
el callout de la zona gris llevaba desde siempre pintando la **clave cruda** en pantalla. Añadido en
es/en, junto al resto de los textos de polarización, que hablaban de "Z1/Z2/Z3" cuando ya son
agrupaciones de cinco zonas.

**`H6` — la portada duplicada otra vez. ❗ ABIERTO.** El panel de reparto salió como componente,
[`TodayBalance.jsx`](../src/components/TodayBalance.jsx), y `TodayView` lo montaba. La reescritura en
curso de `TodayView` **lo ha dejado sin montar y reimplementa el panel en línea** llamando a
`zoneMix` por su cuenta. El cálculo sigue siendo único (que era el criterio 1), pero la
presentación vuelve a tener dos dueños: hay que decidir cuál se queda.

De paso, dos cosas que el corte destapó y que no eran duplicación sino cálculo: la ventana de
`zoneMix` quedó **cerrada por los dos lados** (una actividad con fecha futura, mal sincronizada, no
puede contar como tiempo entrenado) y el "ahora" es **inyectable**, como ya lo era en `statusStats`,
para que la ventana de 28 días no se mueva entre repintados ni en los tests.

Estado de la suite al cierre: **932 tests / 51 ficheros en verde** (nuevos:
[`zoneMix.test.js`](../src/lib/zoneMix.test.js) y el humo de `TodayBalance`; reescritos los del
prompt del coach, que exigen ahora los cinco nombres de zona y la línea del 80/20). `vite build`
correcto; `eslint` limpio salvo en `TodayView.jsx`, que está a medio reescribir (`H6`).

## Criterios que deja la auditoría

Lo que conviene no volver a perder, que es el patrón común de casi todo lo que se cerró aquí:

1. **Un cálculo, un punto de entrada.** GAP (`activityGapSpeed`), claves de día y semana
   (`activityDayKey` / `dayKey` / `isoWeek`), la regla del 10 % semanal (`weeklyVolume`), la
   calibración de FC (`loadCalibration`) y la predicción de carreras (`predictRaces`, también
   detrás de la tool MCP). Si una vista necesita el número, lo pide; no lo recalcula.
2. **"No lo sé" no es "cumple".** Un filtro con cota no debe dejar pasar los registros sin dato
   (`null <= 200` es `true`), y un campo que el agente lee debe decir `unknown` en vez de `null`.
3. **Exportar solo lo que otro módulo consume de verdad.** La superficie de más es la puerta por
   la que vuelve a entrar la divergencia.
4. **Un arreglo se aplica en todos los sitios que hacen ese cálculo**, no solo donde se detectó el
   síntoma: ese fue, literalmente, todo el bloque `G`.
5. **Leer una forma obliga a saber escribirla.** El blob de Strava con sus dos formas vivas y el
   `{ ...blob, activities }` sobre un array es el ejemplo caro.
6. **Un modelo, no un selector.** Dejar elegir entre dos modelos del mismo concepto (Seiler vs
   Karvonen) no es dar flexibilidad: es no tener respuesta. Si de verdad hacen falta dos lecturas,
   una se **deriva** de la otra —la polarizada sale de agrupar las cinco zonas— en vez de
   calcularse en paralelo. Vale igual para lo que ve el atleta y para lo que recibe el coach: si
   el prompt y la pantalla no dicen "Z2" con el mismo significado, el consejo es incomprobable.
7. **Los umbrales de un veredicto no viven dentro de un JSX.** En cuanto una segunda vista quiere
   la misma palabra ("Cargando", "zona gris"), copiarlos crea dos escalas. La función devuelve la
   clave; el componente pone el color (`loadPhase`, `polarizationStatus`).
