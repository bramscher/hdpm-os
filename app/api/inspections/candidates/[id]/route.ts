import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

interface PatchBody {
  candidate_status?: 'eligible' | 'dismissed' | 'defer' | 'skip_recent';
  local_skip_reason?: string | null;
}

/**
 * PATCH /api/inspections/candidates/[id]
 *
 * Manual local-only override for a candidate's status (e.g. dismiss, restore).
 * Writes an audit row to inspection_audit_log.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as PatchBody;

    if (!body.candidate_status) {
      return NextResponse.json({ error: 'candidate_status is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: existing, error: loadErr } = await supabase
      .from('inspection_properties')
      .select('id, candidate_status, local_skip_reason')
      .eq('id', id)
      .single();

    if (loadErr || !existing) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      candidate_status: body.candidate_status,
      local_skip_reason:
        body.local_skip_reason ?? (body.candidate_status === 'dismissed' ? 'Manually dismissed' : null),
      local_skip_set_at:
        body.candidate_status === 'dismissed' || body.candidate_status === 'skip_recent' ? now : null,
    };

    const { error: updErr } = await supabase
      .from('inspection_properties')
      .update(updates)
      .eq('id', id);

    if (updErr) {
      console.error('[candidates PATCH] update error:', updErr);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    await supabase.from('inspection_audit_log').insert({
      entity_type: 'inspection_property',
      entity_id: id,
      action: 'candidate_status_changed',
      old_value: { candidate_status: existing.candidate_status, local_skip_reason: existing.local_skip_reason },
      new_value: { candidate_status: body.candidate_status, local_skip_reason: updates.local_skip_reason },
      performed_by: email,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[candidates PATCH] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update candidate';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
