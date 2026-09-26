import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Humo de la vista de forma aeróbica. El modelo ya tiene sus tests en
// `lib/aerobicForm.test.js`; lo que se comprueba aquí es que el árbol entero se
// monta con datos de verdad —el lint no ve las etiquetas JSX— y que los avisos
// aparecen cuando toca. Se mockean los dos almacenes del navegador (Garmin y
// cloudStorage), que en test no existen.

vi.mock('../lib/garminActivitiesSync', () => ({
  readStoredGarminActivities: () => [],
}));
vi.mock('../lib/cloudStorage', () => ({
  // Sin registro de Garmin emparejado, la fecha declarada de banda es lo único que
  // resuelve el origen de FC: sin ella, TODAS las sesiones saldrían como 'unknown'.
  default: { getItem: (k) => (k === 'hr_strap_since' ? '2020-01-01' : null) },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => (typeof opts === 'string' ? opts : key) }),
}));

const { default: AerobicForm } = await import('./AerobicForm');
const { HR_EFFORT_VERSION } = await import('../lib/hrEffortWindow');

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const session = (days, { effort, hr }) => ({
  id: `a${days}`,
  type: 'Run',
  name: `rodaje ${days}`,
  start_date: daysAgo(days),
  start_date_local: daysAgo(days),
  distance: 12000,
  moving_time: 3600,
  average_heartrate: hr,
  hr_effort: {
    _v: HR_EFFORT_VERSION,
    bins: Array.from({ length: 11 }, (_, i) => ({
      t0: i * 300, s: 300, drop_s: 0, hr, hr_cv: 0.01,
      gap: effort, gap_cv: 0.01, spd: effort, grade_abs: 0.01,
    })),
  },
});

// Dos bloques separados en el tiempo: mismo esfuerzo, 6 ppm menos en el reciente.
const activities = [
  ...[3.2, 3.3, 3.4].map((v, i) => session(200 + i, { effort: v, hr: 150 + 20 * (v - 3.3) })),
  ...[3.3, 3.4, 3.5].map((v, i) => session(10 + i, { effort: v, hr: 150 + 20 * (v - 3.3) - 6 })),
];

describe('AerobicForm', () => {
  it('monta la vista y publica la caída de FC a esfuerzo fijo', () => {
    const html = renderToStaticMarkup(<AerobicForm activities={activities} />);
    expect(html).toContain('aerobic_form.title');
    expect(html).toContain('-6');                       // el cambio entre extremos
    expect(html).toContain('aerobic_form.improving');
    // Sin WBGT en ninguna sesión, la serie no está corregida por calor y lo dice.
    expect(html).toContain('aerobic_form.warn_heat');
    expect(html).not.toContain('aerobic_form.warn_slope');
  });

  it('sin sesiones utilizables explica qué falta en vez de romperse', () => {
    const html = renderToStaticMarkup(<AerobicForm activities={[]} />);
    expect(html).toContain('aerobic_form.errors.few-sessions');
    expect(html).toContain('aerobic_form.no_data_hint');
  });

  it('con el histórico sin enriquecer, enseña el recuento de pendientes', () => {
    // Es el estado del primer arranque: la vista tiene que decir que faltan streams,
    // no dejar un hueco en blanco.
    const raw = activities.map((a) => { const copy = { ...a }; delete copy.hr_effort; return copy; });
    const html = renderToStaticMarkup(<AerobicForm activities={raw} />);
    expect(html).toContain('aerobic_form.pending');
    expect(html).toContain('aerobic_form.reasons.sin-enriquecer');
  });
});
