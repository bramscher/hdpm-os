import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildHavenDigest } from '@/lib/haven-digest';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';

export const maxDuration = 60;

// Same recipients as the other agent flags (rerouted from Craig 2026-07-23).
const RECIPIENTS = ['Brody', 'Matt'] as const;

export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/haven/cron/digest
 *
 * Daily weekday Slack DM: new Haven escalations, hot leads going cold,
 * pending follow-ups. Runs after /api/haven/sync. Sends nothing on a quiet
 * day. ?dry_run=1 returns the digest without sending.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
    const now = new Date();
    const supabase = getSupabaseAdmin();
    const digest = await buildHavenDigest(supabase, now);

    if (!digest.shouldSend) {
      return NextResponse.json({ sent: false, reason: 'quiet day', counts: digest.counts });
    }
    if (dryRun) {
      return NextResponse.json({ sent: false, dry_run: true, ...digest });
    }

    const staffRows = await Promise.all(RECIPIENTS.map((p) => resolveStaffByPersonOrEmail(p)));
    const outboxIds: string[] = [];
    for (let i = 0; i < RECIPIENTS.length; i++) {
      const staff = staffRows[i];
      if (!staff?.slack_user_id) continue;
      const row = await enqueueOutbox({
        channel: 'slack',
        recipient_person: RECIPIENTS[i],
        recipient_address: staff.slack_user_id,
        subject: 'Haven leasing digest',
        body: digest.text,
        payload: { blocks: digest.blocks, digest_date: now.toISOString().slice(0, 10) },
      });
      outboxIds.push(row.id);
    }

    if (outboxIds.length === 0) {
      return NextResponse.json(
        { sent: false, error: 'Brody/Matt have no slack_user_id in staff', counts: digest.counts },
        { status: 500 }
      );
    }

    const dispatch = await dispatchOutbox({ channel: 'slack', now });
    return NextResponse.json({ sent: true, recipients: outboxIds.length, counts: digest.counts, dispatch });
  } catch (error) {
    console.error('[haven/digest] error:', error);
    const message = error instanceof Error ? error.message : 'Digest failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
