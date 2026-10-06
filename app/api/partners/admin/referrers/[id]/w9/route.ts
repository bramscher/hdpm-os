import { NextRequest, NextResponse } from 'next/server';
import { requireReferralTaxAdmin } from '@/lib/referrals/admin';
import { BountyActionError } from '@/lib/referrals/ledger';
import { markW9Verified, w9Link } from '@/lib/referrals/payouts-server';

/** GET — a 2-minute signed link to the referrer's W-9 (each view audited). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralTaxAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    return NextResponse.json({ url: await w9Link(id, guard.email) });
  } catch (err) {
    if (err instanceof BountyActionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** POST — mark the W-9 verified (admin checked it against the captured name + TIN). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralTaxAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    await markW9Verified(id, guard.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BountyActionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
