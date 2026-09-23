import type { HdmsInvoice } from './invoices';
import type { Payment } from './payments';

/** Credits remain eligible; voided and already linked invoices do not. */
export function unreconciledInvoices<T extends Pick<HdmsInvoice, 'payment_id' | 'status'>>(invoices: T[]): T[] {
  return invoices.filter(invoice => !invoice.payment_id && invoice.status !== 'void');
}
export function availableReconciliationPayments<T extends Pick<Payment, 'amount' | 'invoice_total'>>(payments: T[]): T[] {
  return payments.filter(payment => payment.amount === null || Math.round((Number(payment.amount) - Number(payment.invoice_total)) * 100) > 0);
}
/** Never silently choose an unrelated payment, including when restoring an obsolete draft. */
export function reconciliationPaymentChoice(payments: Pick<Payment, 'id' | 'amount' | 'invoice_total'>[], saved?: {mode:'existing'|'new';selectedPaymentId:string} | null) {
  const available = availableReconciliationPayments(payments);
  if (saved?.mode === 'new') return {mode:'new' as const,selectedPaymentId:''};
  if (saved?.selectedPaymentId && available.some(payment=>payment.id===saved.selectedPaymentId)) return {mode:'existing' as const,selectedPaymentId:saved.selectedPaymentId};
  return {mode: available.length ? 'existing' as const : 'new' as const,selectedPaymentId:''};
}
