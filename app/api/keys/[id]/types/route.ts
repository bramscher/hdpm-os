import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { appendKeyEvent } from '@/lib/keys';
import type { KeyCopyTemplateEntry } from '@/types/keys';

/**
 * POST /api/keys/:id/types — add a key/lock type (e.g. Garage, Shed) to the
 * active assignment, optionally with initial copies.
 * Body: { label, copies?: [{holder_type, holder_name?, charged?}] }
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
    const body = (await request.json()) as { label?: string; copies?: KeyCopyTemplateEntry[] };
    const label = body.label?.trim();
    if (!label) {
      return NextResponse.json({ error: 'label is required' }, { status: 422 });
    }

    const supabase = getSupabaseAdmin();
    const { data: active, error: aErr } = await supabase
      .from('key_assignment')
      .select('id')
      .eq('key_slot_id', id)
      .is('released_at', null)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!active) {
      return NextResponse.json({ error: 'No active assignment' }, { status: 422 });
    }

    const { count } = await supabase
      .from('key_type')
      .select('id', { count: 'exact', head: true })
      .eq('assignment_id', active.id);

    const { data: typeRow, error: tErr } = await supabase
      .from('key_type')
      .insert({ assignment_id: active.id, label, sort_order: count ?? 0 })
      .select('id')
      .single();
    if (tErr || !typeRow) {
      if (tErr?.code === '23505') {
        return NextResponse.json({ error: `Key type '${label}' already exists` }, { status: 409 });
      }
      throw new Error(tErr?.message ?? 'Insert failed');
    }

    const copies = body.copies ?? [];
    if (copies.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const { error: cErr } = await supabase.from('key_copy').insert(
        copies.map((c) => ({
          key_type_id: typeRow.id,
          holder_type: c.holder_type,
          holder_name: c.holder_name ?? null,
          charged: c.charged ?? false,
          status: 'issued',
          issued_at: today,
        }))
      );
      if (cErr) throw new Error(cErr.message);
    }

    await appendKeyEvent(
      id,
      'type_added',
      { label, initial_copies: copies.length },
      session.actor,
      active.id
    );
    return NextResponse.json({ ok: true, key_type_id: typeRow.id });
  } catch (error) {
    console.error('[api/keys/:id/types] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to add key type';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
