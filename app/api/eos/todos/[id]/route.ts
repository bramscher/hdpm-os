import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';

/**
 * PATCH /api/eos/todos/:id — complete/reopen/edit a to-do (Brief 2C).
 * Staff session required. Humans only set 'done'/'open' — 'missed' and
 * 'rolled' are the escalation cron's states.
 *
 * Body: { status?: 'done' | 'open', title?, dueOn?, ownerPerson? }
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

  let body: { status?: unknown; title?: unknown; dueOn?: unknown; ownerPerson?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (body.status !== 'done' && body.status !== 'open') {
      return NextResponse.json({ error: "status must be 'done' or 'open'" }, { status: 400 });
    }
    patch.status = body.status;
    patch.done_at = body.status === 'done' ? new Date().toISOString() : null;
  }
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
    if (!title) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    patch.title = title;
  }
  if (body.dueOn !== undefined) {
    if (typeof body.dueOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueOn)) {
      return NextResponse.json({ error: 'dueOn must be YYYY-MM-DD' }, { status: 400 });
    }
    patch.due_on = body.dueOn;
  }
  if (body.ownerPerson !== undefined) {
    patch.owner_person =
      typeof body.ownerPerson === 'string' && body.ownerPerson ? body.ownerPerson : null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: current, error: readErr } = await supabase
    .from('todo')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'To-do not found' }, { status: 404 });

  const { error } = await supabase.from('todo').update(patch).eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const eventType = patch.status === 'done' ? 'completed' : 'updated';
  await logAudit('todo', id, eventType, session.actor, { from_status: current.status, ...patch });
  return NextResponse.json({ ok: true });
}
