import { NextRequest, NextResponse } from 'next/server';
import { verifyServiceToken, bearerFromHeader } from '@/lib/service-tokens';
import { buildOwnerLeadCard, type OwnerLeadCardLead } from '@/lib/agents/owner-lead-slack';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';

export const maxDuration = 30;

const RECIPIENT = 'Craig';

/**
 * POST /api/intake/owner-lead
 *
 * Called by hdpm-web when a new owner lead is created. DMs Craig a card with
 * stage buttons (handled in /api/agents/slack/interact, `ol:*`).
 *
 * Auth: Bearer token with 'intake' scope (lib/service-tokens.ts).
 */
export async function POST(req: NextRequest) {
  const identity = await verifyServiceToken(bearerFromHeader(req.headers.get('authorization')), 'intake');
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let lead: OwnerLeadCardLead;
  try {
    lead = (await req.json()) as OwnerLeadCardLead;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Number.isSafeInteger(lead?.id) || !lead.name || !Array.isArray(lead.allowedStatuses)) {
    return NextResponse.json({ error: 'id, name and allowedStatuses are required' }, { status: 400 });
  }

  const staff = await resolveStaffByPersonOrEmail(RECIPIENT);
  if (!staff?.slack_user_id) {
    return NextResponse.json({ error: 'Craig has no slack_user_id in staff' }, { status: 500 });
  }

  const card = buildOwnerLeadCard(lead);
  await enqueueOutbox({
    channel: 'slack',
    recipient_person: RECIPIENT,
    recipient_address: staff.slack_user_id,
    subject: 'New owner lead',
    body: card.text,
    payload: { blocks: card.blocks, lead_id: lead.id },
  });
  const dispatch = await dispatchOutbox({ channel: 'slack', now: new Date() });
  return NextResponse.json({ sent: true, dispatch });
}
