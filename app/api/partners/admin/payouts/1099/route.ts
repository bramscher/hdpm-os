import { NextRequest, NextResponse } from 'next/server';
import { requireReferralTaxAdmin } from '@/lib/referrals/admin';
import { getTaxYear, taxWorksheet } from '@/lib/referrals/payouts-server';

export const dynamic = 'force-dynamic';

const yearParam = (request: NextRequest) => {
  const y = Number(request.nextUrl.searchParams.get('year'));
  return Number.isInteger(y) && y >= 2024 && y <= 2100 ? y : null;
};

/**
 * GET ?year=2026                       → JSON totals + readiness
 * GET ?year=2026&format=xlsx[&tins=1]  → 1099 worksheet; tins=1 decrypts tax IDs (audited per referrer)
 */
export async function GET(request: NextRequest) {
  const guard = await requireReferralTaxAdmin();
  if (!guard.ok) return guard.response;
  const year = yearParam(request);
  if (!year) return NextResponse.json({ error: 'year must be a 4-digit year' }, { status: 400 });
  try {
    if (request.nextUrl.searchParams.get('format') !== 'xlsx') return NextResponse.json(await getTaxYear(year));
    const includeTins = request.nextUrl.searchParams.get('tins') === '1';
    const bytes = await taxWorksheet(year, includeTins, guard.email);
    return new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="referral-1099-${year}${includeTins ? '-with-tins' : ''}.xlsx"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
