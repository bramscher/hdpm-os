import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';

const SOURCES = ['meeting', 'issue', 'decision', 'agent', 'manual'] as const;

/**
 * POST /api/eos/todos — create a to-do from the Issues & To-Dos screen
 * (Brief 2C). Staff session required. Defaults: owner = the session's
 * staff person, due = DB default (today + 7).
 *
 * Body: { title: string, ownerPerson?: string, dueOn?: 'YYYY-MM-DD',
 *         source?: string, sourceId?: string }
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    title?: unknown;
    ownerPerson?: unknown;
    dueOn?: unknown;
    source?: unknown;
    sourceId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  let ownerPerson = typeof body.ownerPerson === 'string' && body.ownerPerson ? body.ownerPerson : null;
  if (!ownerPerson) {
    const self = await resolveStaffByPersonOrEmail(session.email);
    ownerPerson = self?.person ?? null;
  }
  const dueOn =
    typeof body.dueOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueOn) ? body.dueOn : null;
  const source =
    typeof body.source === 'string' && (SOURCES as readonly string[]).includes(body.source)
      ? body.source
      : 'manual';
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId : null;

  const insert: Record<string, unknown> = {
    title,
    owner_person: ownerPerson,
    source,
    source_id: sourceId,
  };
  if (dueOn) insert.due_on = dueOn; // otherwise the DB default (today + 7)

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('todo').insert(insert).select('id').single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logAudit('todo', data.id, 'created', session.actor, {
    title,
    owner_person: ownerPerson,
    due_on: dueOn,
    source,
  });
  return NextResponse.json({ ok: true, id: data.id });
}
