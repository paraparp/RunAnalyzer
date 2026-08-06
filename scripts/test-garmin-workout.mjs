// Smoke test de escritura: crea un entreno estructurado en Garmin, lo lee de
// vuelta para verificar que los campos round-trip (distancia en metros, unidad,
// repeticiones, objetivo de ritmo) y LO BORRA al terminar. Deja la cuenta limpia.
//
// Uso (PowerShell):
//   $env:GARMIN_USER='tu_email'; $env:GARMIN_PASS='tu_password'; node scripts/test-garmin-workout.mjs
import pkg from 'garmin-connect';
import { buildRunningWorkout } from '../api/_lib/garmin-write.js';

const { GarminConnect } = pkg;
const USER = process.env.GARMIN_USER;
const PASS = process.env.GARMIN_PASS;
if (!USER || !PASS) { console.error('Faltan GARMIN_USER / GARMIN_PASS.'); process.exit(1); }

// Entreno representativo: calentamiento, 4×(400 m a ritmo + 90 s recuperación), enfriamiento 1 km.
const spec = {
  name: 'TEST RunAnalyzer (autoborrado)',
  description: 'Smoke test — se borra solo',
  steps: [
    { kind: 'warmup', duration: { type: 'time', value: 10, unit: 'min' } },
    { kind: 'repeat', repeats: 4, steps: [
      { kind: 'interval', duration: { type: 'distance', value: 400, unit: 'm' }, target: { type: 'pace', low: 4.0, high: 4.15 } },
      { kind: 'recovery', duration: { type: 'time', value: 90, unit: 's' } },
    ] },
    { kind: 'cooldown', duration: { type: 'distance', value: 1, unit: 'km' } },
  ],
};

const ok = (c, msg) => console.log(`${c ? '✅' : '❌'} ${msg}`);
const gc = new GarminConnect({ username: USER, password: PASS });
console.log('Login…');
await gc.login(USER, PASS);

const json = buildRunningWorkout(spec);
let id = null;
try {
  console.log('Creando entreno…');
  const created = await gc.addWorkout(json);
  id = created?.workoutId;
  ok(!!id, `Garmin aceptó el POST y devolvió workoutId=${id}`);
  if (!id) { console.log('Respuesta:', JSON.stringify(created).slice(0, 400)); throw new Error('sin workoutId'); }

  console.log('Leyendo de vuelta…');
  const d = await gc.getWorkoutDetail({ workoutId: id });
  const steps = d?.workoutSegments?.[0]?.workoutSteps ?? [];
  ok(d?.workoutName === spec.name, `Nombre round-trip: "${d?.workoutName}"`);
  ok(steps.length === 3, `3 pasos de nivel superior (hay ${steps.length})`);

  const repeat = steps.find((s) => s.type === 'RepeatGroupDTO');
  ok(!!repeat, `Grupo de repeticiones presente (${repeat?.numberOfIterations ?? '?'}×)`);
  ok(repeat?.numberOfIterations === 4, 'Repite 4 veces');

  const interval = repeat?.workoutSteps?.find((s) => s.stepType?.stepTypeKey === 'interval');
  ok(interval?.endConditionValue === 400, `Intervalo por distancia = ${interval?.endConditionValue} m (esperado 400)`);
  ok(/kilometer|meter/.test(interval?.preferredEndConditionUnit?.unitKey || ''), `Unidad: ${interval?.preferredEndConditionUnit?.unitKey}`);
  ok(interval?.targetType?.workoutTargetTypeKey === 'pace.zone', `Objetivo de ritmo: ${interval?.targetType?.workoutTargetTypeKey}`);

  const cooldown = steps.find((s) => s.stepType?.stepTypeKey === 'cooldown');
  ok(cooldown?.endConditionValue === 1000, `Enfriamiento = ${cooldown?.endConditionValue} m (esperado 1000)`);

  console.log('\nResumen de pasos tal como los guardó Garmin:');
  const walk = (arr, indent = '  ') => arr.forEach((s) => {
    const dur = s.endConditionValue != null ? `${s.endConditionValue} ${s.endCondition?.conditionTypeKey}` : s.endCondition?.conditionTypeKey;
    console.log(`${indent}${s.stepType?.stepTypeKey ?? s.type} — ${dur}${s.targetType && s.targetType.workoutTargetTypeKey !== 'no.target' ? ` @${s.targetType.workoutTargetTypeKey}` : ''}`);
    if (s.workoutSteps) walk(s.workoutSteps, indent + '    ');
  });
  walk(steps);
} catch (e) {
  console.log('❌ ERROR:', e.message);
} finally {
  if (id) {
    try { await gc.deleteWorkout({ workoutId: id }); console.log(`\n🧹 Entreno de prueba ${id} borrado.`); }
    catch (e) { console.log(`\n⚠️ No se pudo borrar ${id} (bórralo a mano en Garmin): ${e.message}`); }
  }
}
