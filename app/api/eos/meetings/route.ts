import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { buildAgenda, defaultL10StartsAt } from '@/lib/eos/meeting';
import { weekStartPacific } from '@/lib/eos/scorecard';
import type { Meeting } from '@/lib/eos/types';

const KINDS: Meeting['kind'][] = ['L10', 'huddle', 'quarterly', 'annual', 'same_page'];

/**
 * POST /api/eos/meetings — create a meeting (Brief 2D). Staff session
 * required. Defaults: kind L10, this week's Monday slot, the caller as
 * facilitator only if none given (facilitator stays a human choice).
 *
 * Body: { kind?, startsAt?, facilitatorPerson? }
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { kind?: unknown; startsAt?: unknown; facilitatorPerson?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const kind =
    typeof body.kind === 'string' && (KINDS as string[]).includes(body.kind)
      ? (body.kind as Meeting['kind'])
      : 'L10';
  const startsAt =
    typeof body.startsAt === 'string' && !Number.isNaN(Date.parse(body.startsAt))
      ? new Date(body.startsAt).toISOString()
      : defaultL10StartsAt(weekStartPacific(new Date()));
  const facilitatorPerson =
    typeof body.facilitatorPerson === 'string' && body.facilitatorPerson
      ? body.facilitatorPerson
      : null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('meeting')
    .insert({
      kind,
      starts_at: startsAt,
      facilitator_person: facilitatorPerson,
      agenda: buildAgenda(kind),
    })
    .select('id')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logAudit('meeting', data.id, 'created', session.actor, { kind, starts_at: startsAt });
  return NextResponse.json({ ok: true, id: data.id });
}
