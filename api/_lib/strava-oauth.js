// ============================================================================
// strava-oauth — intercambio de tokens con Strava, compartido por las dos
// funciones serverless (/api/strava/token y /api/strava/refresh).
//
// Los dos endpoints solo se diferencian en el `grant_type` y en el campo que
// validan del body; todo lo demás (credenciales del servidor, llamada, manejo
// de errores) es idéntico. `server.js` ya lo tenía factorizado así para dev.
//
// El client_secret vive aquí (servidor), nunca en el bundle del navegador.
// ============================================================================

/**
 * @param {object} grant campos propios del grant (code / refresh_token + grant_type)
 * @param {object} res respuesta de la función serverless
 */
export async function stravaToken(grant, res) {
  const clientId = process.env.STRAVA_CLIENT_ID || process.env.VITE_STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Faltan STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET en el servidor' });
  }
  try {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...grant }),
    });
    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Envuelve `stravaToken` en un handler serverless: solo POST y con el campo
 * obligatorio presente.
 *
 * @param {string} field nombre del campo requerido en el body
 * @param {(value: any) => object} toGrant construye el grant a partir de ese campo
 */
export function stravaTokenHandler(field, toGrant) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    const value = (req.body ?? {})[field];
    if (!value) return res.status(400).json({ error: `${field} requerido` });
    return stravaToken(toGrant(value), res);
  };
}
