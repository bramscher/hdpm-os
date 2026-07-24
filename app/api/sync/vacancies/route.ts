import { NextRequest, NextResponse } from 'next/server';
import { syncVacancies } from '@/lib/vacancy-sync';

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/sync/vacancies
 *
 * Morning refresh of the Craigslist vacancy cache (cached_vacancies) so the
 * unit list is current when staff arrive — previously the cache only updated
 * when someone clicked "Sync from AppFolio". Protected by CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await syncVacancies();
    console.log(`[Sync] Vacancies: ${result.total} cached, ${result.removed} removed`);
    return NextResponse.json({
      message: 'Vacancy sync complete',
      synced: result.total,
      removed: result.removed,
    });
  } catch (error) {
    console.error('[Sync] Vacancy sync error:', error);
    const message = error instanceof Error ? error.message : 'Vacancy sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
