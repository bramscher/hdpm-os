// ============================================
// HDMS reconciliation — pure types + categorizer (client-safe)
// ============================================
// No server-only imports live here, so both the API loader
// (hdms-reconcile.ts) and the client report component can import from it.
// See hdms-reconcile.ts for the Supabase-backed loader.

/**
 * Maintenance-OS launch date. Work AppFolio-completed before this predates our
 * invoicing module — it was billed (or not) directly in AppFolio, and our
 * hdms_invoices table didn't exist yet — so a pre-launch "done, not billed" row
 * is almost always noise, not a real leak. Mirrors LAUNCH_CUTOFF in
 * lib/maintenance/sync-rules.ts (kept as a literal to stay client-safe).
 */
export const PRE_LAUNCH_CUTOFF = '2026-07-01';

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

/**
 * Where the "billed" signal came from:
 *  - 'system'   a non-void hdms_invoices row (our invoice module)
 *  - 'appfolio' an HDMS bill on the WO in AppFolio (Reports API bill_detail),
 *               billed directly without going through our invoice module
 *  - 'both'     both of the above
 *  - null       not billed anywhere we can see → a real leak when done
 */
export type BilledSource = 'system' | 'appfolio' | 'both' | null;

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
  /** True when the job was completed before PRE_LAUNCH_CUTOFF (grandfathered). */
  pre_launch: boolean;
  appfolio_link: string | null;
  invoice_code: string | null;
  invoice_status: string | null;
  invoice_total: number | null;
  billed_source: BilledSource;
  /** HDMS bill total on this WO in AppFolio (Reports API), when known. */
  appfolio_bill_total: number | null;
}

export interface HdmsReconSummaryBucket {
  count: number;
  invoicedTotal: number;
}

export interface HdmsReconciliation {
  generatedAt: string;
  windowDays: number;
  /** Whether AppFolio-direct HDMS bills were folded in (Reports API configured). */
  appfolioBillsIncluded: boolean;
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
  invoices: HdmsReconInvoice[],
  // wo_number → HDMS bill total on that WO in AppFolio (Reports API bill_detail).
  // Empty when the Reports API isn't configured (falls back to system-only).
  appfolioBilledWos: Map<string, number> = new Map()
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
  const matchedInvoiceIds = new Set<string>();

  const isPreLaunch = (wo: HdmsReconWorkOrder): boolean =>
    !!wo.completed_date && wo.completed_date.slice(0, 10) < PRE_LAUNCH_CUTOFF;

  const woRow = (
    wo: HdmsReconWorkOrder,
    category: HdmsReconCategory,
    inv: HdmsReconInvoice | null,
    billed_source: BilledSource,
    appfolio_bill_total: number | null
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
    pre_launch: isPreLaunch(wo),
    appfolio_link: wo.appfolio_link,
    invoice_code: inv?.invoice_code ?? null,
    invoice_status: inv?.status ?? null,
    invoice_total: inv?.total_amount ?? null,
    billed_source,
    appfolio_bill_total,
  });

  for (const wo of workOrders) {
    const inv =
      byWoId.get(wo.id) ?? (wo.wo_number ? byWoRef.get(wo.wo_number) : undefined) ?? null;
    if (inv) matchedInvoiceIds.add(inv.id);

    // A WO counts as billed if it has our invoice OR an HDMS bill in AppFolio.
    const afBillTotal = wo.wo_number ? appfolioBilledWos.get(wo.wo_number) ?? null : null;
    const hasSystem = !!inv;
    const hasAppfolio = afBillTotal != null;
    const billed = hasSystem || hasAppfolio;
    const billed_source: BilledSource = hasSystem
      ? hasAppfolio
        ? 'both'
        : 'system'
      : hasAppfolio
        ? 'appfolio'
        : null;

    let category: HdmsReconCategory;
    if (isWorkOrderCanceled(wo)) {
      category = 'canceled';
    } else if (isWorkOrderDone(wo)) {
      category = billed ? 'done_billed' : 'done_unbilled';
    } else {
      category = billed ? 'billed_not_done' : 'not_done';
    }

    const row = woRow(wo, category, inv, billed_source, afBillTotal);
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
      pre_launch: false,
      appfolio_link: null,
      invoice_code: inv.invoice_code,
      invoice_status: inv.status,
      invoice_total: inv.total_amount ?? null,
      billed_source: 'system',
      appfolio_bill_total: null,
    };
    rows.push(row);
    summary.billed_not_done.count += 1;
    summary.billed_not_done.invoicedTotal += inv.total_amount ?? 0;
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: 0,
    appfolioBillsIncluded: appfolioBilledWos.size > 0,
    summary,
    rows,
  };
}
