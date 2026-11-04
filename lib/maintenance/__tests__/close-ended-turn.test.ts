import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setComplete, rows } = vi.hoisted(() => ({
  setComplete: vi.fn(),
  rows: { work_orders: [] as unknown[], turn_activity: [] as unknown[], error: null as unknown },
}));
vi.mock('@/lib/turnover/server', () => ({ setComplete }));
vi.mock('@/lib/appfolio', () => ({ fetchAppFolioTenants: vi.fn() }));
vi.mock('@/lib/appfolio-reports', () => ({ fetchUnitIdBridge: vi.fn(), runReport: vi.fn() }));
vi.mock('@/lib/maintenance/events', () => ({ recordEvents: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: 'work_orders' | 'turn_activity') => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is']) chain[m] = () => chain;
      chain.limit = async () => ({ data: rows[table], error: rows.error });
      return chain;
    },
  }),
}));

import { closeEndedTurn } from '../unit-turns';

describe('closeEndedTurn', () => {
  beforeEach(() => {
    setComplete.mockReset();
    rows.work_orders = [];
    rows.turn_activity = [];
    rows.error = null;
  });
  it('closes an ended turn with no open work and says why', async () => {
    expect(await closeEndedTurn('t1', '2026-10-20T00:00:00')).toBe(true);
    expect(setComplete).toHaveBeenCalledWith(expect.anything(), 't1', true, 'appfolio-sync', 'Closed: AppFolio turn ended 2026-10-20');
  });
  it('leaves a turn with open work', async () => {
    rows.work_orders = [{ id: 'w' }];
    expect(await closeEndedTurn('t1', '2026-10-20')).toBe(false);
    expect(setComplete).not.toHaveBeenCalled();
  });
  it('leaves a turn someone reopened', async () => {
    rows.turn_activity = [{ id: 1 }];
    expect(await closeEndedTurn('t1', '2026-10-20')).toBe(false);
    expect(setComplete).not.toHaveBeenCalled();
  });
  it('does nothing when the check fails', async () => {
    rows.error = { message: 'down' };
    expect(await closeEndedTurn('t1', '2026-10-20')).toBe(false);
    expect(setComplete).not.toHaveBeenCalled();
  });
});
