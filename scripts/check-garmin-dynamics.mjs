// Diagnóstico: comprueba qué datos de running dynamics devuelve Garmin de verdad
// y cómo quedan tras normalizar. NO se sube nada; solo lee de tu cuenta Garmin.
//
// Uso (PowerShell):
//   $env:GARMIN_USER="tu_email"; $env:GARMIN_PASS="tu_password"; node scripts/check-garmin-dynamics.mjs
// Uso (bash):
//   GARMIN_USER=tu_email GARMIN_PASS=tu_password node scripts/check-garmin-dynamics.mjs
import pkg from 'garmin-connect';
import { normalizeGarminActivity } from '../api/_lib/garmin-helpers.js';

const { GarminConnect } = pkg;
const USER = process.env.GARMIN_USER;
const PASS = process.env.GARMIN_PASS;
const LIMIT = Number(process.env.LIMIT || 10);

if (!USER || !PASS) {
  console.error('Faltan GARMIN_USER / GARMIN_PASS en el entorno.');
  process.exit(1);
}

// Campos de la banda que esperamos usar (raw key de Garmin → etiqueta nuestra).
const DYN_FIELDS = {
  averageRunningCadenceInStepsPerMinute: 'cadence_spm',
  maxRunningCadenceInStepsPerMinute: 'max_cadence_spm',
  avgGroundContactTime: 'ground_contact_ms',
  avgGroundContactBalance: 'gct_balance_pct',
  avgStrideLength: 'stride_length_cm',
  avgVerticalOscillation: 'vertical_oscillation_cm',
  avgVerticalRatio: 'vertical_ratio_pct',
  avgPower: 'avg_power_w',
  maxPower: 'max_power_w',
  normPower: 'norm_power_w',
  aerobicTrainingEffect: 'aerobic_te',
  anaerobicTrainingEffect: 'anaerobic_te',
  activityTrainingLoad: 'training_load',
  vO2MaxValue: 'vo2max',
};

const gc = new GarminConnect({ username: USER, password: PASS });
console.log('Login en Garmin…');
await gc.login(USER, PASS);

console.log(`Bajando las últimas ${LIMIT} actividades…\n`);
const raw = await gc.client.get(
  `https://connectapi.garmin.com/activitylist-service/activities/search/activities?start=0&limit=${LIMIT}`
);

if (!Array.isArray(raw) || !raw.length) {
  console.error('Garmin no devolvió actividades.');
  process.exit(1);
}

// 1) Todos los campos disponibles en la primera actividad (para detectar nombres nuevos).
console.log('=== Campos crudos de la 1ª actividad ===');
console.log(Object.keys(raw[0]).sort().join(', '));

// 2) Cobertura de cada campo de dynamics sobre todas las actividades.
console.log('\n=== Cobertura de running dynamics ===');
for (const [rawKey, label] of Object.entries(DYN_FIELDS)) {
  const present = raw.filter((a) => typeof a[rawKey] === 'number' && !Number.isNaN(a[rawKey])).length;
  const flag = present === 0 ? '❌' : present < raw.length ? '⚠️ ' : '✅';
  console.log(`${flag} ${rawKey.padEnd(42)} → ${label.padEnd(24)} ${present}/${raw.length}`);
}

// 3) Ejemplo: cómo queda la primera carrera tras normalizar.
const firstRun = raw.find((a) => (a.activityType?.typeKey || '').includes('run')) || raw[0];
console.log('\n=== normalizeGarminActivity(primera carrera) ===');
console.log(JSON.stringify(normalizeGarminActivity(firstRun), null, 2));
