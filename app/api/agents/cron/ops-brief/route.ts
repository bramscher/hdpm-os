import { NextRequest, NextResponse } from 'next/server';
import { runOpsBrief } from '@/lib/agents/ops-brief-run';

export const maxDuration = 300;

/**
 * POST /api/agents/cron/ops-brief
 *
 * Two crons hit this route (UTC; winter drift is the accepted repo-wide
 * limitation):
 * - 00:00 UTC Tue–Sat ≈ 5 PM PT Mon–Fri — the daily short brief
 * - 15:00 UTC Monday  ≈ 8 AM PT Monday  — ?deep=1, the Monday deep brief
 *
 * Slack-DMs Craig (interactive [Acknowledge] buttons) + Matt (read-only
 * copy). L3 self-reporting — one of the two sanctioned autonomous sends.
 *
 * Query flags:
 * - ?deep=1   — Monday deep sections (vendor movement, unbilled, baseline)
 * - ?dryRun=1 — gather + count without writing or sending
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const deep = request.nextUrl.searchParams.get('deep') === '1';
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  console.log(`[Agents] ops brief cron${deep ? ' (deep)' : ''}${dryRun ? ' (dry run)' : ''}...`);

  try {
    const result = await runOpsBrief({ deep, dryRun });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] ops brief cron failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
