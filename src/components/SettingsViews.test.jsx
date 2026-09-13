import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Las claves, no las traducciones: inicializar i18n arrastra localStorage y el
// idioma del dispositivo, y lo que se está comprobando aquí son los números y la
// estructura, no la copia.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts?.count != null ? `${key}:${opts.count}` : key),
    i18n: { language: 'es' },
  }),
}));

const { default: HrCalibration } = await import('./HrCalibration');
const { default: Connections } = await import('./Connections');

// Humo de las dos vistas que la fase 2 sacó de las pantallas de análisis
// (calibración de FC y conexiones). No comprueban diseño: comprueban que cada
// una se monta con lo que recibe y que enseña lo que la hace útil, que es lo que
// se rompe al mover bloques de un fichero a otro.

const hrParams = {
  hrmax: 190, hrrest: 48, lthr: 170, hrr: 142,
  autoMax: { value: 190, source: 'activities' },
  autoRest: { value: 48, source: 'garmin' },
  lthrResult: { lthr: 170, confidence: 72, method: 'cs', n: 6 },
  recentActivities: [{ average_heartrate: 150 }, { average_heartrate: null }],
  userMax: '', setUserMax: vi.fn(),
  userRest: '', setUserRest: vi.fn(),
  userLTHR: '', setUserLTHR: vi.fn(),
  maxOv: false, restOv: false, lthrOv: false,
  invalidMax: false, invalidRest: false, invalidLTHR: false,
};

describe('HrCalibration', () => {
  it('pinta los tres números resueltos y sus derivados', () => {
    const html = renderToStaticMarkup(<HrCalibration hrParams={hrParams} />);
    expect(html).toContain('190');   // FCmax
    expect(html).toContain('48');    // FC reposo
    expect(html).toContain('170');   // LTHR
    expect(html).toContain('142');   // HRR = 190 − 48
    expect(html).toContain('89.5');  // LTHR / FCmax
  });

  it('distingue el valor manual del detectado', () => {
    const html = renderToStaticMarkup(
      <HrCalibration hrParams={{ ...hrParams, maxOv: true, userMax: '195', hrmax: 195 }} />,
    );
    expect(html).toContain('195');
    // La FC de reposo sigue viniendo de Garmin aunque la FCmax sea manual.
    expect(html).toContain('Garmin');
  });

  it('un valor fuera de rango se marca sin contaminar el resuelto', () => {
    const html = renderToStaticMarkup(
      <HrCalibration hrParams={{ ...hrParams, invalidMax: true, userMax: '400' }} />,
    );
    expect(html).toContain('190');          // el resuelto no cambia
    expect(html).toMatch(/text-rose-500/);  // pero el campo avisa
  });
});

describe('Connections', () => {
  it('sin Strava ofrece conectar', () => {
    const html = renderToStaticMarkup(<Connections stravaData={null} onConnectStrava={vi.fn()} />);
    expect(html).toContain('Conectar con Strava');
    expect(html).not.toContain('Último listado');
  });

  it('con Strava muestra lo guardado', () => {
    const html = renderToStaticMarkup(
      <Connections
        stravaData={{ accessToken: 'x', activities: [{ id: 1 }, { id: 2 }], lastFetchDate: 'Sat Sep 13 2026' }}
        onConnectStrava={vi.fn()}
      />,
    );
    expect(html).toContain('Sat Sep 13 2026');
    expect(html).not.toContain('Conectar con Strava');
  });

  it('sin datos de Garmin ofrece el formulario de vinculación', () => {
    const html = renderToStaticMarkup(<Connections stravaData={null} onConnectStrava={vi.fn()} />);
    expect(html).toContain('Email de Garmin Connect');
    expect(html).toContain('Conectar con Garmin y descargar datos');
    // El sync y el borrado solo existen cuando ya hay algo que sincronizar.
    expect(html).not.toContain('Desconectar');
  });
});
