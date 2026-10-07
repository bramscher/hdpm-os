import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { matchTenantUnits, streetNumber, type TenantUnitRow } from '@/lib/invoice-tenant-lookup';

/**
 * GET /api/invoices/tenant-lookup?address=…&unit=…
 * Current tenant(s) for a work order's property, from the nightly AppFolio
 * sync, to prefill a tenant-charge invoice.
 */
export async function GET(request: NextRequest) {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const address = params.get('address') || '';
  const unit = params.get('unit') || '';
  const number = streetNumber(address);
  if (!number) return NextResponse.json({ matches: [] });

  const { data, error } = await getSupabaseAdmin()
    .from('inspection_properties')
    .select('address_1, address_2, city, resident_name, financially_responsible_occupants, last_appfolio_sync_at, active')
    .ilike('address_1', `${number} %`)
    .limit(200);
  if (error) {
    console.error('[invoices/tenant-lookup] query failed:', error.message);
    return NextResponse.json({ error: 'Could not look up the tenant' }, { status: 500 });
  }
  return NextResponse.json({ matches: matchTenantUnits(address, unit, (data || []) as TenantUnitRow[]).slice(0, 10) });
}
