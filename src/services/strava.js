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
    // distance + altitude + time alineados por índice: sirve para el desnivel de
    // los laps, para los tramos "llanos" (flat_efforts) y para el GAP muestra a
    // muestra (stream_gap), que salen de esta misma descarga.
    // grade_smooth es la pendiente ya suavizada por Strava: streamProfile la prefiere
    // frente a derivarla de la altitud, cuyo ruido inventa desnivel bruto.
    // heartrate + watts alimentan el perfil FC-esfuerzo (hr_effort). Van en las mismas
    // claves a propósito: pedir una segunda vez los streams de la actividad costaría
    // otra petición de la cuota de Strava para datos que ya vienen en esta.
    const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}/streams?keys=distance,altitude,time,grade_smooth,heartrate,watts&key_by_type=true`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch activity streams: ' + response.status);
    }
    return response.json();
};

const PER_PAGE = 200; // Strava max per_page

const fetchActivitiesPage = async (accessToken, page, after) => {
    const params = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page) });
    if (after != null) params.set('after', String(after));
    const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch activities: ' + response.status);
    }
    return response.json();
};

/**
 * Listado de actividades (summaries), hasta `count`.
 *
 * `after` (epoch en segundos) pide solo las que empiezan después: es el sync
 * incremental, que casi siempre cabe en UNA página. Sin `after` es el listado
 * completo: la primera página va sola (a la mayoría de atletas les basta) y, si
 * viene llena, el resto se pide EN PARALELO — antes eran 5 peticiones en fila.
 */
export const getActivities = async (accessToken, count = 10, { after, onProgress } = {}) => {
    const pages = Math.max(1, Math.ceil(count / PER_PAGE));
    let loaded = 0;
    const tick = (batch) => {
        loaded += batch.length;
        onProgress?.(Math.min(loaded, count), count);
        return batch;
    };

    const first = tick(await fetchActivitiesPage(accessToken, 1, after));
    const all = [...first];
    if (first.length < PER_PAGE || pages === 1) return all.slice(0, count);

    if (after != null) {
        // Incremental con más de una página llena (meses sin sincronizar): en fila,
        // porque no se sabe cuántas hay y cada una vacía gasta cuota de Strava.
        for (let page = 2; page <= pages; page++) {
            const batch = tick(await fetchActivitiesPage(accessToken, page, after));
            all.push(...batch);
            if (batch.length < PER_PAGE) break;
        }
        return all.slice(0, count);
    }

    const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) => fetchActivitiesPage(accessToken, i + 2).then(tick))
    );
    for (const batch of rest) {
        all.push(...batch);
        if (batch.length < PER_PAGE) break;
    }
    return all.slice(0, count);
};
