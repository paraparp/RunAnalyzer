import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exchangeToken, getActivities, getAthleteStats } from '../services/strava';

const StravaCallback = ({ onConnect }) => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const code = searchParams.get('code');
    const [status, setStatus] = useState('Procesando autenticación con Strava...');

    useEffect(() => {
        const handleAuth = async () => {
            if (!code) {
                setStatus('No se encontró código de autorización.');
                return;
            }

            try {
                const tokenData = await exchangeToken(code);
                // Execute parallel fetches for stats and activities
                const [stats, activities] = await Promise.all([
                    getAthleteStats(tokenData.access_token, tokenData.athlete.id),
                    getActivities(tokenData.access_token, 1000)
                ]);

                onConnect({
                    athlete: tokenData.athlete,
                    accessToken: tokenData.access_token,
                    stats: stats,
                    activities: activities
                });

                navigate('/'); // Go back to dashboard
            } catch (error) {
                console.error(error);
                setStatus('Error al conectar con Strava. Revisa tu Client ID/Secret.');
            }
        };

        handleAuth();
    }, [code, navigate, onConnect]);

    return (
        <div className="strava-callback-container">
            <div className="loading-card">
                <div className="spinner"></div>
                <p>{status}</p>
            </div>
        </div>
    );
};

export default StravaCallback;
