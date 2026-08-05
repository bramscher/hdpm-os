import { NextRequest, NextResponse } from 'next/server';
import { runMeetingPrep } from '@/lib/eos/meeting-prep-run';

export const maxDuration = 120;

/**
 * POST /api/eos/cron/meeting-prep — Monday prep packet (Brief 2D):
 * ensure this week's L10 meeting exists, build the packet (scorecard
 * deltas, aged issues, to-do done rate, brain context with citations)
 * into meeting.prep_packet_md, DM the facilitator the link.
 * Scheduled 14:30 UTC Monday ≈ 7:30 AM PT, before the meeting.
 *
 * Query flags: ?dryRun=1 — build and return counts without writing.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  console.log(`[EOS] meeting-prep cron${dryRun ? ' (dry run)' : ''}...`);

  try {
    const result = await runMeetingPrep({ dryRun });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[EOS] meeting-prep cron failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
