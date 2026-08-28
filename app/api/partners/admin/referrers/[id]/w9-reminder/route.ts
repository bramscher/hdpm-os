import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin, getReferrer } from '@/lib/referrals/admin';
import { notifyW9Missing } from '@/lib/referrals/notify';

/**
 * POST /api/partners/admin/referrers/:id/w9-reminder — email the referrer a
 * reminder to upload their W-9. Logged in referral_notification_log.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const partner = await getReferrer(id);
    if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!partner.email) return NextResponse.json({ error: 'Referrer has no email on file' }, { status: 400 });
    await notifyW9Missing({ id: partner.id, display_name: partner.display_name, email: partner.email });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
