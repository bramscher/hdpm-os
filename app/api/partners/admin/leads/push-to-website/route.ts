import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { pushUnlinkedReferrals } from '@/lib/referrals/web-push';

/**
 * POST /api/partners/admin/leads/push-to-website[?confirm=1][&limit=200]
 *
 * Backfill and retry for "one pipeline": pushes every referral that has no
 * website lead yet into the website's owner Leads. Without confirm=1 it is a
 * dry run that only counts. Admins only; Craig runs the real backfill once
 * after the website side is live. Safe to repeat: the website upserts by
 * referral id, and linked referrals are skipped.
 */
export async function POST(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const confirm = request.nextUrl.searchParams.get('confirm') === '1';
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 200);
  try {
    const report = await pushUnlinkedReferrals(guard.email, { dryRun: !confirm, limit: Number.isFinite(limit) ? limit : 200 });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
