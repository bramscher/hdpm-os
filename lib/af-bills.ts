// ============================================
// AppFolio HDMS bill snapshot (af_bills)
// ============================================
// Mirrors AppFolio vendor bills for HDMS so every internal invoice can be
// checked against what was actually billed in AppFolio (amounts side by side,
// unbilled invoices flagged). v0 bills carry no WorkOrderId — matching keys
// off the bill Reference (invoice number or WO reference), with a manual
// match fallback for the rest.

import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchBillsUpdatedSince, type V0Bill } from '@/lib/appfolio';
import type { HdmsInvoice } from '@/lib/invoices';

/** AppFolio vendor "High Desert Maintenance Services - Division of HDPM". */
export const HDMS_VENDOR_ID =
  process.env.APPFOLIO_HDMS_VENDOR_ID || 'ea74594e-0c1f-11f1-ad37-0ec3c4e2b1e7';

/** HDMS bills exist in AppFolio from mid-Feb 2026; first sync backfills from here. */
const BACKFILL_FROM = '2026-02-01T00:00:00Z';

/** Re-fetch this many days before the checkpoint to absorb clock skew / late edits. */
const CHECKPOINT_OVERLAP_DAYS = 3;

export type MatchMethod =
  | 'reference'
  | 'wo_reference'
  | 'description'
  | 'manual'
  | 'manual_unmatched';

export interface AfBill {
  id: string;
  appfolio_bill_id: string;
  reference: string | null;
  description: string | null;
  vendor_id: string;
  total_amount: number;
  invoice_date: string | null;
  due_date: string | null;
  approval_status: string | null;
  af_last_updated_at: string | null;
  hdms_invoice_id: string | null;
  match_method: MatchMethod | null;
  synced_at: string;
}

/** Bill row joined with its matched invoice (for the billing table). */
export interface AfBillWithInvoice extends AfBill {
  invoice: {
    id: string;
    invoice_code: string;
    total_amount: number;
    status: string;
    wo_reference: string | null;
    property_name: string;
  } | null;
}

export interface AfBillSummary {
  bill_count: number;
  matched_count: number;
  unmatched_count: number;
  billed_total: number;
  last_synced_at: string | null;
}

export interface SyncResult {
  fetched: number;
  hdms_bills: number;
  upserted: number;
  auto_matched: number;
  unmatched: number;
}

// ============================================
// Matching
// ============================================

export interface MatchTarget {
  id: string;
  invoice_number: number;
  wo_reference: string | null;
}

/**
 * Match one bill against the invoice set. Validated against live data
 * (2026-07-22 dry run: 204/225 bills auto-match, 201 to the cent):
 *   1. Reference is the invoice/credit number — "000064", "HDMS-INV-000064",
 *      or "HDMS-CR-000064" (a credit memo's negative bill; credits share the
 *      invoice number sequence, so the number resolves to exactly one document)
 *   2. Reference is a WO reference — "41548-1" (must be unique among invoices)
 *   3. Description starts with a WO reference — "42017-1 - Purchase new …"
 */
export function matchBill(
  bill: Pick<AfBill, 'reference' | 'description'>,
  byNumber: Map<number, MatchTarget>,
  byWoRef: Map<string, MatchTarget[]>
): { invoiceId: string; method: MatchMethod } | null {
  const ref = (bill.reference || '').trim();

  // Invoice/credit numbers are 4-digit-max sequence values; a 5+-digit reference
  // is a WO number, not a document number. Accept the INV- or CR- prefix — both
  // draw from one sequence, so the bare number maps to a single row.
  const numMatch = ref.match(/^(?:HDMS-(?:INV|CR)-)?0*(\d{1,4})$/i);
  if (numMatch) {
    const inv = byNumber.get(parseInt(numMatch[1], 10));
    if (inv) return { invoiceId: inv.id, method: 'reference' };
  }

  const woMatches = byWoRef.get(ref);
  if (woMatches?.length === 1) {
    return { invoiceId: woMatches[0].id, method: 'wo_reference' };
  }

  const descMatch = (bill.description || '').match(/^(\d{5}-\d+)/);
  if (descMatch) {
    const descMatches = byWoRef.get(descMatch[1]);
    if (descMatches?.length === 1) {
      return { invoiceId: descMatches[0].id, method: 'description' };
    }
  }

  return null;
}

export async function loadMatchTargets(): Promise<{
  byNumber: Map<number, MatchTarget>;
  byWoRef: Map<string, MatchTarget[]>;
}> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('hdms_invoices')
    .select('id, invoice_number, wo_reference, status')
    .neq('status', 'void');
  if (error) throw new Error(`Failed to load invoices for matching: ${error.message}`);

  const byNumber = new Map<number, MatchTarget>();
  const byWoRef = new Map<string, MatchTarget[]>();
  for (const inv of (data ?? []) as (MatchTarget & { status: string })[]) {
    byNumber.set(inv.invoice_number, inv);
    if (inv.wo_reference) {
      const list = byWoRef.get(inv.wo_reference) ?? [];
      list.push(inv);
      byWoRef.set(inv.wo_reference, list);
    }
  }
  return { byNumber, byWoRef };
}

/**
 * Auto-match all unlinked bills. Skips bills a user explicitly unmatched
 * (match_method = 'manual_unmatched') so a sync never undoes a human call.
 * Returns the number of bills newly matched.
 */
export async function autoMatchBills(): Promise<number> {
  const supabase = getSupabaseAdmin();

  const { data: bills, error } = await supabase
    .from('af_bills')
    .select('id, reference, description, match_method')
    .is('hdms_invoice_id', null);
  if (error) throw new Error(`Failed to load unmatched bills: ${error.message}`);

  const candidates = (bills ?? []).filter((b) => b.match_method !== 'manual_unmatched');
  if (candidates.length === 0) return 0;

  const { byNumber, byWoRef } = await loadMatchTargets();

  let matched = 0;
  for (const bill of candidates) {
    const hit = matchBill(bill, byNumber, byWoRef);
    if (!hit) continue;
    const { error: updateError } = await supabase
      .from('af_bills')
      .update({ hdms_invoice_id: hit.invoiceId, match_method: hit.method })
      .eq('id', bill.id);
    if (updateError) {
      console.error(`[AF Bills] Failed to link bill ${bill.id}:`, updateError);
    } else {
      matched++;
    }
  }
  return matched;
}

// ============================================
// Sync
// ============================================

function billToRow(bill: V0Bill) {
  return {
    appfolio_bill_id: bill.Id,
    reference: bill.Reference?.trim() || null,
    description: bill.Description?.trim() || null,
    vendor_id: bill.VendorId as string,
    total_amount: parseFloat(bill.TotalAmount || '0') || 0,
    invoice_date: bill.InvoiceDate || null,
    due_date: bill.DueDate || null,
    approval_status: bill.ApprovalStatus || null,
    af_last_updated_at: bill.LastUpdatedAt || null,
    synced_at: new Date().toISOString(),
  };
}

/**
 * Incremental sync of HDMS bills from AppFolio: fetch everything updated since
 * the checkpoint (max af_last_updated_at, minus a safety overlap), keep only
 * HDMS-vendor bills, upsert, then auto-match. The upsert payload deliberately
 * omits hdms_invoice_id/match_method so re-syncing never clobbers a match.
 */
export async function syncAfBills(): Promise<SyncResult> {
  const supabase = getSupabaseAdmin();

  const { data: latest } = await supabase
    .from('af_bills')
    .select('af_last_updated_at')
    .not('af_last_updated_at', 'is', null)
    .order('af_last_updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let since = BACKFILL_FROM;
  if (latest?.af_last_updated_at) {
    const d = new Date(latest.af_last_updated_at);
    d.setDate(d.getDate() - CHECKPOINT_OVERLAP_DAYS);
    since = d.toISOString();
  }

  const all = await fetchBillsUpdatedSince(since);
  const hdmsBills = all.filter((b) => b.VendorId === HDMS_VENDOR_ID && b.Id);

  let upserted = 0;
  const UPSERT_CHUNK = 200;
  for (let c = 0; c < hdmsBills.length; c += UPSERT_CHUNK) {
    const rows = hdmsBills.slice(c, c + UPSERT_CHUNK).map(billToRow);
    const { error } = await supabase
      .from('af_bills')
      .upsert(rows, { onConflict: 'appfolio_bill_id' });
    if (error) throw new Error(`Failed to upsert bills: ${error.message}`);
    upserted += rows.length;
  }

  const autoMatched = await autoMatchBills();

  const { count } = await supabase
    .from('af_bills')
    .select('id', { count: 'exact', head: true })
    .is('hdms_invoice_id', null);

  return {
    fetched: all.length,
    hdms_bills: hdmsBills.length,
    upserted,
    auto_matched: autoMatched,
    unmatched: count ?? 0,
  };
}

/**
 * Upsert + auto-match a single bill (webhook path). No-op for other vendors.
 */
export async function upsertAfBillFromWebhook(raw: Record<string, unknown>): Promise<boolean> {
  const bill = raw as unknown as V0Bill;
  if (!bill?.Id || bill.VendorId !== HDMS_VENDOR_ID) return false;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('af_bills')
    .upsert([billToRow(bill)], { onConflict: 'appfolio_bill_id' });
  if (error) {
    console.error('[AF Bills] Webhook upsert failed:', error);
    return false;
  }
  await autoMatchBills();
  return true;
}

// ============================================
// Reads
// ============================================

export async function getAfBills(): Promise<{ bills: AfBillWithInvoice[]; summary: AfBillSummary }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('af_bills')
    .select(
      '*, invoice:hdms_invoices(id, invoice_code, total_amount, status, wo_reference, property_name)'
    )
    .order('invoice_date', { ascending: false });
  if (error) throw new Error(`Failed to fetch AppFolio bills: ${error.message}`);

  const bills = (data ?? []) as AfBillWithInvoice[];
  const matched = bills.filter((b) => b.hdms_invoice_id);
  const summary: AfBillSummary = {
    bill_count: bills.length,
    matched_count: matched.length,
    unmatched_count: bills.length - matched.length,
    billed_total: bills.reduce((s, b) => s + Number(b.total_amount || 0), 0),
    last_synced_at: bills.reduce<string | null>(
      (max, b) => (max && max > b.synced_at ? max : b.synced_at),
      null
    ),
  };
  return { bills, summary };
}

export async function matchAfBill(billId: string, invoiceId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('af_bills')
    .update({ hdms_invoice_id: invoiceId, match_method: 'manual' })
    .eq('id', billId);
  if (error) throw new Error(`Failed to match bill: ${error.message}`);
}

export async function unmatchAfBill(billId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  // 'manual_unmatched' keeps auto-match from re-linking a bill a human unlinked.
  const { error } = await supabase
    .from('af_bills')
    .update({ hdms_invoice_id: null, match_method: 'manual_unmatched' })
    .eq('id', billId);
  if (error) throw new Error(`Failed to unmatch bill: ${error.message}`);
}

// ============================================
// Invoice decoration
// ============================================

/** AF-billing comparison fields attached to invoices at fetch time. */
export interface AfBillingFields {
  /** Sum of matched AppFolio bills (null when no bill is matched). */
  af_billed_total: number | null;
  af_bill_count: number;
  /**
   * match     — billed in AppFolio, amounts agree to the cent
   * mismatch  — billed, amounts differ
   * unbilled  — no AppFolio bill matched (generated/attached invoices only)
   */
  af_bill_status: 'match' | 'mismatch' | 'unbilled' | null;
}

const INVOICE_LOOKUP_CHUNK = 500;

/**
 * Attach af_billed_total / af_bill_count / af_bill_status to each invoice.
 * Lookup failures degrade to undecorated invoices rather than failing the fetch.
 */
export async function attachAfBillsToInvoices<T extends HdmsInvoice>(
  invoices: T[]
): Promise<(T & AfBillingFields)[]> {
  const supabase = getSupabaseAdmin();
  const ids = invoices.map((i) => i.id);

  const totals = new Map<string, { total: number; count: number }>();
  for (let c = 0; c < ids.length; c += INVOICE_LOOKUP_CHUNK) {
    const { data, error } = await supabase
      .from('af_bills')
      .select('hdms_invoice_id, total_amount')
      .in('hdms_invoice_id', ids.slice(c, c + INVOICE_LOOKUP_CHUNK));
    if (error) {
      console.error('[AF Bills] Invoice decoration lookup failed:', error);
      continue;
    }
    for (const row of data ?? []) {
      if (!row.hdms_invoice_id) continue;
      const cur = totals.get(row.hdms_invoice_id) ?? { total: 0, count: 0 };
      cur.total += Number(row.total_amount || 0);
      cur.count += 1;
      totals.set(row.hdms_invoice_id, cur);
    }
  }

  return invoices.map((inv) => {
    const hit = totals.get(inv.id);
    if (hit) {
      const status =
        Math.abs(hit.total - Number(inv.total_amount)) < 0.005 ? 'match' : 'mismatch';
      return { ...inv, af_billed_total: hit.total, af_bill_count: hit.count, af_bill_status: status };
    }
    // Only finished invoices are expected in AppFolio; drafts/void aren't "unbilled".
    const expectsBill = inv.status === 'generated' || inv.status === 'attached';
    return {
      ...inv,
      af_billed_total: null,
      af_bill_count: 0,
      af_bill_status: expectsBill ? 'unbilled' : null,
    };
  });
}
