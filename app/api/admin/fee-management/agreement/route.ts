import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseAgreement } from '@/lib/fee-management/model';

/** PUT one property's agreement dates (staff backfill; AppFolio has none). */
export async function PUT(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const a = parseAgreement(await request.json().catch(() => null));
  if (!a) return NextResponse.json({ error: 'Check the dates (YYYY-MM-DD, end after start) and notice days (0–365)' }, { status: 400 });

  const { error } = await getSupabaseAdmin().from('property_agreement').upsert(
    {
      org_id: 'hdpm',
      appfolio_property_id: a.propertyId,
      start_date: a.startDate,
      end_date: a.endDate,
      auto_renew: a.autoRenew,
      notice_days: a.noticeDays,
      notes: a.notes,
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
