import { describe, expect, it } from 'vitest';
import { planQueueRows } from '../inspection-queue-rows';
import type { ReviewedCandidate } from '../inspection-review';

const candidate = (id: string, extra: Partial<ReviewedCandidate> = {}) =>
  ({ id, next_due_date: '2026-09-02', move_in_date: '2026-03-02', last_inspection_date: '2026-03-02', resident_name: 'Pat', tenant_email: 'pat@example.com', ...extra }) as ReviewedCandidate;

describe('planQueueRows', () => {
  it('adopts unrouted pending rows, skips routed ones, and creates the rest', () => {
    const plan = planQueueRows(
      [candidate('a'), candidate('b'), candidate('c'), candidate('d', { tenant_email: null })],
      [
        { id: 'insp-a', property_id: 'a', due_date: '2026-09-02', priority: 'normal', status: 'imported', route_plan_id: null },
        { id: 'insp-b', property_id: 'b', due_date: '2026-09-02', priority: 'normal', status: 'scheduled', route_plan_id: 'plan-1' },
      ],
      '2026-10-05',
    );
    expect(plan.adopted.map((r) => r.id)).toEqual(['insp-a']);
    expect(plan.skippedInFlight).toBe(1);
    expect(plan.toInsert).toEqual([
      expect.objectContaining({ property_id: 'c', status: 'queued', due_date: '2026-09-02', notice_status: 'pending' }),
      expect.objectContaining({ property_id: 'd', notice_email: null, notice_status: 'skipped_no_email' }),
    ]);
  });
});
