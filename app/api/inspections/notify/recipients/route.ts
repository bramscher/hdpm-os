import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchAppFolioTenants } from '@/lib/appfolio';
import { inspectionToday } from '@/lib/inspection-window';
import { checkRecipients } from '@/lib/inspection-notice-recipients';

export const maxDuration = 60;

/**
 * GET /api/inspections/notify/recipients?ids=a,b,c
 *
 * Live check of who should get each tenant notice: pulls AppFolio's current
 * tenant list (several AppFolio requests — staff trigger it on demand) and
 * flags tenant changes, move-outs, vacancies and missing emails. Stores nothing.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const ids = (new URL(request.url).searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  if (ids.length > 300) return NextResponse.json({ error: 'Too many inspections at once' }, { status: 400 });
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('inspections')
      .select('id, target_date, resident_name, notice_email, inspection_properties ( appfolio_unit_id, resident_name, tenant_email )')
      .in('id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const tenants = await fetchAppFolioTenants();
    const notices = (data || []).map((row) => {
      const raw = (row as { inspection_properties?: unknown }).inspection_properties;
      const p = (Array.isArray(raw) ? raw[0] : raw) as { appfolio_unit_id?: string | null; resident_name?: string | null; tenant_email?: string | null } | null;
      return {
        id: row.id as string,
        appfolio_unit_id: p?.appfolio_unit_id ?? null,
        target_date: row.target_date as string | null,
        resident_name: (row.resident_name as string | null) || p?.resident_name || null,
        email: (row.notice_email as string | null) || p?.tenant_email || null,
      };
    });
    return NextResponse.json({ checked_at: new Date().toISOString(), results: checkRecipients(notices, tenants, inspectionToday()) });
  } catch (err) {
    console.error('[notify/recipients] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AppFolio tenant check failed' }, { status: 502 });
  }
}
