import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import type { IssueStatus } from '@/lib/eos/types';

const STATUSES: IssueStatus[] = ['open', 'discussed', 'solved', 'parked'];

/**
 * PATCH /api/eos/issues/:id — edit an issue from the 2C screen. Staff
 * session required; humans only — agents and crons never touch existing
 * issues. Solving is NOT allowed here: IDS solve forces a structured
 * outcome via POST /api/eos/issues/:id/solve (Brief 2D, doc 06 §4).
 *
 * Body: { status?, priority?, title?, detail? }
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

  let body: {
    status?: unknown;
    priority?: unknown;
    title?: unknown;
    detail?: unknown;
    confirm?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !STATUSES.includes(body.status as IssueStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    if (body.status === 'solved') {
      return NextResponse.json(
        { error: 'Solving requires an outcome — use the Solve dialog.' },
        { status: 400 }
      );
    }
    patch.status = body.status;
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== 'number' || body.priority < 1 || body.priority > 5) {
      return NextResponse.json({ error: 'priority must be 1-5' }, { status: 400 });
    }
    patch.priority = Math.round(body.priority);
  }
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
    if (!title) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    patch.title = title;
  }
  if (body.detail !== undefined) {
    patch.detail = typeof body.detail === 'string' ? body.detail.slice(0, 4000) : null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const supabase = getSupabaseAdmin();
  const { data: current, error: readErr } = await supabase
    .from('issue')
    .select('id, status, priority')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });

  const { error } = await supabase.from('issue').update(patch).eq('id', id);
  if (error) {
    // Reopening can collide with a newer open issue on the same source_ref.
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json(
        { error: 'There is already an open issue for this item — leave this one closed.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const eventType = patch.status && patch.status !== current.status ? 'status_changed' : 'updated';
  await logAudit('issue', id, eventType, session.actor, {
    from_status: current.status,
    ...patch,
  });
  return NextResponse.json({ ok: true });
}
