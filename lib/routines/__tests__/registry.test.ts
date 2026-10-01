import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { ROUTINES, routineForUrl, cadence, occurrences, nextRun } from '../registry';
import { AGENT_CATALOG } from '@/lib/agents/catalog';

const root = path.resolve(__dirname, '../../..');
const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')).crons;

describe('registry integrity (add new crons to lib/routines/registry.ts)', () => {
  it('registers every vercel.json cron with the same schedule', () => {
    const missing = crons.filter((c) => !ROUTINES.some((r) => r.path === c.path && r.schedule === c.schedule));
    expect(missing).toEqual([]);
  });

  it('has no routine that vercel.json does not schedule', () => {
    const extra = ROUTINES.filter((r) => !crons.some((c) => c.path === r.path && c.schedule === r.schedule));
    expect(extra.map((r) => r.id)).toEqual([]);
  });

  it('has unique ids and paths', () => {
    expect(new Set(ROUTINES.map((r) => r.id)).size).toBe(ROUTINES.length);
    expect(new Set(ROUTINES.map((r) => r.path)).size).toBe(ROUTINES.length);
  });

  it('points at real route files and real catalog agents', () => {
    for (const r of ROUTINES) {
      const file = path.join(root, 'app', r.path.split('?')[0], 'route.ts');
      expect(existsSync(file), r.id).toBe(true);
      expect(readFileSync(file, 'utf8'), `${r.id} must export GET = withCronRun(...)`).toMatch(/export const GET = withCronRun\(/);
      if (r.catalogId) expect(AGENT_CATALOG.some((a) => a.id === r.catalogId), r.id).toBe(true);
    }
  });
});

describe('routineForUrl', () => {
  it('prefers the entry that names the query params', () => {
    expect(routineForUrl('/api/sync/work-orders?days=7')?.id).toBe('wo_sync_hourly');
    expect(routineForUrl('/api/sync/work-orders?days=1')?.id).toBe('wo_sync_15m');
    expect(routineForUrl('/api/agents/cron/ops-brief')?.id).toBe('ops_brief');
    expect(routineForUrl('/api/agents/cron/ops-brief?deep=1')?.id).toBe('ops_brief_deep');
  });
  it('ignores extra params like dryRun', () => {
    expect(routineForUrl('/api/agents/cron/estimate-chaser?dryRun=1')?.id).toBe('estimate_chaser');
  });
  it('returns undefined for unknown paths and unmatched params', () => {
    expect(routineForUrl('/api/nope')).toBeUndefined();
    expect(routineForUrl('/api/sync/work-orders')).toBeUndefined();
  });
});

describe('schedule helpers (UTC, like Vercel)', () => {
  it('classifies 15-minute and hourly crons as continuous', () => {
    expect(cadence('*/15 * * * *')).toBe('continuous');
    expect(cadence('45 * * * *')).toBe('continuous');
    expect(cadence('30 15-23 * * 1-5')).toBe('scheduled');
    expect(cadence('45 13 * * 1-5')).toBe('scheduled');
  });
  it('lists weekday firings in UTC', () => {
    const from = new Date('2026-10-05T00:00:00Z'); // Monday
    const to = new Date('2026-10-12T00:00:00Z');
    const runs = occurrences('45 13 * * 1-5', from, to);
    expect(runs).toHaveLength(5);
    expect(runs[0].toISOString()).toBe('2026-10-05T13:45:00.000Z');
  });
  it('includes a firing exactly at the window start', () => {
    const runs = occurrences('0 0 * * *', new Date('2026-10-05T00:00:00Z'), new Date('2026-10-06T00:00:00Z'));
    expect(runs.map((d) => d.toISOString())).toEqual(['2026-10-05T00:00:00.000Z']);
  });
  it('finds the next run', () => {
    expect(nextRun('0 22 * * 5', new Date('2026-10-05T00:00:00Z')).toISOString()).toBe('2026-10-09T22:00:00.000Z');
  });
});
