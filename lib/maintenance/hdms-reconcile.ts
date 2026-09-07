// ============================================
// HDMS work-order ↔ invoice reconciliation — Supabase loader
// ============================================
// Every work order assigned to the in-house crew (High Desert Maintenance
// Services) is supposed to be converted into an HDMS invoice once the job is
// done. This loads every HDMS WO in the window, joins the hdms_invoices table,
// and hands off to the pure categorizer in hdms-reconcile-shared.ts.
//
// Pure types / predicates / categorizer live in ./hdms-reconcile-shared so the
// client report component can import them without pulling in Supabase. Read-only.

import { getSupabaseAdmin } from '@/lib/supabase';
import { getDashboardConfig } from '@/lib/dashboard-config';
import { INTERNAL_VENDOR_MATCH } from '@/app/maintenance/board/board-types';
import {
  categorizeHdmsReconciliation,
  type HdmsReconWorkOrder,
  type HdmsReconInvoice,
  type HdmsReconciliation,
} from './hdms-reconcile-shared';

// Re-export the shared surface so existing importers (tests, API route) keep
// working against '@/lib/maintenance/hdms-reconcile'.
export * from './hdms-reconcile-shared';

const WO_COLUMNS =
  'id, wo_number, unit_name, property_name, description, appfolio_status, status, stage, assigned_to, assigned_tech, owner_name, vendor_id, vendor_name, completed_date, canceled_date, verified_at, appfolio_link';

const INV_COLUMNS = 'id, invoice_code, status, doc_type, total_amount, work_order_id, wo_reference';

const PAGE = 1000;

/**
 * Load every HDMS work order in the window plus its invoice linkage and return
 * the categorized reconciliation. Scopes to HDMS by the configured internal
 * vendor ids (dashboard-config) with a vendor-name substring fallback.
 */
export async function buildHdmsReconciliation(
  opts: { windowDays?: number } = {}
): Promise<HdmsReconciliation> {
  const windowDays = opts.windowDays ?? 180;
  const supabase = getSupabaseAdmin();
  const cfg = await getDashboardConfig();
  const vendorIds = cfg.internalVendorIds;
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  // Scope to HDMS (vendor id OR name substring), AND within the window
  // (still-open, or finished/canceled since the cutoff). Two `.or()` groups are
  // AND-ed together by PostgREST.
  const vendorOr = [
    `vendor_id.in.(${vendorIds.join(',')})`,
    `vendor_name.ilike.%${INTERNAL_VENDOR_MATCH}%`,
  ].join(',');
  const windowOr = [
    'status.eq.open',
    `completed_date.gte.${cutoff}`,
    `closed_at.gte.${cutoff}`,
    `canceled_date.gte.${cutoff}`,
  ].join(',');

  const workOrders: HdmsReconWorkOrder[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('work_orders')
      .select(WO_COLUMNS)
      .or(vendorOr)
      .or(windowOr)
      .order('completed_date', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`HDMS work-order load failed: ${error.message}`);
    const batch = (data ?? []) as unknown as HdmsReconWorkOrder[];
    workOrders.push(...batch);
    if (batch.length < PAGE) break;
  }

  // Invoice linkage — non-void, by work_order_id and by wo_reference.
  const woIds = workOrders.map((w) => w.id);
  const woRefs = [...new Set(workOrders.map((w) => w.wo_number).filter((v): v is string => !!v))];
  const invoiceById = new Map<string, HdmsReconInvoice>();
  const collect = (rows: HdmsReconInvoice[]) => {
    for (const inv of rows) invoiceById.set(inv.id, inv);
  };

  for (let i = 0; i < woIds.length; i += 200) {
    const { data, error } = await supabase
      .from('hdms_invoices')
      .select(INV_COLUMNS)
      .in('work_order_id', woIds.slice(i, i + 200))
      .neq('status', 'void');
    if (error) throw new Error(`HDMS invoice load (by id) failed: ${error.message}`);
    collect((data ?? []) as unknown as HdmsReconInvoice[]);
  }
  for (let i = 0; i < woRefs.length; i += 200) {
    const { data, error } = await supabase
      .from('hdms_invoices')
      .select(INV_COLUMNS)
      .in('wo_reference', woRefs.slice(i, i + 200))
      .neq('status', 'void');
    if (error) throw new Error(`HDMS invoice load (by ref) failed: ${error.message}`);
    collect((data ?? []) as unknown as HdmsReconInvoice[]);
  }

  // Independently load invoices completed within the window so genuine orphans
  // (an invoice whose WO can't be linked / isn't HDMS-scoped) surface in the
  // orphan pass. Because the WO window is also keyed on completed_date, a
  // healthy invoice whose WO completed in-window is already loaded above and
  // will match — so this only adds true orphans, not false positives.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('hdms_invoices')
      .select(INV_COLUMNS)
      .eq('doc_type', 'invoice')
      .neq('status', 'void')
      .gte('completed_date', cutoff.slice(0, 10))
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`HDMS invoice load (recent) failed: ${error.message}`);
    const batch = (data ?? []) as unknown as HdmsReconInvoice[];
    collect(batch);
    if (batch.length < PAGE) break;
  }

  const result = categorizeHdmsReconciliation(workOrders, [...invoiceById.values()]);
  result.windowDays = windowDays;
  return result;
}
