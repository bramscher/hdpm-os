import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseCampaign } from '@/lib/fee-management/model';

/** PUT one owner set's campaign row (status, new fee, dates, notes). */
export async function PUT(request: NextRequest) {
  const guard = await requireRole('admin');
  if (!guard.ok) return guard.response;
  const c = parseCampaign(await request.json().catch(() => null));
  if (!c) return NextResponse.json({ error: 'Invalid status, fee % (0–100) or date' }, { status: 400 });

  const updatedAt = new Date().toISOString();
  const { error } = await getSupabaseAdmin().from('fee_campaign').upsert(
    {
      org_id: 'hdpm',
      owner_set_key: c.ownerSetKey,
      owner_name: c.ownerName,
      status: c.status,
      new_fee_pct: c.newFeePct,
      effective_date: c.effectiveDate,
      assigned_to: c.assignedTo,
      notes: c.notes,
      updated_at: updatedAt,
      updated_by: guard.email,
    },
    { onConflict: 'org_id,owner_set_key' }
  );
  if (error) {
    console.error('[fee-management] campaign save failed:', error);
    return NextResponse.json({ error: 'Could not save campaign update' }, { status: 503 });
  }
  const { ownerName: _ownerName, ...entry } = c;
  return NextResponse.json({ entry: { ...entry, updatedAt } });
}
