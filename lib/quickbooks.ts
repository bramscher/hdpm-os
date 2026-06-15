/**
 * QuickBooks financials layer for the Section A owner-goal panel.
 *
 * Source of truth: the HDPM QuickBooks Online P&L. The deployed app cannot call
 * the (Claude-session) QuickBooks MCP at request time, so financials are stored
 * as a snapshot in `kpi_snapshots` (kpi_name='financials') and read from there.
 * Seeded via scripts/seed-financials.ts (pulls real QB numbers in a Claude
 * session). A future in-app refresh would implement refreshFromQuickBooks()
 * against the QBO Reports API (needs Intuit app OAuth credentials).
 *
 * IMPORTANT — payroll caveat: HDPM's QB P&L expense accounts do NOT include
 * staff payroll (monthly booked opex is only $17–48k for an ~830-door operation;
 * there is no salaries/wages/officer-comp account anywhere in the P&L). So QB's
 * "net income" overstates true profit. We therefore treat QB revenue + QB booked
 * opex as live, and derive true NOI / owner cash by subtracting the annual staff
 * cost (config.financials.staffAnnualCost) and debt service. Until that staff
 * cost is configured, the NOI/owner-cash/DSCR gauges report a "needs config"
 * state rather than a misleading number.
 */

import { getSupabaseAdmin } from './supabase';

export const FINANCIALS_KPI_NAME = 'financials';

export interface FinancialsMonthly {
  month: string;   // 'YYYY-MM'
  revenue: number;
  opex: number;    // QB booked opex (excludes payroll)
  net: number;     // QB net for the month (revenue - booked opex)
}

export interface FinancialsSnapshot {
  source: 'quickbooks' | 'manual';
  periodStart: string;     // 'YYYY-MM-DD'
  periodEnd: string;       // 'YYYY-MM-DD'
  revenueTTM: number;
  bookedOpexTTM: number;   // booked in QB; excludes payroll
  qbNetIncomeTTM: number;  // revenue - booked opex (NOT true net — payroll excluded)
  monthly: FinancialsMonthly[];
  /** Free-text provenance, e.g. "QuickBooks P&L pulled 2026-06-14". */
  note?: string;
}

/** Read the most recent financials snapshot, or null if none seeded yet. */
export async function getLatestFinancials(): Promise<{
  value: FinancialsSnapshot;
  capturedAt: string;
} | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('kpi_snapshots')
      .select('value, captured_at')
      .eq('kpi_name', FINANCIALS_KPI_NAME)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      value: data.value as FinancialsSnapshot,
      capturedAt: data.captured_at as string,
    };
  } catch (e) {
    console.warn('[financials] read failed:', e);
    return null;
  }
}

/** Persist a financials snapshot (used by the seed script / future refresh). */
export async function saveFinancials(snapshot: FinancialsSnapshot): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('kpi_snapshots')
    .insert({ kpi_name: FINANCIALS_KPI_NAME, value: snapshot });
  if (error) throw new Error(error.message);
}

/**
 * Future productionization: pull the P&L live from QuickBooks Online and persist.
 * Requires an Intuit Developer app (client id/secret + OAuth redirect) and token
 * storage/refresh — none of which exist yet. Until then, seed via the script.
 */
export async function refreshFromQuickBooks(): Promise<never> {
  throw new Error(
    'Live QuickBooks refresh not configured. Seed via scripts/seed-financials.ts ' +
      '(or implement QBO OAuth + Reports API here).'
  );
}
