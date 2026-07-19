import { NextRequest, NextResponse } from 'next/server';
import { runEstimateChaser } from '@/lib/agents/estimate-chaser-run';

export const maxDuration = 300;

/**
 * POST /api/agents/cron/estimate-chaser
 *
 * Weekday cron (13:45 UTC ≈ 6:45 AM PT in summer, 15 minutes after the
 * morning card so drafts are waiting when Cheryl starts at 7 — UTC drift in
 * winter is the accepted repo-wide cron limitation). Creates ready-to-send
 * bid-chase / owner-approval drafts in Cheryl's Outlook Drafts folder via
 * app-only Graph, and DMs Craig the 3×-chased / >45d escalations.
 *
 * Query flags:
 * - ?dryRun=1 — compute pool + decisions and return counts without writing
 *               proposals or touching the mailbox
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  console.log(`[Agents] estimate chaser cron${dryRun ? ' (dry run)' : ''}...`);

  try {
    const result = await runEstimateChaser({ dryRun });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] estimate chaser cron failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
