import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { recordEvent } from '@/lib/maintenance/events';

/**
 * POST /api/maintenance/assignments
 *
 * Create a vendor assignment (tripwire #4 starts its 24h clock at sent_at).
 * Body: { work_order_id, vendor_id, sent_at? }
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.work_order_id || !body.vendor_id) {
      return NextResponse.json(
        { error: 'work_order_id and vendor_id are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('vendor_assignment')
      .insert({
        work_order_id: body.work_order_id,
        vendor_id: body.vendor_id,
        sent_at: body.sent_at ?? new Date().toISOString(),
        created_by: session.actor,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Assignment insert failed');
    }

    await recordEvent({
      work_order_id: body.work_order_id,
      event_type: 'assign',
      payload: { vendor_id: body.vendor_id, assignment_id: data.id, field: 'vendor_assignment' },
      actor: session.actor,
    });

    return NextResponse.json({ assignment: data });
  } catch (error) {
    console.error('[Maintenance] Assignment create error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create assignment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
