import { NextRequest, NextResponse } from 'next/server';
import { runScorecardWeek } from '@/lib/eos/scorecard-run';
import { runRockWeek } from '@/lib/eos/rock-run';

export const maxDuration = 120;

/**
 * POST /api/eos/cron/scorecard — Friday scorecard pass (Brief 2B):
 * auto-fill entries from metrics_snapshot, nudge manual-metric owners,
 * file issues for metrics off-track two consecutive weeks. Also sends the
 * Friday Rock self-report cards (Brief 2E) — same Friday moment, one
 * consolidated card per Rock owner.
 * Scheduled 22:00 UTC Friday ≈ 3 PM PT (after the 13:30 metrics snapshot).
 *
 * Query flags: ?dryRun=1 — compute and return counts without writing.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  console.log(`[EOS] scorecard cron${dryRun ? ' (dry run)' : ''}...`);

  try {
    const result = await runScorecardWeek({ dryRun });
    const rocks = await runRockWeek({ dryRun });
    return NextResponse.json({ ...result, rocks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[EOS] scorecard cron failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
