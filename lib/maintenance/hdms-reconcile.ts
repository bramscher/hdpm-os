// ============================================
// HDMS work-order ↔ invoice reconciliation
// ============================================
// Every work order assigned to the in-house crew (High Desert Maintenance
// Services) is supposed to be converted into an HDMS invoice once the job is
// done. This report scopes work orders to HDMS, joins them to the
// `hdms_invoices` table, and buckets each one so mismatches are obvious:
//
//   done_billed        finished AND an invoice exists           — healthy
//   done_unbilled      finished, no invoice                     — revenue leak
//   not_done           assigned to HDMS, still in progress      — not billable yet
//   billed_not_done    an invoice exists but its WO isn't done / can't be found
//   canceled           canceled WO (no invoice expected)        — excluded from leak
//
// "Done" uses the *either signal* rule the owner chose: AppFolio-Completed
// (appfolio_status = 'Completed' or completed_date set) OR HDPM-verified
// (verified_at set / stage = 'VERIFY').
//
// Read-only. Amounts come only from hdms_invoices.total_amount — AppFolio's v0
// API exposes no estimate/bill dollar fields.

import { getSupabaseAdmin } from '@/lib/supabase';
import { getDashboardConfig } from '@/lib/dashboard-config';
import { INTERNAL_VENDOR_MATCH } from '@/app/maintenance/board/board-types';

export type HdmsReconCategory =
  | 'done_billed'
  | 'done_unbilled'
  | 'not_done'
  | 'billed_not_done'
  | 'canceled';

/** The work-order fields the reconciliation needs (subset of work_orders). */
export interface HdmsReconWorkOrder {
  id: string;
  wo_number: string | null;
  unit_name: string | null;
  property_name: string | null;
  description: string | null;
  appfolio_status: string | null;
  status: string | null;
  stage: string | null;
  assigned_to: string | null;
  assigned_tech: string | null;
  owner_name: string | null;
  vendor_name: string | null;
  completed_date: string | null;
  canceled_date: string | null;
  verified_at: string | null;
  appfolio_link: string | null;
}

/** The invoice fields the reconciliation needs (subset of hdms_invoices). */
export interface HdmsReconInvoice {
  id: string;
  invoice_code: string;
  status: string;
  doc_type: string;
  total_amount: number | null;
  work_order_id: string | null;
  wo_reference: string | null;
}

export interface HdmsReconRow {
  category: HdmsReconCategory;
  wo_id: string | null;
  wo_number: string | null;
  unit_name: string | null;
  property_name: string | null;
  description: string | null;
  appfolio_status: string | null;
  assigned_tech: string | null;
  owner_name: string | null;
  completed_date: string | null;
  appfolio_link: string | null;
  invoice_code: string | null;
  invoice_status: string | null;
  invoice_total: number | null;
}

export interface HdmsReconSummaryBucket {
  count: number;
  invoicedTotal: number;
}

export interface HdmsReconciliation {
  generatedAt: string;
  windowDays: number;
  summary: Record<HdmsReconCategory, HdmsReconSummaryBucket>;
  rows: HdmsReconRow[];
}

export const HDMS_RECON_CATEGORIES: HdmsReconCategory[] = [
  'done_unbilled',
  'billed_not_done',
  'not_done',
  'done_billed',
  'canceled',
];

export const HDMS_RECON_LABELS: Record<HdmsReconCategory, string> = {
  done_unbilled: 'Done, not billed',
  billed_not_done: 'Billed, WO not done / no WO',
  not_done: 'Not done',
  done_billed: 'Done & billed',
  canceled: 'Canceled',
};

// AppFolio statuses that mean the work is physically finished — kept in sync
// with mapWorkOrderStatus (lib/appfolio.ts): "Work Completed" is a real
// completion status, not an in-progress one. "closed" (non-canceled) is also a
// finished job. Canceled is handled separately — a canceled WO is not billable.
const DONE_AF_STATUSES = new Set(['completed', 'complete', 'work completed', 'closed']);
const CANCELED_AF_STATUSES = new Set(['canceled', 'cancelled']);

function afStatus(wo: HdmsReconWorkOrder): string {
  return (wo.appfolio_status ?? '').toLowerCase().trim();
}

/** A WO counts as canceled (no invoice expected). Checked before "done". */
export function isWorkOrderCanceled(wo: HdmsReconWorkOrder): boolean {
  return CANCELED_AF_STATUSES.has(afStatus(wo)) || !!wo.canceled_date;
}

/**
 * A WO counts as "done" if either AppFolio or HDPM says it finished — the
 * "either signal" rule. AppFolio: mapped status is done/closed, or a
 * completed_date exists. HDPM: verified, or past the VERIFY/CLOSED workflow
 * stages. (Cancellation is decided first, so it never reaches here.)
 */
export function isWorkOrderDone(wo: HdmsReconWorkOrder): boolean {
  return (
    wo.status === 'done' ||
    DONE_AF_STATUSES.has(afStatus(wo)) ||
    !!wo.completed_date ||
    !!wo.verified_at ||
    wo.stage === 'VERIFY' ||
    wo.stage === 'CLOSED'
  );
}

function emptySummary(): Record<HdmsReconCategory, HdmsReconSummaryBucket> {
  return {
    done_billed: { count: 0, invoicedTotal: 0 },
    done_unbilled: { count: 0, invoicedTotal: 0 },
    not_done: { count: 0, invoicedTotal: 0 },
    billed_not_done: { count: 0, invoicedTotal: 0 },
    canceled: { count: 0, invoicedTotal: 0 },
  };
}

/**
 * Pure categorizer — buckets HDMS work orders against their invoices and
 * surfaces orphan invoices (billed but the WO isn't done / can't be found).
 * No I/O, so it is unit-tested directly.
 *
 * Only `doc_type = 'invoice'` rows count as "billed" — credit memos are
 * corrections, not the bill that discharges a WO.
 */
export function categorizeHdmsReconciliation(
  workOrders: HdmsReconWorkOrder[],
  invoices: HdmsReconInvoice[]
): HdmsReconciliation {
  const bills = invoices.filter((i) => i.doc_type === 'invoice' && i.status !== 'void');

  // Index invoices by both join keys (id, and wo_reference → wo_number),
  // mirroring lib/invoices.ts attachAssignedTech and the tripwire snapshot.
  const byWoId = new Map<string, HdmsReconInvoice>();
  const byWoRef = new Map<string, HdmsReconInvoice>();
  for (const inv of bills) {
    if (inv.work_order_id && !byWoId.has(inv.work_order_id)) byWoId.set(inv.work_order_id, inv);
    if (inv.wo_reference && !byWoRef.has(inv.wo_reference)) byWoRef.set(inv.wo_reference, inv);
  }

  const rows: HdmsReconRow[] = [];
  const summary = emptySummary();
  // Track which invoices matched a WO here, so the orphan pass can find the rest.
  const matchedInvoiceIds = new Set<string>();

  const woRow = (
    wo: HdmsReconWorkOrder,
    category: HdmsReconCategory,
    inv: HdmsReconInvoice | null
  ): HdmsReconRow => ({
    category,
    wo_id: wo.id,
    wo_number: wo.wo_number,
    unit_name: wo.unit_name,
    property_name: wo.property_name,
    description: wo.description,
    appfolio_status: wo.appfolio_status,
    assigned_tech: wo.assigned_tech || wo.assigned_to,
    owner_name: wo.owner_name,
    completed_date: wo.completed_date,
    appfolio_link: wo.appfolio_link,
    invoice_code: inv?.invoice_code ?? null,
    invoice_status: inv?.status ?? null,
    invoice_total: inv?.total_amount ?? null,
  });

  for (const wo of workOrders) {
    const inv =
      byWoId.get(wo.id) ?? (wo.wo_number ? byWoRef.get(wo.wo_number) : undefined) ?? null;
    if (inv) matchedInvoiceIds.add(inv.id);

    let category: HdmsReconCategory;
    if (isWorkOrderCanceled(wo)) {
      category = 'canceled';
    } else if (isWorkOrderDone(wo)) {
      category = inv ? 'done_billed' : 'done_unbilled';
    } else {
      // Not done. If it somehow already has an invoice, that's a premature bill.
      category = inv ? 'billed_not_done' : 'not_done';
    }

    const row = woRow(wo, category, inv);
    rows.push(row);
    summary[category].count += 1;
    summary[category].invoicedTotal += row.invoice_total ?? 0;
  }

  // Orphan invoices: a real bill exists but no in-window HDMS WO claimed it.
  for (const inv of bills) {
    if (matchedInvoiceIds.has(inv.id)) continue;
    const row: HdmsReconRow = {
      category: 'billed_not_done',
      wo_id: inv.work_order_id,
      wo_number: inv.wo_reference,
      unit_name: null,
      property_name: null,
      description: null,
      appfolio_status: null,
      assigned_tech: null,
      owner_name: null,
      completed_date: null,
      appfolio_link: null,
      invoice_code: inv.invoice_code,
      invoice_status: inv.status,
      invoice_total: inv.total_amount ?? null,
    };
    rows.push(row);
    summary.billed_not_done.count += 1;
    summary.billed_not_done.invoicedTotal += inv.total_amount ?? 0;
  }

  return { generatedAt: new Date().toISOString(), windowDays: 0, summary, rows };
}

const WO_COLUMNS =
  'id, wo_number, unit_name, property_name, description, appfolio_status, status, stage, assigned_to, assigned_tech, owner_name, vendor_id, vendor_name, completed_date, canceled_date, verified_at, appfolio_link';

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
  const INV_COLUMNS = 'id, invoice_code, status, doc_type, total_amount, work_order_id, wo_reference';

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
