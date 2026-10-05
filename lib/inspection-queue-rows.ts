import { computeInspectionDueDate } from './inspection-candidates';
import type { ReviewedCandidate } from './inspection-review';

/** Unrouted queue statuses — safe to adopt into a new route. */
export const ADOPTABLE_STATUSES = new Set(['imported', 'validated', 'queued']);

export interface PendingInspectionRow {
  id: string;
  property_id: string;
  due_date: string;
  priority: string;
  status: string;
  route_plan_id?: string | null;
}

/**
 * Decide, per ready candidate, whether to adopt its existing unrouted
 * inspection, create a new 'queued' one, or leave it alone because it is
 * already on a route. Shared by Schedule ready and Add to queue so both
 * produce identical rows and never duplicate a pending inspection.
 */
export function planQueueRows(
  candidates: ReviewedCandidate[],
  pendingRows: PendingInspectionRow[],
  todayStr: string,
): { toInsert: Record<string, unknown>[]; adopted: PendingInspectionRow[]; skippedInFlight: number } {
  const pendingByProperty = new Map(pendingRows.map((r) => [r.property_id, r]));
  const toInsert: Record<string, unknown>[] = [];
  const adopted: PendingInspectionRow[] = [];
  let skippedInFlight = 0;
  for (const c of candidates) {
    const existing = pendingByProperty.get(c.id);
    if (existing) {
      if (existing.route_plan_id || !ADOPTABLE_STATUSES.has(existing.status)) {
        // Already attached to an active route — leave it alone entirely.
        skippedInFlight++;
        continue;
      }
      adopted.push(existing);
      continue;
    }
    const dueDate =
      c.next_due_date ||
      computeInspectionDueDate(c.move_in_date ?? null, c.last_inspection_date ?? null) ||
      todayStr;
    toInsert.push({
      property_id: c.id,
      inspection_type: 'routine',
      status: 'queued',
      priority: 'normal',
      priority_score: 50,
      estimated_duration_minutes: 15,
      occupancy_status: 'occupied',
      due_date: dueDate,
      last_inspection_date: c.last_inspection_date ?? null,
      move_in_date: c.move_in_date ?? null,
      resident_name: c.resident_name ?? null,
      notice_email: c.tenant_email ?? null,
      notice_status: c.tenant_email ? 'pending' : 'skipped_no_email',
    });
  }
  return { toInsert, adopted, skippedInFlight };
}
