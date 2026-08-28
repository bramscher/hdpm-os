import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin, getFeePolicies, setFeePolicyAllowed } from '@/lib/referrals/admin';
import { isFeeKind, isPartnerType } from '@/lib/referrals/types';

/** GET /api/partners/admin/fee-policy — the eligibility matrix. */
export async function GET() {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ policies: await getFeePolicies() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/partners/admin/fee-policy — flip an eligibility switch.
 * Body: { partner_type, fee_kind, allowed }. This is the attorney-gated action:
 * turning `allowed` true asserts counsel has confirmed the combination is legal.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;

  let body: { partner_type?: unknown; fee_kind?: unknown; allowed?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isPartnerType(body.partner_type)) {
    return NextResponse.json({ error: 'invalid partner_type' }, { status: 400 });
  }
  if (!isFeeKind(body.fee_kind)) {
    return NextResponse.json({ error: 'invalid fee_kind' }, { status: 400 });
  }
  if (typeof body.allowed !== 'boolean') {
    return NextResponse.json({ error: 'allowed must be a boolean' }, { status: 400 });
  }

  try {
    await setFeePolicyAllowed(body.partner_type, body.fee_kind, body.allowed, guard.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[referrals] fee-policy update failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
