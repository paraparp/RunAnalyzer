// Dispatcher OAuth: una sola función serverless para todas las acciones del
// servidor OAuth 2.1 (ahorra funciones frente al límite del plan Hobby).
// Los metadatos /.well-known/* llegan aquí vía rewrites en vercel.json.
import {
  handleAsMetadata, handleProtectedResourceMetadata,
  handleRegister, handleAuthorize, handleToken,
} from '../_lib/oauth-handlers.js';

const ROUTES = {
  'authorization-server-metadata': handleAsMetadata,
  'protected-resource-metadata': handleProtectedResourceMetadata,
  register: handleRegister,
  authorize: handleAuthorize,
  token: handleToken,
};

export default async function handler(req, res) {
  const fn = ROUTES[req.query.action];
  if (!fn) return res.status(404).json({ error: 'not_found' });
  return fn(req, res);
}
