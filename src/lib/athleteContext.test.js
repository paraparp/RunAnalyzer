import { describe, it, expect } from 'vitest';
import { buildPlainActivityLog, buildPrompt } from './athleteContext';

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Todo es relativo a "hoy": buildPrompt corta por ventanas móviles (1 año, 8 sem,
// 4 sem, 7 d) leídas de `new Date()`, así que las fechas fijas caducarían.

const daysAgo = (n) => {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};
const isoAgo = (n) => daysAgo(n).toISOString();
const ymdAgo = (n) => isoAgo(n).slice(0, 10);

const run = (n, o = {}) => ({
  id: 1000 + n,
  type: 'Run',
  name: `Rodaje ${n}`,
  start_date: isoAgo(n),
  start_date_local: isoAgo(n),
  distance: 10000,
  moving_time: 3000,
  elapsed_time: 3060,
  total_elevation_gain: 40,
  average_heartrate: 148,
  max_heartrate: 172,
  ...o,
});

/** Bloque realista: 4 carreras por semana durante `weeks` semanas. */
const block = (weeks = 10) => {
  const out = [];
  for (let w = 0; w < weeks; w++) {
    for (const [i, d] of [0, 2, 4, 6].entries()) {
      const n = w * 7 + d;
      out.push(run(n, {
        id: 1000 + n,
        distance: i === 3 ? 18000 : 10000,
        moving_time: i === 3 ? 5700 : 3000,
        average_heartrate: i === 1 ? 168 : 148,
        max_heartrate: i === 1 ? 186 : 170,
      }));
    }
  }
  return out;
};

const garmin = (days = 30) => Array.from({ length: days }, (_, i) => ({
  date: ymdAgo(i),
  hrv: 62 + (i % 5),
  hrvStatus: 'BALANCED',
  baseline: { balancedLow: 55, balancedUpper: 75 },
  restingHR: 48 + (i % 3),
  bbHigh: 78,
  bbLow: 22,
}));

const sleep = () => [{ weekStart: ymdAgo(3), score: 82, quality: 'GOOD', durationMin: 430, needMin: 480, deepMin: 70, remMin: 90 }];

// ── buildPlainActivityLog ────────────────────────────────────────────────────

describe('buildPlainActivityLog', () => {
  it('devuelve cadena vacía sin actividades', () => {
    expect(buildPlainActivityLog([])).toBe('');
    expect(buildPlainActivityLog(null)).toBe('');
    expect(buildPlainActivityLog(undefined)).toBe('');
  });

  it('descarta lo anterior a 3 meses', () => {
    const log = buildPlainActivityLog([run(5), run(200, { id: 999, distance: 42195 })]);
    expect(log.split('\n')).toHaveLength(1);
    expect(log).not.toContain('42.19');
  });

  it('ordena de más reciente a más antigua', () => {
    const log = buildPlainActivityLog([run(2, { distance: 5000 }), run(20, { distance: 15000 })]);
    const [primera, segunda] = log.split('\n');
    expect(primera).toContain('5.00km');
    expect(segunda).toContain('15.00km');
  });

  it('formatea el ritmo en M:SS/km, no en decimal', () => {
    // 10 km en 50:00 → 5:00/km. El formato decimal (5.00) se lee como 5:00 y engaña.
    const log = buildPlainActivityLog([run(1, { distance: 10000, moving_time: 3000 })]);
    expect(log).toContain('5:00 min/km');
  });

  it('no produce "4:60": redondea sobre los segundos TOTALES', () => {
    // 10 km en 49:57 → 299.7 s/km, que con el patrón (p % 1) * 60 sale "4:60".
    const log = buildPlainActivityLog([run(1, { distance: 10000, moving_time: 2997 })]);
    expect(log).toContain('5:00 min/km');
    expect(log).not.toMatch(/:60 min\/km/);
  });

  it('marca las actividades sin ritmo y sin FC en vez de inventarlos', () => {
    const log = buildPlainActivityLog([run(1, { distance: 0, moving_time: 0, average_heartrate: null })]);
    expect(log).toContain('ritmo n/d');
    expect(log).toContain('sin FC');
  });

  it('incluye FC y desnivel cuando existen', () => {
    const log = buildPlainActivityLog([run(1, { average_heartrate: 152.4, total_elevation_gain: 137.6 })]);
    expect(log).toContain('FC media: 152ppm');
    expect(log).toContain('Desnivel: +138m');
  });
});

// ── buildPrompt: casos degenerados ───────────────────────────────────────────

describe('buildPrompt · sin datos utilizables', () => {
  it('devuelve null sin actividades', () => {
    expect(buildPrompt([], null, null, null, null)).toBeNull();
  });

  it('devuelve null si todo es anterior a un año', () => {
    expect(buildPrompt([run(500), run(400)], null, null, null, null)).toBeNull();
  });

  it('no revienta con una sola actividad y cero datos de wearable', () => {
    const res = buildPrompt([run(1)], null, null, null, null);
    expect(res).not.toBeNull();
    expect(typeof res.prompt).toBe('string');
  });
});

// ── buildPrompt: forma del resultado ─────────────────────────────────────────

describe('buildPrompt · contrato de salida', () => {
  const res = buildPrompt(block(), garmin(), sleep(), 4, null);

  it('devuelve prompt, athleteContext y sci', () => {
    expect(Object.keys(res).sort()).toEqual(['athleteContext', 'prompt', 'sci']);
  });

  it('el prompt incorpora íntegro el athleteContext (la parte reutilizable)', () => {
    expect(res.prompt).toContain(res.athleteContext);
  });

  it('el athleteContext trae todas las secciones que el prompt promete', () => {
    for (const seccion of [
      'DATOS DEL ATLETA:', 'CONTEXTO TEMPORAL:', 'ZONAS DE FC CALCULADAS:',
      'RITMOS DE REFERENCIA:', 'MODELO DE CARGA (Banister PMC):',
      'ENTRENAMIENTO (resumen 4 sem):', 'Desglose semanal (carrera):',
    ]) {
      expect(res.athleteContext).toContain(seccion);
    }
  });

  it('sci expone la fisiología ya calculada, sin decimales sueltos en el PMC', () => {
    const { sci } = res;
    expect(sci.fcmax).toBeGreaterThan(150);
    expect(sci.lthr).toBeGreaterThan(100);
    expect(sci.lthr).toBeLessThan(sci.fcmax);
    for (const k of ['ctl', 'atl', 'tsb', 'peak']) {
      expect(Number.isInteger(sci.pmc[k])).toBe(true);
    }
    expect(sci.pmc.ctl).toBeGreaterThan(0);
  });

  it('LT1 queda por debajo de LT2 (si no, las zonas salen invertidas)', () => {
    expect(res.sci.lt.lt1Hr).toBeLessThan(res.sci.lt.lt2Hr);
    expect(res.sci.lt.lt2Hr).toBe(res.sci.lthr);
  });

  it('el readiness sale determinista y en rango 0-100', () => {
    const otro = buildPrompt(block(), garmin(), sleep(), 4, null);
    expect(res.sci.readiness.score).toBe(otro.sci.readiness.score);
    expect(res.sci.readiness.score).toBeGreaterThanOrEqual(0);
    expect(res.sci.readiness.score).toBeLessThanOrEqual(100);
    expect(['high', 'good', 'mod', 'low']).toContain(res.sci.readiness.band);
  });

  it('la distribución polarizada suma ~100%', () => {
    const { easy, thr, hard } = res.sci.polarized;
    expect(easy + thr + hard).toBeGreaterThanOrEqual(99);
    expect(easy + thr + hard).toBeLessThanOrEqual(101);
  });
});

// ── buildPrompt: degradación cuando faltan datos ─────────────────────────────

describe('buildPrompt · datos ausentes', () => {
  it('enumera lo que falta en vez de inventarlo', () => {
    const res = buildPrompt(block(), null, null, null, null);
    expect(res.athleteContext).toContain('DATOS AUSENTES');
    expect(res.athleteContext).toContain('sin Garmin');
    expect(res.athleteContext).toContain('sueño');
  });

  it('sin wearable el readiness se sigue calculando con las señales que quedan', () => {
    // computeReadiness pondera lo disponible sobre la suma de pesos PRESENTES:
    // sin VFC/Body Battery/sueño queda el TSB y el score sigue siendo utilizable.
    const res = buildPrompt(block(), null, null, null, null);
    expect(res.sci.readiness.score).toBeGreaterThan(0);
    expect(res.sci.hrv).toBeNull();
    expect(res.sci.sleep).toBeNull();
  });

  it('con wearable completo no arrastra el aviso de readiness ausente', () => {
    const res = buildPrompt(block(), garmin(), sleep(), null, null);
    expect(res.athleteContext).not.toContain('READINESS SCORE: no disponible');
    expect(res.athleteContext).toContain('READINESS SCORE (0-100');
  });

  it('marca las carreras sin pulsómetro como dato ausente', () => {
    const sinFc = block().map((a) => ({ ...a, average_heartrate: null }));
    expect(buildPrompt(sinFc, null, null, null, null).athleteContext)
      .toContain('carreras sin pulsómetro');
  });
});

// ── buildPrompt: objetivo de carrera ─────────────────────────────────────────

describe('buildPrompt · objetivo de carrera', () => {
  it("acepta la distancia en mayúsculas ('21K'), como la manda el planificador", () => {
    const res = buildPrompt(block(), null, null, null, { distance: '21K' });
    expect(res.athleteContext).toContain('OBJETIVO DE CARRERA');
    expect(res.athleteContext).toContain('21K');
  });

  it('ignora una distancia desconocida en vez de emitir un objetivo vacío', () => {
    const res = buildPrompt(block(), null, null, null, { distance: '17k' });
    expect(res.athleteContext).not.toContain('OBJETIVO DE CARRERA');
  });

  it('deriva el tiempo meta del ritmo objetivo sobre la distancia oficial', () => {
    // 4:30/km × 21.0975 km = 1:34:56. Con 21.098 km el minuto final baila.
    const res = buildPrompt(block(), null, null, null, { distance: '21k', pace: '4:30' });
    expect(res.athleteContext).toContain('tiempo meta ≈ 1:34:56');
  });

  it('sin ritmo objetivo pide uno realista en vez de asumirlo', () => {
    const res = buildPrompt(block(), null, null, null, { distance: '10k' });
    expect(res.athleteContext).toContain('sin ritmo objetivo fijado');
  });

  it('periodiza según los días que faltan', () => {
    const fase = (dias) => buildPrompt(block(), null, null, null, {
      distance: '10k', date: ymdAgo(-dias),
    }).athleteContext;
    expect(fase(7)).toContain('TAPER');
    expect(fase(21)).toContain('fase específica/pico');
    expect(fase(45)).toContain('fase de construcción');
    expect(fase(90)).toContain('fase de base aeróbica');
  });

  it('avisa si la fecha objetivo ya pasó', () => {
    const res = buildPrompt(block(), null, null, null, { distance: '10k', date: ymdAgo(10) });
    expect(res.athleteContext).toContain('YA PASÓ');
  });

  it('una fecha inválida no rompe el objetivo, solo se omite', () => {
    const res = buildPrompt(block(), null, null, null, { distance: '10k', date: 'mañana' });
    expect(res.athleteContext).toContain('OBJETIVO DE CARRERA');
    expect(res.athleteContext).not.toContain('faltan');
  });
});

// ── buildPrompt: disponibilidad y marcas ─────────────────────────────────────

describe('buildPrompt · disponibilidad y marcas personales', () => {
  it('incluye la disponibilidad semanal cuando el atleta la fija', () => {
    expect(buildPrompt(block(), null, null, 3, null).athleteContext)
      .toContain('quieres entrenar 3 sesión(es)');
  });

  it('la omite si no está fijada', () => {
    expect(buildPrompt(block(), null, null, null, null).athleteContext)
      .not.toContain('DISPONIBILIDAD / OBJETIVO');
  });

  it('reconoce una marca de 10K dentro de su rango de tolerancia', () => {
    const acts = [...block(), run(30, { id: 5, distance: 10050, elapsed_time: 2400, moving_time: 2400 })];
    const ctx = buildPrompt(acts, null, null, null, null).athleteContext;
    expect(ctx).toContain('MARCAS PERSONALES');
    expect(ctx).toMatch(/10K: 40:00 @3:59\/km/);
  });

  it('no cuenta como marca lo que se sale del rango de la distancia', () => {
    const ctx = buildPrompt([run(30, { distance: 12000, elapsed_time: 2400, moving_time: 2400 })], null, null, null, null).athleteContext;
    expect(ctx).not.toContain('MARCAS PERSONALES');
  });

  it('el tope es el esfuerzo más rápido de todos, no el más reciente', () => {
    const acts = [
      run(300, { id: 1, distance: 10000, elapsed_time: 2400, moving_time: 2400 }), // hace 10 meses, 40:00
      run(5, { id: 2, distance: 10000, elapsed_time: 3000, moving_time: 3000 }),   // reciente, 50:00
    ];
    expect(buildPrompt(acts, null, null, null, null).athleteContext).toContain('10K: 40:00');
  });
});

// ── buildPrompt: coherencia científica del texto ─────────────────────────────

describe('buildPrompt · coherencia del modelo de carga', () => {
  const ctx = buildPrompt(block(), garmin(), sleep(), null, null).athleteContext;

  it('presenta el ACWR con su advertencia metodológica, no como predictor', () => {
    // Misma regla que aplica InjuryRisk: desde Impellizzeri (2020) el ACWR es
    // señal blanda. Si alguien quita esta advertencia, el coach vuelve a
    // prescribir sobre un indicador cuestionado.
    expect(ctx).toContain('ACWR');
    expect(ctx).toContain('señal blanda');
    expect(ctx).toContain('Impellizzeri 2020');
  });

  it('acota la rampa de CTL a +5/sem', () => {
    expect(ctx).toContain('no superar +5/sem');
  });

  it('describe las tres zonas derivadas de LT1/LT2 sin solaparlas', () => {
    expect(ctx).toContain('Z1 fácil/base');
    expect(ctx).toContain('Z2 gris');
    expect(ctx).toContain('Z3 umbral+/calidad');
  });

  it('ancla los ritmos de calidad al LT2 y no al ritmo fácil', () => {
    expect(ctx).toContain('ESTA es tu ancla para base/fácil');
    expect(ctx).toMatch(/Tempo\/umbral/);
  });

  it('ningún ritmo de referencia sale negativo ni con segundos ≥60', () => {
    const ritmos = [...ctx.matchAll(/(\d+):(\d{2})\/km/g)];
    expect(ritmos.length).toBeGreaterThan(0);
    for (const [, , seg] of ritmos) expect(Number(seg)).toBeLessThan(60);
    // Un ritmo negativo (con el guion NO actuando de separador de rango) sería
    // dato corrupto; el propio prompt le prohíbe al modelo usarlo.
    expect(ctx).not.toMatch(/(?<![\d:])-\d+:\d{2}\/km/);
  });
});
