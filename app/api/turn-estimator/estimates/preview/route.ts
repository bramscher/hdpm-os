import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { resolvePriceBookItem } from '@/lib/turn-estimator/price-book';
import { priceEstimate, evaluateAuthorization } from '@/lib/turn-estimator/pricing';
import { getEstimatorConfig } from '@/lib/turn-estimator/config';
import type { LineInput, Responsibility } from '@/lib/turn-estimator/types';

interface LineSpec {
  item_code: string;
  qty?: number;
  minutes?: number;
  est_labor_hours?: number;
  est_material_cost?: number;
  description?: string;
  room?: string | null;
  responsibility?: Responsibility;
  tenant_alloc_proposed?: number;
}

/**
 * POST /api/turn-estimator/estimates/preview — price a set of lines WITHOUT
 * persisting, for the live builder total + authorization check. maintenance/pm/admin.
 * Body: { lines: LineSpec[], authorization_limit?: number|null }
 */
export async function POST(request: NextRequest) {
  const guard = await requireRole('maintenance', 'pm', 'admin');
  if (!guard.ok) return guard.response;
  let body: { lines?: LineSpec[]; authorization_limit?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const specs = Array.isArray(body.lines) ? body.lines : [];
  const cfg = await getEstimatorConfig();

  const inputs: LineInput[] = [];
  const unknown: string[] = [];
  for (const s of specs) {
    if (!s.item_code) continue;
    const item = await resolvePriceBookItem(s.item_code);
    if (!item) {
      unknown.push(s.item_code);
      continue;
    }
    inputs.push({
      item,
      qty: s.qty,
      minutes: s.minutes,
      estLaborHours: s.est_labor_hours,
      estMaterialCost: s.est_material_cost,
      description: s.description,
      room: s.room ?? null,
      responsibility: s.responsibility,
      tenantAllocProposed: s.tenant_alloc_proposed,
    });
  }

  const { lines, totals } = priceEstimate(inputs, cfg);
  const limit =
    body.authorization_limit != null ? body.authorization_limit : cfg.default_authorization_limit;
  const authorization = evaluateAuthorization(totals.owner_total, limit);

  return NextResponse.json({ lines, totals, authorization, limit, unknown });
}
