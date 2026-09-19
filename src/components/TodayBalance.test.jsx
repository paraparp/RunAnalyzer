import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Humo de la franja de apertura de Hoy. Mismo motivo que `StatusViews.test.jsx`:
// el lint no ve las etiquetas JSX, así que esto comprueba que el árbol entero se
// monta con datos de verdad. El PMC se mockea (su modelo ya tiene sus tests);
// el reparto por zonas NO, porque es justo lo que esta vista estrena.

vi.mock('../hooks/useCalibratedPMC', () => ({
  default: (activities) => ({
    pmc: activities?.length
      ? {
        current: {
          ctl: 52, atl: 61, tsb: -9, acwr: 1.18, ramp: 3.4,
          peak: 65, pctPeak: 80, ctlTrend7: 2.5, ctlTrend28: 7,
        },
      }
      : null,
  }),
}));

const { default: TodayBalance } = await import('./TodayBalance');

// hrmax 190 / hrrest 50 → cortes de Karvonen en 134 / 148 / 162 / 176 ppm.
const hrParams = { hrmax: 190, hrrest: 50, lthr: 170 };

const split = (hr, sec) => ({ average_heartrate: hr, moving_time: sec });
const run = (daysAgo, splits) => ({
  id: `r${daysAgo}`,
  type: 'Run',
  start_date: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  distance: 10000,
  moving_time: splits.reduce((s, x) => s + x.moving_time, 0),
  average_heartrate: 150,
  splits_metric: splits,
});

// 3 h fáciles (Z2) + 1 h de calidad (Z4) → 75 % fácil, 25 % duro.
const runs = [
  run(2, [split(140, 3600), split(140, 3600)]),
  run(6, [split(140, 3600), split(170, 3600)]),
];

describe('TodayBalance', () => {
  it('pinta el reparto por zonas y la carga con los dos veredictos', () => {
    const html = renderToStaticMarkup(
      <TodayBalance activities={runs} runActivities={runs} hrParams={hrParams} />,
    );
    expect(html).toContain('Distribución de zonas');
    expect(html).toContain('Carga y forma');
    expect(html).toContain('75%');            // volumen fácil (Z1+Z2)
    expect(html).toContain('80% de tu pico'); // CTL contra el techo del atleta
    expect(html).toContain('Cargando');       // fase derivada del TSB (-9)
    expect(html).toContain('1.18');           // ACWR
  });

  it('las cinco zonas de Karvonen y su agrupación polarizada', () => {
    const html = renderToStaticMarkup(
      <TodayBalance activities={runs} runActivities={runs} hrParams={hrParams} />,
    );
    for (const z of ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']) expect(html).toContain(`>${z}<`);
    expect(html).toContain('Fácil');
    expect(html).toContain('Gris');
    expect(html).toContain('Duro');
    // 75 % fácil con 25 % duro y nada en la franja gris: polarizado.
    expect(html).toContain('80/20 cumplido');
  });

  it('sin FC en la ventana enseña el hueco en vez de un 0 % inventado', () => {
    const sinFc = [{ id: 'x', type: 'Run', start_date: new Date().toISOString(), moving_time: 1800, distance: 5000 }];
    const html = renderToStaticMarkup(
      <TodayBalance activities={sinFc} runActivities={sinFc} hrParams={hrParams} />,
    );
    expect(html).toContain('Sin sesiones con frecuencia cardíaca');
    expect(html).toContain('Carga y forma'); // el panel de carga sigue en pie
  });

  it('sin datos no pinta nada en vez de romper la portada', () => {
    expect(renderToStaticMarkup(
      <TodayBalance activities={[]} runActivities={[]} hrParams={hrParams} />,
    )).toBe('');
  });
});
