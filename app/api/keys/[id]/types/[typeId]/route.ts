import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { appendKeyEvent } from '@/lib/keys';

/** PATCH /api/keys/:id/types/:typeId — rename / reorder / note a key type. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; typeId: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id, typeId } = await params;
    const body = (await request.json()) as { label?: string; sort_order?: number; notes?: string };
    const fields: Record<string, unknown> = {};
    if (body.label !== undefined) fields.label = body.label.trim();
    if (body.sort_order !== undefined) fields.sort_order = body.sort_order;
    if (body.notes !== undefined) fields.notes = body.notes;
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 422 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('key_type').update(fields).eq('id', typeId);
    if (error) throw new Error(error.message);

    await appendKeyEvent(id, 'edited', { key_type_id: typeId, fields }, session.actor);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/keys/:id/types/:typeId] patch error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update key type';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/keys/:id/types/:typeId — remove a key type; blocked while any
 * of its copies are still issued.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; typeId: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id, typeId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: type, error: tErr } = await supabase
      .from('key_type')
      .select('label, key_copy(id, status)')
      .eq('id', typeId)
      .single();
    if (tErr || !type) {
      return NextResponse.json({ error: 'Key type not found' }, { status: 404 });
    }
    const issued = ((type.key_copy ?? []) as Array<{ status: string }>).filter(
      (c) => c.status === 'issued'
    );
    if (issued.length > 0) {
      return NextResponse.json(
        { error: `${issued.length} copies still issued — return or mark them lost first` },
        { status: 409 }
      );
    }

    const { error } = await supabase.from('key_type').delete().eq('id', typeId);
    if (error) throw new Error(error.message);

    await appendKeyEvent(id, 'type_removed', { label: type.label }, session.actor);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/keys/:id/types/:typeId] delete error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete key type';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
