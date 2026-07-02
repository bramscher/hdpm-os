import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { updateWorkOrderWorkflow } from '@/lib/maintenance/workflow-db';

/**
 * PUT /api/maintenance/turns/:woId
 *
 * Upsert the turn row for a work order (Turnover board) and flag the WO as
 * a turn. Body: { vacated_at, target_ready?, current_blocker?, budget?, actual? }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ woId: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { woId } = await params;
    const body = await request.json();

    if (!body.vacated_at) {
      return NextResponse.json({ error: 'vacated_at is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('turn')
      .upsert(
        {
          work_order_id: woId,
          vacated_at: body.vacated_at,
          target_ready: body.target_ready ?? null,
          current_blocker: body.current_blocker ?? null,
          budget: body.budget ?? null,
          actual: body.actual ?? null,
        },
        { onConflict: 'work_order_id' }
      )
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Turn upsert failed');
    }

    // Flag the WO as a turn (audited via the workflow write path).
    await updateWorkOrderWorkflow(woId, { is_turn: true }, session.actor);

    return NextResponse.json({ turn: data });
  } catch (error) {
    console.error('[Maintenance] Turn upsert error:', error);
    const message = error instanceof Error ? error.message : 'Failed to save turn';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
