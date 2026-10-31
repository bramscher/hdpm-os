import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildOwnerNudge, type UntouchedOwnerLead } from '@/lib/agents/owner-lead-slack';
import { webAdminFetch } from '@/lib/hdpm-web-admin';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { withCronRun } from '@/lib/cron/run';

export const maxDuration = 60;

const RECIPIENT = 'Craig';

async function handleGET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/reports/cron/owner-leads
 *
 * Weekday mornings: Slack DM to Craig listing website owner leads still at
 * New. Sends nothing when there are none. ?dry_run=1 returns it without sending.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      const session = await auth();
      if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const res = await webAdminFetch('/leads?view=new&type=owner', 'craig@highdesertpm.com');
    if (!res.ok) {
      return NextResponse.json({ error: `Website leads unavailable (${res.status})` }, { status: 502 });
    }
    const { leads, totalDocs } = (await res.json()) as { leads: UntouchedOwnerLead[]; totalDocs: number };
    if (!totalDocs) {
      return NextResponse.json({ sent: false, reason: 'no owner leads at New' });
    }

    const now = new Date();
    const nudge = buildOwnerNudge(leads, totalDocs, now);
    if (new URL(request.url).searchParams.get('dry_run') === '1') {
      return NextResponse.json({ sent: false, dry_run: true, total: totalDocs, text: nudge.text });
    }

    const staff = await resolveStaffByPersonOrEmail(RECIPIENT);
    if (!staff?.slack_user_id) {
      return NextResponse.json({ sent: false, error: 'Craig has no slack_user_id in staff' }, { status: 500 });
    }
    await enqueueOutbox({
      channel: 'slack',
      recipient_person: RECIPIENT,
      recipient_address: staff.slack_user_id,
      subject: 'Owner leads at New',
      body: nudge.text,
      payload: { blocks: nudge.blocks, nudge_date: now.toISOString().slice(0, 10) },
    });
    const dispatch = await dispatchOutbox({ channel: 'slack', now });
    return NextResponse.json({ sent: true, total: totalDocs, dispatch });
  } catch (error) {
    console.error('[reports/owner-leads] error:', error);
    const message = error instanceof Error ? error.message : 'Owner lead nudge failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withCronRun(handleGET);
