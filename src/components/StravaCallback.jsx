import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exchangeToken, getActivities, getAthleteStats } from '../services/strava';
import { Card, Title, Text, Flex } from "@tremor/react";

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
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <Card className="max-w-md mx-auto p-8 text-center ring-1 ring-slate-200 shadow-lg">
                <Flex flexDirection="col" className="items-center gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                    <Title className="text-xl text-slate-800">Conectando...</Title>
                    <Text className="text-slate-500">{status}</Text>
                </Flex>
            </Card>
        </div>
    );
};

export default StravaCallback;
