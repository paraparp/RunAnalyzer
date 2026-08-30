// Renueva el access token de Strava usando el refresh token.
import { stravaTokenHandler } from '../_lib/strava-oauth.js';

export default stravaTokenHandler('refresh_token', (refreshToken) => ({
  refresh_token: refreshToken,
  grant_type: 'refresh_token',
}));
