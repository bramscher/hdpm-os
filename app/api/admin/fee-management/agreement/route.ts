import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { agreementError, parseAgreement } from '@/lib/fee-management/model';

/**
 * PUT one property's agreement dates (staff backfill; AppFolio has none),
 * plus the link to the latest signed agreement and its last-renewed date when
 * the edit includes them (the Agreements tab). Omitted document fields are
 * left as they are, so the Owner Fee Opportunity editor never wipes them.
 */
export async function PUT(request: NextRequest) {
  const guard = await requireSection('fee_management');
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => null);
  const a = parseAgreement(body);
  if (!a) return NextResponse.json({ error: agreementError(body) }, { status: 400 });

  const { error } = await getSupabaseAdmin().from('property_agreement').upsert(
    {
      org_id: 'hdpm',
      appfolio_property_id: a.propertyId,
      start_date: a.startDate,
      end_date: a.endDate,
      auto_renew: a.autoRenew,
      notice_days: a.noticeDays,
      notes: a.notes,
      ...(a.agreementUrl !== undefined ? { agreement_url: a.agreementUrl } : {}),
      ...(a.lastRenewedOn !== undefined ? { last_renewed_on: a.lastRenewedOn } : {}),
      updated_at: new Date().toISOString(),
      updated_by: guard.email,
    },
    { onConflict: 'org_id,appfolio_property_id' }
  );
  if (error) {
    console.error('[fee-management] agreement save failed:', error);
    return NextResponse.json({ error: 'Could not save agreement' }, { status: 503 });
  }
  return NextResponse.json({ agreement: a });
}
