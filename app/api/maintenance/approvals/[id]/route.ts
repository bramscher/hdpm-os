import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { recordEvent } from '@/lib/maintenance/events';

/**
 * PATCH /api/maintenance/approvals/:id
 *
 * Record the decision on a pending approval.
 * Body: { decision: 'APPROVED'|'DECLINED', approved_amount?, conditions? }
 *
 * The approval_decision event is what unblocks BILL for scope changes
 * (rule 6 counts APPROVED decisions against scope_change events).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    if (body.decision !== 'APPROVED' && body.decision !== 'DECLINED') {
      return NextResponse.json(
        { error: 'decision must be APPROVED or DECLINED' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('approval')
      .update({
        decision: body.decision,
        decided_at: new Date().toISOString(),
        approved_amount: body.approved_amount ?? null,
        conditions: body.conditions ?? null,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Approval update failed');
    }

    await recordEvent({
      work_order_id: data.work_order_id,
      event_type: 'approval_decision',
      payload: {
        approval_id: data.id,
        decision: body.decision,
        approved_amount: body.approved_amount ?? null,
      },
      actor: session.actor,
    });

    return NextResponse.json({ approval: data });
  } catch (error) {
    console.error('[Maintenance] Approval decision error:', error);
    const message = error instanceof Error ? error.message : 'Failed to record decision';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
