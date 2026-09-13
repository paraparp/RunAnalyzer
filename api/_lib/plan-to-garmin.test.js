// Tests del conversor plan IA → spec de Garmin. Lo que se fija aquí es la
// traducción que nadie más verifica: fases en texto libre → stepType, ritmos y FC
// en texto → objetivos numéricos, y el significado de `reps` + `recovery` (un
// grupo de repeticiones cuyo trabajo dura `duration_min` POR repetición).
import { describe, it, expect } from 'vitest';
import {
  phaseKind, isRestDay, parsePaceRange, parseHrRange,
  parseRecoveryDuration, planStepToSpec, planDayToWorkoutSpec,
} from './plan-to-garmin.js';

describe('phaseKind', () => {
  it('mapea las fases del plan a los tipos de step de Garmin', () => {
    expect(phaseKind('Calentamiento')).toBe('warmup');
    expect(phaseKind('Vuelta a la calma')).toBe('cooldown');
    expect(phaseKind('Recuperación')).toBe('recovery');
    expect(phaseKind('Descanso')).toBe('rest');
    expect(phaseKind('Bloque Principal')).toBe('interval');
  });
});

describe('isRestDay', () => {
  it('salta los días de descanso y los que no traen estructura', () => {
    expect(isRestDay({ type: 'Descanso', structured_workout: [] })).toBe(true);
    expect(isRestDay({ type: 'Rodaje', structured_workout: null })).toBe(true);
    expect(isRestDay({ type: 'Rodaje', structured_workout: [{ phase: 'Rodaje', duration_min: 40 }] })).toBe(false);
  });
});

describe('parsePaceRange', () => {
  it('abre un ritmo único a una ventana de ±5 s/km', () => {
    expect(parsePaceRange('4:05/km')).toEqual({ low: 4, high: 4.17 });
  });
  it('respeta el rango cuando el plan ya da dos ritmos, rápido primero', () => {
    expect(parsePaceRange('4:40-4:30 min/km')).toEqual({ low: 4.5, high: 4.67 });
  });
  it('devuelve null si no hay ritmo reconocible', () => {
    expect(parsePaceRange('suave')).toBeNull();
    expect(parsePaceRange(undefined)).toBeNull();
  });
});

describe('parseHrRange', () => {
  it('lee el rango de ppm del plan', () => {
    expect(parseHrRange('168-178 ppm')).toEqual({ low: 168, high: 178 });
  });
  it('abre una FC única a ±5 ppm y descarta valores no fisiológicos', () => {
    expect(parseHrRange('155')).toEqual({ low: 150, high: 160 });
    expect(parseHrRange('12')).toBeNull();
  });
  it('no confunde un porcentaje de FCmax con ppm', () => {
    // 70-85 cae dentro del rango fisiológico, así que sin mirar el '%' esto llegaba
    // al reloj como un objetivo de 70-85 ppm.
    expect(parseHrRange('70-85% FCmax')).toBeNull();
    expect(parseHrRange('80 % de la FC máxima')).toBeNull();
    // Pero si el plan da las ppm Y el porcentaje, las ppm son válidas.
    expect(parseHrRange('150-160 ppm (80% FCmax)')).toEqual({ low: 150, high: 160 });
  });
});

describe('parseRecoveryDuration', () => {
  it('entiende segundos, minutos y distancia', () => {
    expect(parseRecoveryDuration('90" trote')).toEqual({ type: 'time', value: 90, unit: 's' });
    expect(parseRecoveryDuration("2' suave")).toEqual({ type: 'time', value: 2, unit: 'min' });
    expect(parseRecoveryDuration("1'30 trote")).toEqual({ type: 'time', value: 90, unit: 's' });
    expect(parseRecoveryDuration('2 min trote')).toEqual({ type: 'time', value: 2, unit: 'min' });
    expect(parseRecoveryDuration('400 m')).toEqual({ type: 'distance', value: 400, unit: 'm' });
    expect(parseRecoveryDuration('1 km')).toEqual({ type: 'distance', value: 1, unit: 'km' });
    expect(parseRecoveryDuration('90')).toEqual({ type: 'time', value: 90, unit: 's' });
  });
  it('entiende las formas largas de minuto y la notación M:SS', () => {
    // Un null aquí deja el grupo de series SIN descanso, así que las formas que el
    // plan escribe de verdad tienen que entrar todas.
    expect(parseRecoveryDuration('2 minutos')).toEqual({ type: 'time', value: 2, unit: 'min' });
    expect(parseRecoveryDuration('3 mins trote')).toEqual({ type: 'time', value: 3, unit: 'min' });
    expect(parseRecoveryDuration('1:30')).toEqual({ type: 'time', value: 90, unit: 's' });
    expect(parseRecoveryDuration('2:00 caminando')).toEqual({ type: 'time', value: 120, unit: 's' });
  });
  it('no inventa una recuperación que no reconoce', () => {
    expect(parseRecoveryDuration('trote suave')).toBeNull();
    expect(parseRecoveryDuration('')).toBeNull();
  });
});

describe('planStepToSpec', () => {
  it('convierte un bloque continuo con ritmo objetivo', () => {
    expect(planStepToSpec({ phase: 'Calentamiento', duration_min: 15, pace: '5:40/km' })).toEqual({
      kind: 'warmup',
      duration: { type: 'time', value: 15, unit: 'min' },
      target: { type: 'pace', low: 5.58, high: 5.75 },
    });
  });

  it('usa la FC como objetivo cuando no hay ritmo, y la pasa a descripción cuando sí lo hay', () => {
    const soloFc = planStepToSpec({ phase: 'Rodaje', duration_min: 40, hr: '140-150' });
    expect(soloFc.target).toEqual({ type: 'heart.rate', low: 140, high: 150 });

    const ambos = planStepToSpec({ phase: 'Tempo', duration_min: 20, pace: '4:30/km', hr: '160-168', description: 'umbral' });
    expect(ambos.target.type).toBe('pace');
    expect(ambos.description).toBe('umbral - FC 160-168');
  });

  it('expande reps a un grupo de repeticiones con su step de recuperación', () => {
    const spec = planStepToSpec({ phase: 'Series', duration_min: 3, reps: 5, pace: '4:05/km', recovery: '90" trote' });
    expect(spec.kind).toBe('repeat');
    expect(spec.repeats).toBe(5);
    // duration_min es la duración de UNA repetición, no la del bloque.
    expect(spec.steps[0]).toMatchObject({ kind: 'interval', duration: { type: 'time', value: 3, unit: 'min' } });
    expect(spec.steps[1]).toMatchObject({ kind: 'recovery', duration: { type: 'time', value: 90, unit: 's' } });
  });

  it('sin recuperación reconocible deja el grupo solo con el trabajo', () => {
    const spec = planStepToSpec({ phase: 'Series', duration_min: 3, reps: 4, recovery: 'lo que necesites' });
    expect(spec.steps).toHaveLength(1);
  });

  it('sin duración usable acaba el step con la tecla de vuelta', () => {
    expect(planStepToSpec({ phase: 'Rodaje' }).duration).toEqual({ type: 'lap.button' });
  });

  it('reps <= 1 no crea grupo de repeticiones', () => {
    expect(planStepToSpec({ phase: 'Tempo', duration_min: 20, reps: 1 }).kind).toBe('interval');
  });

  it('duración fraccionaria se manda en segundos (Garmin no admite minutos decimales)', () => {
    expect(planStepToSpec({ phase: 'Series', duration_min: 1.5 }).duration).toEqual({ type: 'time', value: 90, unit: 's' });
  });
});

describe('planDayToWorkoutSpec', () => {
  const day = {
    day: 'Miércoles',
    type: 'Series',
    summary: 'Bloque de VO2max',
    structured_workout: [
      { phase: 'Calentamiento', duration_min: 15, pace: '5:40/km' },
      { phase: 'Series', duration_min: 3, reps: 5, pace: '4:05/km', recovery: '90" trote' },
      { phase: 'Vuelta a la calma', duration_min: 10 },
    ],
  };

  it('nombra, describe y agenda la sesión', () => {
    const spec = planDayToWorkoutSpec(day, { date: '2026-09-09' });
    expect(spec.name).toBe('Series - Miércoles');
    expect(spec.description).toBe('Series - Bloque de VO2max');
    expect(spec.date).toBe('2026-09-09');
    expect(spec.steps.map((s) => s.kind)).toEqual(['warmup', 'repeat', 'cooldown']);
  });

  it('sin fecha no incluye `date` (se crea sin agendar)', () => {
    expect(planDayToWorkoutSpec(day)).not.toHaveProperty('date');
  });

  it('un día sin estructura falla con un mensaje accionable', () => {
    expect(() => planDayToWorkoutSpec({ day: 'Lunes', type: 'Rodaje' }))
      .toThrow(/no tiene estructura/);
  });
});
