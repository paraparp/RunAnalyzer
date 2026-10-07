import { describe, it, expect } from 'vitest';
import {
  sessionKind, recoveryVersion, weekReview, replanWeek, applyReplan, readChoice, writeChoice,
} from './adaptivePlan';
import { planDayFor } from './todaySession';

const easy = (day) => ({ day, type: 'Rodaje suave', structured_workout: [{ phase: 'Rodaje', duration_min: 45, intensity: 2 }] });
const hard = (day) => ({ day, type: 'Series', structured_workout: [{ phase: 'Series', duration_min: 4, reps: 6, intensity: 5 }] });
const long = (day) => ({ day, type: 'Tirada larga', structured_workout: [{ phase: 'Rodaje', duration_min: 100, intensity: 2 }] });
const rest = (day) => ({ day, type: 'Descanso', structured_workout: [] });
const run = (date) => ({ type: 'Run', start_date_local: `${date}T08:00:00Z` });

// Semana generada el lunes 2026-10-05: L suave, M series, X descanso, J suave, V descanso, S larga, D suave.
const saved = {
  generated_at: '2026-10-05',
  plan: { schedule: [easy('Lunes'), hard('Martes'), rest('Miércoles'), easy('Jueves'), rest('Viernes'), long('Sábado'), easy('Domingo')] },
};

describe('sessionKind', () => {
  it('distingue descanso, fácil, duro y largo', () => {
    expect(sessionKind(rest('Lunes'))).toBe('rest');
    expect(sessionKind(easy('Lunes'))).toBe('easy');
    expect(sessionKind(hard('Lunes'))).toBe('hard');
    expect(sessionKind(long('Lunes'))).toBe('long');
  });
});

describe('weekReview', () => {
  it('marca hecho, fallado, hoy y pendiente por fecha real', () => {
    const r = weekReview(saved, [run('2026-10-05')], '2026-10-07');
    const by = Object.fromEntries(r.map((e) => [e.date, e.status]));
    expect(by['2026-10-05']).toBe('done');
    expect(by['2026-10-06']).toBe('missed');
    expect(by['2026-10-07']).toBe('rest');
    expect(by['2026-10-08']).toBe('upcoming');
  });

  it('una bici no cuenta como sesión hecha', () => {
    const r = weekReview(saved, [{ type: 'Ride', start_date_local: '2026-10-05T08:00:00Z' }], '2026-10-06');
    expect(r[0].status).toBe('missed');
  });
});

describe('replanWeek', () => {
  it('mueve las series falladas al primer día libre sin juntar dos días clave', () => {
    // Hoy miércoles (descanso), martes fallado: miércoles queda entre el martes
    // (ya perdido) y el jueves fácil → vale.
    const { moves, schedule } = replanWeek(saved, [run('2026-10-05')], '2026-10-07');
    expect(moves).toHaveLength(1);
    expect(moves[0].to.date).toBe('2026-10-07');
    const moved = schedule.find((d) => d.type === 'Series');
    expect(moved.day).toBe('Miércoles');
    expect(moved.moved_from).toBe('Martes');
    expect(schedule.find((d) => d.type === 'Descanso' && d.day === 'Miércoles')).toBeUndefined();
  });

  it('el plan nuevo se resuelve con la misma regla de fechas que la portada', () => {
    const { schedule } = replanWeek(saved, [run('2026-10-05')], '2026-10-07');
    const next = applyReplan(saved, schedule, '2026-10-07');
    expect(planDayFor(next, '2026-10-07').day.type).toBe('Series');
    expect(next.replanned_at).toBe('2026-10-07');
  });

  it('no coloca una sesión clave pegada a la tirada larga', () => {
    // Hoy viernes, martes fallado: viernes y domingo tocan con la larga del sábado.
    const acts = ['2026-10-05', '2026-10-08'].map(run);
    const { moves, dropped } = replanWeek(saved, acts, '2026-10-09');
    expect(moves).toHaveLength(0);
    expect(dropped).toEqual([expect.objectContaining({ reason: 'no_room' })]);
  });

  it('lo fácil perdido no se recupera', () => {
    const { moves, dropped, schedule } = replanWeek(saved, [run('2026-10-06')], '2026-10-07');
    expect(moves).toHaveLength(0);
    expect(dropped[0]).toMatchObject({ reason: 'easy' });
    expect(schedule).toBeNull();
  });

  it('aplazar hoy la sesión dura la mueve y deja la regenerativa en su lugar', () => {
    const replacement = recoveryVersion(hard('Martes'), { structure: { mainMin: 25, totalMin: 35 } });
    const { moves, schedule } = replanWeek(saved, [run('2026-10-05')], '2026-10-06', {
      postponedToday: true, todayReplacement: replacement,
    });
    expect(moves[0].to.date).toBe('2026-10-07');
    const next = applyReplan(saved, schedule, '2026-10-06');
    expect(planDayFor(next, '2026-10-06').day.type).toBe('Trote regenerativo');
    expect(planDayFor(next, '2026-10-07').day.type).toBe('Series');
  });

  it('la tirada larga tiene prioridad sobre las series', () => {
    // Hoy domingo 11: fallados martes (series) y sábado (larga). Solo queda el domingo.
    const { moves } = replanWeek(saved, [run('2026-10-05')], '2026-10-11');
    expect(moves.map((m) => m.from.kind)).toEqual(['long']);
  });
});

describe('recoveryVersion', () => {
  it('es un día de plan regenerativo con la propuesta de la portada', () => {
    const r = recoveryVersion(hard('Martes'), {
      targetPace: '6:00 – 6:20', targetHr: '< 140 ppm', targetDistance: '5 – 6 km',
      structure: { warmMin: 5, mainMin: 30, coolMin: 5, totalMin: 40 },
    });
    expect(sessionKind(r)).toBe('easy');
    expect(r.structured_workout.every((b) => b.intensity === 1)).toBe(true);
    expect(r.adapted_from).toBe('Series');
    expect(r.daily_stats.time).toBe('40 min');
  });
});

describe('elección de hoy', () => {
  it('guarda solo la del día', () => {
    const mem = {};
    const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
    writeChoice(storage, '2026-10-06', 'original');
    expect(readChoice(storage, '2026-10-06')).toBe('original');
    expect(readChoice(storage, '2026-10-07')).toBeNull();
  });
});
