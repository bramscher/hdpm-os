/**
 * Dashboard configuration — the small manual-config layer the KPI spec calls
 * for. Holds values that AppFolio can't supply or that the owner must set:
 * the in-house maintenance vendor identity, KPI targets, and the loan / GM /
 * owner-draw inputs that the upcoming Section A financials panel will consume.
 *
 * Stored as a single JSONB row in `dashboard_config` (id = 'singleton').
 * Reads merge persisted values over DEFAULT_CONFIG so new fields always have a
 * sane fallback even before the row is written.
 */

import { getSupabaseAdmin } from './supabase';

export interface DashboardConfig {
  /**
   * AppFolio vendor IDs treated as in-house maintenance (HDPM's own crew).
   * Default: "High Desert Maintenance Services - Division of HDPM" — the
   * authoritative internal vendor record. Bills/work orders against these
   * vendors count as in-house in the maintenance-economics KPI.
   */
  internalVendorIds: string[];
  targets: {
    bendMixPct: number;       // Bend units ÷ total — strategic target ~50%
    occupancyPct: number;     // occupied ÷ total
    doorsGoal: number;        // doors-under-management goal
    netIncomeGoal: number;    // $1M NOI goal (Section A, deferred)
    ownerCashGoal: number;    // $500K owner distributable cash (Section A)
    maintBillableRateMin: number; // rate-card break-even alert threshold ($/hr)
  };
  /** Manual inputs for the Section A owner-cashflow KPIs. */
  financials: {
    loanBalance: number;
    loanRatePct: number;
    annualDebtService: number; // P&I
    /**
     * Total annual staff/payroll cost (incl. GM/owner-manager). REQUIRED for a
     * true NOI — QuickBooks' P&L does not book payroll, so without this the
     * NOI/owner-cash/DSCR gauges show a "needs config" state.
     */
    staffAnnualCost: number;
    gmAnnualCost: number;      // optional: GM cost shown separately (not double-counted)
    ownerDrawTarget: number;
  };
}

export const DEFAULT_CONFIG: DashboardConfig = {
  internalVendorIds: ['ea74594e-0c1f-11f1-ad37-0ec3c4e2b1e7'],
  targets: {
    bendMixPct: 50,
    occupancyPct: 95,
    doorsGoal: 1500,
    netIncomeGoal: 1_000_000,
    ownerCashGoal: 500_000,
    maintBillableRateMin: 56,
  },
  financials: {
    loanBalance: 0,
    loanRatePct: 0,
    annualDebtService: 0,
    staffAnnualCost: 0,
    gmAnnualCost: 0,
    ownerDrawTarget: 500_000,
  },
};

/** Deep-merge persisted partial config over the defaults. */
function mergeConfig(stored: unknown): DashboardConfig {
  const s = (stored ?? {}) as Partial<DashboardConfig>;
  return {
    internalVendorIds:
      Array.isArray(s.internalVendorIds) && s.internalVendorIds.length > 0
        ? s.internalVendorIds
        : DEFAULT_CONFIG.internalVendorIds,
    targets: { ...DEFAULT_CONFIG.targets, ...(s.targets ?? {}) },
    financials: { ...DEFAULT_CONFIG.financials, ...(s.financials ?? {}) },
  };
}

/**
 * Read the merged config. Never throws on a missing row / Supabase hiccup —
 * falls back to DEFAULT_CONFIG so KPI fetchers stay resilient.
 */
export async function getDashboardConfig(): Promise<DashboardConfig> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('dashboard_config')
      .select('data')
      .eq('id', 'singleton')
      .maybeSingle();
    return mergeConfig(data?.data);
  } catch (e) {
    console.warn('[config] read failed, using defaults:', e);
    return DEFAULT_CONFIG;
  }
}

/** Upsert a partial config patch and return the merged result. */
export async function saveDashboardConfig(
  patch: Partial<DashboardConfig>
): Promise<DashboardConfig> {
  const current = await getDashboardConfig();
  const next: DashboardConfig = {
    internalVendorIds: patch.internalVendorIds ?? current.internalVendorIds,
    targets: { ...current.targets, ...(patch.targets ?? {}) },
    financials: { ...current.financials, ...(patch.financials ?? {}) },
  };
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('dashboard_config')
    .upsert({ id: 'singleton', data: next, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return next;
}
