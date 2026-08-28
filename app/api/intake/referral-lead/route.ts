import { NextRequest, NextResponse } from 'next/server';
import { verifyServiceToken, bearerFromHeader } from '@/lib/service-tokens';
import { createIntakeLead } from '@/lib/referrals/leads';

/**
 * POST /api/intake/referral-lead — service-to-service intake from hdpm-web.
 *
 * The single owner-acquisition funnel: an owner-inquiry form on
 * highdesertpm.com posts here with the attribution it captured. `?ref=CODE`
 * (persisted in the hdpm_ref cookie) resolves to a partner → source=referral;
 * no/unknown code → source=organic (UTM/landing captured either way).
 *
 * Auth: Bearer token with the 'referrals' scope (service_token table; legacy
 * HDPM_SERVICE_TOKEN accepted as fallback). Contract:
 *   { prospect_name, prospect_email?, prospect_phone?, property_addresses?,
 *     unit_count?, notes?, ref_code?, utm?, landing_page?, hdpm_web_lead_id? }
 */
export async function POST(req: NextRequest) {
  const identity = await verifyServiceToken(bearerFromHeader(req.headers.get('authorization')), 'referrals');
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const prospect_name = typeof body.prospect_name === 'string' ? body.prospect_name.trim() : '';
  if (!prospect_name) {
    return NextResponse.json({ error: 'prospect_name is required' }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const addresses = Array.isArray(body.property_addresses)
    ? (body.property_addresses.filter((a) => typeof a === 'string') as string[])
    : null;

  try {
    const leadId = await createIntakeLead(
      {
        prospect_name,
        prospect_email: str(body.prospect_email),
        prospect_phone: str(body.prospect_phone),
        property_addresses: addresses,
        unit_count: typeof body.unit_count === 'number' ? body.unit_count : null,
        notes: str(body.notes),
        ref_code: str(body.ref_code),
        utm: body.utm && typeof body.utm === 'object' ? (body.utm as Record<string, unknown>) : null,
        landing_page: str(body.landing_page),
        hdpm_web_lead_id: str(body.hdpm_web_lead_id),
      },
      `service:${identity.name}`
    );
    return NextResponse.json({ ok: true, leadId }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[referrals] intake failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
