import { getSupabaseAdmin } from './supabase';
import { HdmsInvoice } from './invoices';
import { aggregate, chargedSplit } from './invoice-analysis';

// ============================================
// Types
// ============================================

export const DEFAULT_PAYEE = 'High Desert Maintenance Services';

/**
 * A captured trust-account payment (typically one ACH to HDMS). It can be
 * captured "open" (no invoices yet) and reconciled later by attaching the
 * invoices it covered. Totals are snapshotted from the linked invoices so the
 * ledger stays stable even if a linked invoice is later edited.
 */
export interface Payment {
  id: string;
  paid_on: string; // YYYY-MM-DD
  amount: number | null; // the ACH/check total actually received (null = not entered yet)
  payee: string; // who was paid (default HDMS)
  reference: string | null;
  method: string; // 'ach' | 'check' | 'other'
  memo: string | null;
  source: string; // 'manual' | 'appfolio'
  appfolio_id: string | null; // check-register entry id when imported

  invoice_count: number;
  labor_total: number;
  materials_total: number;
  appliance_total: number;
  other_total: number;
  invoice_total: number; // sum of linked invoice total_amount (live invoices)

  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CapturePaymentInput {
  paid_on: string;
  amount?: number | null; // optional — capture by date now, fill amount later
  payee?: string;
  reference?: string;
  method?: string;
  memo?: string;
  source?: string;
  appfolio_id?: string;
  created_by: string;
}

export interface CreatePaymentInput extends CapturePaymentInput {
  invoice_ids: string[];
}

/** Editable fields on a payment (invoice links are managed via attach/detach). */
export interface UpdatePaymentInput {
  paid_on?: string;
  amount?: number | null;
  payee?: string;
  reference?: string | null;
  method?: string;
  memo?: string | null;
}

/** A payment plus the invoices it covers (for the detail view). */
export interface PaymentWithInvoices extends Payment {
  invoices: HdmsInvoice[];
}

// ============================================
// Reads
// ============================================

export async function getPayments(): Promise<Payment[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('hdms_payments')
    .select('*')
    .order('paid_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching payments:', error);
    throw new Error(`Failed to fetch payments: ${error.message}`);
  }

  return data as Payment[];
}

export async function getPaymentById(id: string): Promise<PaymentWithInvoices | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('hdms_payments')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error fetching payment:', error);
    throw new Error(`Failed to fetch payment: ${error.message}`);
  }

  const { data: invoices, error: invError } = await supabase
    .from('hdms_invoices')
    .select('*')
    .eq('payment_id', id)
    .order('created_at', { ascending: false });

  if (invError) {
    console.error('Error fetching payment invoices:', invError);
    throw new Error(`Failed to fetch payment invoices: ${invError.message}`);
  }

  return { ...(data as Payment), invoices: (invoices as HdmsInvoice[]) || [] };
}

// ============================================
// Snapshot recompute (shared by attach/detach)
// ============================================

/**
 * Recompute a payment's snapshot totals from the invoices currently linked to
 * it and persist them. Returns the refreshed Payment. Exported so
 * scripts/recompute-payment-snapshots.ts can re-split existing ledger rows.
 */
export async function recomputeSnapshot(paymentId: string): Promise<Payment> {
  const supabase = getSupabaseAdmin();

  const { data: linked, error } = await supabase
    .from('hdms_invoices')
    .select('*')
    .eq('payment_id', paymentId);

  if (error) {
    throw new Error(`Failed to load linked invoices: ${error.message}`);
  }

  const split = chargedSplit(aggregate((linked as HdmsInvoice[]) || []));
  const liveCount = ((linked as HdmsInvoice[]) || []).filter((i) => i.status !== 'void').length;

  const { data: updated, error: upErr } = await supabase
    .from('hdms_payments')
    .update({
      invoice_count: liveCount,
      labor_total: split.labor,
      materials_total: split.materials,
      appliance_total: split.appliance,
      other_total: split.other,
      invoice_total: split.total,
    })
    .eq('id', paymentId)
    .select()
    .single();

  if (upErr || !updated) {
    throw new Error(`Failed to update payment snapshot: ${upErr?.message}`);
  }

  return updated as Payment;
}

// ============================================
// Writes
// ============================================

/** Capture an "open" payment with no invoices attached yet. */
export async function capturePayment(input: CapturePaymentInput): Promise<Payment> {
  const supabase = getSupabaseAdmin();

  const { data: payment, error } = await supabase
    .from('hdms_payments')
    .insert({
      paid_on: input.paid_on,
      amount: input.amount ?? null,
      payee: input.payee?.trim() || DEFAULT_PAYEE,
      reference: input.reference?.trim() || null,
      method: input.method?.trim() || 'ach',
      memo: input.memo?.trim() || null,
      source: input.source?.trim() || 'manual',
      appfolio_id: input.appfolio_id?.trim() || null,
      invoice_count: 0,
      labor_total: 0,
      materials_total: 0,
      appliance_total: 0,
      other_total: 0,
      invoice_total: 0,
      created_by: input.created_by,
    })
    .select()
    .single();

  if (error || !payment) {
    console.error('Error capturing payment:', error);
    throw new Error(`Failed to capture payment: ${error?.message}`);
  }

  return payment as Payment;
}

/** Update a payment's editable fields (not its invoice links). */
export async function updatePayment(id: string, input: UpdatePaymentInput): Promise<Payment> {
  const supabase = getSupabaseAdmin();

  const patch: Record<string, unknown> = {};
  if (input.paid_on !== undefined) patch.paid_on = input.paid_on;
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.payee !== undefined) patch.payee = input.payee?.trim() || DEFAULT_PAYEE;
  if (input.reference !== undefined) patch.reference = input.reference?.trim() || null;
  if (input.method !== undefined) patch.method = input.method?.trim() || 'ach';
  if (input.memo !== undefined) patch.memo = input.memo?.trim() || null;

  if (Object.keys(patch).length === 0) {
    const existing = await getPaymentById(id);
    if (!existing) throw new Error('Payment not found.');
    // Strip the invoices field to return a plain Payment.
    const { invoices: _invoices, ...payment } = existing;
    return payment;
  }

  const { data, error } = await supabase
    .from('hdms_payments')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update payment: ${error?.message}`);
  }
  return data as Payment;
}

/**
 * Link invoices to an existing payment and refresh its snapshot totals.
 * Rejects invoices already linked to a *different* payment; skips void invoices.
 */
export async function attachInvoices(
  paymentId: string,
  invoiceIds: string[]
): Promise<Payment> {
  const supabase = getSupabaseAdmin();

  const ids = Array.from(new Set(invoiceIds.filter(Boolean)));
  if (ids.length === 0) throw new Error('No invoices to attach.');

  const { data: invoices, error } = await supabase
    .from('hdms_invoices')
    .select('*')
    .in('id', ids);

  if (error) throw new Error(`Failed to load invoices: ${error.message}`);

  const rows = (invoices as HdmsInvoice[]) || [];
  if (rows.length !== ids.length) throw new Error('Some invoices no longer exist.');

  const otherPayment = rows.filter((r) => r.payment_id && r.payment_id !== paymentId);
  if (otherPayment.length > 0) {
    const codes = otherPayment.map((r) => r.invoice_code).join(', ');
    throw new Error(`Already reconciled to another payment: ${codes}`);
  }

  // Void invoices carry no charge — never link them.
  const liveIds = rows.filter((r) => r.status !== 'void').map((r) => r.id);
  if (liveIds.length === 0) throw new Error('All selected invoices are void — nothing to attach.');

  const { error: linkErr } = await supabase
    .from('hdms_invoices')
    .update({ payment_id: paymentId })
    .in('id', liveIds);

  if (linkErr) throw new Error(`Failed to attach invoices: ${linkErr.message}`);

  return recomputeSnapshot(paymentId);
}

/** Unlink invoices from a payment (they revert to unpaid) and refresh the snapshot. */
export async function detachInvoices(
  paymentId: string,
  invoiceIds: string[]
): Promise<Payment> {
  const supabase = getSupabaseAdmin();

  const ids = Array.from(new Set(invoiceIds.filter(Boolean)));
  if (ids.length === 0) throw new Error('No invoices to detach.');

  const { error } = await supabase
    .from('hdms_invoices')
    .update({ payment_id: null })
    .eq('payment_id', paymentId)
    .in('id', ids);

  if (error) throw new Error(`Failed to detach invoices: ${error.message}`);

  return recomputeSnapshot(paymentId);
}

/** Capture a payment and attach invoices in one shot (the inline reconcile path). */
export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const ids = Array.from(new Set(input.invoice_ids.filter(Boolean)));
  if (ids.length === 0) throw new Error('Select at least one invoice to reconcile.');

  const payment = await capturePayment(input);
  try {
    return await attachInvoices(payment.id, ids);
  } catch (err) {
    // Roll back the orphaned payment so we don't leave a stranded ledger row.
    await getSupabaseAdmin().from('hdms_payments').delete().eq('id', payment.id);
    throw err;
  }
}

/** Delete a payment and unlink its invoices (they revert to unpaid). */
export async function deletePayment(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error: unlinkError } = await supabase
    .from('hdms_invoices')
    .update({ payment_id: null })
    .eq('payment_id', id);

  if (unlinkError) {
    throw new Error(`Failed to unlink invoices: ${unlinkError.message}`);
  }

  const { error } = await supabase.from('hdms_payments').delete().eq('id', id);
  if (error) {
    throw new Error(`Failed to delete payment: ${error.message}`);
  }
}
