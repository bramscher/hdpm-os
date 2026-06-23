import { NextRequest, NextResponse } from 'next/server';
import { runZoomSync, previewZoomSync, ALL_CONTACT_TYPES } from '@/lib/zoom-sync';

export const maxDuration = 300;

/**
 * POST /api/sync/zoom-contacts
 *
 * Cron-triggered nightly AppFolio → Zoom Phone contact sync.
 * Lives under /api/sync (a public middleware prefix) and is protected by
 * CRON_SECRET rather than session auth — same pattern as the other syncs.
 *
 * ?dryRun=1 → read-only projection (no Zoom or DB writes); used to validate
 * AppFolio phone coverage before the first real run.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (new URL(request.url).searchParams.get('dryRun') === '1') {
    const preview = await previewZoomSync({ types: ALL_CONTACT_TYPES });
    return NextResponse.json(preview);
  }

  console.log('[Sync] Starting Zoom contact sync...');
  const result = await runZoomSync({ types: ALL_CONTACT_TYPES, triggeredBy: 'cron' });
  console.log(
    `[Sync] Zoom contact sync ${result.status}: ` +
      `+${result.created} created, ${result.updated} updated, ${result.failed} failed`
  );
  return NextResponse.json(result, { status: result.status === 'failed' ? 502 : 200 });
}
