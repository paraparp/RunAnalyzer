// Herramientas del chat (RunQA): el modelo consulta los datos del atleta cuando
// los necesita en vez de recibirlo todo en el prompt. Reutiliza las tools del
// servidor MCP (mismo schema, validación y frescura del cache vía runTool), pero
// solo un subconjunto de LECTURA sobre el cache: nada que escriba ni que salga a
// Garmin en vivo (lento). El userId sale del JWT verificado, nunca del cliente.
import { tool, jsonSchema } from 'ai';
import { runTool, TOOL_DESCRIPTORS } from '../mcp.js';

export const CHAT_TOOL_NAMES = [
  'list_activities',
  'get_activity',
  'activity_stats',
  'compare_similar_sessions',
  'time_in_zones',
  'list_hrv_resting',
  'personal_records',
  'best_efforts_progression',
  'predict_races',
  'get_training_load_model',
  'get_training_plan',
  'get_wellness_diary',
  'list_injuries',
];

// Una actividad completa pesa ~10-12k tokens: se recorta para no desbordar el
// contexto ni el tiempo de la función (el modelo puede pedir `include`).
const MAX_RESULT_CHARS = 14_000;

const resultText = (res) => {
  const txt = (res?.content || []).map(c => c?.text || '').join('\n');
  const out = txt.length > MAX_RESULT_CHARS
    ? `${txt.slice(0, MAX_RESULT_CHARS)}\n…[recortado: pide menos datos, p. ej. un rango de fechas más corto o \`include\` concreto]`
    : txt;
  return res?.isError ? `ERROR: ${out}` : out;
};

/** Tools del AI SDK para un usuario autenticado. `onCall` recibe cada nombre (log). */
export function buildChatTools(userId, { onCall } = {}) {
  const tools = {};
  for (const d of TOOL_DESCRIPTORS) {
    if (!CHAT_TOOL_NAMES.includes(d.name)) continue;
    if (d.annotations && (d.annotations.readOnlyHint === false || d.annotations.openWorldHint === true)) continue;
    tools[d.name] = tool({
      description: d.description,
      inputSchema: jsonSchema(d.inputSchema || { type: 'object', properties: {} }),
      execute: async (args) => {
        onCall?.(d.name, args);
        // El blob de actividades es grande y Supabase a veces corta la lectura
        // ("statement timeout"); es intermitente, así que se reintenta una vez.
        const attempt = () => runTool(userId, d.name, args || {});
        const isTimeout = (msg) => /statement timeout|timed? ?out/i.test(msg || '');
        try {
          let res = await attempt();
          if (res?.isError && isTimeout(resultText(res))) res = await attempt();
          return resultText(res);
        } catch (e) {
          if (isTimeout(e?.message)) {
            try { return resultText(await attempt()); } catch { /* cae al error */ }
          }
          return `ERROR: ${e?.message || 'fallo al leer los datos'}`;
        }
      },
    });
  }
  return tools;
}
