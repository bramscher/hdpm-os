import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { isAgentActor } from '@/lib/agents/actor';
import { decideProposal } from '@/lib/agents/proposals';

const DECISIONS = ['approved', 'edited', 'rejected'] as const;

/**
 * POST /api/agents/proposals/:id/decide — {decision, payload?}
 *
 * Decisions always require a HUMAN actor: a staff session, or a service call
 * whose X-Agent-Actor resolved to a staff row. 'agent:*' actors are refused —
 * agents never approve their own proposals.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = await requireStaffOrService(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (isAgentActor(caller.actor)) {
    return NextResponse.json({ error: 'Decisions require a human actor' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    if (!DECISIONS.includes(body.decision)) {
      return NextResponse.json(
        { error: `decision must be one of: ${DECISIONS.join(', ')}` },
        { status: 400 }
      );
    }

    const proposal = await decideProposal(id, body.decision, caller.actor, body.payload);
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found or already decided' }, { status: 409 });
    }
    return NextResponse.json({ proposal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] proposal decide failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
