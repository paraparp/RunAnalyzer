// Authorization Server Metadata (RFC 8414). Publica los endpoints OAuth para que
// Claude/ChatGPT hagan el flujo automático (registro dinámico + PKCE).
import { applyCors, baseUrl } from '../_lib/mcp-oauth.js';

export default function handler(req, res) {
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
