import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin, setReferrerTerms } from '@/lib/referrals/admin';
import { FeeNotAllowedError } from '@/lib/referrals/fee-policy';
import { isFeeKind } from '@/lib/referrals/types';

/**
 * POST /api/partners/admin/referrers/:id/terms — set a referrer's default fee
 * terms for a fee kind. GATED on referral_fee_policy.allowed: a disallowed
 * (type, kind) returns 422 with the eligibility explanation (not a 500).
 *
 * Body: { fee_kind, bounty_mode?, bounty_amount?, bounty_trigger?, trailing_pct?, trailing_months? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isFeeKind(body.fee_kind)) {
    return NextResponse.json(
      { error: 'fee_kind must be one_time_bounty or trailing' },
      { status: 400 }
    );
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  try {
    const { id } = await params;
    await setReferrerTerms(
      id,
      {
        fee_kind: body.fee_kind,
        bounty_mode: typeof body.bounty_mode === 'string' ? body.bounty_mode : null,
        bounty_amount: num(body.bounty_amount),
        bounty_trigger: typeof body.bounty_trigger === 'string' ? body.bounty_trigger : null,
        trailing_pct: num(body.trailing_pct),
        trailing_months: num(body.trailing_months),
      },
      guard.email
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof FeeNotAllowedError) {
      // Eligibility block — expected, not a server error.
      return NextResponse.json(
        { error: err.message, code: 'fee_not_allowed' },
        { status: 422 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[referrals] set terms failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
