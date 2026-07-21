import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { appendKeyEvent, getKeyDetail } from '@/lib/keys';

/**
 * GET /api/keys/:id — full key record: slot, active assignment with types
 * and copies, past tenures, and the append-only event feed.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const detail = await getKeyDetail(id);
    if (!detail) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error('[api/keys/:id] get error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load key';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/keys/:id — whitelisted edits only. Slot: notes. Active
 * assignment: appfolio_unit_id (the link-unlinked flow, snapshot fields
 * come along), assigned_at (date correction). Everything else must go
 * through /transition so history stays truthful.
 */
const SLOT_PATCHABLE = new Set(['notes']);
const ASSIGNMENT_PATCHABLE = new Set([
  'appfolio_unit_id',
  'appfolio_property_id',
  'property_name',
  'address_1',
  'address_2',
  'city',
  'state',
  'zip',
  'owner_name',
  'assigned_at',
]);

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
    const body = (await request.json()) as {
      slot?: Record<string, unknown>;
      assignment?: Record<string, unknown>;
    };
    const supabase = getSupabaseAdmin();

    const badSlotFields = Object.keys(body.slot ?? {}).filter((k) => !SLOT_PATCHABLE.has(k));
    const badAssignmentFields = Object.keys(body.assignment ?? {}).filter(
      (k) => !ASSIGNMENT_PATCHABLE.has(k)
    );
    if (badSlotFields.length > 0 || badAssignmentFields.length > 0) {
      return NextResponse.json(
        { error: `Fields not patchable: ${[...badSlotFields, ...badAssignmentFields].join(', ')}` },
        { status: 422 }
      );
    }

    if (body.slot && Object.keys(body.slot).length > 0) {
      const { error } = await supabase.from('key_slot').update(body.slot).eq('id', id);
      if (error) throw new Error(error.message);
    }

    if (body.assignment && Object.keys(body.assignment).length > 0) {
      const { data: active, error: aErr } = await supabase
        .from('key_assignment')
        .select('id')
        .eq('key_slot_id', id)
        .is('released_at', null)
        .maybeSingle();
      if (aErr) throw new Error(aErr.message);
      if (!active) {
        return NextResponse.json({ error: 'No active assignment to edit' }, { status: 422 });
      }
      const { error } = await supabase
        .from('key_assignment')
        .update(body.assignment)
        .eq('id', active.id);
      if (error) throw new Error(error.message);
      await appendKeyEvent(id, 'edited', { fields: body.assignment }, session.actor, active.id);
    }

    const detail = await getKeyDetail(id);
    return NextResponse.json(detail);
  } catch (error) {
    console.error('[api/keys/:id] patch error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update key';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
