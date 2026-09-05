// Preferencia GLOBAL de modelo IA — un único punto de verdad para toda la app.
//
// Antes cada herramienta (sugerencia, planner, predictor, chat) guardaba su
// propio modelo en su propia clave, así que cambiarlo había que hacerlo cuatro
// veces y cada pantalla podía quedarse con un modelo distinto (y obsoleto).
// Ahora hay una sola clave (`ai_model`) y un solo selector, en el menú de
// usuario; los consumidores solo LEEN el valor con useAIModel().
//
// El valor es "provider|model" (ver parseModelValue en services/ai).
import cloudStorage from './cloudStorage';
import { DEFAULT_GEMINI_MODEL, normalizeModelValue, toModelValue } from '../services/ai';

export const AI_MODEL_KEY = 'ai_model';
// Evento de ventana para que todas las pantallas montadas reaccionen al cambio
// (mismo patrón que TARGET_RACES_EVENT).
export const AI_MODEL_EVENT = 'runanalyzer:ai-model';

export const DEFAULT_AI_MODEL = toModelValue('gemini', DEFAULT_GEMINI_MODEL);

/** Modelo elegido por el usuario, ya normalizado a "provider|model". */
export function getAIModel() {
  const raw = cloudStorage.getItem(AI_MODEL_KEY);
  return raw ? normalizeModelValue(raw) : DEFAULT_AI_MODEL;
}

/** Guarda el modelo y avisa a la app. Devuelve el valor normalizado. */
export function setAIModel(value) {
  const next = normalizeModelValue(value);
  try { cloudStorage.setItem(AI_MODEL_KEY, next); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(AI_MODEL_EVENT, { detail: next }));
  return next;
}
