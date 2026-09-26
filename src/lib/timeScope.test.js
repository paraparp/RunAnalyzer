import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_TIME_SCOPE, TIME_SCOPES, isTimeScope, scopeDays, scopeFromISO, scopeMonths } from './timeScope';

afterEach(() => vi.useRealTimers());

describe('timeScope', () => {
  it('el default es 12 meses', () => {
    expect(DEFAULT_TIME_SCOPE).toBe('12m');
    expect(scopeMonths(DEFAULT_TIME_SCOPE)).toBe(12);
  });

  it('todo el histórico no tiene frontera', () => {
    expect(scopeMonths('all')).toBeNull();
    expect(scopeFromISO('all')).toBeNull();
    expect(scopeDays('all')).toBeNull();
  });

  it('un id desconocido cae al default en vez de romper', () => {
    expect(isTimeScope('365')).toBe(false);
    expect(scopeMonths('365')).toBe(12);
  });

  it('los días salen de la frontera de CALENDARIO, no de meses de 30 días', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 9, 0)); // 26-sep-2026, hora local
    expect(scopeFromISO('12m')).toBe('2025-09-26');
    expect(scopeDays('12m', new Date())).toBe(365);
    expect(scopeFromISO('1m')).toBe('2026-08-26');
    expect(scopeDays('1m', new Date())).toBe(31);
  });

  it('ids únicos y ordenados de corto a largo', () => {
    const ids = TIME_SCOPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const months = TIME_SCOPES.map((s) => s.months ?? Infinity);
    expect([...months].sort((a, b) => a - b)).toEqual(months);
  });
});
