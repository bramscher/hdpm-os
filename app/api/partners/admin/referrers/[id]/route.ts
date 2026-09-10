import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin, getReferrer, setReferrerStatus } from '@/lib/referrals/admin';

const SETTABLE = ['active', 'paused', 'terminated'] as const;

/** GET /api/partners/admin/referrers/:id */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const referrer = await getReferrer(id);
    if (!referrer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ referrer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** PATCH /api/partners/admin/referrers/:id — { status } (active|paused|terminated). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!SETTABLE.includes(body.status as (typeof SETTABLE)[number])) {
    return NextResponse.json(
      { error: `status must be one of ${SETTABLE.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const { id } = await params;
    const referrer = await setReferrerStatus(id, body.status as (typeof SETTABLE)[number], guard.email);
    return NextResponse.json({ referrer });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[referrals] status update failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
