import { NextRequest, NextResponse } from 'next/server';
import { requireReferralAdmin, getReferrer } from '@/lib/referrals/admin';
import { createInvite } from '@/lib/referrals/invites';
import { notifyInvite } from '@/lib/referrals/notify';

/**
 * POST /api/partners/admin/referrers/:id/invite — mint an onboarding invite.
 * Body: { deliver?: 'email' | 'link' } (default 'link').
 *   - 'link'  → returns { url } for the admin to copy/send themselves.
 *   - 'email' → emails the invite to the referrer; returns { sent, status } so
 *               the UI can confirm delivery or fall back to copy-link.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireReferralAdmin();
  if (!guard.ok) return guard.response;

  let deliver: 'email' | 'link' = 'link';
  try {
    const body = await request.json();
    if (body?.deliver === 'email') deliver = 'email';
  } catch {
    // no body → default 'link'
  }

  try {
    const { id } = await params;
    const origin = new URL(request.url).origin;
    const invite = await createInvite(id, guard.email, origin);

    if (deliver === 'email') {
      const partner = await getReferrer(id);
      const result = await notifyInvite(
        { id, display_name: partner?.display_name ?? invite.email, email: invite.email },
        invite.url
      );
      return NextResponse.json({
        delivered: 'email',
        sent: result.status === 'sent',
        status: result.status,
        detail: result.detail,
        email: invite.email,
        url: invite.url, // still returned so the admin can copy if email failed
      });
    }

    return NextResponse.json({ delivered: 'link', url: invite.url, email: invite.email, expires_at: invite.expires_at });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[referrals] invite failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
