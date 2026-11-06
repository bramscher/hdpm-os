import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { pushUnlinkedReferrals } from '@/lib/referrals/web-push';

/**
 * POST /api/partners/admin/leads/push-to-website[?confirm=1][&limit=200][&after=<cursor>]
 *
 * Backfill and retry for "one pipeline": pushes referrals still being worked
 * (submitted / contacted / qualified) that have an email and no website lead
 * into the website's owner Leads, one batch at a time. Repeat with
 * &after=<nextCursor> until nextCursor is null. Without confirm=1 it is a dry
 * run that only counts. Admins only; Craig runs the real backfill once
 * after the website side is live. Safe to repeat: the website upserts by
 * referral id, and linked referrals are skipped.
 */
export async function POST(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const confirm = request.nextUrl.searchParams.get('confirm') === '1';
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 200);
  try {
    const after = request.nextUrl.searchParams.get('after');
    const report = await pushUnlinkedReferrals(guard.email, { dryRun: !confirm, limit: Number.isFinite(limit) ? limit : 200, after });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
