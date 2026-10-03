import { describe, it, expect } from 'vitest';
import { activityNeighbors } from './activityNeighbors';

const act = (id, date, sport_type = 'Run') => ({ id, start_date: `2026-${date}T08:00:00Z`, sport_type });

describe('activityNeighbors', () => {
  const list = [
    act(1, '09-01'),
    act(2, '09-02', 'WeightTraining'),
    act(3, '09-03', 'TrailRun'),
    act(4, '09-05'),
    act(5, '09-04', 'WeightTraining'),
  ];

  it('salta a la sesión anterior y siguiente de la misma familia', () => {
    const { prev, next } = activityNeighbors(list[2], list);
    expect(prev.id).toBe(1);
    expect(next.id).toBe(4);
  });

  it('no mezcla deportes', () => {
    const { prev, next } = activityNeighbors(list[1], list);
    expect(prev).toBeNull();
    expect(next.id).toBe(5);
  });

  it('en los extremos devuelve null', () => {
    expect(activityNeighbors(list[0], list).prev).toBeNull();
    expect(activityNeighbors(list[3], list).next).toBeNull();
  });

  it('dos sesiones a la misma hora siguen siendo alcanzables en ambos sentidos', () => {
    const same = [act('a', '09-01'), act('b', '09-01'), act('c', '09-02')];
    expect(activityNeighbors(same[0], same).next.id).toBe('b');
    expect(activityNeighbors(same[1], same).prev.id).toBe('a');
    expect(activityNeighbors(same[1], same).next.id).toBe('c');
  });
});
