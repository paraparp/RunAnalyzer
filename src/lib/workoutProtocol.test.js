import { describe, it, expect } from 'vitest';
import { workoutCategory, stepKind, parseRecoveryMin, expandSteps, lintWorkout } from './workoutProtocol';

// La sesión sub-umbral del plan de Donostia, registrada según el protocolo.
const subUmbral = {
  category: 'quality',
  type: '4 × 6′ a 4:24',
  summary: 'Sub-umbral · pausas cortas',
  distance_km: 12,
  key_rule: 'Techo 177: si acabas una serie por encima, +4 s/km la próxima.',
  structured_workout: [
    { phase: 'Calentamiento', kind: 'warmup', duration_min: 20, intensity: 1, pace: '6:15–5:50', hr: '130–150' },
    { phase: 'Movilidad', kind: 'drills', duration_min: 4, intensity: 1 },
    { phase: 'Serie', kind: 'work', duration_min: 6, reps: 4, recovery: '75″ de trote', pace: '4:24', hr: '171–177', intensity: 4,
      note: 'Objetivo de ritmo en el reloj, con alarma.' },
    { phase: 'Frenada', kind: 'cooldown', duration_min: 10, intensity: 1, hr: '<145' },
    { phase: 'Geles', kind: 'fuel', description: 'uno cada 40′' },
  ],
};

describe('categoría y tipo de bloque', () => {
  it('usa la categoría declarada y si falta la deduce del tipo', () => {
    expect(workoutCategory(subUmbral)).toBe('quality');
    expect(workoutCategory({ type: 'Descanso' })).toBe('rest');
    expect(workoutCategory({ type: 'Tirada larga' })).toBe('long');
    expect(workoutCategory({ type: 'Series 5×1000' })).toBe('quality');
    // "ritmo maratón" es calidad, no carrera.
    expect(workoutCategory({ type: '3 × 6′ a ritmo maratón' })).toBe('quality');
    expect(workoutCategory({ type: 'Rodaje' })).toBe('easy');
  });

  it('deduce el tipo de bloque del nombre si no trae kind', () => {
    expect(stepKind({ phase: 'Calentamiento' })).toBe('warmup');
    expect(stepKind({ phase: 'Vuelta a la calma' })).toBe('cooldown');
    expect(stepKind({ phase: 'Series', reps: 5 })).toBe('work');
    expect(stepKind({ phase: 'Rodaje', intensity: 2 })).toBe('steady');
  });

  it('parsea la pausa en minutos', () => {
    expect(parseRecoveryMin('75″ de trote')).toBe(1.25);
    expect(parseRecoveryMin('1,5′')).toBe(1.5);
    expect(parseRecoveryMin('2 min andando')).toBe(2);
    expect(parseRecoveryMin('trote suave')).toBeNull();
  });
});

describe('expandSteps', () => {
  it('despliega las series con sus pausas y suma solo tiempo de carrera', () => {
    const { rows, totalMin, workMin } = expandSteps(subUmbral.structured_workout);
    const labels = rows.map((r) => r.label || r.phase || `(${r.kind})`);
    expect(labels).toEqual([
      'Calentamiento', 'Movilidad', 'Serie 1', '(recovery)', 'Serie 2', '(recovery)', 'Serie 3', '(recovery)', 'Serie 4', 'Frenada', 'Geles',
    ]);
    expect(workMin).toBe(24);
    expect(totalMin).toBeCloseTo(20 + 4 + 24 + 3 * 1.25 + 10);
  });
});

describe('lintWorkout', () => {
  it('una sesión bien registrada no tiene avisos', () => {
    expect(lintWorkout(subUmbral)).toEqual([]);
  });

  it('avisa de lo que falta para leerse como ficha', () => {
    const w = lintWorkout({
      category: 'quality',
      type: 'Series',
      structured_workout: [
        { phase: 'Series', reps: 5, duration_min: 3, hr: '170-177 ppm' },
      ],
    });
    const all = w.join(' | ');
    expect(all).toMatch(/título técnico/);
    expect(all).toMatch(/key_rule/);
    expect(all).toMatch(/distance_km` o `duration_min/);
    expect(all).toMatch(/hr` debe ser un rango/);
    expect(all).toMatch(/recovery/);
    expect(all).toMatch(/calentamiento/);
    expect(all).toMatch(/vuelta a la calma/);
  });

  it('sin categoría lo dice; un descanso no necesita nada más', () => {
    expect(lintWorkout({ type: 'Rodaje', distance_km: 10 })[0]).toMatch(/category/);
    expect(lintWorkout({ category: 'rest', type: 'Descanso' })).toEqual([]);
  });

  it('una larga sin bloques pide estructura', () => {
    expect(lintWorkout({ category: 'long', type: '24 km', distance_km: 24 }).join(' ')).toMatch(/structured_workout/);
  });
});
