import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { proposeReviewRequests } from '@/lib/review-requests-run';
import { buildReviewBatchCard, CARD_ROWS, pacificDate, REASON_LABELS, REVIEW_APPROVER } from '@/lib/review-requests';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { withCronRun } from '@/lib/cron/run';

export const maxDuration = 120;

const RECIPIENT = REVIEW_APPROVER;

async function handleGET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/reviews/cron/daily
 *
 * Weekday mornings: propose Google-review asks (tenants after a repair, 30
 * days after move-in, or at renewal; owners 90 days after management starts)
 * and DM Craig a card per 20 with Send / Skip / Send all. Nothing is emailed
 * until he taps (Slack rr:*). Silent when there's no one to ask.
 * ?dry_run=1 lists who would be proposed without saving or sending.
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

    const now = new Date();
    const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
    const { candidates, inserted } = await proposeReviewRequests(now, { dryRun });
    if (dryRun) {
      return NextResponse.json({
        dry_run: true,
        total: candidates.length,
        candidates: candidates.map((c) => ({
          who: `${c.name} (${c.audience})`,
          why: REASON_LABELS[c.reason],
          property: c.property,
          detail: c.detail,
        })),
      });
    }
    if (!inserted.length) {
      return NextResponse.json({ sent: false, reason: 'no one new to ask', considered: candidates.length });
    }

    const staff = await resolveStaffByPersonOrEmail(RECIPIENT);
    if (!staff?.slack_user_id) {
      return NextResponse.json({ sent: false, error: 'Craig has no slack_user_id in staff' }, { status: 500 });
    }

    const batchDate = pacificDate(now);
    const parts = Math.ceil(inserted.length / CARD_ROWS);
    for (let i = 0; i < parts; i++) {
      const card = buildReviewBatchCard(inserted.slice(i * CARD_ROWS, (i + 1) * CARD_ROWS), batchDate, {
        index: i + 1,
        total: parts,
      });
      await enqueueOutbox({
        channel: 'slack',
        recipient_person: RECIPIENT,
        recipient_address: staff.slack_user_id,
        subject: 'Review requests',
        body: card.text,
        payload: { blocks: card.blocks, batch_date: batchDate },
      });
    }
    const dispatch = await dispatchOutbox({ channel: 'slack', now });
    return NextResponse.json({ sent: true, proposed: inserted.length, dispatch });
  } catch (error) {
    console.error('[reviews/daily] error:', error);
    const message = error instanceof Error ? error.message : 'Review requests failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withCronRun(handleGET);
