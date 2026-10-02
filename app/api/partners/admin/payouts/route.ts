import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin } from '@/lib/referrals/admin';
import { BountyActionError } from '@/lib/referrals/ledger';
import { getPayoutsOverview, payBatch } from '@/lib/referrals/payouts-server';

/** GET — approved, unpaid bounties + past payment batches. */
export async function GET() {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(await getPayoutsOverview());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** POST { leadIds: string[], reference } — mark the selected bounties paid as one batch. */
export async function POST(request: NextRequest) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  let body: { leadIds?: unknown; reference?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];
  if (leadIds.length === 0) return NextResponse.json({ error: 'Select at least one bounty' }, { status: 400 });
  try {
    return NextResponse.json(await payBatch(leadIds, typeof body.reference === 'string' ? body.reference : '', guard.email));
  } catch (err) {
    if (err instanceof BountyActionError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
