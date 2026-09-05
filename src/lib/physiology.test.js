import { describe, it, expect } from 'vitest';
import {
  VO2_REST,
  oxygenCostDaniels, oxygenCostLeger, oxygenCostACSM,
  sustainableFraction, velocityFromVO2,
  vo2maxFromHRR, vo2maxFromHRmaxPct, vo2FromRun,
} from './physiology';

// Las cuatro ecuaciones son deterministas y están publicadas, así que se
// contrastan contra el valor de la fuente, no contra lo que devuelve hoy el
// código. Un cambio de coeficiente rompe el test en vez de propagarse callado a
// VDOT, VO2max y el resumen vital, que son sus tres consumidores.

describe('oxygenCostACSM', () => {
  it('en llano es el término lineal del ACSM: 0.2·v + 3.5', () => {
    // 200 m/min = 12 km/h = 5:00/km → 0.2·200 + 3.5 = 43.5 ml/kg/min
    expect(oxygenCostACSM(200, 0)).toBeCloseTo(43.5, 10);
    expect(oxygenCostACSM(0, 0)).toBeCloseTo(VO2_REST, 10);
  });

  it('la pendiente añade 0.9·v·G', () => {
    // 5 % a 200 m/min → +0.9·200·0.05 = +9
    expect(oxygenCostACSM(200, 0.05)).toBeCloseTo(52.5, 10);
    // La pendiente NETA puede ser negativa (bajada) y entonces descuenta
    expect(oxygenCostACSM(200, -0.05)).toBeCloseTo(34.5, 10);
  });
});

describe('oxygenCostDaniels', () => {
  it('reproduce la cuadrática de Daniels-Gilbert', () => {
    // 200 m/min (5:00/km) → 36.0 ml/kg/min en las tablas de Oxygen Power
    expect(oxygenCostDaniels(200)).toBeCloseTo(36.01, 1);
    // 300 m/min (3:20/km) → ~59.4
    expect(oxygenCostDaniels(300)).toBeCloseTo(59.44, 1);
  });

  it('es monótona creciente en el rango de carrera', () => {
    const vs = [150, 200, 250, 300, 350];
    const costs = vs.map(oxygenCostDaniels);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });
});

describe('velocityFromVO2', () => {
  it('es la inversa exacta de oxygenCostDaniels', () => {
    for (const v of [150, 200, 250, 300, 350]) {
      expect(velocityFromVO2(oxygenCostDaniels(v))).toBeCloseTo(v, 6);
    }
  });

  it('devuelve 0 cuando no hay rama real (VO2 por debajo del mínimo)', () => {
    expect(velocityFromVO2(-1000)).toBe(0);
  });
});

describe('oxygenCostLeger', () => {
  it('incluye el término cúbico de resistencia al viento', () => {
    // A 12 km/h el cúbico aporta menos de 1 ml/kg/min…
    expect(oxygenCostLeger(12)).toBeCloseTo(41.07, 1);
    // …y a 20 km/h ya son >4, que es justo lo que Léger-Mercier añade sobre
    // las ecuaciones de tapiz rodante.
    const cubico = 0.000525542 * 20 ** 3;
    expect(cubico).toBeGreaterThan(4);
    expect(oxygenCostLeger(20)).toBeCloseTo(2.209 + 3.163 * 20 + cubico, 6);
  });
});

describe('sustainableFraction', () => {
  it('supera 1.0 en esfuerzos muy cortos y tiende a 0.8 en los muy largos', () => {
    expect(sustainableFraction(1)).toBeGreaterThan(1);
    expect(sustainableFraction(600)).toBeCloseTo(0.8, 3);
  });

  it('decrece con la duración', () => {
    const ts = [5, 15, 30, 60, 120, 180];
    const fs = ts.map(sustainableFraction);
    expect(fs).toEqual([...fs].sort((a, b) => b - a));
  });

  it('da fracciones plausibles en las distancias de referencia', () => {
    // ~30 min (10K) y ~3 h (maratón) según Daniels
    expect(sustainableFraction(30)).toBeGreaterThan(0.92);
    expect(sustainableFraction(30)).toBeLessThan(1.0);
    expect(sustainableFraction(180)).toBeGreaterThan(0.8);
    expect(sustainableFraction(180)).toBeLessThan(0.86);
  });
});

describe('vo2maxFromHRR', () => {
  const HR_REST = 50, HR_MAX = 190; // HRR = 140

  it('despeja VO2max de %HRR = %VO2R', () => {
    // hr 162 → %HRR = 112/140 = 0.80 → 3.5 + (43.5 − 3.5)/0.8 = 53.5
    expect(vo2maxFromHRR(43.5, 162, HR_REST, HR_MAX)).toBeCloseTo(53.5, 10);
  });

  it('devuelve null fuera de la banda fiable 70–88 % HRR', () => {
    expect(vo2maxFromHRR(43.5, 95, HR_REST, HR_MAX)).toBeNull();   // 32 % HRR
    expect(vo2maxFromHRR(43.5, 140, HR_REST, HR_MAX)).toBeNull();  // 64 % HRR
    expect(vo2maxFromHRR(43.5, 178, HR_REST, HR_MAX)).toBeNull();  // 91 % HRR
    expect(vo2maxFromHRR(43.5, 185, HR_REST, HR_MAX)).toBeNull();  // 96 % HRR
  });

  it('acepta la banda entera y solo esa', () => {
    expect(vo2maxFromHRR(43.5, 148, HR_REST, HR_MAX)).not.toBeNull();   // 70 % justo
    expect(vo2maxFromHRR(43.5, 173, HR_REST, HR_MAX)).not.toBeNull();   // 88 % justo
    expect(vo2maxFromHRR(43.5, 147, HR_REST, HR_MAX)).toBeNull();
    expect(vo2maxFromHRR(43.5, 174, HR_REST, HR_MAX)).toBeNull();
  });

  it('descarta resultados fisiológicamente imposibles dentro de banda', () => {
    // 70 % HRR con un coste de oxígeno absurdo daría 98 ml/kg/min
    expect(vo2maxFromHRR(70, 148, HR_REST, HR_MAX)).toBeNull();
  });

  it('A1: el rodaje suave ya no puede inflar el VO2max', () => {
    // Mismo atleta, mismo día. Antes el rodaje salía ~16 % MÁS ALTO que el tempo
    // y contaba igual; ahora queda fuera de banda y no entra en la media.
    const suave = vo2maxFromHRR(oxygenCostLeger(11.88), 130, HR_REST, HR_MAX);
    const tempo = vo2maxFromHRR(oxygenCostLeger(15.13), 172, HR_REST, HR_MAX);
    expect(suave).toBeNull();
    expect(tempo).not.toBeNull();
  });
});

describe('vo2maxFromHRmaxPct', () => {
  const HR_MAX = 190;

  it('aplica %VO2max = 1.5286 × %FCmax − 0.5286 (Swain 1994)', () => {
    const pct = 1.5286 * (161.5 / HR_MAX) - 0.5286; // 85 % FCmax
    expect(vo2maxFromHRmaxPct(43.5, 161.5, HR_MAX)).toBeCloseTo(43.5 / pct, 6);
  });

  it('devuelve null fuera de 78–92 % FCmax (equivalente a 70–88 % HRR)', () => {
    expect(vo2maxFromHRmaxPct(43.5, 100, HR_MAX)).toBeNull(); // 53 %
    expect(vo2maxFromHRmaxPct(43.5, 145, HR_MAX)).toBeNull(); // 76 %
    expect(vo2maxFromHRmaxPct(43.5, 178, HR_MAX)).toBeNull(); // 94 %
    expect(vo2maxFromHRmaxPct(43.5, 189, HR_MAX)).toBeNull(); // 99 %
  });
});

describe('vo2FromRun', () => {
  const HR_REST = 50, HR_MAX = 190;

  it('usa la vía HRR cuando hay FC en reposo y el esfuerzo está en banda', () => {
    const speedMs = 3.3; // 11.88 km/h
    const esperado = vo2maxFromHRR(oxygenCostLeger(speedMs * 3.6), 150, HR_REST, HR_MAX);
    expect(vo2FromRun(speedMs, 150, HR_REST, HR_MAX)).toBeCloseTo(esperado, 10);
  });

  it('cae a %FCmax cuando la vía HRR queda fuera de banda', () => {
    const speedMs = 4.2;
    const REST_ALTA = 70; // HRR = 120
    // 150 ppm = 67 % HRR (fuera) pero 79 % FCmax (dentro del otro rango)
    expect(vo2maxFromHRR(oxygenCostLeger(speedMs * 3.6), 150, REST_ALTA, HR_MAX)).toBeNull();
    const porHRmax = vo2maxFromHRmaxPct(oxygenCostLeger(speedMs * 3.6), 150, HR_MAX);
    expect(vo2FromRun(speedMs, 150, REST_ALTA, HR_MAX)).toBeCloseTo(porHRmax, 10);
  });

  it('funciona sin FC en reposo', () => {
    expect(vo2FromRun(3.3, 150, null, HR_MAX)).not.toBeNull();
  });

  it('descarta entradas sin sentido', () => {
    expect(vo2FromRun(0, 150, HR_REST, HR_MAX)).toBeNull();
    expect(vo2FromRun(3.3, 80, HR_REST, HR_MAX)).toBeNull();   // FC por debajo de 90
    expect(vo2FromRun(3.3, null, HR_REST, HR_MAX)).toBeNull();
  });
});
