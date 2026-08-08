// ============================================================================
// oauth-handlers — toda la lógica del servidor OAuth 2.1 del MCP, en un módulo
// _lib (no cuenta como función serverless). El dispatcher api/oauth/[action].js
// enruta cada acción aquí, para no gastar una función por endpoint (límite de
// 12 funciones en el plan Hobby de Vercel).
//
// Acciones: authorization-server-metadata, protected-resource-metadata,
//           register, authorize, token.
// ============================================================================
import { createClient } from '@supabase/supabase-js';
import {
  applyCors, baseUrl, resourceUrl, decodeClient, registerClient,
  issueAuthCode, verifyAuthCode, verifyRefreshToken,
  issueAccessToken, issueRefreshToken, pkceMatches,
} from './mcp-oauth.js';
import { consumeAuthCode } from './mcp-store.js';

const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supaAnon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// ── Metadatos de descubrimiento ──────────────────────────────────────────────
export function handleAsMetadata(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const base = baseUrl(req);
  res.status(200).json({
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read'],
  });
}

export function handleProtectedResourceMetadata(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.status(200).json({
    resource: resourceUrl(req),
    authorization_servers: [baseUrl(req)],
    scopes_supported: ['read'],
    bearer_methods_supported: ['header'],
  });
}

// ── Registro dinámico de cliente (RFC 7591) ──────────────────────────────────
export async function handleRegister(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const body = req.body || {};
  const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!redirect_uris.length) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris requerido' });
  }
  const client = await registerClient({ redirect_uris, client_name: body.client_name });
  res.status(201).json(client);
}

// ── Authorize (login Supabase + emisión de code con PKCE) ────────────────────
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
  button{margin-top:1.25rem;width:100%;padding:.7rem;border:0;border-radius:9px;font-weight:700;font-size:.95rem;cursor:pointer}
  .primary{background:#059669;color:#fff}
  .google{background:#fff;color:#1f2937;display:flex;align-items:center;justify-content:center;gap:.6rem}
  .google svg{width:18px;height:18px}
  .divider{display:flex;align-items:center;gap:.75rem;margin:1.25rem 0 .25rem;color:#64748b;font-size:.75rem}
  .divider::before,.divider::after{content:"";flex:1;height:1px;background:#334155}
  .err{background:#7f1d1d;color:#fecaca;padding:.6rem .75rem;border-radius:9px;font-size:.8rem;margin-bottom:1rem}
  #g-loading{color:#94a3b8;font-size:.85rem;text-align:center;margin-top:1rem;display:none}
</style></head><body>
<div class="card">
  <h1>Conectar con RunAnalyzer</h1>
  <p>Inicia sesión para dar acceso a tus datos de entrenamiento.</p>
  <div id="err" class="err" style="${error ? '' : 'display:none'}">${esc(error || '')}</div>

  <button type="button" class="google" onclick="loginGoogle()">
    <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.1 5.5c4.1-3.8 6.5-9.4 6.5-16z"/><path fill="#FBBC05" d="M10.5 28.3c-.5-1.4-.7-2.9-.7-4.3s.3-3 .7-4.3l-7.9-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.5 2.1-8.8 2.1-6.3 0-11.7-3.7-13.5-9.8l-7.9 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
    Continuar con Google
  </button>

  <div class="divider">o con email</div>

  <form method="POST" action="/api/oauth/authorize">
    <label>Email</label>
    <input type="email" name="email" required autocomplete="username">
    <label>Contraseña</label>
    <input type="password" name="password" required autocomplete="current-password">
    ${hidden}
    <button type="submit" class="primary">Autorizar acceso</button>
  </form>
  <div id="g-loading">Completando acceso con Google…</div>
</div>
<script>
  var SUPABASE_URL = ${JSON.stringify(supaUrl || '')};
  function loginGoogle() {
    // Reutiliza el Google OAuth ya configurado en Supabase. Al volver, Supabase
    // deja la sesión en el fragmento (#access_token=...) de esta misma página.
    var redirectTo = location.origin + location.pathname + location.search;
    location.href = SUPABASE_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo);
  }
  // Al regresar de Google: recoge el token del fragmento y canjéalo por el code OAuth.
  (function () {
    var hash = new URLSearchParams(location.hash.slice(1));
    var token = hash.get('access_token');
    var hashErr = hash.get('error_description');
    if (hashErr) { document.getElementById('err').textContent = decodeURIComponent(hashErr); document.getElementById('err').style.display = ''; history.replaceState(null, '', location.pathname + location.search); return; }
    if (!token) return;
    history.replaceState(null, '', location.pathname + location.search);
    document.getElementById('g-loading').style.display = 'block';
    var q = new URLSearchParams(location.search);
    var body = { supabase_access_token: token };
    ['client_id','redirect_uri','state','scope','code_challenge','code_challenge_method','response_type']
      .forEach(function (k) { if (q.get(k)) body[k] = q.get(k); });
    fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.location) { location.href = d.location; }
        else { document.getElementById('err').textContent = 'No se pudo completar el acceso con Google.'; document.getElementById('err').style.display = ''; document.getElementById('g-loading').style.display = 'none'; }
      })
      .catch(function () { document.getElementById('err').textContent = 'Error de red.'; document.getElementById('err').style.display = ''; document.getElementById('g-loading').style.display = 'none'; });
  })();
</script>
</body></html>`;
}

const OAUTH_KEYS = ['client_id', 'redirect_uri', 'response_type', 'state', 'scope', 'code_challenge', 'code_challenge_method'];

export async function handleAuthorize(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const src = req.method === 'POST' ? req.body || {} : req.query || {};
  const params = Object.fromEntries(OAUTH_KEYS.map((k) => [k, src[k] ?? '']));

  // Validación estricta (fail-closed) del cliente y el redirect_uri.
  if (!params.client_id || !params.redirect_uri) {
    return res.status(400).send('invalid_request: falta client_id o redirect_uri');
  }
  const client = await decodeClient(params.client_id);
  if (!client) return res.status(400).send('invalid_client');
  if (!client.redirect_uris?.length || !client.redirect_uris.includes(params.redirect_uri)) {
    return res.status(400).send('invalid_request: redirect_uri no registrado');
  }
  // PKCE obligatorio (S256): sin él, un code interceptado sería canjeable.
  if (!params.code_challenge || (params.code_challenge_method && params.code_challenge_method !== 'S256')) {
    return res.status(400).send('invalid_request: se requiere PKCE S256');
  }

  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(loginPage({ params, error: null }));
  }

  // POST → autenticar contra Supabase.
  if (!supaUrl || !supaAnon) return res.status(500).send('Servidor sin Supabase configurado');
  const supabase = createClient(supaUrl, supaAnon, { auth: { persistSession: false } });

  // Helper: emite el authorization code y arma la URL de redirección.
  const buildRedirect = async (userId) => {
    const code = await issueAuthCode({
      userId,
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      scope: params.scope || 'read',
    });
    const url = new URL(params.redirect_uri);
    url.searchParams.set('code', code);
    if (params.state) url.searchParams.set('state', params.state);
    return url.toString();
  };

  // Rama Google: el navegador nos manda el access_token de Supabase obtenido tras
  // el OAuth de Google. Lo verificamos y respondemos JSON (lo consume el fetch).
  if (src.supabase_access_token) {
    const { data, error } = await supabase.auth.getUser(src.supabase_access_token);
    if (error || !data?.user) return res.status(401).json({ error: 'invalid_token' });
    return res.status(200).json({ location: await buildRedirect(data.user.id) });
  }

  // Rama email + contraseña (form clásico → redirección 302).
  const { data, error } = await supabase.auth.signInWithPassword({
    email: src.email || '', password: src.password || '',
  });
  if (error || !data?.user) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send(loginPage({ params, error: 'Credenciales incorrectas.' }));
  }
  res.setHeader('Location', await buildRedirect(data.user.id));
  return res.status(302).end();
}

// ── Token (authorization_code con PKCE + single-use; refresh_token) ──────────
const fail = (res, status, error, desc) => res.status(status).json({ error, error_description: desc });

export async function handleToken(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return fail(res, 405, 'invalid_request', 'method not allowed');

  const b = req.body || {};
  const aud = resourceUrl(req);

  try {
    if (b.grant_type === 'authorization_code') {
      const payload = await verifyAuthCode(b.code).catch(() => null);
      if (!payload) return fail(res, 400, 'invalid_grant', 'code inválido o expirado');
      if (payload.ru !== b.redirect_uri) return fail(res, 400, 'invalid_grant', 'redirect_uri no coincide');
      if (payload.cid !== b.client_id) return fail(res, 400, 'invalid_client', 'client_id no coincide');
      if (!pkceMatches(b.code_verifier, payload.cc)) return fail(res, 400, 'invalid_grant', 'PKCE no válido');

      // El redirect_uri del code debe seguir registrado en el cliente (fail-closed).
      const client = await decodeClient(b.client_id);
      if (!client || !client.redirect_uris?.includes(payload.ru)) {
        return fail(res, 400, 'invalid_client', 'cliente o redirect_uri no válidos');
      }

      // Single-use: consumo atómico del jti. Si ya se canjeó, es un replay.
      const fresh = await consumeAuthCode(payload.jti, payload.exp);
      if (!fresh) return fail(res, 400, 'invalid_grant', 'code ya utilizado');

      const claims = { userId: payload.sub, scope: payload.scope || 'read', aud };
      return res.status(200).json({
        access_token: await issueAccessToken(claims),
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: await issueRefreshToken(claims),
        scope: claims.scope,
      });
    }

    if (b.grant_type === 'refresh_token') {
      const payload = await verifyRefreshToken(b.refresh_token).catch(() => null);
      if (!payload) return fail(res, 400, 'invalid_grant', 'refresh_token inválido o expirado');
      const claims = { userId: payload.sub, scope: payload.scope || 'read', aud };
      return res.status(200).json({
        access_token: await issueAccessToken(claims),
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: await issueRefreshToken(claims),
        scope: claims.scope,
      });
    }

    return fail(res, 400, 'unsupported_grant_type', `grant_type no soportado: ${b.grant_type}`);
  } catch (e) {
    console.error('oauth token error:', e);
    return fail(res, 500, 'server_error', 'error interno');
  }
}
