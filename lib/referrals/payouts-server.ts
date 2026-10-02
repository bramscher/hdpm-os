/**
 * Payouts + 1099 (Batch 8) — server side. Admin path, service role.
 *
 * The only place that decrypts referrer tax IDs: taxWorksheet(..., includeTins)
 * logs a `tin_decrypted` audit event per referrer it decrypts.
 */

import * as XLSX from 'xlsx';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { decryptField, isEncrypted } from './crypto';
import { BountyActionError, markBountyPaid } from './ledger';
import { signedDocUrl } from './storage';
import {
  form1099Threshold,
  formatTin,
  maskTin,
  newBatchId,
  pacificDate,
  payeeName,
  paymentBatches,
  readyToPay,
  taxReadiness,
  taxYearTotals,
  type PayableRow,
  type PayeePartner,
  type PaymentBatch,
} from './payouts';
import type { LedgerEntry } from './types';

const PAYEE_COLS = 'id, display_name, company, email, legal_name, tax_id_last4, tax_address, w9_status';

async function loadLedger(): Promise<LedgerEntry[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('referral_ledger')
    .select('id, partner_id, lead_id, entry_type, amount, created_at, batch_id, qbo_reference, actor, reason, period')
    .eq('org_id', 'hdpm')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`payouts ledger: ${error.message}`);
  return (data ?? []) as LedgerEntry[];
}

async function loadPartners(): Promise<Map<string, PayeePartner>> {
  const { data, error } = await getSupabaseAdmin().from('referral_partner').select(PAYEE_COLS).eq('org_id', 'hdpm');
  if (error) throw new Error(`payouts partners: ${error.message}`);
  return new Map(((data ?? []) as PayeePartner[]).map((p) => [p.id, p]));
}

async function loadLeadNames(ids: string[]): Promise<Map<string, { prospect_name: string }>> {
  if (ids.length === 0) return new Map();
  const { data } = await getSupabaseAdmin().from('referral_lead').select('id, prospect_name').in('id', ids);
  return new Map((data ?? []).map((l) => [l.id as string, { prospect_name: l.prospect_name as string }]));
}

export async function getPayoutsOverview(): Promise<{ ready: PayableRow[]; batches: PaymentBatch[] }> {
  const [ledger, partners] = await Promise.all([loadLedger(), loadPartners()]);
  const leadIds = [...new Set(ledger.map((e) => e.lead_id).filter((x): x is string => !!x))];
  const leads = await loadLeadNames(leadIds);
  return { ready: readyToPay(ledger, leads, partners), batches: paymentBatches(ledger) };
}

/** The selected approved bounties, as QuickBooks import rows. Unknown / not-approved ids are dropped. */
export async function payableRows(leadIds: string[]): Promise<PayableRow[]> {
  const { ready } = await getPayoutsOverview();
  const want = new Set(leadIds);
  return ready.filter((r) => want.has(r.leadId));
}

export interface BatchResult {
  batchId: string;
  paid: { leadId: string; amount: number }[];
  failed: { leadId: string; error: string }[];
}

/** Mark several approved bounties paid under one batch id + payment reference. */
export async function payBatch(leadIds: string[], reference: string, actor: string): Promise<BatchResult> {
  const ref = reference.trim();
  if (!ref) throw new BountyActionError('Enter the payment reference for this batch (e.g. the QuickBooks check run).', 400);
  const rows = await payableRows(leadIds);
  if (rows.length === 0) throw new BountyActionError('None of the selected bounties are approved and unpaid.', 400);
  const batchId = newBatchId(new Date());
  const result: BatchResult = { batchId, paid: [], failed: [] };
  for (const r of rows) {
    try {
      await markBountyPaid(r.leadId, actor, ref, batchId);
      result.paid.push({ leadId: r.leadId, amount: r.amount });
    } catch (err) {
      result.failed.push({ leadId: r.leadId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const id of leadIds) if (!rows.some((r) => r.leadId === id)) result.failed.push({ leadId: id, error: 'Not approved and unpaid' });
  await logAudit('referral_payout_batch', batchId, 'paid', actor, {
    reference: ref,
    paid: result.paid.length,
    total: Math.round(result.paid.reduce((n, p) => n + p.amount, 0) * 100) / 100,
    failed: result.failed.length,
  });
  return result;
}

export interface TaxYearRow {
  partnerId: string;
  payee: string;
  displayName: string;
  email: string | null;
  paid: number;
  payments: number;
  overThreshold: boolean;
  readiness: ReturnType<typeof taxReadiness>;
  tinMasked: string;
  address: string;
}

const addressLine = (a: Record<string, unknown> | null) => {
  const x = (a ?? {}) as Record<string, string | undefined>;
  return [x.line1, [x.city, x.state].filter(Boolean).join(', '), x.zip].filter(Boolean).join(' ').trim();
};

export async function getTaxYear(taxYear: number): Promise<{ threshold: number; rows: TaxYearRow[] }> {
  const [ledger, partners] = await Promise.all([loadLedger(), loadPartners()]);
  const threshold = form1099Threshold(taxYear);
  const rows = taxYearTotals(ledger, taxYear).flatMap((t) => {
    const p = partners.get(t.partnerId);
    if (!p) return [];
    return [{
      partnerId: p.id,
      payee: payeeName(p),
      displayName: p.display_name,
      email: p.email,
      paid: t.paid,
      payments: t.payments,
      overThreshold: t.paid >= threshold,
      readiness: taxReadiness(p),
      tinMasked: maskTin(p.tax_id_last4),
      address: addressLine(p.tax_address),
    }];
  });
  return { threshold, rows };
}

/** XLSX worksheet for 1099-NEC prep. Full TINs only when asked, each decrypt audited. */
export async function taxWorksheet(taxYear: number, includeTins: boolean, actor: string): Promise<Uint8Array> {
  const { threshold, rows } = await getTaxYear(taxYear);
  let tins = new Map<string, string>();
  if (includeTins && rows.length > 0) {
    const { data } = await getSupabaseAdmin().from('referral_partner').select('id, tax_id_encrypted').in('id', rows.map((r) => r.partnerId));
    tins = new Map(
      (data ?? []).flatMap((p) => {
        const enc = p.tax_id_encrypted as string | null;
        if (!enc || !isEncrypted(enc)) return [];
        try {
          return [[p.id as string, formatTin(decryptField(enc))] as [string, string]];
        } catch {
          return [[p.id as string, 'DECRYPT FAILED'] as [string, string]];
        }
      })
    );
    for (const id of tins.keys()) await logAudit('referral_partner', id, 'tin_decrypted', actor, { purpose: `1099 worksheet ${taxYear}` });
  }
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      'Payee (legal name)': r.payee,
      'Display name': r.displayName,
      TIN: includeTins ? tins.get(r.partnerId) ?? '' : r.tinMasked,
      'Mailing address': r.address,
      Email: r.email ?? '',
      [`Paid in ${taxYear}`]: r.paid,
      Payments: r.payments,
      [`Needs 1099-NEC (≥ $${threshold.toLocaleString()})`]: r.overThreshold ? 'Yes' : 'No',
      'Missing for 1099': r.readiness.missing.join(', '),
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, `1099 ${taxYear}`);
  const notes = XLSX.utils.aoa_to_sheet([
    ['Generated', pacificDate(new Date())],
    ['Threshold', `$${threshold.toLocaleString()} (confirm with your accountant)`],
    ['TINs', includeTins ? 'Included — keep this file secure and delete after filing' : 'Masked'],
  ]);
  XLSX.utils.book_append_sheet(wb, notes, 'Notes');
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
}

/** Short-lived W-9 link for an admin; each view is audited. */
export async function w9Link(partnerId: string, actor: string): Promise<string> {
  const { data } = await getSupabaseAdmin().from('referral_partner').select('w9_doc_path').eq('id', partnerId).maybeSingle();
  if (!data?.w9_doc_path) throw new BountyActionError('No W-9 on file for this referrer.', 400);
  const url = await signedDocUrl(data.w9_doc_path as string, 120);
  await logAudit('referral_partner', partnerId, 'w9_viewed', actor);
  return url;
}

export async function markW9Verified(partnerId: string, actor: string): Promise<void> {
  const { data } = await getSupabaseAdmin().from('referral_partner').select('w9_doc_path, w9_status').eq('id', partnerId).maybeSingle();
  if (!data?.w9_doc_path) throw new BountyActionError('Upload or collect a W-9 before verifying it.', 400);
  const { error } = await getSupabaseAdmin()
    .from('referral_partner')
    .update({ w9_status: 'verified', updated_at: new Date().toISOString() })
    .eq('id', partnerId);
  if (error) throw new Error(`markW9Verified: ${error.message}`);
  await logAudit('referral_partner', partnerId, 'w9_verified', actor, { from: data.w9_status });
}
