// ============================================================================
// garmin-session — cliente de Garmin autenticado con las credenciales guardadas
// del usuario (`garmin_creds` en user_storage). Lo comparten las capas de lectura
// en vivo (garmin-live) y de escritura (garmin-write). Las credenciales nunca
// salen hacia el cliente/LLM: se usan solo server-side para hablar con Garmin.
// ============================================================================
import { createClient } from './garmin-helpers.js';
import { readKey } from './mcp-store.js';

export async function getGarminClientFor(userId) {
  const creds = await readKey(userId, 'garmin_creds');
  if (!creds?.username || !creds?.password) {
    throw new Error('No hay credenciales de Garmin guardadas. Conéctate a Garmin en la app primero.');
  }
  return createClient(creds.username, creds.password);
}
