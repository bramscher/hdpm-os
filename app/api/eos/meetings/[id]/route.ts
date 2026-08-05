import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';

/**
 * PATCH /api/eos/meetings/:id — edit meeting details (Brief 2D). Staff
 * session required. Minutes/rating land via POST :id/conclude; this route
 * covers schedule and facilitator tweaks (and minutes edits after the
 * fact).
 *
 * Body: { startsAt?, facilitatorPerson?, minutesMd?, rating? }
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

  let body: { startsAt?: unknown; facilitatorPerson?: unknown; minutesMd?: unknown; rating?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.startsAt !== undefined) {
    if (typeof body.startsAt !== 'string' || Number.isNaN(Date.parse(body.startsAt))) {
      return NextResponse.json({ error: 'startsAt must be an ISO datetime' }, { status: 400 });
    }
    patch.starts_at = new Date(body.startsAt).toISOString();
  }
  if (body.facilitatorPerson !== undefined) {
    patch.facilitator_person =
      typeof body.facilitatorPerson === 'string' && body.facilitatorPerson
        ? body.facilitatorPerson
        : null;
  }
  if (body.minutesMd !== undefined) {
    patch.minutes_md = typeof body.minutesMd === 'string' ? body.minutesMd.slice(0, 50_000) : null;
  }
  if (body.rating !== undefined) {
    if (typeof body.rating !== 'number' || body.rating < 1 || body.rating > 10) {
      return NextResponse.json({ error: 'rating must be 1-10' }, { status: 400 });
    }
    patch.rating = Math.round(body.rating);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: current, error: readErr } = await supabase
    .from('meeting')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });

  const { error } = await supabase.from('meeting').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAudit('meeting', id, 'updated', session.actor, patch);
  return NextResponse.json({ ok: true });
}
