import { describe, it, expect } from 'vitest';
import {
  LTHR_FROM_HRMAX, estimateLTHR, DEFAULT_REST_HR, HRMAX_FILTER,
  detectMaxHR, detectRestHR, thresholdBlocks, detectLTHR,
  seilerBounds, karvonenBounds, classifyHR,
} from './hrZones';

// hrZones es la fuente única de FCmax / FCreposo / LTHR: un cambio aquí mueve
// las zonas, el modelo de lactato, el PMC y el prompt del coach a la vez. Los
// tests fijan la política declarada en la cabecera del módulo, no solo los
// números: el estimador de FCreposo NO puede inventar valores desde la FC de
// actividad, y la cascada de LTHR tiene que degradar en el orden documentado.

const run = (over = {}) => ({
  average_heartrate: 150, max_heartrate: 170, moving_time: 2400, ...over,
});
const split = (hr, t = 240) => ({ average_heartrate: hr, moving_time: t });

describe('detectMaxHR', () => {
  it('es la mediana del 5 % superior, no el máximo', () => {
    // 100 carreras: 5 picos altos y el resto en 170
    const picos = [214, 205, 196, 195, 194];
    const acts = [
      ...picos.map(hr => run({ max_heartrate: hr })),
      ...Array.from({ length: 95 }, () => run({ max_heartrate: 170 })),
    ];
    // tamaño de muestra = max(5, 5 % de 100) = 5 → mediana de los 5 picos
    expect(detectMaxHR(acts)).toEqual({ value: 196, n: 5 });
  });

  it('un pico aislado no arrastra el resultado', () => {
    const base = Array.from({ length: 95 }, () => run({ max_heartrate: 170 }));
    const con = [214, 205, 196, 195, 194].map(hr => run({ max_heartrate: hr }));
    const sin = [170, 205, 196, 195, 194].map(hr => run({ max_heartrate: hr }));
    const dif = detectMaxHR([...con, ...base]).value - detectMaxHR([...sin, ...base]).value;
    expect(Math.abs(dif)).toBeLessThanOrEqual(1);
  });

  it('filtra los glitches de sensor fuera de 140–215', () => {
    const acts = [
      run({ max_heartrate: HRMAX_FILTER.lo }),   // 140 exacto: fuera (estricto)
      run({ max_heartrate: HRMAX_FILTER.hi }),   // 215 exacto: fuera
      run({ max_heartrate: 238 }),               // cadence-lock
      run({ max_heartrate: 60 }),                // óptico perdido
    ];
    expect(detectMaxHR(acts)).toEqual({ value: 185, n: 0 });
  });

  it('con histórico corto usa todas las muestras válidas', () => {
    const acts = [190, 185, 180].map(hr => run({ max_heartrate: hr }));
    expect(detectMaxHR(acts)).toEqual({ value: 185, n: 3 });
  });

  it('no explota sin datos', () => {
    expect(detectMaxHR([])).toEqual({ value: 185, n: 0 });
    expect(detectMaxHR(null)).toEqual({ value: 185, n: 0 });
    expect(detectMaxHR(undefined)).toEqual({ value: 185, n: 0 });
  });
});

describe('detectRestHR', () => {
  it('toma la medición de Garmin más reciente', () => {
    const garmin = [
      { date: '2026-08-10', restingHR: 48 },
      { date: '2026-08-28', restingHR: 44 },
      { date: '2026-08-19', restingHR: 46 },
    ];
    expect(detectRestHR(garmin)).toEqual({ value: 44, source: 'garmin' });
  });

  it('salta los días sin dato en vez de devolver undefined', () => {
    const garmin = [
      { date: '2026-08-28', restingHR: null },
      { date: '2026-08-27' },
      { date: '2026-08-26', restingHR: 45 },
    ];
    expect(detectRestHR(garmin)).toEqual({ value: 45, source: 'garmin' });
  });

  it('cae al valor por defecto — NO estima desde la FC de actividad', () => {
    // Es la política escrita en la cabecera del módulo: mejor un defecto honesto
    // que una precisión falsa derivada de la FC en ejercicio.
    for (const vacio of [[], null, undefined]) {
      expect(detectRestHR(vacio)).toEqual({ value: DEFAULT_REST_HR, source: 'default' });
    }
  });
});

describe('estimateLTHR', () => {
  it('es la fórmula de Friel: 87.5 % de la FCmax', () => {
    expect(LTHR_FROM_HRMAX).toBe(0.875);
    expect(estimateLTHR(200)).toBe(175);
    expect(estimateLTHR(190)).toBe(166); // 166.25 → redondeo
  });
});

describe('thresholdBlocks', () => {
  const MAX = 200; // banda de umbral: 168–193 ppm

  it('agrupa kilómetros consecutivos en banda que sumen ≥8 min', () => {
    const blocks = thresholdBlocks([split(175), split(175)], MAX); // 480 s justos
    expect(blocks).toEqual([{ hr: 175, sec: 480 }]);
  });

  it('descarta los bloques que no llegan a 8 min', () => {
    expect(thresholdBlocks([split(175, 200), split(175, 200)], MAX)).toEqual([]);
  });

  it('un kilómetro fuera de banda parte el bloque en dos', () => {
    const splits = [split(175), split(175), split(150), split(180), split(180)];
    const blocks = thresholdBlocks(splits, MAX);
    expect(blocks.map(b => b.hr)).toEqual([175, 180]);
  });

  it('la FC del bloque es la media ponderada por tiempo', () => {
    // 600 s a 170 + 300 s a 188 → (170·600 + 188·300)/900 = 176
    const blocks = thresholdBlocks([split(170, 600), split(188, 300)], MAX);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hr).toBeCloseTo(176, 6);
    expect(blocks[0].sec).toBe(900);
  });

  it('devuelve [] sin splits o sin FCmax', () => {
    expect(thresholdBlocks(undefined, MAX)).toEqual([]);
    expect(thresholdBlocks([split(175)], null)).toEqual([]);
  });
});

describe('detectLTHR', () => {
  const MAX = 200;

  it('sin datos no inventa nada', () => {
    expect(detectLTHR([], MAX)).toEqual({ lthr: null, confidence: 0, method: 'none', n: 0 });
    expect(detectLTHR([run()], null)).toEqual({ lthr: null, confidence: 0, method: 'none', n: 0 });
  });

  it('escalón -1 (cs): la FC medida a ritmo de velocidad crítica gana a los splits', () => {
    // Aunque haya bloques umbral suficientes para el escalón `segment`, el ancla
    // por rendimiento manda: es la misma cifra que muestra Motor Aeróbico.
    const conSplits = (hr) => run({ splits_metric: [split(hr), split(hr)] });
    const acts = [conSplits(172), conSplits(176), conSplits(180)];
    const res = detectLTHR(acts, MAX, { csLt2: { valid: true, lt2Hr: 168, n: 9 } });
    expect(res.method).toBe('cs');
    expect(res.lthr).toBe(168);
    expect(res.n).toBe(9);
    expect(res.confidence).toBeGreaterThan(detectLTHR(acts, MAX).confidence);
  });

  it('escalón -1: se ignora un ancla de CS ausente, inválida o implausible', () => {
    const conSplits = (hr) => run({ splits_metric: [split(hr), split(hr)] });
    const acts = [conSplits(172), conSplits(176), conSplits(180)];
    const seg = detectLTHR(acts, MAX).lthr;
    // sin ajuste de CS válido
    expect(detectLTHR(acts, MAX, { csLt2: { valid: false, n: 1 } }).lthr).toBe(seg);
    // 120 ppm sobre FCmax 200 = 60 % → fuera de la banda fisiológica
    expect(detectLTHR(acts, MAX, { csLt2: { valid: true, lt2Hr: 120, n: 5 } }).method).toBe('segment');
    // 199 ppm = 99,5 % FCmax → tampoco
    expect(detectLTHR(acts, MAX, { csLt2: { valid: true, lt2Hr: 199, n: 5 } }).method).toBe('segment');
  });

  it('escalón 0 (segment): mediana de los bloques leídos de los splits', () => {
    const conSplits = (hr) => run({ splits_metric: [split(hr), split(hr)] });
    const res = detectLTHR([conSplits(172), conSplits(176), conSplits(180)], MAX);
    expect(res.method).toBe('segment');
    expect(res.lthr).toBe(176);
    expect(res.n).toBe(3);
  });

  it('escalón 1 (field): esfuerzos sostenidos de 18–70 min', () => {
    // Sin splits no hay bloques → cae a field. avg/max ≥ 0.92 y 82–97 % FCmax.
    const duro = (hr) => run({ average_heartrate: hr, max_heartrate: Math.round(hr / 0.95), moving_time: 2400 });
    const res = detectLTHR([duro(170), duro(174), duro(178)], MAX);
    expect(res.method).toBe('field');
    expect(res.lthr).toBe(174);
  });

  it('escalón 1: descarta el rodaje largo con un pico suelto', () => {
    // Un rodaje de 2 h a 140 ppm no es un esfuerzo de umbral aunque toque 190
    const rodaje = run({ average_heartrate: 140, max_heartrate: 190, moving_time: 7200 });
    const res = detectLTHR([rodaje, rodaje, rodaje], MAX);
    expect(res.method).not.toBe('field');
  });

  it('escalón 2 (race): p75 de las competiciones × 0.97', () => {
    const carrera = (hr) => ({ average_heartrate: hr, workout_type: 1 });
    const res = detectLTHR([carrera(180), carrera(184), carrera(188), carrera(186)], MAX);
    expect(res.method).toBe('race');
    // ordenadas [180,184,186,188] → p75 = índice 3 = 188 → 188 × 0.97 = 182.36
    expect(res.lthr).toBe(182);
    expect(res.confidence).toBe(45);
  });

  it('escalón 3 (formula): 87.5 % de la FCmax con confianza baja', () => {
    const suave = run({ average_heartrate: 120, max_heartrate: 140, moving_time: 3600 });
    const res = detectLTHR([suave], MAX);
    expect(res).toEqual({ lthr: estimateLTHR(MAX), confidence: 25, method: 'formula', n: 0 });
  });

  it('la confianza baja según se degrada la cascada', () => {
    const conSplits = (hr) => run({ splits_metric: [split(hr), split(hr)] });
    const duro = (hr) => run({ average_heartrate: hr, max_heartrate: Math.round(hr / 0.95) });
    const seg = detectLTHR([conSplits(174), conSplits(176), conSplits(178)], MAX).confidence;
    const fld = detectLTHR([duro(174), duro(176), duro(178)], MAX).confidence;
    const frm = detectLTHR([run({ average_heartrate: 120, max_heartrate: 140 })], MAX).confidence;
    expect(seg).toBeGreaterThan(fld);
    expect(fld).toBeGreaterThan(frm);
  });
});

describe('límites de zona', () => {
  it('seilerBounds parte en 92.5 % del LTHR y en el propio LTHR', () => {
    expect(seilerBounds({ lthr: 170 })).toEqual([
      { lo: 0,   hi: 156 },
      { lo: 157, hi: 169 },
      { lo: 170, hi: 999 },
    ]);
  });

  it('karvonenBounds usa escalones del 10 % de la reserva', () => {
    // hrmax 190, hrrest 50 → HRR 140 → 134 / 148 / 162 / 176
    expect(karvonenBounds({ hrmax: 190, hrrest: 50 })).toEqual([
      { lo: 0,   hi: 133 },
      { lo: 134, hi: 147 },
      { lo: 148, hi: 161 },
      { lo: 162, hi: 175 },
      { lo: 176, hi: 999 },
    ]);
  });

  it('los rangos no se solapan ni dejan huecos', () => {
    for (const bounds of [seilerBounds({ lthr: 170 }), karvonenBounds({ hrmax: 190, hrrest: 50 })]) {
      for (let i = 1; i < bounds.length; i++) {
        expect(bounds[i].lo).toBe(bounds[i - 1].hi + 1);
      }
      expect(bounds[bounds.length - 1].hi).toBe(999);
    }
  });
});

describe('classifyHR', () => {
  const bounds = karvonenBounds({ hrmax: 190, hrrest: 50 });

  it('devuelve el índice de zona (0 = la más baja)', () => {
    expect(classifyHR(100, bounds)).toBe(0);
    expect(classifyHR(134, bounds)).toBe(1);
    expect(classifyHR(150, bounds)).toBe(2);
    expect(classifyHR(175, bounds)).toBe(3);
    expect(classifyHR(190, bounds)).toBe(4);
  });

  it('cada frontera cae en la zona superior, sin ambigüedad', () => {
    bounds.forEach((b, i) => {
      if (b.lo > 0) expect(classifyHR(b.lo, bounds)).toBe(i);
      if (b.hi < 999) expect(classifyHR(b.hi, bounds)).toBe(i);
    });
  });

  it('devuelve -1 cuando no hay FC que clasificar', () => {
    expect(classifyHR(null, bounds)).toBe(-1);
    expect(classifyHR(0, bounds)).toBe(-1);
    expect(classifyHR(150, [])).toBe(-1);
  });
});
