// Renueva el access token de Strava usando el refresh token.
// El client_secret vive aquí (servidor), nunca en el bundle del navegador.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { refresh_token: refreshToken } = req.body ?? {};
  if (!refreshToken) return res.status(400).json({ error: 'refresh_token requerido' });

  const clientId = process.env.STRAVA_CLIENT_ID || process.env.VITE_STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Faltan STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET en el servidor' });
  }

  try {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
