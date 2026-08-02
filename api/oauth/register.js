// Registro dinámico de cliente (RFC 7591). Claude/ChatGPT se auto-registran aquí
// antes de iniciar el flujo. Devolvemos un client_id (JWT autocontenido, stateless).
import { applyCors, registerClient } from '../_lib/mcp-oauth.js';

export default async function handler(req, res) {
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
