import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { dispatchWorkOrders, parseTarget } from '@/lib/maintenance/dispatch-db';

/** A whole column of cards at most; the board moves one card or a selection. */
const MAX_PER_DROP = 100;

/**
 * POST /api/maintenance/dispatch/assign
 *
 * Dispatch board drop. Body: { work_order_ids: string[], to: { kind: 'tech', person }
 * | { kind: 'vendor', vendor_id } | { kind: 'unassigned' } }. Returns one result per
 * work order; a blocked one doesn't stop the rest.
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const ids: unknown = body.work_order_ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
      return NextResponse.json({ error: 'work_order_ids is required' }, { status: 400 });
    }
    if (ids.length > MAX_PER_DROP) {
      return NextResponse.json({ error: `Move at most ${MAX_PER_DROP} work orders at a time` }, { status: 400 });
    }
    const target = parseTarget(body.to);
    if (!target) {
      return NextResponse.json({ error: 'to must be a tech, a vendor or unassigned' }, { status: 400 });
    }

    const results = await dispatchWorkOrders([...new Set(ids as string[])], target, session.actor);
    const failed = results.filter((r) => !r.ok).length;
    return NextResponse.json({ results }, { status: failed === results.length ? 422 : 200 });
  } catch (error) {
    console.error('[Maintenance] Dispatch assign error:', error);
    const message = error instanceof Error ? error.message : 'Failed to move work orders';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
