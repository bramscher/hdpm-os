/**
 * Payouts + 1099 readiness (Batch 8) — pure helpers, unit-tested.
 *
 * Money moves in QuickBooks; this side decides what's payable, writes the
 * QuickBooks import file, groups payments into batches, and totals each
 * referrer's paid bounties per tax year against the 1099-NEC threshold.
 * Tax IDs never appear in the payout file; only the 1099 worksheet can carry
 * them, and only when an admin asks (see payouts-server.ts).
 */

import { bountyStatus, payableAmount } from './bounty';
import type { LedgerEntry } from './types';

export interface PayeePartner {
  id: string;
  display_name: string;
  company: string | null;
  email: string | null;
  legal_name: string | null;
  tax_id_last4: string | null;
  tax_address: Record<string, unknown> | null;
  w9_status: string;
}

export interface PayableRow {
  leadId: string;
  partnerId: string;
  prospectName: string;
  payee: string;
  amount: number;
  approvedAt: string;
  readiness: TaxReadiness;
}

type LedgerLite = Pick<LedgerEntry, 'lead_id' | 'partner_id' | 'entry_type' | 'amount' | 'created_at'>;

/** Payee name for QuickBooks / 1099: the legal name from the W-9, else the display name. */
export const payeeName = (p: Pick<PayeePartner, 'legal_name' | 'display_name'>) => (p.legal_name ?? '').trim() || p.display_name;

/** Approved-but-unpaid bounties, oldest approval first. */
export function readyToPay(
  entries: LedgerLite[],
  leads: Map<string, { prospect_name: string }>,
  partners: Map<string, PayeePartner>
): PayableRow[] {
  const byLead = new Map<string, LedgerLite[]>();
  for (const e of entries) if (e.lead_id) byLead.set(e.lead_id, [...(byLead.get(e.lead_id) ?? []), e]);
  const rows: PayableRow[] = [];
  for (const [leadId, list] of byLead) {
    if (bountyStatus(list) !== 'approved') continue;
    const partner = partners.get(list[0].partner_id);
    if (!partner) continue;
    rows.push({
      leadId,
      partnerId: partner.id,
      prospectName: leads.get(leadId)?.prospect_name ?? '(lead)',
      payee: payeeName(partner),
      amount: payableAmount(list),
      approvedAt: list.find((e) => e.entry_type === 'approved')!.created_at,
      readiness: taxReadiness(partner),
    });
  }
  return rows.sort((a, b) => a.approvedAt.localeCompare(b.approvedAt));
}

export interface TaxReadiness {
  legalName: boolean;
  taxId: boolean;
  address: boolean;
  w9: boolean;
  ready: boolean;
  missing: string[];
}

/** What a 1099-NEC needs: legal name, TIN, mailing address, and a W-9 on file. */
export function taxReadiness(p: Pick<PayeePartner, 'legal_name' | 'tax_id_last4' | 'tax_address' | 'w9_status'>): TaxReadiness {
  const a = (p.tax_address ?? {}) as Record<string, unknown>;
  const has = (k: string) => typeof a[k] === 'string' && (a[k] as string).trim().length > 0;
  const r = {
    legalName: !!p.legal_name?.trim(),
    taxId: !!p.tax_id_last4?.trim(),
    address: has('line1') && has('city') && has('state') && has('zip'),
    w9: p.w9_status === 'on_file' || p.w9_status === 'verified',
  };
  const missing = [
    !r.legalName && 'legal name',
    !r.taxId && 'tax ID',
    !r.address && 'mailing address',
    !r.w9 && 'W-9',
  ].filter((x): x is string => !!x);
  return { ...r, ready: missing.length === 0, missing };
}

/** QuickBooks expense/bill import columns. Deliberately no tax IDs. */
export const QB_COLUMNS = ['Payee', 'Date', 'Amount', 'Account', 'Memo', 'Ref no'] as const;
export const QB_ACCOUNT = 'Referral Fees';

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** `date` is YYYY-MM-DD. US date format, as QuickBooks Online imports expect. */
export function quickbooksCsv(rows: Pick<PayableRow, 'payee' | 'amount' | 'prospectName' | 'leadId'>[], date: string, refNo: string): string {
  const [y, m, d] = date.split('-');
  const usDate = `${m}/${d}/${y}`;
  const lines = [QB_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [r.payee, usDate, r.amount.toFixed(2), QB_ACCOUNT, `Referral bounty — ${r.prospectName}`, refNo].map(csvCell).join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** `PAY-20261005-a1b2`: date + 4 random chars, so same-day batches stay distinct. */
export function newBatchId(date: Date, rand: () => number = Math.random): string {
  const ymd = pacificDate(date).replace(/-/g, '');
  const tail = Array.from({ length: 4 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(rand() * 31)]).join('');
  return `PAY-${ymd}-${tail}`;
}

const pacificFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
/** YYYY-MM-DD in Pacific time. */
export const pacificDate = (d: Date) => pacificFmt.format(d);

/**
 * 1099-NEC reporting threshold by tax year: $600 through 2025; $2,000 for
 * payments made from 2026 (raised by the 2025 tax law, indexed after 2026).
 * Confirm with the accountant each year; this is the one place to change it.
 */
export function form1099Threshold(taxYear: number): number {
  return taxYear >= 2026 ? 2000 : 600;
}

export interface TaxYearTotal {
  partnerId: string;
  paid: number;
  payments: number;
}

/** Sum each referrer's `paid` rows dated (Pacific) in the tax year. */
export function taxYearTotals(entries: LedgerLite[], taxYear: number): TaxYearTotal[] {
  const by = new Map<string, TaxYearTotal>();
  for (const e of entries) {
    if (e.entry_type !== 'paid') continue;
    if (Number(pacificDate(new Date(e.created_at)).slice(0, 4)) !== taxYear) continue;
    const t = by.get(e.partner_id) ?? { partnerId: e.partner_id, paid: 0, payments: 0 };
    t.paid = Math.round((t.paid + Number(e.amount)) * 100) / 100;
    t.payments += 1;
    by.set(e.partner_id, t);
  }
  return [...by.values()].sort((a, b) => b.paid - a.paid);
}

/** `***-**-1234` (SSN shape works for display whether it's an SSN or EIN). */
export const maskTin = (last4: string | null) => (last4 ? `***-**-${last4}` : '');

/** Format a decrypted TIN: 9 digits → SSN shape; otherwise as entered. */
export function formatTin(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : raw;
}

export interface PaymentBatch {
  batchId: string;
  paidAt: string;
  reference: string | null;
  count: number;
  total: number;
  actor: string;
}

/** Past payouts grouped by batch (single payments without a batch id group by themselves). */
export function paymentBatches(entries: (LedgerLite & Pick<LedgerEntry, 'batch_id' | 'qbo_reference' | 'actor' | 'id'>)[]): PaymentBatch[] {
  const by = new Map<string, PaymentBatch>();
  for (const e of entries) {
    if (e.entry_type !== 'paid') continue;
    const key = e.batch_id ?? `single-${e.id}`;
    const b = by.get(key) ?? { batchId: e.batch_id ?? '(single payment)', paidAt: e.created_at, reference: e.qbo_reference, count: 0, total: 0, actor: e.actor };
    b.count += 1;
    b.total = Math.round((b.total + Number(e.amount)) * 100) / 100;
    if (e.created_at > b.paidAt) b.paidAt = e.created_at;
    by.set(key, b);
  }
  return [...by.values()].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}
