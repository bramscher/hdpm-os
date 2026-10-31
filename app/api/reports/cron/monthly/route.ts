import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { buildMonthlyReport, gatherMonthlyReport } from '@/lib/monthly-report';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { withCronRun } from '@/lib/cron/run';

export const maxDuration = 60;

const RECIPIENT = 'Craig';

async function handleGET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/reports/cron/monthly
 *
 * 1st of the month: Slack DM to Craig with last month's growth report (owner
 * leads and stages, doors, leasing, main line). ?dry_run=1 returns the report
 * without sending.
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

    const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
    const now = new Date();
    const data = await gatherMonthlyReport(getSupabaseAdmin(), now);
    const report = buildMonthlyReport(data);

    if (dryRun) {
      return NextResponse.json({ sent: false, dry_run: true, data, text: report.text });
    }

    const staff = await resolveStaffByPersonOrEmail(RECIPIENT);
    if (!staff?.slack_user_id) {
      return NextResponse.json({ sent: false, error: 'Craig has no slack_user_id in staff' }, { status: 500 });
    }
    await enqueueOutbox({
      channel: 'slack',
      recipient_person: RECIPIENT,
      recipient_address: staff.slack_user_id,
      subject: `Growth report — ${data.window.label}`,
      body: report.text,
      payload: { blocks: report.blocks, report_month: data.window.startDate },
    });
    const dispatch = await dispatchOutbox({ channel: 'slack', now });
    return NextResponse.json({ sent: true, month: data.window.label, dispatch });
  } catch (error) {
    console.error('[reports/monthly] error:', error);
    const message = error instanceof Error ? error.message : 'Monthly report failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withCronRun(handleGET);
