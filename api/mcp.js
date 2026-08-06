// ============================================================================
// /api/mcp — Servidor MCP remoto (Streamable HTTP, stateless) sobre los datos
// de RunAnalyzer que ya viven en Supabase (user_storage).
//
// Compatible con Claude (Custom Connectors) y ChatGPT (connectors). La auth es
// OAuth 2.1 con Bearer token: si falta o es inválido devolvemos 401 con el header
// WWW-Authenticate que apunta al Protected Resource Metadata, disparando el flujo
// de descubrimiento OAuth en el cliente.
// ============================================================================
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { applyCors, baseUrl, verifyAccessToken } from './_lib/mcp-oauth.js';
import {
  getActivities, filterActivities, summarizeActivities, shapeSummary, shapeFull,
  listRunningDynamics, getHrvResting, getSleep, getPersonalBests,
  getTrainingLoadModel, getHealthAlerts, detectThresholdTests,
} from './_lib/mcp-store.js';
import {
  createWorkout, updateWorkout, deleteWorkout, listWorkouts,
} from './_lib/garmin-write.js';
import {
  getSleepDaily, getWeightRange, getTrainingReadiness, getFitnessStatus, getPlannedWorkouts,
} from './_lib/garmin-live.js';

// ── Definición de tools (JSON Schema puro: sin dependencia de zod) ───────────
const dateArg = { type: 'string', description: 'Fecha ISO YYYY-MM-DD (opcional)' };

const TOOLS = [
  {
    name: 'list_activities',
    description: 'Lista actividades de Strava (resumen) con filtros. Paginado para no saturar el contexto.',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg,
        to: dateArg,
        sport: { type: 'string', description: 'Tipo Strava exacto, p.ej. Run, TrailRun, Ride' },
        only_running: { type: 'boolean', description: 'Solo carreras (Run/TrailRun/VirtualRun)' },
        min_distance_km: { type: 'number' },
        max_distance_km: { type: 'number', description: 'Distancia máxima (comparar sesiones equivalentes)' },
        hr_min: { type: 'number', description: 'FC media mínima (bpm)' },
        hr_max: { type: 'number', description: 'FC media máxima (bpm)' },
        flat_only: { type: 'boolean', description: 'Solo salidas llanas (<10 m de desnivel por km)' },
        hr_source: { type: 'string', enum: ['strap', 'wrist', 'unknown'], description: 'Filtra por origen de la FC (banda/muñeca)' },
        limit: { type: 'number', description: 'Máx. resultados (por defecto 50, tope 200)' },
        offset: { type: 'number', description: 'Desplazamiento para paginar (por defecto 0)' },
      },
    },
  },
  {
    name: 'get_activity',
    description: 'Detalle completo de una actividad: parciales, splits por km, best efforts, tramos llanos, polyline, desacoplamiento, GAP y (si hay Garmin) origen de FC, laps reales con tipo INTERVAL/REST, potencia por lap y WBGT.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: ['string', 'number'], description: 'ID de la actividad Strava' } },
      required: ['id'],
    },
  },
  {
    name: 'activity_stats',
    description: 'Agregados de las actividades en un rango: total km, tiempo, desnivel y desglose por tipo.',
    inputSchema: {
      type: 'object',
      properties: { from: dateArg, to: dateArg, only_running: { type: 'boolean' } },
    },
  },
  {
    name: 'list_running_dynamics',
    description: 'Running dynamics de Garmin (cadencia, GCT, oscilación/ratio vertical, zancada, potencia, carga, training effect, VO2max) y origen de FC (banda/muñeca) por carrera. Medias sobre todo el rango + runs paginados.',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg,
        limit: { type: 'number', description: 'Máx. runs devueltos (por defecto 50, tope 200)' },
        offset: { type: 'number', description: 'Desplazamiento para paginar' },
      },
    },
  },
  {
    name: 'get_personal_bests',
    description: 'Mejores marcas (Personal Bests) en 5K, 10K, media maratón y maratón (desde best_efforts de Strava), y llanas Flat 1K/2K (desde flat_efforts). Top-5 por distancia con tiempo, ritmo, fecha y si es parcial/llano. Igual que el panel de la app.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_hrv_resting',
    description: 'VFC (HRV) nocturna y FC en reposo por día (Garmin), con Body Battery si está disponible.',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
  },
  {
    name: 'list_sleep',
    description: 'Resumen de sueño semanal (Garmin): duración, fases REM/profundo/ligero y score.',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
  },
  {
    name: 'list_sleep_daily',
    description: 'Sueño noche a noche (Garmin, en vivo): fases profundo/REM/ligero/despierto, score, estrés nocturno, respiración, HRV nocturna y FC reposo. Rango por defecto: últimos 14 días (usa from/to para más).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
  },
  {
    name: 'list_weight',
    description: 'Peso y composición corporal por día (báscula, en vivo): peso, IMC, % grasa, masa muscular, % agua. Rango por defecto: últimos 14 días (usa from/to para más).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
  },
  {
    name: 'get_training_readiness',
    description: 'Training readiness de Garmin (en vivo): score y nivel del día con sus factores (sueño, tiempo de recuperación, ACWR, VFC, estrés). Opcional: date.',
    inputSchema: { type: 'object', properties: { date: dateArg } },
  },
  {
    name: 'get_fitness_status',
    description: 'Estado de forma de Garmin (en vivo): VO2max carrera y ciclismo, training status, carga aguda/crónica y ratio ACWR, balance aeróbico/anaeróbico, y scores de resistencia/colina. Opcional: date.',
    inputSchema: { type: 'object', properties: { date: dateArg } },
  },
  {
    name: 'list_planned_workouts',
    description: 'Entrenos planificados y carreras futuras del calendario de Garmin (en vivo), con fecha, título, deporte y bandera de carrera. Por defecto los próximos 3 meses.',
    inputSchema: { type: 'object', properties: { months: { type: 'number', description: 'Nº de meses a mirar (tope 6)' } } },
  },
  {
    name: 'get_training_load_model',
    description: 'Modelo de Banister: serie diaria de carga crónica (CTL), aguda (ATL) y forma (TSB) con la rampa semanal, desde el training_load de Garmin.',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
  },
  {
    name: 'get_health_alerts',
    description: 'Alertas de patrón sobre VFC/FC reposo/Body Battery: firma de infección o sobrecarga (Body Battery máx <55 dos noches seguidas, o VFC bajo baseline con FC reposo elevada).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
  },
  {
    name: 'detect_threshold_efforts',
    description: 'Detecta esfuerzos de test de umbral (bloque continuo de 20–45 min por encima del 88% de FCmax) y devuelve LTHR y ritmo umbral estimados, con bandera de si la FC se estabilizó (test válido) o derivó (contaminado).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
  },
  // ── Escritura en Garmin (usa las credenciales guardadas del usuario) ───────
  {
    name: 'list_garmin_workouts',
    description: 'Lista los entrenos guardados en Garmin (id, nombre, deporte, fecha) para poder editarlos o borrarlos.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Máx. resultados (tope 100)' } } },
  },
  {
    name: 'create_garmin_workout',
    description: 'Crea un entreno estructurado de carrera en Garmin (se sincroniza al reloj). Spec de alto nivel con pasos por tiempo/distancia y objetivo opcional de ritmo/FC/potencia; soporta repeticiones (p.ej. 4×(interval+recovery)).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        steps: {
          type: 'array',
          description: 'Lista de pasos. Cada paso: { kind, duration:{type,value,unit}, target? } o { kind:"repeat", repeats, steps:[...] }.',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['warmup', 'interval', 'recovery', 'rest', 'cooldown', 'repeat'] },
              repeats: { type: 'number', description: 'Solo kind=repeat: nº de repeticiones' },
              steps: { type: 'array', description: 'Solo kind=repeat: pasos internos', items: { type: 'object' } },
              duration: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['distance', 'time', 'lap.button'] },
                  value: { type: 'number' },
                  unit: { type: 'string', enum: ['m', 'km', 's', 'min'] },
                },
              },
              target: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['no.target', 'pace', 'heart.rate', 'power', 'cadence'] },
                  low: { type: 'number', description: 'pace en min/km; FC en bpm; potencia en W; cadencia en spm' },
                  high: { type: 'number' },
                  zone: { type: 'number', description: 'nº de zona en vez de rango' },
                },
              },
            },
            required: ['kind'],
          },
        },
      },
      required: ['name', 'steps'],
    },
  },
  {
    name: 'update_garmin_workout',
    description: 'Modifica un entreno existente en Garmin SIN duplicarlo (mismo workout_id). Misma spec que create_garmin_workout.',
    inputSchema: {
      type: 'object',
      properties: {
        workout_id: { type: ['string', 'number'] },
        name: { type: 'string' },
        description: { type: 'string' },
        steps: { type: 'array', items: { type: 'object' } },
      },
      required: ['workout_id', 'name', 'steps'],
    },
  },
  {
    name: 'delete_garmin_workout',
    description: 'Borra un entreno de Garmin por su workout_id (usa list_garmin_workouts para obtenerlo).',
    inputSchema: {
      type: 'object',
      properties: { workout_id: { type: ['string', 'number'] } },
      required: ['workout_id'],
    },
  },
  // ── Contrato ChatGPT: search + fetch ──────────────────────────────────────
  {
    name: 'search',
    description: 'Busca actividades por nombre, tipo o fecha. Devuelve resultados con id para usar en fetch.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'fetch',
    description: 'Recupera el documento completo de una actividad por su id (el que devuelve search).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];

// Las tools en vivo/escritura hacen login + varias peticiones a Garmin: damos margen.
export const config = { maxDuration: 60 };

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// Respuesta JSON con res crudo de Node (no depende del azúcar .status().json() de
// Vercel, porque este handler comparte res con el transporte MCP que escribe raw).
function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

// ── Ejecución de cada tool para un userId concreto ───────────────────────────
async function runTool(userId, name, args = {}) {
  switch (name) {
    case 'list_activities': {
      const all = await getActivities(userId);
      const filtered = filterActivities(all, args);
      const offset = Math.max(0, args.offset || 0);
      const limit = Math.min(200, Math.max(1, args.limit || 50));
      const page = filtered.slice(offset, offset + limit);
      return text({
        total: filtered.length, offset, limit,
        activities: page.map(shapeSummary),
      });
    }
    case 'get_activity': {
      const all = await getActivities(userId);
      const a = all.find((x) => String(x.id) === String(args.id));
      if (!a) return text({ error: `Actividad ${args.id} no encontrada` });
      return text(shapeFull(a));
    }
    case 'activity_stats': {
      const all = await getActivities(userId);
      return text(summarizeActivities(filterActivities(all, args)));
    }
    case 'list_running_dynamics':
      return text(await listRunningDynamics(userId, args));
    case 'get_personal_bests':
      return text(await getPersonalBests(userId));
    case 'list_hrv_resting':
      return text({ rows: await getHrvResting(userId, args) });
    case 'list_sleep':
      return text({ weeks: await getSleep(userId, args) });
    case 'list_sleep_daily':
      return text(await getSleepDaily(userId, args));
    case 'list_weight':
      return text(await getWeightRange(userId, args));
    case 'get_training_readiness':
      return text(await getTrainingReadiness(userId, args));
    case 'get_fitness_status':
      return text(await getFitnessStatus(userId, args));
    case 'list_planned_workouts':
      return text(await getPlannedWorkouts(userId, args));
    case 'get_training_load_model':
      return text(await getTrainingLoadModel(userId, args));
    case 'get_health_alerts':
      return text(await getHealthAlerts(userId, args));
    case 'detect_threshold_efforts':
      return text(await detectThresholdTests(userId, args));

    case 'list_garmin_workouts':
      return text(await listWorkouts(userId, args));
    case 'create_garmin_workout':
      return text(await createWorkout(userId, args));
    case 'update_garmin_workout':
      return text(await updateWorkout(userId, args.workout_id, args));
    case 'delete_garmin_workout':
      return text(await deleteWorkout(userId, args.workout_id));

    case 'search': {
      const q = String(args.query || '').toLowerCase().trim();
      const all = await getActivities(userId);
      const hits = (q
        ? all.filter((a) =>
            (a.name || '').toLowerCase().includes(q) ||
            (a.type || '').toLowerCase().includes(q) ||
            (a.start_date || '').toLowerCase().includes(q))
        : all
      ).slice(0, 25);
      return text({
        results: hits.map((a) => ({
          id: String(a.id),
          title: `${a.name} — ${new Date(a.start_date).toLocaleDateString('es-ES')}`,
          url: `https://www.strava.com/activities/${a.id}`,
        })),
      });
    }
    case 'fetch': {
      const all = await getActivities(userId);
      const a = all.find((x) => String(x.id) === String(args.id));
      if (!a) return text({ error: `Actividad ${args.id} no encontrada` });
      const full = shapeFull(a);
      return text({
        id: String(a.id),
        title: `${a.name} — ${new Date(a.start_date).toLocaleDateString('es-ES')}`,
        text: JSON.stringify(full, null, 2),
        url: `https://www.strava.com/activities/${a.id}`,
        metadata: { type: a.type, distance_km: full.distance_km, date: a.start_date },
      });
    }
    default:
      return text({ error: `Tool desconocida: ${name}` });
  }
}

function buildServer(userId) {
  const server = new Server(
    { name: 'runanalyzer', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      return await runTool(userId, req.params.name, req.params.arguments || {});
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  });
  return server;
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Streamable HTTP stateless: solo POST lleva JSON-RPC. GET/DELETE no se usan.
  if (req.method !== 'POST') {
    return sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed' }, id: null }, { Allow: 'POST, OPTIONS' });
  }

  // ── Auth Bearer ────────────────────────────────────────────────────────────
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  let userId = null;
  if (token) {
    try { userId = (await verifyAccessToken(token)).sub; } catch { userId = null; }
  }
  if (!userId) {
    return sendJson(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }, {
      'WWW-Authenticate': `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`,
    });
  }

  // ── Servir la petición MCP (nuevo server+transport por request: stateless) ──
  const server = buildServer(userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) {
      sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: e.message }, id: null });
    }
  }
}
