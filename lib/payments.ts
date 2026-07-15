import { getSupabaseAdmin } from './supabase';
import { HdmsInvoice } from './invoices';
import { aggregate, chargedSplit } from './invoice-analysis';

// ============================================
// Types
// ============================================

/**
 * A recorded trust-account payment (typically one ACH from AppFolio to HDMS)
 * reconciled against a set of HDMS invoices. Totals are snapshotted at record
 * time so the ledger is stable even if a linked invoice is later edited.
 */
export interface Payment {
  id: string;
  paid_on: string; // YYYY-MM-DD
  amount: number; // the ACH/check total actually received
  reference: string | null;
  method: string; // 'ach' | 'check' | 'other'
  memo: string | null;

  invoice_count: number;
  labor_total: number;
  materials_total: number;
  other_total: number;
  invoice_total: number; // sum of linked invoice total_amount (live invoices)

  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePaymentInput {
  paid_on: string;
  amount: number;
  reference?: string;
  method?: string;
  memo?: string;
  invoice_ids: string[];
  created_by: string;
}

/** A payment plus the invoices it covers (for the detail view). */
export interface PaymentWithInvoices extends Payment {
  invoices: HdmsInvoice[];
}

// ============================================
// Database Operations
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

/**
 * Record a payment and link the given invoices to it.
 * Rejects if any invoice is already reconciled to a different payment.
 */
export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const supabase = getSupabaseAdmin();

  const ids = Array.from(new Set(input.invoice_ids.filter(Boolean)));
  if (ids.length === 0) {
    throw new Error('Select at least one invoice to reconcile.');
  }

  // Load the invoices being reconciled — for the guard and the snapshot totals.
  const { data: invoices, error: invError } = await supabase
    .from('hdms_invoices')
    .select('*')
    .in('id', ids);

  if (invError) {
    throw new Error(`Failed to load invoices: ${invError.message}`);
  }

  const rows = (invoices as HdmsInvoice[]) || [];
  if (rows.length !== ids.length) {
    throw new Error('Some selected invoices no longer exist.');
  }

  const alreadyPaid = rows.filter((r) => r.payment_id);
  if (alreadyPaid.length > 0) {
    const codes = alreadyPaid.map((r) => r.invoice_code).join(', ');
    throw new Error(`Already reconciled to another payment: ${codes}`);
  }

  // Void invoices carry no charge — exclude them from the link, count, and totals
  // so the ledger's invoice_count matches its dollar figures.
  const liveRows = rows.filter((r) => r.status !== 'void');
  const liveIds = liveRows.map((r) => r.id);
  if (liveIds.length === 0) {
    throw new Error('All selected invoices are void — nothing to reconcile.');
  }

  const split = chargedSplit(aggregate(liveRows));

  const { data: payment, error: payError } = await supabase
    .from('hdms_payments')
    .insert({
      paid_on: input.paid_on,
      amount: input.amount,
      reference: input.reference?.trim() || null,
      method: input.method?.trim() || 'ach',
      memo: input.memo?.trim() || null,
      invoice_count: liveRows.length,
      labor_total: split.labor,
      materials_total: split.materials,
      other_total: split.other,
      invoice_total: split.total,
      created_by: input.created_by,
    })
    .select()
    .single();

  if (payError || !payment) {
    console.error('Error creating payment:', payError);
    throw new Error(`Failed to create payment: ${payError?.message}`);
  }

  // Link the (live) invoices to the new payment.
  const { error: linkError } = await supabase
    .from('hdms_invoices')
    .update({ payment_id: (payment as Payment).id })
    .in('id', liveIds);

  if (linkError) {
    // Roll back the orphaned payment so we don't leave a ledger row with no invoices.
    await supabase.from('hdms_payments').delete().eq('id', (payment as Payment).id);
    console.error('Error linking invoices to payment:', linkError);
    throw new Error(`Failed to link invoices: ${linkError.message}`);
  }

  return payment as Payment;
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
