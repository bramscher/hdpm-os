import { NextRequest, NextResponse } from 'next/server';
import { withCronRun, isCronRequest } from '@/lib/cron/run';
import { runSnapshot } from '@/lib/brain/viz-server';

export const maxDuration = 300;

/**
 * GET /api/brain/cron/snapshot — nightly brain map build (after the 3 AM
 * Knowledge Nightly Review). Writes brain-viz/snapshot.json for /brain.
 * Auth: CRON_SECRET bearer. Returns { skipped } until the brain_viz
 * migration is applied, so the run log shows amber instead of red.
 */
async function handleGET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runSnapshot());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[brain-viz] snapshot failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = withCronRun(handleGET);
