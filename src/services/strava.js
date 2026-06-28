export const STRAVA_CONFIG = {
    clientId: import.meta.env.VITE_STRAVA_CLIENT_ID,
    // El redirect se calcula desde el origen actual para que funcione igual en
    // local (localhost:5173) y en producción (Vercel). Cae al env var si se define.
    redirectUri: import.meta.env.VITE_STRAVA_REDIRECT_URI
        || (typeof window !== 'undefined' ? `${window.location.origin}/strava-callback` : undefined),
    authUrl: "https://www.strava.com/oauth/authorize",
    scope: "read,activity:read_all,profile:read_all"
    // ⚠️ client_secret ya NO vive aquí: el intercambio de tokens pasa por
    //    /api/strava/* (servidor), así no se filtra en el bundle del navegador.
};

export const getStravaAuthUrl = () => {
    const params = new URLSearchParams({
        client_id: STRAVA_CONFIG.clientId,
        redirect_uri: STRAVA_CONFIG.redirectUri,
        response_type: 'code',
        approval_prompt: 'force',
        scope: STRAVA_CONFIG.scope
    });
    return `${STRAVA_CONFIG.authUrl}?${params.toString()}`;
};

export const exchangeToken = async (code) => {
    const response = await fetch('/api/strava/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
    });

    if (!response.ok) {
        throw new Error('Failed to exchange token');
    }
    return response.json();
};

export const refreshAccessToken = async (refreshToken) => {
    const response = await fetch('/api/strava/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
        throw new Error('Failed to refresh token');
    }
    return response.json();
};

export const getAthleteStats = async (accessToken, athleteId) => {
    const response = await fetch(`https://www.strava.com/api/v3/athletes/${athleteId}/stats`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });
    if (!response.ok) {
        throw new Error('Failed to fetch stats');
    }
    return response.json();
};

export const getAthleteProfile = async (accessToken) => {
    const response = await fetch(`https://www.strava.com/api/v3/athlete`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });
    if (!response.ok) {
        throw new Error('Failed to fetch profile');
    }
    return response.json();
};

export const getActivity = async (accessToken, activityId) => {
    const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch activity details: ' + response.status);
    }
    const data = await response.json();
    if (!data.splits_metric) {
        console.warn('No splits_metric found in response', data);
    }
    return data;
};

export const getActivityStreams = async (accessToken, activityId) => {
    const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=altitude&key_by_type=true`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch activity streams: ' + response.status);
    }
    return response.json();
};

export const getActivities = async (accessToken, count = 10, onProgress) => {
    let allActivities = [];
    let page = 1;
    const perPage = 200; // Strava max per_page

    while (allActivities.length < count) {
        const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error('Failed to fetch activities: ' + response.status);
        }

        const activities = await response.json();

        if (activities.length === 0) {
            break;
        }

        allActivities = [...allActivities, ...activities];
        if (onProgress) {
            onProgress(Math.min(allActivities.length, count), count);
        }
        page++;
    }

    return allActivities.slice(0, count);
};
