// Historial de sincronizaciones: una fila por ejecución de syncAll, con el estado de
// cada carril. Idea tomada de open-wearables ("sync run history"): sin esto, un
// carril que falla en silencio (Garmin con 403, Strava sin cuota) solo se nota
// cuando faltan datos días después. Vive en localStorage: es diagnóstico del
// dispositivo, no dato del atleta, y no merece subir a la nube en cada sync.

export const SYNC_HISTORY_KEY = 'sync_history';
export const SYNC_HISTORY_LIMIT = 20;

/** Resume el resultado de syncAll en una fila compacta y serializable. */
export const summarizeSyncRun = ({ startedAt, finishedAt, mode, strava = {}, garmin = {} }) => ({
  startedAt,
  durationMs: Math.max(0, finishedAt - startedAt),
  mode,
  strava: { status: strava.status || 'unknown', changed: strava.changed ?? null, error: strava.error || null },
  garmin: {
    status: garmin.status || 'unknown',
    days: garmin.days ?? null,
    activities: garmin.activities ?? null,
    error: garmin.error || garmin.activitiesError || null,
  },
});

/** Añade una fila al principio y recorta al límite. Puro. */
export const appendSyncRun = (history, run, limit = SYNC_HISTORY_LIMIT) =>
  [run, ...(Array.isArray(history) ? history : [])].slice(0, limit);

const storage = () => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

export const readSyncHistory = () => {
  try {
    const v = JSON.parse(storage()?.getItem(SYNC_HISTORY_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
};

export const recordSyncRun = (run) => {
  try { storage()?.setItem(SYNC_HISTORY_KEY, JSON.stringify(appendSyncRun(readSyncHistory(), run))); } catch { /* sin storage: se pierde el diagnóstico, no el sync */ }
};
