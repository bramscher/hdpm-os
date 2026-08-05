import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { ROCK_STATUSES } from '@/lib/eos/rock';

/**
 * PATCH /api/eos/rocks/:id — update a Rock (Brief 2E): status on/off/
 * done/dropped, title, owner, due date, notes. Staff session required —
 * humans rate Rocks, agents never do (doc 06 §9).
 *
 * Body: { status?, title?, ownerPerson?, dueOn?, notes? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let body: { status?: unknown; title?: unknown; ownerPerson?: unknown; dueOn?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (
      typeof body.status !== 'string' ||
      !(ROCK_STATUSES as readonly string[]).includes(body.status)
    ) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
    if (!title) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    patch.title = title;
  }
  if (body.ownerPerson !== undefined) {
    patch.owner_person =
      typeof body.ownerPerson === 'string' && body.ownerPerson ? body.ownerPerson : null;
  }
  if (body.dueOn !== undefined) {
    if (body.dueOn !== null && (typeof body.dueOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueOn))) {
      return NextResponse.json({ error: 'dueOn must be YYYY-MM-DD or null' }, { status: 400 });
    }
    patch.due_on = body.dueOn;
  }
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: current, error: readErr } = await supabase
    .from('rock')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Rock not found' }, { status: 404 });

  const { error } = await supabase.from('rock').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const eventType = patch.status && patch.status !== current.status ? 'status_changed' : 'updated';
  await logAudit('rock', id, eventType, session.actor, { from_status: current.status, ...patch });
  return NextResponse.json({ ok: true });
}
