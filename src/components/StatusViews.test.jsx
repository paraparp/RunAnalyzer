import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Humo de las dos vistas que salieron de `StatusSnapshot` en la fase 3a.
//
// El motivo de que existan: `no-undef` NO mira los nombres de las etiquetas JSX,
// así que un `<Card>` sin importar pasaba el lint Y el build de Vite, y solo
// reventaba al renderizar en el navegador. El lint ya lo cubre con
// `react/jsx-no-undef`; esto cubre lo que el lint no puede ver —que el árbol
// entero se monta con datos de verdad— sin tener que abrir el navegador.
//
// El PMC se mockea a propósito: aquí no se comprueba el modelo de carga (eso es
// de `statusStats.test.js` y `loadCalibration`), sino que las vistas se pintan.

const pmcSeries = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.now() - (59 - i) * 86400000);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date: key, ctl: 40 + i * 0.2, atl: 38 + i * 0.25, tsb: 2, load: 55, activities: [] };
});

vi.mock('../hooks/useCalibratedPMC', () => ({
  default: (activities) => ({
    pmc: activities?.length
      ? {
        series: pmcSeries,
        current: { ctl: 52, atl: 48, tsb: 4, acwr: 1.05, ctlTrend7: 2.5, ctlTrend28: 7 },
      }
      : null,
  }),
}));

const { default: StatusHero } = await import('./StatusHero');
const { default: StatusOverview } = await import('./StatusOverview');

const run = (daysAgo, { km = 10, speed = 3, hr = 145 } = {}) => ({
  id: `r${daysAgo}`,
  type: 'Run',
  start_date: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  distance: km * 1000,
  moving_time: Math.round((km * 1000) / speed),
  average_speed: speed,
  average_heartrate: hr,
  total_elevation_gain: 120,
  suffer_score: 45,
});

const activities = [run(1), run(3, { km: 21 }), run(5, { km: 5, speed: 3.6 }), run(40, { km: 10.1, speed: 3.4 })];

describe('StatusHero', () => {
  it('monta el briefing con los cuatro números', () => {
    const html = renderToStaticMarkup(<StatusHero activities={activities} />);
    expect(html).toContain('Fitness (CTL)');
    expect(html).toContain('Forma (TSB)');
    expect(html).toContain('Volumen semanal');
    expect(html).toContain('Mejor ritmo reciente');
    expect(html).toContain('52.0');   // CTL actual
  });

  it('sin actividades no pinta nada en vez de romper la portada', () => {
    expect(renderToStaticMarkup(<StatusHero activities={[]} />)).toBe('');
  });
});

describe('StatusOverview', () => {
  it('monta la comparativa y el PMC', () => {
    const html = renderToStaticMarkup(<StatusOverview activities={activities} />);
    expect(html).toContain('Estado actual vs mejor histórico');
    expect(html).toContain('Fitness (CTL)');
    expect(html).toContain('Km (última semana)');
    expect(html).toContain('Mejor ritmo 10k');
    expect(html).toContain('Fitness y Fatiga');
  });

  it('el bloque de Garmin solo aparece si hay datos guardados', () => {
    // Sin caché de Garmin en cloudStorage no se pinta: la vista no inventa una
    // sección vacía. Es también lo que hace que la fase 3b pueda fundirlo con
    // `VitalsOverview` sin dejar un hueco.
    const html = renderToStaticMarkup(<StatusOverview activities={activities} />);
    expect(html).not.toContain('Body Battery');
  });

  it('sin datos avisa en vez de quedarse en blanco', () => {
    const html = renderToStaticMarkup(<StatusOverview activities={[]} />);
    expect(html).toContain('No hay datos suficientes');
  });
});
