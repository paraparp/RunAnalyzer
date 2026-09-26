// ============================================================================
// /api/admin — backend del área de administración.
//
// Todo pasa por ensureAdmin(): sesión válida + fila en `app_admins` comprobada
// con la service role key EN CADA request. Si alguien descubre la ruta y la
// llama a pelo, recibe 401/403; el gating del sidebar es solo comodidad visual.
//
// Acciones (GET salvo donde se indica):
//   overview            — usuarios, actividad y tamaño de sus datos
//   user&id=<uuid>      — desglose por clave del almacén de un usuario
//   issues              — buzón de incidencias del agente, agregado
//   health              — qué está configurado en el servidor (nunca los valores)
//   set_admin (POST)    — conceder/revocar el rol a otro usuario
//   update_issue (POST) — cambiar estado/nota de una sugerencia del MCP
//   delete_issue (POST) — borrarla
//   sync_user (POST)    — forzar el sync de Garmin/Strava de un usuario
// ============================================================================
import { ensureAdmin, serviceClient } from './_lib/admin.js';
import { reportIssue, deleteIssue } from './_lib/mcp-feedback.js';
import { runFullSync } from './_lib/mcp-sync.js';

const MAX_USERS = 1000;

/** Usuarios de auth, quedándonos solo con campos no sensibles. */
async function listUsers() {
  const { data, error } = await serviceClient().auth.admin.listUsers({ page: 1, perPage: MAX_USERS });
  if (error) throw new Error(`auth.listUsers: ${error.message}`);
  return (data?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? null,
    name: u.user_metadata?.full_name || u.user_metadata?.name || null,
    picture: u.user_metadata?.avatar_url || u.user_metadata?.picture || null,
    provider: u.app_metadata?.provider ?? null,
    created_at: u.created_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
  }));
}

async function overview() {
  const db = serviceClient();
  const [users, stats, admins] = await Promise.all([
    listUsers(),
    db.rpc('admin_user_stats'),
    db.from('app_admins').select('user_id'),
  ]);
  if (stats.error) throw new Error(`admin_user_stats: ${stats.error.message}`);
  if (admins.error) throw new Error(`app_admins: ${admins.error.message}`);

  const byUser = new Map((stats.data ?? []).map((r) => [r.user_id, r]));
  const adminIds = new Set((admins.data ?? []).map((r) => r.user_id));

  const rows = users.map((u) => {
    const s = byUser.get(u.id);
    return {
      ...u,
      is_admin: adminIds.has(u.id),
      keys: s?.keys ?? 0,
      bytes: Number(s?.bytes ?? 0),
      data_updated_at: s?.updated_at ?? null,
    };
  }).sort((a, b) => String(b.last_sign_in_at ?? '').localeCompare(String(a.last_sign_in_at ?? '')));

  const now = Date.now();
  const recent = (d, days) => d && (now - new Date(d).getTime()) < days * 864e5;
  return {
    totals: {
      users: rows.length,
      admins: rows.filter((r) => r.is_admin).length,
      with_data: rows.filter((r) => r.keys > 0).length,
      active_7d: rows.filter((r) => recent(r.last_sign_in_at, 7)).length,
      active_30d: rows.filter((r) => recent(r.last_sign_in_at, 30)).length,
      bytes: rows.reduce((acc, r) => acc + r.bytes, 0),
    },
    users: rows,
  };
}

async function userDetail(id) {
  const { data, error } = await serviceClient().rpc('admin_user_keys', { target: id });
  if (error) throw new Error(`admin_user_keys: ${error.message}`);
  return { user_id: id, keys: (data ?? []).map((r) => ({ ...r, bytes: Number(r.bytes) })) };
}

/** Buzón del agente: vive en user_storage bajo `agent_feedback`, uno por usuario. */
async function issues() {
  const { data, error } = await serviceClient()
    .from('user_storage')
    .select('user_id,value,updated_at')
    .eq('key', 'agent_feedback');
  if (error) throw new Error(`agent_feedback: ${error.message}`);

  const all = [];
  for (const row of data ?? []) {
    let list = [];
    try { list = JSON.parse(row.value || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) continue;
    for (const e of list) all.push({ ...e, user_id: row.user_id });
  }
  all.sort((a, b) => String(b.last_seen_at ?? b.created_at ?? '').localeCompare(String(a.last_seen_at ?? a.created_at ?? '')));
  const count = (s) => all.filter((e) => e.status === s).length;
  return {
    totals: { total: all.length, open: count('open'), ack: count('ack'), resolved: count('resolved'), wontfix: count('wontfix') },
    issues: all.slice(0, 200),
  };
}

/**
 * Concede o revoca el rol. Dos cerrojos: no puedes revocarte a ti mismo (evita
 * quedarse sin ningún admin por accidente) ni dejar la tabla vacía.
 */
async function setAdmin(actor, { user_id, admin }) {
  if (!user_id) return { status: 400, body: { error: 'Falta user_id' } };
  if (user_id === actor.id && !admin) {
    return { status: 400, body: { error: 'No puedes revocarte el rol a ti mismo' } };
  }
  const db = serviceClient();
  if (admin) {
    const users = await listUsers();
    const target = users.find((u) => u.id === user_id);
    if (!target) return { status: 404, body: { error: 'Usuario no encontrado' } };
    const { error } = await db.from('app_admins').upsert({ user_id, email: target.email });
    if (error) throw new Error(`app_admins upsert: ${error.message}`);
  } else {
    const { error } = await db.from('app_admins').delete().eq('user_id', user_id);
    if (error) throw new Error(`app_admins delete: ${error.message}`);
  }
  return { status: 200, body: { ok: true, user_id, is_admin: Boolean(admin) } };
}

/**
 * Salud del servidor: qué integraciones están configuradas. Devuelve BOOLEANOS,
 * nunca el valor de la variable — un panel de admin no es sitio para enseñar
 * secretos, aunque quien lo mire sea admin.
 */
function health() {
  const has = (k) => Boolean(process.env[k]);
  return {
    supabase:  { url: has('SUPABASE_URL') || has('VITE_SUPABASE_URL'), service_role: has('SUPABASE_SERVICE_ROLE_KEY') },
    strava:    { client_id: has('STRAVA_CLIENT_ID'), client_secret: has('STRAVA_CLIENT_SECRET') },
    mcp:       { jwt_secret: has('MCP_JWT_SECRET') },
    cron:      { secret: has('CRON_SECRET') },
    ai: {
      anthropic:  has('ANTHROPIC_API_KEY'),
      gemini:     has('GEMINI_API_KEY'),
      groq:       has('GROQ_API_KEY'),
      openrouter: has('OPENROUTER_API_KEY'),
      zai:        has('ZAI_API_KEY'),
    },
    runtime: { node: process.version, region: process.env.VERCEL_REGION ?? null, env: process.env.VERCEL_ENV ?? 'local' },
  };
}

/** Cambia estado/nota de una sugerencia. Reusa el merge parcial de mcp-feedback. */
async function updateIssue({ user_id, issue_id, status, note }) {
  if (!user_id || !issue_id) return { status: 400, body: { error: 'Faltan user_id / issue_id' } };
  const out = await reportIssue(user_id, { issue_id, status, note });
  if (out?.error) return { status: 400, body: out };
  return { status: 200, body: out };
}

async function removeIssue({ user_id, issue_id }) {
  if (!user_id || !issue_id) return { status: 400, body: { error: 'Faltan user_id / issue_id' } };
  const out = await deleteIssue(user_id, issue_id);
  if (out?.error) return { status: 400, body: out };
  return { status: 200, body: out };
}

/** Dispara el sync pesado de un usuario. Puede tardar minutos: de ahí maxDuration. */
async function syncUser({ user_id, force = true }) {
  if (!user_id) return { status: 400, body: { error: 'Falta user_id' } };
  const result = await runFullSync(user_id, { force: Boolean(force), backfill: true });
  return { status: 200, body: result };
}

// El sync manual de un usuario arrastra decenas de peticiones a Garmin/Strava.
export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const user = await ensureAdmin(req, res);
  if (!user) return;                    // ensureAdmin ya respondió 401/403

  const action = req.query?.action || (req.method === 'POST' ? req.body?.action : null) || 'overview';
  try {
    if (req.method === 'GET') {
      if (action === 'overview') return res.json(await overview());
      if (action === 'user') {
        const id = req.query?.id;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        return res.json(await userDetail(id));
      }
      if (action === 'issues') return res.json(await issues());
      if (action === 'health') return res.json(health());
      return res.status(400).json({ error: `Acción desconocida: ${action}` });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
      const post = {
        set_admin:    () => setAdmin(user, body),
        update_issue: () => updateIssue(body),
        delete_issue: () => removeIssue(body),
        sync_user:    () => syncUser(body),
      }[action];
      if (!post) return res.status(400).json({ error: `Acción desconocida: ${action}` });
      const { status, body: out } = await post();
      return res.status(status).json(out);
    }
    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
