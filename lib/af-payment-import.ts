// ============================================
// AppFolio disbursement import
// ============================================
// Pulls HDMS trust-account disbursements from the AppFolio Reports API and
// turns each one into a captured payment with its covered invoices attached:
//
//   check_register — one row per disbursement (date, amount, "ACH Transaction")
//   bill_detail    — one row per bill line; payment_date + reference tell us
//                    which bills a disbursement paid, and the bill reference
//                    maps to our invoice (same matching as af_bills)
//
// Bills are grouped onto a disbursement by payment_date. If two HDMS
// disbursements share a date the bill grouping is ambiguous — the payments
// are still captured, but invoice attachment is skipped and flagged.

import { getSupabaseAdmin } from '@/lib/supabase';
import { runReport } from '@/lib/appfolio-reports';
import { matchBill, loadMatchTargets } from '@/lib/af-bills';
import { capturePayment, attachInvoices, DEFAULT_PAYEE, type Payment } from '@/lib/payments';

/** HDMS bills/disbursements exist in AppFolio from mid-Feb 2026. */
const IMPORT_FROM = '2026-02-01';

const HDMS_PAYEE_FRAGMENT = 'high desert maintenance';

interface CheckRegisterRow {
  check_number: string | null;
  occurred_date: string | null;
  payee_name: string | null;
  amount: string | number | null;
  bank_account: string | null;
}

interface BillDetailRow {
  reference_number: string | null;
  description: string | null;
  work_order: string | null;
  payee_name: string | null;
  paid: string | number | null;
  payment_date: string | null;
  check_number: string | null;
}

export interface ImportedDisbursement {
  paid_on: string;
  amount: number;
  reference: string | null;
  /** created = new payment; adopted = matched an existing manual capture; existing = already imported */
  outcome: 'created' | 'adopted' | 'existing' | 'ambiguous_date';
  payment_id: string | null;
  bills: number;
  billsPaidSum: number;
  attached: number;
  alreadyLinked: number;
  conflicts: string[]; // invoice codes linked to a different payment
  unmatchedRefs: string[]; // bill references we couldn't map to an invoice
}

export interface ImportResult {
  disbursements: ImportedDisbursement[];
  created: number;
  adopted: number;
  existing: number;
  attachedTotal: number;
}

function money(v: string | number | null | undefined): number {
  if (v == null) return 0;
  return parseFloat(String(v).replace(/,/g, '')) || 0;
}

function isHdms(payee: string | null | undefined): boolean {
  return (payee || '').toLowerCase().includes(HDMS_PAYEE_FRAGMENT);
}

function todayInput(): string {
  return new Date().toISOString().split('T')[0];
}

export async function importAppfolioPayments(createdBy: string): Promise<ImportResult> {
  const supabase = getSupabaseAdmin();
  const to = todayInput();

  // ── 1. Disbursements to HDMS from the check register ──────────────
  const checks = await runReport<CheckRegisterRow>('check_register', {
    occurred_on_from: IMPORT_FROM,
    occurred_on_to: to,
    columns: ['check_number', 'occurred_date', 'payee_name', 'amount', 'bank_account'],
  });
  const disbursements = checks.filter(
    (c) => isHdms(c.payee_name) && c.occurred_date && money(c.amount) > 0
  );

  // ── 2. Paid HDMS bill lines, grouped by payment date ──────────────
  const billRows = await runReport<BillDetailRow>('bill_detail', {
    occurred_on_from: IMPORT_FROM,
    occurred_on_to: to,
    columns: [
      'reference_number',
      'description',
      'work_order',
      'payee_name',
      'paid',
      'payment_date',
      'check_number',
    ],
  });
  const billsByDate = new Map<string, BillDetailRow[]>();
  for (const b of billRows) {
    if (!isHdms(b.payee_name) || !b.payment_date || money(b.paid) <= 0) continue;
    const list = billsByDate.get(b.payment_date) ?? [];
    list.push(b);
    billsByDate.set(b.payment_date, list);
  }

  // Dates with more than one HDMS disbursement can't split bills reliably.
  const dateCounts = new Map<string, number>();
  for (const d of disbursements) {
    dateCounts.set(d.occurred_date!, (dateCounts.get(d.occurred_date!) || 0) + 1);
  }

  const { byNumber, byWoRef } = await loadMatchTargets();

  const result: ImportResult = {
    disbursements: [],
    created: 0,
    adopted: 0,
    existing: 0,
    attachedTotal: 0,
  };

  for (const d of disbursements) {
    const paidOn = d.occurred_date!;
    const amount = Math.round(money(d.amount) * 100) / 100;
    const appfolioId = `${paidOn}|${amount.toFixed(2)}`;
    const ambiguous = (dateCounts.get(paidOn) || 0) > 1;

    const entry: ImportedDisbursement = {
      paid_on: paidOn,
      amount,
      reference: d.check_number?.trim() || null,
      outcome: 'created',
      payment_id: null,
      bills: 0,
      billsPaidSum: 0,
      attached: 0,
      alreadyLinked: 0,
      conflicts: [],
      unmatchedRefs: [],
    };

    // ── Find or create the payment ─────────────────────────────────
    const { data: byAfId } = await supabase
      .from('hdms_payments')
      .select('*')
      .eq('appfolio_id', appfolioId)
      .maybeSingle();

    let payment: Payment | null = (byAfId as Payment) || null;
    if (payment) {
      entry.outcome = 'existing';
      result.existing++;
    } else {
      // Adopt a manually captured payment with the same date + amount so the
      // import never duplicates a payment Craig already entered by hand.
      const { data: manual } = await supabase
        .from('hdms_payments')
        .select('*')
        .eq('paid_on', paidOn)
        .eq('amount', amount)
        .is('appfolio_id', null)
        .limit(1)
        .maybeSingle();

      if (manual) {
        const { data: updated } = await supabase
          .from('hdms_payments')
          .update({ appfolio_id: appfolioId, source: 'appfolio' })
          .eq('id', (manual as Payment).id)
          .select()
          .single();
        payment = (updated as Payment) || (manual as Payment);
        entry.outcome = 'adopted';
        result.adopted++;
      } else {
        payment = await capturePayment({
          paid_on: paidOn,
          amount,
          payee: DEFAULT_PAYEE,
          reference: entry.reference || undefined,
          method: 'ach',
          source: 'appfolio',
          appfolio_id: appfolioId,
          created_by: createdBy,
        });
        entry.outcome = 'created';
        result.created++;
      }
    }
    entry.payment_id = payment.id;

    // ── Resolve the covered invoices from the bill lines ───────────
    const bills = billsByDate.get(paidOn) ?? [];
    entry.bills = bills.length;
    entry.billsPaidSum = Math.round(bills.reduce((s, b) => s + money(b.paid), 0) * 100) / 100;

    if (ambiguous) {
      entry.outcome = 'ambiguous_date';
      result.disbursements.push(entry);
      continue;
    }

    const invoiceIds = new Set<string>();
    for (const b of bills) {
      const hit = matchBill(
        { reference: b.reference_number || b.work_order, description: b.description },
        byNumber,
        byWoRef
      );
      if (hit) invoiceIds.add(hit.invoiceId);
      else entry.unmatchedRefs.push(b.reference_number || b.work_order || '(no ref)');
    }

    if (invoiceIds.size > 0) {
      const { data: invs } = await supabase
        .from('hdms_invoices')
        .select('id, invoice_code, payment_id, status')
        .in('id', [...invoiceIds]);

      const attachable: string[] = [];
      for (const inv of invs ?? []) {
        if (inv.status === 'void') continue;
        if (!inv.payment_id) attachable.push(inv.id);
        else if (inv.payment_id === payment.id) entry.alreadyLinked++;
        else entry.conflicts.push(inv.invoice_code);
      }
      if (attachable.length > 0) {
        await attachInvoices(payment.id, attachable);
        entry.attached = attachable.length;
        result.attachedTotal += attachable.length;
      }
    }

    result.disbursements.push(entry);
  }

  return result;
}
