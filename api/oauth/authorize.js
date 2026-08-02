// Authorization endpoint (OAuth 2.1 + PKCE).
//   GET  → muestra un formulario de login (email + contraseña de Supabase).
//   POST → autentica contra Supabase Auth y, si es válido, emite un authorization
//          code (JWT 5 min con el PKCE embebido) y redirige a redirect_uri.
import { createClient } from '@supabase/supabase-js';
import { applyCors, decodeClient, issueAuthCode } from '../_lib/mcp-oauth.js';

const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supaAnon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage({ params, error }) {
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RunAnalyzer · Autorizar acceso</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
  .card{background:#1e293b;padding:2rem;border-radius:16px;width:min(92vw,380px);box-shadow:0 10px 40px rgba(0,0,0,.4)}
  h1{font-size:1.15rem;margin:0 0 .25rem} p{color:#94a3b8;font-size:.85rem;margin:0 0 1.25rem}
  label{display:block;font-size:.8rem;margin:.75rem 0 .25rem;color:#cbd5e1}
  input[type=email],input[type=password]{width:100%;padding:.65rem .75rem;border-radius:9px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;box-sizing:border-box;font-size:.95rem}
  button{margin-top:1.25rem;width:100%;padding:.7rem;border:0;border-radius:9px;background:#059669;color:#fff;font-weight:700;font-size:.95rem;cursor:pointer}
  .err{background:#7f1d1d;color:#fecaca;padding:.6rem .75rem;border-radius:9px;font-size:.8rem;margin-bottom:1rem}
</style></head><body>
<form class="card" method="POST" action="/api/oauth/authorize">
  <h1>Conectar con RunAnalyzer</h1>
  <p>Inicia sesión para dar acceso a tus datos de entrenamiento.</p>
  ${error ? `<div class="err">${esc(error)}</div>` : ''}
  <label>Email</label>
  <input type="email" name="email" required autocomplete="username">
  <label>Contraseña</label>
  <input type="password" name="password" required autocomplete="current-password">
  ${hidden}
  <button type="submit">Autorizar acceso</button>
</form></body></html>`;
}

const OAUTH_KEYS = ['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'code_challenge', 'code_challenge_method'];

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const src = req.method === 'POST' ? req.body || {} : req.query || {};
  const params = Object.fromEntries(OAUTH_KEYS.map((k) => [k, src[k] ?? '']));

  // Validaciones básicas del cliente/redirect.
  const client = await decodeClient(params.client_id);
  const redirectOk = client && (!client.redirect_uris?.length || client.redirect_uris.includes(params.redirect_uri));
  if (!params.client_id || !params.redirect_uri || (client && !redirectOk)) {
    return res.status(400).send('invalid_request: client_id / redirect_uri no válidos');
  }
  if (params.code_challenge_method && params.code_challenge_method !== 'S256') {
    return res.status(400).send('invalid_request: solo se admite PKCE S256');
  }

  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(loginPage({ params, error: null }));
  }

  // POST → autenticar contra Supabase.
  if (!supaUrl || !supaAnon) return res.status(500).send('Servidor sin Supabase configurado');
  const supabase = createClient(supaUrl, supaAnon, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: src.email || '', password: src.password || '',
  });
  if (error || !data?.user) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send(loginPage({ params, error: 'Credenciales incorrectas.' }));
  }

  const code = await issueAuthCode({
    userId: data.user.id,
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    scope: params.scope || 'read',
  });

  const url = new URL(params.redirect_uri);
  url.searchParams.set('code', code);
  if (params.state) url.searchParams.set('state', params.state);
  res.setHeader('Location', url.toString());
  return res.status(302).end();
}
