import { NextRequest, NextResponse } from 'next/server';
import { runMorningCard } from '@/lib/agents/morning-card-run';

export const maxDuration = 300;

/**
 * POST /api/agents/cron/morning-card
 *
 * Weekday cron (14:30 UTC ≈ 7:30 AM PT in summer — UTC drift in winter is the
 * accepted repo-wide cron limitation). Sends Cheryl's Morning Action Card
 * (Slack, interactive) + Craig's read-only copy + the email mirror.
 *
 * Query flags:
 * - ?nudge=1  — 1 PM pass: one (and only one) nudge iff every card item is
 *               still untouched
 * - ?dryRun=1 — compute and return counts without writing/sending
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nudge = request.nextUrl.searchParams.get('nudge') === '1';
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  console.log(`[Agents] morning card cron${nudge ? ' (nudge)' : ''}${dryRun ? ' (dry run)' : ''}...`);

  try {
    const result = await runMorningCard({ nudge, dryRun });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] morning card cron failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
