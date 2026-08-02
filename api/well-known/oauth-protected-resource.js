// Protected Resource Metadata (RFC 9728). El cliente MCP llega aquí desde el
// header WWW-Authenticate del 401 y descubre quién autoriza el recurso.
import { applyCors, baseUrl, resourceUrl } from '../_lib/mcp-oauth.js';

export default function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.status(200).json({
    resource: resourceUrl(req),
    authorization_servers: [baseUrl(req)],
    scopes_supported: ['read'],
    bearer_methods_supported: ['header'],
  });
}
