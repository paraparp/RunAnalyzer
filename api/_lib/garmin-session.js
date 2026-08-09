// ============================================================================
// garmin-session — cliente de Garmin autenticado con las credenciales guardadas
// del usuario (`garmin_creds` en user_storage). Lo comparten las capas de lectura
// en vivo (garmin-live) y de escritura (garmin-write). Las credenciales nunca
// salen hacia el cliente/LLM: se usan solo server-side para hablar con Garmin.
// ============================================================================
import { createClient } from './garmin-helpers.js';
import { readKey } from './mcp-store.js';

// Cache de clientes ya logueados por usuario. Cada `createClient` hace un login
// completo contra Garmin; sin cache, cada tool en vivo/escritura re-loguea (y las
// que iteran por día encadenan decenas de requests). Los lambdas calientes de
// Vercel reutilizan proceso, así que este Map sobrevive entre invocaciones y evita
// el login repetido. TTL corto para no arrastrar sesiones caducadas.
const _clients = new Map(); // userId -> { client, ts }
const TTL_MS = 5 * 60 * 1000;

export async function getGarminClientFor(userId) {
  const creds = await readKey(userId, 'garmin_creds');
  if (!creds?.username || !creds?.password) {
    throw new Error('No hay credenciales de Garmin guardadas. Conéctate a Garmin en la app primero.');
  }
  const cached = _clients.get(userId);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.client;
  if (cached) _clients.delete(userId); // sesión caducada: no retener el cliente muerto
  const client = await createClient(creds.username, creds.password);
  _clients.set(userId, { client, ts: Date.now() });
  return client;
}
