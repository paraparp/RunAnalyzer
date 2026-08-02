// Token endpoint (OAuth 2.1). Intercambia:
//   grant_type=authorization_code  → valida PKCE y emite access + refresh token.
//   grant_type=refresh_token       → emite un nuevo access token.
import {
  applyCors, resourceUrl, verifyAuthCode, verifyRefreshToken,
  issueAccessToken, issueRefreshToken, pkceMatches, decodeClient,
} from '../_lib/mcp-oauth.js';
import { consumeAuthCode } from '../_lib/mcp-store.js';

const fail = (res, status, error, desc) =>
  res.status(status).json({ error, error_description: desc });

export default async function handler(req, res) {
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
