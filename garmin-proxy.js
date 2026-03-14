import express from 'express';
import garminConnectPkg from 'garmin-connect';
const { GarminConnect } = garminConnectPkg;
import cors from 'cors';
import bodyParser from 'body-parser';

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());

// Helper for delay
const delay = ms => new Promise(res => setTimeout(res, ms));

app.post('/api/garmin/login', async (req, res) => {
    const { username, password, days = 30 } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        console.log(`Attempting Garmin login for ${username}...`);
        sendProgress({ status: 'logging_in', message: 'Iniciando sesión en Garmin...' });
        
        const gcClient = new GarminConnect({ username, password });
        await gcClient.login(username, password);
        console.log('Login successful');

        sendProgress({ status: 'fetching_settings', message: 'Descargando perfil de salud y FC Máxima...' });
        
        let userMaxHR = null;
        let officialVO2Max = null;
        try {
            const settings = await gcClient.getUserSettings();
            userMaxHR = settings?.userData?.maxHeartRate || null;
            officialVO2Max = settings?.userData?.vo2Max || null;
        } catch (e) {
            console.error("Error fetching settings:", e.message);
        }

        const history = [];
        const now = new Date();
        // Limit days to 365 to avoid extreme delays/bans
        const daysToFetch = Math.min(parseInt(days) || 30, 365);
        
        console.log(`Fetching ${daysToFetch} days of HR history...`);
        
        for (let i = 0; i < daysToFetch; i++) {
            const date = new Date();
            date.setDate(now.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            try {
                // Adaptive delay: smaller for few days, larger for many days to be stealthier
                const baseDelay = daysToFetch > 60 ? 400 : 250;
                if (i > 0) await delay(baseDelay + Math.random() * 200); 
                
                const hrData = await gcClient.getHeartRate(date);
                if (hrData && hrData.restingHeartRate) {
                    history.push({
                        date: dateStr,
                        rhr: hrData.restingHeartRate
                    });
                }
                
                // Update progress less frequently if range is large
                const updateFreq = daysToFetch > 60 ? 5 : 1;
                if ((i + 1) % updateFreq === 0 || (i + 1) === daysToFetch) {
                    sendProgress({ 
                        status: 'fetching_history', 
                        progress: Math.round(((i + 1) / daysToFetch) * 100),
                        message: `Sincronizando historial día ${i + 1}/${daysToFetch}...`
                    });
                }
            } catch (e) {
                console.error(`Error at day ${i} (${dateStr}):`, e.message);
                if (e.message.includes('403') || e.message.includes('429')) {
                    sendProgress({ status: 'warning', message: 'Límite de Garmin alcanzado. Guardando lo obtenido hasta ahora...' });
                    break; 
                }
            }
        }

        const finalRHR = (history.length > 0) ? history[0].rhr : 60;
        
        sendProgress({
            status: 'complete',
            success: true,
            restingHR: finalRHR,
            maxHR: userMaxHR,
            officialVO2Max: officialVO2Max,
            history: history.reverse(),
            message: '¡Sincronización completada!'
        });
        
        res.end();

    } catch (error) {
        console.error('Garmin login error:', error);
        sendProgress({ 
            status: 'error', 
            success: false, 
            error: 'Credenciales inválidas o Garmin está bloqueando la conexión.' 
        });
        res.end();
    }
});

app.listen(port, () => {
    console.log(`Garmin proxy server listening at http://localhost:${port}`);
});
