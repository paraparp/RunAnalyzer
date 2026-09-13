import { useCallback, useEffect, useState } from 'react';
import cloudStorage from '../lib/cloudStorage';
import { syncGarminActivities } from '../lib/garminActivitiesSync';
import {
  saveGarminHealth, readCardiac, readSleep, readGarminCreds,
  CARDIAC_KEY, SLEEP_KEY, LAST_SYNC_KEY, CREDS_KEY, SYNC_COMPLETE_EVENT,
} from '../lib/garminHealthStore';

// `null` significa "nunca se ha sincronizado" y es lo que decide si la vista de
// conexiones pinta el formulario; el almacén devuelve `[]` tanto en ese caso como
// en "sincronizado pero sin registros", y `[]` es truthy.
const nonEmpty = (arr) => (arr?.length ? arr : null);

/**
 * Dueño único de la CONEXIÓN con Garmin: credenciales, descarga (directa o por
 * stream), import/export del JSON y desconexión. Vivía dentro de
 * `GarminCardiac`, que es una vista de análisis: configurar una integración
 * desde ahí obligaba al menú de usuario a mandar al atleta a una pantalla de
 * métricas para conectar el reloj. Ahora la vista de Ajustes › Conexiones usa
 * este hook y `GarminCardiac` solo LEE lo guardado.
 *
 * Cada escritura avisa por dos canales: `SYNC_COMPLETE_EVENT` (el mismo que
 * emite `syncAll`, con el que las vistas de salud se repintan) y
 * `garmin-cardiac-updated` (el que escuchan el menú de usuario, `VitalsOverview`
 * y el exportador).
 */
export default function useGarminConnection() {
  const [creds, setCreds] = useState(readGarminCreds);
  const [data, setData] = useState(() => nonEmpty(readCardiac()));
  const [sleepData, setSleepData] = useState(() => nonEmpty(readSleep()));
  const [lastSync, setLastSync] = useState(() => cloudStorage.getItem(LAST_SYNC_KEY) || null);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  // Si el sync global (`syncAll`, el botón de la barra) trae dato nuevo, este
  // hook también tiene que enterarse: su `data` es el espejo de lo guardado.
  useEffect(() => {
    const reload = () => {
      try {
        const nextData = nonEmpty(readCardiac());
        const nextSleep = nonEmpty(readSleep());
        const nextSync = cloudStorage.getItem(LAST_SYNC_KEY);
        if (nextData) setData(nextData);
        if (nextSleep) setSleepData(nextSleep);
        if (nextSync) setLastSync(nextSync);
      } catch (e) {
        console.error('No se pudo recargar la salud de Garmin al terminar el sync', e);
      }
    };
    window.addEventListener(SYNC_COMPLETE_EVENT, reload);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, reload);
  }, []);

  // Persistir es exactamente lo mismo que hace el sync automático, así que lo
  // hace el MISMO código (`garminHealthStore`): una sola mezcla por día/semana,
  // una sola marca de `garmin_last_sync` y el mismo criterio con las respuestas
  // vacías. Lee de lo GUARDADO, no del estado, que es un espejo.
  const saveData = useCallback((newData, mergeExisting, usr, pwd, newSleepData = null) => {
    const saved = saveGarminHealth(
      { cardiac: newData, sleep: newSleepData },
      { replace: !mergeExisting },
    );
    setData(nonEmpty(saved.cardiac));
    setSleepData(nonEmpty(saved.sleep));
    setLastSync(saved.lastSync);
    window.dispatchEvent(new Event(SYNC_COMPLETE_EVENT));
    window.dispatchEvent(new CustomEvent('garmin-cardiac-updated'));
    if (usr) {
      cloudStorage.setItem(CREDS_KEY, JSON.stringify({ username: usr, password: pwd }));
      setCreds({ username: usr, password: pwd });
      // Traer también las actividades con running dynamics (banda) para el MCP.
      // Best-effort y no destructivo: un fallo deja el histórico guardado intacto.
      syncGarminActivities(usr, pwd);
    }
  }, []);

  const fetchHealth = useCallback(async (usr, pwd, days, mergeExisting = false) => {
    setLoading(true);
    setError(null);
    setProgress({ value: 0, period: 'Iniciando…', chunks: [] });

    if (days <= 30) {
      try {
        const res = await fetch('/api/garmin/health/recent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: usr, password: pwd, days }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Error del servidor');
        saveData(json.data, mergeExisting, usr, pwd, json.sleepData);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
        setProgress(null);
      }
      return;
    }

    try {
      const res = await fetch('/api/garmin/health/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usr, password: pwd, days }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Error del servidor');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = mergeExisting && data ? [...data] : [];
      const completedChunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);

          if (msg.type === 'chunk') {
            const byDate = {};
            [...accumulated, ...msg.data].forEach(r => { byDate[r.date] = { ...byDate[r.date], ...r }; });
            accumulated = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
            completedChunks.push({ period: msg.period, count: msg.data.length });
            setProgress({ value: msg.progress, period: msg.period, chunks: [...completedChunks] });
            setData([...accumulated]);
          } else if (msg.type === 'done') {
            saveData(accumulated, false, usr, pwd, msg.sleepData);
          } else if (msg.type === 'error') {
            throw new Error(msg.error);
          }
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [data, saveData]);

  const connect = useCallback(
    (usr, pwd, days) => fetchHealth(usr, pwd, days),
    [fetchHealth],
  );

  const sync = useCallback(
    (days) => { if (creds) fetchHealth(creds.username, creds.password, days, true); },
    [creds, fetchHealth],
  );

  const disconnect = useCallback(() => {
    setData(null);
    setSleepData(null);
    setCreds(null);
    setLastSync(null);
    cloudStorage.removeItem(CARDIAC_KEY);
    cloudStorage.removeItem(SLEEP_KEY);
    cloudStorage.removeItem(CREDS_KEY);
    cloudStorage.removeItem(LAST_SYNC_KEY);
    window.dispatchEvent(new Event(SYNC_COMPLETE_EVENT));
    window.dispatchEvent(new CustomEvent('garmin-cardiac-updated'));
  }, []);

  const exportJson = useCallback(() => {
    if (!data) return;
    const blob = new Blob(
      [JSON.stringify({ lastSync: new Date().toISOString(), data }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `garmin_data_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  const importJson = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
        if (!rows.length) { setError('El archivo no contiene datos válidos'); return; }
        saveData(rows, true, null, null);
        setError(null);
      } catch {
        setError('Error al leer el archivo JSON');
      }
    };
    reader.readAsText(file);
  }, [saveData]);

  return {
    creds, data, sleepData, lastSync,
    loading, progress, error, setError,
    connect, sync, disconnect, exportJson, importJson,
  };
}
