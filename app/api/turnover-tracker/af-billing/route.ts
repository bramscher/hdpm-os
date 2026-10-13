import { NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { reportsApiConfigured } from '@/lib/appfolio-reports';
import { syncAfWoBilling } from '@/lib/maintenance/af-wo-billing';

export const maxDuration = 300;

/**
 * POST /api/turnover-tracker/af-billing — check AppFolio now for uploaded
 * invoices and entered bills (the same sync the cron runs three times a day).
 */
export async function POST() {
  const guard = await requireSection('brody_turnover');
  if (!guard.ok) return guard.response;
  if (!reportsApiConfigured()) return NextResponse.json({ error: 'The AppFolio Reports API is not set up' }, { status: 503 });
  try {
    return NextResponse.json(await syncAfWoBilling(getSupabaseAdmin()));
  } catch (err) {
    console.error('[turnover] AppFolio invoice check failed:', err);
    return NextResponse.json({ error: 'Could not reach AppFolio. Try again in a minute.' }, { status: 502 });
  }
}
