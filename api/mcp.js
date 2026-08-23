// ============================================================================
// /api/mcp — Servidor MCP remoto (Streamable HTTP, stateless) sobre los datos
// de RunAnalyzer que ya viven en Supabase (user_storage).
//
// Compatible con Claude (Custom Connectors) y ChatGPT (connectors). La auth es
// OAuth 2.1 con Bearer token: si falta o es inválido devolvemos 401 con el header
// WWW-Authenticate que apunta al Protected Resource Metadata, disparando el flujo
// de descubrimiento OAuth en el cliente.
// ============================================================================
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { applyCors, baseUrl, resourceUrl, verifyAccessToken } from './_lib/mcp-oauth.js';
import {
  getActivities, filterActivities, activityStats, shapeSummary, shapeFull,
  estimateHrMax, compareSimilarSessions,
  listRunningDynamics, getHrvResting, getSleep, getPersonalBests,
  getPersonalRecords, getBestEffortsProgression,
  getTrainingLoadModel, getHealthAlerts, detectThresholdTests, getTimeInZones,
  listTargetRaces, getTargetRace, upsertTargetRace, deleteTargetRace, setPrimaryTargetRace,
} from './_lib/mcp-store.js';
import {
  createWorkout, updateWorkout, deleteWorkout, listWorkouts, scheduleWorkout, getWorkout,
} from './_lib/garmin-write.js';
import {
  getSleepDaily, getWeightRange, getTrainingReadiness, getFitnessStatus, getPlannedWorkouts,
} from './_lib/garmin-live.js';
import { ensureFresh } from './_lib/mcp-sync.js';

// ── Definición de tools (JSON Schema puro: sin dependencia de zod) ───────────
// Cada tool declara su `name`/`description`/`inputSchema` (lo que ve el cliente) y
// su `run(userId, args)` juntos, para que schema y handler no puedan desincronizarse.
const dateArg = { type: 'string', description: 'Fecha ISO YYYY-MM-DD (opcional)', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

// Resultado de tool. NO emitimos `structuredContent` en el camino de éxito: la spec
// obliga a mandar además el JSON serializado en `content`, así que el payload viaja
// DOS veces. En tools que ya pesan 10-12k tokens (get_activity) eso dobla el coste de
// contexto, y sin `outputSchema` declarado el cliente no gana nada a cambio. En los
// errores sí se emite: son diminutos y hacen que el cliente pueda parsearlos.
const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

// Error de EJECUCIÓN de una tool. En MCP no se señalan con un error JSON-RPC (eso es
// para fallos de protocolo): van en el resultado con `isError: true`, para que el
// modelo pueda leerlos y corregir. Antes se devolvían como texto normal y el cliente
// no distinguía "no encontrado" de un resultado válido.
const toolError = (message, extra = {}) => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
  structuredContent: { error: message, ...extra },
  isError: true,
});

// Anotaciones de comportamiento (ToolAnnotations de la spec MCP). Permiten al cliente
// saber qué tools mutan estado antes de llamarlas: `readOnlyHint` para las de solo
// lectura, `destructiveHint` para las que borran/sobrescriben, `openWorldHint` para
// las que salen a un sistema externo (Garmin en vivo) frente al cache de Supabase.
// Secciones de get_activity sin la polyline (la parte más pesada del documento).
const FULL_SECTIONS_NO_MAP = ['garmin', 'laps', 'splits', 'best_efforts', 'flat_efforts', 'decoupling', 'gap'];

const READ_CACHED = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const READ_LIVE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE_CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE_UPDATE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const TOOLS = [
  {
    name: 'list_activities',
    description: 'Lista actividades de Strava (resumen) con filtros. Paginado para no saturar el contexto.',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg,
        to: dateArg,
        sport: { type: 'string', description: 'Tipo Strava exacto, p.ej. Run, TrailRun, Ride' },
        only_running: { type: 'boolean', description: 'Solo carreras (Run/TrailRun/VirtualRun)' },
        min_distance_km: { type: 'number' },
        max_distance_km: { type: 'number', description: 'Distancia máxima (comparar sesiones equivalentes)' },
        avg_hr_min: { type: 'number', description: 'FC MEDIA mínima de la actividad (bpm)' },
        avg_hr_max: { type: 'number', description: 'FC MEDIA máxima de la actividad (bpm)' },
        flat_only: { type: 'boolean', description: 'Solo salidas llanas (<10 m de desnivel por km)' },
        hr_source: { type: 'string', enum: ['strap', 'wrist', 'unknown'], description: 'Filtra por origen de la FC. `unknown` = no se sabe (no es lo mismo que "sin banda"); mira `hr_source_origin` en la respuesta para saber si el valor viene de los sensores o de la fecha de corte declarada' },
        limit: { type: 'number', description: 'Máx. resultados (por defecto 50, tope 200)' },
        offset: { type: 'number', description: 'Desplazamiento para paginar (por defecto 0)' },
      },
    },
    run: async (userId, args) => {
      const all = await getActivities(userId);
      const filtered = filterActivities(all, args);
      const offset = Math.max(0, args.offset || 0);
      const limit = Math.min(200, Math.max(1, args.limit || 50));
      const page = filtered.slice(offset, offset + limit);
      return text({
        total: filtered.length, offset, limit,
        activities: page.map(shapeSummary),
      });
    },
  },
  {
    name: 'get_activity',
    description: 'Detalle completo de una actividad: parciales, splits por km, best efforts, tramos llanos, polyline, desacoplamiento, GAP y (si hay Garmin) origen de FC, laps reales (con is_autolap), potencia por lap y WBGT. Incluye `data_consistency` (avisa si la suma de los laps no cuadra con la cabecera >1 %) y, en `garmin.weather`, `heat_penalty_session_pct` (penalización por calor ya escalada a la intensidad de ESA sesión) frente a `heat_penalty_pct` (referencia de tabla a ritmo de competición): usa la primera, no la segunda. Distancias en `distance_m` entero además de km. Usa `include` para pedir solo lo necesario y ahorrar contexto (la actividad completa pesa ~10-12k tokens).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: ['string', 'number'], description: 'ID de la actividad Strava' },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['garmin', 'laps', 'splits', 'best_efforts', 'flat_efforts', 'decoupling', 'gap', 'map'] },
          description: 'Secciones a incluir (por defecto todas). El resumen base va siempre.',
        },
      },
      required: ['id'],
    },
    run: async (userId, args) => {
      const all = await getActivities(userId);
      const a = all.find((x) => String(x.id) === String(args.id));
      if (!a) return toolError(`Actividad ${args.id} no encontrada.`);
      // La FCmax del atleta hace falta para escalar la penalización por calor a la
      // intensidad real de la sesión; se estima del histórico (p98 de 12 meses).
      return text(shapeFull(a, args.include, { hrMax: estimateHrMax(all) }));
    },
  },
  {
    name: 'activity_stats',
    description: 'Agregados de las actividades en un rango: total km, tiempo, desnivel y desglose por tipo. Incluye `garmin_only` (lo que hay en Garmin y no en Strava) y `combined` (volumen real). Con `granularity=weekly` devuelve el desglose por semana con la rampa % (para seguir la subida de volumen).',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg, only_running: { type: 'boolean' },
        granularity: { type: 'string', enum: ['total', 'weekly'], description: 'total (por defecto) o weekly (km/tiempo/rampa por semana)' },
      },
    },
    run: (userId, args) => activityStats(userId, args).then(text),
  },
  {
    name: 'list_running_dynamics',
    description: 'Running dynamics de Garmin (cadencia, GCT, oscilación/ratio vertical, zancada, potencia, carga, training effect, VO2max) y origen de FC por carrera. Medias sobre el rango + runs paginados. Por defecto EXCLUYE los runs de menos de 3 km (calentamientos y vueltas a la calma sueltos, que distorsionan las medias); ajusta con `min_distance_km` (0 = incluir todo) y mira `excluded_short_runs`. Lee la MISMA clave que el bloque `garmin` de get_activity: si aquí sale count 0, allí también saldrá garmin:null.',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg,
        min_distance_km: { type: 'number', description: 'Distancia mínima para entrar en las medias (por defecto 3; 0 = sin filtro)' },
        limit: { type: 'number', description: 'Máx. runs devueltos (por defecto 50, tope 200)' },
        offset: { type: 'number', description: 'Desplazamiento para paginar' },
      },
    },
    run: (userId, args) => listRunningDynamics(userId, args).then(text),
  },
  {
    name: 'compare_similar_sessions',
    description: 'Compara sesiones EQUIVALENTES entre sí ("todas mis salidas llanas de 10 km con FC media entre 142 y 152"). Define el grupo con distance_km + tolerancia y banda de FC media, o pasa `reference_id` y toma los criterios de esa actividad. Devuelve cada sesión con ritmo, GAP, FC, WBGT y el índice de eficiencia (metros por latido), más agregados y `trend` (mediana de eficiencia de la mitad reciente vs la antigua). La eficiencia es lo que hay que mirar: el ritmo solo no distingue mejorar de haber ido más enchufado ese día.',
    inputSchema: {
      type: 'object',
      properties: {
        reference_id: { type: ['string', 'number'], description: 'ID Strava de la sesión de referencia: distancia y banda de FC salen de ella' },
        distance_km: { type: 'number', description: 'Distancia objetivo del grupo (obligatoria si no hay reference_id)' },
        distance_tolerance_pct: { type: 'number', description: 'Tolerancia de distancia en % (por defecto 10)' },
        avg_hr_min: { type: 'number', description: 'FC MEDIA mínima de la sesión (bpm)' },
        avg_hr_max: { type: 'number', description: 'FC MEDIA máxima de la sesión (bpm)' },
        hr_tolerance_bpm: { type: 'number', description: 'Ancho de la banda de FC alrededor de la referencia (por defecto ±5)' },
        flat_only: { type: 'boolean', description: 'Solo salidas llanas (<10 m de desnivel por km)' },
        sport: { type: 'string', description: 'Tipo Strava (por defecto solo carreras)' },
        from: dateArg, to: dateArg,
        limit: { type: 'number', description: 'Máx. sesiones devueltas (por defecto 25, tope 100)' },
      },
    },
    run: async (userId, args) => {
      const res = await compareSimilarSessions(userId, args);
      return res?.error ? toolError(res.error) : text(res);
    },
  },
  {
    name: 'get_personal_bests',
    description: 'Mejores marcas (Personal Bests) en 5K, 10K, media maratón y maratón (desde best_efforts de Strava), y llanas Flat 1K/2K (desde flat_efforts). Top-5 por distancia (ordenado por tiempo), con ritmo, fecha, `exact` (distancia justa vs sobre-distancia con `distance_delta_m`) y `source` (best_effort | total_distance | flat_effort | splits_window, para no confundir procedencias). El `pr` prefiere una marca `exact` cuando el margen es grande. Solo carreras por defecto.',
    inputSchema: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'Tipo Strava (por defecto solo carreras)' },
        from: dateArg, to: dateArg,
      },
    },
    run: (userId, args) => getPersonalBests(userId, args).then(text),
  },
  {
    name: 'personal_records',
    description: 'Récords personales por distancia (400m, 1k, 1 milla, 5k, 10k, 15k, 20k, media, maratón…) desde best_efforts de Strava, usando moving_time. Top-5 por distancia (configurable) con actividad, fecha, ritmo, FC media y origen de FC. Con from/to da el récord de temporada.',
    inputSchema: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'Tipo Strava (por defecto solo carreras)' },
        top: { type: 'number', description: 'Nº de mejores por distancia (por defecto 5, tope 10)' },
        from: dateArg, to: dateArg,
      },
    },
    run: (userId, args) => getPersonalRecords(userId, args).then(text),
  },
  {
    name: 'best_efforts_progression',
    description: 'Serie temporal del best_effort de una distancia (cada actividad, cronológico) marcando el récord acumulado. Para gráfica de progreso real. Requiere distance (p.ej. "5k", "10k", "half-marathon").',
    inputSchema: {
      type: 'object',
      properties: {
        distance: { type: 'string', description: 'Nombre de la distancia: 5k, 10k, half-marathon, marathon…' },
        sport: { type: 'string' },
        from: dateArg, to: dateArg,
      },
      required: ['distance'],
    },
    run: (userId, args) => getBestEffortsProgression(userId, args).then(text),
  },
  {
    name: 'list_hrv_resting',
    description: 'VFC (HRV) nocturna y FC en reposo por día (Garmin), con Body Battery. Incluye baseline de Garmin (`hrv_baseline`: {low, high, marker} en ms — rango balanceado y marcador de Garmin dentro de él), media móvil 7d y un `current` con `hrv_deviation` (above|below|within) para el semáforo HRV.',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getHrvResting(userId, args).then(text),
  },
  {
    name: 'list_sleep',
    description: 'Resumen de sueño por semana ISO (lunes–domingo): score y MEDIA POR NOCHE de duración y fases REM/profundo/ligero/despierto (avg_*), no totales semanales. La semana en curso se reconstruye en vivo y va marcada `partial` con `days_with_data`; `source_window` indica que esa media viene de una ventana desplazada del ingest. Para noches sueltas usa list_sleep_daily.',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getSleep(userId, args).then(text),
  },
  {
    name: 'list_sleep_daily',
    description: 'Sueño noche a noche (Garmin, en vivo): fases profundo/REM/ligero/despierto, score, estrés nocturno, respiración, HRV nocturna y FC reposo. Rango por defecto: últimos 14 días (usa from/to para más).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getSleepDaily(userId, args).then(text),
  },
  {
    name: 'list_weight',
    description: 'Peso y composición corporal por día (báscula, en vivo): peso, IMC, % grasa, masa muscular, % agua. Rango por defecto: últimos 14 días (usa from/to para más).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getWeightRange(userId, args).then(text),
  },
  {
    name: 'get_training_readiness',
    description: 'Training readiness de Garmin (en vivo): score y nivel del día con sus factores (sueño, tiempo de recuperación, ACWR, VFC, estrés). Opcional: date.',
    inputSchema: { type: 'object', properties: { date: dateArg } },
    run: (userId, args) => getTrainingReadiness(userId, args).then(text),
  },
  {
    name: 'get_fitness_status',
    description: 'Estado de forma de Garmin (en vivo): VO2max carrera y ciclismo, training status, carga aguda/crónica y ratio ACWR, balance aeróbico/anaeróbico, y scores de resistencia/colina. Opcional: date.',
    inputSchema: { type: 'object', properties: { date: dateArg } },
    run: (userId, args) => getFitnessStatus(userId, args).then(text),
  },
  {
    name: 'list_planned_workouts',
    description: 'Entrenos planificados y carreras futuras del calendario de Garmin (en vivo), con fecha, título, deporte y bandera de carrera. Por defecto los próximos 3 meses.',
    inputSchema: { type: 'object', properties: { months: { type: 'number', description: 'Nº de meses a mirar (tope 6)' } } },
    run: (userId, args) => getPlannedWorkouts(userId, args).then(text),
  },
  {
    name: 'get_training_load_model',
    description: 'Modelo de Banister: carga crónica (CTL), aguda (ATL) y forma (TSB/tsb_today) con la rampa semanal, desde el training_load de Garmin. Usa granularity=weekly o summary_only para no saturar el contexto.',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg,
        granularity: { type: 'string', enum: ['daily', 'weekly'], description: 'daily (por defecto) o weekly (colapsa la serie por semana)' },
        summary_only: { type: 'boolean', description: 'Devuelve solo el estado actual, sin la serie' },
      },
    },
    run: (userId, args) => getTrainingLoadModel(userId, args).then(text),
  },
  {
    name: 'get_health_alerts',
    description: 'Alertas de patrón sobre VFC/FC reposo/Body Battery: firma de infección o sobrecarga (Body Battery máx <55 dos noches seguidas, o VFC bajo baseline con FC reposo elevada).',
    inputSchema: { type: 'object', properties: { from: dateArg, to: dateArg } },
    run: (userId, args) => getHealthAlerts(userId, args).then(text),
  },
  {
    name: 'time_in_zones',
    description: 'Tiempo en zonas de FC (5 zonas por % de FCmax) en un rango, con reparto polarizado easy/moderado/hard. Aproximado desde la FC media por split (sin stream). `granularity=weekly` da el reparto por semana; `hr_max` opcional (si no, se estima).',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg,
        sport: { type: 'string', description: 'Tipo Strava (por defecto solo carreras)' },
        hr_max: { type: 'number', description: 'FCmax en bpm (recomendado); si se omite, se estima' },
        granularity: { type: 'string', enum: ['total', 'weekly'], description: 'total (por defecto) o weekly' },
      },
    },
    run: (userId, args) => getTimeInZones(userId, args).then(text),
  },
  {
    name: 'detect_threshold_efforts',
    description: 'Detecta esfuerzos de test de umbral (bloque continuo de 20–45 min por encima del 88% de FCmax fisiológica) y devuelve LTHR y ritmo umbral estimados, con bandera de si la FC se estabilizó (test válido) o derivó (contaminado). FCmax fisiológica: se estima (p98 últimos 12 meses) salvo que pases hr_max.',
    inputSchema: {
      type: 'object',
      properties: {
        from: dateArg, to: dateArg,
        hr_max: { type: 'number', description: 'FCmax fisiológica REAL en bpm (recomendado); si se omite, se estima (p98 últimos 12 meses)' },
      },
    },
    run: (userId, args) => detectThresholdTests(userId, args).then(text),
  },
  // ── Escritura en Garmin (usa las credenciales guardadas del usuario) ───────
  {
    name: 'list_garmin_workouts',
    description: 'Lista los entrenos guardados en Garmin (id, nombre, deporte, fecha) para poder editarlos o borrarlos.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Máx. resultados (tope 100)' } } },
    run: (userId, args) => listWorkouts(userId, args).then(text),
  },
  {
    name: 'get_garmin_workout',
    description: 'Lee los pasos completos de un entreno de Garmin (misma spec de alto nivel que create/update: kind, duration, target, repeticiones). Úsalo antes de update_garmin_workout para editar sin reescribir los pasos a ciegas.',
    inputSchema: {
      type: 'object',
      properties: { workout_id: { type: ['string', 'number'] } },
      required: ['workout_id'],
    },
    run: (userId, args) => getWorkout(userId, args.workout_id).then(text),
  },
  {
    name: 'create_garmin_workout',
    description: 'Crea un entreno estructurado de carrera en Garmin (se sincroniza al reloj). Spec de alto nivel con pasos por tiempo/distancia y objetivo opcional de ritmo/FC/potencia; soporta repeticiones (p.ej. 4×(interval+recovery)). Con `date` (YYYY-MM-DD) además lo agenda en el calendario.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD para agendarlo en el calendario (opcional)' },
        steps: {
          type: 'array',
          description: 'Lista de pasos. Cada paso: { kind, duration:{type,value,unit}, target? } o { kind:"repeat", repeats, steps:[...] }.',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['warmup', 'interval', 'recovery', 'rest', 'cooldown', 'repeat'] },
              repeats: { type: 'number', description: 'Solo kind=repeat: nº de repeticiones' },
              steps: { type: 'array', description: 'Solo kind=repeat: pasos internos', items: { type: 'object' } },
              duration: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['distance', 'time', 'lap.button'] },
                  value: { type: 'number' },
                  unit: { type: 'string', enum: ['m', 'km', 's', 'min'] },
                },
              },
              target: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['no.target', 'pace', 'heart.rate', 'power', 'cadence'] },
                  low: { type: 'number', description: 'pace en min/km; FC en bpm; potencia en W; cadencia en spm' },
                  high: { type: 'number' },
                  zone: { type: 'number', description: 'nº de zona en vez de rango' },
                },
              },
            },
            required: ['kind'],
          },
        },
      },
      required: ['name', 'steps'],
    },
    run: (userId, args) => createWorkout(userId, args).then(text),
  },
  {
    name: 'update_garmin_workout',
    description: 'Modifica un entreno existente en Garmin SIN duplicarlo (mismo workout_id). Misma spec que create_garmin_workout.',
    inputSchema: {
      type: 'object',
      properties: {
        workout_id: { type: ['string', 'number'] },
        name: { type: 'string' },
        description: { type: 'string' },
        steps: { type: 'array', items: { type: 'object' } },
      },
      required: ['workout_id', 'name', 'steps'],
    },
    run: (userId, args) => updateWorkout(userId, args.workout_id, args).then(text),
  },
  {
    name: 'delete_garmin_workout',
    description: 'Borra un entreno de Garmin por su workout_id (usa list_garmin_workouts para obtenerlo).',
    inputSchema: {
      type: 'object',
      properties: { workout_id: { type: ['string', 'number'] } },
      required: ['workout_id'],
    },
    run: (userId, args) => deleteWorkout(userId, args.workout_id).then(text),
  },
  {
    name: 'schedule_garmin_workout',
    description: 'Agenda un entreno ya existente en una fecha del calendario de Garmin (se sincroniza al reloj). Usa list_garmin_workouts para obtener el workout_id.',
    inputSchema: {
      type: 'object',
      properties: {
        workout_id: { type: ['string', 'number'] },
        date: { type: 'string', description: 'Fecha YYYY-MM-DD' },
      },
      required: ['workout_id', 'date'],
    },
    run: (userId, args) => scheduleWorkout(userId, args.workout_id, args.date).then(text),
  },
  // ── Carreras objetivo y plan de entrenamiento (Supabase, mismo dato que la app) ──
  {
    name: 'list_target_races',
    description: 'Lista las carreras objetivo del usuario (nombre, fecha, distancia, tiempo meta, días restantes) y su plan de entrenamiento en texto libre. La que trae is_primary=true es el OBJETIVO PRINCIPAL: úsala como referencia para planes, predicciones y análisis; las demás son informativas. Usa include_plan:false si solo necesitas los metadatos.',
    inputSchema: {
      type: 'object',
      properties: {
        include_past: { type: 'boolean', description: 'Incluir carreras ya celebradas (por defecto false)' },
        include_plan: { type: 'boolean', description: 'Incluir el texto completo del plan (por defecto true)' },
      },
    },
    run: (userId, args) => listTargetRaces(userId, args).then(text),
  },
  {
    name: 'get_target_race',
    description: 'Lee una carrera objetivo concreta con su plan de entrenamiento completo. Úsalo antes de upsert_target_race para editar el plan sin reescribirlo a ciegas.',
    inputSchema: {
      type: 'object',
      properties: { race_id: { type: 'string' } },
      required: ['race_id'],
    },
    run: (userId, args) => getTargetRace(userId, args.race_id).then(text),
  },
  {
    name: 'upsert_target_race',
    description: 'Crea (sin race_id) o edita (con race_id) una carrera objetivo y su plan de entrenamiento. El plan es TEXTO LIBRE en cualquier formato (markdown, HTML o texto plano): se guarda tal cual. Respeta el `plan_format` que devuelven list/get_target_race al reescribirlo (si el plan es markdown, edítalo en markdown). La edición es parcial: solo se tocan los campos enviados, así que puedes escribir `plan` sin reenviar nombre/fecha. Se guarda en la base de datos y aparece en la app.',
    inputSchema: {
      type: 'object',
      properties: {
        race_id: { type: 'string', description: 'Id de la carrera a editar; omítelo para crear una nueva' },
        name: { type: 'string', description: 'Nombre del evento (obligatorio al crear)' },
        date: { ...dateArg, description: 'Fecha YYYY-MM-DD de la carrera' },
        distance: { type: 'string', enum: ['5k', '10k', '21k', '42k'] },
        goal_time: { type: 'string', description: 'Tiempo objetivo: h:mm:ss, mm:ss o minutos' },
        plan: { type: 'string', description: 'Plan de entrenamiento en texto libre. REEMPLAZA el plan anterior; cadena vacía para borrarlo' },
        append_plan: { type: 'string', description: 'Texto a AÑADIR al final del plan existente (en vez de reemplazarlo)' },
        set_primary: { type: 'boolean', description: 'true la convierte en el OBJETIVO PRINCIPAL (desmarca las demás); false quita la marca. Si se omite, crear una carrera NO le quita el puesto a la principal actual (solo pasa a serlo si no había ninguna)' },
      },
    },
    run: (userId, args) => upsertTargetRace(userId, args).then(text),
  },
  {
    name: 'set_primary_target_race',
    description: 'Fija cuál de las carreras objetivo es el OBJETIVO PRINCIPAL: el que manda en el planificador, el predictor y los análisis de la app. Es excluyente (marcar una desmarca el resto). Con race_id null se quita la marca y vuelve a mandar por defecto la carrera futura más próxima.',
    inputSchema: {
      type: 'object',
      properties: { race_id: { type: ['string', 'null'], description: 'Id de la carrera; null para quitar la marca' } },
      required: ['race_id'],
    },
    run: (userId, args) => setPrimaryTargetRace(userId, args.race_id).then(text),
  },
  {
    name: 'delete_target_race',
    description: 'Borra una carrera objetivo y su plan de entrenamiento por race_id (usa list_target_races para obtenerlo).',
    inputSchema: {
      type: 'object',
      properties: { race_id: { type: 'string' } },
      required: ['race_id'],
    },
    run: (userId, args) => deleteTargetRace(userId, args.race_id).then(text),
  },
  // ── Contrato ChatGPT: search + fetch ──────────────────────────────────────
  {
    name: 'search',
    description: 'Busca actividades por nombre, tipo o fecha. Devuelve resultados con id para usar en fetch.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    run: async (userId, args) => {
      const q = String(args.query || '').toLowerCase().trim();
      const all = await getActivities(userId);
      const hits = (q
        ? all.filter((a) =>
            (a.name || '').toLowerCase().includes(q) ||
            (a.type || '').toLowerCase().includes(q) ||
            (a.start_date || '').toLowerCase().includes(q))
        : all
      ).slice(0, 25);
      return text({
        results: hits.map((a) => ({
          id: String(a.id),
          title: `${a.name} — ${new Date(a.start_date).toLocaleDateString('es-ES')}`,
          url: `https://www.strava.com/activities/${a.id}`,
        })),
      });
    },
  },
  {
    name: 'fetch',
    description: 'Recupera el documento completo de una actividad por su id (el que devuelve search).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    run: async (userId, args) => {
      const all = await getActivities(userId);
      const a = all.find((x) => String(x.id) === String(args.id));
      if (!a) return toolError(`Actividad ${args.id} no encontrada.`);
      // Sin la polyline del mapa: es la sección más pesada del documento y no aporta
      // nada legible a un modelo. Quien la necesite usa get_activity con include:["map"].
      const full = shapeFull(a, FULL_SECTIONS_NO_MAP);
      return text({
        id: String(a.id),
        title: `${a.name} — ${new Date(a.start_date).toLocaleDateString('es-ES')}`,
        text: JSON.stringify(full, null, 2),
        url: `https://www.strava.com/activities/${a.id}`,
        metadata: { type: a.type, distance_km: full.distance_km, date: a.start_date },
      });
    },
  },
];

// Índice name → tool para el dispatch, y la lista de descriptores que ve el cliente
// (sin `run`). Ambos derivan del mismo array: imposible que un schema no tenga handler.
const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// Título legible por tool (campo `title` de la spec: lo que enseña la UI, frente a
// `name` que es el identificador). Centralizado aquí para poder auditar de un vistazo
// que ninguna tool se queda sin él.
const TITLES = {
  list_activities: 'Listar actividades', get_activity: 'Detalle de actividad',
  activity_stats: 'Agregados de actividad', list_running_dynamics: 'Running dynamics',
  compare_similar_sessions: 'Comparar sesiones equivalentes',
  get_personal_bests: 'Mejores marcas', personal_records: 'Récords por distancia',
  best_efforts_progression: 'Progresión por distancia', list_hrv_resting: 'VFC y FC en reposo',
  list_sleep: 'Sueño semanal', list_sleep_daily: 'Sueño por noche', list_weight: 'Peso y composición',
  get_training_readiness: 'Training readiness', get_fitness_status: 'Estado de forma',
  list_planned_workouts: 'Entrenos planificados', get_training_load_model: 'Carga de entrenamiento',
  get_health_alerts: 'Alertas de salud', time_in_zones: 'Tiempo en zonas de FC',
  detect_threshold_efforts: 'Detectar tests de umbral', list_garmin_workouts: 'Listar entrenos Garmin',
  get_garmin_workout: 'Leer entreno Garmin', create_garmin_workout: 'Crear entreno Garmin',
  update_garmin_workout: 'Modificar entreno Garmin', delete_garmin_workout: 'Borrar entreno Garmin',
  schedule_garmin_workout: 'Agendar entreno Garmin',
  list_target_races: 'Listar carreras objetivo', get_target_race: 'Leer carrera objetivo',
  upsert_target_race: 'Crear/editar carrera y plan', delete_target_race: 'Borrar carrera objetivo',
  set_primary_target_race: 'Fijar objetivo principal',
  search: 'Buscar actividades', fetch: 'Recuperar actividad',
};

// Excepciones al comportamiento por defecto (READ_CACHED). Las de lectura EN VIVO salen
// a Garmin en el momento; las de escritura mutan el calendario/biblioteca del usuario.
const ANNOTATIONS = {
  list_sleep: READ_LIVE,            // completa la semana en curso desde Garmin en vivo
  list_sleep_daily: READ_LIVE, list_weight: READ_LIVE,
  get_training_readiness: READ_LIVE, get_fitness_status: READ_LIVE,
  list_planned_workouts: READ_LIVE, list_garmin_workouts: READ_LIVE, get_garmin_workout: READ_LIVE,
  create_garmin_workout: WRITE_CREATE, schedule_garmin_workout: WRITE_CREATE,
  update_garmin_workout: WRITE_UPDATE, delete_garmin_workout: WRITE_UPDATE,
  // Carreras objetivo: escriben en Supabase (nuestra propia BD), no en un sistema externo.
  upsert_target_race: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  set_primary_target_race: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  delete_target_race: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
};

const TOOL_DESCRIPTORS = TOOLS.map(({ name, description, inputSchema }) => ({
  name,
  title: TITLES[name] || name,
  description,
  inputSchema,
  annotations: { title: TITLES[name] || name, ...(ANNOTATIONS[name] || READ_CACHED) },
}));

// Las tools en vivo/escritura hacen login + varias peticiones a Garmin: damos margen.
export const config = { maxDuration: 60 };

// Respuesta JSON con res crudo de Node (no depende del azúcar .status().json() de
// Vercel, porque este handler comparte res con el transporte MCP que escribe raw).
function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

// ── Ejecución de cada tool para un userId concreto ───────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Validación de los args de fecha antes de ejecutar. Una fecha mal formada (p.ej.
// "2026-8-1" o "hace un mes") caía al filtro como string y comparaba lexicográficamente
// sin avisar: devolvía un rango silenciosamente incorrecto en vez de un error.
function validateArgs(args) {
  for (const k of ['from', 'to', 'date']) {
    if (args[k] != null && args[k] !== '' && !ISO_DATE.test(String(args[k]))) {
      return `El parámetro "${k}" debe ser una fecha ISO YYYY-MM-DD (recibido: ${JSON.stringify(args[k])}).`;
    }
  }
  if (args.from && args.to && String(args.from) > String(args.to)) {
    return `Rango invertido: "from" (${args.from}) es posterior a "to" (${args.to}).`;
  }
  return null;
}

async function runTool(userId, name, args = {}) {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    return toolError(`Tool desconocida: ${name}`, { available: [...TOOL_MAP.keys()] });
  }
  const bad = validateArgs(args);
  if (bad) return toolError(bad);
  // Frescura del cache antes de leerlo. Solo en las tools de LECTURA (las de
  // escritura no lo consultan). Casi siempre es un no-op sin I/O (ver mcp-sync):
  // el delta real se paga como mucho una vez cada 10 min, no una vez por tool.
  if ((ANNOTATIONS[name] || READ_CACHED).readOnlyHint) {
    await ensureFresh(userId);
  }
  return tool.run(userId, args);
}

// `instructions` (spec MCP): orientación de uso que el cliente puede dar al modelo.
// Aquí resume las trampas reales de estos datos, que ya han causado lecturas erróneas.
const INSTRUCTIONS = [
  'Datos de entrenamiento de un corredor (Strava + Garmin).',
  'Fuentes: las tools marcadas openWorldHint consultan Garmin en vivo (más lentas); el resto lee cache.',
  'Contexto: get_activity pesa ~10-12k tokens; usa `include` para pedir solo las secciones necesarias.',
  'FC: `avg_hr_min`/`avg_hr_max` en list_activities filtran por FC MEDIA de la sesión;',
  '`hr_max` en time_in_zones y detect_threshold_efforts es la FCmax FISIOLÓGICA del atleta.',
  'Marcas: un `distance_delta_m` > 0 significa que el tiempo es cota superior del tiempo',
  'a la distancia estándar (se corrió algo más largo); nunca se reescala el tiempo.',
  'GAP: `gap.source` distingue el cálculo propio (Minetti) del `gap_pace` de los laps de Garmin: no mezclarlos.',
  'GAP: si `gap.caveat` viene informado, el recorrido es ondulado y el ajuste queda corto (cota inferior).',
  'FC origen: `hr_source` nunca es null; `unknown` significa "no se sabe", no "sin banda".',
  '`hr_source_origin` = sensors (leído de Garmin) | cutoff (inferido de `hr_strap_since`) | missing.',
  'Calor: usa `heat_penalty_session_pct` (ya escalada a la intensidad de esa sesión).',
  '`heat_penalty_pct` es la referencia de tabla a ritmo de COMPETICIÓN y sobreestima un rodaje suave.',
  'Tiempos: `moving_time_min` es tiempo en movimiento y `elapsed_time_min` el total puerta a puerta;',
  'en tiradas largas difieren varios minutos. Si `data_consistency.consistent` es false, la suma de',
  'los laps no cuadra con la cabecera: no mezcles ritmos derivados de una y otra fuente.',
  'Distancias: usa `distance_m` (entero) para recalcular ritmos; `distance_km` va redondeado.',
  'Dinámica: list_running_dynamics excluye por defecto los runs < 3 km (calentamientos sueltos que',
  'sesgan las medias); `min_distance_km: 0` los incluye.',
  'Objetivo: la carrera con `is_primary` es el OBJETIVO PRINCIPAL del atleta; basa planes,',
  'predicciones y consejos en ella salvo que se pida otra cosa. Las demás son informativas.',
  'VFC: usa `hrv_deviation` (above/below/within) para el semáforo; `hrv_status` de Garmin no indica el sentido.',
].join(' ');

function buildServer(userId) {
  const server = new Server(
    { name: 'runanalyzer', version: '1.1.0' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DESCRIPTORS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      return await runTool(userId, req.params.name, req.params.arguments || {});
    } catch (e) {
      console.error(`tool ${req.params?.name} failed:`, e);
      return toolError(e.message);
    }
  });
  return server;
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Streamable HTTP stateless: solo POST lleva JSON-RPC. GET/DELETE no se usan.
  if (req.method !== 'POST') {
    return sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed' }, id: null }, { Allow: 'POST, OPTIONS' });
  }

  // ── Auth Bearer ────────────────────────────────────────────────────────────
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  let userId = null;
  if (token) {
    try {
      const claims = await verifyAccessToken(token);
      // Enforce audience (RFC 8707): un token emitido para otro recurso no vale aquí.
      // El `aud` lo pone nuestro propio token endpoint = resourceUrl(req); solo lo
      // exigimos si el token lo trae, para no invalidar tokens antiguos sin `aud`.
      if (!claims.aud || claims.aud === resourceUrl(req)) userId = claims.sub;
    } catch { userId = null; }
  }
  if (!userId) {
    return sendJson(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }, {
      'WWW-Authenticate': `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`,
    });
  }

  // ── Servir la petición MCP (nuevo server+transport por request: stateless) ──
  const server = buildServer(userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('MCP handler error:', e);
    if (!res.headersSent) {
      sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  }
}
