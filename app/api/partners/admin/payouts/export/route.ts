import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin } from '@/lib/referrals/admin';
import { pacificDate, quickbooksCsv } from '@/lib/referrals/payouts';
import { payableRows } from '@/lib/referrals/payouts-server';

export const dynamic = 'force-dynamic';

/** GET ?ids=a,b,c&ref=… — QuickBooks import CSV for the selected approved bounties. No tax IDs. */
export async function GET(request: NextRequest) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  const ids = (request.nextUrl.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return NextResponse.json({ error: 'Select at least one bounty' }, { status: 400 });
  const ref = (request.nextUrl.searchParams.get('ref') ?? '').trim().slice(0, 60) || 'Referral bounties';
  const rows = await payableRows(ids);
  const date = pacificDate(new Date());
  return new Response(quickbooksCsv(rows, date, ref), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="referral-bounties-${date}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
