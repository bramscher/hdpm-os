import { describe, expect, it, vi } from 'vitest';

// A published day: the plan lookup finds one, so nothing else may be touched.
const calls: string[] = [];
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      calls.push(table);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'ilike', 'in', 'gte', 'lte', 'order']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: table === 'maint_route_plan' ? { id: 'plan-published' } : null, error: null });
      q.insert = () => { throw new Error('must not insert'); };
      q.delete = () => { throw new Error('must not delete'); };
      return q;
    },
  }),
}));

describe('scheduleWorkOrders', () => {
  it("refuses a tech's published day and leaves the route alone", async () => {
    const { scheduleWorkOrders } = await import('../dispatch-schedule');
    const results = await scheduleWorkOrders(['wo-1', 'wo-2'], { kind: 'tech', person: 'Alberto' }, '2026-10-20', 'Brody');
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0].error).toContain('already published');
    expect(calls).toEqual(['maint_route_plan']);
  });
});
