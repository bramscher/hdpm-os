import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { draftEstimateFromWorkOrder } from '@/lib/agents/estimate-drafter-run';

// The Claude call + AppFolio detail fetch can take a while.
export const maxDuration = 120;

/**
 * POST /api/turn-estimator/estimates/draft { work_order_id }
 * Runs the estimate-drafter agent for a work order and returns the priced draft
 * lines for the builder to pre-populate. Does NOT persist an estimate.
 * maintenance/pm/admin.
 */
export async function POST(request: NextRequest) {
  const guard = await requireRole('maintenance', 'pm', 'admin');
  if (!guard.ok) return guard.response;

  let body: { work_order_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.work_order_id) {
    return NextResponse.json({ error: 'work_order_id is required' }, { status: 400 });
  }

  try {
    const draft = await draftEstimateFromWorkOrder(body.work_order_id, guard.email);
    return NextResponse.json({ draft });
  } catch (err) {
    console.error('estimate draft failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
