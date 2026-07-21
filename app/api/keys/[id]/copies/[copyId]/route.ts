import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { appendKeyEvent } from '@/lib/keys';

const COPY_STATUSES = new Set(['issued', 'returned', 'lost', 'destroyed']);
const HOLDER_TYPES = new Set(['tenant', 'office', 'vendor', 'staff', 'other']);

/**
 * PATCH /api/keys/:id/copies/:copyId — mark a copy returned / lost /
 * destroyed (or re-issued), correct holder name/type, toggle charged.
 * Body: { status?, holderName?, holderType?, charged?, notes? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; copyId: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id, copyId } = await params;
    const body = (await request.json()) as {
      status?: string;
      holderName?: string;
      holderType?: string;
      charged?: boolean;
      notes?: string;
    };

    const fields: Record<string, unknown> = {};
    if (body.status !== undefined) {
      if (!COPY_STATUSES.has(body.status)) {
        return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 422 });
      }
      fields.status = body.status;
      const today = new Date().toISOString().split('T')[0];
      if (body.status === 'returned') fields.returned_at = today;
      if (body.status === 'issued') {
        fields.issued_at = today;
        fields.returned_at = null;
      }
    }
    if (body.holderName !== undefined) fields.holder_name = body.holderName;
    if (body.holderType !== undefined) {
      if (!HOLDER_TYPES.has(body.holderType)) {
        return NextResponse.json({ error: `Invalid holder type: ${body.holderType}` }, { status: 422 });
      }
      fields.holder_type = body.holderType;
    }
    if (body.charged !== undefined) fields.charged = body.charged;
    if (body.notes !== undefined) fields.notes = body.notes;
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 422 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('key_copy').update(fields).eq('id', copyId);
    if (error) throw new Error(error.message);

    if (body.status === 'returned' || body.status === 'lost') {
      await appendKeyEvent(
        id,
        body.status === 'returned' ? 'copy_returned' : 'copy_lost',
        { copy_id: copyId },
        session.actor
      );
    } else {
      await appendKeyEvent(id, 'edited', { copy_id: copyId, fields }, session.actor);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/keys/:id/copies/:copyId] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update copy';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
