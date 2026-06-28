// Intercambia el authorization code de Strava por tokens.
// El client_secret vive aquí (servidor), nunca en el bundle del navegador.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'code requerido' });

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
        code,
        grant_type: 'authorization_code',
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
