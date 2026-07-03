import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { recordEvent } from '@/lib/maintenance/events';

/**
 * POST /api/maintenance/approvals
 *
 * Request an owner/PM approval (tripwire #11 starts its 3-business-day clock).
 * Body: { work_order_id, kind: 'OWNER'|'PM', requested_of, estimate?, photos? }
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.work_order_id || !body.kind || !body.requested_of) {
      return NextResponse.json(
        { error: 'work_order_id, kind (OWNER|PM) and requested_of are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('approval')
      .insert({
        work_order_id: body.work_order_id,
        kind: body.kind,
        requested_of: body.requested_of,
        estimate: body.estimate ?? null,
        photos: body.photos ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Approval insert failed');
    }

    await recordEvent({
      work_order_id: body.work_order_id,
      event_type: 'approval_request',
      payload: { approval_id: data.id, kind: body.kind, requested_of: body.requested_of },
      actor: session.actor,
    });

    return NextResponse.json({ approval: data });
  } catch (error) {
    console.error('[Maintenance] Approval create error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create approval';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
