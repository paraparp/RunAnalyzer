// ============================================================================
// Guardián de administración.
//
// La frontera real del área de admin está AQUÍ, no en el UI: cada request se
// revalida contra la tabla `app_admins` leída con la SERVICE ROLE key. El token
// del usuario solo sirve para saber QUIÉN es; el rol nunca viaja en el JWT ni
// se acepta desde el cliente (un flag en el body o una cabecera se ignoran).
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import { ensureAuth } from './auth.js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client = null;
/** Cliente con service role (salta RLS). Solo para uso en servidor. */
export function serviceClient() {
  if (_client) return _client;
  const missing = [!url && 'SUPABASE_URL', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  if (missing.length) {
    throw new Error(`Falta ${missing.join(' y ')} en el servidor (.env en local, variables de entorno en Vercel)`);
  }
  _client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return _client;
}

/** ¿Este userId está en app_admins? Consulta directa, sin caché: el rol puede revocarse. */
export async function isAdminUser(userId) {
  if (!userId) return false;
  const { data, error } = await serviceClient()
    .from('app_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`app_admins: ${error.message}`);
  return Boolean(data);
}

/**
 * Helper para serverless: exige sesión Y rol admin. Devuelve el usuario, o null
 * habiendo respondido ya 401/403. El 403 es deliberadamente escueto: no confirma
 * ni desmiente la existencia del área.
 */
export async function ensureAdmin(req, res) {
  const user = await ensureAuth(req, res);
  if (!user) return null;
  let ok = false;
  try {
    ok = await isAdminUser(user.id);
  } catch (e) {
    res.status(500).json({ error: e.message });
    return null;
  }
  if (!ok) {
    res.status(403).json({ error: 'Prohibido' });
    return null;
  }
  return user;
}
