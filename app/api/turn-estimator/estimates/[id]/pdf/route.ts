import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateEstimatePdf, type EstimatePdfLine } from '@/lib/turn-estimator/estimate-pdf';

/**
 * GET /api/turn-estimator/estimates/[id]/pdf — the owner-facing HDMS estimate
 * PDF for the estimate's current version. Cost-blind (owner prices only).
 * Generated on the fly. Staff-only (they present it to the owner).
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const supabase = getSupabaseAdmin();

  const { data: est } = await supabase
    .from('estimate')
    .select('id, property_name, unit_name, status, current_version_id')
    .eq('id', id)
    .maybeSingle();
  if (!est) return NextResponse.json({ error: 'estimate not found' }, { status: 404 });
  if (!est.current_version_id) {
    return NextResponse.json({ error: 'estimate has no issued version yet' }, { status: 400 });
  }

  const { data: version } = await supabase
    .from('estimate_version')
    .select('version_number, owner_total, priced_asof')
    .eq('id', est.current_version_id)
    .single();
  const { data: lineRows } = await supabase
    .from('estimate_line')
    .select('category, description, room, qty, uom, owner_unit_price, owner_extended')
    .eq('estimate_version_id', est.current_version_id)
    .order('line_no');

  const num = (v: unknown) => (v == null ? 0 : Number(v));
  const lines: EstimatePdfLine[] = (lineRows ?? []).map((r) => ({
    category: (r.category as string) ?? null,
    description: r.description as string,
    room: (r.room as string) ?? null,
    qty: num(r.qty),
    uom: (r.uom as string) ?? 'each',
    owner_unit_price: num(r.owner_unit_price),
    owner_extended: num(r.owner_extended),
  }));

  const code = `EST-${String(est.id).slice(0, 8)}-v${version?.version_number ?? 1}`;
  const pdf = generateEstimatePdf({
    estimate_code: code,
    property_name: (est.property_name as string) ?? 'Property',
    property_address: '',
    unit_name: (est.unit_name as string) ?? null,
    priced_asof: (version?.priced_asof as string) ?? new Date().toISOString().slice(0, 10),
    owner_total: num(version?.owner_total),
    status: (est.status as string) ?? 'draft',
    lines,
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${code}.pdf"`,
    },
  });
}
