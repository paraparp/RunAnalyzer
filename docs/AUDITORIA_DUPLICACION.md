# Auditoría de duplicación, código muerto y cálculos

> Documento **vivo**: solo contiene lo que sigue abierto. **A fecha de 2026-09-06 no queda nada.**
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
