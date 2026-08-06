// Diagnóstico: vuelca los endpoints candidatos de UNA actividad de Garmin a un
// archivo JSON local, para inspeccionar qué campos trae de verdad (origen de FC,
// laps reales con tipo INTERVAL/REST, potencia por lap, weather para WBGT).
// NO sube nada; solo lee de tu cuenta Garmin y escribe un .json en el repo.
//
// Uso (PowerShell):
//   $env:GARMIN_USER="tu_email"; $env:GARMIN_PASS="tu_password"; node scripts/dump-garmin-details.mjs
// Opcional: fijar la actividad (si no, coge la última carrera):
//   $env:ACTIVITY_ID="1234567890"; node scripts/dump-garmin-details.mjs
import pkg from 'garmin-connect';
import { writeFileSync } from 'node:fs';

const { GarminConnect } = pkg;
const USER = process.env.GARMIN_USER;
const PASS = process.env.GARMIN_PASS;

if (!USER || !PASS) {
  console.error('Faltan GARMIN_USER / GARMIN_PASS en el entorno.');
  process.exit(1);
}

const gc = new GarminConnect({ username: USER, password: PASS });
console.log('Login en Garmin…');
await gc.login(USER, PASS);

// Elegir actividad: la indicada, o la última carrera del listado.
let id = process.env.ACTIVITY_ID;
if (!id) {
  const list = await gc.client.get(
    'https://connectapi.garmin.com/activitylist-service/activities/search/activities?start=0&limit=20'
  );
  const run = (Array.isArray(list) ? list : []).find((a) => (a.activityType?.typeKey || '').includes('run'));
  id = String((run || list[0]).activityId);
  console.log(`Actividad elegida (última carrera): ${id} — ${(run || list[0]).activityName}`);
}

const base = 'https://connectapi.garmin.com/activity-service/activity';
// maxChartSize=0 evita bajar los streams punto a punto (pesan MB); queremos metadatos.
const endpoints = {
  summary:      `${base}/${id}`,
  details_meta: `${base}/${id}/details?maxChartSize=0&maxPolylineSize=0`,
  splits:       `${base}/${id}/splits`,
  typedsplits:  `${base}/${id}/typedsplits`,
  weather:      `${base}/${id}/weather`,
};

const out = { activity_id: id };
for (const [name, urlEp] of Object.entries(endpoints)) {
  try {
    out[name] = await gc.client.get(urlEp);
    console.log(`✅ ${name}`);
  } catch (e) {
    out[name] = { __error: e.message };
    console.log(`⚠️  ${name}: ${e.message}`);
  }
}

const file = 'garmin-details-dump.json';
writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
console.log(`\nEscrito ${file} — dile a Claude que lo lea.`);
