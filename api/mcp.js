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
  getHrvResting, getSleep,
} from './_lib/mcp-store.js';

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
        limit: { type: 'number', description: 'Máx. resultados (por defecto 50, tope 200)' },
        offset: { type: 'number', description: 'Desplazamiento para paginar (por defecto 0)' },
      },
    },
  },
  {
    name: 'get_activity',
    description: 'Detalle completo de una actividad: parciales, splits por km, best efforts, tramos llanos y polyline.',
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
    name: 'list_hrv_resting',
    description: 'VFC (HRV) nocturna y FC en reposo por día (Garmin), con Body Battery si está disponible.',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
  },
  {
    name: 'list_sleep',
    description: 'Resumen de sueño semanal (Garmin): duración, fases REM/profundo/ligero y score.',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
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
    case 'list_hrv_resting':
      return text({ rows: await getHrvResting(userId, args) });
    case 'list_sleep':
      return text({ weeks: await getSleep(userId, args) });

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
