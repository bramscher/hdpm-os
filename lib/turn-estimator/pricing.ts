/**
 * Turn Estimator — pure pricing engine (Slice 0).
 *
 * No DB, no I/O — every function is deterministic and unit-tested. Reuses the
 * existing cost/markup math (chargedFromCost) from lib/invoice-analysis so the
 * estimator and the invoice report agree to the cent.
 *
 * Owner charge is what the owner is billed. internal_cost is HDPM's cost basis
 * (labor at the internal rate + material/vendor cost). tenant_alloc_proposed is
 * NEVER derived from price — it defaults to 0 and only a human sets it.
 */

import { chargedFromCost } from '@/lib/invoices';
import {
  type PriceBookItem,
  type LineInput,
  type PricedLine,
  type EstimateTotals,
  type EstimatorConfig,
  DEFAULT_ESTIMATOR_CONFIG,
} from './types';

/** Round to cents, matching lib/invoice-analysis. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Owner charge for one line, by pricing method.
 *
 * service_min semantics (spec §6.2 / acceptance #3): base_price is the minimum
 * (includes `included_minutes`); each started `increment_minutes` block beyond
 * that is billed at `increment_price`. Example: 90 min visit, $125 min, 60 min
 * included, 15-min $21.25 increments → 125 + ceil(30/15)*21.25 = $167.50.
 *
 * IMPORTANT: the service minimum is per-line here; the ONE-minimum-per-visit
 * bundling rule (acceptance #2) is enforced at the estimate level — see
 * priceEstimate / bundleServiceMinimum. A caller pricing multiple tasks in one
 * visit prices only the first as service_min and the rest as plain time.
 */
export function ownerChargeForLine(item: PriceBookItem, input: LineInput): number {
  const qty = input.qty ?? 1;
  switch (item.pricing_method) {
    case 'flat':
    case 'per_qty':
    case 'package':
    case 'allowance':
      return cents(item.base_price * qty);

    case 'hourly': {
      const hours = input.estLaborHours ?? (input.minutes != null ? input.minutes / 60 : qty);
      return cents(item.base_price * hours);
    }

    case 'service_min': {
      const minutes = input.minutes ?? 0;
      const included = item.included_minutes ?? 0;
      const incMin = item.increment_minutes ?? 15;
      const incPrice = item.increment_price ?? 0;
      const overage = Math.max(0, minutes - included);
      const blocks = incMin > 0 ? Math.ceil(overage / incMin) : 0;
      return cents(item.base_price + blocks * incPrice);
    }

    case 'cost_plus': {
      const cost = input.estMaterialCost ?? 0;
      return chargedFromCost(cost, item.markup_pct ?? 0);
    }

    case 'quoted':
      // A quoted line's owner price is entered directly as base_price (the quote).
      return cents(item.base_price * qty);

    default:
      return 0;
  }
}

/** HDPM's internal cost basis for a line: labor at the internal rate + material/vendor cost. */
export function internalCostForLine(
  input: LineInput,
  cfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG
): number {
  const laborHours = input.estLaborHours ?? (input.minutes != null ? input.minutes / 60 : 0);
  const laborCost = laborHours * cfg.internal_labor_cost_rate;
  const materialCost = input.estMaterialCost ?? 0;
  return cents(laborCost + materialCost);
}

/** Price one line into a persistable PricedLine. */
export function priceLine(
  input: LineInput,
  cfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG
): PricedLine {
  const { item } = input;
  const qty = input.qty ?? 1;
  const ownerExtended = ownerChargeForLine(item, input);
  const ownerUnit = qty !== 0 ? cents(ownerExtended / qty) : ownerExtended;
  const internalCost = internalCostForLine(input, cfg);

  return {
    price_book_item_id: item.id,
    price_book_item_code: item.item_code,
    category: item.category,
    pricing_method: item.pricing_method,
    description: input.description ?? item.owner_description ?? item.name,
    room: input.room ?? null,
    location: input.location ?? null,
    qty,
    uom: item.uom,
    est_labor_hours: input.estLaborHours ?? null,
    est_material_cost: input.estMaterialCost ?? null,
    internal_cost: internalCost,
    owner_unit_price: ownerUnit,
    owner_extended: ownerExtended,
    tax_amount: input.taxAmount ?? 0,
    tenant_alloc_proposed: input.tenantAllocProposed ?? 0,
    responsibility: input.responsibility ?? 'owner',
    responsibility_rationale: input.responsibilityRationale ?? null,
  };
}

/**
 * Bundle service minimums for one continuous visit (spec §6.4, acceptance #2):
 * only ONE service_min line keeps its minimum; any additional service_min lines
 * in the same visit are re-priced as plain time at their increment rate (no
 * second minimum). Returns a new input array; does not mutate.
 *
 * `groupKey` should identify a continuous visit (e.g. estimate id, or a
 * per-visit tag). Lines with different keys keep their own minimum.
 */
export function bundleServiceMinimums(inputs: LineInput[]): LineInput[] {
  let minimumUsed = false;
  return inputs.map((input) => {
    if (input.item.pricing_method !== 'service_min') return input;
    if (!minimumUsed) {
      minimumUsed = true;
      return input; // first one keeps the minimum
    }
    // Subsequent tasks in the same visit: bill only the time increments, no minimum.
    const item = input.item;
    const incMin = item.increment_minutes ?? 15;
    const incPrice = item.increment_price ?? 0;
    const minutes = input.minutes ?? 0;
    const blocks = incMin > 0 ? Math.ceil(minutes / incMin) : 0;
    // Re-express as a flat line at the already-computed increment total.
    return {
      ...input,
      item: {
        ...item,
        pricing_method: 'flat' as const,
        base_price: cents(blocks * incPrice),
        included_minutes: null,
        increment_minutes: null,
        increment_price: null,
      },
      qty: 1,
    };
  });
}

/** Total a set of priced lines. */
export function totalLines(lines: PricedLine[]): EstimateTotals {
  const owner_total = cents(lines.reduce((s, l) => s + l.owner_extended + l.tax_amount, 0));
  const internal_cost_total = cents(lines.reduce((s, l) => s + l.internal_cost, 0));
  const tenant_alloc_proposed_total = cents(lines.reduce((s, l) => s + l.tenant_alloc_proposed, 0));
  const margin = cents(owner_total - internal_cost_total);
  return { owner_total, internal_cost_total, tenant_alloc_proposed_total, margin };
}

/**
 * Price a whole estimate: bundle service minimums for the visit, price each
 * line, and total. Returns lines + totals.
 */
export function priceEstimate(
  inputs: LineInput[],
  cfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG
): { lines: PricedLine[]; totals: EstimateTotals } {
  const bundled = bundleServiceMinimums(inputs);
  const lines = bundled.map((i) => priceLine(i, cfg));
  return { lines, totals: totalLines(lines) };
}

/**
 * Authorization evaluation (spec §5.4): compare the FULL owner total to the
 * property authorization limit. Over the limit → needs approval. A null limit is
 * conservative (needs approval).
 */
export function evaluateAuthorization(
  ownerTotal: number,
  limit: number | null
): 'auto_approved' | 'approval_pending' {
  if (limit == null) return 'approval_pending';
  return ownerTotal <= limit ? 'auto_approved' : 'approval_pending';
}

/**
 * Change-order test (spec §5.4, acceptance #6): a post-approval increase beyond
 * the greater of $abs or $pct×approved requires a change order.
 */
export function changeOrderRequired(
  approvedTotal: number,
  newTotal: number,
  cfg: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG
): boolean {
  const tolerance = Math.max(
    cfg.change_order_tolerance_abs,
    cfg.change_order_tolerance_pct * approvedTotal
  );
  return newTotal > cents(approvedTotal + tolerance);
}
