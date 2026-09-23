/** A user's single resumable reconciliation workspace. Payment entry is not a payment. */
export interface ReconciliationListState {
  invoiceIds: string[]; dateFrom: string; dateTo: string; search: string;
  paidFilter: 'all' | 'unpaid' | 'paid'; afBilledOnly: boolean; techFilter: string;
  sortField: 'date' | 'number' | 'amount' | 'property' | 'tech'; sortDir: 'asc' | 'desc';
}
export interface ReconciliationPaymentState {
  mode: 'existing' | 'new'; selectedPaymentId: string; payee: string; paidOn: string;
  amount: string; reference: string; method: string; memo: string;
}
export interface ReconciliationDraft {
  id: string; createdAt: string; recordedAt: string | null;
  list: ReconciliationListState; payment: ReconciliationPaymentState | null;
}
export function newReconciliationDraft(): ReconciliationDraft {
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), recordedAt: null,
    list: {invoiceIds: [], dateFrom: '', dateTo: '', search: '', paidFilter: 'all', afBilledOnly: false, techFilter: 'all', sortField: 'date', sortDir: 'desc'}, payment: null };
}
export function validReconciliationDraft(value: unknown): value is ReconciliationDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as ReconciliationDraft;
  const l = d.list; const p = d.payment;
  const string = (s: unknown) => typeof s === 'string' && s.length <= 10000;
  const date = (s: unknown) => string(s) && (s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s as string));
  return string(d.id) && /^[\da-f-]{36}$/i.test(d.id) && string(d.createdAt) && Number.isFinite(Date.parse(d.createdAt))
    && (d.recordedAt === null || (string(d.recordedAt) && Number.isFinite(Date.parse(d.recordedAt))))
    && !!l && Array.isArray(l.invoiceIds) && l.invoiceIds.length <= 2000 && l.invoiceIds.every(string)
    && date(l.dateFrom) && date(l.dateTo) && string(l.search) && ['all','unpaid','paid'].includes(l.paidFilter)
    && typeof l.afBilledOnly === 'boolean' && string(l.techFilter) && ['date','number','amount','property','tech'].includes(l.sortField)
    && ['asc','desc'].includes(l.sortDir)
    && (p === null || (!!p && ['existing','new'].includes(p.mode) && [p.selectedPaymentId,p.payee,p.amount,p.reference,p.method,p.memo].every(string) && date(p.paidOn)));
}
