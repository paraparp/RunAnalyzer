// Diagnóstico Fase 2: vuelca los endpoints de forma/estado de Garmin a un JSON
// local para implementar readiness, training status, VO2max/umbral y calendario
// con los campos exactos. NO sube nada; solo lee tu cuenta.
//
// Uso (PowerShell):
//   $env:GARMIN_USER='tu_email'; $env:GARMIN_PASS='tu_password'; node scripts/dump-garmin-fitness.mjs
import pkg from 'garmin-connect';
import { writeFileSync } from 'node:fs';

const { GarminConnect } = pkg;
const USER = process.env.GARMIN_USER;
const PASS = process.env.GARMIN_PASS;
if (!USER || !PASS) { console.error('Faltan GARMIN_USER / GARMIN_PASS.'); process.exit(1); }

const gc = new GarminConnect({ username: USER, password: PASS });
console.log('Login en Garmin…');
await gc.login(USER, PASS);

const today = new Date();
const d = today.toISOString().slice(0, 10);
const y = today.getFullYear();
const m0 = today.getMonth(); // calendar-service usa mes 0-indexado

const API = 'https://connectapi.garmin.com';
const endpoints = {
  training_readiness:  `${API}/metrics-service/metrics/trainingreadiness/${d}`,
  training_status:     `${API}/metrics-service/metrics/trainingstatus/aggregated/${d}`,
  max_metrics:         `${API}/metrics-service/metrics/maxmet/latest/${d}`,
  endurance_score:     `${API}/metrics-service/metrics/endurancescore?calendarDate=${d}`,
  hill_score:          `${API}/metrics-service/metrics/hillscore?calendarDate=${d}`,
  calendar_month:      `${API}/calendar-service/year/${y}/month/${m0}`,
  scheduled_today:     `${API}/workout-service/schedule/${d}`,
};

const out = { generated: d };
for (const [name, url] of Object.entries(endpoints)) {
  try {
    out[name] = await gc.client.get(url);
    console.log(`✅ ${name}`);
  } catch (e) {
    out[name] = { __error: e.message };
    console.log(`⚠️  ${name}: ${e.message}`);
  }
}

writeFileSync('garmin-fitness-dump.json', JSON.stringify(out, null, 2), 'utf8');
console.log('\nEscrito garmin-fitness-dump.json — dile a Claude que lo lea.');
