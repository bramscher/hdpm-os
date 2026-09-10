import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin, listReferrers, createReferrer } from '@/lib/referrals/admin';
import { isPartnerType } from '@/lib/referrals/types';

/** GET /api/partners/admin/referrers — list all referrers. */
export async function GET() {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ referrers: await listReferrers() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[referrals] list failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/partners/admin/referrers — create a referrer. */
export async function POST(request: NextRequest) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isPartnerType(body.type)) {
    return NextResponse.json(
      { error: 'type must be one of owner, agent, builder, vendor, other' },
      { status: 400 }
    );
  }
  const display_name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  if (!display_name) {
    return NextResponse.json({ error: 'display_name is required' }, { status: 400 });
  }

  try {
    const referrer = await createReferrer(
      {
        type: body.type,
        display_name,
        company: typeof body.company === 'string' ? body.company : null,
        email: typeof body.email === 'string' ? body.email : null,
        phone: typeof body.phone === 'string' ? body.phone : null,
        license_number: typeof body.license_number === 'string' ? body.license_number : null,
      },
      guard.email
    );
    return NextResponse.json({ referrer }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[referrals] create failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
