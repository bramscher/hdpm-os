import { NextRequest, NextResponse } from 'next/server';
import { evolve } from '@/lib/brain/evolve';

export const maxDuration = 300;

/**
 * POST /api/brain/cron/evolve — nightly brain consolidation ("dream cycle",
 * Brief 1C): dedup, contradiction flagging, clarification questions, salience
 * decay. Scheduled 10:00 UTC ≈ 3 AM PT in summer (UTC drift in winter is the
 * accepted repo-wide cron limitation).
 *
 * Query flags:
 * - ?dryRun=1 — compute and return the report without writing anything
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  console.log(`[brain] evolve cron${dryRun ? ' (dry run)' : ''}...`);

  try {
    const report = await evolve({ dryRun });
    return NextResponse.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[brain] evolve cron failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
