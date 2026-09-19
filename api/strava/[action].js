// Dispatcher de tokens de Strava: /api/strava/token y /api/strava/refresh en
// una sola función serverless (ahorra funciones frente al límite del plan
// Hobby). Los dos grants solo difieren en el campo del body y el grant_type.
import { stravaTokenHandler } from '../_lib/strava-oauth.js';

const HANDLERS = {
  token:   stravaTokenHandler('code', (code) => ({ code, grant_type: 'authorization_code' })),
  refresh: stravaTokenHandler('refresh_token', (refreshToken) => ({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })),
};

export default function handler(req, res) {
  const fn = HANDLERS[req.query?.action];
  if (!fn) return res.status(404).json({ error: 'Acción no soportada' });
  return fn(req, res);
}
