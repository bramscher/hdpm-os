import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { currentQuarter } from '@/lib/eos/rock';

/**
 * POST /api/eos/rocks — create a Rock (Brief 2E). Staff session required.
 * Rocks are properly set in the quarterly meeting; until that flow ships
 * (Phase 2.5) this is the entry surface. Quarter defaults to the current
 * one.
 *
 * Body: { title: string, ownerPerson?: string, quarter?: '2026-Q3',
 *         dueOn?: 'YYYY-MM-DD', notes?: string }
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { title?: unknown; ownerPerson?: unknown; quarter?: unknown; dueOn?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  const quarter =
    typeof body.quarter === 'string' && /^\d{4}-Q[1-4]$/.test(body.quarter)
      ? body.quarter
      : currentQuarter(new Date());
  const ownerPerson =
    typeof body.ownerPerson === 'string' && body.ownerPerson ? body.ownerPerson : null;
  const dueOn =
    typeof body.dueOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueOn) ? body.dueOn : null;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('rock')
    .insert({ title, owner_person: ownerPerson, quarter, due_on: dueOn, notes })
    .select('id')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logAudit('rock', data.id, 'created', session.actor, {
    title,
    owner_person: ownerPerson,
    quarter,
  });
  return NextResponse.json({ ok: true, id: data.id });
}
