import { describe, it, expect } from 'vitest';
import { computeHrEffort } from './hrEffortWindow';
import { hrAtFixedEffort, sessionWindow } from './aerobicForm';

// Prueba de CADENA: streams sintéticos → perfil por bloques → modelo por periodos.
//
// Los tests de cada módulo comprueban su pieza con datos limpios. Este comprueba lo
// único que importa de verdad: que con streams que se PARECEN a los de Strava —ruido
// de GPS de ±25 % muestra a muestra, terreno ondulado, semáforos, calentamiento,
// deriva cardiaca y resolución variable— el sistema recupere una mejora conocida en
// vez de quedarse sin sesiones.
//
// Existe porque ya falló una vez en producción por justo eso: con datos limpios todo
// pasaba y con datos reales 27 de 30 sesiones salían 'sin-bloques-estables'. Los
// umbrales (pico, estabilidad, tamaño de bloque) están calibrados contra ESTE
// escenario; si alguien los mueve, aquí se ve.

// Generador determinista: nada de Math.random, para que un fallo sea reproducible.
const lcg = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const JITTER = 0.5;   // ±25 % de ruido en la velocidad instantánea (GPS + zancada)
const SLOPE = 20;     // ppm por m/s de GAP, la verdad que el modelo debe recuperar
const REF = 3.3;

/**
 * Rodaje realista. `step` es el muestreo en segundos: Strava no siempre devuelve
 * 1 Hz, y el cálculo tiene que dar lo mismo con muestras cada 5 s.
 */
const makeRun = ({ secs, base, hrBase, step = 1, seed = 1 }) => {
  const rnd = lcg(seed);
  const time = [], distance = [], altitude = [], grade_smooth = [], heartrate = [], watts = [];
  const stops = [[900, 940], [2200, 2230]];            // dos semáforos
  let d = 0, alt = 100;
  for (let t = 0; t <= secs; t += step) {
    const stopped = stops.some(([a, b]) => t >= a && t < b);
    const warm = t < 600 ? 0.93 + 0.07 * (t / 600) : 1; // arranca un 7 % más lento
    const grade = 0.03 * Math.sin(t / 220);             // terreno ondulado
    const v = stopped ? 0 : base * warm * (1 + (rnd() - 0.5) * JITTER);
    const gap = v * (1 + grade * 2);
    // FC: responde al GAP ABSOLUTO (no al ritmo de ese día), con la FC todavía
    // subiendo en el calentamiento y +3 ppm de deriva al final.
    const hr = stopped ? 120
      : hrBase + SLOPE * (gap - REF) - 12 * Math.max(0, 1 - t / 600)
        + 3 * (t / secs) + (rnd() - 0.5) * 3;
    time.push(t); distance.push(d); altitude.push(alt);
    grade_smooth.push(grade * 100);
    heartrate.push(Math.round(hr));
    watts.push(Math.round(300 * (gap / REF)));
    d += v * step; alt += v * step * grade;
  }
  return {
    time: { data: time }, distance: { data: distance }, altitude: { data: altitude },
    grade_smooth: { data: grade_smooth }, heartrate: { data: heartrate }, watts: { data: watts },
  };
};

const activity = (id, date, streams, extra = {}) => ({
  id,
  name: `rodaje ${id}`,
  start_date: `${date}T07:00:00Z`,
  start_date_local: `${date}T09:00:00`,
  _hr: { hr_source: 'strap' },
  _wbgt: 18,
  hr_effort: computeHrEffort(streams),
  ...extra,
});

// Cuatro meses, cinco rodajes cada uno, mejorando de 150 a 142 ppm de base. Cada día
// se corre a un ritmo distinto y la mitad de las sesiones vienen submuestreadas.
const MONTHS = [['03', 150], ['05', 149], ['07', 146], ['09', 142]];
const TRUE_CHANGE = 142 - 150;

const cohort = MONTHS.flatMap(([m, hrBase]) => (
  [0, 1, 2, 3, 4].map((i) => activity(
    `${m}-${i}`,
    `2026-${m}-0${i + 1}`,
    makeRun({
      secs: 3000 + i * 400,
      base: 3.2 + i * 0.06,
      hrBase,
      step: i % 2 ? 1 : 5,
      seed: Number(m) * 10 + i,
    }),
  ))
));

describe('cadena completa sobre streams realistas', () => {
  it('ninguna sesión se pierde por el ruido de GPS', () => {
    const lost = cohort.filter((a) => a.hr_effort.reason);
    expect(lost.map((a) => `${a.id}:${a.hr_effort.reason}`)).toEqual([]);
  });

  it('la mayoría de los rodajes llega al modelo', () => {
    const r = hrAtFixedEffort(cohort, { axis: 'gap' });
    expect(r.n_sessions).toBeGreaterThanOrEqual(15);   // de 20
    expect(r.excluded.some((e) => e.reason === 'sin-bloques-estables')).toBe(false);
  });

  it('recupera la mejora real y la pendiente, en los dos ejes', () => {
    for (const axis of ['gap', 'power']) {
      const r = hrAtFixedEffort(cohort, { axis });
      expect(r.slope_ok).toBe(true);
      expect(r.change_bpm).toBeGreaterThan(TRUE_CHANGE - 1.5);
      expect(r.change_bpm).toBeLessThan(TRUE_CHANGE + 1.5);
      expect(r.periods.map((p) => p.label)).toEqual(['mar 2026', 'may 2026', 'jul 2026', 'sep 2026']);
      // Monótono: los cuatro periodos bajan, que es la forma de la verdad.
      const hrs = r.periods.map((p) => p.hr_at_ref);
      expect(hrs.every((v, i) => i === 0 || v < hrs[i - 1])).toBe(true);
    }
  });

  it('la pendiente estimada se acerca a la de verdad (eje GAP)', () => {
    const r = hrAtFixedEffort(cohort, { axis: 'gap' });
    expect(r.slope_bpm_per_unit).toBeGreaterThan(SLOPE * 0.7);
    expect(r.slope_bpm_per_unit).toBeLessThan(SLOPE * 1.3);
  });

  it('series y cuestas se quedan fuera, y un rodaje ondulado entra', () => {
    const rnd = lcg(99);
    const build = (secs, at) => {
      const time = [], distance = [], altitude = [], grade_smooth = [], heartrate = [], watts = [];
      let d = 0, alt = 100;
      for (let t = 0; t <= secs; t++) {
        const s = at(t);
        const v = s.speed * (1 + (rnd() - 0.5) * JITTER);
        time.push(t); distance.push(d); altitude.push(alt);
        grade_smooth.push((s.grade || 0) * 100);
        heartrate.push(s.hr); watts.push(Math.round((300 * v) / REF));
        d += v; alt += v * (s.grade || 0);
      }
      return {
        time: { data: time }, distance: { data: distance }, altitude: { data: altitude },
        grade_smooth: { data: grade_smooth }, heartrate: { data: heartrate }, watts: { data: watts },
      };
    };

    // Rodaje ondulado: es el caso BUENO y tiene que entrar. Con el umbral en 6 % se
    // quedaba fuera, que es lo que hacía perder una de cada cuatro sesiones sanas.
    const rolling = sessionWindow(
      { hr_effort: computeHrEffort(build(3600, (t) => ({ speed: 3.3, grade: 0.03 * Math.sin(t / 220), hr: 150 }))) },
      {},
    );
    expect(rolling.ok).toBe(true);
    expect(rolling.effort_cv).toBeLessThan(0.08);

    // Series: el filtro de picos deja la sesión sin ventana utilizable.
    const intervals = sessionWindow(
      { hr_effort: computeHrEffort(build(3600, (t) => {
        const on = t % 600 < 180 && t > 600;
        return { speed: on ? 4.2 : 2.8, hr: on ? 172 : 140 };
      })) },
      {},
    );
    expect(intervals.ok).toBe(false);

    // Cuestas de ±8 %: la FC va con retraso respecto a la pendiente, no vale.
    const hills = sessionWindow(
      { hr_effort: computeHrEffort(build(3600, (t) => {
        const up = t % 600 < 300;
        return { speed: up ? 2.9 : 3.9, grade: up ? 0.08 : -0.08, hr: up ? 168 : 148 };
      })) },
      {},
    );
    expect(hills.ok).toBe(false);
  });

  it('el muestreo cada 5 s da lo mismo que el de 1 Hz', () => {
    const args = { secs: 3600, base: 3.3, hrBase: 150, seed: 5 };
    const fine = sessionWindow({ hr_effort: computeHrEffort(makeRun({ ...args, step: 1 })) }, {});
    const coarse = sessionWindow({ hr_effort: computeHrEffort(makeRun({ ...args, step: 5 })) }, {});
    expect(coarse.ok).toBe(true);
    expect(coarse.effort).toBeCloseTo(fine.effort, 1);
    expect(coarse.hr).toBeCloseTo(fine.hr, 0);
  });
});
