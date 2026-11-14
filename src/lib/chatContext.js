// Contexto del chat (RunQA): funciones puras que convierten los datos del
// atleta en el system prompt. Separadas del componente para poder probarlas
// con datos reales y medir la calidad de las respuestas fuera del navegador.
import { paceStr } from './aiInsights';
import { formatDuration } from './timeFormat';
import { daysUntil, formatMinutes } from './targetRaces';
import { raceResult } from './raceResults';

export const DETAIL_DAYS = 90;
// Ventanas de contexto. FULL: todo en el prompt (proveedores sin herramientas).
// LEAN: lo justo para orientarse; el resto lo pide el modelo con herramientas
// (ver api/_lib/chat-tools.js). Ahorra ~2/3 del prompt en cada turno.
export const WINDOWS = {
    full: { detailDays: DETAIL_DAYS, minDetail: 15, garminDays: DETAIL_DAYS, planBack: 14, planFwd: 21, planChars: 4000 },
    lean: { detailDays: 21, minDetail: 8, garminDays: 14, planBack: 7, planFwd: 14, planChars: 1500 },
};
export const MIN_DETAIL = 15;
const DAY = 864e5;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

export const sortActivities = (activities) =>
    [...(activities || [])].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

/** Actividades en detalle: últimos DETAIL_DAYS, como mínimo MIN_DETAIL. */
export function selectDetail(sorted, now = Date.now(), win = WINDOWS.full) {
    const cutoff = now - win.detailDays * DAY;
    const recent = sorted.filter(a => new Date(a.start_date).getTime() >= cutoff);
    return recent.length >= win.minDetail ? recent : sorted.slice(0, win.minDetail);
}

// Convierte el análisis del panel (AIInsights) en markdown, tanto para la
// tarjeta de contexto visible como para el system prompt del chat.
export const seedToText = (seed) => {
    if (!seed?.blocks) return '';
    const b = seed.blocks;
    const s = seed.sci;
    const lines = [];
    if (b.cur) lines.push(`**Estado actual**\n${b.cur}`);
    if (b.trend) lines.push(`**Tendencia y patrón**\n${b.trend}`);
    if (b.nextWork) lines.push(`**Sesión recomendada**\n${b.nextWork}`);
    if (b.lastWork) lines.push(`**Análisis del último entrenamiento**\n${b.lastWork}`);
    if (s) {
        const parts = [];
        if (s.readiness != null) parts.push(`Readiness ${s.readiness}/100${s.readinessLabel ? ` (${s.readinessLabel})` : ''}`);
        if (s.ctl != null) parts.push(`CTL ${s.ctl}`);
        if (s.atl != null) parts.push(`ATL ${s.atl}`);
        if (s.tsb != null) parts.push(`TSB ${s.tsb > 0 ? '+' : ''}${s.tsb}`);
        if (s.acwr != null) parts.push(`ACWR ${s.acwr}`);
        if (s.fcmax != null) parts.push(`FCmax ${s.fcmax}ppm`);
        if (s.lthr != null) parts.push(`LTHR ${s.lthr}ppm`);
        if (s.fcRest != null) parts.push(`FC reposo ${s.fcRest}ppm`);
        if (parts.length) lines.push(`**Métricas clave:** ${parts.join(' · ')}`);
    }
    return lines.join('\n\n');
};

// El plan de carrera puede venir como página HTML completa: se pasa a texto
// plano (sin <head>, estilos ni scripts) para no gastar tokens en CSS.
export function planToText(plan) {
    const raw = String(plan || '');
    if (!/<\/?[a-z][\s\S]*>/i.test(raw)) return raw.trim();
    return raw
        .replace(/<(head|style|script|svg)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#?\w+;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
}

const resultText = (res) => {
    if (!res) return '';
    const t = formatMinutes(res.time_min);
    if (res.incomplete) return ` · NO completada: ${(res.distance_m / 1000).toFixed(1)} km en ${t}`;
    if (res.achieved != null) return ` · resultado ${t} (${res.achieved ? 'objetivo cumplido' : 'objetivo no cumplido'})`;
    return ` · resultado ${t}`;
};

// Objetivos: carreras (la principal manda), su plan y las sesiones planificadas
// alrededor de hoy (-14 / +21 días).
export function formatGoals({ races = [], primary = null, plans = [], activities = [] }, now = Date.now(), win = WINDOWS.full) {
    if (!races.length && !plans.length) return null;
    const out = [];
    const today = isoDay(now);
    const raceLine = (r) => {
        const d = daysUntil(r.date);
        const when = d === 0 ? 'HOY' : d === 1 ? 'MAÑANA' : d > 0 ? `faltan ${d} días` : `hace ${-d} días`;
        const goal = r.goalTimeMin ? ` · objetivo ${formatMinutes(r.goalTimeMin)}` : '';
        const res = d < 0 ? resultText(raceResult(r, activities)) : '';
        return `- ${r.id === primary?.id ? '[PRINCIPAL] ' : ''}${r.name} · ${r.distance} · ${r.date} (${when})${goal}${res}`;
    };
    const relevant = [...races]
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter(r => r.id === primary?.id || daysUntil(r.date) > -120);
    if (relevant.length) out.push(`CARRERAS OBJETIVO:\n${relevant.map(raceLine).join('\n')}`);
    const planText = planToText(primary?.plan);
    if (planText) out.push(`PLAN DE LA CARRERA PRINCIPAL (extracto):\n${planText.slice(0, win.planChars)}`);
    const from = isoDay(now - win.planBack * DAY);
    const to = isoDay(now + win.planFwd * DAY);
    const active = plans.filter(pl => !primary || !pl.raceId || pl.raceId === primary.id);
    for (const pl of active) {
        const ws = (pl.workouts || []).filter(w => w.date >= from && w.date <= to).sort((a, b) => a.date.localeCompare(b.date));
        if (!ws.length) continue;
        const lines = ws.map(w => {
            const size = [w.distance_km && `${w.distance_km} km`, w.duration_min && `${w.duration_min} min`].filter(Boolean).join(', ');
            return `${w.date}${w.date === today ? ' (HOY)' : ''} · ${w.type || 'sesión'} · ${w.summary || ''}${size ? ` (${size})` : ''} · ${w.status || 'planned'}${w.coach_note ? ` · nota: ${w.coach_note}` : ''}`;
        });
        out.push(`PLAN "${pl.name}" (sesiones de -${win.planBack} a +${win.planFwd} días):\n${lines.join('\n')}`);
    }
    return out.length ? out.join('\n\n') : null;
}

export function formatActivities(acts) {
    return acts.map((a, idx) => {
        const distKm = (a.distance / 1000).toFixed(2);
        // Ritmo en M:SS (el decimal "5.32 min/km" se presta a leerse como 5:32)
        // y con guard: una actividad manual sin distancia no debe meter Infinity.
        const pace = a.distance > 0 && a.moving_time > 0
            ? `${paceStr((a.moving_time / 60) / (a.distance / 1000))} min/km`
            : 'n/d';
        const date = new Date(a.start_date).toLocaleDateString('es-ES', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        });
        const extras = [];
        if (a.average_heartrate) extras.push(`FC: ${Math.round(a.average_heartrate)} ppm`);
        if (a.total_elevation_gain) extras.push(`Desnivel: +${Math.round(a.total_elevation_gain)}m`);
        if (a.max_speed) extras.push(`Vel. máx: ${(a.max_speed * 3.6).toFixed(1)} km/h`);
        if (a.average_cadence) extras.push(`Cadencia: ${Math.round(a.average_cadence * 2)} spm`);
        // Parciales por km: sin ellos, los proveedores sin herramientas (todos
        // menos el OpenUI Gateway) respondían "no hay desglose km a km".
        const splits = Array.isArray(a.splits_metric)
            ? a.splits_metric.filter(sp => sp.distance > 0 && sp.moving_time > 0).map(sp => {
                const p = paceStr((sp.moving_time / 60) / (sp.distance / 1000));
                const hr = sp.average_heartrate ? `/${Math.round(sp.average_heartrate)}` : '';
                const el = Math.abs(sp.elevation_difference ?? 0) >= 2 ? `/${sp.elevation_difference > 0 ? '+' : ''}${Math.round(sp.elevation_difference)}m` : '';
                return `${p}${hr}${el}`;
            })
            : [];
        const splitsLine = splits.length >= 2 ? `\n   • Parciales/km (ritmo/FC/±desnivel; el último puede ser un tramo parcial): ${splits.join(' · ')}` : '';
        return `${idx + 1}. "${a.name}" - ${date}${a.id != null ? ` [id ${a.id}]` : ''}
   • Distancia: ${distKm} km | Tiempo: ${formatDuration(a.moving_time)} | Ritmo: ${pace}${extras.length ? '\n   • ' + extras.join(' | ') : ''}${splitsLine}`;
    }).join('\n\n');
}

export function garminInRange(garmin, now = Date.now(), days = DETAIL_DAYS) {
    if (!garmin?.length) return [];
    const cutoff = now - days * DAY;
    return garmin.filter(d => new Date(d.date).getTime() >= cutoff);
}

// Garmin entrega el estado de la VFC en inglés; el modelo lo copiaría tal cual.
const HRV_STATUS_ES = { BALANCED: 'VFC equilibrada', UNBALANCED: 'VFC desequilibrada', LOW: 'VFC baja', POOR: 'VFC muy baja' };

export function formatGarmin(garmin, now = Date.now(), days = DETAIL_DAYS) {
    const filtered = [...garminInRange(garmin, now, days)].sort((a, b) => b.date.localeCompare(a.date));
    if (!filtered.length) return null;
    const lines = filtered.map(d => {
        const parts = [d.date.slice(5)];
        if (d.hrv)        parts.push(`VFC=${d.hrv}ms`);
        if (d.restingHR)  parts.push(`RHR=${d.restingHR}ppm`);
        if (d.hrvStatus)  parts.push(`[${HRV_STATUS_ES[d.hrvStatus] || d.hrvStatus}]`);
        if (d.sleepHours) parts.push(`sueño=${d.sleepHours}h`);
        if (d.stress)     parts.push(`estrés=${d.stress}`);
        return parts.join(' ');
    });
    return `DATOS GARMIN (últimos ${days} días):\n${lines.join('\n')}`;
}

// Historial anterior al detalle, agregado por mes (barato en tokens).
export function formatHistory(sorted, detailCount) {
    const older = sorted.slice(detailCount);
    if (!older.length) return null;
    const months = new Map();
    for (const a of older) {
        const k = a.start_date.slice(0, 7);
        const m = months.get(k) || { n: 0, m: 0, t: 0, hr: 0, hrN: 0, long: 0 };
        m.n++; m.m += a.distance || 0; m.t += a.moving_time || 0;
        m.long = Math.max(m.long, a.distance || 0);
        if (a.average_heartrate) { m.hr += a.average_heartrate; m.hrN++; }
        months.set(k, m);
    }
    const lines = [...months].map(([k, m]) => {
        const pace = m.m > 0 ? `${paceStr((m.t / 60) / (m.m / 1000))} min/km` : 'n/d';
        return `${k}: ${m.n} sesiones · ${(m.m / 1000).toFixed(0)} km · más larga ${(m.long / 1000).toFixed(1)} km · ritmo medio ${pace}${m.hrN ? ` · FC media ${Math.round(m.hr / m.hrN)} ppm` : ''}`;
    });
    return `HISTORIAL ANTERIOR (resumen mensual, ${older.length} actividades):\n${lines.join('\n')}`;
}

/** System prompt completo del chat. `formatPrompt` = instrucciones de OpenUI. */
export function buildChatSystemPrompt({ activities, garmin, races, primary, plans, seed, formatPrompt, lean = false, now = Date.now() }) {
    const win = lean ? WINDOWS.lean : WINDOWS.full;
    const sorted = sortActivities(activities);
    const detail = selectDetail(sorted, now, win);
    const garminText = formatGarmin(garmin, now, win.garminDays);
    const historyText = formatHistory(sorted, detail.length);
    const goalsText = formatGoals({ races, primary, plans, activities }, now, win);
    return `Eres un analista experto de running y entrenamiento deportivo.
El usuario te proporcionará sus últimas carreras/entrenamientos y te hará preguntas sobre ellas.

HOY ES: ${new Date(now).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Usa esta fecha como referencia para "esta semana", "último mes", etc.

${goalsText ? `OBJETIVOS DEL ATLETA (la carrera [PRINCIPAL] es su objetivo: basa consejos, ritmos y valoraciones en ella salvo que pregunte por otra):\n${goalsText}\n\n` : 'El atleta no tiene carreras objetivo registradas en la app.\n\n'}DETALLE DE LAS ÚLTIMAS ${detail.length} ACTIVIDADES:
${formatActivities(detail)}
${garminText ? '\n' + garminText : ''}
${historyText ? '\n' + historyText : ''}
${seed ? `\nANÁLISIS PREVIO DEL PANEL DE IA (el usuario viene de aquí; sus preguntas son SEGUIMIENTO de este diagnóstico — trátalo como contexto principal y mantén coherencia con él):\n${seedToText(seed)}\n` : ''}
${lean ? `HERRAMIENTAS: arriba solo va lo reciente. Si la pregunta necesita más (sesiones antiguas, vueltas o splits de una actividad, zonas de FC, VFC histórica, récords, predicciones, carga, el plan completo, lesiones o el diario), CONSULTA las herramientas antes de responder: pide rangos de fechas concretos y solo las secciones necesarias. Basa las cifras en lo que devuelvan; no las inventes. Los ids de actividad van entre corchetes [id …] en la lista de arriba; si la actividad no está ahí, búscala primero con list_activities (por fecha). NUNCA inventes un id. No escribas nada antes de tener los datos: la respuesta empieza directamente con el programa.\n\n` : ''}CRITERIOS:
- Responde de forma clara, directa y útil; concisa pero completa
- Usa SOLO los datos proporcionados; si un dato no está en ellos, dilo claramente en lugar de estimarlo o inventarlo
- Si haces cálculos (promedios, tendencias...), hazlos con las cifras exactas de los datos
- Puedes dar recomendaciones basadas en los datos
- Si las notas del plan o de los entrenos ajustan el objetivo o los ritmos, manda la nota MÁS RECIENTE: cítala con su fecha y no mezcles cifras de ajustes anteriores
- Si el plan o una nota ya dan un tiempo final o una estimación, cítalos TAL CUAL; no los recalcules a partir del ritmo (el ritmo "de reloj" del GPS no equivale a la distancia oficial)
- Sé coherente: el mismo dato (ritmo objetivo, tiempo estimado) debe darse igual en toda la respuesta
- Responde en el mismo idioma en el que pregunta el usuario (por defecto, español)

FORMATO DE RESPUESTA:
${formatPrompt}`;
}
