import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ from: vi.fn(), optimize: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { email: 'test@highdesertpm.com' } }) }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: mocks.from }) }));
vi.mock('@/lib/route-directions', () => ({ optimizeRouteWithGoogle: mocks.optimize }));

import { POST } from '@/app/api/inspections/routes/[id]/optimize/route';

async function recalculate(status: string, stops: Record<string, unknown>[]) {
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => ({ data: { status }, error: null }),
      order: async () => ({ data: stops, error: null }),
    };
    if (!['route_plans', 'route_stops'].includes(table)) throw new Error(table);
    return query;
  });
  return POST(new NextRequest('http://localhost/api/inspections/routes/test/optimize', { method: 'POST' }),
    { params: Promise.resolve({ id: 'test' }) });
}

describe('inspection route recalculation eligibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['draft', 'optimized'])('allows %s routes with timestamped skipped stops through to coordinate validation', async status => {
    const response = await recalculate(status, [
      { status: 'skipped', actual_arrival: '2026-09-28T16:00:00Z' },
      { status: 'pending', actual_arrival: null },
    ]);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Geocode all route stops before optimizing.' });
  });

  it.each(['in_progress', 'completed', 'pending'])('rejects an active %s stop with an arrival timestamp', async status => {
    const response = await recalculate('optimized', [{ status, actual_arrival: '2026-09-28T16:00:00Z' }]);
    expect(response.status).toBe(409);
    expect(mocks.optimize).not.toHaveBeenCalled();
  });

  it.each(['dispatched', 'in_progress', 'completed'])('keeps %s routes protected', async status => {
    expect((await recalculate(status, [{ status: 'pending' }])).status).toBe(409);
    expect(mocks.optimize).not.toHaveBeenCalled();
  });
});
