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
import { applyCors, baseUrl, resourceUrl, verifyAccessToken } from './_lib/mcp-oauth.js';
import {
  getActivities, filterActivities, activityStats, shapeSummary, shapeFull,
  listRunningDynamics, getHrvResting, getSleep, getPersonalBests,
  getPersonalRecords, getBestEffortsProgression,
  getTrainingLoadModel, getHealthAlerts, detectThresholdTests, getTimeInZones,
} from './_lib/mcp-store.js';
import {
  createWorkout, updateWorkout, deleteWorkout, listWorkouts, scheduleWorkout, getWorkout,
} from './_lib/garmin-write.js';
import {
  getSleepDaily, getWeightRange, getTrainingReadiness, getFitnessStatus, getPlannedWorkouts,
} from './_lib/garmin-live.js';

// ── Definición de tools (JSON Schema puro: sin dependencia de zod) ───────────
// Cada tool declara su `name`/`description`/`inputSchema` (lo que ve el cliente) y
// su `run(userId, args)` juntos, para que schema y handler no puedan desincronizarse.
const dateArg = { type: 'string', description: 'Fecha ISO YYYY-MM-DD (opcional)' };

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

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
        avg_hr_min: { type: 'number', description: 'FC MEDIA mínima de la actividad (bpm)' },
        avg_hr_max: { type: 'number', description: 'FC MEDIA máxima de la actividad (bpm)' },
        flat_only: { type: 'boolean', description: 'Solo salidas llanas (<10 m de desnivel por km)' },
        hr_source: { type: 'string', enum: ['strap', 'wrist', 'unknown'], description: 'Filtra por origen de la FC (banda/muñeca)' },
        limit: { type: 'number', description: 'Máx. resultados (por defecto 50, tope 200)' },
        offset: { type: 'number', description: 'Desplazamiento para paginar (por defecto 0)' },
      },
    },
    run: async (userId, args) => {
      const all = await getActivities(userId);
      const filtered = filterActivities(all, args);
      const offset = Math.max(0, args.offset || 0);
      const limit = Math.min(200, Math.max(1, args.limit || 50));
      const page = filtered.slice(offset, offset + limit);
      return text({
        total: filtered.length, offset, limit,
        activities: page.map(shapeSummary),
      });
    },
  },
  {
    name: 'get_activity',
    description: 'Detalle completo de una actividad: parciales, splits por km, best efforts, tramos llanos, polyline, desacoplamiento, GAP y (si hay Garmin) origen de FC, laps reales (con is_autolap), potencia por lap y WBGT. Usa `include` para pedir solo lo necesario y ahorrar contexto (la actividad completa pesa ~10-12k tokens).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: ['string', 'number'], description: 'ID de la actividad Strava' },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['garmin', 'laps', 'splits', 'best_efforts', 'flat_efforts', 'decoupling', 'gap', 'map'] },
          description: 'Secciones a incluir (por defecto todas). El resumen base va siempre.',
        },
      },
      required: ['id'],
    },
    run: async (userId, args) => {
      const all = await getActivities(userId);
      const a = all.find((x) => String(x.id) === String(args.id));
      if (!a) return text({ error: `Actividad ${args.id} no encontrada` });
      return text(shapeFull(a, args.include));
    },
  },
  {
    name: 'activity_stats',
    description: 'Agregados de las actividades en un rango: total km, tiempo, desnivel y desglose por tipo. Incluye `garmin_only` (lo que hay en Garmin y no en Strava) y `combined` (volumen real). Con `granularity=weekly` devuelve el desglose por semana con la rampa % (para seguir la subida de volumen).',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg, only_running: { type: 'boolean' },
        granularity: { type: 'string', enum: ['total', 'weekly'], description: 'total (por defecto) o weekly (km/tiempo/rampa por semana)' },
      },
    },
    run: (userId, args) => activityStats(userId, args).then(text),
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
    run: (userId, args) => listRunningDynamics(userId, args).then(text),
  },
  {
    name: 'get_personal_bests',
    description: 'Mejores marcas (Personal Bests) en 5K, 10K, media maratón y maratón (desde best_efforts de Strava), y llanas Flat 1K/2K (desde flat_efforts). Top-5 por distancia (ordenado por tiempo), con ritmo, fecha, `exact` (distancia justa vs sobre-distancia con `distance_delta_m`) y `source` (best_effort | total_distance | flat_effort | splits_window, para no confundir procedencias). El `pr` prefiere una marca `exact` cuando el margen es grande. Solo carreras por defecto.',
    inputSchema: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'Tipo Strava (por defecto solo carreras)' },
        from: dateArg, to: dateArg,
      },
    },
    run: (userId, args) => getPersonalBests(userId, args).then(text),
  },
  {
    name: 'personal_records',
    description: 'Récords personales por distancia (400m, 1k, 1 milla, 5k, 10k, 15k, 20k, media, maratón…) desde best_efforts de Strava, usando moving_time. Top-5 por distancia (configurable) con actividad, fecha, ritmo, FC media y origen de FC. Con from/to da el récord de temporada.',
    inputSchema: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'Tipo Strava (por defecto solo carreras)' },
        top: { type: 'number', description: 'Nº de mejores por distancia (por defecto 5, tope 10)' },
        from: dateArg, to: dateArg,
      },
    },
    run: (userId, args) => getPersonalRecords(userId, args).then(text),
  },
  {
    name: 'best_efforts_progression',
    description: 'Serie temporal del best_effort de una distancia (cada actividad, cronológico) marcando el récord acumulado. Para gráfica de progreso real. Requiere distance (p.ej. "5k", "10k", "half-marathon").',
    inputSchema: {
      type: 'object',
      properties: {
        distance: { type: 'string', description: 'Nombre de la distancia: 5k, 10k, half-marathon, marathon…' },
        sport: { type: 'string' },
        from: dateArg, to: dateArg,
      },
      required: ['distance'],
    },
    run: (userId, args) => getBestEffortsProgression(userId, args).then(text),
  },
  {
    name: 'list_hrv_resting',
    description: 'VFC (HRV) nocturna y FC en reposo por día (Garmin), con Body Battery. Incluye baseline de Garmin (`hrv_baseline`: {low, high, marker} en ms — rango balanceado y marcador de Garmin dentro de él), media móvil 7d y un `current` con `hrv_deviation` (above|below|within) para el semáforo HRV.',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getHrvResting(userId, args).then(text),
  },
  {
    name: 'list_sleep',
    description: 'Resumen de sueño semanal (Garmin): duración, fases REM/profundo/ligero y score. Marca `partial` la semana en curso; para noches recientes usa list_sleep_daily.',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getSleep(userId, args).then(text),
  },
  {
    name: 'list_sleep_daily',
    description: 'Sueño noche a noche (Garmin, en vivo): fases profundo/REM/ligero/despierto, score, estrés nocturno, respiración, HRV nocturna y FC reposo. Rango por defecto: últimos 14 días (usa from/to para más).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getSleepDaily(userId, args).then(text),
  },
  {
    name: 'list_weight',
    description: 'Peso y composición corporal por día (báscula, en vivo): peso, IMC, % grasa, masa muscular, % agua. Rango por defecto: últimos 14 días (usa from/to para más).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getWeightRange(userId, args).then(text),
  },
  {
    name: 'get_training_readiness',
    description: 'Training readiness de Garmin (en vivo): score y nivel del día con sus factores (sueño, tiempo de recuperación, ACWR, VFC, estrés). Opcional: date.',
    inputSchema: { type: 'object', properties: { date: dateArg } },
    run: (userId, args) => getTrainingReadiness(userId, args).then(text),
  },
  {
    name: 'get_fitness_status',
    description: 'Estado de forma de Garmin (en vivo): VO2max carrera y ciclismo, training status, carga aguda/crónica y ratio ACWR, balance aeróbico/anaeróbico, y scores de resistencia/colina. Opcional: date.',
    inputSchema: { type: 'object', properties: { date: dateArg } },
    run: (userId, args) => getFitnessStatus(userId, args).then(text),
  },
  {
    name: 'list_planned_workouts',
    description: 'Entrenos planificados y carreras futuras del calendario de Garmin (en vivo), con fecha, título, deporte y bandera de carrera. Por defecto los próximos 3 meses.',
    inputSchema: { type: 'object', properties: { months: { type: 'number', description: 'Nº de meses a mirar (tope 6)' } } },
    run: (userId, args) => getPlannedWorkouts(userId, args).then(text),
  },
  {
    name: 'get_training_load_model',
    description: 'Modelo de Banister: carga crónica (CTL), aguda (ATL) y forma (TSB/tsb_today) con la rampa semanal, desde el training_load de Garmin. Usa granularity=weekly o summary_only para no saturar el contexto.',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg,
        granularity: { type: 'string', enum: ['daily', 'weekly'], description: 'daily (por defecto) o weekly (colapsa la serie por semana)' },
        summary_only: { type: 'boolean', description: 'Devuelve solo el estado actual, sin la serie' },
      },
    },
    run: (userId, args) => getTrainingLoadModel(userId, args).then(text),
  },
  {
    name: 'get_health_alerts',
    description: 'Alertas de patrón sobre VFC/FC reposo/Body Battery: firma de infección o sobrecarga (Body Battery máx <55 dos noches seguidas, o VFC bajo baseline con FC reposo elevada).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getHealthAlerts(userId, args).then(text),
  },
  {
    name: 'time_in_zones',
    description: 'Tiempo en zonas de FC (5 zonas por % de FCmax) en un rango, con reparto polarizado easy/moderado/hard. Aproximado desde la FC media por split (sin stream). `granularity=weekly` da el reparto por semana; `hr_max` opcional (si no, se estima).',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg,
        sport: { type: 'string', description: 'Tipo Strava (por defecto solo carreras)' },
        hr_max: { type: 'number', description: 'FCmax en bpm (recomendado); si se omite, se estima' },
        granularity: { type: 'string', enum: ['total', 'weekly'], description: 'total (por defecto) o weekly' },
      },
    },
    run: (userId, args) => getTimeInZones(userId, args).then(text),
  },
  {
    name: 'detect_threshold_efforts',
    description: 'Detecta esfuerzos de test de umbral (bloque continuo de 20–45 min por encima del 88% de FCmax fisiológica) y devuelve LTHR y ritmo umbral estimados, con bandera de si la FC se estabilizó (test válido) o derivó (contaminado). FCmax fisiológica: se estima (p98 últimos 12 meses) salvo que pases hr_max.',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg,
        hr_max: { type: 'number', description: 'FCmax fisiológica REAL en bpm (recomendado); si se omite, se estima (p98 últimos 12 meses)' },
      },
    },
    run: (userId, args) => detectThresholdTests(userId, args).then(text),
  },
  // ── Escritura en Garmin (usa las credenciales guardadas del usuario) ───────
  {
    name: 'list_garmin_workouts',
    description: 'Lista los entrenos guardados en Garmin (id, nombre, deporte, fecha) para poder editarlos o borrarlos.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Máx. resultados (tope 100)' } } },
    run: (userId, args) => listWorkouts(userId, args).then(text),
  },
  {
    name: 'get_garmin_workout',
    description: 'Lee los pasos completos de un entreno de Garmin (misma spec de alto nivel que create/update: kind, duration, target, repeticiones). Úsalo antes de update_garmin_workout para editar sin reescribir los pasos a ciegas.',
    inputSchema: {
      type: 'object',
      properties: { workout_id: { type: ['string', 'number'] } },
      required: ['workout_id'],
    },
    run: (userId, args) => getWorkout(userId, args.workout_id).then(text),
  },
  {
    name: 'create_garmin_workout',
    description: 'Crea un entreno estructurado de carrera en Garmin (se sincroniza al reloj). Spec de alto nivel con pasos por tiempo/distancia y objetivo opcional de ritmo/FC/potencia; soporta repeticiones (p.ej. 4×(interval+recovery)). Con `date` (YYYY-MM-DD) además lo agenda en el calendario.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD para agendarlo en el calendario (opcional)' },
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
    run: (userId, args) => createWorkout(userId, args).then(text),
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
    run: (userId, args) => updateWorkout(userId, args.workout_id, args).then(text),
  },
  {
    name: 'delete_garmin_workout',
    description: 'Borra un entreno de Garmin por su workout_id (usa list_garmin_workouts para obtenerlo).',
    inputSchema: {
      type: 'object',
      properties: { workout_id: { type: ['string', 'number'] } },
      required: ['workout_id'],
    },
    run: (userId, args) => deleteWorkout(userId, args.workout_id).then(text),
  },
  {
    name: 'schedule_garmin_workout',
    description: 'Agenda un entreno ya existente en una fecha del calendario de Garmin (se sincroniza al reloj). Usa list_garmin_workouts para obtener el workout_id.',
    inputSchema: {
      type: 'object',
      properties: {
        workout_id: { type: ['string', 'number'] },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD' },
      },
      required: ['workout_id', 'date'],
    },
    run: (userId, args) => scheduleWorkout(userId, args.workout_id, args.date).then(text),
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
    run: async (userId, args) => {
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
    run: async (userId, args) => {
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
    },
  },
];

// Índice name → tool para el dispatch, y la lista de descriptores que ve el cliente
// (sin `run`). Ambos derivan del mismo array: imposible que un schema no tenga handler.
const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
const TOOL_DESCRIPTORS = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

// Las tools en vivo/escritura hacen login + varias peticiones a Garmin: damos margen.
export const config = { maxDuration: 60 };

// Respuesta JSON con res crudo de Node (no depende del azúcar .status().json() de
// Vercel, porque este handler comparte res con el transporte MCP que escribe raw).
function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

// ── Ejecución de cada tool para un userId concreto ───────────────────────────
async function runTool(userId, name, args = {}) {
  const tool = TOOL_MAP.get(name);
  if (!tool) return text({ error: `Tool desconocida: ${name}` });
  return tool.run(userId, args);
}

function buildServer(userId) {
  const server = new Server(
    { name: 'runanalyzer', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DESCRIPTORS }));
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
    try {
      const claims = await verifyAccessToken(token);
      // Enforce audience (RFC 8707): un token emitido para otro recurso no vale aquí.
      // El `aud` lo pone nuestro propio token endpoint = resourceUrl(req); solo lo
      // exigimos si el token lo trae, para no invalidar tokens antiguos sin `aud`.
      if (!claims.aud || claims.aud === resourceUrl(req)) userId = claims.sub;
    } catch { userId = null; }
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
    console.error('MCP handler error:', e);
    if (!res.headersSent) {
      sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
}
