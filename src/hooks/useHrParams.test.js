// @vitest-environment jsdom
//
// Tests de useHrParams: la CAPA DE UI de la calibración de FC — el estado de los
// overrides manuales, su persistencia y el evento con el que el resto de vistas se
// entera del cambio. La RESOLUCIÓN (FCmax / FC reposo / LTHR) no se prueba aquí:
// vive en lib/loadCalibration y tiene sus propios tests; aquí solo se comprueba que
// el hook la alimenta con lo que el atleta escribe y que no la contamina cuando lo
// que escribe no vale.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// cloudStorage: mismo módulo para el hook y para lib/hrOverrides, así que un único
// doble cubre la lectura inicial y la escritura del efecto.
const cs = vi.hoisted(() => {
  const map = new Map();
  return {
    map,
    getItem: vi.fn((k) => (map.has(k) ? map.get(k) : null)),
    setItem: vi.fn((k, v) => { map.set(k, String(v)); }),
    removeItem: vi.fn((k) => { map.delete(k); }),
  };
});
vi.mock('../lib/cloudStorage', () => {
  const api = { getItem: cs.getItem, setItem: cs.setItem, removeItem: cs.removeItem };
  return { default: api, cloudStorage: api };
});

// La lectura de Garmin es otro hook con su propio efecto; aquí solo interesa el
// dato que entra en la resolución.
const wearable = vi.hoisted(() => ({ garmin: null }));
vi.mock('./useGarminWearableData', () => {
  const useGarminWearableData = () => ({ garmin: wearable.garmin, sleep: null });
  return { default: useGarminWearableData, useGarminWearableData };
});

const { default: useHrParams, OVERRIDES_KEY, loadOverrides, parseOverride } =
  await import('./useHrParams');
const { OVERRIDES_EVENT } = await import('../lib/hrOverrides');

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// Historial mínimo con el que la autodetección da una FCmax estable de 190.
const ACTIVITIES = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  type: 'Run',
  start_date: daysAgo(i * 7 + 1),
  distance: 10000,
  moving_time: 3000,
  average_heartrate: 150,
  max_heartrate: 190,
}));

const stored = () => JSON.parse(cs.map.get(OVERRIDES_KEY) ?? 'null');

let events;
const onOverrides = () => { events++; };

beforeEach(() => {
  cs.map.clear();
  cs.getItem.mockClear(); cs.setItem.mockClear(); cs.removeItem.mockClear();
  wearable.garmin = null;
  events = 0;
  window.addEventListener(OVERRIDES_EVENT, onOverrides);
});

afterEach(() => {
  window.removeEventListener(OVERRIDES_EVENT, onOverrides);
  cleanup();
});

describe('useHrParams — estado inicial', () => {
  it('sin overrides guardados arranca vacío y usa la autodetección', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    expect(result.current.userMax).toBe('');
    expect(result.current.userRest).toBe('');
    expect(result.current.userLTHR).toBe('');
    expect(result.current.hrmax).toBe(190);
    expect(result.current.calibration.sources.hrmax).toBe('detected');
  });

  it('siembra los tres campos con lo que hubiera guardado y estos mandan', () => {
    cs.map.set(OVERRIDES_KEY, JSON.stringify({ max: '198', rest: '44', lthr: '172' }));
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    expect(result.current.userMax).toBe('198');
    expect(result.current.userRest).toBe('44');
    expect(result.current.userLTHR).toBe('172');
    expect(result.current.hrmax).toBe(198);
    expect(result.current.hrrest).toBe(44);
    expect(result.current.lthr).toBe(172);
    expect(result.current.calibration.sources).toEqual({
      hrmax: 'manual', hrrest: 'manual', lthr: 'manual',
    });
  });

  it('un JSON roto en la clave no rompe el montaje: arranca vacío', () => {
    cs.map.set(OVERRIDES_KEY, '{no es json');
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    expect(result.current.userMax).toBe('');
    expect(result.current.hrmax).toBe(190);
  });
});

describe('useHrParams — persistencia', () => {
  it('guarda solo las claves con valor, no las vacías', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    act(() => result.current.setUserMax('195'));
    expect(stored()).toEqual({ max: '195' });

    act(() => result.current.setUserLTHR('168'));
    expect(stored()).toEqual({ max: '195', lthr: '168' });
  });

  it('borrar el último override borra la clave en vez de dejar un objeto vacío', () => {
    cs.map.set(OVERRIDES_KEY, JSON.stringify({ max: '195' }));
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    act(() => result.current.setUserMax(''));
    expect(cs.removeItem).toHaveBeenCalledWith(OVERRIDES_KEY);
    expect(cs.map.has(OVERRIDES_KEY)).toBe(false);
  });

  it('lo guardado sobrevive a un montaje nuevo', () => {
    const first = renderHook(() => useHrParams(ACTIVITIES));
    act(() => first.result.current.setUserRest('42'));
    first.unmount();

    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    expect(result.current.userRest).toBe('42');
    expect(result.current.hrrest).toBe(42);
  });

  it('un valor inválido también se persiste, para no borrar lo que el atleta escribe a medias', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    act(() => result.current.setUserMax('9'));
    expect(stored()).toEqual({ max: '9' });
    expect(result.current.invalidMax).toBe(true);
  });
});

describe('useHrParams — el aviso que despierta al PMC', () => {
  // Sin este evento, ajustar el LTHR a mano no movía el CTL de las otras vistas
  // hasta recargar la página.
  it('avisa al montar, al fijar un override y al borrarlo', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    expect(events).toBe(1);

    act(() => result.current.setUserLTHR('170'));
    expect(events).toBe(2);

    act(() => result.current.setUserLTHR(''));
    expect(events).toBe(3);
  });

  it('no reemite si el valor no cambia', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    act(() => result.current.setUserMax('195'));
    const after = events;
    act(() => result.current.setUserMax('195'));
    expect(events).toBe(after);
  });
});

describe('useHrParams — validación de los overrides', () => {
  it('un valor fuera de rango se marca inválido y NO contamina el número resuelto', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    act(() => result.current.setUserMax('300'));
    expect(result.current.invalidMax).toBe(true);
    expect(result.current.hrmax).toBe(190);              // sigue el autodetectado
    expect(result.current.calibration.sources.hrmax).toBe('detected');
  });

  it('el campo vacío no es un valor inválido', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    expect(result.current.invalidMax).toBe(false);
    expect(result.current.invalidRest).toBe(false);
    expect(result.current.invalidLTHR).toBe(false);
  });

  it('la FC de reposo se acota contra la FCmax vigente (reserva mínima de 20)', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    act(() => result.current.setUserRest('185'));        // > hrmax - 20
    expect(result.current.invalidRest).toBe(true);
    expect(result.current.hrrest).toBe(60);              // el default, no el 185
  });

  it('el LTHR se valida contra la banda [FCreposo+10, FCmax]', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    act(() => result.current.setUserLTHR('250'));
    expect(result.current.invalidLTHR).toBe(true);
    act(() => result.current.setUserLTHR('175'));
    expect(result.current.invalidLTHR).toBe(false);
    expect(result.current.lthr).toBe(175);
  });

  it('un decimal se redondea en vez de rechazarse', () => {
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    act(() => result.current.setUserMax('194.6'));
    expect(result.current.invalidMax).toBe(false);
    expect(result.current.hrmax).toBe(195);
  });
});

describe('useHrParams — datos del reloj', () => {
  it('la FC de reposo medida por Garmin llega al resultado', () => {
    wearable.garmin = [
      { date: '2026-08-01', restingHR: 50 },
      { date: '2026-09-01', restingHR: 47 },
    ];
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    expect(result.current.hrrest).toBe(47);              // la más reciente
    expect(result.current.calibration.sources.hrrest).toBe('garmin');
  });

  it('el override manual manda sobre la medida de Garmin', () => {
    wearable.garmin = [{ date: '2026-09-01', restingHR: 47 }];
    const { result } = renderHook(() => useHrParams(ACTIVITIES));
    act(() => result.current.setUserRest('52'));
    expect(result.current.hrrest).toBe(52);
    expect(result.current.calibration.sources.hrrest).toBe('manual');
  });

  it('sin historial devuelve la calibración por defecto en vez de romper', () => {
    const { result } = renderHook(() => useHrParams([]));
    expect(result.current.hrmax).toBe(185);
    expect(result.current.hrrest).toBe(60);
    expect(Number.isFinite(result.current.lthr)).toBe(true);
  });
});

describe('useHrParams — superficie reexportada', () => {
  // El hook los reexporta para no romper a quien ya los importaba de aquí.
  it('sigue exponiendo OVERRIDES_KEY, loadOverrides y parseOverride', () => {
    expect(OVERRIDES_KEY).toBe('hr_zone_overrides');
    cs.map.set(OVERRIDES_KEY, JSON.stringify({ max: '198' }));
    expect(loadOverrides()).toEqual({ max: '198' });
    expect(parseOverride('190', 120, 230)).toBe(190);
    expect(parseOverride('', 120, 230)).toBe(null);
    expect(Number.isNaN(parseOverride('300', 120, 230))).toBe(true);
  });
});
