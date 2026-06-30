// Verifica la sesión de Supabase a partir del header Authorization: Bearer <jwt>.
// Sirve para proteger los endpoints que usan API keys del servidor (IA), de modo
// que solo usuarios autenticados puedan consumirlos (evita abuso de cuota).
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = (url && anon) ? createClient(url, anon) : null;

/** Devuelve el usuario autenticado del request, o null si no hay token válido. */
export async function getUserFromReq(req) {
  if (!supabase) return null;
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error) return null;
    return data?.user ?? null;
  } catch {
    return null;
  }
}

/** Helper para serverless: responde 401 y devuelve false si no hay sesión. */
export async function ensureAuth(req, res) {
  const user = await getUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'No autorizado: inicia sesión.' });
    return null;
  }
  return user;
}
