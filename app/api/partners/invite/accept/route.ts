import { NextRequest, NextResponse } from 'next/server';
import { acceptInvite } from '@/lib/referrals/onboarding';

/**
 * POST /api/partners/invite/accept — token-gated referrer onboarding (pre-auth).
 * Public route (no session): the invite token is the authorization. Thin by
 * design — all privileged work is in lib/referrals/onboarding (service role),
 * keeping this route clean of getSupabaseAdmin per the isolation guardrail.
 *
 * multipart/form-data: token, email, agreementAccepted, legalName, taxId,
 * taxAddress (JSON), w9 (file, optional).
 */
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const token = String(form.get('token') || '');
  const email = String(form.get('email') || '');
  if (!token || !email) {
    return NextResponse.json({ error: 'token and email are required' }, { status: 400 });
  }

  let taxAddress: Record<string, unknown> | null = null;
  const rawAddr = form.get('taxAddress');
  if (typeof rawAddr === 'string' && rawAddr.trim()) {
    try {
      taxAddress = JSON.parse(rawAddr);
    } catch {
      return NextResponse.json({ error: 'taxAddress must be valid JSON' }, { status: 400 });
    }
  }

  let w9: { bytes: Buffer; contentType: string } | null = null;
  const file = form.get('w9');
  if (file && typeof file === 'object' && 'arrayBuffer' in file) {
    const f = file as File;
    if (f.size > 0) {
      if (f.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'W-9 file must be under 10 MB' }, { status: 400 });
      }
      w9 = { bytes: Buffer.from(await f.arrayBuffer()), contentType: f.type || 'application/pdf' };
    }
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

  try {
    const result = await acceptInvite({
      token,
      email,
      agreementAccepted: form.get('agreementAccepted') === 'true',
      legalName: (form.get('legalName') as string) || null,
      taxId: (form.get('taxId') as string) || null,
      taxAddress,
      w9,
      ip,
    });
    return NextResponse.json({ ok: true, partnerId: result.partnerId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Onboarding failures are mostly user-fixable (bad/expired token, email
    // mismatch, missing agreement) → 400, not 500.
    const userError = /invite|agreement|match|expired|already/i.test(msg);
    console.error('[referrals] accept failed:', msg);
    return NextResponse.json({ error: msg }, { status: userError ? 400 : 500 });
  }
}
