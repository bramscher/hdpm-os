import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { resolvePriceBookItem } from '@/lib/turn-estimator/price-book';
import { issueEstimateVersion } from '@/lib/turn-estimator/estimates';
import type { LineInput, Responsibility } from '@/lib/turn-estimator/types';

interface LineSpec {
  item_code: string;
  qty?: number;
  minutes?: number;
  est_labor_hours?: number;
  est_material_cost?: number;
  description?: string;
  room?: string | null;
  location?: string | null;
  responsibility?: Responsibility;
  responsibility_rationale?: string | null;
  tenant_alloc_proposed?: number;
  tax_amount?: number;
}

/**
 * POST /api/turn-estimator/estimates/[id]/issue — price the given lines against
 * the price book (as of pricedAsof) and write an immutable version. maintenance/pm/admin.
 * Body: { lines: LineSpec[], notes?, priced_asof? }
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole('maintenance', 'pm', 'admin');
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  let body: { lines?: LineSpec[]; notes?: string; priced_asof?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const specs = Array.isArray(body.lines) ? body.lines : [];
  if (specs.length === 0) {
    return NextResponse.json({ error: 'at least one line is required' }, { status: 400 });
  }

  try {
    const inputs: LineInput[] = [];
    for (const s of specs) {
      const item = await resolvePriceBookItem(s.item_code, body.priced_asof);
      if (!item) {
        return NextResponse.json(
          { error: `no current price-book item for "${s.item_code}"` },
          { status: 400 }
        );
      }
      inputs.push({
        item,
        qty: s.qty,
        minutes: s.minutes,
        estLaborHours: s.est_labor_hours,
        estMaterialCost: s.est_material_cost,
        description: s.description,
        room: s.room ?? null,
        location: s.location ?? null,
        responsibility: s.responsibility,
        responsibilityRationale: s.responsibility_rationale ?? null,
        tenantAllocProposed: s.tenant_alloc_proposed,
        taxAmount: s.tax_amount,
      });
    }
    const result = await issueEstimateVersion(id, inputs, guard.email, {
      notes: body.notes,
      pricedAsof: body.priced_asof,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
