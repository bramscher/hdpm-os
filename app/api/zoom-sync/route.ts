import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/require-admin';
import { getLastRun, getRecentRuns, getContactSummary } from '@/lib/zoom-sync';
import { isZoomConfigured } from '@/lib/zoom-phone';

/**
 * GET /api/zoom-sync — status for the admin page: last run, recent runs,
 * per-type contact counts, and whether Zoom creds are present.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const [lastRun, recentRuns, summary] = await Promise.all([
      getLastRun(),
      getRecentRuns(10),
      getContactSummary(),
    ]);
    return NextResponse.json({
      configured: isZoomConfigured(),
      appfolioConfigured: Boolean(process.env.APPFOLIO_CLIENT_ID),
      lastRun,
      recentRuns,
      summary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load status' },
      { status: 500 }
    );
  }
}
