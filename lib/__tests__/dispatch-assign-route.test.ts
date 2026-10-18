import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/maintenance/dispatch/assign/route';
import { dispatchWorkOrders } from '../maintenance/dispatch-db';

vi.mock('../maintenance/api-auth', () => ({ requireStaffSession: async () => ({ email: 'brody@highdesertpm.com', actor: 'Brody' }) }));
vi.mock('../maintenance/dispatch-db', async (orig) => ({
  ...(await orig<typeof import('../maintenance/dispatch-db')>()),
  dispatchWorkOrders: vi.fn(),
}));

const post = (body: unknown) =>
  POST(new NextRequest('https://example.com/api/maintenance/dispatch/assign', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => vi.mocked(dispatchWorkOrders).mockReset());

describe('POST /api/maintenance/dispatch/assign', () => {
  it('rejects a bad target or empty selection before touching anything', async () => {
    expect((await post({ work_order_ids: [], to: { kind: 'unassigned' } })).status).toBe(400);
    expect((await post({ work_order_ids: ['a'], to: { kind: 'tech', person: 'Nobody' } })).status).toBe(400);
    expect((await post({ work_order_ids: Array.from({ length: 101 }, (_, i) => `w${i}`), to: { kind: 'unassigned' } })).status).toBe(400);
    expect(dispatchWorkOrders).not.toHaveBeenCalled();
  });

  it('returns 422 when every move is blocked by the workflow', async () => {
    vi.mocked(dispatchWorkOrders).mockResolvedValue([{ id: 'a', ok: false, error: 'A vendor or tech must be assigned from SCHEDULED onward' }]);
    const res = await post({ work_order_ids: ['a'], to: { kind: 'unassigned' } });
    expect(res.status).toBe(422);
    expect((await res.json()).results[0].error).toContain('SCHEDULED');
  });

  it('moves the rest when one is blocked, de-duplicating ids', async () => {
    vi.mocked(dispatchWorkOrders).mockResolvedValue([{ id: 'a', ok: true }, { id: 'b', ok: false, error: 'blocked' }]);
    const res = await post({ work_order_ids: ['a', 'b', 'a'], to: { kind: 'vendor', vendor_id: 'v-acme' } });
    expect(res.status).toBe(200);
    expect(dispatchWorkOrders).toHaveBeenCalledWith(['a', 'b'], { kind: 'vendor', vendor_id: 'v-acme' }, 'Brody');
  });
});
