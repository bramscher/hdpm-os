import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Call = { table: string; ops: [string, unknown[]][] };
const mocks = vi.hoisted(() => ({ review: vi.fn(), calls: [] as Call[] }));
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { email: 'test@highdesertpm.com' } }) }));
vi.mock('@/lib/inspection-review-loader', () => ({ loadInspectionReview: mocks.review, INSPECTION_REVIEW_CACHE_TAG: 'test' }));
vi.mock('@/lib/route-directions', () => ({
  optimizeRouteWithGoogle: async (stops: unknown[]) => ({ stops, total_drive_minutes: 12, source: 'haversine' }),
}));

const inspection = {
  id: 'insp-1', property_id: 'prop-1', status: 'queued', due_date: '2026-10-01', priority: 'normal', inspection_type: 'move_out', unit_name: null,
  inspection_properties: { id: 'prop-1', address_1: '330 W 1st St #5', city: 'Prineville', state: 'OR', zip: '97754', latitude: 44.3, longitude: -120.8 },
};
const has = (call: Call, op: string) => call.ops.some(([name]) => name === op);
const result = (call: Call) => {
  if (call.table === 'route_plans') return { data: { id: 'plan-1', route_date: '2026-10-14', assigned_to: 'brody@highdesertpm.com' }, error: null };
  if (call.table === 'inspections' && !has(call, 'update')) return { data: [inspection], error: null };
  return { data: null, error: null };
};
// A chainable stand-in for the Supabase query builder that records every call.
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      mocks.calls.push(call);
      const chain: unknown = new Proxy({}, {
        get: (_, prop: string) => {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result(call));
          if (prop === 'single') return async () => result(call);
          return (...args: unknown[]) => { call.ops.push([prop, args]); return chain; };
        },
      });
      return chain;
    },
  }),
}));
import { POST as buildRoutes } from '@/app/api/inspections/routes/route';

describe('Route Builder routes reach Send Notices', () => {
  beforeEach(() => { mocks.calls.length = 0; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T19:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  it('saves the route date, plan and assignee on scheduled inspections', async () => {
    mocks.review.mockResolvedValue({ rows: [], properties: [], candidates: [], review_counts: {}, verification_error: null });
    const response = await buildRoutes(new NextRequest('http://localhost/api/inspections/routes', {
      method: 'POST',
      body: JSON.stringify({ date_range_start: '2026-10-14', date_range_end: '2026-10-14', assigned_to: 'brody@highdesertpm.com', inspection_ids: ['insp-1'] }),
    }));
    expect(response.status).toBe(200);
    const update = mocks.calls.find((c) => c.table === 'inspections' && has(c, 'update'));
    expect(update?.ops.find(([name]) => name === 'update')?.[1][0]).toMatchObject({
      status: 'scheduled', target_date: '2026-10-14', route_plan_id: 'plan-1', assigned_to: 'brody@highdesertpm.com',
    });
    expect(update?.ops.find(([name]) => name === 'in')?.[1]).toEqual(['id', ['insp-1']]);
  });
});
