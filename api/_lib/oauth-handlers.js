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
    return fail(res, 500, 'server_error', e.message);
  }
}
