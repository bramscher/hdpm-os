import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';

/**
 * POST /api/eos/issues — file an issue from the app (Brief 2B: the
 * Scorecard's [Drop to Issues]; grows into the 2C surface). Staff session
 * required. Open issues dedupe on source_ref at the database level.
 *
 * Body: { title: string, detail?: string, sourceRef?: string, priority?: number }
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { title?: unknown; detail?: unknown; sourceRef?: unknown; priority?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 4000) : null;
  const sourceRef = typeof body.sourceRef === 'string' ? body.sourceRef : null;
  const priority =
    typeof body.priority === 'number' && body.priority >= 1 && body.priority <= 5
      ? Math.round(body.priority)
      : 3;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('issue')
    .insert({ title, detail, raised_by: session.actor, source_ref: sourceRef, priority })
    .select('id')
    .single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json(
        { error: 'There is already an open issue for this item.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logAudit('issue', data.id, 'created', session.actor, { title, source_ref: sourceRef });
  return NextResponse.json({ ok: true, id: data.id });
}
