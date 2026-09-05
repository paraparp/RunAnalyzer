// ── Overrides manuales de FC (FCmax / FC reposo / LTHR) ──────────────────────
// El atleta puede fijarlos a mano en la pestaña de Zonas. Viven en su propia
// clave de cloudStorage, que es la MISMA fila de `user_storage` que lee el MCP en
// el servidor: por eso la app y el agente pueden dar los mismos números.
//
// Está separado de lib/loadCalibration a propósito: la calibración es pura y la
// importa el servidor del MCP, que no puede arrastrar cloudStorage (ni Supabase
// del navegador) detrás.
import cloudStorage from './cloudStorage';
import { OVERRIDES_KEY } from './loadCalibration';

export { OVERRIDES_KEY };

/** { max?, rest?, lthr? } guardados, o {} si no hay nada o el JSON está roto. */
export const loadOverrides = () => {
  try { return JSON.parse(cloudStorage.getItem(OVERRIDES_KEY)) ?? {}; } catch { return {}; }
};

/** Evento con el que las vistas que no son la de Zonas se enteran de un cambio. */
export const OVERRIDES_EVENT = 'hr-overrides-updated';
