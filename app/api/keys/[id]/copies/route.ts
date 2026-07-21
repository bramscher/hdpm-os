import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { appendKeyEvent } from '@/lib/keys';

/**
 * POST /api/keys/:id/copies — issue a new physical copy.
 * Body: { keyTypeId, holderType, holderName?, charged? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json()) as {
      keyTypeId?: string;
      holderType?: string;
      holderName?: string;
      charged?: boolean;
    };
    if (!body.keyTypeId || !body.holderType) {
      return NextResponse.json({ error: 'keyTypeId and holderType are required' }, { status: 422 });
    }

    const supabase = getSupabaseAdmin();
    const today = new Date().toISOString().split('T')[0];
    const { data: copy, error } = await supabase
      .from('key_copy')
      .insert({
        key_type_id: body.keyTypeId,
        holder_type: body.holderType,
        holder_name: body.holderName ?? null,
        charged: body.charged ?? false,
        status: 'issued',
        issued_at: today,
      })
      .select('id')
      .single();
    if (error || !copy) throw new Error(error?.message ?? 'Insert failed');

    await appendKeyEvent(
      id,
      'copy_issued',
      {
        key_type_id: body.keyTypeId,
        holder_type: body.holderType,
        holder_name: body.holderName ?? null,
        charged: body.charged ?? false,
      },
      session.actor
    );
    return NextResponse.json({ ok: true, copy_id: copy.id });
  } catch (error) {
    console.error('[api/keys/:id/copies] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to issue copy';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
