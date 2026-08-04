import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { runCandidateSync } from '@/lib/inspection-candidates';
import { batchGeocodeProperties } from '@/lib/inspection-geocode';

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/inspections/candidates/sync
 *
 * Pulls AppFolio properties + units + tenants, classifies each occupied unit
 * into skip_recent / defer / eligible based on the move-in-anchored due date
 * (max(move_in, last_inspection) + 6 months), and upserts one row per unit into
 * inspection_properties.
 *
 * Auth: CRON_SECRET bearer OR @highdesertpm.com session.
 *
 * Query params:
 *   ?dry_run=1   — classify and return counts without persisting
 *   ?geocode=1   — also kick off geocoding for newly-inserted rows (default: on
 *                  unless dry_run)
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dry_run') === '1';
    const skipGeocode = searchParams.get('geocode') === '0';

    const supabase = getSupabaseAdmin();
    const result = await runCandidateSync(supabase, { dryRun });

    let geocodeResult: { success: number; failed: number } | null = null;
    if (!dryRun && !skipGeocode && result.geocode_pending > 0) {
      try {
        const geo = await batchGeocodeProperties();
        geocodeResult = { success: geo.success, failed: geo.failed };
      } catch (err) {
        console.error('[candidates/sync] geocode step failed:', err);
      }
    }

    return NextResponse.json({
      ...result,
      geocodeResult,
    });
  } catch (error) {
    console.error('[candidates/sync] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync candidates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
