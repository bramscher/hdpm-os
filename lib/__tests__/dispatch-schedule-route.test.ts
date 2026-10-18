import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/maintenance/dispatch/schedule/route';
import { scheduleWorkOrders } from '../maintenance/dispatch-schedule';

vi.mock('../maintenance/api-auth', () => ({ requireStaffSession: async () => ({ email: 'brody@highdesertpm.com', actor: 'Brody' }) }));
vi.mock('../maintenance/dispatch-schedule', async (orig) => ({
  ...(await orig<typeof import('../maintenance/dispatch-schedule')>()),
  scheduleWorkOrders: vi.fn(),
}));

const post = (body: unknown) =>
  POST(new NextRequest('https://example.com/api/maintenance/dispatch/schedule', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => vi.mocked(scheduleWorkOrders).mockReset());

describe('POST /api/maintenance/dispatch/schedule', () => {
  it('validates the row, date and size before scheduling', async () => {
    expect((await post({ work_order_ids: ['a'], row: { kind: 'tech', person: 'Bryce' }, date: '2026-10-20' })).status).toBe(400);
    expect((await post({ work_order_ids: ['a'], row: { kind: 'vendor' }, date: '10/20' })).status).toBe(400);
    expect((await post({ work_order_ids: Array.from({ length: 41 }, (_, i) => `w${i}`), row: { kind: 'vendor' }, date: '2026-10-20' })).status).toBe(400);
    expect(scheduleWorkOrders).not.toHaveBeenCalled();
  });

  it('passes a draft-day drop through, and null takes it off the schedule', async () => {
    vi.mocked(scheduleWorkOrders).mockResolvedValue([{ id: 'a', ok: true }]);
    expect((await post({ work_order_ids: ['a', 'a'], row: { kind: 'tech', person: 'alberto' }, date: '2026-10-20' })).status).toBe(200);
    expect(scheduleWorkOrders).toHaveBeenLastCalledWith(['a'], { kind: 'tech', person: 'Alberto' }, '2026-10-20', 'Brody');
    await post({ work_order_ids: ['a'], row: { kind: 'vendor' }, date: null });
    expect(scheduleWorkOrders).toHaveBeenLastCalledWith(['a'], { kind: 'vendor' }, null, 'Brody');
  });

  it('returns 422 when nothing could be scheduled', async () => {
    vi.mocked(scheduleWorkOrders).mockResolvedValue([{ id: 'a', ok: false, error: "Alberto's Tue 10/20 is already published. Change it in Route Builder." }]);
    expect((await post({ work_order_ids: ['a'], row: { kind: 'tech', person: 'Alberto' }, date: '2026-10-20' })).status).toBe(422);
  });
});
