export const STRAVA_CONFIG = {
    clientId: import.meta.env.VITE_STRAVA_CLIENT_ID,
    clientSecret: import.meta.env.VITE_STRAVA_CLIENT_SECRET,
    redirectUri: import.meta.env.VITE_STRAVA_REDIRECT_URI,
    authUrl: "https://www.strava.com/oauth/authorize",
    tokenUrl: "https://www.strava.com/oauth/token",
    scope: "read,activity:read_all,profile:read_all"
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
    const response = await fetch(STRAVA_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: STRAVA_CONFIG.clientId,
            client_secret: STRAVA_CONFIG.clientSecret,
            code: code,
            grant_type: 'authorization_code',
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to exchange token');
    }
    return response.json();
};

export const refreshAccessToken = async (refreshToken) => {
    const response = await fetch(STRAVA_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: STRAVA_CONFIG.clientId,
            client_secret: STRAVA_CONFIG.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
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
    console.log(`Fetched details for activity ${activityId}:`, data);
    if (!data.splits_metric) {
        console.warn('No splits_metric found in response', data);
    }
    return data;
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
