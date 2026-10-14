/**
 * Has a work order's invoice or bill reached AppFolio? Two Reports API
 * signals, mirrored into wo_af_billing by /api/maintenance/cron/af-billing:
 *   - work_order.vendor_portal_invoices: invoices uploaded to the work order
 *   - bill_detail lines whose work_order is this one: bills entered against it
 * The core (v0) API has no attachments endpoint and its bills carry no work
 * order, so this is the only automatic link. The files can't be fetched.
 *
 * Join key: work order number (bill_detail.work_order = work_orders.wo_number,
 * the same join as lib/maintenance/hdms-reconcile.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { runReport } from '@/lib/appfolio-reports';

/** How far back to look. Turns and the chase board care about recent work. */
export const AF_BILLING_WINDOW_DAYS = 365;

/** The work_order report returns only open orders unless every status code is asked for. */
const ALL_STATUS_CODES = Array.from({ length: 16 }, (_, i) => String(i));

export interface AfWoReportRow {
  work_order_id?: number | string | null;
  work_order_number?: string | null;
  vendor_portal_invoices?: number | string | null;
}

export interface AfBillLine {
  work_order?: string | number | null;
  paid?: string | number | null;
  unpaid?: string | number | null;
  bill_date?: string | null;
}

export interface WoAfBilling {
  wo_number: string;
  af_work_order_id: number | null;
  invoice_count: number;
  bill_lines: number;
  billed_amount: number;
  paid_amount: number;
  unpaid_amount: number;
  last_bill_date: string | null;
  /**
   * In this run's work_order report. The report only covers recent work orders
   * (about the last quarter, whatever filter is sent), so a work order seen
   * only through its bills must not overwrite an invoice count saved earlier.
   */
  in_report: boolean;
}

const money = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** One row per work order number, merging uploaded-invoice counts with bill totals. */
export function summarizeAfBilling(wos: AfWoReportRow[], bills: AfBillLine[]): WoAfBilling[] {
  const out = new Map<string, WoAfBilling>();
  const row = (wo: string) => {
    let r = out.get(wo);
    if (!r) {
      r = { wo_number: wo, af_work_order_id: null, invoice_count: 0, bill_lines: 0, billed_amount: 0, paid_amount: 0, unpaid_amount: 0, last_bill_date: null, in_report: false };
      out.set(wo, r);
    }
    return r;
  };
  for (const w of wos) {
    const wo = String(w.work_order_number ?? '').trim();
    if (!wo) continue;
    const r = row(wo);
    r.in_report = true;
    const id = Number(w.work_order_id);
    r.af_work_order_id = Number.isFinite(id) && id > 0 ? id : r.af_work_order_id;
    r.invoice_count = Math.max(r.invoice_count, Math.max(0, Math.trunc(Number(w.vendor_portal_invoices) || 0)));
  }
  for (const b of bills) {
    const wo = String(b.work_order ?? '').trim();
    if (!wo) continue;
    const r = row(wo);
    const paid = money(b.paid);
    const unpaid = money(b.unpaid);
    r.bill_lines += 1;
    r.paid_amount = round2(r.paid_amount + paid);
    r.unpaid_amount = round2(r.unpaid_amount + unpaid);
    r.billed_amount = round2(r.paid_amount + r.unpaid_amount);
    const d = (b.bill_date ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!r.last_bill_date || d > r.last_bill_date)) r.last_bill_date = d;
  }
  return [...out.values()];
}

/** True when AppFolio shows the invoice arrived: one uploaded, or a bill entered. */
export const afInvoiceReceived = (b: Pick<WoAfBilling, 'invoice_count' | 'bill_lines'> | null | undefined) =>
  !!b && (b.invoice_count > 0 || b.bill_lines > 0);

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Pull both reports and upsert wo_af_billing. Returns counts for the cron log. */
export async function syncAfWoBilling(db: SupabaseClient): Promise<{ workOrders: number; withInvoice: number; withBill: number }> {
  const from = isoDaysAgo(AF_BILLING_WINDOW_DAYS);
  const to = new Date().toISOString().slice(0, 10);
  const wos = await runReport<AfWoReportRow>('work_order', {
    columns: ['work_order_id', 'work_order_number', 'vendor_portal_invoices'],
    work_order_statuses: ALL_STATUS_CODES,
    created_on_from: from,
  });
  // Fresh report runs are rate-limited (7 per 15s); the second waits a moment.
  await new Promise((r) => setTimeout(r, 2500));
  const bills = await runReport<AfBillLine>('bill_detail', {
    occurred_on_from: from,
    occurred_on_to: to,
    columns: ['work_order', 'paid', 'unpaid', 'bill_date'],
  });

  const rows = summarizeAfBilling(wos, bills);
  const syncedAt = new Date().toISOString();
  // Bill-only rows leave invoice_count / af_work_order_id as last saved (upsert
  // updates only the columns sent).
  const full = rows.filter((r) => r.in_report).map(({ in_report: _, ...r }) => ({ ...r, synced_at: syncedAt }));
  const billsOnly = rows
    .filter((r) => !r.in_report)
    .map(({ in_report: _, invoice_count: _c, af_work_order_id: _id, ...r }) => ({ ...r, synced_at: syncedAt }));
  for (const batch of [full, billsOnly]) {
    for (let i = 0; i < batch.length; i += 500) {
      const { error } = await db.from('wo_af_billing').upsert(batch.slice(i, i + 500), { onConflict: 'wo_number' });
      if (error) throw new Error(`wo_af_billing upsert failed: ${error.message}`);
    }
  }
  return {
    workOrders: rows.length,
    withInvoice: rows.filter((r) => r.invoice_count > 0).length,
    withBill: rows.filter((r) => r.bill_lines > 0).length,
  };
}

/** Stored AppFolio billing for these work order numbers. Before the migration: none. */
export async function loadAfBilling(db: SupabaseClient, woNumbers: string[]): Promise<Map<string, WoAfBilling & { synced_at: string }>> {
  const out = new Map<string, WoAfBilling & { synced_at: string }>();
  const nums = [...new Set(woNumbers.filter(Boolean))];
  if (!nums.length) return out;
  const { data, error } = await db.from('wo_af_billing').select('*').in('wo_number', nums);
  if (error) {
    console.error('[af-billing] unavailable (run 20261026_wo_af_billing.sql?):', error.message);
    return out;
  }
  for (const r of data ?? []) {
    out.set(r.wo_number, {
      ...r,
      billed_amount: Number(r.billed_amount),
      paid_amount: Number(r.paid_amount),
      unpaid_amount: Number(r.unpaid_amount),
    } as WoAfBilling & { synced_at: string });
  }
  return out;
}
