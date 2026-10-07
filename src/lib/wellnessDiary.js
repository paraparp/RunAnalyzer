// ============================================================================
// wellnessDiary — diario subjetivo: molestias por zona, RPE, ánimo y estrés.
//
// El índice de riesgo de lesión (InjuryRisk) solo veía la carga: volumen, rampa,
// descanso, monotonía. Esa es la mitad de la señal. La otra mitad solo la sabe
// el atleta: qué le duele, cuánto, desde cuándo, y cómo está de cabeza.
//
// Una entrada por día:
//   { date, pains: [{ zone, side: 'L'|'R'|'C', level 0-10 }], rpe 1-10 | null,
//     mood 1-5 | null, stress 1-5 | null, note }
//
// Criterios de alarma por zona (los de la práctica clínica en running, no un
// modelo ajustado: con un solo atleta no hay con qué ajustarlo):
//   · dolor ≥ 6 en los últimos 3 días → alerta (cambia la mecánica de la zancada)
//   · dolor ≥ 3 en ≥ 4 de los últimos 7 días → alerta (molestia persistente)
//   · tendencia ≥ +2 puntos (últimos 3 días frente a los 4 anteriores) → alerta
//   · dolor ≥ 3 en ≥ 2 de los últimos 7 días → vigilar
// ============================================================================
import { activityDayKey } from './trainingLoad.js';

export const DIARY_KEY = 'wellness_diary';
export const DIARY_EVENT = 'wellness-diary-updated';

/** Zonas del mapa corporal. `view`: dónde se pinta; `bilateral`: tiene lado. */
export const BODY_ZONES = [
  { id: 'hip_flexor', label: 'Cadera / flexor', view: 'front', x: 47, y: 118, bilateral: true },
  { id: 'quad', label: 'Cuádriceps', view: 'front', x: 47, y: 148, bilateral: true },
  { id: 'it_band', label: 'Banda iliotibial', view: 'front', x: 36, y: 162, bilateral: true },
  { id: 'knee', label: 'Rodilla', view: 'front', x: 47, y: 180, bilateral: true },
  { id: 'shin', label: 'Tibia', view: 'front', x: 47, y: 205, bilateral: true },
  { id: 'ankle', label: 'Tobillo', view: 'front', x: 47, y: 232, bilateral: true },
  { id: 'foot', label: 'Pie / empeine', view: 'front', x: 45, y: 248, bilateral: true },
  { id: 'lower_back', label: 'Lumbar', view: 'back', x: 60, y: 98, bilateral: false },
  { id: 'glute', label: 'Glúteo', view: 'back', x: 48, y: 122, bilateral: true },
  { id: 'hamstring', label: 'Isquiotibial', view: 'back', x: 47, y: 152, bilateral: true },
  { id: 'calf', label: 'Gemelo / sóleo', view: 'back', x: 47, y: 200, bilateral: true },
  { id: 'achilles', label: 'Aquiles', view: 'back', x: 47, y: 228, bilateral: true },
  { id: 'plantar', label: 'Fascia plantar', view: 'back', x: 46, y: 250, bilateral: true },
];
const ZONE_BY_ID = Object.fromEntries(BODY_ZONES.map((z) => [z.id, z]));

export const SIDE_LABEL = { L: 'izq.', R: 'dcha.', C: '' };

/** Nombre legible de una molestia ("Rodilla dcha."). */
export function painLabel(p) {
  const z = ZONE_BY_ID[p.zone];
  return [z?.label ?? p.zone, SIDE_LABEL[p.side]].filter(Boolean).join(' ');
}
const painKey = (p) => `${p.zone}:${p.side}`;

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// ── Almacén ──────────────────────────────────────────────────────────────────

/** Entradas guardadas, ordenadas por fecha ascendente. */
export function readDiary(storage) {
  try {
    const arr = JSON.parse(storage.getItem(DIARY_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((e) => e?.date).sort((a, b) => a.date.localeCompare(b.date)) : [];
  } catch {
    return [];
  }
}

/** Limpia una entrada: niveles acotados, sin dolores a 0, sin duplicados. */
export function normalizeEntry(e) {
  const clamp = (v, lo, hi) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.min(hi, Math.max(lo, Math.round(Number(v)))));
  const seen = new Map();
  for (const p of e.pains || []) {
    if (!ZONE_BY_ID[p?.zone]) continue;
    const side = ZONE_BY_ID[p.zone].bilateral ? (p.side === 'L' ? 'L' : 'R') : 'C';
    const level = clamp(p.level, 0, 10);
    if (!level) continue;
    seen.set(`${p.zone}:${side}`, { zone: p.zone, side, level });
  }
  return {
    date: e.date,
    pains: [...seen.values()],
    rpe: clamp(e.rpe, 1, 10),
    mood: clamp(e.mood, 1, 5),
    stress: clamp(e.stress, 1, 5),
    note: (e.note || '').trim().slice(0, 500) || null,
  };
}

const isEmpty = (e) => !e.pains.length && e.rpe == null && e.mood == null && e.stress == null && !e.note;

/** Guarda (o borra, si queda vacía) la entrada de su fecha. Devuelve el diario nuevo. */
export function saveEntry(storage, entry) {
  const clean = normalizeEntry(entry);
  const rest = readDiary(storage).filter((e) => e.date !== clean.date);
  const next = isEmpty(clean) ? rest : [...rest, clean].sort((a, b) => a.date.localeCompare(b.date));
  storage.setItem(DIARY_KEY, JSON.stringify(next));
  return next;
}

// ── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Señal por molestia en la última semana: `[{ zone, side, label, level, days,
 * max, last, trend, signal: 'alert'|'watch'|'ok', reasons }]`, la peor primero.
 */
export function painSignals(entries, todayISO) {
  const from7 = addDays(todayISO, -6);
  const from3 = addDays(todayISO, -2);
  const recent = entries.filter((e) => e.date >= from7 && e.date <= todayISO);
  const byPain = new Map();
  for (const e of recent) {
    for (const p of e.pains) {
      const k = painKey(p);
      if (!byPain.has(k)) byPain.set(k, { zone: p.zone, side: p.side, byDate: {} });
      byPain.get(k).byDate[e.date] = p.level;
    }
  }
  const out = [];
  for (const { zone, side, byDate } of byPain.values()) {
    const dates = Object.keys(byDate).sort();
    const levels = dates.map((d) => byDate[d]);
    const max = Math.max(...levels);
    const last = byDate[dates[dates.length - 1]];
    const days = levels.filter((l) => l >= 3).length;
    const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    // Días sin anotar esa zona cuentan como 0: si no se apunta, no dolía.
    const recent3 = [0, 1, 2].map((i) => byDate[addDays(todayISO, -i)] ?? 0);
    const prev4 = [3, 4, 5, 6].map((i) => byDate[addDays(todayISO, -i)] ?? 0);
    const trend = Math.round((mean(recent3) - mean(prev4)) * 10) / 10;
    const severeRecent = dates.some((d) => d >= from3 && byDate[d] >= 6);

    const reasons = [];
    if (severeRecent) reasons.push('dolor ≥ 6 en los últimos 3 días');
    if (days >= 4) reasons.push(`molestia en ${days} de los últimos 7 días`);
    if (trend >= 2 && mean(recent3) >= 3) reasons.push(`va a más (+${trend})`);
    const signal = reasons.length ? 'alert' : days >= 2 ? 'watch' : 'ok';
    if (signal === 'watch') reasons.push(`molestia en ${days} días esta semana`);
    out.push({ zone, side, label: painLabel({ zone, side }), max, last, days, trend, signal, reasons });
  }
  const rank = { alert: 0, watch: 1, ok: 2 };
  return out.sort((a, b) => rank[a.signal] - rank[b.signal] || b.max - a.max);
}

/**
 * Carga de sesión de Foster (RPE × minutos en movimiento) por día, cruzando el
 * RPE del diario con las actividades del día. `{ [date]: { rpe, minutes, load } }`.
 */
export function sessionRpeLoads(entries, activities) {
  const minutesByDay = {};
  for (const a of activities || []) {
    const d = activityDayKey(a);
    if (!d) continue;
    minutesByDay[d] = (minutesByDay[d] || 0) + (a.moving_time || a.elapsed_time || 0) / 60;
  }
  const out = {};
  for (const e of entries) {
    if (e.rpe == null || !minutesByDay[e.date]) continue;
    const minutes = Math.round(minutesByDay[e.date]);
    out[e.date] = { rpe: e.rpe, minutes, load: e.rpe * minutes };
  }
  return out;
}

/**
 * Factor subjetivo para el índice de lesión (0-100) y sus razones, o null si
 * no hay nada anotado en la última semana (no se puntúa lo que no se sabe).
 */
export function subjectiveRisk(entries, todayISO) {
  const from7 = addDays(todayISO, -6);
  const recent = entries.filter((e) => e.date >= from7 && e.date <= todayISO);
  if (!recent.length) return null;

  const signals = painSignals(entries, todayISO);
  const worst = signals[0];
  let painRisk = 0;
  if (worst?.signal === 'alert') painRisk = Math.min(100, 60 + worst.max * 4);
  else if (worst?.signal === 'watch') painRisk = 35 + worst.max * 2;
  else if (worst) painRisk = worst.max * 3;

  // Ánimo bajo y estrés alto en los últimos 3 días anotados: la recuperación
  // empeora con carga psicológica (Main & Grove 2009).
  const last3 = recent.slice(-3);
  const avg = (k) => {
    const v = last3.map((e) => e[k]).filter((x) => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const mood = avg('mood');
  const stress = avg('stress');
  let wellRisk = 0;
  if (mood != null && mood <= 2) wellRisk += 35;
  if (stress != null && stress >= 4) wellRisk += 35;

  const score = Math.round(Math.min(100, painRisk * 0.75 + wellRisk * 0.25 + (painRisk && wellRisk ? 10 : 0)));
  return {
    score,
    signals,
    mood: mood != null ? Math.round(mood * 10) / 10 : null,
    stress: stress != null ? Math.round(stress * 10) / 10 : null,
    entries: recent.length,
  };
}

/** Recomendaciones del diario, en el mismo tono que las del índice. */
export function diaryRecommendations(risk) {
  if (!risk) return [];
  const recs = [];
  for (const s of risk.signals.filter((x) => x.signal === 'alert')) {
    recs.push(`${s.label}: ${s.reasons.join(', ')}. Quita intensidad y volumen hasta que baje de 3/10; si no cede en una semana o te hace cojear, que lo vea un fisio.`);
  }
  const watch = risk.signals.filter((x) => x.signal === 'watch');
  if (watch.length) recs.push(`Vigila ${watch.map((s) => s.label.toLowerCase()).join(', ')}: si sube o aparece al correr, sustituye la calidad por rodaje suave.`);
  if (risk.mood != null && risk.mood <= 2) recs.push('Ánimo bajo los últimos días: la carga se tolera peor. Prioriza sueño y no metas sesiones duras nuevas.');
  if (risk.stress != null && risk.stress >= 4) recs.push('Estrés alto: cuenta como carga. Un rodaje suave suma; una sesión de calidad hoy probablemente resta.');
  return recs;
}
