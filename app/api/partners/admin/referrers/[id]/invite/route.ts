import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin } from '@/lib/referrals/admin';
import { createInvite } from '@/lib/referrals/invites';

/**
 * POST /api/partners/admin/referrers/:id/invite — mint an onboarding link the
 * admin delivers themselves (no email sent). Returns { url, expires_at }.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const origin = new URL(request.url).origin;
    const invite = await createInvite(id, guard.email, origin);
    return NextResponse.json({ url: invite.url, email: invite.email, expires_at: invite.expires_at });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[referrals] invite failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
