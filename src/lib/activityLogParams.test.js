import { describe, it, expect } from 'vitest';
import { DEFAULT_LOG_STATE, readLogState, writeLogState } from './activityLogParams';

describe('activityLogParams', () => {
  it('la vista por defecto no escribe nada en la URL', () => {
    expect(writeLogState(DEFAULT_LOG_STATE).toString()).toBe('');
    expect(readLogState(new URLSearchParams())).toEqual(DEFAULT_LOG_STATE);
  });

  it('ida y vuelta conserva todo el estado', () => {
    const s = {
      year: '2025', sports: ['Run', 'Ride'], q: 'tirada larga', sort: 'pace', dir: 'asc', page: 3,
      dist: { min: '10', max: '' }, elev: { min: '', max: '500' }, pace: { min: '4:30', max: '5:15' },
    };
    expect(readLogState(writeLogState(s))).toEqual(s);
  });

  it('distingue "ningún deporte" de "por defecto"', () => {
    const none = { ...DEFAULT_LOG_STATE, sports: [] };
    expect(readLogState(writeLogState(none)).sports).toEqual([]);
    expect(readLogState(writeLogState(DEFAULT_LOG_STATE)).sports).toBeNull();
  });

  it('ignora páginas no válidas', () => {
    expect(readLogState(new URLSearchParams('page=abc')).page).toBe(1);
    expect(readLogState(new URLSearchParams('page=-2')).page).toBe(1);
  });
});
