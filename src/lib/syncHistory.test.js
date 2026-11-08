import { describe, it, expect } from 'vitest';
import { summarizeSyncRun, appendSyncRun } from './syncHistory';

describe('syncHistory', () => {
  it('resume ambos carriles', () => {
    const r = summarizeSyncRun({ startedAt: 1000, finishedAt: 2500, mode: 'quick',
      strava: { status: 'synced', changed: 3, data: {} },
      garmin: { status: 'synced', days: 2, activities: 5, activitiesError: 'x' } });
    expect(r).toEqual({ startedAt: 1000, durationMs: 1500, mode: 'quick',
      strava: { status: 'synced', changed: 3, error: null },
      garmin: { status: 'synced', days: 2, activities: 5, error: 'x' } });
  });
  it('añade al principio y recorta', () => {
    const h = appendSyncRun([{ a: 1 }, { a: 2 }], { a: 0 }, 2);
    expect(h).toEqual([{ a: 0 }, { a: 1 }]);
    expect(appendSyncRun(null, { a: 0 })).toEqual([{ a: 0 }]);
  });
});
