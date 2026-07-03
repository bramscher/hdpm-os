import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';

/**
 * PATCH /api/maintenance/recommendations/:id
 *
 * Resolve a recommendation: either it became a WO (resolved_wo_id) or it is
 * dismissed in writing (dismissed_reason). Exactly one is required.
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

    const hasWo = typeof body.resolved_wo_id === 'string' && body.resolved_wo_id.length > 0;
    const hasDismissal =
      typeof body.dismissed_reason === 'string' && body.dismissed_reason.trim().length > 0;
    if (hasWo === hasDismissal) {
      return NextResponse.json(
        { error: 'Provide exactly one of resolved_wo_id or dismissed_reason (written)' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('recommendation')
      .update(
        hasWo
          ? { resolved_wo_id: body.resolved_wo_id }
          : { dismissed_reason: body.dismissed_reason.trim() }
      )
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Recommendation update failed');
    }

    return NextResponse.json({ recommendation: data });
  } catch (error) {
    console.error('[Maintenance] Recommendation update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update recommendation';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
