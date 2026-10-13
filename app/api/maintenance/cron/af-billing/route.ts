import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { withCronRun } from '@/lib/cron/run';
import { reportsApiConfigured } from '@/lib/appfolio-reports';
import { syncAfWoBilling } from '@/lib/maintenance/af-wo-billing';

export const maxDuration = 300;

/**
 * GET /api/maintenance/cron/af-billing
 * Mirrors which work orders have an invoice uploaded or a bill entered in
 * AppFolio into wo_af_billing (lib/maintenance/af-wo-billing.ts). Runs a few
 * times a day; CRON_SECRET only.
 */
async function handleGET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!reportsApiConfigured()) return NextResponse.json({ skipped: 'Reports API not configured' });
  try {
    return NextResponse.json(await syncAfWoBilling(getSupabaseAdmin()));
  } catch (err) {
    console.error('[af-billing] sync failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 503 });
  }
}

export const GET = withCronRun(handleGET);
