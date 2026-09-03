/**
 * Turn Estimator — shared types (Slice 0).
 *
 * Money is dollars with 2dp (matches the rest of the app; NUMERIC(12,2) in the
 * DB). Estimate versions + lines are immutable once issued.
 */

export type PricingMethod =
  | 'flat'
  | 'hourly'
  | 'service_min'
  | 'package'
  | 'per_qty'
  | 'cost_plus'
  | 'quoted'
  | 'allowance';

export type Responsibility = 'owner' | 'tenant' | 'shared' | 'unknown' | 'not_billable';

/** A resolved price-book row (the one effective on a given date). */
export interface PriceBookItem {
  id: string;
  org_id: string;
  item_code: string;
  category: string;
  name: string;
  owner_description: string | null;
  internal_instructions: string | null;
  pricing_method: PricingMethod;
  base_price: number; // meaning depends on method
  included_minutes: number | null; // service_min / package
  increment_minutes: number | null; // service_min
  increment_price: number | null; // service_min
  standard_minutes: number | null;
  uom: string;
  markup_pct: number | null; // cost_plus
  markup_eligible: boolean;
  gl_code: string | null;
  tenant_alloc_eligible: boolean;
  skill_trade: string | null;
  market: string;
  effective_from: string; // YYYY-MM-DD
  effective_to: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Effective-dated globals from turn_estimator_config. */
export interface EstimatorConfig {
  change_order_tolerance_abs: number;
  change_order_tolerance_pct: number;
  internal_labor_cost_rate: number; // internal $/hr cost basis for margin
  default_authorization_limit: number;
}

export const DEFAULT_ESTIMATOR_CONFIG: EstimatorConfig = {
  change_order_tolerance_abs: 100,
  change_order_tolerance_pct: 0.1,
  internal_labor_cost_rate: 35,
  default_authorization_limit: 500,
};

/** What the estimator supplies for one line before pricing. */
export interface LineInput {
  item: PriceBookItem;
  qty?: number; // default 1
  /** For service_min/hourly: actual/estimated on-site minutes for this line. */
  minutes?: number;
  /** Labor hours to attribute (drives internal cost + margin). */
  estLaborHours?: number;
  /** Direct material/vendor cost basis for this line (cost_plus, materials). */
  estMaterialCost?: number;
  description?: string;
  room?: string | null;
  location?: string | null;
  responsibility?: Responsibility;
  responsibilityRationale?: string | null;
  /** Proposed tenant allocation (defaults 0; never auto-derived). */
  tenantAllocProposed?: number;
  taxAmount?: number;
}

/** A fully priced line, ready to persist as an estimate_line. */
export interface PricedLine {
  price_book_item_id: string;
  price_book_item_code: string;
  category: string;
  pricing_method: PricingMethod;
  description: string;
  room: string | null;
  location: string | null;
  qty: number;
  uom: string;
  est_labor_hours: number | null;
  est_material_cost: number | null;
  internal_cost: number;
  owner_unit_price: number;
  owner_extended: number;
  tax_amount: number;
  tenant_alloc_proposed: number;
  responsibility: Responsibility;
  responsibility_rationale: string | null;
}

/** Totals for an estimate version. */
export interface EstimateTotals {
  owner_total: number;
  internal_cost_total: number;
  tenant_alloc_proposed_total: number;
  margin: number;
}
