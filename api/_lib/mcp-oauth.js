// ============================================================================
// mcp-oauth — servidor OAuth 2.1 mínimo y SIN ESTADO para el MCP remoto.
//
// Claude (Custom Connectors) y ChatGPT (connectors) solo enlazan servidores MCP
// remotos vía OAuth con PKCE + registro dinámico de cliente (RFC 7591). Como las
// funciones de Vercel no comparten memoria entre invocaciones, todo se hace
// STATELESS: los authorization codes, access/refresh tokens y hasta el client_id
// son JWT firmados con MCP_JWT_SECRET. No hace falta ninguna tabla nueva.
//
// La identidad real la pone Supabase Auth (email+password) en /api/oauth/authorize.
// ============================================================================
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomUUID } from 'node:crypto';

const secret = () => {
  const s = process.env.MCP_JWT_SECRET;
  if (!s) throw new Error('Falta MCP_JWT_SECRET en el servidor');
  return new TextEncoder().encode(s);
};

// ── Base URL desde el request (robusto en prod/preview de Vercel) ────────────
export function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
export const resourceUrl = (req) => `${baseUrl(req)}/api/mcp`;

// ── Firmar / verificar JWT genéricos ─────────────────────────────────────────
async function sign(payload, expiration) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(secret());
}
async function verify(token, expectedTyp) {
  const { payload } = await jwtVerify(token, secret());
  if (expectedTyp && payload.typ !== expectedTyp) throw new Error('tipo de token inválido');
  return payload;
}

// ── Registro dinámico de cliente ─────────────────────────────────────────────
// El client_id es un JWT que lleva dentro los redirect_uris registrados, así que
// no necesitamos persistirlo: al validar el authorize lo verificamos y decodificamos.
export async function registerClient({ redirect_uris = [], client_name } = {}) {
  const client_id = await sign({ typ: 'client', redirect_uris, client_name }, '3650d');
  return {
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris,
    client_name,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
}
export async function decodeClient(client_id) {
  try { return await verify(client_id, 'client'); } catch { return null; }
}

// ── Authorization code (5 min) con datos PKCE embebidos ──────────────────────
export async function issueAuthCode({ userId, clientId, redirectUri, codeChallenge, scope }) {
  return sign(
    { typ: 'code', sub: userId, cid: clientId, ru: redirectUri, cc: codeChallenge, scope, jti: randomUUID() },
    '5m',
  );
}
export const verifyAuthCode = (code) => verify(code, 'code');

// ── Access / refresh tokens ──────────────────────────────────────────────────
export async function issueAccessToken({ userId, scope, aud }) {
  return sign({ typ: 'access', sub: userId, scope, aud }, '1h');
}
export async function issueRefreshToken({ userId, scope, aud }) {
  return sign({ typ: 'refresh', sub: userId, scope, aud }, '30d');
}
export const verifyAccessToken = (token) => verify(token, 'access');
export const verifyRefreshToken = (token) => verify(token, 'refresh');

// ── PKCE S256 ────────────────────────────────────────────────────────────────
export function pkceMatches(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const hash = createHash('sha256').update(verifier).digest('base64url');
  return hash === challenge;
}

// ── CORS helper reutilizable ─────────────────────────────────────────────────
export function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
}
