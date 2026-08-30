// Intercambia el authorization code de Strava por tokens.
import { stravaTokenHandler } from '../_lib/strava-oauth.js';

export default stravaTokenHandler('code', (code) => ({ code, grant_type: 'authorization_code' }));
