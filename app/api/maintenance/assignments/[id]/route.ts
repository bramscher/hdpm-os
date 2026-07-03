import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';

/** Timestamps + flags staff may set manually (Wave 1: acceptance by phone). */
const PATCHABLE = ['accepted_at', 'declined_at', 'scheduled_at', 'completed_at', 'callback'] as const;

/**
 * PATCH /api/maintenance/assignments/:id
 *
 * Mark an assignment accepted / declined / scheduled / completed / callback.
 * Wave 1: these are set manually after a phone confirmation; vendor
 * magic-link acceptance arrives in Wave 2.
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

    const patch: Record<string, unknown> = {};
    for (const field of PATCHABLE) {
      if (field in body) patch[field] = body[field];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No patchable fields in request' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('vendor_assignment')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Assignment update failed');
    }

    return NextResponse.json({ assignment: data });
  } catch (error) {
    console.error('[Maintenance] Assignment update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update assignment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
