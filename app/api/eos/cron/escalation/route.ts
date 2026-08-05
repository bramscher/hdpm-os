import { NextRequest, NextResponse } from 'next/server';
import { runEscalation } from '@/lib/eos/escalation-run';

export const maxDuration = 120;

/**
 * POST /api/eos/cron/escalation — daily escalation ladder (Brief 2C):
 * aged/recurring tripwire exceptions → issues, estimate-chaser escalations
 * → issues, past-due to-dos roll once (with the single Slack nudge) then
 * file an issue on the second miss. Scheduled 14:15 UTC weekdays, after
 * the 13:00 tripwire pass and the 13:45 estimate chaser.
 *
 * Query flags: ?dryRun=1 — compute and return counts without writing.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  console.log(`[EOS] escalation cron${dryRun ? ' (dry run)' : ''}...`);

  try {
    const result = await runEscalation({ dryRun });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[EOS] escalation cron failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
